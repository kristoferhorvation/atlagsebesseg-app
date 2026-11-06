import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/cameras.ts portja (a láthatóság szabálya ugyanabból a camera_visibility.json-ból).

nonisolated enum CameraType: String, Codable, Sendable {
    case speed
    case redLight = "red_light"
    case complex
    case sectionGate = "section_gate"

    /// A kamera ikonja (a térképen és a kártyán ugyanaz, mint a weben).
    var icon: IconName {
        switch self {
        case .speed: .cam_speed
        case .redLight: .cam_light
        case .complex: .cam_complex
        case .sectionGate: .kapu_kezdo
        }
    }

    var label: String {
        switch self {
        case .speed: t(.cameraTypeSpeed)
        case .redLight: t(.cameraTypeRedLight)
        case .complex: t(.cameraTypeComplex)
        case .sectionGate: t(.cameraTypeSectionGate)
        }
    }
}

/// Fix kamera (a `cameras` tábla sora appbeli alakban).
nonisolated struct FixedCamera: Identifiable, Hashable, Codable, Sendable {
    var id: String
    var country: String
    var type: CameraType
    var lat: Double
    var lon: Double
    var headingDeg: Double?
    var road: String
    var speedLimitKmh: Double?
    var source: String
    var sourceUrl: String
    var sourceDate: String
    var verified: Bool
}

/// A kártya forrás-sora: honnan tudjuk, és mennyire biztos (a webes `cameraSourceText`).
nonisolated func cameraSourceText(_ c: FixedCamera, lang: Lang? = nil) -> String {
    if c.verified && c.type == .complex && c.country == "HU" { return t(.cameraSourceVeda, lang: lang) }
    if c.verified { return t(.cameraSourceOfficial, ["date": c.sourceDate], lang: lang) }
    return t(.cameraSourceOsm, ["date": c.sourceDate], lang: lang)
}

/// AOS15: mit mér a kamera hozzánk képest (a webes `CameraDir`): irány nélküli → mindkét irány; saját irány nélkül
/// (álló autó) csak „egy irányban”.
nonisolated enum CameraDir: String, Sendable {
    case any, ours, other, one
}

nonisolated func cameraDirection(_ cameraHeading: Double?, _ heading: Double?) -> CameraDir {
    guard let cameraHeading else { return .any }
    guard let heading else { return .one }
    return angleDiffDeg(cameraHeading, heading) <= CAMERA_CARD.sameDirDeg ? .ours : .other
}

/// A kártya részlet-sora: „M1 · 130 km/h” (út és limit, ami van).
nonisolated func cameraCardDetail(road: String, speedLimitKmh: Double?, _ unit: SpeedUnit) -> String {
    let limit = speedIn(speedLimitKmh, unit).flatMap { $0 != 0 ? "\($0) \(unitLabel(unit))" : nil }
    return [road.isEmpty ? nil : road, limit].compactMap { $0 }.joined(separator: " · ")
}

/// A kártya irány- és távolság-sora: „A te irányodban mér · 1,2 km távolságra” (pozíció nélkül csak az irány).
nonisolated func cameraCardMeta(headingDeg: Double?, at: LatLon, fix: GpsFix?, _ unit: SpeedUnit, lang: Lang? = nil) -> String {
    let key: L10nKey = switch cameraDirection(headingDeg, fix?.heading) {
    case .any: .cameraDirAny
    case .ours: .cameraDirOurs
    case .other: .cameraDirOther
    case .one: .cameraDirOne
    }
    let dir = t(key, lang: lang)
    guard let fix else { return dir }
    let d = formatDistance(haversineM(fix, at), unit, lang: lang ?? L10n.lang)
    return "\(dir) · \(t(.cameraDistance, ["d": "\(d.value) \(d.unit)"], lang: lang))"
}

/// A `cameras` tábla / `cameras_in_bbox` sora.
nonisolated struct CameraRow: Codable, Sendable {
    var id: String
    var country: String
    var type: CameraType
    var lat: Double
    var lng: Double
    var heading: Double?
    var road: String
    var speed_limit_kmh: Double?
    var source: String
    var source_url: String
    var source_date: String
    var verified: Bool

    var camera: FixedCamera {
        FixedCamera(
            id: id, country: country, type: type, lat: lat, lon: lng, headingDeg: heading, road: road, speedLimitKmh: speed_limit_kmh,
            source: source, sourceUrl: source_url, sourceDate: source_date, verified: verified
        )
    }
}

// MARK: Jogi láthatóság országonként

nonisolated enum CameraVisibility: String, Codable, Sendable {
    case show, zone, hide
}

nonisolated struct VisibilityRules: Decodable, Sendable {
    struct Country: Decodable, Sendable {
        var mode: CameraVisibility
        var warning: String?
    }

    var `default`: CameraVisibility
    var countries: [String: Country]

    /// Az appba csomagolt packages/data/camera_visibility.json.
    static let bundled: VisibilityRules = {
        guard let url = Bundle.main.url(forResource: "camera_visibility", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let rules = try? JSONDecoder().decode(VisibilityRules.self, from: data) else {
            return VisibilityRules(default: .show, countries: [:])
        }
        return rules
    }()

    /// A kamera-réteg megjelenítése az adott országban (a szakaszokat nem érinti).
    func visibility(_ country: String) -> CameraVisibility {
        countries[country.uppercased()]?.mode ?? `default`
    }
}

/// A zóna sugara (`zone` mód): a pont helyett ±1 km.
nonisolated let CAMERA_ZONE_RADIUS_M = 1000.0

nonisolated struct CameraZone: Identifiable, Hashable, Sendable {
    var id: String
    var center: LatLon
    var radiusM: Double
    /// AW25 (INV-24): a zóna felirata a térképen („Ellenőrzési zóna”) – a pontos hely helyett ennyi látszik.
    var label: String
}

/// AW25 (INV-24): a `zone` mód felirata az aktuális nyelven (a webes `cameraZoneLabel`).
nonisolated func cameraZoneLabel() -> String { t(.cameraZone) }

/// AW25 (INV-24): az egyszeri ország-figyelmeztetések, amelyek most esedékesek (a webes `pendingCountryWarnings`) – a környék
/// kameráinak országaiból, a már látottak nélkül (DE). A „látott” a UserDefaults-ban (`figyelmeztetes:<ország>`, mint a weben).
nonisolated func pendingCountryWarnings(_ countries: [String], seen: (String) -> Bool, rules: VisibilityRules = .bundled) -> [(country: String, text: String)] {
    var out: [(country: String, text: String)] = []
    for c in Set(countries.map { $0.uppercased() }).sorted() {
        guard let raw = rules.countries[c]?.warning, let key = L10nKey(rawValue: raw), !seen(c) else { continue }
        out.append((c, t(key)))
    }
    return out
}

/// A megjelenítendő kamerák a láthatóság szerint: `hide` kimarad, `zone` csak zónaként (a pont nem kerül a
/// térképre), `show` pontként. A zóna középpontja 500 m-es rácsra kerekített, hogy a zónából ne lehessen a
/// pontos helyet visszaszámolni.
nonisolated func visibleCameras(_ cameras: [FixedCamera], rules: VisibilityRules = .bundled) -> (points: [FixedCamera], zones: [CameraZone]) {
    var points: [FixedCamera] = []
    var zones: [String: CameraZone] = [:]
    var order: [String] = []
    for c in cameras {
        switch rules.visibility(c.country) {
        case .show:
            points.append(c)
        case .zone:
            let center = snap(LatLon(lat: c.lat, lon: c.lon), 500)
            let id = "zone-\(String(format: "%.4f", center.lat))-\(String(format: "%.4f", center.lon))"
            if zones[id] == nil { order.append(id) }
            zones[id] = CameraZone(id: id, center: center, radiusM: CAMERA_ZONE_RADIUS_M, label: cameraZoneLabel())
        case .hide:
            break
        }
    }
    return (points, order.map { zones[$0]! })
}

nonisolated private func snap(_ p: LatLon, _ stepM: Double) -> LatLon {
    let dLat = stepM / 111_195
    let lat = jsRound(p.lat / dLat) * dLat
    // a hosszúsági lépés a kerekített szélességből – így a szomszédos pontok ugyanarra a rácsra esnek
    let dLon = stepM / (111_195 * cos(lat * Double.pi / 180))
    return LatLon(lat: lat, lon: jsRound(p.lon / dLon) * dLon)
}

// MARK: AW25b (INV-26): a közösségi „Rendőrség” és „Traffipax” bejelentés ugyanazzal az országonkénti szabállyal

/// A szabály alá eső bejelentés-típusok (a webes `ENFORCEMENT_REPORTS`).
nonisolated let ENFORCEMENT_REPORTS: [ReportType] = [.rendorseg, .traffipax]
nonisolated func isEnforcementReport(_ type: ReportType) -> Bool { ENFORCEMENT_REPORTS.contains(type) }

/// A nem alapértelmezett szabályú országok határa (az appba csomagolt packages/data/country_borders.json, Natural Earth).
nonisolated struct CountryBorders: Sendable {
    struct Polygon: Sendable {
        var country: String
        var west: Double, east: Double, south: Double, north: Double
        /// [lon, lat] gyűrűk: az első a külső, a többi lyuk.
        var rings: [[[Double]]]
    }

    var polygons: [Polygon]

    init(json: Data) {
        struct File: Decodable { var countries: [String: [[[[Double]]]]] }
        let file = (try? JSONDecoder().decode(File.self, from: json))?.countries ?? [:]
        polygons = file.keys.sorted().flatMap { country in
            file[country]!.map { rings in
                let outer = rings[0]
                return Polygon(
                    country: country, west: outer.map { $0[0] }.min()!, east: outer.map { $0[0] }.max()!,
                    south: outer.map { $0[1] }.min()!, north: outer.map { $0[1] }.max()!, rings: rings
                )
            }
        }
    }

    static let bundled: CountryBorders = {
        guard let url = Bundle.main.url(forResource: "country_borders", withExtension: "json"), let data = try? Data(contentsOf: url) else {
            return CountryBorders(json: Data())
        }
        return CountryBorders(json: data)
    }()
}

nonisolated private func inRing(_ ring: [[Double]], _ lon: Double, _ lat: Double) -> Bool {
    var inside = false
    var j = ring.count - 1
    for i in 0..<ring.count {
        let xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
        if (yi > lat) != (yj > lat), lon < (xj - xi) * (lat - yi) / (yj - yi) + xi { inside.toggle() }
        j = i
    }
    return inside
}

/// A pont országa, ha az a nem alapértelmezett szabályú országok egyike (DE, FR, CH); különben `nil` (a webes `restrictedCountryAt`).
nonisolated func restrictedCountryAt(_ p: LatLon, borders: CountryBorders = .bundled) -> String? {
    for b in borders.polygons where p.lon >= b.west && p.lon <= b.east && p.lat >= b.south && p.lat <= b.north {
        if inRing(b.rings[0], p.lon, p.lat), !b.rings.dropFirst().contains(where: { inRing($0, p.lon, p.lat) }) { return b.country }
    }
    return nil
}

/// A megjelenítendő bejelentések a kamerák szabálya szerint (a webes `visibleReports`): CH kimarad, FR csak „Ellenőrzési zóna”
/// (pont, kártya, közeledés-jelzés és útvonal-panel nélkül), DE és a többi pontként; a `countries` az egyszeri figyelmeztetéshez.
nonisolated func visibleReports(_ reports: [ActiveReport], rules: VisibilityRules = .bundled) -> (points: [ActiveReport], zones: [CameraZone], countries: [String]) {
    var points: [ActiveReport] = []
    var zones: [String: CameraZone] = [:]
    var order: [String] = []
    var countries = Set<String>()
    for r in reports {
        let country = isEnforcementReport(r.type) ? restrictedCountryAt(LatLon(lat: r.lat, lon: r.lon)) : nil
        switch country.map({ rules.visibility($0) }) ?? .show {
        case .show:
            points.append(r)
            if let country { countries.insert(country) }
        case .zone:
            let center = snap(LatLon(lat: r.lat, lon: r.lon), 500)
            let id = "zone-\(String(format: "%.4f", center.lat))-\(String(format: "%.4f", center.lon))"
            if zones[id] == nil { order.append(id) }
            zones[id] = CameraZone(id: id, center: center, radiusM: CAMERA_ZONE_RADIUS_M, label: cameraZoneLabel())
        case .hide:
            break
        }
    }
    return (points, order.map { zones[$0]! }, countries.sorted())
}

/// Két zóna-lista egyesítése (kamera + bejelentés): az azonos rács-cellájú zóna egyszer (a webes `mergeZones`).
nonisolated func mergeZones(_ a: [CameraZone], _ b: [CameraZone]) -> [CameraZone] {
    let seen = Set(a.map(\.id))
    return a + b.filter { !seen.contains($0.id) }
}
