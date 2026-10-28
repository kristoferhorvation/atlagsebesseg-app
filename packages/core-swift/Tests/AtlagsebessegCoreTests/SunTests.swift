import AtlagsebessegCore
import AtlagsebessegTestSupport
import Foundation
import Testing

// packages/core/test/sun.test.ts
private func utc(_ s: String) -> Double {
    ISO8601DateFormatter().date(from: s)!.timeIntervalSince1970 * 1000
}

private func minutesApart(_ a: Double?, _ b: Double) -> Double {
    abs((a ?? .nan) - b) / 60_000
}

// Referencia: csillagászati táblázatok (timeanddate.com), percre kerekítve, UTC-ben.
@Suite("sunTimes")
struct SunTimesTests {
    @Test("Budapest, nyári napforduló: napkelte 02:46, napnyugta 18:45 UTC")
    func budapest() {
        let t = sunTimes(utc("2026-06-21T10:00:00Z"), 47.4979, 19.0402)
        #expect(minutesApart(t.sunrise, utc("2026-06-21T02:46:00Z")) < 3)
        #expect(minutesApart(t.sunset, utc("2026-06-21T18:45:00Z")) < 3)
        #expect(t.civilDawn! < t.sunrise!)
        #expect(t.civilDusk! > t.sunset!)
    }

    @Test("Róma, téli napforduló: napkelte 06:34, napnyugta 15:42 UTC")
    func roma() {
        let t = sunTimes(utc("2026-12-21T12:00:00Z"), 41.9028, 12.4964)
        #expect(minutesApart(t.sunrise, utc("2026-12-21T06:34:00Z")) < 3)
        #expect(minutesApart(t.sunset, utc("2026-12-21T15:42:00Z")) < 3)
    }

    @Test("sarki nappal (Tromsø, június): nincs napkelte/napnyugta")
    func tromso() {
        let t = sunTimes(utc("2026-06-21T12:00:00Z"), 69.6492, 18.9553)
        #expect(t.sunrise == nil)
        #expect(t.sunset == nil)
    }
}

@Suite("sunPosition / sunPhase")
struct SunPhaseTests {
    let bp = (lat: 47.4979, lon: 19.0402)

    @Test("napkeltekor a magasság ≈ −0,83°")
    func napkelte() {
        let t = sunTimes(utc("2026-03-20T10:00:00Z"), bp.lat, bp.lon)
        let alt = sunPosition(t.sunrise!, bp.lat, bp.lon).altitudeDeg
        #expect(closeTo(alt, -0.833, 0))
    }

    @Test("napszakok Budapesten egy nyári napon")
    func napszakok() {
        func at(_ iso: String) -> SunPhase { sunPhase(utc(iso), bp.lat, bp.lon) }
        #expect(at("2026-06-21T10:00:00Z") == .nappal)
        #expect(at("2026-06-21T23:30:00Z") == .ejszaka)
        #expect(at("2026-06-21T02:40:00Z") == .hajnal)
        #expect(at("2026-06-21T18:55:00Z") == .alkony)
    }

    @Test("éjféli nap (Tromsø): a nap fent van, nem éjszaka (alacsony nap → hajnal/alkony)")
    func ejfeliNap() {
        let t = utc("2026-06-21T23:00:00Z")
        #expect(sunPosition(t, 69.6492, 18.9553).altitudeDeg > 0)
        #expect(sunPhase(t, 69.6492, 18.9553) != .ejszaka)
        #expect(sunPhase(utc("2026-06-21T10:00:00Z"), 69.6492, 18.9553) == .nappal)
    }
}
