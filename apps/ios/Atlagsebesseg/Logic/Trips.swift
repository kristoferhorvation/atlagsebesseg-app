import AtlagsebessegCore
import Foundation

// AW19: krúzing mód és az utak naplója – a packages/app-logic/src/trips.ts 1:1 portja (a tesztek: TripTests.swift, a
// trips.test.ts azonos nevű párjai). Cél nélkül is: ha a kocsi mozog (≥ `startKmh` legalább `startHoldS`-ig), egy „út”
// felvétele indul; `stopIdleS` állás vagy a GPS leállása zárja. A navigáció és a szakaszmérés ugyanabba az útba kerül.
// Minden adat helyben marad (`TripStore`, SQLite) – szerverre semmi. A küszöbök a generált `TRIP`-ben.

/// Egy GPS-minta a helyi tárolóban (1 Hz). A `h3` a tároló tölti ki (SwiftyH3); `nil`, ha nem sikerült.
nonisolated struct TripSample: Codable, Equatable, Sendable {
    var tripId: String
    var t: Double
    var lat: Double
    var lon: Double
    var speedKmh: Double?
    var heading: Double?
    var accuracy: Double?
    var h3: String?
    /// AW20: a navigáció tábla-limitje (km/h) a mintánál; `nil`, ha nem ismert (az út színezéséhez).
    var limitKmh: Double? = nil
}

/// Egy szakaszmérés az úton (a mérés eredményéből).
nonisolated struct TripMeasurement: Codable, Hashable, Sendable {
    var sectionId: String
    /// „M1 · Budapest → Győr”.
    var name: String
    var avgKmh: Double
    var limitKmh: Double
    var tooFast: Bool
    /// A mérés vége (ms).
    var at: Double
}

nonisolated struct TripTurns: Codable, Hashable, Sendable {
    var left = 0
    var right = 0
    var uTurn = 0
}

/// Egy út rekordja a naplóban (a webes `Trip`, azonos JSON-alakkal).
nonisolated struct Trip: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var startedAt: Double
    var endedAt: Double
    var distanceM: Double
    /// Menetidő (s): a mozgó minták ideje.
    var movingS: Double
    /// Állásidő (s): az út közbeni állás (a záró állás nem része).
    var idleS: Double
    var maxKmh: Double
    /// Kanyarok: kizárólag a navigáció manőverei (balra / jobbra / megfordulás); krúzingban 0.
    var turns: TripTurns
    /// Irányváltások: GPS-alapú (≥ `turnDeg` / `turnWindowS`), mindig számol.
    var dirChanges: TripTurns
    var reroutes: Int
    var measurements: [TripMeasurement]
    /// Dugóban töltött idő (s; az AW18 helyi dugó-állapotából).
    var jamS: Double
    /// A navigáció célja (az utolsó), ha volt.
    var destination: String?
    /// Az útvonal egyszerűsítve (Douglas–Peucker, `simplifyM`), darabokban ([lat, lon], 6 tizedes); ugrásnál új darab.
    var path: [[[Double]]]
    /// A mintaszám (a tárolt GPS-minták).
    var samples: Int

    init(id: String, startedAt: Double, endedAt: Double, distanceM: Double, movingS: Double, idleS: Double, maxKmh: Double, turns: TripTurns, dirChanges: TripTurns, reroutes: Int, measurements: [TripMeasurement], jamS: Double, destination: String?, path: [[[Double]]], samples: Int) {
        self.id = id; self.startedAt = startedAt; self.endedAt = endedAt; self.distanceM = distanceM; self.movingS = movingS; self.idleS = idleS
        self.maxKmh = maxKmh; self.turns = turns; self.dirChanges = dirChanges; self.reroutes = reroutes; self.measurements = measurements
        self.jamS = jamS; self.destination = destination; self.path = path; self.samples = samples
    }

    /// Régi rekord (AW19 első változat): a `turns` GPS-alapú volt → `dirChanges`; a kanyar 0 (a webes `normalizeTrip`).
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        startedAt = try c.decode(Double.self, forKey: .startedAt)
        endedAt = try c.decode(Double.self, forKey: .endedAt)
        distanceM = try c.decode(Double.self, forKey: .distanceM)
        movingS = try c.decode(Double.self, forKey: .movingS)
        idleS = try c.decode(Double.self, forKey: .idleS)
        maxKmh = try c.decode(Double.self, forKey: .maxKmh)
        let t = try c.decode(TripTurns.self, forKey: .turns)
        if let d = try c.decodeIfPresent(TripTurns.self, forKey: .dirChanges) {
            turns = t
            dirChanges = d
        } else {
            turns = TripTurns()
            dirChanges = t
        }
        reroutes = try c.decode(Int.self, forKey: .reroutes)
        measurements = try c.decode([TripMeasurement].self, forKey: .measurements)
        jamS = try c.decode(Double.self, forKey: .jamS)
        destination = try c.decodeIfPresent(String.self, forKey: .destination)
        path = try c.decode([[[Double]]].self, forKey: .path)
        samples = try c.decode(Int.self, forKey: .samples)
    }
}

/// A navigáció manőverének kanyar-fajtája az ikonból: balra / jobbra (éles is, körforgalom-kijárat iránya), megfordulás; egyéb `nil`.
nonisolated func maneuverTurnKind(_ icon: String) -> WritableKeyPath<TripTurns, Int>? {
    switch icon {
    case "left", "sharp_left", "roundabout_left": \TripTurns.left
    case "right", "sharp_right", "roundabout_right": \TripTurns.right
    case "uturn": \TripTurns.uTurn
    default: nil
    }
}

/// Az összes kanyar (B + J + U).
nonisolated func turnsTotal(_ turns: TripTurns) -> Int { turns.left + turns.right + turns.uTurn }

/// A futó út az üres nézet állapotsorához.
nonisolated struct CruiseView: Equatable, Sendable {
    var tripId: String
    var startedAt: Double
    var distanceM: Double
    var elapsedS: Double
}

nonisolated enum TripEnd: Equatable, Sendable {
    case saved(Trip)
    case discarded(String)
}

/// Előjeles irányváltás `from` → `to` (°, −180…180; pozitív = jobbra) – a JS `%` (csonkoló) maradékával.
nonisolated func headingDelta(_ to: Double, _ from: Double) -> Double {
    ((to - from).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180
}

/// Átlagsebesség a menetidőre (km/h); menetidő nélkül `nil`.
nonisolated func tripAvgKmh(distanceM: Double, movingS: Double) -> Double? {
    movingS > 0 ? distanceM / movingS * 3.6 : nil
}

nonisolated func tripAvgKmh(_ trip: Trip) -> Double? { tripAvgKmh(distanceM: trip.distanceM, movingS: trip.movingS) }

// MARK: kanyarok

/// Kanyar-felismerés az irányból (a webes `TurnDetector`): `turnWindowS` alatt legalább `turnDeg` irányváltás indít egy
/// kanyart; vége, ha az irány `turnSettleS` óta `turnSettleDeg`-en belül marad (vagy `turnMaxS` letelt, vagy 10 s-ig nincs
/// irány). A nettó irányváltás dönt: `uTurnDeg` fölött megfordulás, `turnMinNetDeg` alatt semmi, különben jobbra / balra.
nonisolated final class TurnDetector {
    private(set) var turns = TripTurns()
    private var hist: [(t: Double, h: Double)] = []
    private var turn: (startH: Double, startT: Double)?
    private var last: (t: Double, h: Double)?

    /// Egy minta: az irány (°) vagy `nil` (lassú haladás / nincs adat).
    func feed(_ t: Double, _ heading: Double?) {
        guard let heading else {
            if turn != nil, let last, t - last.t > 10_000 { end(last) }
            return
        }
        let cur = (t: t, h: heading)
        hist.append(cur)
        while hist.count > 1, hist[0].t < t - TRIP.turnWindowS * 1000 { hist.removeFirst() }
        last = cur
        guard let turn else {
            let ref = hist[0]
            if abs(headingDelta(heading, ref.h)) >= TRIP.turnDeg { self.turn = (ref.h, ref.t) }
            return
        }
        let settle = hist.first { $0.t >= t - TRIP.turnSettleS * 1000 }!
        let settled = t - settle.t >= (TRIP.turnSettleS - 1) * 1000 && abs(headingDelta(heading, settle.h)) < TRIP.turnSettleDeg
        if settled || t - turn.startT > TRIP.turnMaxS * 1000 { end(cur) }
    }

    /// Az út vége: a még nyitott kanyar lezárása.
    func finish() {
        if turn != nil, let last { end(last) }
    }

    /// Ugrás (a pozíció folytonossága megszakadt): a nyitott kanyar és az irány-előzmény elvész, nem számít.
    func reset() {
        turn = nil
        hist = []
        last = nil
    }

    private func end(_ at: (t: Double, h: Double)) {
        let net = headingDelta(at.h, turn!.startH)
        if abs(net) >= TRIP.uTurnDeg { turns.uTurn += 1 } else if net >= TRIP.turnMinNetDeg { turns.right += 1 } else if net <= -TRIP.turnMinNetDeg { turns.left += 1 }
        turn = nil
        hist = [at]
    }
}

// MARK: útvonal-egyszerűsítés

/// Douglas–Peucker (helyi síkvetületben, `tolM` méter tűréssel); a két végpont mindig megmarad.
nonisolated func simplifyPath(_ points: [LatLon], tolM: Double = TRIP.simplifyM) -> [LatLon] {
    guard points.count > 2 else { return points }
    let proj = LocalProjection(points[0])
    let xy = points.map { proj.toXY($0) }
    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true
    var stack: [(Int, Int)] = [(0, points.count - 1)]
    while let (a, b) = stack.popLast() {
        let pa = xy[a], pb = xy[b]
        let dx = pb.x - pa.x, dy = pb.y - pa.y
        let len2 = dx * dx + dy * dy
        var best = -1
        var bestD = 0.0
        if a + 1 < b {
            for i in (a + 1)..<b {
                let p = xy[i]
                let d: Double
                if len2 == 0 {
                    d = hypot(p.x - pa.x, p.y - pa.y)
                } else {
                    let k = max(0, min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / len2))
                    d = hypot(p.x - (pa.x + k * dx), p.y - (pa.y + k * dy))
                }
                if d > bestD {
                    bestD = d
                    best = i
                }
            }
        }
        if best >= 0, bestD > tolM {
            keep[best] = true
            stack.append((a, best))
            stack.append((best, b))
        }
    }
    return points.indices.filter { keep[$0] }.map { points[$0] }
}

private nonisolated func round6(_ x: Double) -> Double { jsRound(x * 1e6) / 1e6 }

// MARK: a felvevő

/// Az utak felvétele a GPS-fixekből (a webes `TripRecorder`): indulás (`startKmh` × `startHoldS`), minták (1 Hz), táv /
/// menet- / állásidő, max sebesség, kanyarok, majd zárás (`stopIdleS` állás, vagy `stop()` a GPS leállásakor). A
/// navigáció és a mérés eseményei a futó útba kerülnek. A tárolás az appé: `drainSamples()` / `drainEnded()`.
nonisolated final class TripRecorder {
    private final class Running {
        let id: String
        let startedAt: Double
        var lastT: Double
        var lastMovingT: Double
        var prev: (lat: Double, lon: Double, t: Double)?
        var distanceM = 0.0
        var movingS = 0.0
        var idleS = 0.0
        var idlePendingS = 0.0
        var idleBuf: [TripSample] = []
        var maxKmh = 0.0
        /// GPS-alapú irányváltások (mindig).
        let turns = TurnDetector()
        /// Navigációs kanyarok (a manőverekből).
        var maneuverTurns = TripTurns()
        var reroutes = 0
        var measurements: [TripMeasurement] = []
        var jamOnAt: Double?
        var jamS = 0.0
        var destination: String?
        var segments: [[LatLon]] = [[]]
        var samples = 0

        init(id: String, startedAt: Double, destination: String?) {
            self.id = id
            self.startedAt = startedAt
            lastT = startedAt
            lastMovingT = startedAt
            self.destination = destination
        }
    }

    private let newId: (Double) -> String
    private var run: Running?
    /// Indulás előtt: a `startKmh` fölötti minták sora (az út eleje).
    private var pending: [(fix: GpsFix, kmh: Double)] = []
    private var lastFix: GpsFix?
    private var lastAcceptedT = -Double.infinity
    private var outbox: [TripSample] = []
    private var ended: [TripEnd] = []
    private var destination: String?
    private var limitKmh: Double?
    private var nextManeuver: (icon: String, instruction: String, distanceM: Double)?

    init(newId: ((Double) -> String)? = nil) {
        self.newId = newId ?? { startedAt in
            "trip-\(String(Int(startedAt), radix: 36))-\(String(Int.random(in: 0..<2_176_782_336), radix: 36))"
        }
    }

    /// Egy GPS-fix (a mérés és a navigáció ugyanazokat kapja).
    func onFix(_ input: GpsFix) {
        // egész ms (a CLLocation-időbélyeg oda-vissza alakítása ne mozdítsa el a küszöböket)
        var fix = input
        fix.timestamp = jsRound(input.timestamp)
        if fix.timestamp - lastAcceptedT < TRIP.sampleMinMs { return }
        let kmh = speedKmhOf(fix)
        lastAcceptedT = fix.timestamp
        let before = lastFix
        lastFix = fix
        if let r = run, fix.timestamp - r.lastT > TRIP.stopIdleS * 1000 {
            // fix nélküli rés (háttér, GPS-kiesés, engedély-vesztés): új út csak ha az első új fix > `resumeNewTripM`-re van
            if let from = r.prev.map({ LatLon(lat: $0.lat, lon: $0.lon) }) ?? before.map({ LatLon(lat: $0.lat, lon: $0.lon) }), haversineM(from, fix) <= TRIP.resumeNewTripM {
                resume(r, fix)
            } else {
                finish()
            }
        }
        if let r = run {
            add(r, fix, kmh)
            return
        }
        if let kmh, kmh >= TRIP.startKmh, accurate(fix) {
            pending.append((fix, kmh))
            if fix.timestamp - pending[0].fix.timestamp >= TRIP.startHoldS * 1000 { begin() }
        } else {
            pending = []
        }
    }

    /// Óra-lépés fix nélkül is (az út nem zárul csendtől – csak a felhasználó megállítása vagy egy távoli újrakezdés zárja).
    func tick(_ now: Double) {}

    /// A felhasználó megállította a GPS-t: a futó út lezárul.
    func stop() {
        pending = []
        if run != nil { finish() }
    }

    /// A navigáció következő manővere (minden nézet-frissítéskor): ha a manőver kicserélődött, és az előző `maneuverPassM`-en
    /// belül volt, teljesítettnek számít → kanyar (`maneuverTurnKind`). Újratervezés / útvonalváltás távolról nem számít.
    func noteNextManeuver(_ m: (icon: String, instruction: String, distanceM: Double)?) {
        let prev = nextManeuver
        nextManeuver = m
        guard let m, let r = run, let prev, !(m.instruction == prev.instruction && m.icon == prev.icon) else { return }
        if prev.distanceM > TRIP.maneuverPassM { return }
        if let kind = maneuverTurnKind(prev.icon) { r.maneuverTurns[keyPath: kind] += 1 }
    }

    /// Újratervezés a navigációban (a futó útba).
    func noteReroute() { run?.reroutes += 1 }

    /// A navigáció helyi dugó-állapota (AW18) – a dugóban töltött idő.
    func noteJam(_ on: Bool, _ t: Double) {
        guard let r = run else { return }
        if on, r.jamOnAt == nil { r.jamOnAt = t }
        if !on, let at = r.jamOnAt {
            r.jamS += max(0, t - at) / 1000
            r.jamOnAt = nil
        }
    }

    /// Egy befejezett szakaszmérés.
    func noteMeasurement(_ m: TripMeasurement) { run?.measurements.append(m) }

    /// A navigáció mostani tábla-limitje (`nil`: ismeretlen / nincs navigáció) – a következő minták kapják (AW20).
    func setLimit(_ kmh: Double?) { limitKmh = kmh }

    /// A navigáció célja (`nil`: nincs navigáció); a futó útra és a következőre is.
    func setDestination(_ name: String?) {
        destination = name
        if let r = run, let name { r.destination = name }
    }

    /// A futó út (az állapotsorhoz); `nil`, ha nincs.
    func view(_ now: Double) -> CruiseView? {
        guard let r = run else { return nil }
        return CruiseView(tripId: r.id, startedAt: r.startedAt, distanceM: r.distanceM, elapsedS: max(0, now - r.startedAt) / 1000)
    }

    /// Az új minták (a tárolónak).
    func drainSamples() -> [TripSample] {
        defer { outbox = [] }
        return outbox
    }

    /// A lezárt utak (mentendő) és az eldobott rövidek (a mintáik törlendők).
    func drainEnded() -> [TripEnd] {
        defer { ended = [] }
        return ended
    }

    /// Rés után ugyanaz az út: a kieső idő állásidő, a rés nem táv, a vonal új darabot kezd, a kanyar-felismerés újraindul.
    private func resume(_ r: Running, _ fix: GpsFix) {
        let gapS = max(0, fix.timestamp - r.lastT) / 1000
        r.idleS += r.idlePendingS + gapS
        r.idlePendingS = 0
        r.idleBuf = []
        r.lastT = fix.timestamp
        r.lastMovingT = fix.timestamp
        r.prev = nil
        r.turns.reset()
        if !(r.segments.last?.isEmpty ?? true) { r.segments.append([]) }
    }

    /// A futó út pillanatképe (a naplóba mentéshez); `nil`, ha nincs vagy még rövid.
    func snapshot() -> Trip? {
        guard let r = run, r.distanceM >= TRIP.minTripM else { return nil }
        let jam = r.jamOnAt.map { r.jamS + max(0, r.lastMovingT - $0) / 1000 } ?? r.jamS
        return record(r, endedAt: r.lastMovingT, jamS: jam)
    }

    private func speedKmhOf(_ fix: GpsFix) -> Double? {
        if let v = fix.speed, v >= 0 { return v * 3.6 }
        guard let p = lastFix, fix.timestamp > p.timestamp else { return nil }
        return haversineM(p, fix) / ((fix.timestamp - p.timestamp) / 1000) * 3.6
    }

    private func begin() {
        let first = pending[0].fix
        let r = Running(id: newId(first.timestamp), startedAt: first.timestamp, destination: destination)
        run = r
        let queued = pending
        pending = []
        for p in queued { add(r, p.fix, p.kmh) }
    }

    private func add(_ r: Running, _ fix: GpsFix, _ kmh: Double?) {
        let t = fix.timestamp
        let dt = max(0, t - r.lastT) / 1000
        r.lastT = t
        let moving = kmh.map { $0 >= TRIP.idleKmh } ?? false
        let good = accurate(fix)
        let sample = TripSample(
            tripId: r.id, t: t, lat: fix.lat, lon: fix.lon, speedKmh: kmh.map { jsRound($0 * 10) / 10 }, heading: fix.heading,
            accuracy: fix.accuracy, h3: nil, limitKmh: limitKmh
        )
        if good, let p = r.prev, t > p.t, haversineM(LatLon(lat: p.lat, lon: p.lon), fix) / ((t - p.t) / 1000) * 3.6 > TRIP.maxJumpKmh { r.turns.reset() }
        r.turns.feed(t, (kmh ?? 0) >= TRIP.turnMinKmh && kmh != nil ? fix.heading : nil)
        if !moving {
            r.idlePendingS += dt
            r.idleBuf.append(sample)
            if good { r.prev = (fix.lat, fix.lon, t) }
            if t - r.lastMovingT >= TRIP.stopIdleS * 1000 { finish() }
            return
        }
        // mozgás: az addigi állás az út része volt
        r.idleS += r.idlePendingS
        r.idlePendingS = 0
        r.movingS += dt
        r.lastMovingT = t
        for s in r.idleBuf { emit(r, s) }
        r.idleBuf = []
        emit(r, sample)
        guard good, let kmh else { return }
        if let p = r.prev {
            let d = haversineM(LatLon(lat: p.lat, lon: p.lon), fix)
            let dts = (t - p.t) / 1000
            if dts > 0, d / dts * 3.6 <= TRIP.maxJumpKmh {
                r.distanceM += d
            } else if !(r.segments.last?.isEmpty ?? true) {
                r.segments.append([])
            }
        }
        r.segments[r.segments.count - 1].append(LatLon(lat: fix.lat, lon: fix.lon))
        r.prev = (fix.lat, fix.lon, t)
        r.maxKmh = max(r.maxKmh, kmh)
    }

    private func emit(_ r: Running, _ s: TripSample) {
        r.samples += 1
        outbox.append(s)
    }

    private func finish() {
        guard let r = run else { return }
        run = nil
        pending = []
        r.turns.finish()
        let endedAt = r.lastMovingT
        if let at = r.jamOnAt { r.jamS += max(0, endedAt - at) / 1000 }
        if r.distanceM < TRIP.minTripM {
            ended.append(.discarded(r.id))
            return
        }
        ended.append(.saved(record(r, endedAt: endedAt, jamS: r.jamS)))
    }

    private func record(_ r: Running, endedAt: Double, jamS: Double) -> Trip {
        let path = r.segments.filter { $0.count >= 2 }.map { simplifyPath($0).map { [round6($0.lat), round6($0.lon)] } }
        return Trip(
            id: r.id, startedAt: r.startedAt, endedAt: endedAt, distanceM: jsRound(r.distanceM), movingS: jsRound(r.movingS),
            idleS: jsRound(r.idleS), maxKmh: jsRound(r.maxKmh * 10) / 10, turns: r.maneuverTurns, dirChanges: r.turns.turns, reroutes: r.reroutes,
            measurements: r.measurements, jamS: jsRound(jamS), destination: r.destination, path: path, samples: r.samples
        )
    }
}

private nonisolated func accurate(_ fix: GpsFix) -> Bool { fix.accuracy.map { $0 <= TRIP.maxAccuracyM } ?? true }

// MARK: statisztika

/// Az összesítő kártya időszaka: ez a hét (hétfőtől), ez a hónap, összes.
nonisolated enum TripPeriod: String, CaseIterable, Sendable {
    case het, honap, osszes
}

/// Az időszak kezdete (ms, a készülék időzónájában): a hét hétfője 0:00, a hónap 1-je 0:00; `osszes`: `nil`.
nonisolated func periodStart(_ period: TripPeriod, _ now: Double, calendar: Calendar = .current) -> Double? {
    let d = Date(timeIntervalSince1970: now / 1000)
    let c = calendar.dateComponents([.year, .month, .day, .weekday], from: d)
    let start: DateComponents
    switch period {
    case .osszes: return nil
    case .honap: start = DateComponents(year: c.year, month: c.month, day: 1)
    case .het:
        // a JS `getDay()`: vasárnap 0 – a Calendar `weekday`-je vasárnap 1
        let back = (c.weekday! - 1 + 6) % 7
        start = DateComponents(year: c.year, month: c.month, day: c.day! - back)
    }
    return calendar.date(from: start).map { $0.timeIntervalSince1970 * 1000 }
}

nonisolated struct TripTotals: Equatable, Sendable {
    var trips: Int
    var distanceM: Double
    var movingS: Double
    var avgKmh: Double?
    var turns: TripTurns
    var dirChanges: TripTurns
    var checksOk: Int
    var checksTooFast: Int
    var jamS: Double
}

/// Az időszak összesítése (az út a kezdete szerint számít).
nonisolated func tripTotals(_ trips: [Trip], _ period: TripPeriod, _ now: Double, calendar: Calendar = .current) -> TripTotals {
    let from = periodStart(period, now, calendar: calendar)
    let sel = trips.filter { from == nil || $0.startedAt >= from! }
    let distanceM = sel.reduce(0) { $0 + $1.distanceM }
    let movingS = sel.reduce(0) { $0 + $1.movingS }
    let checks = sel.flatMap(\.measurements)
    return TripTotals(
        trips: sel.count, distanceM: distanceM, movingS: movingS, avgKmh: tripAvgKmh(distanceM: distanceM, movingS: movingS),
        turns: TripTurns(left: sel.reduce(0) { $0 + $1.turns.left }, right: sel.reduce(0) { $0 + $1.turns.right }, uTurn: sel.reduce(0) { $0 + $1.turns.uTurn }),
        dirChanges: TripTurns(left: sel.reduce(0) { $0 + $1.dirChanges.left }, right: sel.reduce(0) { $0 + $1.dirChanges.right }, uTurn: sel.reduce(0) { $0 + $1.dirChanges.uTurn }),
        checksOk: checks.filter { !$0.tooFast }.count, checksTooFast: checks.filter(\.tooFast).count, jamS: sel.reduce(0) { $0 + $1.jamS }
    )
}

/// Legújabb elöl (a napló listája).
nonisolated func sortTrips(_ trips: [Trip]) -> [Trip] { trips.sorted { $0.startedAt > $1.startedAt } }

// MARK: feliratok

private nonisolated func distText(_ m: Double, _ unit: SpeedUnit, lang: Lang?) -> String {
    let d = formatDistance(m, unit, lang: lang ?? L10n.lang)
    return "\(d.value) \(d.unit)"
}

/// Az üres nézet állapotsora: „Krúzing · 12,4 km · 23 perc”.
nonisolated func cruiseStatusText(distanceM: Double, elapsedS: Double, unit: SpeedUnit, lang: Lang? = nil) -> String {
    t(.tripsCruiseStatus, ["dist": distText(distanceM, unit, lang: lang), "time": formatTripDuration(elapsedS, lang: lang)], lang: lang)
}

/// Az út címe: a cél neve, vagy „Krúzing”.
nonisolated func tripTitle(_ trip: Trip, lang: Lang? = nil) -> String { trip.destination ?? t(.tripsCruise, lang: lang) }

/// Sebesség a választott egységben („87 km/h”); adat nélkül „–”.
nonisolated func tripSpeedText(_ kmh: Double?, _ unit: SpeedUnit) -> String {
    speedIn(kmh, unit).map { "\($0) \(unitLabel(unit))" } ?? "–"
}

/// A napló sora (a dátum a platformé): cím · táv · menetidő · átlag, alatta a kanyarok és az irányváltások száma.
nonisolated func tripRowParts(_ trip: Trip, _ unit: SpeedUnit, lang: Lang? = nil) -> (title: String, distance: String, duration: String, avg: String, turns: String) {
    (tripTitle(trip, lang: lang), distText(trip.distanceM, unit, lang: lang), formatTripDuration(trip.movingS, lang: lang), tripSpeedText(tripAvgKmh(trip), unit),
     t(.tripsRowTurns, ["n": "\(turnsTotal(trip.turns))", "d": "\(turnsTotal(trip.dirChanges))"], lang: lang))
}

/// A kanyarok / irányváltások egy sorban: „B 12 · J 9 · U 1”.
nonisolated func turnsText(_ turns: TripTurns, lang: Lang? = nil) -> String {
    t(.tripsTurnsValue, ["l": "\(turns.left)", "r": "\(turns.right)", "u": "\(turns.uTurn)"], lang: lang)
}

/// Szakaszmérések: „3 rendben · 1 túl gyors”.
nonisolated func checksText(_ ok: Int, _ tooFast: Int, lang: Lang? = nil) -> String {
    t(.tripsChecksValue, ["ok": "\(ok)", "fast": "\(tooFast)"], lang: lang)
}

/// Időtartam a statisztikához (0 is: „0 perc”).
nonisolated func tripDurationText(_ s: Double, lang: Lang? = nil) -> String {
    s < 30 ? t(.navDurMin, ["n": "0"], lang: lang) : formatTripDuration(s, lang: lang)
}

/// A szakasz neve a mérés-rekordban: „M1 · Budapest → Győr” (irány nélkül csak az út).
nonisolated func measurementName(road: String, direction: String?) -> String {
    if let direction, !direction.isEmpty { return "\(road) · \(direction)" }
    return road
}
