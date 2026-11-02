import AtlagsebessegCore
import Foundation

// AW20: mesterséges, több „utas” hőtérkép-adat a szimulátorhoz (`-heatSeed YES`) – a packages/app-logic/src/heatSeed.ts
// 1:1 portja (determinisztikus, bitre azonos számokkal). Éles használatban nincs.

nonisolated enum HEAT_SEED {
    static let riders = 12
    static let stepM = 55.0
}

nonisolated private let M1: [(Double, Double)] = [(47.4979, 19.0402), (47.4725, 18.8237), (47.5605, 18.4021), (47.6892, 17.6342)]
nonisolated private let CITY: [(Double, Double)] = [(47.4975, 19.0545), (47.5136, 19.0407), (47.4796, 19.0388), (47.4789, 19.0613), (47.4975, 19.0545)]
nonisolated private let SIDE: [(Double, Double)] = [(47.5136, 19.0407), (47.5578, 19.0425), (47.6126, 19.0628)]

/// mulberry32 – egész aritmetika (a JS `Math.imul` és `>>> 0` párja).
nonisolated private struct Rng {
    var a: UInt32
    init(_ seed: UInt32) { a = seed }
    mutating func next() -> Double {
        a = a &+ 0x6d2b79f5
        var t = a
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4294967296
    }
}

nonisolated struct SeedPoint: Equatable, Sendable {
    var lat: Double
    var lon: Double
    /// A pont sebessége (km/h).
    var kmh: Double
    /// Az utas sorszáma.
    var rider: Int
}

/// Pontok a töröttvonal mentén `stepM` lépéssel, `from`–`to` hányad között (0…1).
nonisolated private func along(_ line: [(Double, Double)], _ from: Double, _ to: Double) -> [(lat: Double, lon: Double)] {
    var lens: [Double] = []
    var total = 0.0
    for i in 1..<line.count {
        let d = haversineM(LatLon(lat: line[i - 1].0, lon: line[i - 1].1), LatLon(lat: line[i].0, lon: line[i].1))
        lens.append(d)
        total += d
    }
    var out: [(lat: Double, lon: Double)] = []
    var s = from * total
    while s <= to * total {
        var rest = s
        var i = 0
        while i < lens.count - 1 && rest > lens[i] {
            rest -= lens[i]
            i += 1
        }
        let f = min(1, rest / lens[i])
        let a = line[i], b = line[i + 1]
        out.append((a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f))
        s += HEAT_SEED.stepM
    }
    return out
}

/// Az összes utas pontjai (utasonként több áthaladás az M1-en, a városi körön és az oldalszakaszon).
nonisolated func heatSeedPoints() -> [SeedPoint] {
    var out: [SeedPoint] = []
    for rider in 0..<HEAT_SEED.riders {
        var r = Rng(UInt32(1000 + rider * 7919))
        let pace = 0.8 + r.next() * 0.4
        let m1Trips = 1 + Int((r.next() * 4).rounded(.down))
        for _ in 0..<m1Trips {
            let a = r.next() * 0.3
            let b = 0.55 + r.next() * 0.45
            for p in along(M1, a, b) { out.append(SeedPoint(lat: p.lat, lon: p.lon, kmh: jsRound((105 + r.next() * 25) * pace * 10) / 10, rider: rider)) }
        }
        let loops = 1 + Int((r.next() * 5).rounded(.down))
        for _ in 0..<loops {
            for p in along(CITY, 0, 1) { out.append(SeedPoint(lat: p.lat, lon: p.lon, kmh: jsRound((24 + r.next() * 26) * pace * 10) / 10, rider: rider)) }
        }
        if rider % 3 == 0 {
            for p in along(SIDE, 0, 1) { out.append(SeedPoint(lat: p.lat, lon: p.lon, kmh: jsRound((55 + r.next() * 20) * pace * 10) / 10, rider: rider)) }
        }
    }
    return out
}

/// A pontokból cellák (`cellOf`: a platform H3-a); a cellánként egymás utáni pontok egy áthaladás, a pontok időbélyege a sorrendjük.
nonisolated func heatSeedCells(cellOf: (Double, Double) -> String?) -> [HeatCell] {
    var cells: [String: HeatCell] = [:]
    var passes: [HeatPass] = []
    var run: (h3: String, rider: Int, sum: Double, n: Int)?
    func flush(_ t: Double) {
        if let r = run, r.n > 0 { passes.append(HeatPass(h3: r.h3, avgKmh: jsRound(r.sum / Double(r.n) * 10) / 10, t: t, fromStartM: 1000, toEndM: 1000)) }
        run = nil
    }
    var t = 1_790_000_000_000.0
    for p in heatSeedPoints() {
        t += 1000
        guard let h3 = cellOf(p.lat, p.lon) else { continue }
        if let r = run, r.h3 == h3, r.rider == p.rider {
            run = (r.h3, r.rider, r.sum + p.kmh, r.n + 1)
        } else {
            flush(t)
            run = (h3, p.rider, p.kmh, 1)
        }
    }
    flush(t)
    return mergePasses(&cells, passes)
}

/// A közösségi nézet sorai a mesterséges cellákból (hálózat nélkül): a darabszám az „utasok” miatt szorozva.
nonisolated func heatSeedGlobal(_ cells: [HeatCell], geo: HeatGeo, res: Int) -> [HeatGlobalRow] {
    struct G { var sumLat = 0.0, sumLon = 0.0, n = 0, count = 0, speed = 0.0 }
    var by: [String: G] = [:]
    var order: [String] = []
    for c in cells {
        let h3 = res >= 10 ? c.h3 : geo.parent(c.h3, res)
        let p = geo.center(c.h3)
        if by[h3] == nil { order.append(h3) }
        var g = by[h3] ?? G()
        g.sumLat += p.lat
        g.sumLon += p.lon
        g.n += 1
        g.count += c.count * 3
        g.speed += c.avgKmh * Double(c.count) * 3
        by[h3] = g
    }
    return order.map { h3 in
        let g = by[h3]!
        return HeatGlobalRow(h3: h3, lat: g.sumLat / Double(g.n), lon: g.sumLon / Double(g.n), count: g.count, avgSpeed: jsRound(g.speed / Double(g.count) * 10) / 10)
    }
}
