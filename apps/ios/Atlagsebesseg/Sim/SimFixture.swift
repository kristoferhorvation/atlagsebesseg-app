import AtlagsebessegCore
import CoreLocation
import Foundation

// Szimulátor-mód (a szimulátor feliratai a CLAUDE.md szerint kivételek a szótár-szabály alól).

/// A webes `/?sim` forgatókönyvei és a `/?navsim` vezetés (Resources/Sim/*.json, `npm run generate -w @atlagsebesseg/ios`).
nonisolated enum SimScenario: String, CaseIterable, Identifiable, Sendable {
    case jo, tul, lassit, alagut, navsim

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

    let id: String
    let label: String
    let leadInM: Double
    let sections: [Section]
    let cameras: [CameraRow]
    let samples: [Sample]

    private enum CodingKeys: String, CodingKey {
        case id, label, leadInM, sections, cameras, samples
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decode(String.self, forKey: .label)
        leadInM = try c.decode(Double.self, forKey: .leadInM)
        sections = try c.decode([Section].self, forKey: .sections)
        cameras = try c.decode([CameraRow].self, forKey: .cameras)
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
    private(set) var clockMs: Double = Date().timeIntervalSince1970 * 1000

    init(_ fixture: SimFixture, speed: Double = 4, seek: Double = 0) {
        self.fixture = fixture
        self.speed = speed
        self.seek = min(1, max(0, seek))
    }

    var progress: Double { fixture.samples.isEmpty ? 0 : Double(index) / Double(fixture.samples.count) }
    var playing: Bool { timer != nil }

    func start() {
        index = 0
        offsetMs = (Date().timeIntervalSince1970 * 1000).rounded()
        clockMs = offsetMs
        onStatus?(.sim)
        // ugrás a `seek` hányadig (egy adott állapot azonnali megnézéséhez, mint a webes `?seek=`)
        let until = Int((seek * Double(fixture.samples.count)).rounded(.down))
        seek = 0
        while index < until { emit() }
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
