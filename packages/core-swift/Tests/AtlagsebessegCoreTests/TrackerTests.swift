import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing

// packages/core/test/tracker.test.ts – a pálya, a szakaszok és a vezetések a közös fixtúrákból
private let fx = try! Fixtures.sections()
private let section = fx.course
private let L = section.lengthM
private let IN = fx.leadInM

struct Run {
    let tracker: SectionTracker
    let snaps: [TrackerSnapshot]
    let states: [TrackerState]
    var last: TrackerSnapshot { snaps[snaps.count - 1] }
}

func run(_ sections: [Section], _ fs: [GpsFix], options: TrackerOptions = .default) -> Run {
    let tracker = SectionTracker(sections, options: options)
    let snaps = fs.map { tracker.update($0) }
    return Run(tracker: tracker, snaps: snaps, states: snaps.flatMap { $0.transitions.map(\.to) })
}

/// A legutolsó, adott pálya menti pozíció előtti snapshot.
private func snapAt(_ samples: [DriveSample], _ snaps: [TrackerSnapshot], _ s: Double) -> TrackerSnapshot {
    let kept = samples.filter { !$0.dropped }
    var idx = 0
    while idx + 1 < kept.count && kept[idx + 1].s <= s { idx += 1 }
    return snaps[idx]
}

private func drive(_ name: String) -> [DriveSample] { try! Fixtures.drive(name) }

private func stripped(_ fs: [GpsFix]) -> [GpsFix] {
    fs.map { var f = $0; f.heading = nil; f.speed = nil; return f }
}

@Suite("SectionTracker – normál áthaladás")
struct TrackerNormalTests {
    let samples = drive("normal-120")
    var r: Run { run([section], fixes(samples)) }

    @Test("állapotok: kozeledik → szakaszon → kesz")
    func allapotok() {
        let r = r
        #expect(r.states == [.kozeledik, .szakaszon, .kesz])
        #expect(r.last.state == .kesz)
    }

    @Test("a közeledés ~2 km-rel a kezdőpont előtt indul")
    func kozeledes() {
        let i = r.snaps.firstIndex { $0.state == .kozeledik }!
        let s = samples.filter { !$0.dropped }[i].s
        #expect(IN - s > 1900)
        #expect(IN - s <= 2000)
    }

    @Test("az átlag 120 km/h (±0,5)")
    func atlag() {
        let res = r.last.lastResult!
        #expect(closeTo(res.averageKmh, 120, 0))
        #expect(abs(res.averageKmh - 120) < 0.5)
        #expect(res.overLimit == false)
    }

    @Test("belépési és kilépési idő a valódi időhöz képest < 0,3 s")
    func belepesKilepes() {
        let res = r.last.lastResult!
        #expect(abs(res.entryTime - trueTimeAt(samples, IN)) < 300)
        #expect(abs(res.exitTime - trueTimeAt(samples, IN + L)) < 300)
    }

    @Test("szakaszon az élő átlag ≈ 120, a megengedett sebesség ≥ 130")
    func eloAtlag() {
        let mid = snapAt(samples, r.snaps, IN + 5000)
        #expect(mid.state == .szakaszon)
        let live = mid.live!
        #expect(live.averageKmh! > 118)
        #expect(live.averageKmh! < 122)
        #expect(live.distanceM > 4950)
        #expect(live.distanceM < 5050)
        #expect(live.required.kind == "ok")
        #expect(live.required.maxKmh! > 130)
        #expect(live.slowDownKmh == 0)
        #expect(live.estimated == false)
    }

    @Test("a kész állapot a megtartási idő után nincs_szakasz-ra vált")
    func megtartas() {
        let tracker = SectionTracker([section])
        for f in fixes(samples) { tracker.update(f) }
        var lastFix = samples[samples.count - 1].fix
        lastFix.timestamp += 61_000
        let s = tracker.update(lastFix)
        #expect(s.state == .nincsSzakasz)
        #expect(s.lastResult != nil)
    }
}

@Suite("SectionTracker – gyorsítás a végén")
struct TrackerAccelTests {
    // 8 km 125 km/h, majd az utolsó 2 km 160 km/h → átlag ≈ 130,72 km/h
    let samples = drive("accel-125-160")
    var r: Run { run([section], fixes(samples)) }

    @Test("a végeredmény határ feletti")
    func hatarFeletti() {
        let expected = 10 / (8.0 / 125 + 2.0 / 160)
        #expect(closeTo(r.last.lastResult!.averageKmh, expected, 0))
        #expect(r.last.lastResult!.overLimit)
    }

    @Test("8 km után ≈ 154,8 km/h a megengedett, 160-nál ≈ 5 km/h-t kell lassítani")
    func nyolcKmUtan() {
        let snap = snapAt(samples, r.snaps, IN + 8100)
        let req = snap.live!.required
        #expect(req.kind == "ok")
        #expect(req.maxKmh! > 152)
        #expect(snap.live!.slowDownKmh! > 3)
        #expect(snap.live!.slowDownKmh! < 10)
    }

    @Test("végig 160 km/h-val a végén \"nem lehetséges\"")
    func vegig160() {
        let fast = drive("const-160")
        let r = run([section], fixes(fast))
        #expect(snapAt(fast, r.snaps, IN + 9300).live!.required.kind == "nem_lehetseges")
        #expect(closeTo(r.last.lastResult!.averageKmh, 160, 0))
    }

    @Test("a \"nem lehetséges\" küszöb a határ 60%-a (130 → 78 km/h), és konfigurálható")
    func kuszob() {
        // 160 km/h mellett a megengedett sebesség ≈ 7,8 km-nél esik 78 km/h alá (60 km/h alá csak ≈ 8,6 km-nél)
        let fast = drive("const-160")
        let def = run([section], fixes(fast))
        #expect(snapAt(fast, def.snaps, IN + 7600).live!.required.kind == "ok")
        #expect(snapAt(fast, def.snaps, IN + 8200).live!.required.kind == "nem_lehetseges")
        var o = TrackerOptions.default
        o.minPracticalFraction = 60.0 / 130
        let t = SectionTracker([section], options: o)
        let snaps = fixes(fast).map { t.update($0) }
        #expect(snapAt(fast, snaps, IN + 8200).live!.required.kind == "ok")
    }
}

@Suite("SectionTracker – alagút és GPS-ugrás")
struct TrackerTunnelTests {
    // 2 km kiesés a kanyar közepén (az egyenes húr itt alábecsülné az utat)
    let samples = drive("tunnel-120")
    var fs: [GpsFix] { fixes(samples) }

    @Test("nem szakad meg, és az átlag pontos")
    func nemSzakadMeg() {
        let r = run([section], fs)
        #expect(r.states == [.kozeledik, .szakaszon, .kesz])
        #expect(abs(r.last.lastResult!.averageKmh - 120) < 0.5)
    }

    @Test("kiesés közben becsül (dead reckoning)")
    func becsul() {
        let t2 = SectionTracker([section])
        let before = samples.filter { !$0.dropped && $0.s < IN + 5000 }
        for x in before { t2.update(x.fix) }
        let lastBefore = before[before.count - 1]
        let snap = t2.tick(lastBefore.t + 30_000)
        #expect(snap.state == .szakaszon)
        #expect(snap.live!.estimated)
        let trueDist = lastBefore.s - IN + (120 / 3.6) * 30
        #expect(abs(snap.live!.distanceM - trueDist) < 50)
        #expect(closeTo(snap.live!.averageKmh, 120, -1))
    }

    @Test("túl hosszú kiesés → megszakadt (jelvesztes)")
    func jelvesztes() {
        var o = TrackerOptions.default
        o.maxGapMs = 60_000
        let t3 = SectionTracker([section], options: o)
        let before = samples.filter { !$0.dropped && $0.s < IN + 3000 }
        for x in before { t3.update(x.fix) }
        let snap = t3.tick(before[before.count - 1].t + 61_000)
        #expect(snap.state == .megszakadt)
        #expect(snap.abortReason == .jelvesztes)
    }

    @Test("a pontatlan (nagy accuracy) fixek nem rontják az eredményt")
    func pontatlan() {
        let noisy = fs.enumerated().map { i, f in
            var g = f
            if i % 7 == 0 { g.lat += 0.01; g.accuracy = 300 }
            return g
        }
        let r = run([section], noisy)
        #expect(r.last.state == .kesz)
        #expect(abs(r.last.lastResult!.averageKmh - 120) < 0.5)
    }

    @Test("a tracker nyilvános állapota is kesz")
    func nyilvanos() {
        #expect(run([section], fs).tracker.currentState == .kesz)
    }
}

@Suite("SectionTracker – ellenirány")
struct TrackerWrongWayTests {
    @Test("az ellenirányú pályán (25 m-re) nem lép be")
    func nemLepBe() {
        // A másik pálya: a teljes útvonal megfordítva, a menetiránytól jobbra 25 m-rel
        let r = run([section], fixes(drive("opposite-25m-noise3")))
        #expect(r.states.isEmpty)
        #expect(r.snaps.allSatisfy { $0.state == .nincsSzakasz })
    }

    @Test("irányszög nélkül is (csak a pozíciókból) kiszűri")
    func iranyszogNelkul() {
        #expect(run([section], stripped(fixes(drive("opposite-25m")))).states.isEmpty)
    }

    @Test("irányszög nélkül a helyes irányban belép")
    func helyesIrany() {
        let r = run([section], stripped(fixes(drive("clean-120"))))
        #expect(r.states == [.kozeledik, .szakaszon, .kesz])
        #expect(abs(r.last.lastResult!.averageKmh - 120) < 0.5)
    }
}

@Suite("SectionTracker – párhuzamos út és letérés")
struct TrackerParallelTests {
    @Test("a 150 m-re futó párhuzamos úton nem lép be")
    func parhuzamos150() {
        let r = run([section], fixes(drive("parallel-150m")))
        #expect(!r.states.contains(.szakaszon))
        #expect(r.states.isEmpty)
    }

    @Test("a 60 m-re futó szervizúton közeledést jelezhet, de nem lép be")
    func szervizut() {
        let r = run([section], fixes(drive("parallel-60m")))
        #expect(!r.states.contains(.szakaszon))
        #expect(r.last.state == .nincsSzakasz)
    }

    @Test("letérés a szakasz közepén → megszakadt (letert)")
    func letert() {
        // 4 km után kihajt kelet felé
        let r = run([section], fixes(drive("exit-at-4km")))
        // a megszakadt állapot 60 s-ig látszik, utána nincs_szakasz
        #expect(r.states == [.kozeledik, .szakaszon, .megszakadt, .nincsSzakasz])
        #expect(r.last.abortReason == .letert)
        #expect(r.last.lastResult == nil)
    }
}

@Suite("SectionTracker – speciális esetek")
struct TrackerSpecialTests {
    @Test("egymás utáni szakaszok: kesz után azonnal szakaszon")
    func egymasUtan() {
        let r = run([section, fx.second], fixes(drive("consecutive-110")))
        #expect(r.states == [.kozeledik, .szakaszon, .kesz, .szakaszon, .kesz])
        #expect(r.last.lastResult!.sectionId == "TEST-2")
        #expect(closeTo(r.last.lastResult!.averageKmh, 110, 0))
    }

    @Test("dugó: 2 perc állás a szakaszon (zajos fixekkel) nem szakítja meg")
    func dugo() {
        let samples = drive("jam-100")
        let r = run([section], fixes(samples))
        #expect(Array(r.states.prefix(3)) == [.kozeledik, .szakaszon, .kesz])
        let res = r.last.lastResult!
        let expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6
        #expect(abs(res.averageKmh - expected) < 0.5)
        #expect(res.averageKmh < 80)
    }

    @Test("az app a kapuzónán belül indul: belép, a belépési idő visszaszámolt")
    func kapuzonanBelul() {
        let samples = drive("clean-120")
        let fs = zip(fixes(samples), samples).filter { $0.1.s >= IN + 50 }.map(\.0)
        let r = run([section], fs)
        #expect(r.states.first == .szakaszon)
        #expect(abs(r.last.lastResult!.averageKmh - 120) < 0.5)
    }

    @Test("kapuzónán túl indulva nem lép be (nincs megbízható kezdés)")
    func kapuzonanTul() {
        let samples = drive("clean-120")
        let fs = zip(fixes(samples), samples).filter { $0.1.s >= IN + 1000 }.map(\.0)
        #expect(run([section], fs).states.isEmpty)
    }

    @Test("geometria nélküli (egyenes) szakasz is működik")
    func egyenes() {
        let r = run([fx.straight], fixes(drive("straight-130")))
        #expect(closeTo(r.last.lastResult!.averageKmh, 130, 0))
    }

    @Test("setSections menet közben: a futó mérés megmarad, az új szakaszok felismerhetők")
    func setSections() {
        let fs = fixes(drive("clean-120"))
        let t = SectionTracker([])
        let half = fs.count / 2
        for f in fs[0..<50] { t.update(f) }
        #expect(t.currentState == .nincsSzakasz)
        t.setSections([section]) // a szerverről megjött a szakasz
        for f in fs[50..<half] { t.update(f) }
        #expect(t.currentState == .szakaszon)
        // újabb frissítés (új objektumok, plusz egy másik szakasz) – nem szakíthatja meg
        var masik = section
        masik.id = "MASIK"
        masik.start = fx.farStart
        t.setSections([section, masik])
        var last = t.snapshot(0)
        for f in fs[half...] { last = t.update(f) }
        #expect(last.lastResult?.sectionId == "TEST-1")
        #expect(abs(last.lastResult!.averageKmh - 120) < 0.5)
    }

    @Test("reset után tiszta állapot")
    func reset() {
        let t = SectionTracker([section])
        for f in fixes(drive("clean-120")).prefix(150) { t.update(f) }
        #expect(t.currentState == .szakaszon)
        t.reset()
        let s = t.snapshot(0)
        #expect(s.state == .nincsSzakasz)
        #expect(s.section == nil)
        #expect(s.live == nil)
        #expect(s.lastResult == nil)
    }
}

@Suite("SectionTracker – robusztusság")
struct TrackerRobustnessTests {
    @Test("8 m GPS-zaj, seed 1…20: kész, átlag ±0,5 km/h", arguments: 1...20)
    func zaj(seed: Int) {
        let samples = drive("robust-seed-\(seed < 10 ? "0" : "")\(seed)")
        let r = run([section], fixes(samples))
        #expect(r.last.lastResult != nil)
        let expected = (L / ((trueTimeAt(samples, IN + L) - trueTimeAt(samples, IN)) / 1000)) * 3.6
        #expect(abs(r.last.lastResult!.averageKmh - expected) < 0.5)
    }
}

@Suite("SectionTracker – AW17: Maradj / várható a 7 km-es fixtúrán")
struct StayBelowTrackerTests {
    @Test("5 km 137-tel, utána 108-cal: 2,0 km-rel a kapu előtt a „Maradj” 115, a „várható” 127, állapot: lassíts")
    func maradjVarhato() throws {
        let samples = drive("straight7-137-108")
        let r = run([fx.straight7], fixes(samples))
        // az első minta 108 km/h-val (5 km után, a bevezető 2,5 km-rel együtt)
        let live = try #require(snapAt(samples, r.snaps, 2500 + 5000 + 40).live)
        #expect(closeTo(live.currentKmh, 108, 6))
        #expect(closeTo(live.averageKmh, 137, 1))
        #expect(live.remainingM > 1900)
        #expect(live.remainingM < 2000)
        #expect(live.required.kind == "ok")
        #expect(live.required.maxKmh!.rounded() == 115)
        #expect(live.projectedKmh!.rounded() == 127)
        #expect(live.slowDownKmh == 0)
        #expect(meterState(averageKmh: live.averageKmh, projectedKmh: live.projectedKmh, speedLimitKmh: fx.straight7.speedLimitKmh) == .lassits)
    }
}

