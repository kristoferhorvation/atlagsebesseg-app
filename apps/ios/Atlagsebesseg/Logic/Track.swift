import AtlagsebessegCore
import Foundation

// AW24: hőtérkép csíkokkal – a packages/app-logic/src/track.ts 1:1 portja (a tesztek azonos nevűek, közös fixtúrán: `fixtures/track-budapest.json`).
// AW25 (Kristof döntése, Mapbox-feltételek: a Map Matching eredménye nem tárolható): a csík a SAJÁT nyers GPS-pontokból. Út végén: minták → pontsor
// (`recordTrace`) → illesztő (`TrackMatcher`, cserélhető; ma a `gridMatcher` rács-illesztő, később saját Valhalla-szerver) → útszakaszok (`trackSegments`).
// A rács lépcsőjét csak a kirajzolás simítja (`smoothLine`).

/// Az illesztő jelölése. A `mapbox` csak a régi (AW24) tárolt adat felismeréséhez kell: az ilyen geometria cserélendő (`migrateTrack`).
nonisolated let MATCHER_MAPBOX = "mapbox"
/// AW25: a saját rács-illesztő (nyers GPS-pontokból).
nonisolated let MATCHER_GRID = "grid"

nonisolated struct TrackPoint: Codable, Equatable, Sendable {
    var t: Double
    var lat: Double
    var lon: Double
    var kmh: Double?
    var acc: Double?
    var latLon: LatLon { LatLon(lat: lat, lon: lon) }
}

/// Egy összefüggő vonaldarab: `matched` a saját illesztővel készült (stabil szakaszkulcsok, mehet a közösségbe), különben a nyers pontok közti egyenes. `coords`: [lat, lon] párok (a webes alakkal azonos JSON).
nonisolated struct TrackLine: Codable, Equatable, Sendable {
    var matched: Bool
    var coords: [[Double]]
    var kmh: [Double]
}

nonisolated struct TripTrack: Codable, Equatable, Sendable {
    var tripId: String
    var startedAt: Double
    var status: String
    /// Az út végén kért közösségi megosztás (a visszamenőleg feldolgozott régi út nem megy fel).
    var share: Bool
    /// A nyers pontsor darabokban (megszakadás a GPS-kiesésnél): ebből bármikor újraépíthető más illesztővel.
    var parts: [[TrackPoint]]
    var lines: [TrackLine]
    /// Melyik illesztő készítette; `nil`: nem volt illesztés (szimulátor, token nélkül).
    var matcher: String?
}

nonisolated private func dist(_ a: [Double], _ b: [Double]) -> Double {
    haversineM(LatLon(lat: a[0], lon: a[1]), LatLon(lat: b[0], lon: b[1]))
}

/// Az út pontsora a mintákból: ±`maxAccuracyM`-nél rosszabb minta kimarad; `pointEveryM`-enként vagy irányváltásnál egy pont; `gapM` fölötti ugrásnál új darab.
nonisolated func recordTrace(_ samples: [TripSample]) -> [[TrackPoint]] {
    let s = samples.filter { $0.accuracy == nil || $0.accuracy! <= TRIP.maxAccuracyM }.sorted { $0.t < $1.t }
    var parts: [[TrackPoint]] = []
    var cur: [TrackPoint] = []
    var prev: TripSample?
    var lastBearing: Double?
    func point(_ x: TripSample) -> TrackPoint { TrackPoint(t: x.t, lat: x.lat, lon: x.lon, kmh: x.speedKmh, acc: x.accuracy) }
    func ll(_ x: TripSample) -> LatLon { LatLon(lat: x.lat, lon: x.lon) }
    for x in s {
        if let p = prev, haversineM(ll(p), ll(x)) > TRACK.gapM {
            if cur.last?.t != p.t { cur.append(point(p)) }
            if cur.count >= 2 { parts.append(cur) }
            cur = []
            lastBearing = nil
        }
        prev = x
        guard let last = cur.last else {
            cur.append(point(x))
            continue
        }
        let d = haversineM(last.latLon, ll(x))
        if d < TRACK.turnMinM { continue }
        let b = bearingDeg(last.latLon, ll(x))
        let turned = lastBearing.map { angleDiffDeg(b, $0) >= TRACK.turnDeg } ?? false
        if d >= TRACK.pointEveryM || turned {
            cur.append(point(x))
            lastBearing = b
        }
    }
    if let p = prev, cur.last?.t != p.t { cur.append(point(p)) }
    if cur.count >= 2 { parts.append(cur) }
    return parts
}

nonisolated private func lengthOf(_ c: [[Double]]) -> Double {
    var s = 0.0
    for i in 1..<max(1, c.count) { s += dist(c[i - 1], c[i]) }
    return s
}

/// Cserélhető illesztő-réteg: a nyers pontsor darabjaiból vonalak (ma a saját rács-illesztő, később saját Valhalla-szerver). Hálózati hiba: kivétel.
nonisolated protocol TrackMatcher: Sendable {
    var id: String { get }
    func lines(_ parts: [[TrackPoint]]) async throws -> [TrackLine]
}

/// A rács cellája: egész indexek; a hosszúsági lépés az egész fokos szélességi sávból (a webes `cellOf`).
nonisolated private func lonStep(_ lat: Double) -> Double { TRACK.gridDeg / cos((floor(lat) + 0.5) * (Double.pi / 180)) }
nonisolated private func cellOf(_ lat: Double, _ lon: Double) -> [Int] { [Int(floor(lat / TRACK.gridDeg)), Int(floor(lon / lonStep(lat)))] }
nonisolated private func cellCenter(_ c: [Int]) -> [Double] {
    let lat = (Double(c[0]) + 0.5) * TRACK.gridDeg
    return [round6(lat), round6((Double(c[1]) + 0.5) * lonStep(lat))]
}

/// AW25: a saját illesztő (a webes `gridLines`): a pontsor darabjait sűrűn mintázva a rács cellasorává alakítja (az egymást követő azonos cella egy; az
/// A–B–A visszalépés kimarad), a vonal a cellaközéppontokon halad. Darabonként külön vonal: a kiesésnél megszakad.
nonisolated func gridLines(_ parts: [[TrackPoint]]) -> [TrackLine] {
    var out: [TrackLine] = []
    for part in parts where part.count >= 2 {
        var cells: [(c: [Int], kmh: Double)] = []
        func visit(_ lat: Double, _ lon: Double, _ kmh: Double) {
            let c = cellOf(lat, lon)
            if let last = cells.last, last.c == c { return }
            if cells.count >= 2, cells[cells.count - 2].c == c {
                cells.removeLast()
                return
            }
            cells.append((c, kmh))
        }
        for i in 0..<(part.count - 1) {
            let p = part[i], q = part[i + 1]
            let n = max(1, Int(ceil(haversineM(p.latLon, q.latLon) / TRACK.gridSampleM)))
            for k in 0..<n {
                let f = Double(k) / Double(n)
                visit(p.lat + (q.lat - p.lat) * f, p.lon + (q.lon - p.lon) * f, (p.kmh ?? 0) + ((q.kmh ?? 0) - (p.kmh ?? 0)) * f)
            }
        }
        let last = part[part.count - 1]
        visit(last.lat, last.lon, last.kmh ?? 0)
        if cells.count >= 2 { out.append(TrackLine(matched: true, coords: cells.map { cellCenter($0.c) }, kmh: cells.map { round1($0.kmh) })) }
    }
    return out
}

nonisolated struct GridMatcher: TrackMatcher {
    var id: String { MATCHER_GRID }
    func lines(_ parts: [[TrackPoint]]) async throws -> [TrackLine] { gridLines(parts) }
}

nonisolated let gridMatcher = GridMatcher()

/// AW25: a tárolt út a döntés után (a webes `migrateTrack`): a Mapbox-illesztett (vagy illesztés nélküli régi) vonal a nyers pontsorból újraépül;
/// nyers pontsor nélkül a Mapbox-geometria törlődik (üres `lines`, a rekord marad). Függő és rács-illesztett út változatlan.
nonisolated func migrateTrack(_ t: TripTrack) -> TripTrack {
    if t.status != "done" || t.matcher == MATCHER_GRID { return t }
    let parts = t.parts.filter { $0.count >= 2 }
    if parts.isEmpty && t.matcher != MATCHER_MAPBOX { return t }
    var out = t
    out.lines = gridLines(parts)
    out.matcher = MATCHER_GRID
    return out
}

/// Kirajzoláshoz (a webes `smoothLine`): Douglas–Peucker (`smoothSimplifyM`, a rács lépcsője egyenes lesz), majd Chaikin-simítás; a végpontok
/// maradnak. A tárolt adat és a szakaszkulcsok nem változnak.
nonisolated func smoothLine(_ coords: [[Double]], steps: Int = Int(TRACK.smoothSteps)) -> [[Double]] {
    var c = simplifyPath(coords.map { LatLon(lat: $0[0], lon: $0[1]) }, tolM: TRACK.smoothSimplifyM).map { [$0.lat, $0.lon] }
    var s = 0
    while s < steps && c.count > 2 {
        var n: [[Double]] = [c[0]]
        for i in 0..<(c.count - 1) {
            let a = c[i], b = c[i + 1]
            if i > 0 { n.append([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]) }
            if i < c.count - 2 { n.append([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]) }
        }
        n.append(c[c.count - 1])
        c = n
        s += 1
    }
    return c
}

/// Az út helyi rekordja a mintákból, feldolgozásra várva.
nonisolated func pendingTrack(_ tripId: String, startedAt: Double, samples: [TripSample], share: Bool) -> TripTrack {
    TripTrack(tripId: tripId, startedAt: startedAt, status: "pending", share: share, parts: recordTrace(samples), lines: [], matcher: nil)
}

// MARK: útszakaszok (a közösségi összesítés és a kirajzolás egysége)

nonisolated struct TrackSegment: Equatable, Sendable {
    var a: [Double]
    var b: [Double]
    var kmh: Double
    var matched: Bool
    /// Az út első vagy utolsó `shareEndsM` méterén van (lakóhely-védelem).
    var nearEnd: Bool
    /// Stabil kulcs a két végpontból (irányfüggetlen): az úthálózat csúcsai utak közt azonosak.
    var key: String { segmentKey(a, b) }
}

/// A végpont egész rácson (a `keyDecimals` kerekítése): a sok szakaszos összesítés és láncolás szöveg-formázás nélkül gyors.
nonisolated private struct GridPoint: Hashable {
    let lat: Int32
    let lon: Int32
    init(_ c: [Double]) {
        lat = Int32((c[0] * 100_000).rounded())
        lon = Int32((c[1] * 100_000).rounded())
    }
}

/// Irányfüggetlen szakasz-azonosító a rácson (a `segmentKey` gyors párja).
nonisolated private struct GridSegment: Hashable {
    let p: GridPoint
    let q: GridPoint
    init(_ a: [Double], _ b: [Double]) {
        let x = GridPoint(a)
        let y = GridPoint(b)
        if (x.lat, x.lon) < (y.lat, y.lon) {
            p = x
            q = y
        } else {
            p = y
            q = x
        }
    }
}

nonisolated private func roundKey(_ x: Double) -> String { String(format: "%.\(Int(TRACK.keyDecimals))f", x) }
nonisolated private func pointKey(_ c: [Double]) -> String { "\(roundKey(c[0])),\(roundKey(c[1]))" }

nonisolated func segmentKey(_ a: [Double], _ b: [Double]) -> String {
    let ka = pointKey(a)
    let kb = pointKey(b)
    return ka.utf8.lexicographicallyPrecedes(kb.utf8) ? "\(ka);\(kb)" : "\(kb);\(ka)"
}

/// Az út vonalai útszakaszokra: az úthálózat két csúcsa közti él `segmentM`-es egyenlő darabokra, így ugyanaz az utca más utakon is ugyanazokat a szakaszokat adja. A távolság
/// az út elejétől / végéig a vonalak mentén, a kiesés nem számít bele.
nonisolated func trackSegments(_ lines: [TrackLine]) -> [TrackSegment] {
    let total = lines.reduce(0) { $0 + lengthOf($1.coords) }
    var out: [TrackSegment] = []
    var run = 0.0
    for l in lines where l.coords.count >= 2 {
        for i in 0..<(l.coords.count - 1) {
            let a = l.coords[i]
            let b = l.coords[i + 1]
            let d = dist(a, b)
            if d == 0 { continue }
            let n = Swift.max(1, Int((d / TRACK.segmentM).rounded()))
            let dn = Double(n)
            for k in 0..<n {
                let kd = Double(k)
                let pa = [a[0] + (b[0] - a[0]) * kd / dn, a[1] + (b[1] - a[1]) * kd / dn]
                let pb = k == n - 1 ? b : [a[0] + (b[0] - a[0]) * (kd + 1) / dn, a[1] + (b[1] - a[1]) * (kd + 1) / dn]
                let from = run + d * kd / dn
                let to = run + d * (kd + 1) / dn
                out.append(TrackSegment(a: pa, b: pb, kmh: l.kmh[i] + (l.kmh[i + 1] - l.kmh[i]) * (kd + 0.5) / dn, matched: l.matched, nearEnd: from < HEAT.shareEndsM || total - to < HEAT.shareEndsM))
            }
            run += d
        }
    }
    return out
}

nonisolated private func midOf(_ a: [Double], _ b: [Double]) -> LatLon { LatLon(lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2) }
nonisolated private func round1(_ x: Double) -> Double { (x * 10).rounded() / 10 }
nonisolated private func round6(_ x: Double) -> Double { (x * 1e6).rounded() / 1e6 }

/// Egy sor a közösségi feltöltésben (a `heat_segments` tábla oszlopai): nincs útvonal, azonosító, pontos idő.
nonisolated struct SegmentUploadRow: Codable, Equatable, Sendable {
    var seg_key: String
    var lat1: Double
    var lon1: Double
    var lat2: Double
    var lon2: Double
    var count: Int
    var avg_speed: Double
    var hour: Int
    var dow: Int
}

/// A közösségi nézet egy szakasza (`heat_segments_global`).
nonisolated struct SegmentGlobalRow: Codable, Equatable, Sendable {
    var seg_key: String
    var lat1: Double
    var lon1: Double
    var lat2: Double
    var lon2: Double
    var count: Int
    var avg_speed: Double
}

/// A feltöltendő szakaszok: csak illesztett vonalról; a mentett helyek zónáin belül és az út első / utolsó 300 m-én semmi. A védett szakasz az út minden áthaladásával kimarad
/// (a visszafelé jövő ág sem fedi fel). Óra-sáv és hét napja az út kezdetéből, percre pontos idő nincs.
nonisolated func segmentUploadRows(lines: [TrackLine], startedAt: Double, tzOffsetMin: Double, zones: [HeatZone] = []) -> [SegmentUploadRow] {
    let segs = trackSegments(lines)
    let blocked = Set(segs.filter(\.nearEnd).map(\.key))
    let localS = (startedAt + tzOffsetMin * 60_000) / 1000
    let secondsOfDay = localS.truncatingRemainder(dividingBy: 86_400)
    let hour = Int(secondsOfDay / 3600)
    // 1970-01-01 csütörtök (4)
    let dow = (Int((localS / 86_400).rounded(.down)) + 4) % 7
    var order: [String] = []
    var groups: [String: (row: SegmentUploadRow, sum: Double)] = [:]
    for s in segs {
        if !s.matched || blocked.contains(s.key) || (!zones.isEmpty && inZone(midOf(s.a, s.b), zones, marginM: TRACK.zoneMarginM)) { continue }
        if var g = groups[s.key] {
            g.row.count += 1
            g.sum += s.kmh
            groups[s.key] = g
        } else {
            order.append(s.key)
            groups[s.key] = (SegmentUploadRow(seg_key: s.key, lat1: round6(s.a[0]), lon1: round6(s.a[1]), lat2: round6(s.b[0]), lon2: round6(s.b[1]), count: 1, avg_speed: 0, hour: hour, dow: dow), s.kmh)
        }
    }
    return order.map { k in
        var g = groups[k]!
        g.row.avg_speed = round1(g.sum / Double(g.row.count))
        return g.row
    }
}

/// A feltöltésre váró sorok a helyi tárolóból (sérült tartalom helyett üres).
nonisolated func parseSegmentOutbox(_ raw: String?) -> [SegmentUploadRow] {
    guard let raw, let data = raw.data(using: .utf8), let arr = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
    return arr.compactMap { item in
        guard let d = try? JSONSerialization.data(withJSONObject: item) else { return nil }
        if let r = try? JSONDecoder().decode(SegmentUploadRow.self, from: d) { return r }
        // a hiányos, de felismerhető sor is megmarad (mint a weben)
        guard let o = item as? [String: Any], let k = o["seg_key"] as? String, let c = o["count"] as? Int else { return nil }
        return SegmentUploadRow(seg_key: k, lat1: 0, lon1: 0, lat2: 0, lon2: 0, count: c, avg_speed: 0, hour: 0, dow: 0)
    }
}

nonisolated func serializeSegmentOutbox(_ rows: [SegmentUploadRow]) -> String {
    (try? JSONEncoder().encode(rows)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
}

nonisolated func appendSegmentOutbox(_ queue: [SegmentUploadRow], _ rows: [SegmentUploadRow]) -> [SegmentUploadRow] {
    Array((queue + rows).suffix(Int(TRACK.outboxMax)))
}

// MARK: kirajzolás

/// Egy vonal a rétegen: a súly (0…1) a módban, a `grey` a zónában vagy csak az út elején / végén járt szakasz.
nonisolated struct HeatLine: Equatable, Sendable {
    var coords: [[Double]]
    var weight: Double
    var grey: Bool
}

nonisolated private func quantize(_ w: Double) -> Double { (w * TRACK.colorSteps).rounded() / TRACK.colorSteps }

nonisolated private struct ChainItem {
    var a: [Double]
    var b: [Double]
    var weight: Double
    var grey: Bool
    var rank: Int
}

/// Az azonos súlyú, végpontban találkozó szakaszok egy vonallá: sima illesztés, kevés elem.
nonisolated private func chain(_ items: [ChainItem]) -> [HeatLine] {
    struct Node: Hashable {
        let point: GridPoint
        let weight: Int
        let grey: Bool
    }
    func key(_ c: [Double], _ w: Double, _ g: Bool) -> Node { Node(point: GridPoint(c), weight: Int((w * TRACK.colorSteps).rounded()), grey: g) }
    var free: [Node: [Int]] = [:]
    for (i, s) in items.enumerated() {
        free[key(s.a, s.weight, s.grey), default: []].append(i)
        free[key(s.b, s.weight, s.grey), default: []].append(i)
    }
    var used = Array(repeating: false, count: items.count)
    func nextFrom(_ c: [Double], _ w: Double, _ g: Bool) -> Int? {
        let k = key(c, w, g)
        while let i = free[k]?.last {
            if !used[i] { return i }
            free[k]?.removeLast()
        }
        return nil
    }
    var lines: [(line: HeatLine, rank: Int)] = []
    for (i, s) in items.enumerated() where !used[i] {
        used[i] = true
        var head: [[Double]] = []
        var tail = [s.a, s.b]
        var rank = s.rank
        for dir in 0..<2 {
            var tip = dir == 0 ? s.b : s.a
            while let j = nextFrom(tip, s.weight, s.grey) {
                used[j] = true
                let n = items[j]
                let nextTip = GridPoint(n.a) == GridPoint(tip) ? n.b : n.a
                if dir == 0 { tail.append(nextTip) } else { head.append(nextTip) }
                rank = Swift.max(rank, n.rank)
                tip = nextTip
            }
        }
        lines.append((HeatLine(coords: head.reversed() + tail, weight: s.weight, grey: s.grey), rank))
    }
    // stabil rendezés, mint a weben
    let sorted = lines.enumerated().sorted { $0.element.rank != $1.element.rank ? $0.element.rank > $1.element.rank : $0.offset < $1.offset }
    return sorted.prefix(Int(TRACK.maxLines)).map(\.element.line)
}

/// A saját utak összesítése szakaszonként (a zónák és a mód csak kirajzoláskor számítanak); egy áthaladás is látszik.
nonisolated final class TrackIndex {
    private struct Agg {
        var a: [Double]
        var b: [Double]
        /// A színezett áthaladások (az út vége nélkül).
        var count: Int
        /// A sebesség-átlaghoz: a nem védett áthaladások összege.
        var sum: Double
        var mid: LatLon
    }
    private var segs: [GridSegment: Agg] = [:]
    private var order: [GridSegment] = []

    var size: Int { segs.count }

    func clear() {
        segs = [:]
        order = []
    }

    func add(_ lines: [TrackLine]) {
        for s in trackSegments(lines) {
            let k = GridSegment(s.a, s.b)
            if var o = segs[k] {
                if !s.nearEnd {
                    o.count += 1
                    o.sum += s.kmh
                    segs[k] = o
                }
            } else {
                order.append(k)
                segs[k] = Agg(a: s.a, b: s.b, count: s.nearEnd ? 0 : 1, sum: s.nearEnd ? 0 : s.kmh, mid: midOf(s.a, s.b))
            }
        }
    }

    /// A látható vonalak (kis ráhagyással): a zónán belüli és a csak út-végi szakasz szürke.
    func lines(_ vp: HeatViewport, _ view: HeatView, zones: [HeatZone]) -> [HeatLine] {
        let dLat = (vp.bbox.north - vp.bbox.south) * HEAT.viewPad
        let dLon = (vp.bbox.east - vp.bbox.west) * HEAT.viewPad
        let (s0, n0, w0, e0) = (vp.bbox.south - dLat, vp.bbox.north + dLat, vp.bbox.west - dLon, vp.bbox.east + dLon)
        func inBox(_ c: [Double]) -> Bool { c[0] >= s0 && c[0] <= n0 && c[1] >= w0 && c[1] <= e0 }
        var items: [ChainItem] = []
        for k in order {
            guard let s = segs[k], inBox(s.a) || inBox(s.b) else { continue }
            let grey = s.count == 0 || (!zones.isEmpty && inZone(s.mid, zones, marginM: TRACK.zoneMarginM))
            let w = grey ? 0 : quantize(heatWeight(count: s.count, avgKmh: s.sum / Double(s.count), view: view))
            items.append(ChainItem(a: s.a, b: s.b, weight: w, grey: grey, rank: s.count))
        }
        return chain(items)
    }
}

/// A közösségi sorok vonalakká.
nonisolated func globalLines(_ rows: [SegmentGlobalRow], _ view: HeatView) -> [HeatLine] {
    chain(rows.map { r in ChainItem(a: [r.lat1, r.lon1], b: [r.lat2, r.lon2], weight: quantize(heatWeight(count: r.count, avgKmh: r.avg_speed, view: view)), grey: false, rank: r.count) })
}

/// A közösségi nézet sorai a saját szakaszokból (szimulátor, `-heatSeed YES`): mintha ≥ 3 beküldés lenne.
nonisolated func seedGlobalRows(_ lines: [[TrackLine]]) -> [SegmentGlobalRow] {
    var order: [String] = []
    var out: [String: SegmentGlobalRow] = [:]
    for l in lines {
        for s in trackSegments(l) where s.matched {
            if var o = out[s.key] {
                o.avg_speed = (o.avg_speed * Double(o.count) + s.kmh) / Double(o.count + 1)
                o.count += 1
                out[s.key] = o
            } else {
                order.append(s.key)
                out[s.key] = SegmentGlobalRow(seg_key: s.key, lat1: s.a[0], lon1: s.a[1], lat2: s.b[0], lon2: s.b[1], count: 1, avg_speed: s.kmh)
            }
        }
    }
    return order.map { out[$0]! }
}

/// A közösségi szakasz-lekérések gyorsítótára: azonos téglalap `HEAT.cacheMs`-ig nem kér újra (a `HeatGlobalCache` párja a szakaszokra).
nonisolated final class SegmentGlobalCache {
    private var entries: [String: (at: Double, rows: [SegmentGlobalRow])] = [:]
    private let now: () -> Double
    init(now: @escaping () -> Double) { self.now = now }
    func get(_ key: String) -> [SegmentGlobalRow]? {
        guard let e = entries[key] else { return nil }
        if now() - e.at > HEAT.cacheMs {
            entries[key] = nil
            return nil
        }
        return e.rows
    }
    func set(_ key: String, _ rows: [SegmentGlobalRow]) { entries[key] = (now(), rows) }
}

/// AW24: a felvett utak (`fixtures/heat-seed-routes.json`) vonalai utanként: a `passes` adja az áthaladásokat, a sebesség utanként kicsit eltér.
nonisolated func heatSeedTrackLines(_ routes: [(passes: Int, kmh: Double, coords: [[Double]])]) -> [[TrackLine]] {
    var out: [[TrackLine]] = []
    for (ri, r) in routes.enumerated() {
        for i in 0..<r.passes {
            let kmh = r.kmh + Double((i * 7 + ri * 3) % 13) - 6
            // AW25: mint egy valódi út – a pontsor a saját rács-illesztőn át (`gridLines`)
            out.append(gridLines([r.coords.enumerated().map { TrackPoint(t: Double($0.offset) * 1000, lat: $0.element[0], lon: $0.element[1], kmh: kmh, acc: 8) }]))
        }
    }
    return out
}

/// A szimulátor felvett útjai a csomagból.
nonisolated func loadHeatSeedRoutes() -> [(passes: Int, kmh: Double, coords: [[Double]])] {
    guard let url = Bundle.main.url(forResource: "heat-seed-routes", withExtension: "json"), let data = try? Data(contentsOf: url),
          let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let rs = j["routes"] as? [[String: Any]] else { return [] }
    return rs.map { (passes: ($0["passes"] as? Int) ?? 1, kmh: ($0["kmh"] as? Double) ?? 50, coords: ($0["coords"] as? [[Double]]) ?? []) }
}
