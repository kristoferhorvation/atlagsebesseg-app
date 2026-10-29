import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// A10: kamera- és szakaszkapu-közeledés, tervezett mérés jelzése, beállítás-kapcsolók – hang nélkül (események).

private let proj = LocalProjection(LatLon(lat: 47.3, lon: 18.9))
private func at(_ x: Double, _ y: Double) -> LatLon { proj.fromXY(XY(x: x, y: y)) }
/// Fix kelet felé (90°) haladva, vagy a megadott iránnyal; `speed` m/s.
private func fix(_ x: Double, _ y: Double = 0, heading: Double? = 90, speed: Double? = 25) -> GpsFix {
    let p = at(x, y)
    return GpsFix(lat: p.lat, lon: p.lon, timestamp: 0, speed: speed, accuracy: 5, heading: heading)
}

private func camera(_ id: String, _ p: LatLon, heading: Double? = nil, limit: Double? = 90, country: String = "HU", type: CameraType = .speed) -> FixedCamera {
    FixedCamera(id: id, country: country, type: type, lat: p.lat, lon: p.lon, headingDeg: heading, road: "7", speedLimitKmh: limit,
                source: "OSM", sourceUrl: "", sourceDate: "2026-10-28", verified: false)
}

private func section(_ id: String, from: LatLon, to: LatLon, limit: Double = 110) -> Section {
    Section(id: id, country: "HU", road: "M1", direction: "", start: from, end: to, lengthM: haversineM(from, to), speedLimitKmh: limit,
            source: .hivatalos, verified: true, geometry: [from, to])
}

/// Végighajt a fixeken, és összegyűjti az eseményeket.
private func drive(_ w: ApproachWatch, _ fixes: [GpsFix], cameras: [FixedCamera] = [], sections: [Section] = []) -> [AlertEvent] {
    fixes.flatMap { w.update($0, cameras: cameras, sections: sections, unit: .kmh) }
}

/// Kelet felé x0 → x1, 50 m-enként.
private func east(_ x0: Double, _ x1: Double) -> [GpsFix] { stride(from: x0, through: x1, by: 50).map { fix($0) } }
/// Nyugat felé x0 → x1, 50 m-enként.
private func west(_ x0: Double, _ x1: Double) -> [GpsFix] { stride(from: x0, through: x1, by: -50).map { fix($0, heading: 270) } }

@Suite("kamera-közeledés")
struct ApproachTests {
    @Test("az útirányban 600 m-en belül egyszer jelez, a távolsággal és a határral")
    func egyszer() {
        let w = ApproachWatch()
        let cam = camera("c1", at(1000, 20))
        var first: Int?
        var events: [AlertEvent] = []
        for (i, f) in east(0, 1400).enumerated() {
            let e = w.update(f, cameras: [cam], sections: [], unit: .kmh)
            if !e.isEmpty, first == nil { first = i }
            events += e
        }
        #expect(events.map(\.targetId) == ["c1"])
        #expect(events.first?.kind == .camera)
        // az első fix 600 m-en belül: x = 450 (550 m)
        #expect(first == 9)
        #expect(events.first?.text == cameraAlertText(distanceM: haversineM(at(450, 0), at(1000, 20)), limitKmh: 90, unit: .kmh))
    }

    @Test("a mondat: „Kamera 500 méterre, maximum 90”; határ nélkül és mph-ban")
    func mondat() {
        #expect(cameraAlertText(distanceM: 587, limitKmh: 90, unit: .kmh, lang: .hu) == "Kamera 500 méterre, maximum 90")
        #expect(cameraAlertText(distanceM: 600, limitKmh: nil, unit: .kmh, lang: .hu) == "Kamera 600 méterre")
        #expect(cameraAlertText(distanceM: 40, limitKmh: 130, unit: .mph, lang: .en) == "Camera in 100 metres, maximum 81")
        #expect(sectionAlertText(limitKmh: 110, unit: .kmh, lang: .hu) == "Szakaszellenőrzés kezdődik, maximum 110")
        #expect(alertDistanceM(599) == 500)
        #expect(alertDistanceM(60) == 100)
    }

    @Test("irány: az útirány ±45°-án kívüli (oldalsó) és a mögöttünk lévő kamera nem jelez")
    func irany() {
        let w = ApproachWatch()
        // a párhuzamos utcában, észak felé: 600 m-en belül végig 45°-nál nagyobb szögben
        let side = camera("side", at(300, 500))
        // mögöttünk
        let behind = camera("behind", at(-300, 0))
        #expect(drive(w, east(0, 600), cameras: [side, behind]).isEmpty)
    }

    @Test("az ellenkező irányba néző kamera (iránnyal) nem a miénk; a zóna-országbeli sem (a pontos helyet árulná el)")
    func ellenIrany() {
        let w = ApproachWatch()
        let opposite = camera("opp", at(800, 0), heading: 270)
        let france = camera("fr", at(800, 10), country: "FR")
        let same = camera("same", at(900, 0), heading: 92)
        #expect(drive(w, east(0, 1000), cameras: [opposite, france, same]).map(\.targetId) == ["same"])
    }

    @Test("visszafordulva újra jelez (kameránként egyszer irányonként)")
    func visszafordulas() {
        let w = ApproachWatch()
        let cam = camera("c1", at(1000, 0))
        let there = drive(w, east(0, 1300), cameras: [cam])
        let back = drive(w, west(1900, 0), cameras: [cam])
        #expect(there.map(\.targetId) == ["c1"])
        #expect(back.map(\.targetId) == ["c1"])
    }

    @Test("a 45°-os határ körüli ingadozás nem jelez kétszer")
    func ingadozas() {
        let w = ApproachWatch()
        let cam = camera("c1", at(1000, 0))
        let wobble = stride(from: 500.0, through: 900, by: 50).enumerated().map { i, x in fix(x, heading: i.isMultiple(of: 2) ? 90 : 160) }
        #expect(drive(w, wobble, cameras: [cam]).count == 1)
    }

    @Test("álló helyzetben (irány nélkül / lassan) nem jelez, elinduláskor igen; irány nélkül az elmozdulásból")
    func allo() {
        let w = ApproachWatch()
        let cam = camera("c1", at(800, 0))
        #expect(drive(w, [fix(300, speed: 0), fix(300, speed: 0.5)], cameras: [cam]).isEmpty)
        #expect(drive(w, [fix(320, heading: nil, speed: nil), fix(360, heading: nil, speed: nil)], cameras: [cam]).map(\.targetId) == ["c1"])
    }

    @Test("szakaszellenőrzés kezdő kapuja: a haladási iránnyal egyező szakasz jelez, az ellenirányú nem")
    func szakasz() {
        let w = ApproachWatch()
        let ours = section("S1", from: at(900, 0), to: at(3900, 0))
        let other = section("S2", from: at(950, 30), to: at(-2050, 30))
        let events = drive(w, east(0, 1200), sections: [ours, other])
        #expect(events.map(\.targetId) == ["S1"])
        #expect(events.first?.kind == .section)
        #expect(events.first?.text == sectionAlertText(limitKmh: 110, unit: .kmh))
    }

    @Test("a szakaszmérő-kapu kamera a szakasz kezdeténél nem jelez külön (a szakasz-jelzés szól)")
    func kapuDupla() {
        let w = ApproachWatch()
        let s = section("S1", from: at(900, 0), to: at(3900, 0))
        let gate = camera("gate", at(910, 15), type: .sectionGate)
        let events = drive(w, east(0, 1200), cameras: [gate], sections: [s])
        #expect(events.map(\.kind) == [.section])
    }
}

@Suite("jelzés-beállítások")
struct AlertSettingsTests {
    @Test("alapból: kamera- és tervezett-jelzés be, mód: hang")
    func alap() {
        let s = Settings.default
        #expect(s.kameraJelzes && s.tervezettJelzes)
        #expect(s.jelzesMod == .hang)
        #expect(alertDelivery(.camera, s) == .sound)
        #expect(alertDelivery(.section, s) == .sound)
        #expect(alertDelivery(.planned, s) == .sound)
    }

    @Test("a kamera-jelzés és a tervezett-mérés jelzés külön kapcsolható")
    func kulon() {
        var s = Settings.default
        s.kameraJelzes = false
        #expect(alertDelivery(.camera, s) == nil)
        #expect(alertDelivery(.section, s) == nil)
        #expect(alertDelivery(.planned, s) == .sound)
        s = .default
        s.tervezettJelzes = false
        #expect(alertDelivery(.camera, s) == .sound)
        #expect(alertDelivery(.planned, s) == nil)
        // ha a tervezett mérések nem látszanak, a jelzésük sem szól
        s = .default
        s.tervezettMeresek = false
        #expect(alertDelivery(.planned, s) == nil)
    }

    @Test("mód: hang / csak rezgés / ki")
    func mod() {
        var s = Settings.default
        s.jelzesMod = .rezges
        #expect(alertDelivery(.camera, s) == .vibrate)
        s.jelzesMod = .ki
        #expect(alertDelivery(.camera, s) == .silent)
    }

    @Test("mentés és visszaolvasás; régi (A9-es) tárolt beállításnál az alapértelmezés")
    func mentes() {
        var s = Settings.default
        s.kameraJelzes = false
        s.tervezettJelzes = false
        s.jelzesMod = .rezges
        #expect(Settings.parse(s.serialized()) == s)
        #expect(s.serialized().contains(#""jelzes_mod":"rezges""#))
        let old = Settings.parse(#"{"egyseg":"kmh","hatosagi_tures_megjelenitese":false,"terkep":"szines","tervezett_meresek":true,"hangos_utasitasok":true}"#)
        #expect(old.kameraJelzes && old.tervezettJelzes && old.jelzesMod == .hang)
        #expect(Settings.parse(#"{"jelzes_mod":"harsona"}"#).jelzesMod == .hang)
    }
}

/// Felvevő hang-réteg: mit kapott volna a valódi AlertPlayer.
private final class RecordingSink: AlertSink {
    var got: [(AlertEvent, AlertDelivery)] = []
    func deliver(_ event: AlertEvent, _ delivery: AlertDelivery) { got.append((event, delivery)) }
}

@Suite("jelzés-kézbesítés (sáv + hang-réteg)")
struct AlertDispatchTests {
    private let cam = AlertEvent(kind: .camera, targetId: "c1", text: "Kamera 500 méterre, maximum 90")
    private let planned = AlertEvent(kind: .planned, targetId: "p1", text: "Tervezett mérés, maximum 90")

    @Test("„Jelzés módja: ki”: a sáv megjelenik, a hang-réteg semmit nem kap (se hang, se rezgés)")
    func kiMod() {
        let sink = RecordingSink()
        let d = AlertDispatcher(sink: sink)
        var s = Settings.default
        s.jelzesMod = .ki
        d.emit(cam, settings: s, now: 0)
        d.emit(planned, settings: s, now: 100)
        #expect(d.current == planned)
        #expect(sink.got.isEmpty)
    }

    @Test("hang és csak rezgés: a sáv és a hang-réteg is megkapja")
    func hangRezges() {
        let sink = RecordingSink()
        let d = AlertDispatcher(sink: sink)
        d.emit(cam, settings: .default, now: 0)
        var s = Settings.default
        s.jelzesMod = .rezges
        d.emit(planned, settings: s, now: 10)
        #expect(sink.got.map(\.1) == [.sound, .vibrate])
        #expect(d.current == planned)
    }

    @Test("kikapcsolt fajta: se sáv, se hang; a sáv 8 s után eltűnik; ugrás (quiet) alatt csak a sáv")
    func kikapcsolvaLejarat() {
        let sink = RecordingSink()
        let d = AlertDispatcher(sink: sink)
        var s = Settings.default
        s.kameraJelzes = false
        d.emit(cam, settings: s, now: 0)
        #expect(d.current == nil)
        d.emit(cam, settings: .default, now: 1000, quiet: true)
        #expect(d.current == cam)
        #expect(sink.got.isEmpty)
        d.expire(now: 1000 + AlertDispatcher.showMs)
        #expect(d.current == cam)
        d.expire(now: 1001 + AlertDispatcher.showMs)
        #expect(d.current == nil)
    }

    @Test("a tervezett mérés bemondása „Tervezett mérés, maximum X” – a „rendőrségi” szó nélkül, mind a 6 nyelven")
    func plannedSzoveg() {
        let line = PlannedCheck(
            id: "p", country: "HU", county: "Fejér", settlement: "Székesfehérvár", roadRef: "7", description: "", lines: [], zones: [],
            speedLimitKmh: 90, limitSource: .osm, validFrom: 0, validTo: 1, timeWindow: nil, sourceUrl: "https://www.police.hu/"
        )
        var zone = line
        zone.zones = [[[LatLon(lat: 0, lon: 0), LatLon(lat: 0, lon: 1), LatLon(lat: 1, lon: 0)]]]
        #expect(plannedAlertText(line, unit: .kmh, lang: .hu) == "Tervezett mérés, maximum 90")
        #expect(plannedAlertText(zone, unit: .kmh, lang: .hu) == "Tervezett mérés Székesfehérvár területén")
        #expect(plannedAlertText(line, unit: .kmh, lang: .en) == "Planned check, maximum 90")
        let police = ["rendőr", "police", "polizei", "policajn", "policejn", "policji"]
        for lang in Lang.allCases {
            for text in [plannedAlertText(line, unit: .kmh, lang: lang), plannedAlertText(zone, unit: .kmh, lang: lang)] {
                #expect(!police.contains { text.lowercased().contains($0) }, "\(lang.rawValue): \(text)")
            }
        }
    }
}
