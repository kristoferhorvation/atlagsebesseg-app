import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/plannedChecks.ts portja (ugyanaz a `planned_checks_in_bbox` lekérdezés és szótár; a tűrés
// és a letérés-küszöb a generált AppLogicConstants.swift-ből, a webbel közös forrásból).

nonisolated enum PlannedLimitSource: String, Codable, Sendable {
    case osm
    case kresz = "kresz_default"
}

/// Tervezett rendőrségi mérés (a `planned_checks` sora appbeli alakban).
nonisolated struct PlannedCheck: Identifiable, Hashable, Codable, Sendable {
    var id: String
    var country: String
    var county: String
    var settlement: String?
    var roadRef: String?
    /// A rendőrségi szöveg szó szerint.
    var description: String
    /// Egy vagy több vonal (osztott pálya, kereszteződés); zónánál üres.
    var lines: [[LatLon]]
    /// Zóna (a rendőrség csak települést nevezett meg): sokszögenként a gyűrűk (az első a külső, a többi lyuk).
    var zones: [[[LatLon]]]
    var speedLimitKmh: Double
    var limitSource: PlannedLimitSource
    /// Unix-idő ms-ban.
    var validFrom: Double
    var validTo: Double
    var timeWindow: String?
    var sourceUrl: String

    /// Zóna-típusú-e (egész település).
    var isZone: Bool { !zones.isEmpty }
}

/// A `planned_checks` tábla / `planned_checks_in_bbox` sora (a geometria GeoJSON, lon-lat sorrendben).
nonisolated struct PlannedCheckRow: Decodable, Sendable {
    struct Geometry: Decodable, Sendable {
        var lines: [[[Double]]] = []
        var zones: [[[[Double]]]] = []

        private enum CodingKeys: String, CodingKey { case type, coordinates }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            switch try c.decode(String.self, forKey: .type) {
            case "LineString": lines = [try c.decode([[Double]].self, forKey: .coordinates)]
            case "MultiLineString": lines = try c.decode([[[Double]]].self, forKey: .coordinates)
            case "Polygon": zones = [try c.decode([[[Double]]].self, forKey: .coordinates)]
            case "MultiPolygon": zones = try c.decode([[[[Double]]]].self, forKey: .coordinates)
            default: break
            }
        }
    }

    var id: String
    var country: String
    var county: String
    var settlement: String?
    var road_ref: String?
    var description: String
    var geometry: Geometry
    var speed_limit_kmh: Double
    var limit_source: PlannedLimitSource
    var valid_from: String
    var valid_to: String
    var time_window: String?
    var source_url: String

    var check: PlannedCheck? {
        guard let from = parseTimestampMs(valid_from), let to = parseTimestampMs(valid_to) else { return nil }
        let ring = { (l: [[Double]]) in l.compactMap { $0.count >= 2 ? LatLon(lat: $0[1], lon: $0[0]) : nil } }
        return PlannedCheck(
            id: id, country: country, county: county, settlement: settlement, roadRef: road_ref, description: description,
            lines: geometry.lines.map(ring), zones: geometry.zones.map { $0.map(ring) }, speedLimitKmh: speed_limit_kmh,
            limitSource: limit_source, validFrom: from, validTo: to, timeWindow: time_window, sourceUrl: source_url
        )
    }
}

/// A Postgres `timestamptz` (ISO 8601, tört másodperccel vagy anélkül) → Unix-idő ms-ban (a webes `Date.parse`).
nonisolated func parseTimestampMs(_ s: String) -> Double? {
    let plain = ISO8601DateFormatter()
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = plain.date(from: s) ?? fractional.date(from: s) else { return nil }
    return (d.timeIntervalSince1970 * 1000).rounded()
}

/// Érvényes-e most, és látszhat-e az országban (a jogi láthatóság szerint).
nonisolated func plannedCheckActive(_ c: PlannedCheck, now: Double, rules: VisibilityRules = .bundled) -> Bool {
    c.validFrom <= now && now < c.validTo && rules.visibility(c.country) != .hide
}

/// A vonalak útvonalként (a legalább kétpontos, nem elfajult vonalak).
nonisolated func plannedRoutes(_ c: PlannedCheck) -> [Route] {
    c.lines.filter { $0.count >= 2 }.compactMap { try? Route($0) }
}

/// A pont a vonalon van-e (≤ tűrés, a két vég között – a meghosszabbításon nem).
nonisolated func onPlannedLine(_ p: some Coordinate, routes: [Route], toleranceM: Double = PLANNED_MATCH_M) -> Bool {
    routes.contains { route in
        let proj = route.project(p)
        return proj.crossM <= toleranceM && proj.alongM >= -toleranceM && proj.alongM <= route.lengthM + toleranceM
    }
}

nonisolated private func inRing(_ p: some Coordinate, _ ring: [LatLon]) -> Bool {
    var inside = false
    var j = ring.count - 1
    for i in ring.indices {
        let a = ring[i]
        let b = ring[j]
        if (a.lat > p.lat) != (b.lat > p.lat), p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon { inside.toggle() }
        j = i
    }
    return inside
}

/// A pont a zóna határán belül van-e (külső gyűrűben, de nem lyukban).
nonisolated func inPlannedZone(_ p: some Coordinate, _ c: PlannedCheck) -> Bool {
    c.zones.contains { poly in
        guard let outer = poly.first else { return false }
        return inRing(p, outer) && !poly.dropFirst().contains { inRing(p, $0) }
    }
}

/// Melyik tervezett mérés vonalán (zónájában) halad a felhasználó: a sáv a vonalra érve azonnal megjelenik, és
/// `PLANNED_OFF_FIXES` vonalon kívüli fix után tűnik el (letérés). Ha vonal és zóna is érinti, a vonal (a
/// pontosabb hely) az erősebb; zónából a településen belül maradva nem tűnik el a sáv.
final class PlannedCheckWatch {
    private(set) var current: PlannedCheck?
    private var off = 0
    private var routes: [String: [Route]] = [:]

    func on(_ p: some Coordinate, _ c: PlannedCheck) -> Bool {
        if c.isZone { return inPlannedZone(p, c) }
        if routes[c.id] == nil { routes[c.id] = plannedRoutes(c) }
        return onPlannedLine(p, routes: routes[c.id]!)
    }

    func update(_ fix: GpsFix?, _ checks: [PlannedCheck], now: Double) -> PlannedCheck? {
        guard let fix else { return current }
        let active = checks.filter { plannedCheckActive($0, now: now) }
        let lineHit = active.first { !$0.isZone && on(fix, $0) }
        if let cur = current, active.contains(where: { $0.id == cur.id }), on(fix, cur), !cur.isZone || lineHit == nil {
            off = 0
            return current
        }
        if let hit = lineHit ?? active.first(where: { on(fix, $0) }) {
            current = hit
            off = 0
        } else if current != nil {
            off += 1
            if off >= PLANNED_OFF_FIXES {
                current = nil
                off = 0
            }
        }
        return current
    }

    func reset() {
        current = nil
        off = 0
    }
}

// MARK: a sáv szövege

/// A budapesti idő eltolása UTC-hez (óra): március utolsó vasárnapjától október utolsó vasárnapjáig +2, egyébként +1.
nonisolated func budapestOffsetH(_ utcMs: Double) -> Int {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let y = cal.component(.year, from: Date(timeIntervalSince1970: utcMs / 1000))
    func lastSunday(_ month: Int) -> Double {
        // a hónap utolsó napja 01:00 UTC-kor, visszalépve vasárnapig
        let last = cal.date(from: DateComponents(year: y, month: month + 1, day: 0, hour: 1))!
        let weekday = cal.component(.weekday, from: last) - 1
        return (last.timeIntervalSince1970 - Double(weekday) * 86400) * 1000
    }
    return utcMs >= lastSunday(3) && utcMs < lastSunday(10) ? 2 : 1
}

/// Budapesti helyi dátum: (hónap 1–12, nap).
nonisolated private func localDay(_ ms: Double) -> (month: Int, day: Int) {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let d = Date(timeIntervalSince1970: (ms + Double(budapestOffsetH(ms)) * 3_600_000) / 1000)
    return (cal.component(.month, from: d), cal.component(.day, from: d))
}

nonisolated private let MONTHS: [L10nKey] = [
    .dateMonth1, .dateMonth2, .dateMonth3, .dateMonth4, .dateMonth5, .dateMonth6,
    .dateMonth7, .dateMonth8, .dateMonth9, .dateMonth10, .dateMonth11, .dateMonth12,
]

/// „okt 27–nov 2”, „ápr 15–19” (a közzétett időszak, budapesti dátum; a minta nyelvenként a szótárban).
nonisolated func plannedDateRange(_ c: PlannedCheck, lang: Lang? = nil) -> String {
    let a = localDay(c.validFrom)
    let b = localDay(c.validTo)
    let month = { (m: Int) in t(MONTHS[m - 1], lang: lang) }
    if a.month == b.month {
        return a.day == b.day
            ? t(.dateRangeDay, ["m": month(a.month), "d": String(a.day)], lang: lang)
            : t(.dateRangeMonth, ["m": month(a.month), "d1": String(a.day), "d2": String(b.day)], lang: lang)
    }
    return t(.dateRangeMonths, ["m1": month(a.month), "d1": String(a.day), "m2": month(b.month), "d2": String(b.day)], lang: lang)
}

/// A határ a sávon: „max 90”, KRESZ-alapértéknél „max ~90” (nem tábla szerinti).
nonisolated func plannedLimitText(_ c: PlannedCheck, unit: SpeedUnit = .kmh, lang: Lang? = nil) -> String {
    let x = String(speedIn(c.speedLimitKmh, unit) ?? 0)
    return t(c.limitSource == .kresz ? .plannedMaxApprox : .plannedMax, ["x": x], lang: lang)
}

/// A zóna sávjában a forrás: a közlemény oldala („police.hu”).
nonisolated func plannedSourceName(_ c: PlannedCheck) -> String {
    guard let host = URL(string: c.sourceUrl)?.host else { return c.sourceUrl }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
}

/// Zóna-sáv: „Rendőrségi mérés {település} területén · {dátum} · forrás: {forrás}”.
nonisolated func plannedZoneText(_ c: PlannedCheck, lang: Lang? = nil) -> String {
    t(.plannedZone, ["place": c.settlement ?? c.county, "date": plannedDateRange(c, lang: lang), "source": plannedSourceName(c)], lang: lang)
}

/// A vonalas sáv szövegrészei: „Tervezett rendőrségi mérés”, „okt 27–nov 2”, „max 90”, (időszak).
nonisolated func plannedBandParts(_ c: PlannedCheck, unit: SpeedUnit = .kmh, lang: Lang? = nil) -> [String] {
    [t(.plannedLine, lang: lang), plannedDateRange(c, lang: lang), plannedLimitText(c, unit: unit, lang: lang)] + (c.timeWindow.map { [$0] } ?? [])
}

nonisolated func plannedBandText(_ c: PlannedCheck, unit: SpeedUnit = .kmh, lang: Lang? = nil) -> String {
    c.isZone ? plannedZoneText(c, lang: lang) : plannedBandParts(c, unit: unit, lang: lang).joined(separator: " · ")
}
