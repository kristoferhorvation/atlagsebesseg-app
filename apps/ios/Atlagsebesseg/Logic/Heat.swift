import AtlagsebessegCore
import Foundation
import SwiftyH3

// AW20: hőtérkép – személyes (helyi) és közösségi (opt-in). A packages/app-logic/src/heat.ts 1:1 portja (a tesztek:
// HeatTests.swift, a heat.test.ts azonos nevű párjai). Az AW19 H3 res-10 mintáiból cellánkénti aggregátum készül
// (áthaladások száma, átlagsebesség, utolsó időbélyeg), inkrementálisan: egy út végén egyszer, nem minden rajzoláskor.
// A H3-műveletek (cella középpontja, szülő-cella) a `HeatGeo`-n át jönnek (iOS: SwiftyH3). A küszöbök a generált `HEAT`-ben.

/// Hőtérkép-mód a Beállításokban: ki / saját / közösségi.
nonisolated enum HeatMode: String, Codable, Sendable, CaseIterable {
    case ki, sajat, kozossegi
}

/// Mit mutat a hőtérkép: az áthaladások számát vagy az átlagsebességet.
nonisolated enum HeatView: String, Codable, Sendable, CaseIterable {
    case gyakorisag, atlagsebesseg
}

/// A választható zónasugarak (m): 200 m / 500 m / 1 km.
nonisolated let ZONE_RADII: [Int] = [200, 500, 1000]

/// Adatvédelmi zóna egy mentett hely körül (csak helyben él, szerverre nem megy).
nonisolated struct HeatZone: Equatable, Sendable {
    /// `home`, `work` vagy a további mentett hely azonosítója.
    var id: String
    var lat: Double
    var lon: Double
    var radiusM: Double
}

/// A tárolt zónasugarak (`hely-azonosító → m`) érvényesítése: csak a választható sugár marad.
nonisolated func parseZoneRadii(_ raw: Any?) -> [String: Int] {
    guard let o = raw as? [String: Any] else { return [:] }
    var out: [String: Int] = [:]
    for (k, v) in o {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { continue }
        let d = n.doubleValue
        if d == d.rounded(), ZONE_RADII.contains(Int(d)) { out[k] = Int(d) }
    }
    return out
}

/// Minden mentett hely (Haza, Munka, további) körül egy zóna; a sugár helyenként állítható, alapból 200 m.
nonisolated func heatZones(_ saved: SavedPlaces, _ radii: [String: Int]) -> [HeatZone] {
    func at(_ id: String, _ p: Place) -> HeatZone {
        let r = radii[id].flatMap { ZONE_RADII.contains($0) ? $0 : nil } ?? Int(HEAT.zoneDefaultM)
        return HeatZone(id: id, lat: p.lat, lon: p.lon, radiusM: Double(r))
    }
    var out: [HeatZone] = []
    if let h = saved.home { out.append(at("home", h)) }
    if let w = saved.work { out.append(at("work", w)) }
    out.append(contentsOf: saved.others.map { at($0.id, $0) })
    return out
}

/// A pont (cella középpontja) bármelyik zónában van-e (a sugárhoz `marginM` ráhagyással).
nonisolated func inZone(_ p: LatLon, _ zones: [HeatZone], marginM: Double = HEAT.zoneMarginM) -> Bool {
    zones.contains { haversineM(p, LatLon(lat: $0.lat, lon: $0.lon)) <= $0.radiusM + marginM }
}

/// Egy áthaladás egy cellán az út mintáiból.
nonisolated struct HeatPass: Equatable, Sendable {
    var h3: String
    /// A cellában mért átlagsebesség (km/h; a mozgó minták átlaga).
    var avgKmh: Double
    /// Az első minta ideje (ms).
    var t: Double
    /// Az út kezdetétől mért táv az első mintánál (m).
    var fromStartM: Double
    /// Az út végéig hátralévő táv az utolsó mintánál (m).
    var toEndM: Double
}

/// A cella összesítése (a helyi tárolóban cellánként egy sor).
nonisolated struct HeatCell: Equatable, Sendable {
    var h3: String
    var count: Int
    var avgKmh: Double
    /// Az utolsó áthaladás ideje (ms).
    var lastT: Double
}

/// Egy sor a közösségi feltöltésben (a `heat_cells` tábla oszlopai; a JSON-alak a webével azonos).
nonisolated struct HeatUploadRow: Codable, Equatable, Sendable {
    var h3: String
    var h3R8: String
    var lat: Double
    var lon: Double
    var count: Int
    var avgSpeed: Double
    var hour: Int
    var dow: Int

    enum CodingKeys: String, CodingKey {
        case h3, lat, lon, count, hour, dow
        case h3R8 = "h3_r8"
        case avgSpeed = "avg_speed"
    }
}

/// A közösségi nézet egy cellája (a `heat_global` / `heat_global_r8` sora).
nonisolated struct HeatGlobalRow: Codable, Equatable, Sendable {
    var h3: String
    var lat: Double
    var lon: Double
    var count: Int
    var avgSpeed: Double

    enum CodingKeys: String, CodingKey {
        case h3, lat, lon, count
        case avgSpeed = "avg_speed"
    }
}

/// A H3-műveletek (iOS: SwiftyH3; a tesztekben hamis rács).
nonisolated protocol HeatGeo {
    /// A cella középpontja.
    func center(_ h3: String) -> LatLon
    /// A szülő-cella a megadott felbontáson.
    func parent(_ h3: String, _ res: Int) -> String
}

/// A valódi H3 (SwiftyH3). Hibás azonosítónál a (0, 0) pont / az eredeti azonosító.
nonisolated struct H3Geo: HeatGeo {
    func center(_ h3: String) -> LatLon {
        guard let c = H3Cell(h3), let p = try? c.center else { return LatLon(lat: 0, lon: 0) }
        return LatLon(lat: p.latitudeDegs, lon: p.longitudeDegs)
    }

    func parent(_ h3: String, _ res: Int) -> String {
        guard let c = H3Cell(h3), let r = H3Cell.Resolution(rawValue: Int32(res)), let p = try? c.parent(at: r) else { return h3 }
        return p.description
    }
}

nonisolated private func round1(_ x: Double) -> Double { jsRound(x * 10) / 10 }
nonisolated private func round5(_ x: Double) -> Double { jsRound(x * 1e5) / 1e5 }

// MARK: áthaladások az út mintáiból

/// Az út mintáiból (időrendben) a cellánkénti áthaladások: egy áthaladás = ugyanabban a cellában egymás utáni minták.
/// Az átlag a mozgó mintákból számol; ha a cellában csak álló minta volt, nem áthaladás. A táv az út elejétől / végéig
/// a minták közti távolságokból (a `maxJumpKmh`-nál gyorsabb ugrás nem táv) – a lakóhely-védelemhez.
nonisolated func tripPasses(_ samples: [TripSample]) -> [HeatPass] {
    let s = samples.enumerated().filter { $0.element.h3 != nil }.sorted { $0.element.t != $1.element.t ? $0.element.t < $1.element.t : $0.offset < $1.offset }.map(\.element)
    if s.isEmpty { return [] }
    var cum: [Double] = [0]
    for i in 1..<max(1, s.count) {
        let a = s[i - 1], b = s[i]
        let d = haversineM(LatLon(lat: a.lat, lon: a.lon), LatLon(lat: b.lat, lon: b.lon))
        let dt = (b.t - a.t) / 1000
        cum.append(cum[i - 1] + (dt > 0 && d / dt * 3.6 <= TRIP.maxJumpKmh ? d : 0))
    }
    let total = cum[cum.count - 1]
    var out: [HeatPass] = []
    var i = 0
    while i < s.count {
        var j = i
        while j + 1 < s.count, s[j + 1].h3 == s[i].h3, s[j + 1].t - s[j].t <= HEAT.passGapMs { j += 1 }
        let moving = s[i...j].compactMap { x -> Double? in
            guard let v = x.speedKmh, v >= HEAT.minPassKmh else { return nil }
            return v
        }
        if !moving.isEmpty {
            out.append(HeatPass(h3: s[i].h3!, avgKmh: round1(moving.reduce(0, +) / Double(moving.count)), t: s[i].t, fromStartM: cum[i], toEndM: total - cum[j]))
        }
        i = j + 1
    }
    return out
}

/// Az áthaladások beolvasztása a cellák közé (a `cells` helyben módosul); a változott cellák listáját adja.
@discardableResult
nonisolated func mergePasses(_ cells: inout [String: HeatCell], _ passes: [HeatPass]) -> [HeatCell] {
    var order: [String] = []
    var changed: [String: HeatCell] = [:]
    for p in passes {
        let next: HeatCell
        if let c = cells[p.h3] {
            next = HeatCell(h3: p.h3, count: c.count + 1, avgKmh: round1((c.avgKmh * Double(c.count) + p.avgKmh) / Double(c.count + 1)), lastT: max(c.lastT, p.t))
        } else {
            next = HeatCell(h3: p.h3, count: 1, avgKmh: p.avgKmh, lastT: p.t)
        }
        cells[p.h3] = next
        if changed[p.h3] == nil { order.append(p.h3) }
        changed[p.h3] = next
    }
    return order.compactMap { changed[$0] }
}

// MARK: közösségi feltöltés (adatvédelem)

/// Az út első és utolsó `shareEndsM` méterének cellái (a lakóhely-védelem): minden áthaladásuk kimarad.
nonisolated func endCells(_ passes: [HeatPass], endsM: Double = HEAT.shareEndsM) -> Set<String> {
    var out = Set<String>()
    for p in passes where p.fromStartM < endsM || p.toEndM < endsM { out.insert(p.h3) }
    return out
}

/// A feltöltendő sorok: a védett cellák nélkül, (cella, óra, hét napja) szerint összevonva – nincs útvonal, nincs pontos
/// idő (csak az óra-sáv és a nap), nincs azonosító. Az adatvédelmi zónák cellái (mentett helyek körül) szintén kimaradnak. `tzOffsetMin`: a készülék UTC-eltolása percben (kelet pozitív).
nonisolated func uploadRows(_ passes: [HeatPass], geo: HeatGeo, tzOffsetMin: Double, endsM: Double = HEAT.shareEndsM, zones: [HeatZone] = []) -> [HeatUploadRow] {
    let blocked = endCells(passes, endsM: endsM)
    var zoneCache: [String: Bool] = [:]
    func zoned(_ h3: String) -> Bool {
        if let z = zoneCache[h3] { return z }
        let z = !zones.isEmpty && inZone(geo.center(h3), zones)
        zoneCache[h3] = z
        return z
    }
    struct G { var h3: String; var hour: Int; var dow: Int; var n: Int; var sum: Double }
    var groups: [String: G] = [:]
    var order: [String] = []
    for p in passes where !blocked.contains(p.h3) && !zoned(p.h3) {
        let ms = p.t + tzOffsetMin * 60_000
        let days = (ms / 86_400_000).rounded(.down)
        let hour = Int(((ms - days * 86_400_000) / 3_600_000).rounded(.down))
        // 1970-01-01 csütörtök (4); 0 = vasárnap, mint a JS `getUTCDay`
        let dow = ((Int(days) + 4) % 7 + 7) % 7
        let key = "\(p.h3)|\(hour)|\(dow)"
        if groups[key] == nil { order.append(key) }
        var g = groups[key] ?? G(h3: p.h3, hour: hour, dow: dow, n: 0, sum: 0)
        g.n += 1
        g.sum += p.avgKmh
        groups[key] = g
    }
    return order.compactMap { groups[$0] }.map { g in
        let c = geo.center(g.h3)
        return HeatUploadRow(h3: g.h3, h3R8: geo.parent(g.h3, Int(HEAT.coarseRes)), lat: round5(c.lat), lon: round5(c.lon), count: g.n, avgSpeed: round1(g.sum / Double(g.n)), hour: g.hour, dow: g.dow)
    }
}

/// A feltöltésre váró sorok a helyi tárolóból (sérült tartalom helyett üres).
nonisolated func parseHeatOutbox(_ raw: String?) -> [HeatUploadRow] {
    guard let raw, let data = raw.data(using: .utf8), let arr = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
    let dec = JSONDecoder()
    return arr.compactMap { item in
        guard JSONSerialization.isValidJSONObject(item), let d = try? JSONSerialization.data(withJSONObject: item) else { return nil }
        return try? dec.decode(HeatUploadRow.self, from: d)
    }
}

nonisolated func serializeHeatOutbox(_ rows: [HeatUploadRow]) -> String {
    String(decoding: (try? JSONEncoder().encode(rows)) ?? Data("[]".utf8), as: UTF8.self)
}

/// Új sorok a várakozók után; a legrégebbiek esnek ki, ha túllépi az `outboxMax`-ot.
nonisolated func appendHeatOutbox(_ queue: [HeatUploadRow], _ rows: [HeatUploadRow]) -> [HeatUploadRow] {
    Array((queue + rows).suffix(Int(HEAT.outboxMax)))
}

// MARK: megjelenítés

/// Az aktuális zoomhoz tartozó cella-felbontás: közelről 10, kicsinyítve 8.
nonisolated func heatResForZoom(_ zoom: Double) -> Int { zoom < HEAT.coarseBelowZoom ? Int(HEAT.coarseRes) : Int(HEAT.res) }

/// A hőtérkép-pont súlya (0…1) a módban.
nonisolated func heatWeight(count: Int, avgKmh: Double, view: HeatView) -> Double {
    switch view {
    case .gyakorisag: min(1, log1p(Double(count)) / log1p(HEAT.freqCap))
    case .atlagsebesseg: max(0, min(1, avgKmh / HEAT.speedMaxKmh))
    }
}

nonisolated func heatWeight(_ cell: HeatCell, _ view: HeatView) -> Double { heatWeight(count: cell.count, avgKmh: cell.avgKmh, view: view) }

/// Cellák összevonása szülő-cellákba (az áthaladások súlyozott átlagával).
nonisolated func coarsenCells(_ cells: some Sequence<HeatCell>, geo: HeatGeo, res: Int = Int(HEAT.coarseRes)) -> [HeatCell] {
    var out: [String: HeatCell] = [:]
    var order: [String] = []
    for c in cells {
        let key = geo.parent(c.h3, res)
        if let o = out[key] {
            out[key] = HeatCell(h3: key, count: o.count + c.count, avgKmh: round1((o.avgKmh * Double(o.count) + c.avgKmh * Double(c.count)) / Double(o.count + c.count)), lastT: max(o.lastT, c.lastT))
        } else {
            var n = c
            n.h3 = key
            out[key] = n
            order.append(key)
        }
    }
    return order.compactMap { out[$0] }
}

/// Egy pont a hőtérkép-rétegen.
nonisolated struct HeatPoint: Equatable, Sendable {
    var lat: Double
    var lon: Double
    var weight: Double
}

/// A látható terület a megjelenítéshez (a zoom és a téglalap).
nonisolated struct HeatViewport: Equatable, Sendable {
    var zoom: Double
    var bbox: BBox
}

nonisolated private func padded(_ b: BBox, _ f: Double) -> BBox {
    let dLat = (b.north - b.south) * f
    let dLon = (b.east - b.west) * f
    return BBox(south: b.south - dLat, west: b.west - dLon, north: b.north + dLat, east: b.east + dLon)
}

nonisolated private func inside(_ lat: Double, _ lon: Double, _ b: BBox) -> Bool { lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east }

/// A hőtérkép indexe: a cellák középpontját és az összevont (res-8) változatot gyorsítótárazza, így a rajzolás nem számol
/// újra mindent (a változás után csak a módosult cellák frissülnek, a res-8 összesítés lustán újraépül).
nonisolated final class HeatIndex {
    private let geo: HeatGeo
    private var cells: [String: HeatCell] = [:]
    private var centers: [String: LatLon] = [:]
    private var zones: [HeatZone] = []
    private var part: (fine: [HeatCell], zoned: [HeatCell])?
    private var coarse: (normal: [(cell: HeatCell, lat: Double, lon: Double)], zoned: [(cell: HeatCell, lat: Double, lon: Double)])?

    init(geo: HeatGeo) { self.geo = geo }

    var size: Int { cells.count }

    private func reset() {
        part = nil
        coarse = nil
    }

    /// A teljes tartalom cseréje.
    func setAll(_ list: some Sequence<HeatCell>) {
        cells.removeAll()
        reset()
        for c in list { cells[c.h3] = c }
    }

    /// Módosult cellák beolvasztása (egy út vége után).
    func upsert(_ list: some Sequence<HeatCell>) {
        for c in list { cells[c.h3] = c }
        reset()
    }

    /// Az adatvédelmi zónák: a bennük lévő cellák nem színeződnek, szürkén jelennek meg.
    func setZones(_ z: [HeatZone]) {
        zones = z
        reset()
    }

    func all() -> [String: HeatCell] { cells }

    private func center(_ h3: String) -> LatLon {
        if let c = centers[h3] { return c }
        let c = geo.center(h3)
        centers[h3] = c
        return c
    }

    /// A cellák két csoportra: normál, illetve zónában lévő (a zónán kívül eső cellák színeződnek).
    private func partition() -> (fine: [HeatCell], zoned: [HeatCell]) {
        if let p = part { return p }
        var fine: [HeatCell] = []
        var zoned: [HeatCell] = []
        for c in cells.values {
            if !zones.isEmpty, inZone(center(c.h3), zones) { zoned.append(c) } else { fine.append(c) }
        }
        part = (fine, zoned)
        return (fine, zoned)
    }

    private func coarseLists() -> (normal: [(cell: HeatCell, lat: Double, lon: Double)], zoned: [(cell: HeatCell, lat: Double, lon: Double)]) {
        if let c = coarse { return c }
        let p = partition()
        func build(_ list: [HeatCell]) -> [(cell: HeatCell, lat: Double, lon: Double)] {
            coarsenCells(list, geo: geo).map { cell in
                let c = geo.center(cell.h3)
                return (cell, c.lat, c.lon)
            }
        }
        let l = (normal: build(p.fine), zoned: build(p.zoned))
        coarse = l
        return l
    }

    /// A látható pontok: közelről res-10, kicsinyítve (vagy ha túl sok lenne) res-8; csak a látható téglalap (kis ráhagyással).
    /// A `grey` a zónákban lévő cellák (nem színezve, szürkén rajzolandók).
    func points(_ vp: HeatViewport, _ view: HeatView) -> (res: Int, points: [HeatPoint], grey: [HeatPoint]) {
        let box = padded(vp.bbox, HEAT.viewPad)
        if heatResForZoom(vp.zoom) == Int(HEAT.res) {
            let part = partition()
            func pick(_ list: [HeatCell]) -> [HeatPoint] {
                var out: [HeatPoint] = []
                for c in list {
                    let p = center(c.h3)
                    if inside(p.lat, p.lon, box) { out.append(HeatPoint(lat: p.lat, lon: p.lon, weight: heatWeight(c, view))) }
                }
                return out
            }
            let fine = pick(part.fine)
            let grey = pick(part.zoned)
            if Double(fine.count + grey.count) <= HEAT.maxFeatures { return (Int(HEAT.res), fine, grey) }
        }
        let lists = coarseLists()
        func pickC(_ l: [(cell: HeatCell, lat: Double, lon: Double)]) -> [HeatPoint] {
            l.filter { inside($0.lat, $0.lon, box) }.map { HeatPoint(lat: $0.lat, lon: $0.lon, weight: heatWeight($0.cell, view)) }
        }
        return (Int(HEAT.coarseRes), pickC(lists.normal), pickC(lists.zoned))
    }
}

/// A közösségi sorok pontokká (a súly a módban; a gyakoriság a beküldések száma).
nonisolated func globalPoints(_ rows: [HeatGlobalRow], _ view: HeatView) -> [HeatPoint] {
    rows.map { HeatPoint(lat: $0.lat, lon: $0.lon, weight: heatWeight(count: $0.count, avgKmh: $0.avgSpeed, view: view)) }
}

// MARK: közösségi lekérés: rácsra kerekített téglalap + 10 perces gyorsítótár

/// A lekérés téglalapja: a látható terület (ráhagyással) kifelé a `querySnapDeg` rácsra kerekítve.
nonisolated func heatQueryBox(_ bbox: BBox) -> BBox {
    let b = padded(bbox, HEAT.viewPad)
    let g = HEAT.querySnapDeg
    func r(_ x: Double) -> Double { jsRound(x * 1e6) / 1e6 }
    return BBox(south: r((b.south / g).rounded(.down) * g), west: r((b.west / g).rounded(.down) * g), north: r((b.north / g).rounded(.up) * g), east: r((b.east / g).rounded(.up) * g))
}

nonisolated func heatQueryKey(_ box: BBox, _ res: Int) -> String { "\(res):\(box.south),\(box.west),\(box.north),\(box.east)" }

/// A közösségi lekérések gyorsítótára: azonos (felbontás, téglalap) `cacheMs`-ig nem kér újra.
nonisolated final class HeatGlobalCache {
    private var entries: [String: (at: Double, rows: [HeatGlobalRow])] = [:]
    private let now: () -> Double

    init(now: @escaping () -> Double) { self.now = now }

    /// A friss bejegyzés, vagy `nil`.
    func get(_ key: String) -> [HeatGlobalRow]? {
        guard let e = entries[key] else { return nil }
        if now() - e.at > HEAT.cacheMs {
            entries[key] = nil
            return nil
        }
        return e.rows
    }

    func set(_ key: String, _ rows: [HeatGlobalRow]) { entries[key] = (now(), rows) }
}

// MARK: az út színezése a mért sebesség szerint (napló-részlet)

/// Sebesség → szín-hely (0 zöld, 0,5 sárga, 1 piros). Ismert tábla-limitnél a limithez képest (≤ 90% zöld, a limitnél sárga,
/// ≥ 115% piros); különben abszolút skálán (≤ 50 zöld, 90 sárga, ≥ 130 km/h piros).
nonisolated func speedTone(_ kmh: Double, _ limitKmh: Double?) -> Double {
    let g: Double, y: Double, r: Double
    if let l = limitKmh, l > 0 {
        (g, y, r) = (SPEED_TONE.relGreen * l, SPEED_TONE.relYellow * l, SPEED_TONE.relRed * l)
    } else {
        (g, y, r) = (SPEED_TONE.absGreen, SPEED_TONE.absYellow, SPEED_TONE.absRed)
    }
    if kmh <= g { return 0 }
    if kmh >= r { return 1 }
    return kmh <= y ? 0.5 * (kmh - g) / (y - g) : 0.5 + 0.5 * (kmh - y) / (r - y)
}

/// Egy egyszínű útszakasz a részlet-térképen.
nonisolated struct SpeedRun: Equatable, Sendable {
    /// A szín-hely lépcsőzve (`SPEED_TONE.steps` fokozat, 0…1).
    var tone: Double
    var points: [LatLon]
}

/// Az út színezett szakaszai a mintákból: egymás utáni, azonos fokozatú minták egy szakasz (a szomszédos szakaszok
/// közös ponttal kapcsolódnak). Pontatlan (> `maxAccuracyM`) minta kimarad; ugrásnál (> `maxJumpKmh`) vagy 10 s-nál
/// nagyobb résnél új szakasz kezdődik; a sebesség nélküli minta az előző színét kapja.
nonisolated func speedRuns(_ samples: [TripSample]) -> [SpeedRun] {
    let s = samples.enumerated().sorted { $0.element.t != $1.element.t ? $0.element.t < $1.element.t : $0.offset < $1.offset }.map(\.element)
        .filter { $0.accuracy == nil || $0.accuracy! <= TRIP.maxAccuracyM }
    var out: [SpeedRun] = []
    var tone = 0.0
    var prev: TripSample?
    var cur: Int?
    for x in s {
        if let v = x.speedKmh { tone = jsRound(speedTone(v, x.limitKmh) * SPEED_TONE.steps) / SPEED_TONE.steps }
        let pt = LatLon(lat: jsRound(x.lat * 1e6) / 1e6, lon: jsRound(x.lon * 1e6) / 1e6)
        var jump = false
        if let p = prev {
            let dt = (x.t - p.t) / 1000
            jump = dt > 10 || (dt > 0 && haversineM(LatLon(lat: p.lat, lon: p.lon), LatLon(lat: x.lat, lon: x.lon)) / dt * 3.6 > TRIP.maxJumpKmh)
        }
        if cur == nil || jump {
            out.append(SpeedRun(tone: tone, points: [pt]))
            cur = out.count - 1
        } else if out[cur!].tone != tone {
            let joint = out[cur!].points[out[cur!].points.count - 1]
            out.append(SpeedRun(tone: tone, points: [joint, pt]))
            cur = out.count - 1
        } else {
            out[cur!].points.append(pt)
        }
        prev = x
    }
    return out.filter { $0.points.count >= 2 }
}
