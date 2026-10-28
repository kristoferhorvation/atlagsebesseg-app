import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing
@testable import Atlagsebesseg

// packages/app-logic/test/session.test.ts – a tesztpálya és a vezetések a közös fixtúrákból (packages/core/fixtures)
private let fx = try! Fixtures.sections()

/// Végigvezet a tesztpályán állandó sebességgel (`clean-<v>` fixtúra).
private func run(_ speedKmh: Int) -> [GpsFix] {
    fixes(try! Fixtures.drive("clean-\(speedKmh)"))
}

/// Állítható óra a munkamenetnek.
private final class Clock {
    var t: Double = 0
}

@Suite("TrackingSession")
struct SessionTests {
    @Test("közeledés → mérés → befejezve, a színkóddal")
    func teljesAthaladas() {
        let samples = run(120)
        let clock = Clock()
        clock.t = samples[0].timestamp
        let session = TrackingSession([fx.course], now: { clock.t })
        var phases = Set<SessionPhase>()
        var measuring: SessionView?
        for f in samples {
            clock.t = f.timestamp
            let v = session.onFix(f)
            phases.insert(v.phase)
            if v.phase == .meres, v.progress! > 0.5, measuring == nil { measuring = v }
            if v.phase == .kozeledik { #expect(v.approachM! > 0) }
        }
        #expect(phases.isSuperset(of: [.nincsSzakasz, .kozeledik, .meres, .befejezve]))
        #expect(measuring?.status == .jo)
        let end = session.view()
        #expect(end.phase == .befejezve)
        #expect(closeTo(end.result?.averageKmh, 120, 0))
        #expect(session.dismiss().phase == .nincsSzakasz)
    }

    @Test("a színkód a várható végső átlagból jön, nem a pillanatnyiból")
    func varhatoVegso() throws {
        // 5 km 150-nel, aztán 100-zal (határ 130): 6 km-nél a pillanatnyi átlag ~138, a várható végső ~120
        let samples = fixes(try Fixtures.drive("split-150-100"))
        let clock = Clock()
        let session = TrackingSession([fx.course], now: { clock.t })
        var at60: SessionView?
        for f in samples {
            clock.t = f.timestamp
            let v = session.onFix(f)
            if v.phase == .meres, v.progress! > 0.6, at60 == nil { at60 = v }
        }
        let v = try #require(at60)
        #expect(v.live!.averageKmh! > 130)
        #expect(v.live!.projectedKmh! < 125)
        #expect(v.status == .lassits) // átlag a határ felett, de a várható végső alatta
    }

    @Test("határ felett: tul")
    func hatarFelett() {
        let clock = Clock()
        let session = TrackingSession([fx.course], now: { clock.t })
        for f in run(140) {
            clock.t = f.timestamp
            session.onFix(f)
        }
        let v = session.view()
        #expect(v.phase == .befejezve)
        #expect(v.status == .tulGyors)
    }

    @Test("háttérbe kerülés mérés közben: megszakadt, nincs átlag, és nem folytatódik")
    func hatter() {
        let samples = run(110)
        let clock = Clock()
        let session = TrackingSession([fx.course], now: { clock.t })
        var i = 0
        while i < samples.count {
            clock.t = samples[i].timestamp
            if (session.onFix(samples[i]).progress ?? 0) > 0.3 { break }
            i += 1
        }
        let v = session.interrupt(.hatter)
        #expect(v.phase == .megszakadt)
        #expect(v.live == nil)
        #expect(v.interruption?.reason == .hatter)
        #expect(v.section?.id == fx.course.id)
        // visszatérés a szakasz közepén: nincs új mérés, és nincs hamis eredmény
        for f in samples[(i + 30)...] {
            clock.t = f.timestamp
            let w = session.onFix(f)
            #expect(w.phase != .meres)
            #expect(w.phase != .befejezve)
        }
        clock.t += 61_000
        #expect(session.tick().phase == .nincsSzakasz)
    }

    @Test("kézi mód: indítás, átlag, leállítás után eredmény; háttérben megszakad")
    func kezi() {
        let samples = run(90)
        let clock = Clock()
        clock.t = samples[0].timestamp
        let session = TrackingSession([], now: { clock.t })
        #expect(session.startManual().phase == .kezi)
        for f in samples.prefix(120) {
            clock.t = f.timestamp
            session.onFix(f)
        }
        #expect(closeTo(session.view().manual?.averageKmh, 90, 0))
        let r = session.stopManual()
        #expect(r.phase == .keziEredmeny)
        #expect(r.manualResult?.gates != nil)
        session.startManual()
        #expect(session.interrupt().phase == .megszakadt)
    }
}
