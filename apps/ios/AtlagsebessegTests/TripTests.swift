import AtlagsebessegCore
import CoreLocation
import Foundation
import Testing
import UIKit
@testable import Atlagsebesseg

// AW19: a packages/app-logic/test/trips.test.ts párja (azonos nevekkel) – krúzing mód, utak naplója, statisztika.

private let M_PER_DEG = 111_195.0
private let T0 = 1_800_000_000_000.0

/// Észak felé haladó fixek másodpercenként: `(km/h, másodperc)` darabok (a pozíció a sebességből lép).
private func northDrive(_ parts: [(Double, Int)], t0: Double = T0, accuracy: Double? = 5, lat: Double = 47.5, speedNil: Bool = false) -> [GpsFix] {
    var out: [GpsFix] = []
    var lat = lat
    var t = t0
    for (kmh, secs) in parts {
        for _ in 0..<secs {
            out.append(GpsFix(lat: lat, lon: 19.05, timestamp: t, speed: speedNil ? nil : kmh / 3.6, accuracy: accuracy, heading: kmh >= 1 ? 0 : nil))
            lat += kmh / 3.6 / M_PER_DEG
            t += 1000
        }
    }
    return out
}

private func ids() -> (Double) -> String {
    var n = 0
    return { _ in
        n += 1
        return "trip-\(n)"
    }
}

private func record(_ fixes: [GpsFix], stop: Bool = true) -> (rec: TripRecorder, ended: [TripEnd]) {
    let rec = TripRecorder(newId: ids())
    for f in fixes { rec.onFix(f) }
    if stop { rec.stop() }
    return (rec, rec.drainEnded())
}

private func saved(_ ended: [TripEnd]) -> [Trip] {
    ended.compactMap { if case let .saved(trip) = $0 { trip } else { nil } }
}

@Suite("TripRecorder (indulás és zárás)")
struct TripRecorderStartStopTests {
    @Test("a 30 s-os, legalább 10 km/h-s mozgás indítja az utat, a kezdete e szakasz eleje")
    func indulas() {
        let fixes = northDrive([(0, 10), (36, 30)])
        let rec = TripRecorder(newId: ids())
        for f in fixes { rec.onFix(f) }
        #expect(rec.view(fixes.last!.timestamp) == nil)
        let next = northDrive([(36, 1)], t0: fixes.last!.timestamp + 1000, lat: fixes.last!.lat + 10 / M_PER_DEG)
        rec.onFix(next[0])
        let v = rec.view(next[0].timestamp)!
        #expect(v.startedAt == T0 + 10_000)
        #expect(v.elapsedS == 30)
        #expect(abs(v.distanceM - 300) < 0.5)
    }

    @Test("10 km/h alá eső minta újraindítja a várakozást")
    func varakozas() {
        let rec = TripRecorder(newId: ids())
        for f in northDrive([(36, 20), (8, 1), (36, 25)]) { rec.onFix(f) }
        #expect(rec.view(T0 + 46_000) == nil)
        for f in northDrive([(36, 6)], t0: T0 + 46_000) { rec.onFix(f) }
        #expect(rec.view(T0 + 51_000)?.startedAt == T0 + 21_000)
    }

    @Test("5 perc állás zárja az utat, a vége az utolsó mozgó minta, a záró állás nem része")
    func allasZar() throws {
        let trip = try #require(saved(record(northDrive([(54, 120), (0, 301)]), stop: false).ended).first)
        #expect(trip.startedAt == T0)
        #expect(trip.endedAt == T0 + 119_000)
        #expect(trip.idleS == 0)
        #expect(trip.movingS == 119)
        #expect(trip.samples == 120)
    }

    @Test("az út közbeni állás állásidő, a menetidőbe nem számít; az átlag a menetidőre")
    func allasido() throws {
        let trip = try #require(saved(record(northDrive([(72, 100), (0, 60), (72, 100)])).ended).first)
        #expect(trip.idleS == 60)
        #expect(trip.movingS == 199)
        // 199 mozgó másodperc; a megállás előtti utolsó 20 m az állás első mintájára esik (állás közben nincs táv)
        #expect(trip.distanceM == jsRound(198 * 20))
        #expect(abs(tripAvgKmh(trip)! - 72) < 0.5)
        #expect(trip.maxKmh == 72)
    }

    @Test("a GPS leállása lezárja a futó utat")
    func gpsLeall() throws {
        let (rec, ended) = record(northDrive([(50, 60)]), stop: false)
        #expect(ended.isEmpty)
        rec.stop()
        let trip = try #require(saved(rec.drainEnded()).first)
        #expect(trip.endedAt == T0 + 59_000)
        #expect(rec.view(T0 + 60_000) == nil)
    }

    @Test("fix nélküli csend (háttér, GPS-kiesés) nem zárja az utat")
    func csend() {
        let rec = TripRecorder(newId: ids())
        for f in northDrive([(50, 60)]) { rec.onFix(f) }
        rec.tick(T0 + 59_000 + 3_600_000)
        #expect(rec.drainEnded().isEmpty)
        #expect(rec.view(T0 + 3_700_000) != nil)
    }

    @Test("rés után 500 m-en belül ugyanaz az út, a kieső idő állásidő")
    func resKozel() throws {
        let rec = TripRecorder(newId: ids())
        for f in northDrive([(50, 60)]) { rec.onFix(f) }
        // 6 perc csend, aztán közel a régi helytől folytatódik
        for f in northDrive([(50, 60)], t0: T0 + 59_000 + 360_000, lat: 47.5 + 800 / M_PER_DEG) { rec.onFix(f) }
        #expect(rec.drainEnded().isEmpty)
        rec.stop()
        let ended = saved(rec.drainEnded())
        let trip = try #require(ended.first)
        #expect(ended.count == 1)
        #expect(trip.idleS >= 360)
        #expect(trip.movingS < 125)
        #expect(trip.path.count == 2)
    }

    @Test("rés után 500 m-nél messzebb új út indul")
    func resTavol() throws {
        let rec = TripRecorder(newId: ids())
        for f in northDrive([(50, 60)]) { rec.onFix(f) }
        for f in northDrive([(50, 60)], t0: T0 + 59_000 + 360_000, lat: 47.5 + 5000 / M_PER_DEG) { rec.onFix(f) }
        let first = saved(rec.drainEnded())
        #expect(first.count == 1)
        #expect(first[0].endedAt == T0 + 59_000)
        rec.stop()
        let second = saved(rec.drainEnded())
        #expect(second.count == 1)
        #expect(second[0].id != first[0].id)
    }

    @Test("a pillanatkép nem zárja az utat, és rövid útról nincs")
    func pillanatkep() throws {
        let rec = TripRecorder(newId: ids())
        #expect(rec.snapshot() == nil)
        for f in northDrive([(50, 90)]) { rec.onFix(f) }
        let snap = try #require(rec.snapshot())
        #expect(snap.distanceM > 900)
        #expect(rec.view(T0 + 90_000) != nil)
        #expect(rec.drainEnded().isEmpty)
    }

    @Test("200 m alatti út eldobódik")
    func rovid() {
        #expect(record(northDrive([(15, 40)])).ended == [.discarded("trip-1")])
    }
}

@Suite("TripRecorder (minták és távolság)")
struct TripRecorderSampleTests {
    @Test("ugrás (> 250 km/h) nem ad távolságot, az útvonal új darabot kezd")
    func ugras() throws {
        let a = northDrive([(72, 60)])
        let b = northDrive([(72, 60)], t0: a.last!.timestamp + 1000, lat: 48.0)
        let trip = try #require(saved(record(a + b).ended).first)
        #expect(trip.distanceM == jsRound(118 * 20))
        #expect(trip.path.count == 2)
    }

    @Test("rossz pontosságú minta nem ad távolságot és max sebességet")
    func pontossag() throws {
        let good = northDrive([(72, 60)])
        let bad = northDrive([(144, 10)], t0: good.last!.timestamp + 1000, accuracy: 80, lat: good.last!.lat + 20 / M_PER_DEG)
        let trip = try #require(saved(record(good + bad).ended).first)
        #expect(trip.maxKmh == 72)
        #expect(trip.distanceM == jsRound(59 * 20))
        // AW23: krúzingban a pontatlan minta szünet, a záró szünet nem kerül a naplóba
        #expect(trip.samples == 60)
    }

    @Test("1 Hz: a sűrűbb fixekből csak egy minta kerül a tárolóba")
    func egyHz() {
        let fixes = northDrive([(72, 60)]).flatMap { f -> [GpsFix] in
            var g = f
            g.timestamp += 400
            return [f, g]
        }
        let samples = record(fixes).rec.drainSamples()
        #expect(samples.count == 60)
        #expect(samples[0] == TripSample(tripId: "trip-1", t: T0, lat: 47.5, lon: 19.05, speedKmh: 72, heading: 0, accuracy: 5, h3: nil))
    }

    @Test("a sebesség hiányában a két fix közti távolságból számol")
    func sebessegNelkul() throws {
        let trip = try #require(saved(record(northDrive([(72, 60)], speedNil: true)).ended).first)
        #expect(trip.distanceM == jsRound(58 * 20))
        #expect(abs(trip.maxKmh - 72) < 0.5)
    }
}

@Suite("TurnDetector (kanyarok)")
struct TurnDetectorTests {
    /// Irány-sor másodpercenként.
    private func feed(_ headings: [Double]) -> TripTurns {
        let d = TurnDetector()
        for (i, h) in headings.enumerated() { d.feed(Double(i) * 1000, h) }
        d.finish()
        return d.turns
    }

    @Test("jobbra, balra kanyar és megfordulás az irányból")
    func kanyarok() {
        #expect(feed([0, 0, 0, 30, 60, 90, 90, 90, 90, 90]) == TripTurns(left: 0, right: 1, uTurn: 0))
        #expect(feed([90, 90, 90, 60, 30, 0, 0, 0, 0, 0]) == TripTurns(left: 1, right: 0, uTurn: 0))
        #expect(feed([0, 0, 40, 80, 120, 160, 180, 180, 180, 180, 180]) == TripTurns(left: 0, right: 0, uTurn: 1))
        // a 0°/360° átmenet is folytonos
        #expect(feed([340, 340, 350, 20, 50, 70, 70, 70, 70]) == TripTurns(left: 0, right: 1, uTurn: 0))
    }

    @Test("lassú, 60°-os ív 5 s-nál hosszabb idő alatt nem kanyar")
    func lassuIv() {
        #expect(feed([0, 10, 20, 30, 40, 50, 60, 60, 60, 60]) == TripTurns())
    }

    @Test("S-kanyar (jobbra, majd azonnal vissza) nem kanyar")
    func sKanyar() {
        #expect(feed([0, 0, 35, 70, 35, 0, 0, 0, 0, 0]) == TripTurns())
    }

    @Test("két egymás utáni kanyar külön számít")
    func ketKanyar() {
        #expect(feed([0, 0, 45, 90, 90, 90, 90, 135, 180, 180, 180, 180]) == TripTurns(left: 0, right: 2, uTurn: 0))
    }

    @Test("headingDelta: előjeles, −180…180")
    func delta() {
        #expect(headingDelta(10, 350) == 20)
        #expect(headingDelta(350, 10) == -20)
        #expect(headingDelta(90, 0) == 90)
        #expect(abs(headingDelta(180, 0)) == 180)
    }
}

@Suite("kanyarok (navigáció) és irányváltások (GPS)")
struct TripManeuverTurnTests {
    /// Jobbra kanyar a GPS-ben: észak, majd 2 s alatt kelet felé fordul.
    private func withRightTurn() -> [GpsFix] {
        var f = northDrive([(50, 60)])
        var lat = f.last!.lat
        var lon = f.last!.lon
        var t = f.last!.timestamp
        for h in [30.0, 60, 90, 90, 90, 90, 90, 90] {
            t += 1000
            lat += (50 / 3.6 / M_PER_DEG) * cos(h * .pi / 180)
            lon += (50 / 3.6 / M_PER_DEG) * sin(h * .pi / 180)
            f.append(GpsFix(lat: lat, lon: lon, timestamp: t, speed: 50 / 3.6, accuracy: 5, heading: h))
        }
        for (i, g) in northDrive([(50, 1)], t0: t + 1000, lat: lat).enumerated() {
            var g = g
            g.lon = lon + Double(i + 1) * 0.0001
            g.heading = 90
            f.append(g)
        }
        return f
    }

    @Test("krúzingban a kanyar 0, az irányváltás számol")
    func kruzingKanyar() throws {
        let trip = try #require(saved(record(withRightTurn()).ended).first)
        #expect(trip.turns == TripTurns(left: 0, right: 0, uTurn: 0))
        #expect(trip.dirChanges.right == 1)
    }

    @Test("a navigáció teljesített manőverei adják a kanyarokat")
    func manoverKanyar() throws {
        let rec = TripRecorder(newId: ids())
        func man(_ icon: String, _ instruction: String, _ d: Double) -> (icon: String, instruction: String, distanceM: Double) { (icon, instruction, d) }
        for (i, f) in northDrive([(50, 120)]).enumerated() {
            rec.onFix(f)
            if i == 40 { rec.noteNextManeuver(man("right", "Fordulj jobbra", 300)) }
            if i == 50 { rec.noteNextManeuver(man("right", "Fordulj jobbra", 40)) }
            if i == 52 { rec.noteNextManeuver(man("roundabout_left", "Körforgalom", 500)) }
            if i == 70 { rec.noteNextManeuver(man("roundabout_left", "Körforgalom", 30)) }
            if i == 72 { rec.noteNextManeuver(man("uturn", "Fordulj vissza", 900)) }
            // újratervezés: a manőver messziről cserélődik → nem teljesítették
            if i == 90 { rec.noteNextManeuver(man("left", "Fordulj balra", 200)) }
            if i == 100 { rec.noteNextManeuver(man("arrive", "Megérkeztél", 100)) }
        }
        rec.stop()
        let trip = try #require(saved(rec.drainEnded()).first)
        #expect(trip.turns == TripTurns(left: 1, right: 1, uTurn: 0))
    }

    @Test("maneuverTurnKind: balra / jobbra / megfordulás, az enyhe és az egyenes nem kanyar")
    func fajta() {
        #expect(["left", "sharp_left", "roundabout_left"].map { maneuverTurnKind($0) == \TripTurns.left } == [true, true, true])
        #expect(["right", "sharp_right", "roundabout_right"].map { maneuverTurnKind($0) == \TripTurns.right } == [true, true, true])
        #expect(maneuverTurnKind("uturn") == \TripTurns.uTurn)
        #expect(["slight_left", "slight_right", "straight", "merge", "fork_left", "arrive", "depart"].allSatisfy { maneuverTurnKind($0) == nil })
    }

    @Test("normalizeTrip: a régi rekord GPS-es kanyarja irányváltás lesz, a kanyar 0")
    func regiRekord() throws {
        var trip = try #require(saved(record(northDrive([(72, 100)])).ended).first)
        trip.turns = TripTurns(left: 1, right: 2, uTurn: 0)
        let data = try JSONEncoder().encode(trip)
        var json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        json.removeValue(forKey: "dirChanges")
        let old = try JSONDecoder().decode(Trip.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(old.dirChanges == TripTurns(left: 1, right: 2, uTurn: 0))
        #expect(old.turns == TripTurns(left: 0, right: 0, uTurn: 0))
        let cur = try JSONDecoder().decode(Trip.self, from: data)
        #expect(cur == trip)
        #expect(turnsTotal(TripTurns(left: 1, right: 2, uTurn: 3)) == 6)
    }
}

@Suite("TripRecorder (navigáció és mérés)")
struct TripRecorderNavTests {
    @Test("a cél, az újratervezések, a dugóidő és a szakaszmérések a futó útba kerülnek")
    func navigacio() throws {
        let rec = TripRecorder(newId: ids())
        rec.setDestination("Győr")
        for (i, f) in northDrive([(72, 200)]).enumerated() {
            rec.onFix(f)
            if i == 50 { rec.noteReroute() }
            if i == 60 { rec.noteJam(true, f.timestamp) }
            if i == 100 { rec.noteJam(false, f.timestamp) }
            if i == 150 { rec.noteJam(true, f.timestamp) }
            if i == 120 { rec.noteMeasurement(TripMeasurement(sectionId: "S1", name: "M1 · Budapest → Győr", avgKmh: 118, limitKmh: 110, tooFast: true, at: f.timestamp)) }
        }
        rec.stop()
        let trip = try #require(saved(rec.drainEnded()).first)
        #expect(trip.destination == "Győr")
        #expect(trip.reroutes == 1)
        #expect(trip.jamS == 40 + 49)
        #expect(trip.measurements.count == 1)
        #expect(trip.measurements[0].tooFast)
    }

    @Test("a navigáció előtti krúzing lezárul: a navigált út külön út, a célt az kapja")
    func kesobbiCel() {
        let rec = TripRecorder(newId: ids())
        for (i, f) in northDrive([(72, 100)]).enumerated() {
            rec.onFix(f)
            if i == 60 { rec.setDestination("Győr") }
        }
        rec.stop()
        #expect(saved(rec.drainEnded()).map(\.destination) == [nil, "Győr"])
    }
}

@Suite("AW23: a krúzing szabályai")
struct CruiseRuleTests {
    @Test("navigáció alatt nincs krúzing; a navigáció vége után 0-ról indul")
    func navVege() {
        let rec = TripRecorder(newId: ids())
        rec.setDestination("Győr")
        let nav = northDrive([(72, 120)])
        for f in nav { rec.onFix(f) }
        #expect(rec.view(nav.last!.timestamp) == nil)
        rec.setDestination(nil)
        #expect(rec.view(nav.last!.timestamp) == nil)
        #expect(saved(rec.drainEnded()).map(\.destination) == ["Győr"])
        let after = northDrive([(72, 10)], t0: nav.last!.timestamp + 1000, lat: nav.last!.lat + 20 / M_PER_DEG)
        for f in after { rec.onFix(f) }
        #expect(rec.view(after.last!.timestamp) == nil)
        let more = northDrive([(72, 30)], t0: after.last!.timestamp + 1000, lat: after.last!.lat + 20 / M_PER_DEG)
        for f in more { rec.onFix(f) }
        let v = rec.view(more.last!.timestamp)!
        #expect(v.distanceM < 40 * 20 + 1)
        #expect(v.elapsedS < 41)
    }

    @Test("4 km/h-s séta 10 percig: 0 km, nincs krúzing")
    func seta() {
        let fixes = northDrive([(4, 600)])
        let r = record(fixes, stop: false)
        #expect(r.rec.view(fixes.last!.timestamp) == nil)
        #expect(r.ended.isEmpty)
    }

    @Test("±72 m-es pontosság: nem számol, nem is indul")
    func pontatlan() {
        let fixes = northDrive([(60, 300)], accuracy: 72)
        let r = record(fixes, stop: false)
        #expect(r.rec.view(fixes.last!.timestamp) == nil)
        #expect(r.ended.isEmpty)
    }

    @Test("krúzing közben 15 km/h alatt és gyenge pontosságnál szünetel; a küszöbök 15 km/h, 30 s, 30 m")
    func szunet() {
        #expect([TRIP.startKmh, TRIP.startHoldS, TRIP.maxAccuracyM] == [15, 30, 30])
        let drive = northDrive([(72, 60)])
        let slow = northDrive([(10, 120)], t0: drive.last!.timestamp + 1000, lat: drive.last!.lat)
        let rec = TripRecorder(newId: ids())
        for f in drive { rec.onFix(f) }
        let before = rec.view(drive.last!.timestamp)!
        for f in slow { rec.onFix(f) }
        let during = rec.view(slow.last!.timestamp)!
        #expect(during.distanceM == before.distanceM)
        #expect(during.elapsedS == before.elapsedS)
    }
}

@Suite("simplifyPath (Douglas–Peucker)")
struct SimplifyPathTests {
    @Test("egyenes vonal két pontra egyszerűsödik, a 10 m-nél nagyobb kitérés megmarad")
    func dp() {
        let line = (0..<50).map { LatLon(lat: 47.5 + Double($0) * 20 / M_PER_DEG, lon: 19.05) }
        #expect(simplifyPath(line).count == 2)
        let east = { (m: Double) in m / (M_PER_DEG * cos(47.5 * .pi / 180)) }
        let bump = line.enumerated().map { $0.offset == 25 ? LatLon(lat: $0.element.lat, lon: $0.element.lon + east(15)) : $0.element }
        #expect(simplifyPath(bump).count == 5)
        let small = line.enumerated().map { $0.offset == 25 ? LatLon(lat: $0.element.lat, lon: $0.element.lon + east(8)) : $0.element }
        #expect(simplifyPath(small).count == 2)
    }

    @Test("a rekord útvonala egyszerűsített, 6 tizedesre kerekített")
    func rekordUtvonal() throws {
        let trip = try #require(saved(record(northDrive([(72, 100)])).ended).first)
        #expect(trip.path.count == 1)
        #expect(trip.path[0].count == 2)
        #expect(trip.path[0][0] == [47.5, 19.05])
    }
}

@Suite("tripTotals (statisztika)")
struct TripTotalsTests {
    private func mk(_ id: String, _ startedAt: Double, _ km: Double, _ movingS: Double, _ tooFast: [Bool] = []) -> Trip {
        Trip(
            id: id, startedAt: startedAt, endedAt: startedAt + movingS * 1000, distanceM: km * 1000, movingS: movingS, idleS: 0, maxKmh: 100,
            turns: TripTurns(left: 1, right: 2, uTurn: 0), dirChanges: TripTurns(left: 4, right: 5, uTurn: 1), reroutes: 0,
            measurements: tooFast.enumerated().map { TripMeasurement(sectionId: "S\($0.offset)", name: "M1", avgKmh: 100, limitKmh: 110, tooFast: $0.element, at: startedAt) },
            jamS: 60, destination: nil, path: [], samples: 0
        )
    }

    private func local(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0) -> Double {
        Calendar.current.date(from: DateComponents(year: y, month: m, day: d, hour: h))!.timeIntervalSince1970 * 1000
    }

    @Test("az időszak kezdete: a hét hétfője 0:00, a hónap 1-je 0:00, összesnél nincs")
    func idoszak() {
        // 2026-10-29 csütörtök 12:00 (helyi idő)
        let now = local(2026, 10, 29, 12)
        #expect(periodStart(.het, now) == local(2026, 10, 26))
        #expect(periodStart(.honap, now) == local(2026, 10, 1))
        #expect(periodStart(.osszes, now) == nil)
        // vasárnap még az előző hétfőhöz tartozik
        #expect(periodStart(.het, local(2026, 11, 1, 20)) == local(2026, 10, 26))
    }

    @Test("hét, hónap, összes; az átlag a menetidőre")
    func osszesites() {
        let now = local(2026, 10, 29, 12)
        let trips = [
            mk("a", local(2026, 10, 28, 8), 30, 1800, [false, true]),
            mk("b", local(2026, 10, 20, 8), 60, 1800, [false]),
            mk("c", local(2026, 9, 20, 8), 10, 600),
        ]
        var week = tripTotals(trips, .het, now)
        week.avgKmh = week.avgKmh.map { jsRound($0 * 1e6) / 1e6 }
        #expect(week == TripTotals(trips: 1, distanceM: 30_000, movingS: 1800, avgKmh: 60, turns: TripTurns(left: 1, right: 2, uTurn: 0), dirChanges: TripTurns(left: 4, right: 5, uTurn: 1), checksOk: 1, checksTooFast: 1, jamS: 60))
        let month = tripTotals(trips, .honap, now)
        #expect(month.trips == 2)
        #expect(abs(month.avgKmh! - 90) < 1e-9)
        #expect(month.checksOk == 2)
        let all = tripTotals(trips, .osszes, now)
        #expect(all.trips == 3)
        #expect(all.distanceM == 100_000)
        #expect(all.turns == TripTurns(left: 3, right: 6, uTurn: 0))
        #expect(tripTotals([], .osszes, now).avgKmh == nil)
    }
}

@Suite("feliratok (napló)")
struct TripTextTests {
    @Test("cruiseStatusText: „Krúzing · 12,4 km · 23 perc”")
    func kruzing() {
        #expect(cruiseStatusText(distanceM: 12_400, elapsedS: 23 * 60, unit: .kmh, lang: .hu) == "Krúzing · 12,4 km · 23 perc")
        #expect(cruiseStatusText(distanceM: 640, elapsedS: 20, unit: .kmh, lang: .hu) == "Krúzing · 640 m · 1 perc")
        #expect(cruiseStatusText(distanceM: 12_400, elapsedS: 83 * 60, unit: .mph, lang: .en) == "Cruising · 7.7 mi · 1 h 23 min")
    }

    @Test("tripRowParts: cél vagy „Krúzing” · táv · menetidő · átlag")
    func sor() throws {
        var trip = try #require(saved(record(northDrive([(72, 100)])).ended).first)
        let p = tripRowParts(trip, .kmh, lang: .hu)
        #expect(p.title == "Krúzing")
        #expect(p.distance == "2,0 km")
        #expect(p.duration == "2 perc")
        #expect(p.avg == "72 km/h")
        #expect(p.turns == "0 kanyar · 0 irányváltás")
        trip.destination = "Győr"
        #expect(tripRowParts(trip, .kmh, lang: .hu).title == "Győr")
    }
}

@Suite("H3-cella (utak naplója)")
struct TripCellTests {
    /// A webes `tripStore.test.ts` párja (h3-js): ugyanaz a cella.
    @Test("a minta H3-cellája res 10-en: Budapest és Győr ugyanaz, mint a SwiftyH3-ban")
    func cella() {
        #expect(tripCell(47.4979, 19.0402) == "8a1e03785377fff")
        #expect(tripCell(47.6875, 17.6504) == "8a1e020ce6a7fff")
        #expect(tripCell(.nan, 19) == nil)
    }
}

@Suite("TripStore (SQLite)")
struct TripStoreTests {
    private func store() -> TripStore {
        TripStore(url: FileManager.default.temporaryDirectory.appendingPathComponent("trips-\(UUID().uuidString).sqlite"))
    }

    @Test("a minták H3-cellával, az út a mintáival együtt törlődik")
    func tarolo() {
        let s = store()
        let trip = Trip(
            id: "t1", startedAt: 1000, endedAt: 2000, distanceM: 500, movingS: 60, idleS: 0, maxKmh: 50, turns: TripTurns(), dirChanges: TripTurns(), reroutes: 0,
            measurements: [], jamS: 0, destination: "Győr", path: [[[47.5, 19.05], [47.51, 19.05]]], samples: 2
        )
        s.addSamples([
            TripSample(tripId: "t1", t: 1000, lat: 47.4979, lon: 19.0402, speedKmh: 50, heading: 90, accuracy: 5, h3: nil),
            TripSample(tripId: "t1", t: 2000, lat: 47.4980, lon: 19.0410, speedKmh: nil, heading: nil, accuracy: nil, h3: nil),
        ])
        s.saveTrip(trip)
        #expect(s.trips() == [trip])
        let samples = s.samples("t1")
        #expect(samples.count == 2)
        #expect(samples[0].h3 == "8a1e03785377fff")
        #expect(samples[1].speedKmh == nil)
        s.deleteTrip("t1")
        #expect(s.trips().isEmpty)
        #expect(s.samples("t1").isEmpty)
    }
}

@Suite("Utak naplója (csak iOS)")
struct TripIOSTests {
    @Test("a Live Activity „figyel” állapota a krúzing-sort mutatja, mérés nélkül")
    func figyelKruzing() {
        let v = CruiseView(tripId: "a", startedAt: 0, distanceM: 12_400, elapsedS: 23 * 60, movingS: 20 * 60, dirChanges: 7)
        #expect(cruiseFiguresText(v, unit: .kmh, lang: .hu) == "12,4 km · 23 perc · 37 km/h")
        #expect(cruiseDirChangesText(v, lang: .hu) == "Irányváltások: 7")
        let state = liveActivityState(SessionView(), nav: nil, unit: .kmh, cruise: cruiseFiguresText(v, unit: .kmh, lang: .hu), dirChanges: cruiseDirChangesText(v, lang: .hu), lang: .hu)
        #expect(state?.watch?.cruise == "12,4 km · 23 perc · 37 km/h")
        #expect(state?.watch?.dirChanges == "Irányváltások: 7")
        #expect(liveActivityState(SessionView(), nav: nil, unit: .kmh, lang: .hu)?.watch?.cruise == "0 km · 0 perc")
    }

    @Test("a kis térkép kamerája: az út közepe, és a befoglaló kifér")
    func kamera() throws {
        let pts = [CLLocationCoordinate2D(latitude: 47.5, longitude: 19.0), CLLocationCoordinate2D(latitude: 47.7, longitude: 17.6)]
        let c = try #require(tripMapCamera(pts, widthPt: 370, heightPt: 220, paddingPt: 28))
        #expect(abs(c.center.latitude - 47.6) < 1e-9)
        #expect(abs(c.center.longitude - 18.3) < 1e-9)
        // 1,4° széles: 314 pt-re ~ 7,3-as zoom
        #expect(abs(c.zoom - 7.3) < 0.1)
        #expect(tripMapCamera([], widthPt: 370, heightPt: 220, paddingPt: 28) == nil)
        // egy pontnál (vagy nagyon rövid útnál) a zoom felső korlátja
        #expect(tripMapCamera([pts[0]], widthPt: 370, heightPt: 220, paddingPt: 28)?.zoom == 16)
    }
}

// AOS17: a kuka (a TS-pár: packages/app-logic/test/trash.test.ts, azonos nevű tesztek)
@Suite("Összes törlése: 30 napos visszaállítás")
struct TrashTests {
    private let day = 24.0 * 3600 * 1000

    private func store() -> TripStore {
        TripStore(url: FileManager.default.temporaryDirectory.appendingPathComponent("trash-\(UUID().uuidString).sqlite"))
    }

    private func trip(_ id: String) -> Trip {
        Trip(id: id, startedAt: 1000, endedAt: 2000, distanceM: 100, movingS: 10, idleS: 0, maxKmh: 50, turns: TripTurns(), dirChanges: TripTurns(), reroutes: 0, measurements: [], jamS: 0, destination: nil, path: [], samples: 1)
    }

    private func sample(_ id: String) -> TripSample {
        TripSample(tripId: id, t: 1500, lat: 47.5, lon: 19, speedKmh: 50, heading: nil, accuracy: 5, h3: "x", limitKmh: nil)
    }

    @Test("a törölt sor a 30. napig visszaállítható, utána lejár")
    func lejarat() {
        #expect(!trashExpired(0, now: 30 * day))
        #expect(trashExpired(0, now: 30 * day + 1))
        #expect(trashExpiresAt([], now: 0) == nil)
        #expect(trashExpiresAt([0, 5 * day], now: 6 * day) == 35 * day)
        #expect(trashExpiresAt([0], now: 31 * day) == nil)
    }

    @Test("a visszaállított cella a törlés óta keletkezettel súlyozottan összevonódik")
    func osszevonas() {
        let a = HeatCell(h3: "x", count: 3, avgKmh: 50, lastT: 10)
        #expect(mergeHeatCells(a, nil) == a)
        #expect(mergeHeatCells(a, HeatCell(h3: "x", count: 1, avgKmh: 90, lastT: 20)) == HeatCell(h3: "x", count: 4, avgKmh: 60, lastT: 20))
    }

    @Test("30 napig megőrizve: az utak és a hőtérkép eltűnik, visszaállítva minden visszajön, a minták is")
    func visszaallitas() {
        let s = store()
        s.saveTrip(trip("a"))
        s.addSamples([sample("a")])
        _ = s.absorbTrip("a")
        let cells = s.heatCells()
        s.deleteAll(heat: true, keep: true, now: 0)
        #expect(s.trips().isEmpty)
        #expect(s.heatCells().isEmpty)
        #expect(s.trashExpiry(now: day) == TRASH_KEEP_MS)
        s.restoreTrash(now: day)
        #expect(s.trips().map(\.id) == ["a"])
        #expect(s.samples("a").count == 1)
        #expect(s.heatCells() == cells)
        #expect(s.trashExpiry(now: day) == nil)
        #expect(s.absorbTrip("a") == nil)
    }

    @Test("a hőtérkép csak külön kérésre törlődik")
    func hoterkepMarad() {
        let s = store()
        s.saveTrip(trip("a"))
        s.addSamples([sample("a")])
        _ = s.absorbTrip("a")
        let cells = s.heatCells()
        s.deleteAll(heat: false, keep: true, now: 0)
        #expect(s.trips().isEmpty)
        #expect(s.heatCells() == cells)
    }

    @Test("pipa nélkül azonnal és véglegesen: a korábbi kuka is törlődik, nincs mit visszaállítani")
    func vegleges() {
        let s = store()
        s.saveTrip(trip("a"))
        s.addSamples([sample("a")])
        s.deleteAll(heat: true, keep: true, now: 0)
        s.saveTrip(trip("b"))
        s.deleteAll(heat: true, keep: false, now: 1)
        #expect(s.trashExpiry(now: 1) == nil)
        #expect(s.samples("a").isEmpty)
        s.restoreTrash(now: 2)
        #expect(s.trips().isEmpty)
    }

    @Test("a lejárt kuka az út mintáival együtt törlődik")
    func purge() {
        let s = store()
        s.saveTrip(trip("a"))
        s.addSamples([sample("a")])
        s.deleteAll(heat: true, keep: true, now: 0)
        s.purgeTrash(now: 31 * day)
        #expect(s.trashExpiry(now: 31 * day) == nil)
        #expect(s.samples("a").isEmpty)
    }
}

// AOS17: dizájn-paritás
@Suite("AOS17: bejelentés, kamera, térképkép")
struct AOS17Tests {
    private func same(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Bool { a == b }

    @Test("a Térképhiba alkategóriája a sorba kerül, más típusnál nincs; a sorrend a lapé")
    func alkategoria() throws {
        let fix = GpsFix(lat: 47.5, lon: 19, timestamp: 0, speed: nil, accuracy: 5, heading: 90)
        #expect(MapErrorKind.allCases.map(\.rawValue) == ["szakaszhatar", "sebesseghatar", "nem_letezik", "hianyzo", "kamera", "egyeb"])
        #expect(reportFromFix(.szakaszHiba, fix, subtype: .kamera)?.subtype == "kamera")
        #expect(reportFromFix(.baleset, fix, subtype: .kamera)?.subtype == nil)
        // AW22: a Veszély altípusa
        #expect(reportFromFix(.akadaly, fix, hazard: .katyu)?.subtype == "katyu")
        #expect(reportFromFix(.akadaly, fix, subtype: .kamera)?.subtype == nil)
        #expect(reportFromFix(.szakaszHiba, fix, hazard: .katyu)?.subtype == nil)
        let json = String(decoding: try JSONEncoder().encode(reportFromFix(.szakaszHiba, fix, subtype: .nemLetezik)!), as: UTF8.self)
        #expect(json.contains(#""subtype":"nem_letezik""#))
        #expect(!String(decoding: try JSONEncoder().encode(reportFromFix(.baleset, fix)!), as: UTF8.self).contains("subtype"))
    }

    @Test("a bejelentés alsó szövege szó szerint a tulajdonosi szöveg")
    func szoSzerint() {
        #expect(t(.reportNoteDefault, lang: .hu) == "A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.")
        #expect(t(.reportTypeSzakaszHiba, lang: .hu) == "Térképhiba")
    }

    @Test("a térképkép színei: a világos forrás sötét lesz, a rárajzolt útvonal és a státusz-színek nem változnak")
    func szinezes() throws {
        #expect(same(liveMapGradeColor(237, 232, 229), (87, 82, 99)))
        #expect(same(liveMapGradeColor(153, 221, 255), (43, 59, 88)))
        #expect(same(liveMapGradeColor(31, 91, 255), (31, 91, 255)))
        #expect(same(liveMapGradeColor(46, 229, 157), (46, 229, 157)))
        let source = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { c in
            UIColor(red: 237 / 255, green: 232 / 255, blue: 229 / 255, alpha: 1).setFill()
            c.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        }
        let png = try #require(source.pngData())
        let out = try #require(liveMapGrade(png))
        #expect(UIImage(data: out) != nil)
        #expect(out != png)
    }

    @Test("a kezdőképernyő iOS-szövege: nincs benne a webes „háttérben megszakad”, a cím nem törhet")
    func kezdokepernyo() throws {
        let text = try String(contentsOf: Repo.root.appendingPathComponent("apps/ios/Atlagsebesseg/UI/StartView.swift"), encoding: .utf8)
        #expect(text.contains(".iosStartTipBackground"))
        #expect(!text.contains(".startTipForeground"))
        #expect(text.contains(".lineLimit(1)"))
    }

    @Test("a jelölőszín a zöld, a kézi mód az eddigi színén; rendszer-kapcsoló és UIKit-szegmens nincs a Beállításokban")
    func zold() throws {
        #expect(hexOf(Tokens.Colors.accent) == hexOf(Tokens.Colors.ok))
        #expect(hexOf(Tokens.StatusColors.kezi) == "7A86FF")
        let text = try String(contentsOf: Repo.root.appendingPathComponent("apps/ios/Atlagsebesseg/UI/SettingsSheet.swift"), encoding: .utf8)
        #expect(!text.contains(".pickerStyle(.segmented)"))
        #expect(!text.contains("Form {"))
    }
}

