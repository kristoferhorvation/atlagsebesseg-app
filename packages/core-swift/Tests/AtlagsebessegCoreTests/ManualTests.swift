import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing

// packages/core/test/manual.test.ts – 5 km: 3 km egyenes + 2 km-es enyhe ív (a vezetések a közös fixtúrákból)
@Suite("ManualTracker – kézi mód")
struct ManualTests {
    @Test("a GPS-útból számolja a hosszt és az átlagot")
    func gpsUtbol() throws {
        let samples = try Fixtures.drive("manual-noise3")
        let m = ManualTracker()
        m.start(samples[0].t - 2000)
        for f in fixes(samples) { m.addFix(f) }
        let r = m.stop(samples[samples.count - 1].t + 1000)
        #expect(r.running == false)
        #expect(abs(r.distanceM - 5000) / 5000 < 0.01)
        #expect(abs(r.averageKmh! - 100) < 1)
        // kapuk: az első és az utolsó pont, haladási iránnyal (indulás észak felé, a végén az íven kelet felé fordulva)
        let gates = try #require(r.gates)
        #expect(gates.start.timestamp == fixes(samples)[0].timestamp)
        #expect(closeTo(gates.start.headingDeg, 0, -1))
        #expect(gates.end.headingDeg! > 20)
        #expect(gates.end.headingDeg! < 40)
    }

    @Test("irányszög nélküli fixekből is ad kapu-irányt")
    func iranyszogNelkul() throws {
        let samples = try Fixtures.drive("manual-clean")
        let m = ManualTracker()
        m.start(samples[0].t)
        for f in fixes(samples) { var g = f; g.heading = nil; m.addFix(g) }
        let r = m.stop(samples[samples.count - 1].t)
        let gates = try #require(r.gates)
        #expect(min(gates.start.headingDeg!, 360 - gates.start.headingDeg!) < 2)
        #expect(gates.end.headingDeg! > 20)
    }

    @Test("adat nélkül nincs kapu")
    func adatNelkul() {
        let m = ManualTracker()
        m.start(0)
        #expect(m.stop(1000).gates == nil)
    }

    @Test("alagút az egyenesen: a kiesést egyenessel becsüli")
    func alagut() throws {
        let samples = try Fixtures.drive("manual-tunnel")
        let m = ManualTracker()
        m.start(samples[0].t)
        for f in fixes(samples) { m.addFix(f) }
        let r = m.stop(samples[samples.count - 1].t)
        #expect(r.estimatedGapM > 1400)
        #expect(abs(r.distanceM - 5000) / 5000 < 0.01)
        #expect(abs(r.averageKmh! - 100) < 1)
    }

    @Test("GPS-ugrás és pontatlan fix nem növeli az utat")
    func ugras() throws {
        let samples = try Fixtures.drive("manual-jumps")
        let m = ManualTracker()
        m.start(samples[0].t)
        for (i, f) in fixes(samples).enumerated() {
            var g = f
            if i == 60 { g.lon += 0.02; g.accuracy = 200 }
            m.addFix(g)
        }
        let r = m.stop(samples[samples.count - 1].t)
        #expect(abs(r.distanceM - 5000) / 5000 < 0.01)
    }

    @Test("álló helyzetben a zaj nem halmozódik")
    func allo() throws {
        let samples = try Fixtures.drive("manual-standing")
        let m = ManualTracker()
        m.start(samples[0].t)
        let standing = zip(fixes(samples), samples).filter { $0.1.s < 10 }.map(\.0).prefix(120)
        for f in standing { m.addFix(f) }
        #expect(m.snapshot().distanceM < 30)
    }

    @Test("indítás előtt és leállítás után nem mér")
    func inditasElott() throws {
        let samples = try Fixtures.drive("manual-clean")
        let m = ManualTracker()
        for f in fixes(samples).prefix(20) { m.addFix(f) }
        #expect(m.snapshot().acceptedFixes == 0)
        m.start(samples[20].t)
        for f in fixes(samples).prefix(60) { m.addFix(f) }
        #expect(m.snapshot().acceptedFixes == 40)
        _ = m.stop(samples[60].t)
        m.addFix(samples[70].fix)
        #expect(m.snapshot().acceptedFixes == 40)
        #expect(m.isRunning == false)
    }
}
