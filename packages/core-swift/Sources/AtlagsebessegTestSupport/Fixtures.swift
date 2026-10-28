import AtlagsebessegCore
import Foundation

/// A közös tesztfixtúrák (packages/core/fixtures) betöltője – ugyanazok a fájlok, amiket a TS-tesztek
/// olvasnak. A mappát a forrásfájl helyéből számoljuk, így a macOS-es `swift test` és az iOS-szimulátoron
/// futó `xcodebuild test` is a repó fájljait olvassa (a szimulátor eléri a gazdagép fájlrendszerét).
public enum Fixtures {
    public static let directory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // AtlagsebessegTestSupport
        .deletingLastPathComponent() // Sources
        .deletingLastPathComponent() // core-swift
        .deletingLastPathComponent() // packages
        .appendingPathComponent("core/fixtures")

    public struct SectionsFixture: Decodable, Sendable {
        public let origin: LatLon
        public let leadInM: Double
        public let course: Section
        public let second: Section
        public let straight: Section
        /// Egy távoli kezdőpont (50 km keletre) a setSections-teszt „MASIK” szakaszához.
        public let farStart: LatLon
    }

    public struct RouteFixture: Decodable, Sendable {
        /// A szakasz 120 m-rel jobbra eltolva, minden 10. pont (5-től).
        public let parallel120: [LatLon]
        /// 1000 m egyenes észak felé, 100 m-es pontokkal.
        public let line1000: [LatLon]
        /// Hajtűkanyar: fel 1000 m, majd vissza le 30 m-rel arrébb.
        public let hairpin: [LatLon]
    }

    private struct DriveFile: Decodable {
        let samples: [[Double?]]
    }

    public static func data(_ rel: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(rel))
    }

    public static func sections() throws -> SectionsFixture {
        try JSONDecoder().decode(SectionsFixture.self, from: data("sections.json"))
    }

    public static func route() throws -> RouteFixture {
        try JSONDecoder().decode(RouteFixture.self, from: data("route.json"))
    }

    /// Egy rögzített vezetés mintái: soronként [lat, lon, timestamp, speed, accuracy, heading, s, dropped].
    public static func drive(_ name: String) throws -> [DriveSample] {
        try JSONDecoder().decode(DriveFile.self, from: data("drives/\(name).json")).samples.map { r in
            DriveSample(
                fix: GpsFix(lat: r[0]!, lon: r[1]!, timestamp: r[2]!, speed: r[3], accuracy: r[4], heading: r[5]),
                s: r[6]!,
                t: r[2]!,
                dropped: r[7] == 1
            )
        }
    }
}

/// A TS `DriveSample` megfelelője: a fix, a valódi pálya menti távolság (m) és idő (ms), kiesett-e.
public struct DriveSample: Sendable {
    public var fix: GpsFix
    public var s: Double
    public var t: Double
    public var dropped: Bool
}

/// A ki nem esett minták fixei (TS: `fixes`).
public func fixes(_ samples: [DriveSample]) -> [GpsFix] {
    samples.filter { !$0.dropped }.map(\.fix)
}

/// A pálya menti `s` távolsághoz tartozó valódi időpont interpolálva (TS: `trueTimeAt`).
public func trueTimeAt(_ samples: [DriveSample], _ s: Double) -> Double {
    for i in 1..<samples.count {
        let a = samples[i - 1]
        let b = samples[i]
        if b.s >= s { return a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t) }
    }
    preconditionFailure("s kívül esik")
}

/// A vitest `toBeCloseTo(expected, digits)` megfelelője: |a − b| < 10^−digits / 2.
public func closeTo(_ actual: Double?, _ expected: Double, _ digits: Int = 2) -> Bool {
    guard let actual else { return false }
    return abs(actual - expected) < pow(10, -Double(digits)) / 2
}
