import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/enforcement.ts és summary.ts portja (A11).

nonisolated struct EnforcementData: Sendable {
    var sections: [Section] = []
    var cameras: [FixedCamera] = []
    var planned: [PlannedCheck] = []

    static let none = EnforcementData()
}

nonisolated private struct Box {
    var s: Double
    var w: Double
    var n: Double
    var e: Double

    func contains(_ p: some Coordinate) -> Bool { p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e }
}

/// Az útvonal befoglaló téglalapja `padM` méterrel megtoldva (gyors előszűrés).
nonisolated private func bounds(_ points: [LatLon], _ padM: Double) -> Box {
    var s = Double.infinity
    var w = Double.infinity
    var n = -Double.infinity
    var e = -Double.infinity
    for p in points {
        s = min(s, p.lat)
        n = max(n, p.lat)
        w = min(w, p.lon)
        e = max(e, p.lon)
    }
    let dLat = padM / 111_195
    let dLon = padM / (111_195 * cos((((s + n) / 2) * Double.pi) / 180))
    return Box(s: s - dLat, w: w - dLon, n: n + dLat, e: e + dLon)
}

/// Az útvonal mint core `Route` (a névleges hosszra skálázva).
nonisolated func coreRoute(_ r: NavRoute) -> Route? { try? Route(r.points, nominalLengthM: r.distanceM) }

/// Az útvonal `bandM` (alapból `ROUTE_MATCH_M`, 40 m) sávjába eső szakaszok, kamerák és tervezett mérések, az útvonal menti
/// sorrendben. Szakasz: a kezdő- és a végpontja is a sávban, a haladási iránnyal egyezően;
/// kamera: csak ha a láthatósága `show` (zóna / rejtett országban a pontos hely nem kerül ki);
/// tervezett mérés: az útvonal 50 m-enként mintavételezett pontjai a vonalon (szintén `bandM`, nem a sáv
/// 100 m-es `PLANNED_MATCH_M`-je) / zónában.
nonisolated func routeEnforcement(_ navRoute: NavRoute, _ data: EnforcementData, now: Double, bandM: Double = NAV_CONFIG.enforcementBandM, rules: VisibilityRules = .bundled) -> [EnforcementItem] {
    guard let route = coreRoute(navRoute) else { return [] }
    let box = bounds(navRoute.points, bandM + 100)
    var items: [EnforcementItem] = []

    for s in data.sections {
        guard box.contains(s.start), box.contains(s.end) else { continue }
        let a = route.project(s.start)
        let b = route.project(s.end)
        if a.crossM > bandM || b.crossM > bandM { continue }
        let len = b.alongM - a.alongM
        // a haladási iránnyal egyező, nagyjából a szakasz hosszának megfelelő útvonal-darab
        if len < s.lengthM * 0.5 || len > s.lengthM * 2 { continue }
        if let g = s.geometry, g.count > 2, route.project(g[g.count / 2]).crossM > bandM { continue }
        items.append(EnforcementItem(kind: .section, id: s.id, startM: a.alongM, endM: b.alongM, limitKmh: s.speedLimitKmh, label: s.road))
    }

    for c in data.cameras {
        let pos = LatLon(lat: c.lat, lon: c.lon)
        guard rules.visibility(c.country) == .show, box.contains(pos) else { continue }
        let p = route.project(pos)
        if p.crossM > bandM || p.alongM < 0 || p.alongM > route.lengthM { continue }
        // az ellenkező irányba néző kamerát nem vesszük az útra (ha van irány)
        if let h = c.headingDeg, angleDiffDeg(h, p.bearingDeg) > 100 { continue }
        items.append(EnforcementItem(kind: .camera, id: c.id, startM: p.alongM, endM: p.alongM, limitKmh: c.speedLimitKmh, label: c.road, verified: c.verified))
    }

    let active = data.planned.filter { plannedCheckActive($0, now: now, rules: rules) }
    if !active.isEmpty {
        var samples: [(along: Double, p: LatLon)] = []
        var d = 0.0
        while d <= route.lengthM {
            samples.append((d, route.pointAt(d)))
            d += 50
        }
        for c in active {
            let lines = c.isZone ? [] : plannedRoutes(c)
            var from: Double?
            var to = 0.0
            for s in samples where c.isZone ? inPlannedZone(s.p, c) : onPlannedLine(s.p, routes: lines, toleranceM: bandM) {
                if from == nil { from = s.along }
                to = s.along
            }
            if let from {
                items.append(EnforcementItem(kind: .planned, id: c.id, startM: from, endM: to, limitKmh: c.speedLimitKmh, label: c.roadRef ?? c.settlement ?? ""))
            }
        }
    }

    return items.enumerated().sorted { a, b in
        if a.element.startM != b.element.startM { return a.element.startM < b.element.startM }
        if a.element.endM != b.element.endM { return a.element.endM < b.element.endM }
        return a.offset < b.offset
    }.map(\.element)
}

/// Az `i`. szakasz átlagos haladási ideje a szakaszokon a határ szerint (mérésnél nem lehet a határnál gyorsabban menni).
nonisolated func adjustedDurations(_ route: NavRoute, _ items: [EnforcementItem]) -> [Double] {
    var out = route.segDurationS
    let sections = items.filter { $0.kind == .section && ($0.limitKmh ?? 0) > 0 && $0.endM > $0.startM }
    if sections.isEmpty { return out }
    let total = route.distanceM
    for i in out.indices {
        let a = route.segStartM[i]
        let b = i + 1 < route.segStartM.count ? route.segStartM[i + 1] : total
        let len = b - a
        if len <= 0 { continue }
        for s in sections {
            let overlap = min(b, s.endM) - max(a, s.startM)
            if overlap <= 0 { continue }
            let part = (out[i] * overlap) / len
            let atLimit = overlap / (s.limitKmh! / 3.6)
            out[i] = out[i] - part + max(part, atLimit)
        }
    }
    return out
}

/// Kumulált idő (s) a szakaszok elején; az utolsó elem az összes idő.
nonisolated func cumulative(_ durations: [Double]) -> [Double] {
    var cum = [0.0]
    for d in durations { cum.append(cum[cum.count - 1] + d) }
    return cum
}

/// A hátralévő idő (s) az adott útvonal menti pozíciótól, a `cum` (kumulált) idő-tömbből.
nonisolated func remainingSeconds(_ route: NavRoute, _ cum: [Double], _ alongM: Double) -> Double {
    let total = cum[cum.count - 1]
    if alongM <= 0 { return total }
    if alongM >= route.distanceM { return 0 }
    let lo = segmentAt(route, alongM)
    let a = route.segStartM[lo]
    let b = lo + 1 < route.segStartM.count ? route.segStartM[lo + 1] : route.distanceM
    let frac = b > a ? (alongM - a) / (b - a) : 0
    return total - (cum[lo] + (cum[lo + 1] - cum[lo]) * frac)
}

/// Két útvonal átfedése: az `b` pontjainak hányada, amely `a` 60 m-es sávjában van (kb. 1 km-enként mintázva).
nonisolated func routeOverlap(_ a: NavRoute, _ b: NavRoute, bandM: Double = 60) -> Double {
    guard let ra = coreRoute(a), let rb = coreRoute(b) else { return 0 }
    var hit = 0
    var n = 0
    var d = 0.0
    while d <= rb.lengthM {
        n += 1
        if ra.project(rb.pointAt(d)).crossM <= bandM { hit += 1 }
        d += 1000
    }
    return n > 0 ? Double(hit) / Double(n) : 0
}

/// Ezek a manőver-típusok nem jelentenek leágazást (a lépések tagolásából is adódhatnak).
nonisolated private let NOT_AN_EXIT: Set<String> = ["depart", "arrive", "continue", "new name", "notification"]

/// Két manőver „ugyanaz”, ha ilyen közel van egymáshoz (m).
nonisolated private let SAME_MANEUVER_M = 35.0

/// Az alternatíva lehajtója: az alternatíva első manővere, amely a jelenlegi útvonal lépései között
/// nincs (a helye alapján). `distanceM` az alternatíva mentén mért távolság a kezdőpontjától – az
/// alternatívát a jelenlegi pozícióról kérjük, tehát ez a pozíciótól számít; `name` a manőver
/// kijárat-felirata („Kijárat 56”), ennek hiányában a cél-neve (a banner másodlagos szövege); egyébként `nil`.
/// `nil`, ha nincs ilyen manőver.
nonisolated func firstNewManeuver(_ current: NavRoute, _ alt: NavRoute) -> (distanceM: Double, name: String?)? {
    for step in alt.steps {
        let m = step.endManeuver
        if NOT_AN_EXIT.contains(m.type) { continue }
        if current.steps.contains(where: { haversineM($0.endManeuver.location, m.location) <= SAME_MANEUVER_M }) { continue }
        let banner = step.banners.first
        let exit = banner?.primary.exit.flatMap { $0.isEmpty ? nil : $0 }
        let secondary = banner?.secondary?.text.isEmpty == false ? banner?.secondary?.text : nil
        return (step.startM + step.distanceM, exit ?? secondary)
    }
    return nil
}

// MARK: útvonal-összefoglaló (summary.ts)

/// Az útvonalválasztó kártya adatai egy útvonalra.
nonisolated struct RouteSummary: Equatable, Sendable {
    /// Menetidő (s) a szakaszokon a határral számolva.
    var durationS: Double
    var distanceM: Double
    var sections: Int
    var cameras: Int
    /// Ebből az ellenőrzött forrásból valók.
    var camerasVerified: Int
    /// Dugó miatti késés (s) a tipikus időhöz képest.
    var delayS: Double
}

nonisolated func routeSummary(_ route: NavRoute, _ data: EnforcementData, now: Double) -> RouteSummary {
    let items = routeEnforcement(route, data, now: now)
    return RouteSummary(
        durationS: cumulative(adjustedDurations(route, items)).last ?? route.durationS,
        distanceM: route.distanceM,
        sections: items.filter { $0.kind == .section }.count,
        cameras: items.filter { $0.kind == .camera }.count,
        camerasVerified: items.filter { $0.kind == .camera && $0.verified == true }.count,
        delayS: trafficDelayS(route)
    )
}
