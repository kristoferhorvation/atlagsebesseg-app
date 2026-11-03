import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// AW20: a packages/app-logic/test/heat.test.ts párja (azonos nevekkel) – hőtérkép, közösségi feltöltés, út-színezés.

private let T0 = 1_793_608_200_000.0 // 2026-11-02 (hétfő) 08:30 UTC
private let DEG_M = 111_195.0

/// Teszt-H3: a cella azonosítója „c<sor>_<oszlop>”, a középpont egy 0,001°-os rácson; a szülő 10×10 cellát fog össze.
private struct GridGeo: HeatGeo {
    func center(_ h3: String) -> LatLon {
        let parts = h3.dropFirst().split(separator: "_").compactMap { Double($0) }
        if h3.hasPrefix("p") {
            // „p<res>_<sor>_<oszlop>”
            let q = h3.dropFirst().split(separator: "_").compactMap { Double($0) }
            return LatLon(lat: 47 + q[1] * 0.01 + 0.005, lon: 19 + q[2] * 0.01 + 0.005)
        }
        return LatLon(lat: 47 + parts[0] * 0.001, lon: 19 + parts[1] * 0.001)
    }

    func parent(_ h3: String, _ res: Int) -> String {
        guard h3.hasPrefix("c") else { return h3 }
        let parts = h3.dropFirst().split(separator: "_").compactMap { Int($0) }
        return "p\(res)_\(parts[0] / 10)_\(parts[1] / 10)"
    }
}

private let geo = GridGeo()

private func cell(_ h3: String, _ count: Int, _ avgKmh: Double = 50) -> HeatCell { HeatCell(h3: h3, count: count, avgKmh: avgKmh, lastT: 0) }

/// Észak felé 1 Hz-es minták; minden `cellM` méteren új cella; a sebesség km/h.
private func drive(meters: Double, kmh: Double, cellM: Double = 100, t0: Double = T0, lat0: Double = 47) -> [TripSample] {
    var out: [TripSample] = []
    let mps = kmh / 3.6
    let n = Int(jsRound(meters / mps))
    for i in 0...n {
        let d = Double(i) * mps
        out.append(TripSample(tripId: "trip-1", t: t0 + Double(i) * 1000, lat: lat0 + d / DEG_M, lon: 19, speedKmh: kmh, heading: 0, accuracy: 5, h3: "c\(Int((d / cellM).rounded(.down)))_0", limitKmh: nil))
    }
    return out
}

private func pass(_ h3: String, _ avgKmh: Double, _ t: Double) -> HeatPass { HeatPass(h3: h3, avgKmh: avgKmh, t: t, fromStartM: 1000, toEndM: 1000) }

@Suite("tripPasses")
struct TripPassesTests {
    @Test("egymás utáni, azonos cellájú minták egy áthaladás")
    func egyAthaladas() {
        let passes = tripPasses(drive(meters: 1000, kmh: 72, cellM: 100))
        #expect(passes.map(\.h3) == ["c0_0", "c1_0", "c2_0", "c3_0", "c4_0", "c5_0", "c6_0", "c7_0", "c8_0", "c9_0", "c10_0"])
        #expect(passes[3].avgKmh == 72)
    }

    @Test("az álló minták nem számítanak áthaladásnak")
    func allo() {
        let s = drive(meters: 500, kmh: 36, cellM: 100)
        let parked = s.enumerated().map { i, x -> TripSample in
            var y = x
            if i > 20 { y.speedKmh = 0; y.h3 = "c99_9" }
            return y
        }
        #expect(!tripPasses(parked).contains { $0.h3 == "c99_9" })
    }

    @Test("a cella átlaga a mozgó mintákból számol")
    func atlag() {
        let mixed = drive(meters: 90, kmh: 36, cellM: 100).enumerated().map { i, x -> TripSample in
            var y = x
            y.speedKmh = i % 2 == 0 ? 40 : 80
            return y
        }
        let p = tripPasses(mixed)
        #expect(p.count == 1)
        #expect(p[0].avgKmh > 55)
        #expect(p[0].avgKmh < 65)
    }

    @Test("a cella nélküli (h3 = null) minta kimarad, üres bemenet üres")
    func cellaNelkuli() {
        #expect(tripPasses([]).isEmpty)
        #expect(tripPasses(drive(meters: 300, kmh: 36).map { var y = $0; y.h3 = nil; return y }).isEmpty)
    }

    @Test("a távolság az út elejétől és végéig a mintákból számol")
    func tavolsag() {
        let passes = tripPasses(drive(meters: 1000, kmh: 72, cellM: 100))
        #expect(passes[0].fromStartM == 0)
        #expect(passes[5].fromStartM > 450)
        #expect(passes[5].fromStartM < 560)
        #expect(passes.last!.toEndM < 1)
    }

    @Test("ugyanabba a cellába 2 perc után visszatérve új áthaladás")
    func visszateres() {
        let a = drive(meters: 50, kmh: 36, cellM: 1000)
        let b = drive(meters: 50, kmh: 36, cellM: 1000, t0: T0 + 300_000)
        #expect(tripPasses(a + b).map(\.h3) == ["c0_0", "c0_0"])
    }
}

@Suite("mergePasses")
struct MergePassesTests {
    @Test("új cella: az első áthaladás értékei")
    func ujCella() {
        var cells: [String: HeatCell] = [:]
        let changed = mergePasses(&cells, [pass("c1_1", 50, 10)])
        #expect(cells["c1_1"] == HeatCell(h3: "c1_1", count: 1, avgKmh: 50, lastT: 10))
        #expect(changed.count == 1)
    }

    @Test("meglévő cella: a darabszám nő, az átlag súlyozott, az utolsó idő a legnagyobb")
    func meglevo() {
        var cells = ["c1_1": HeatCell(h3: "c1_1", count: 3, avgKmh: 60, lastT: 100)]
        mergePasses(&cells, [pass("c1_1", 100, 50)])
        #expect(cells["c1_1"] == HeatCell(h3: "c1_1", count: 4, avgKmh: 70, lastT: 100))
    }

    @Test("csak a módosult cellákat adja vissza, ugyanazt kétszer is egybe fogva")
    func csakValtozott() {
        var cells = ["c9_9": HeatCell(h3: "c9_9", count: 1, avgKmh: 10, lastT: 1)]
        let changed = mergePasses(&cells, [pass("c1_1", 50, 10), pass("c1_1", 70, 20)])
        #expect(changed.count == 1)
        #expect(changed[0] == HeatCell(h3: "c1_1", count: 2, avgKmh: 60, lastT: 20))
    }
}

@Suite("közösségi feltöltés")
struct HeatUploadTests {
    private let tz = 60.0 // CET
    private var passes: [HeatPass] { tripPasses(drive(meters: 2000, kmh: 72, cellM: 100)) }

    @Test("az út első és utolsó 300 m-ének cellái kimaradnak")
    func vegek() {
        let blocked = endCells(passes)
        #expect(blocked.contains("c0_0"))
        #expect(blocked.contains("c2_0"))
        #expect(!blocked.contains("c10_0"))
        #expect(blocked.contains("c20_0"))
        let cells = Set(uploadRows(passes, geo: geo, tzOffsetMin: tz).map(\.h3))
        #expect(!cells.contains("c1_0"))
        #expect(cells.contains("c10_0"))
        #expect(!cells.contains("c19_0"))
    }

    @Test("egy rövid út (600 m alatt) szinte semmit sem tölt fel, a 300 m-es sáv közepe sem")
    func rovid() {
        let short = tripPasses(drive(meters: 500, kmh: 36, cellM: 100))
        #expect(uploadRows(short, geo: geo, tzOffsetMin: tz).isEmpty)
    }

    @Test("a védett cella minden áthaladása kimarad, ha egyszer az út végén járt")
    func vedett() {
        let loop = [
            HeatPass(h3: "c5_5", avgKmh: 40, t: T0, fromStartM: 100, toEndM: 5000),
            HeatPass(h3: "c6_6", avgKmh: 40, t: T0 + 1000, fromStartM: 2000, toEndM: 3000),
            HeatPass(h3: "c5_5", avgKmh: 40, t: T0 + 2000, fromStartM: 4900, toEndM: 100),
        ]
        #expect(uploadRows(loop, geo: geo, tzOffsetMin: tz).map(\.h3) == ["c6_6"])
    }

    @Test("a sor csak aggregátum: cella, darabszám, átlag, óra, nap – a helyi időzónában")
    func aggregatum() throws {
        let rows = uploadRows(passes, geo: geo, tzOffsetMin: tz)
        let r = try #require(rows.first { $0.h3 == "c10_0" })
        let json = try #require((try JSONSerialization.jsonObject(with: JSONEncoder().encode(r))) as? [String: Any])
        #expect(json.keys.sorted() == ["avg_speed", "count", "dow", "h3", "h3_r8", "hour", "lat", "lon"])
        #expect(r.hour == 9) // 08:30 UTC + 1 óra
        #expect(r.dow == 1) // hétfő
        #expect(r.count == 1)
        #expect(r.avgSpeed == 72)
        #expect(r.h3R8 == "p8_1_0")
        #expect(abs(r.lat - 47.01) < 1e-5)
    }

    @Test("az azonos (cella, óra, nap) áthaladások egy sorba vonódnak")
    func osszevonas() {
        let many = [10.0, 20, 30].enumerated().map { i, v in HeatPass(h3: "c50_5", avgKmh: v, t: T0 + Double(i) * 60_000, fromStartM: 5000, toEndM: 5000) }
        let rows = uploadRows(many, geo: geo, tzOffsetMin: tz)
        #expect(rows.count == 1)
        #expect(rows[0].count == 3)
        #expect(rows[0].avgSpeed == 20)
    }

    @Test("a pontos idő nem szivárog: a sorokban nincs időbélyeg, az órasáv egész óra")
    func nincsIdo() throws {
        for r in uploadRows(passes, geo: geo, tzOffsetMin: tz) {
            #expect(r.hour >= 0 && r.hour <= 23)
            let s = String(decoding: try JSONEncoder().encode(r), as: UTF8.self)
            #expect(s.range(of: #"\d{10,}"#, options: .regularExpression) == nil)
        }
    }

    @Test("a feltöltés-várólista sérült tartalomnál üres, és a határnál a legrégebbiek esnek ki")
    func varolista() throws {
        #expect(parseHeatOutbox("nem json").isEmpty)
        #expect(parseHeatOutbox(nil).isEmpty)
        let row = uploadRows(passes, geo: geo, tzOffsetMin: tz)[0]
        let mixed = "[\(serializeHeatOutbox([row]).dropFirst().dropLast()),{\"x\":1}]"
        #expect(parseHeatOutbox(mixed) == [row])
        let big = Array(repeating: row, count: Int(HEAT.outboxMax))
        var a = row; a.count = 9
        var b = row; b.count = 8
        #expect(appendHeatOutbox(big, [a, b]).count == Int(HEAT.outboxMax))
        #expect(appendHeatOutbox(big, [a]).last!.count == 9)
    }
}

@Suite("megjelenítés")
struct HeatDisplayTests {
    @Test("zoom-függő felbontás: közelről 10, kicsinyítve 8")
    func zoom() {
        #expect(heatResForZoom(15) == 10)
        #expect(heatResForZoom(12.5) == 10)
        #expect(heatResForZoom(12.4) == 8)
        #expect(heatResForZoom(7) == 8)
    }

    @Test("a súly: gyakoriságnál a logaritmikus darabszám, sebességnél az átlag a skálán")
    func suly() {
        #expect(heatWeight(cell("a", 1), .gyakorisag) > 0)
        #expect(heatWeight(cell("a", 1), .gyakorisag) < heatWeight(cell("a", 5), .gyakorisag))
        #expect(heatWeight(cell("a", 500), .gyakorisag) == 1)
        #expect(abs(heatWeight(cell("a", 1, 65), .atlagsebesseg) - 0.5) < 1e-5)
        #expect(heatWeight(cell("a", 1, 300), .atlagsebesseg) == 1)
    }

    @Test("az összevonás súlyozott átlagot és összegzett darabszámot ad")
    func osszevonas() throws {
        let out = coarsenCells([cell("c1_1", 1, 40), cell("c2_2", 3, 80), cell("c55_5", 2, 100)], geo: geo)
        #expect(out.count == 2)
        let p = try #require(out.first { $0.h3 == "p8_0_0" })
        #expect(p.count == 4)
        #expect(p.avgKmh == 70)
    }

    @Test("közelről res-10 pontok, csak a látható téglalapban")
    func kozelrol() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c10_10", 1), cell("c500_500", 1)])
        let r = idx.points(HeatViewport(zoom: 15, bbox: BBox(south: 46.99, west: 18.99, north: 47.03, east: 19.03)), .gyakorisag)
        #expect(r.res == 10)
        #expect(r.points.count == 1)
        #expect(abs(r.points[0].lat - 47.01) < 1e-5)
    }

    @Test("kicsinyítve res-8-ra összevont pontok")
    func kicsinyitve() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c1_1", 1), cell("c2_2", 1), cell("c3_3", 1)])
        let r = idx.points(HeatViewport(zoom: 9, bbox: BBox(south: 46.9, west: 18.9, north: 47.1, east: 19.1)), .gyakorisag)
        #expect(r.res == 8)
        #expect(r.points.count == 1)
        #expect(abs(r.points[0].weight - heatWeight(count: 3, avgKmh: 50, view: .gyakorisag)) < 1e-5)
    }

    @Test("közelről is res-8-ra vált, ha a látható rész a pontplafonnál több cellát tartalmazna")
    func plafon() {
        let idx = HeatIndex(geo: geo)
        var cells: [HeatCell] = []
        for r in 0..<70 { for c in 0..<70 { cells.append(cell("c\(r)_\(c)", 1)) } }
        idx.setAll(cells)
        #expect(Double(cells.count) > HEAT.maxFeatures)
        let r = idx.points(HeatViewport(zoom: 14, bbox: BBox(south: 46.9, west: 18.9, north: 47.2, east: 19.2)), .gyakorisag)
        #expect(r.res == 8)
        #expect(Double(r.points.count) < HEAT.maxFeatures)
    }

    @Test("az upsert után a res-8 összesítés újraépül (inkrementális frissítés)")
    func upsert() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c1_1", 1)])
        let vp = HeatViewport(zoom: 9, bbox: BBox(south: 46.9, west: 18.9, north: 47.1, east: 19.1))
        #expect(abs(idx.points(vp, .gyakorisag).points[0].weight - heatWeight(count: 1, avgKmh: 50, view: .gyakorisag)) < 1e-5)
        idx.upsert([cell("c1_1", 9), cell("c2_2", 1)])
        #expect(idx.size == 2)
        #expect(abs(idx.points(vp, .gyakorisag).points[0].weight - heatWeight(count: 10, avgKmh: 50, view: .gyakorisag)) < 1e-5)
    }
}

@Suite("közösségi lekérés")
struct HeatQueryTests {
    @Test("a lekérés téglalapja a rácsra kerekített, kifelé; a kis mozgatás ugyanaz a kulcs")
    func teglalap() {
        let a = heatQueryBox(BBox(south: 47.4, west: 19.0, north: 47.5, east: 19.1))
        let b = heatQueryBox(BBox(south: 47.401, west: 19.001, north: 47.501, east: 19.101))
        #expect(heatQueryKey(a, 10) == heatQueryKey(b, 10))
        #expect(a.south <= 47.4)
        #expect(a.north >= 47.5)
        #expect(heatQueryKey(a, 8) != heatQueryKey(a, 10))
    }

    @Test("a gyorsítótár 10 percig tart")
    func gyorsitotar() {
        var now = 1000.0
        let cache = HeatGlobalCache(now: { now })
        let rows = [HeatGlobalRow(h3: "x", lat: 47, lon: 19, count: 3, avgSpeed: 60)]
        cache.set("k", rows)
        now += 9 * 60_000
        #expect(cache.get("k") == rows)
        now += 2 * 60_000
        #expect(cache.get("k") == nil)
        #expect(cache.get("nincs") == nil)
    }

    @Test("a közösségi sorokból súlyozott pontok lesznek")
    func pontok() {
        let pts = globalPoints([HeatGlobalRow(h3: "x", lat: 47, lon: 19, count: 4, avgSpeed: 65)], .atlagsebesseg)
        #expect(pts == [HeatPoint(lat: 47, lon: 19, weight: 0.5)])
    }
}

@Suite("beállítások (hőtérkép)")
struct HeatSettingsTests {
    @Test("a hőtérkép alapból saját, gyakoriság; a megosztás alapból KI")
    func alapertek() {
        let s = Settings.parse(nil)
        #expect(s.hoterkep == .sajat)
        #expect(s.hoterkepNezet == .gyakorisag)
        #expect(!s.adatmegosztas)
    }

    @Test("érvénytelen érték helyett az alapértelmezés, érvényes megmarad")
    func ervenyesites() {
        let ok = Settings.parse(#"{"hoterkep":"kozossegi","hoterkep_nezet":"atlagsebesseg","adatmegosztas":true}"#)
        #expect(ok.hoterkep == .kozossegi)
        #expect(ok.hoterkepNezet == .atlagsebesseg)
        #expect(ok.adatmegosztas)
        let bad = Settings.parse(#"{"hoterkep":"x","hoterkep_nezet":7,"adatmegosztas":"igen"}"#)
        #expect(bad.hoterkep == .sajat)
        #expect(bad.hoterkepNezet == .gyakorisag)
        #expect(!bad.adatmegosztas)
        #expect(Settings.parse(ok.serialized()) == ok)
    }
}

@Suite("az út színezése")
struct SpeedToneTests {
    private func near(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-5 }

    @Test("limit mellett a limithez képest: 90% alatt zöld, a limitnél sárga, 115% fölött piros")
    func limittel() {
        #expect(speedTone(80, 100) == 0)
        #expect(speedTone(90, 100) == 0)
        #expect(near(speedTone(100, 100), 0.5))
        #expect(speedTone(115, 100) == 1)
        #expect(speedTone(140, 100) == 1)
        #expect(near(speedTone(95, 100), 0.25))
    }

    @Test("limit nélkül abszolút skálán: 50 alatt zöld, 90 sárga, 130 fölött piros")
    func limitNelkul() {
        #expect(speedTone(30, nil) == 0)
        #expect(near(speedTone(90, nil), 0.5))
        #expect(speedTone(130, nil) == 1)
        #expect(near(speedTone(70, nil), 0.25))
    }

    @Test("a szakaszok az azonos fokozatú mintákból állnak, közös ponttal kapcsolódnak")
    func szakaszok() {
        let mixed = drive(meters: 600, kmh: 36).enumerated().map { i, x -> TripSample in
            var y = x
            y.speedKmh = i < 30 ? 60 : 130
            y.limitKmh = 100
            return y
        }
        let runs = speedRuns(mixed)
        #expect(runs.count >= 2)
        #expect(runs[0].tone == 0)
        #expect(runs.last!.tone == 1)
        #expect(runs[1].points[0] == runs[0].points.last!)
    }

    @Test("ugrásnál és nagy résnél új szakasz, pontatlan minta kimarad")
    func ugras() {
        let a = drive(meters: 200, kmh: 36)
        let b = drive(meters: 200, kmh: 36, t0: T0 + 120_000, lat0: 47.2)
        #expect(speedRuns(a + b).count == 2)
        let noisy = a.enumerated().map { i, x -> TripSample in
            var y = x
            if i == 5 { y.accuracy = 200; y.lat = 48 }
            return y
        }
        #expect(speedRuns(noisy).count == 1)
    }

    @Test("a sebesség nélküli minta az előző színét kapja")
    func sebessegNelkul() {
        let s = drive(meters: 300, kmh: 36).enumerated().map { i, x -> TripSample in
            var y = x
            y.speedKmh = i == 10 ? nil : 36
            y.limitKmh = nil
            return y
        }
        #expect(speedRuns(s).count == 1)
    }
}

@Suite("H3 (SwiftyH3 = h3-js)")
struct H3ParityTests {
    @Test("a res-10 cella, a középpontja és a res-8 szülője egyezik a webes h3-js-sel")
    func h3Egyezes() {
        // node: latLngToCell(47.4979, 19.0402, 10), cellToParent(…, 8), cellToLatLng
        let cell = tripCell(47.4979, 19.0402)
        #expect(cell == "8a1e03785377fff")
        let g = H3Geo()
        #expect(g.parent("8a1e03785377fff", 8) == "881e037853fffff")
        let c = g.center("8a1e03785377fff")
        #expect(abs(c.lat - 47.498010386470554) < 1e-9)
        #expect(abs(c.lon - 19.04057143467165) < 1e-9)
        let pc = g.center("881e037853fffff")
        #expect(abs(pc.lat - 47.49496974387294) < 1e-9)
        #expect(abs(pc.lon - 19.039866102059957) < 1e-9)
    }
}

// AOS: háttér-helymeghatározás (AW20, 0. pont) – a futó szakaszmérés és a navigáció háttérbe kerüléskor folytatódik.
@Suite("háttér-helymeghatározás")
struct BackgroundLocationTests {
    private static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Atlagsebesseg")

    @Test("az Info.plist a location háttér-módot kéri")
    func infoPlist() throws {
        let data = try Data(contentsOf: Self.root.appendingPathComponent("Info.plist"))
        let plist = try #require(try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let modes = try #require(plist["UIBackgroundModes"] as? [String])
        #expect(modes.contains("location"))
    }

    @Test("a CoreLocationSource háttérben is frissít, és semmi nem állítja le háttérbe kerüléskor")
    func forras() throws {
        let src = try String(contentsOf: Self.root.appendingPathComponent("Location/CoreLocationSource.swift"), encoding: .utf8)
        #expect(src.contains("allowsBackgroundLocationUpdates = true"))
        #expect(src.contains("CLBackgroundActivitySession"))
        #expect(src.contains("pausesLocationUpdatesAutomatically = false"))
        // a scenePhase csak pillanatképet ment (checkpointTrip) és Live Activity-t újraindít, a GPS-t nem állítja le
        let app = try String(contentsOf: Self.root.appendingPathComponent("App/AtlagsebessegApp.swift"), encoding: .utf8)
        let bg = try #require(app.range(of: "phase == .background"))
        let line = app[bg.lowerBound...].prefix(while: { $0 != "\n" })
        #expect(line.contains("checkpointTrip"))
        #expect(!line.contains("stop"))
    }
}

// AW20: a mesterséges `-heatSeed` adat a webes heatSeed.ts-sel bitre azonos (a TS-ből mért ellenőrző számokkal).
@Suite("heatSeed (mesterséges, több utas adat)")
struct HeatSeedTests {
    @Test("a pontok száma, sebesség-összege, első és utolsó pontja egyezik a webes generátoréval")
    func pontok() throws {
        let p = heatSeedPoints()
        #expect(p.count == 42880)
        #expect(abs(p.reduce(0) { $0 + $1.kmh } - 4_674_674.7) < 0.5)
        #expect(abs(p[0].lat - 47.48867400082572) < 1e-9)
        #expect(abs(p[0].lon - 18.746211832407685) < 1e-9)
        #expect(p[0].kmh == 117.9)
        #expect(p.last!.rider == 11)
        #expect(p.last!.kmh == 40.5)
    }

    @Test("a cellák száma, az áthaladások összege és a súlyozott sebesség egyezik (valódi H3-mal)")
    func cellak() {
        let cells = heatSeedCells(cellOf: tripCell)
        #expect(cells.count == 1212)
        #expect(cells.reduce(0) { $0 + $1.count } == 21004)
        #expect(abs(cells.reduce(0) { $0 + $1.avgKmh * Double($1.count) } - 2_295_276.1) < 1)
    }

    @Test("a közösségi sorok res-8-on összevonva, a darabszám az utasok miatt háromszoros")
    func kozossegi() {
        let cells = heatSeedCells(cellOf: tripCell)
        let fine = heatSeedGlobal(cells, geo: H3Geo(), res: 10)
        let coarse = heatSeedGlobal(cells, geo: H3Geo(), res: 8)
        #expect(fine.count == cells.count)
        #expect(coarse.count < fine.count)
        #expect(fine.reduce(0) { $0 + $1.count } == 3 * 21004)
        #expect(coarse.reduce(0) { $0 + $1.count } == 3 * 21004)
    }

    @Test("a mesterséges pontok determinisztikusak")
    func determinisztikus() {
        #expect(heatSeedPoints().map { $0.lat } == heatSeedPoints().map { $0.lat })
        #expect(heatSeedPoints().count > 1000)
    }

    @Test("a mesterséges cellák Budapest és Győr között húzódnak, az M1 gyorsabb a városnál")
    func m1Gyorsabb() {
        let cells = heatSeedCells { lat, lon in "\(Int((lat * 1000).rounded())):\(Int((lon * 1000).rounded()))" }
        #expect(cells.count > 1500)
        func parts(_ c: HeatCell) -> (Int, Int) { let p = c.h3.split(separator: ":"); return (Int(p[0])!, Int(p[1])!) }
        let m1 = cells.filter { parts($0).1 < 18500 }
        let city = cells.filter { parts($0).1 >= 19030 && parts($0).0 < 47510 && parts($0).0 > 47470 }
        func avg(_ l: [HeatCell]) -> Double { l.reduce(0) { $0 + $1.avgKmh } / Double(l.count) }
        #expect(avg(m1) > avg(city) + 40)
        #expect((cells.map { $0.count }.max() ?? 0) > 3)
    }

    @Test("a közösségi sorok a res-8 összevonásnál kevesebb, de súlyosabb cellát adnak")
    func kozossegiOsszevonas() {
        let cells = heatSeedCells { lat, lon in "c\(Int(floor((lat - 46) / 0.001)))_\(Int(floor((lon - 17) / 0.001)))" }
        let fine = heatSeedGlobal(cells, geo: GridGeo(), res: 10)
        let coarse = heatSeedGlobal(cells, geo: GridGeo(), res: 8)
        #expect(coarse.count < fine.count)
        #expect(coarse.reduce(0) { $0 + $1.count } == fine.reduce(0) { $0 + $1.count })
    }
}

@Suite("adatvédelmi zónák")
struct HeatZoneTests {
    private static let home = Place(id: "home", name: "Haza", address: "", lat: 47.01, lon: 19.01)
    private static let saved = SavedPlaces(
        home: home,
        work: Place(id: "work", name: "Munka", address: "", lat: 47.2, lon: 19.3),
        others: [Place(id: "o1", name: "Anyós", address: "", lat: 47.4, lon: 19.5)]
    )
    private let zone = HeatZone(id: "home", lat: 47.01, lon: 19.01, radiusM: 200)
    private func pass(_ h3: String, _ t: Double = T0) -> HeatPass { HeatPass(h3: h3, avgKmh: 50, t: t, fromStartM: 5000, toEndM: 5000) }

    @Test("a mentett helyek körül zóna van, alapból 500 m, helyenként állítható")
    func alap() {
        let z = heatZones(Self.saved, ["work": 1000])
        #expect(z.map(\.id) == ["home", "work", "o1"])
        #expect(z.map(\.radiusM) == [500, 1000, 500])
        #expect(heatZones(SavedPlaces(home: nil, work: nil, others: []), [:]).isEmpty)
    }

    @Test("érvénytelen zónasugár helyett az alapértelmezés (csak 200 m / 500 m / 1 km választható)")
    func ervenytelen() {
        #expect(parseZoneRadii(["home": 200, "work": 777, "o1": "500", "x": 1000]) == ["home": 200, "x": 1000])
        #expect(parseZoneRadii(nil).isEmpty)
        #expect(parseZoneRadii([200]).isEmpty)
        #expect(Settings.parse(#"{"zona_m":{"home":1000,"work":5}}"#).zonaM == ["home": 1000])
        #expect(Settings.parse(nil).zonaM.isEmpty)
        #expect(heatZones(Self.saved, ["home": 777])[0].radiusM == 500)
    }

    @Test("a zónában lévő cellák sosem kerülnek a feltöltésbe, a zónán kívüliek igen")
    func feltoltes() {
        let passes = [pass("c10_10"), pass("c10_11"), pass("c60_60")]
        #expect(uploadRows(passes, geo: geo, tzOffsetMin: 60, endsM: HEAT.shareEndsM, zones: [zone]).map(\.h3) == ["c60_60"])
        #expect(uploadRows(passes, geo: geo, tzOffsetMin: 60, endsM: HEAT.shareEndsM, zones: []).map(\.h3) == ["c10_10", "c10_11", "c60_60"])
    }

    @Test("a zóna sugara a cella élével (ráhagyás) számít: a határon lévő cella is védett")
    func rahagyas() {
        var z = zone
        z.radiusM = 200
        #expect(!inZone(geo.center("c10_14"), [z]))
        z.radiusM = 250
        #expect(inZone(geo.center("c10_14"), [z]))
        z.radiusM = 200
        #expect(!inZone(geo.center("c10_14"), [z], marginM: 0))
    }

    @Test("a zónában lévő cellák szürkén jelennek meg (nem színezve), a többi színezve")
    func szurke() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c10_10", 1), cell("c10_11", 1), cell("c30_30", 1)])
        idx.setZones([zone])
        let r = idx.points(HeatViewport(zoom: 15, bbox: BBox(south: 46.99, west: 18.99, north: 47.05, east: 19.05)), .gyakorisag)
        #expect(r.res == 10)
        #expect(r.points.count == 1)
        #expect(r.grey.count == 2)
    }

    @Test("kicsinyítve (res 8) is külön csoportban: a zóna cellái szürkék maradnak")
    func szurkeKicsinyitve() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c10_10", 1), cell("c11_11", 1), cell("c60_60", 1), cell("c61_61", 1)])
        idx.setZones([zone])
        let r = idx.points(HeatViewport(zoom: 9, bbox: BBox(south: 46.9, west: 18.9, north: 47.2, east: 19.2)), .gyakorisag)
        #expect(r.res == 8)
        #expect(r.grey.count == 1)
        #expect(r.points.count == 1)
    }

    @Test("a zónák módosítása után a szürke / színezett felosztás újraszámolódik")
    func ujraszamol() {
        let idx = HeatIndex(geo: geo)
        idx.setAll([cell("c10_10", 1)])
        let vp = HeatViewport(zoom: 15, bbox: BBox(south: 46.99, west: 18.99, north: 47.05, east: 19.05))
        #expect(idx.points(vp, .gyakorisag).points.count == 1)
        idx.setZones([zone])
        #expect(idx.points(vp, .gyakorisag).grey.count == 1)
        idx.setZones([])
        #expect(idx.points(vp, .gyakorisag).grey.isEmpty)
    }

    @Test("a feltöltött sor nem tartalmaz mentett helyet vagy zónát")
    func nincsZona() throws {
        let rows = uploadRows([pass("c60_60")], geo: geo, tzOffsetMin: 60, endsM: HEAT.shareEndsM, zones: [zone])
        let json = String(decoding: try JSONEncoder().encode(rows), as: UTF8.self)
        let obj = try #require(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]])
        #expect(Set(obj[0].keys) == ["avg_speed", "count", "dow", "h3", "h3_r8", "hour", "lat", "lon"])
        #expect(json.range(of: #"home|Haza|radius|zone|47\.01,19\.01"#, options: .regularExpression) == nil)
    }
}

// AW20-javítás, 4. pont: a zónák és a mentett helyek csak helyben élnek – a hálózati rétegben (Backend) semmi nem hivatkozik rájuk,
// és a feltöltött sor pontosan a 8 aggregált oszlop.
@Suite("zónák és mentett helyek csak helyben")
struct ZoneLocalOnlyTests {
    private static let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Atlagsebesseg")

    @Test("a Backend nem hivatkozik zónára, mentett helyre vagy beállításra; a heat_cells feltöltés csak a sorokat küldi")
    func backend() throws {
        let src = try String(contentsOf: Self.root.appendingPathComponent("Backend/Backend.swift"), encoding: .utf8)
        for word in ["HeatZone", "heatZones", "zonaM", "zona_m", "SavedPlaces", "SAVED_KEY", "savedPlaces", "settings"] {
            #expect(!src.contains(word), "a Backend hivatkozik erre: \(word)")
        }
        #expect(src.contains(#"insert(rows)"#))
    }

    @Test("a zónák a helyi tárolóban élnek: a mentett helyek és a zona_m csak a helyi tárolókba (UserDefaults) íródnak")
    func helyiTarolo() throws {
        let s = Settings.parse(#"{"zona_m":{"home":1000}}"#)
        #expect(s.serialized().contains(#""zona_m":{"home":1000}"#))
        let up = HeatUploadRow(h3: "8a1e03785377fff", h3R8: "881e037853fffff", lat: 47, lon: 19, count: 1, avgSpeed: 50, hour: 9, dow: 1)
        let keys = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(up)) as? [String: Any]).keys
        #expect(Set(keys) == ["avg_speed", "count", "dow", "h3", "h3_r8", "hour", "lat", "lon"])
    }
}

// AOS16: a megosztás kikapcsolása törli a várakozó sorokat (a webes `clearHeatOutbox`).
@Suite("feltöltési sor")
struct HeatOutboxClearTests {
    @Test("a törlés a sort kiüríti, és a kikapcsolás a beállítás-váltáskor és induláskor is töröl")
    func torles() throws {
        let d = try #require(UserDefaults(suiteName: "aos16-heat-outbox"))
        d.set("[{}]", forKey: AppModel.heatOutboxKey)
        AppModel.clearHeatOutbox(d)
        #expect(d.string(forKey: AppModel.heatOutboxKey) == nil)
        let app = try String(contentsOf: Repo.iosDir.appendingPathComponent("Atlagsebesseg/App/AppModel.swift"), encoding: .utf8)
        let heat = try String(contentsOf: Repo.iosDir.appendingPathComponent("Atlagsebesseg/App/AppModel+Heat.swift"), encoding: .utf8)
        #expect(app.contains("if !settings.adatmegosztas { Self.clearHeatOutbox() }"))
        #expect(heat.contains("if !settings.adatmegosztas { Self.clearHeatOutbox() }"))
    }
}
