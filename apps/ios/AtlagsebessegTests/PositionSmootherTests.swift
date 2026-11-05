import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// AW23: a packages/app-logic/test/positionSmoother.test.ts párja (azonos nevekkel), ugyanazon a valódi 1 Hz-es nyomaton.

private let T0 = 1_800_000_000_000.0
private let frameMs = 1000.0 / 60

private struct Trace: Decodable {
    struct T: Decodable {
        let name: String
        let fixes: [[Double]]
    }
    let traces: [T]
}

private func traces() throws -> [Trace.T] {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: "gps-trace-1hz", withExtension: "json") ?? Bundle.main.url(forResource: "gps-trace-1hz", withExtension: "json"))
    return try JSONDecoder().decode(Trace.self, from: Data(contentsOf: url)).traces
}
private final class BundleToken {}

/// A nyomat GpsFix-ként: a sebesség és az irány a két szomszédos mintából (zajosabb, mint a CLLocation saját értékei).
private func fixes(_ raw: [[Double]]) -> [GpsFix] {
    raw.enumerated().map { i, r in
        let a = i > 0 ? LatLon(lat: raw[i - 1][1], lon: raw[i - 1][2]) : nil
        let p = LatLon(lat: r[1], lon: r[2])
        let d = a.map { haversineM($0, p) } ?? 0
        let dt = i > 0 ? r[0] - raw[i - 1][0] : 1
        return GpsFix(lat: r[1], lon: r[2], timestamp: T0 + r[0] * 1000, speed: dt > 0 ? d / dt : 0, accuracy: 5, heading: a != nil && d > 1 ? bearingDeg(a!, p) : nil)
    }
}

private struct Frame {
    let t, lat, lon, v: Double
}

/// Visszajátszás 60 fps-sel: képkockánként a megjelenített helyzet.
private func replay(_ list: [GpsFix], jitterMs: Double = 0) -> [Frame] {
    let s = PositionSmoother()
    var frames: [Frame] = []
    var i = 0
    let end = list.last!.timestamp + 1000
    var t = list[0].timestamp
    while t < end {
        while i < list.count, list[i].timestamp + (i % 2 == 1 ? jitterMs : 0) <= t {
            s.onFix(list[i], now: t)
            i += 1
        }
        if let p = s.at(t) { frames.append(Frame(t: t, lat: p.lat, lon: p.lon, v: p.speedMps)) }
        t += frameMs
    }
    return frames
}

private func dist(_ a: Frame, _ b: Frame) -> Double { haversineM(LatLon(lat: a.lat, lon: a.lon), LatLon(lat: b.lat, lon: b.lon)) }
private func steps(_ f: [Frame]) -> [(d: Double, dt: Double, v: Double)] {
    (1..<f.count).map { (dist(f[$0 - 1], f[$0]), f[$0].t - f[$0 - 1].t, f[$0].v) }
}

@Suite("AW23: a jelölő egyenletes mozgása")
struct PositionSmootherTests {
    @Test("valódi 1 Hz-es nyomat: egy képkockán belül nincs a várható elmozdulás kétszerését elérő ugrás")
    func nyomat() throws {
        for tr in try traces() {
            let list = fixes(tr.fixes)
            let st = steps(replay(list))
            for x in st { #expect(x.d <= 2 * max(x.v, 1) * x.dt / 1000 + 1e-6) }
            let rawMax = (1..<list.count).map { haversineM(list[$0 - 1], list[$0]) }.max()!
            #expect(rawMax > 5)
            #expect(st.map(\.d).max()! < rawMax / 5)
        }
    }

    @Test("valódi 1 Hz-es nyomat: ±150 ms-os érkezési ingadozásnál sincs ugrás, és a jelölő nem marad le a fixtől")
    func ingadozas() throws {
        for tr in try traces() {
            let list = fixes(tr.fixes)
            let f = replay(list, jitterMs: 150)
            for x in steps(f) { #expect(x.d <= 2 * max(x.v, 1) * x.dt / 1000 + 1e-6) }
            for fix in list.dropFirst(5) {
                let at = f.first { $0.t >= fix.timestamp }!
                #expect(haversineM(LatLon(lat: at.lat, lon: at.lon), fix) < 40)
            }
        }
    }

    @Test("50 km/h, egyenes út, 1 Hz: képkockánként a várható elmozdulás körül, megállás nélkül")
    func egyenes() {
        let v = 50 / 3.6
        let list = (0..<60).map { i in GpsFix(lat: 47.5, lon: 19 + Double(i) * v / (111_195 * cos(47.5 * .pi / 180)), timestamp: T0 + Double(i) * 1000, speed: v, accuracy: 5, heading: 90) }
        let st = Array(steps(replay(list)).dropFirst(60).dropLast(60))
        let expected = v / 60
        for x in st {
            #expect(x.d < 2 * expected)
            #expect(x.d > 0.5 * expected)
        }
    }

    @Test("új fixnél nincs visszaugrás: fékezéskor sem megy hátra, állva a fixre áll")
    func fekezes() {
        let v = 50 / 3.6
        let list = (0..<20).map { i in GpsFix(lat: 47.5, lon: 19 + Double(min(i, 10)) * v / (111_195 * cos(47.5 * .pi / 180)), timestamp: T0 + Double(i) * 1000, speed: i >= 10 ? 0 : v, accuracy: 5, heading: 90) }
        let f = replay(list)
        for i in 1..<f.count {
            if f[i].t > T0 + 10_000 { break }
            #expect(f[i].lon >= f[i - 1].lon)
        }
        #expect(haversineM(LatLon(lat: f.last!.lat, lon: f.last!.lon), list.last!) < 2)
    }

    @Test("GPS-kiesésnél legfeljebb 1,5 s-ot becsül előre, utána megáll; nagy eltérésnél (> 80 m) ugrik")
    func kieses() {
        let s = PositionSmoother()
        let a = GpsFix(lat: 47.5, lon: 19, timestamp: T0, speed: 20, accuracy: 5, heading: 90)
        s.onFix(a, now: 0)
        var p = s.at(0)!
        var t = frameMs
        while t < 10_000 {
            p = s.at(t)!
            t += frameMs
        }
        #expect(haversineM(LatLon(lat: p.lat, lon: p.lon), a) < 35)
        s.onFix(GpsFix(lat: 47.5, lon: 19.01, timestamp: T0 + 11_000, speed: 20, accuracy: 5, heading: 90), now: 11_000)
        p = s.at(11_000 + frameMs)!
        #expect(haversineM(LatLon(lat: p.lat, lon: p.lon), LatLon(lat: 47.5, lon: 19.01)) < 2)
    }

    @Test("álló GPS-zajnál (< 0,7 m/s) nincs előrebecslés, a jelölő legfeljebb 1 m/s-mal mozog")
    func allo() {
        let list = (0..<30).map { i in GpsFix(lat: 47.5 + (i % 2 == 1 ? 2e-5 : 0), lon: 19, timestamp: T0 + Double(i) * 1000, speed: 0, accuracy: 5, heading: nil) }
        for x in steps(replay(list)) { #expect(x.d <= 1 * x.dt / 1000 + 1e-6) }
    }

    @Test("szimulátor-óra: gyorsított lejátszásnál a fixek óráját követi, valós módban soha")
    func szimOra() {
        let v = 20.0
        let mk = { (i: Int) in GpsFix(lat: 47.5, lon: 19 + Double(i) * v / (111_195 * cos(47.5 * .pi / 180)), timestamp: T0 + Double(i) * 1000, speed: v, accuracy: 5, heading: 90) }
        let sim = PositionSmoother(simClock: true)
        let real = PositionSmoother()
        var pSim: SmoothPose?
        var pReal: SmoothPose?
        for i in 0..<30 {
            let now = Double(i) * 83
            sim.onFix(mk(i), now: now)
            real.onFix(mk(i), now: now)
            for k in 0..<5 {
                pSim = sim.at(now + Double(k) * 16)
                pReal = real.at(now + Double(k) * 16)
            }
        }
        #expect(haversineM(LatLon(lat: pSim!.lat, lon: pSim!.lon), mk(29)) < 20)
        #expect(haversineM(LatLon(lat: pReal!.lat, lon: pReal!.lon), mk(29)) > 50)
    }
}
