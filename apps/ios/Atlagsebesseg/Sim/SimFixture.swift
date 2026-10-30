import AtlagsebessegCore
import CoreLocation
import Foundation

// Szimulátor-mód (a szimulátor feliratai a CLAUDE.md szerint kivételek a szótár-szabály alól).

/// A webes `/?sim` forgatókönyvei és a `/?navsim` vezetés (Resources/Sim/*.json, `npm run generate -w @atlagsebesseg/ios`).
nonisolated enum SimScenario: String, CaseIterable, Identifiable, Sendable {
    case jo, tul, lassit, alagut, tervezett, zona, navsim

    var id: String { rawValue }
    var file: String { self == .navsim ? "navsim-budapest-gyor" : "sim-\(rawValue)" }
}

nonisolated struct SimFixture: Decodable, Sendable {
    struct Sample: Sendable {
        var lat: Double
        var lon: Double
        /// ms, a vezetés kezdetétől (t0 = 0)
        var t: Double
        var speed: Double?
        var accuracy: Double?
        var heading: Double?
        var dropped: Bool
    }

    /// Tervezett mérés a `planned_checks` sor alakjában, az érvényesség a lejátszás kezdetéhez képest (ms).
    struct Planned: Decodable, Sendable {
        var id: String
        var country: String
        var county: String
        var settlement: String?
        var road_ref: String?
        var description: String
        var geometry: PlannedCheckRow.Geometry
        var speed_limit_kmh: Double
        var limit_source: PlannedLimitSource
        var valid_from_offset_ms: Double
        var valid_to_offset_ms: Double
        var time_window: String?
        var source_url: String

        /// A lejátszás kezdetéhez (`t0`, Unix ms) tolva.
        func check(at t0: Double) -> PlannedCheck {
            let ring = { (l: [[Double]]) in l.map { LatLon(lat: $0[1], lon: $0[0]) } }
            return PlannedCheck(
                id: id, country: country, county: county, settlement: settlement, roadRef: road_ref, description: description,
                lines: geometry.lines.map(ring), zones: geometry.zones.map { $0.map(ring) }, speedLimitKmh: speed_limit_kmh,
                limitSource: limit_source, validFrom: t0 + valid_from_offset_ms, validTo: t0 + valid_to_offset_ms, timeWindow: time_window,
                sourceUrl: source_url
            )
        }
    }

    /// Minta-bejelentés (AOS14, a webes `simReports`): a létrehozás ideje a lejátszás kezdetéhez képest (ms).
    struct Report: Decodable, Sendable {
        var id: String
        var type: ReportType
        var gate_kind: String?
        var lat: Double
        var lon: Double
        var heading_deg: Double?
        var created_offset_ms: Double
        var ttl_ms: Double

        /// A lejátszás kezdetéhez (`t0`, Unix ms) tolva.
        func report(at t0: Double) -> ActiveReport {
            ActiveReport(
                id: id, type: type, gateKind: gate_kind, lat: lat, lon: lon, headingDeg: heading_deg,
                createdAt: t0 + created_offset_ms, expiresAt: t0 + created_offset_ms + ttl_ms
            )
        }
    }

    /// A navigációs szimulátor adatai (csak a `navsim`-ben, A11).
    struct Nav: Decodable, Sendable {
        struct Detour: Decodable, Sendable {
            var points: [LatLon]
            var fromAlongM: Double
            var rejoinAlongM: Double
        }

        /// Indulás előtt itt áll az autó (a webes `SIM_FROM`).
        var from: LatLon
        /// A helyi „keresés” találatai (a webes `SIM_PLACES`).
        var places: [Place]
        /// A letérés mellékútja (az újratervezés innen számol).
        var detour: Detour
        /// Az ablakok (indulás + letérés, szakasz + kamera, érkezés) kezdő mintaindexei.
        var windows: [Int]
        /// A mért szakasz végkapuja a fő útvonal mentén (m) – a kapu utáni lehajtóhoz (AOS12).
        var sectionEndM: Double
        /// A szimulált gyorsabb út kategóriánként (a webes `SIM_ALTS`): nyereség (s) és többlet-táv (m).
        var alts: [String: Alt]
        /// A kapu utáni lehajtó ennyivel a végkapu után (m; a webes `SIM_EXIT_AFTER_GATE_M`).
        var exitAfterGateM: Double

        struct Alt: Decodable, Sendable {
            var gainS: Double
            var extraM: Double
        }
    }

    let id: String
    let label: String
    let leadInM: Double
    let nav: Nav?
    let sections: [Section]
    let cameras: [CameraRow]
    let planned: [Planned]
    let reports: [Report]
    let samples: [Sample]

    private enum CodingKeys: String, CodingKey {
        case id, label, leadInM, sections, cameras, planned, reports, samples, nav
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        leadInM = try c.decode(Double.self, forKey: .leadInM)
        sections = try c.decode([Section].self, forKey: .sections)
        cameras = try c.decode([CameraRow].self, forKey: .cameras)
        planned = try c.decodeIfPresent([Planned].self, forKey: .planned) ?? []
        reports = try c.decodeIfPresent([Report].self, forKey: .reports) ?? []
        nav = try c.decodeIfPresent(Nav.self, forKey: .nav)
        // soronként: [lat, lon, timestamp, speed, accuracy, heading, s, dropped]
        samples = try c.decode([[Double?]].self, forKey: .samples).map { r in
            Sample(lat: r[0]!, lon: r[1]!, t: r[2]!, speed: r[3], accuracy: r[4], heading: r[5], dropped: r[7] == 1)
        }
    }

    static func load(_ scenario: SimScenario, bundle: Bundle = .main) throws -> SimFixture {
        guard let url = bundle.url(forResource: scenario.file, withExtension: "json") else { throw CocoaError(.fileNoSuchFile) }
        return try JSONDecoder().decode(SimFixture.self, from: Data(contentsOf: url))
    }
}

/// CoreLocation-mock: a felvett vezetést `CLLocation`-ökként játssza le (másodpercenként egy, gyorsítható),
/// így a mérés ugyanazon az úton kapja, mint a valódi GPS-ből. Az óra a lejátszás ideje.
final class SimLocationSource: LocationSource {
    var onLocation: ((CLLocation) -> Void)?
    var onGap: (() -> Void)?
    var onStatus: ((GeoStatus) -> Void)?
    /// Lejátszási állapot (a vezérlőpanelnek).
    var onProgress: ((Double) -> Void)?

    let fixture: SimFixture
    private(set) var speed: Double
    private var index = 0
    private var offsetMs: Double = 0
    private var timer: Timer?
    private var seek: Double
    /// Az ablakok kezdő mintaindexei (navsim): az ugrás a cél előtti utolsó ablak elejéről játszik le, mint a weben.
    private let windows: [Int]
    private(set) var clockMs: Double = Date().timeIntervalSince1970 * 1000
    /// A lejátszás kezdete (Unix ms) – ehhez tolódnak a fixtúra időpontjai.
    private(set) var startMs: Double = Date().timeIntervalSince1970 * 1000
    /// Igaz, amíg a `seek` a kezdőpontig azonnal lejátssza a mintákat (ilyenkor nem szól jelzés).
    private(set) var seeking = false

    init(_ fixture: SimFixture, speed: Double = 4, seek: Double = 0, windows: [Int] = []) {
        self.fixture = fixture
        self.speed = speed
        self.seek = min(1, max(0, seek))
        self.windows = windows
    }

    /// Indulás előtt: egyetlen álló fix a megadott helyen (a webes `simIdleFix`), lejátszás nélkül.
    func hold(at p: LatLon) {
        clockMs = Date().timeIntervalSince1970 * 1000
        onStatus?(.sim)
        onLocation?(CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lon), altitude: 0, horizontalAccuracy: 5, verticalAccuracy: -1,
            course: -1, courseAccuracy: -1, speed: 0, speedAccuracy: 0.5, timestamp: Date(timeIntervalSince1970: clockMs / 1000)
        ))
    }

    var progress: Double { fixture.samples.isEmpty ? 0 : Double(index) / Double(fixture.samples.count) }
    var playing: Bool { timer != nil }

    func start() {
        index = 0
        offsetMs = (Date().timeIntervalSince1970 * 1000).rounded()
        startMs = offsetMs
        clockMs = offsetMs
        onStatus?(.sim)
        // ugrás a `seek` hányadig (egy adott állapot azonnali megnézéséhez, mint a webes `?seek=`)
        let until = Int((seek * Double(fixture.samples.count)).rounded(.down))
        index = windows.last { $0 <= until } ?? 0
        // az óra az ugrás kezdőmintájához igazodik (a lejátszás ideje a mostani pillanattól folytatódik)
        if index > 0 { offsetMs -= fixture.samples[index].t }
        startMs = offsetMs
        seek = 0
        seeking = true
        while index < until { emit() }
        seeking = false
        play()
    }

    func play() {
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1 / speed, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.step() }
        }
    }

    func pause() {
        timer?.invalidate()
        timer = nil
        onProgress?(progress)
    }

    func setSpeed(_ v: Double) {
        speed = v
        if playing { play() }
    }

    func stop() {
        pause()
        onStatus?(.off)
    }

    private func step() {
        guard index < fixture.samples.count else {
            pause()
            return
        }
        emit()
    }

    private func emit() {
        let s = fixture.samples[index]
        index += 1
        clockMs = offsetMs + s.t
        if s.dropped {
            onGap?()
        } else {
            onLocation?(CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: s.lat, longitude: s.lon),
                altitude: 0,
                horizontalAccuracy: s.accuracy ?? -1,
                verticalAccuracy: -1,
                course: s.heading ?? -1,
                courseAccuracy: s.heading == nil ? -1 : 5,
                speed: s.speed ?? -1,
                speedAccuracy: s.speed == nil ? -1 : 0.5,
                timestamp: Date(timeIntervalSince1970: clockMs / 1000)
            ))
        }
        onProgress?(progress)
    }
}
