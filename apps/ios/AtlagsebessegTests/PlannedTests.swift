import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// packages/app-logic/test/planned.test.ts – az iOS-re portolt részek (A10). A tűrés a webbel közös (PLANNED_MATCH_M, generált).

private let proj = LocalProjection(LatLon(lat: 47.2, lon: 18.4))
private func at(_ x: Double, _ y: Double) -> LatLon { proj.fromXY(XY(x: x, y: y)) }
private func fix(_ x: Double, _ y: Double, t: Double = 0) -> GpsFix {
    let p = at(x, y)
    return GpsFix(lat: p.lat, lon: p.lon, timestamp: t, speed: 20, accuracy: 5, heading: 90)
}

// 2026-10-27 (kedd) 00:00 – 2026-11-01 (vasárnap) 23:59:59, budapesti idő
private let FROM = parseTimestampMs("2026-10-26T23:00:00Z")!
private let TO = parseTimestampMs("2026-11-01T22:59:59Z")!
private let NOW = parseTimestampMs("2026-10-28T10:00:00Z")!

private func check(_ edit: (inout PlannedCheck) -> Void = { _ in }) -> PlannedCheck {
    var c = PlannedCheck(
        id: "pc-1", country: "HU", county: "Fejér", settlement: "Székesfehérvár", roadRef: "7", description: "Székesfehérvár 7-es főút",
        lines: [[at(0, 0), at(1000, 0), at(2000, 0)]], zones: [], speedLimitKmh: 90, limitSource: .osm, validFrom: FROM, validTo: TO,
        timeWindow: nil, sourceUrl: "https://www.police.hu/"
    )
    edit(&c)
    return c
}

private func square(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double) -> [LatLon] {
    [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]
}

/// Székesfehérvár „határa”: 4 × 4 km-es négyzet, közepén 1 × 1 km-es lyuk.
private func zone(_ edit: (inout PlannedCheck) -> Void = { _ in }) -> PlannedCheck {
    check {
        $0.roadRef = nil
        $0.lines = []
        $0.zones = [[square(0, -2000, 4000, 2000), square(1500, -500, 2500, 500)]]
        $0.description = "Székesfehérvár"
        edit(&$0)
    }
}

@Suite("tervezett mérés – a vonalon haladás (100 m tűrés)")
struct PlannedLineTests {
    @Test("a vonalon / 100 m-en belül igen, azon túl és a végeken túl nem")
    func vonal() {
        let r = plannedRoutes(check())
        #expect(PLANNED_MATCH_M == 100)
        // a navigáció útvonal-elemzésének külön tűrése (a webes navigációé; generált)
        #expect(ROUTE_MATCH_M == 40)
        #expect(onPlannedLine(at(500, 0), routes: r))
        #expect(onPlannedLine(at(500, 60), routes: r))
        #expect(onPlannedLine(at(500, 95), routes: r))
        #expect(!onPlannedLine(at(500, 130), routes: r))
        #expect(!onPlannedLine(at(2300, 0), routes: r))
        #expect(!onPlannedLine(at(-300, 0), routes: r))
    }

    @Test("a sáv a vonalra érve megjelenik, letéréskor (2 fix) eltűnik; egy kiugró fix nem tünteti el")
    func sav() {
        let w = PlannedCheckWatch()
        let c = [check()]
        #expect(w.update(fix(-500, 0), c, now: NOW) == nil)
        #expect(w.update(fix(100, 0), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(600, 180), c, now: NOW)?.id == "pc-1") // egy kiugró pont
        #expect(w.update(fix(900, 0), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(1200, 200), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(1300, 400), c, now: NOW) == nil) // letért
    }

    @Test("lejárt vagy még nem érvényes mérésnél nincs sáv (csak aktuális dátummal)")
    func datum() {
        let w = PlannedCheckWatch()
        #expect(w.update(fix(100, 0), [check { $0.validTo = NOW - 1 }], now: NOW) == nil)
        #expect(w.update(fix(100, 0), [check { $0.validFrom = NOW + 3_600_000 }], now: NOW) == nil)
        #expect(plannedCheckActive(check(), now: NOW))
        #expect(!plannedCheckActive(check(), now: TO))
    }

    @Test("több vonal (osztott pálya): bármelyiken")
    func tobbVonal() {
        let c = check { $0.lines = [[at(0, 15), at(2000, 15)], [at(2000, -15), at(0, -15)]] }
        #expect(onPlannedLine(at(800, -15), routes: plannedRoutes(c)))
    }

    @Test("Svájcban (hide) a tervezett mérés sem látszik")
    func svajc() {
        #expect(!plannedCheckActive(check { $0.country = "CH" }, now: NOW))
    }
}

@Suite("zóna-típusú tervezett mérés (csak települést adó közlemény)")
struct PlannedZoneTests {
    @Test("a határon belül igen, kívül és a lyukban nem")
    func hatar() {
        let c = zone()
        #expect(c.isZone)
        #expect(inPlannedZone(at(500, 0), c))
        #expect(inPlannedZone(at(3500, 1800), c))
        #expect(!inPlannedZone(at(5000, 0), c))
        #expect(!inPlannedZone(at(2000, 0), c)) // lyuk
        #expect(!onPlannedLine(at(500, 0), routes: plannedRoutes(c))) // vonalnak nem számít
    }

    @Test("a sáv a településre érve megjelenik, bent maradva nem tűnik el (egy kiugró fix sem), kilépve igen")
    func sav() {
        let w = PlannedCheckWatch()
        let c = [zone()]
        #expect(w.update(fix(-300, 0), c, now: NOW) == nil)
        #expect(w.update(fix(100, 0), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(3000, 1500), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(6000, 0), c, now: NOW)?.id == "pc-1") // egy kiugró pont
        #expect(w.update(fix(3500, 100), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(6000, 0), c, now: NOW)?.id == "pc-1")
        #expect(w.update(fix(6100, 0), c, now: NOW) == nil) // kilépett
    }

    @Test("lejárt zónánál nincs sáv (csak aktuális dátumra látszik)")
    func lejart() {
        let w = PlannedCheckWatch()
        #expect(w.update(fix(100, 0), [zone { $0.validTo = NOW - 1 }], now: NOW) == nil)
        #expect(w.update(fix(100, 0), [zone { $0.validFrom = NOW + 3_600_000 }], now: NOW) == nil)
    }

    @Test("vonal és zóna egyszerre: a vonal (pontosabb hely) az erősebb, a vonalról lelépve a zóna marad")
    func vonalEsZona() {
        let w = PlannedCheckWatch()
        let z = zone { $0.id = "zone-1" }
        let l = check {
            $0.id = "line-1"
            $0.lines = [[at(0, 0), at(1000, 0)]]
        }
        #expect(w.update(fix(100, 0), [z, l], now: NOW)?.id == "line-1")
        #expect(w.update(fix(100, 400), [z, l], now: NOW)?.id == "zone-1")
    }

    @Test("a zóna-sor szövege: település, dátum, forrás (a szótárból)")
    func szoveg() {
        #expect(plannedZoneText(zone(), lang: .hu) == "Rendőrségi mérés Székesfehérvár területén · okt 27–nov 1 · forrás: police.hu")
        #expect(plannedBandText(zone(), lang: .hu) == plannedZoneText(zone(), lang: .hu))
    }

    @Test("sorból (Polygon és MultiPolygon, lyukkal)")
    func sorbol() throws {
        func row(_ geometry: String) throws -> PlannedCheck {
            let json = """
            {"id":"z","country":"HU","county":"Fejér","settlement":"Székesfehérvár","road_ref":null,"description":"Székesfehérvár",
             "geometry":\(geometry),"speed_limit_kmh":50,"limit_source":"kresz_default","valid_from":"2026-10-26T23:00:00+00:00",
             "valid_to":"2026-11-01T22:59:59.5+00:00","time_window":null,"source_url":"https://www.police.hu/"}
            """
            return try #require(try JSONDecoder().decode(PlannedCheckRow.self, from: Data(json.utf8)).check)
        }
        let ring = "[[18.4,47.1],[18.5,47.1],[18.5,47.2],[18.4,47.2],[18.4,47.1]]"
        let hole = "[[18.44,47.14],[18.46,47.14],[18.46,47.16],[18.44,47.16],[18.44,47.14]]"
        let one = try row(#"{"type":"Polygon","coordinates":[\#(ring),\#(hole)]}"#)
        #expect(one.lines.isEmpty)
        #expect(one.zones.count == 1)
        #expect(one.zones[0].count == 2)
        #expect(one.zones[0][0][0] == LatLon(lat: 47.1, lon: 18.4))
        #expect(one.validFrom == FROM)
        #expect(one.validTo == TO + 500)
        #expect(one.limitSource == .kresz)
        #expect(inPlannedZone(LatLon(lat: 47.12, lon: 18.41), one))
        #expect(!inPlannedZone(LatLon(lat: 47.15, lon: 18.45), one))
        let two = try row(#"{"type":"MultiPolygon","coordinates":[[\#(ring)],[\#(hole)]]}"#)
        #expect(two.zones.count == 2)
    }
}

@Suite("a tervezett-mérés sáv szövege")
struct PlannedTextTests {
    @Test("„Tervezett rendőrségi mérés · okt 27–nov 1 · max 90”")
    func alap() {
        #expect(plannedBandText(check(), lang: .hu) == "Tervezett rendőrségi mérés · okt 27–nov 1 · max 90")
        #expect(plannedBandText(check(), lang: .en) == "Planned police check · Oct 27–Nov 1 · max 90")
    }

    @Test("KRESZ-alapértéknél „max ~90”; időszakkal")
    func kresz() {
        let c = check {
            $0.limitSource = .kresz
            $0.timeWindow = "ápr 15. 6:00 – ápr 16. 6:00"
        }
        #expect(plannedBandText(c, lang: .hu) == "Tervezett rendőrségi mérés · okt 27–nov 1 · max ~90 · ápr 15. 6:00 – ápr 16. 6:00")
    }

    @Test("egy hónapon belül: „ápr 15–19”; nyári és téli idő (Budapest)")
    func honapon() {
        let c = check {
            $0.validFrom = parseTimestampMs("2026-04-15T04:00:00Z")!
            $0.validTo = parseTimestampMs("2026-04-19T21:59:59Z")!
        }
        #expect(plannedDateRange(c, lang: .hu) == "ápr 15–19")
        // 2026-03-29 01:00 UTC: átállás nyári időre; 2026-10-25 01:00 UTC: vissza
        #expect(budapestOffsetH(parseTimestampMs("2026-03-29T00:59:00Z")!) == 1)
        #expect(budapestOffsetH(parseTimestampMs("2026-03-29T01:00:00Z")!) == 2)
        #expect(budapestOffsetH(parseTimestampMs("2026-10-25T00:59:00Z")!) == 2)
        #expect(budapestOffsetH(parseTimestampMs("2026-10-25T01:00:00Z")!) == 1)
    }

    @Test("sorból (LineString és MultiLineString)")
    func sorbol() throws {
        func row(_ geometry: String) throws -> PlannedCheck {
            let json = """
            {"id":"x","country":"HU","county":"Pest","settlement":"Budaörs","road_ref":"M1","description":"Budaörs, M1 autópálya",
             "geometry":\(geometry),"speed_limit_kmh":130,"limit_source":"osm","valid_from":"2026-10-26T23:00:00Z",
             "valid_to":"2026-11-01T22:59:59Z","time_window":null,"source_url":"https://www.police.hu/"}
            """
            return try #require(try JSONDecoder().decode(PlannedCheckRow.self, from: Data(json.utf8)).check)
        }
        let one = try row(#"{"type":"LineString","coordinates":[[18.9,47.4],[18.91,47.41]]}"#)
        #expect(one.lines == [[LatLon(lat: 47.4, lon: 18.9), LatLon(lat: 47.41, lon: 18.91)]])
        let two = try row(#"{"type":"MultiLineString","coordinates":[[[18.9,47.4],[18.91,47.41]],[[18.91,47.41],[18.9,47.4]]]}"#)
        #expect(two.lines.count == 2)
    }

    @Test("a kamera-kártya: irány a haladáshoz képest, távolság, út és limit (AOS15)")
    func kameraKartya() {
        #expect(cameraDirection(nil, 90) == .any)
        #expect(cameraDirection(80, nil) == .one)
        #expect(cameraDirection(80, 90) == .ours)
        #expect(cameraDirection(0, 90) == .ours) // 90° még a miénk
        #expect(cameraDirection(350, 90) == .other)
        #expect(cameraDirection(270, 90) == .other)
        let cam = LatLon(lat: 47.5, lon: 19.0)
        // ~1,2 km-re északra
        let f = GpsFix(lat: 47.5 - 1200 / 111_195, lon: 19.0, timestamp: 0, speed: 20, accuracy: 5, heading: 90)
        #expect(cameraCardMeta(headingDeg: 270, at: cam, fix: f, .kmh, lang: .hu) == "Az ellenirányt méri · 1,2 km távolságra")
        #expect(cameraCardMeta(headingDeg: nil, at: cam, fix: nil, .kmh, lang: .hu) == "Mindkét irányban mér")
        var still = f
        still.heading = nil
        #expect(cameraCardMeta(headingDeg: 270, at: cam, fix: still, .mph, lang: .hu) == "Egy irányban mér · 0,7 mi távolságra")
        #expect(cameraCardDetail(road: "M1", speedLimitKmh: 130, .kmh) == "M1 · 130 km/h")
        #expect(cameraCardDetail(road: "M1", speedLimitKmh: 130, .mph) == "M1 · 81 mph")
        #expect(cameraCardDetail(road: "", speedLimitKmh: nil, .kmh) == "")
    }
}
