import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// packages/app-logic/test/display.test.ts, logic.test.ts és planned.test.ts – az iOS-re portolt részek

@Suite("speedStatus")
struct SpeedStatusTests {
    @Test("jó / lassíts / túl gyors – a „határon” sáv megszűnt")
    func allapotok() {
        #expect(speedStatus(120, 125, 130) == .jo)
        #expect(speedStatus(129.9, 140, 130) == .jo) // az átlag ≤ határ: zöld
        #expect(speedStatus(130.4, 129, 130) == .lassits)
        #expect(speedStatus(138, 120, 130) == .lassits)
        #expect(speedStatus(138, 131, 130) == .tulGyors)
        #expect(speedStatus(48, 49, 50) == .jo) // nincs 3%-os sáv
        #expect(speedStatus(nil, 120, 130) == nil)
    }
}

@Suite("egységek és formázás")
struct FormatTests {
    @Test("km/h és mph")
    func egysegek() {
        #expect(speedIn(130, .kmh) == 130)
        #expect(speedIn(130, .mph) == 81)
        #expect(speedIn(nil, .kmh) == nil)
        #expect(speedFloorIn(136.5, .kmh) == 136) // a tűrés lefelé kerekül
        #expect(speedFloorIn(136.9, .kmh) == 136)
        #expect(speedFloorIn(nil, .kmh) == nil)
    }

    @Test("távolság és idő")
    func tavolsagIdo() {
        #expect(formatDistance(843, .kmh, lang: .hu) == ("840", "m"))
        #expect(formatDistance(12_345, .kmh, lang: .hu) == ("12,3", "km"))
        #expect(formatDistance(16_093, .mph, lang: .hu) == ("10,0", "mi"))
        #expect(formatDistance(12_345, .kmh, lang: .en) == ("12.3", "km"))
        #expect(formatDuration(65_000) == "1:05")
        #expect(formatDuration(3_725_000) == "1:02:05")
        #expect(progressOf(5, 10) == 0.5)
        #expect(progressOf(15, 10) == 1)
    }
}

@Suite("beállítások")
struct SettingsTests {
    @Test("hibás vagy hiányzó érték helyett alapértelmezés")
    func alapertelmezes() {
        #expect(Settings.parse(nil) == .default)
        #expect(Settings.parse("{rossz") == .default)
        var expected = Settings.default
        expected.hatosagiTuresMegjelenitese = true
        #expect(Settings.parse(#"{"egyseg":"furlong","hatosagi_tures_megjelenitese":true}"#) == expected)
    }

    @Test("a térkép alapból színes; a visszafogott megmarad, ismeretlen érték színes")
    func terkep() {
        #expect(Settings.default.terkep == .szines)
        #expect(Settings.parse(#"{"terkep":"visszafogott"}"#).terkep == .visszafogott)
        #expect(Settings.parse(#"{"terkep":"monochrome"}"#).terkep == .szines)
    }

    @Test("oda-vissza: a mentett alak a webes kulcsokkal visszaolvasható")
    func odaVissza() {
        var s = Settings.default
        s.egyseg = .mph
        s.terkep = .visszafogott
        #expect(Settings.parse(s.serialized()) == s)
        #expect(s.serialized().contains(#""hatosagi_tures_megjelenitese":false"#))
    }
}

@Suite("sectionSourceLabel")
struct SourceLabelTests {
    @Test("hivatalos forrás névvel és dátummal; különben a forrás típusa")
    func forras() {
        let base = Section(
            id: "x", country: "IT", road: "A1", direction: "", start: LatLon(lat: 0, lon: 0), end: LatLon(lat: 0, lon: 1),
            lengthM: 1000, speedLimitKmh: 130, source: .hivatalos, verified: true
        )
        var named = base
        named.provenance = SectionProvenance(name: "Polizia di Stato", url: "https://www.poliziadistato.it/", date: "2026-08", locatedBy: .kmSzelveny)
        #expect(sectionSourceLabel(named, lang: .hu) == "Forrás: Polizia di Stato, 2026-08")
        var osm = base
        osm.source = .osm
        #expect(sectionSourceLabel(osm, lang: .hu) == "Forrás: OpenStreetMap")
        var community = base
        community.source = .kozosseg
        #expect(sectionSourceLabel(community, lang: .hu) == "Forrás: közösségi (ideiglenes kapuk)")
    }
}

@Suite("csempék")
struct TileTests {
    @Test("kulcs, befoglaló téglalap, szomszédok")
    func csempek() {
        #expect(tileKey(46.2, 11.7) == "92:23")
        #expect(tileBBox("92:23") == BBox(south: 46, west: 11.5, north: 46.5, east: 12))
        #expect(tilesAround(46.2, 11.7).count == 9)
        #expect(tilesAround(-0.1, -0.1, radius: 0) == ["-1:-1"])
    }

    @Test("cache: első betöltés hálózatról, utána cache-ből; hálózat nélkül a lejárt cache")
    func cache() async {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tiles-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let clock = TestClock()
        let net = Network()
        let cache = TileCache<FixedCamera>(store: FileStore(directory: dir), prefix: "t", ttlMs: 1000, radius: 0, now: { clock.t }) { b in
            try net.fetch(b)
        }
        let first = await cache.loadItems(47.1, 18.1)
        #expect(first.fromNetwork == 1)
        #expect(first.items.map(\.id) == ["cam-1"])
        let second = await cache.loadItems(47.1, 18.1)
        #expect(second.fromCache == 1)
        clock.t = 5000
        net.online = false
        let offline = await cache.loadItems(47.1, 18.1)
        #expect(offline.stale)
        #expect(offline.items.map(\.id) == ["cam-1"])
    }
}

private final class TestClock {
    var t: Double = 0
}

private final class Network {
    var online = true

    func fetch(_ b: BBox) throws -> [FixedCamera] {
        guard online else { throw URLError(.notConnectedToInternet) }
        return [FixedCamera(id: "cam-1", country: "HU", type: .speed, lat: b.south + 0.1, lon: b.west + 0.1, headingDeg: nil, road: "", speedLimitKmh: nil,
                            source: "OSM", sourceUrl: "", sourceDate: "2026-10-28", verified: false)]
    }
}

@Suite("chooseLightPreset")
struct LightPresetTests {
    @Test("világos mód: a napszak dönt")
    func vilagos() {
        #expect(chooseLightPreset(.nappal, dark: false) == .day)
        #expect(chooseLightPreset(.hajnal, dark: false) == .dawn)
        #expect(chooseLightPreset(.alkony, dark: false) == .dusk)
        #expect(chooseLightPreset(.ejszaka, dark: false) == .night)
    }

    @Test("sötét mód: sosem világos")
    func sotet() {
        #expect(chooseLightPreset(.nappal, dark: true) == .dusk)
        #expect(chooseLightPreset(.hajnal, dark: true) == .night)
        #expect(chooseLightPreset(.ejszaka, dark: true) == .night)
    }

    @Test("helyzet nélkül a rendszer módja")
    func helyzetNelkul() {
        #expect(chooseLightPreset(nil, dark: true) == .night)
        #expect(chooseLightPreset(nil, dark: false) == .day)
    }
}

@Suite("jogi láthatóság (camera_visibility.json)")
struct VisibilityTests {
    private func cam(_ id: String, _ country: String, _ lat: Double = 47.1, _ lon: Double = 18.1) -> FixedCamera {
        FixedCamera(id: id, country: country, type: .speed, lat: lat, lon: lon, headingDeg: nil, road: "", speedLimitKmh: nil,
                    source: "OpenStreetMap", sourceUrl: "https://www.openstreetmap.org/node/1", sourceDate: "2026-10-28", verified: false)
    }

    @Test("induló értékek (az appba csomagolt, a webbel közös fájlból)")
    func indulo() {
        let rules = VisibilityRules.bundled
        for c in ["HU", "AT", "IT", "PL", "ES", "NL", "GB", "DE"] { #expect(rules.visibility(c) == .show) }
        #expect(rules.visibility("FR") == .zone)
        #expect(rules.visibility("CH") == .hide)
        #expect(rules.visibility("SK") == .show)
        #expect(rules.countries["DE"]?.warning == "warn.camera.DE")
    }

    @Test("show → pont, zone → ±1 km zóna pont nélkül (rácsra kerekítve), hide → semmi")
    func modok() {
        let v = visibleCameras([cam("a", "HU"), cam("b", "FR", 48.85123, 2.35123), cam("c", "CH"), cam("d", "FR", 48.85124, 2.35124)])
        #expect(v.points.map(\.id) == ["a"])
        #expect(v.zones.count == 1) // két közeli francia kamera egy zóna
        #expect(v.zones[0].radiusM == 1000)
        #expect(v.zones[0].center.lat != 48.85123)
    }
}

@Suite("beépített adat")
struct BundledDataTests {
    @Test("a packages/data/output szakaszai és kamerái az appban vannak (mind, egy sem hullik ki dekódoláskor)")
    func beepitett() throws {
        struct Count: Decodable { let sections: [Ignored]?; let cameras: [Ignored]? }
        struct Ignored: Decodable {}
        let dir = Repo.root.appendingPathComponent("packages/data/output")
        let count = { (name: String) throws -> Count in try JSONDecoder().decode(Count.self, from: Data(contentsOf: dir.appendingPathComponent(name))) }
        let sections = try ["PL", "IT", "FR", "ES", "NL", "AT", "HU"].map { try count("sections.\($0).json").sections?.count ?? 0 }.reduce(0, +)
        #expect(sections > 100)
        #expect(BundledData.sections.count == sections)
        #expect(BundledData.cameras.count == (try count("cameras.HU.json").cameras?.count ?? -1))
    }
}
