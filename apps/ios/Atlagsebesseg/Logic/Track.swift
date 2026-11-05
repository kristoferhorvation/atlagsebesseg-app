import AtlagsebessegCore
import Foundation

// AW24: hőtérkép utcákra illesztett csíkokkal – a packages/app-logic/src/track.ts 1:1 portja (a tesztek azonos nevűek, közös fixtúrán: `fixtures/track-budapest.json`).
// Út végén: minták → pontsor (`recordTrace`) → egyszerűsítés (`simplifyForMatch`) → darabolás (`traceChunks`) → illesztő (`MapMatcher`, cserélhető) → vonalak (`assembleLines`) → útszakaszok
// (`trackSegments`). Ahol az illesztés nem sikerül vagy kerülőt adna, a nyers pontok közti egyenes marad; a GPS-kiesésnél a csík megszakad.

/// Az illesztő szolgáltatót jelöli az eredményen: a Mapbox-eredmény így külön törölhető, ha saját illesztőre váltunk.
nonisolated let MATCHER_MAPBOX = "mapbox"

nonisolated struct TrackPoint: Codable, Equatable, Sendable {
    var t: Double
    var lat: Double
    var lon: Double
    var kmh: Double?
    var acc: Double?
    var latLon: LatLon { LatLon(lat: lat, lon: lon) }
}

/// Egy összefüggő vonaldarab: `matched` az úthálózatra illesztett, különben a nyers pontok közti egyenes. `coords`: [lat, lon] párok (a webes alakkal azonos JSON).
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

/// Egyenes szakaszon kevesebb pont az illesztés előtt (a kanyarok és a megfordulás megmaradnak); `maxSpacingM`-nél nagyobb hézag nem marad.
nonisolated func simplifyForMatch(_ points: [TrackPoint]) -> [TrackPoint] {
    if points.count <= 2 { return points }
    let kept = simplifyPath(points.map(\.latLon), tolM: TRACK.simplifyM)
    var out: [TrackPoint] = []
    var lastI = 0
    var ki = 0
    for (i, p) in points.enumerated() where ki < kept.count && kept[ki] == p.latLon {
        ki += 1
        if i > 0 {
            // a nagy hézagba az eredeti pontokból kerül vissza
            var from = lastI
            var k = lastI + 1
            while k < i {
                if haversineM(points[from].latLon, points[k + 1].latLon) > TRACK.maxSpacingM {
                    out.append(points[k])
                    from = k
                }
                k += 1
            }
        }
        out.append(p)
        lastI = i
    }
    return out
}

/// Darabolás a kérésenkénti pontkorlát szerint; a szomszédos darabok egy pontot közösen tartalmaznak, így a vonal nem szakad el.
nonisolated func matchChunks(_ points: [TrackPoint], max: Int = Int(TRACK.matchMaxCoords)) -> [[TrackPoint]] {
    if points.count <= max { return points.count >= 2 ? [points] : [] }
    var out: [[TrackPoint]] = []
    var i = 0
    while i < points.count - 1 {
        out.append(Array(points[i..<min(i + max, points.count)]))
        i += max - 1
    }
    return out
}

/// Megfordul-e a pontsor az `i`. pontnál.
nonisolated private func reversalAt(_ points: [TrackPoint], _ i: Int) -> Bool {
    guard i >= 1, i + 1 < points.count else { return false }
    return angleDiffDeg(bearingDeg(points[i - 1].latLon, points[i].latLon), bearingDeg(points[i].latLon, points[i + 1].latLon)) >= TRACK.reversalDeg
}

/// A kérésekre bontás: a megfordulásnál mindig új kérés indul (egy tilos megfordulás különben a teljes darab illesztését lerontja), azon belül a pontkorlát szerint.
nonisolated func traceChunks(_ points: [TrackPoint]) -> [[TrackPoint]] {
    var out: [[TrackPoint]] = []
    var from = 0
    var i = 1
    while i < points.count - 1 {
        if reversalAt(points, i) {
            out += matchChunks(Array(points[from...i]))
            from = i
        }
        i += 1
    }
    out += matchChunks(Array(points[from...]))
    return out
}

/// Az illesztési sugár a pont pontosságából (ismeretlen pontosságnál a tartomány közepe).
nonisolated func matchRadius(_ acc: Double?) -> Int {
    let v = acc.map { $0 * 1.5 } ?? (TRACK.radiusMinM + TRACK.radiusMaxM) / 2
    return Int(Swift.max(TRACK.radiusMinM, Swift.min(TRACK.radiusMaxM, v)).rounded())
}

/// A Mapbox Map Matching kérése (`driving`, teljes GeoJSON-geometria; a sugár a pontosságból, az időbélyeg szigorúan növekvő).
nonisolated func mapboxMatchUrl(_ points: [TrackPoint], token: String) -> URL? {
    let coords = points.map { String(format: "%.6f,%.6f", $0.lon, $0.lat) }.joined(separator: ";")
    var last = 0.0
    let stamps = points.map { p -> String in
        last = Swift.max((p.t / 1000).rounded(.down), last + 1)
        return String(Int(last))
    }
    var c = URLComponents(string: "https://api.mapbox.com/matching/v5/mapbox/driving/\(coords)")
    c?.queryItems = [
        URLQueryItem(name: "geometries", value: "geojson"),
        URLQueryItem(name: "overview", value: "full"),
        URLQueryItem(name: "steps", value: "false"),
        URLQueryItem(name: "tidy", value: "false"),
        URLQueryItem(name: "radiuses", value: points.map { String(matchRadius($0.acc)) }.joined(separator: ";")),
        URLQueryItem(name: "timestamps", value: stamps.joined(separator: ";")),
        URLQueryItem(name: "access_token", value: token),
    ]
    return c?.url
}

/// Az illesztő válasza közös alakban; más szolgáltató (OSRM, Valhalla) ugyanezt adja a `MapMatcher` mögött.
nonisolated struct MatchResult: Sendable {
    struct Matching: Sendable {
        var confidence: Double
        var coords: [[Double]]
        /// A szomszédos illesztett pontok közti táv a vonal mentén (m): ezzel ugyanaz az utca oda-vissza sem téveszthető össze.
        var legsM: [Double]
    }
    struct Tracepoint: Sendable {
        var matching: Int
        var lat: Double
        var lon: Double
    }
    var matchings: [Matching]
    /// Pontonként (a kérés sorrendjében): melyik illesztéshez tartozik és hova került; `nil`: nem illeszthető.
    var tracepoints: [Tracepoint?]

    static func empty(_ n: Int) -> MatchResult { MatchResult(matchings: [], tracepoints: Array(repeating: nil, count: n)) }
}

/// Cserélhető illesztő-réteg (ma Mapbox, később saját szerver). Hálózati hiba: kivétel (az út később újrapróbálódik); „nincs illesztés”: üres eredmény.
nonisolated protocol MapMatcher: Sendable {
    var id: String { get }
    func match(_ points: [TrackPoint]) async throws -> MatchResult
}

/// A Map Matching válasz feldolgozása; a `NoMatch` és társai üres eredmény, nem hiba.
nonisolated func parseMapboxMatch(_ json: Any?, _ n: Int) -> MatchResult {
    guard let j = json as? [String: Any], j["code"] as? String == "Ok", let ms = j["matchings"] as? [[String: Any]], let tps = j["tracepoints"] as? [Any] else { return .empty(n) }
    return MatchResult(
        matchings: ms.map { m in
            let c = ((m["geometry"] as? [String: Any])?["coordinates"] as? [[Double]]) ?? []
            let legs = (m["legs"] as? [[String: Any]]) ?? []
            return .init(confidence: (m["confidence"] as? Double) ?? 0, coords: c.map { [$0[1], $0[0]] }, legsM: legs.map { ($0["distance"] as? Double) ?? 0 })
        },
        tracepoints: tps.map { t in
            guard let d = t as? [String: Any], let i = d["matchings_index"] as? Int, let l = d["location"] as? [Double], l.count >= 2 else { return nil }
            return .init(matching: i, lat: l[1], lon: l[0])
        }
    )
}

nonisolated struct MatchHTTPError: Error { let status: Int }

/// Mapbox-illesztő.
nonisolated struct MapboxMatcher: MapMatcher {
    let token: String
    var id: String { MATCHER_MAPBOX }

    func match(_ points: [TrackPoint]) async throws -> MatchResult {
        guard let url = mapboxMatchUrl(points, token: token) else { return .empty(points.count) }
        let (data, resp) = try await URLSession.shared.data(from: url)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        // a 422 (nem illeszthető bemenet) nem ismételhető: egyenes vonalak; a többi hiba később újrapróbálódik
        if status == 422 { return .empty(points.count) }
        guard (200..<300).contains(status) else { throw MatchHTTPError(status: status) }
        return parseMapboxMatch(try JSONSerialization.jsonObject(with: data), points.count)
    }
}

nonisolated private func lengthOf(_ c: [[Double]]) -> Double {
    guard c.count >= 2 else { return 0 }
    return (1..<c.count).reduce(0) { $0 + dist(c[$1 - 1], c[$1]) }
}

/// A vonal darabja két, a vonal mentén mért távolság között.
nonisolated private func sliceByDistance(_ line: [[Double]], _ from: Double, _ to: Double) -> [[Double]] {
    var out: [[Double]] = []
    var run = 0.0
    guard line.count >= 2 else { return out }
    for i in 0..<(line.count - 1) {
        let a = line[i]
        let b = line[i + 1]
        let d = dist(a, b)
        let next = run + d
        func pointAt(_ m: Double) -> [Double] { d == 0 ? a : [a[0] + (b[0] - a[0]) * (m - run) / d, a[1] + (b[1] - a[1]) * (m - run) / d] }
        if out.isEmpty && next >= from { out.append(pointAt(Swift.max(from, run))) }
        if next >= to {
            out.append(pointAt(Swift.min(to, next)))
            return out
        }
        if !out.isEmpty && next > from { out.append(b) }
        run = next
    }
    return out
}

/// A vonalak az illesztésből: két egymás utáni pont közt az illesztett darab, ha mindkettő ugyanabban az (elég biztos) illesztésben van és a darab nem kerülő; különben a nyers
/// egyenes (tilosban fordulás, parkoló, illesztési hiba). `chunks` és `results` párban; a vonal nem szakad el, csak a darabok (GPS-kiesés) között.
nonisolated func assembleLines(_ chunks: [[TrackPoint]], _ results: [MatchResult]) -> [TrackLine] {
    var out: [TrackLine] = []
    func put(_ matched: Bool, _ coords: [[Double]], _ kmhA: Double, _ kmhB: Double) {
        let total = lengthOf(coords)
        var run = 0.0
        var speeds: [Double] = []
        for (i, c) in coords.enumerated() {
            if i > 0 { run += dist(coords[i - 1], c) }
            speeds.append(total > 0 ? kmhA + (kmhB - kmhA) * run / total : kmhA)
        }
        if var cur = out.last, cur.matched == matched {
            let skip = dist(cur.coords.last!, coords[0]) < 0.01 ? 1 : 0
            cur.coords += coords.dropFirst(skip)
            cur.kmh += speeds.dropFirst(skip)
            out[out.count - 1] = cur
        } else {
            // az előző darab végéhez kötve: a váltásnál sincs rés
            let joint = out.last?.coords.last
            let head: [[Double]] = joint.map { dist($0, coords[0]) >= 0.01 ? [$0] : [] } ?? []
            out.append(TrackLine(matched: matched, coords: head + coords, kmh: head.map { _ in kmhA } + speeds))
        }
    }
    for (ci, points) in chunks.enumerated() {
        let r = ci < results.count ? results[ci] : MatchResult.empty(points.count)
        var ordinals: [Int: Int] = [:]
        func tp(_ i: Int) -> MatchResult.Tracepoint? { i < r.tracepoints.count ? r.tracepoints[i] : nil }
        // a pont sorszáma az illesztésén belül (a `legsM` szerinti hely)
        var ordinalAt: [Int?] = []
        for i in points.indices {
            if let t = tp(i) {
                let n = ordinals[t.matching] ?? 0
                ordinals[t.matching] = n + 1
                ordinalAt.append(n)
            } else { ordinalAt.append(nil) }
        }
        guard points.count >= 2 else { continue }
        for i in 0..<(points.count - 1) {
            let a = points[i]
            let b = points[i + 1]
            let ta = tp(i)
            let tb = tp(i + 1)
            let m = ta != nil && tb != nil && ta!.matching == tb!.matching && ta!.matching < r.matchings.count ? r.matchings[ta!.matching] : nil
            let kA = a.kmh ?? 0
            let kB = b.kmh ?? kA
            var piece: [[Double]]?
            if let m, let n = ordinalAt[i], m.confidence >= TRACK.minConfidence, m.coords.count >= 2, n < m.legsM.count {
                // a leg-távok és a geometria hossza kerekítésben eltér: arányosan a vonal hosszára
                let legsTotal = m.legsM.reduce(0, +)
                let scale = legsTotal > 0 ? lengthOf(m.coords) / legsTotal : 1
                let from = m.legsM[0..<n].reduce(0, +) * scale
                let legM = m.legsM[n] * scale
                let chord = haversineM(a.latLon, b.latLon)
                let limit = Swift.max(chord * TRACK.detourFactor, chord + TRACK.detourExtraM)
                if legM <= limit {
                    let c = sliceByDistance(m.coords, from, from + legM)
                    if c.count >= 2 && legM > 0 { piece = c }
                }
            }
            if let piece {
                put(true, piece, kA, kB)
            } else {
                put(false, [ta.map { [$0.lat, $0.lon] } ?? [a.lat, a.lon], tb.map { [$0.lat, $0.lon] } ?? [b.lat, b.lon]], kA, kB)
            }
        }
    }
    return out
}

/// Illesztő nélkül (szimulátor, token nélkül): a nyers pontok egyenesei, a kiesésnél megszakítva.
nonisolated func rawLines(_ parts: [[TrackPoint]]) -> [TrackLine] {
    parts.filter { $0.count >= 2 }.map { p in TrackLine(matched: false, coords: p.map { [$0.lat, $0.lon] }, kmh: p.map { $0.kmh ?? 0 }) }
}

/// Teljes illesztés: darabonként egyszerűsít, darabol, illeszt; a darabok (GPS-kiesés) külön vonalak maradnak, soha nem kötődnek össze.
nonisolated func matchTrace(_ parts: [[TrackPoint]], _ matcher: MapMatcher) async throws -> [TrackLine] {
    var out: [TrackLine] = []
    for part in parts where part.count >= 2 {
        let chunks = traceChunks(simplifyForMatch(part))
        var results: [MatchResult] = []
        for c in chunks { results.append(try await matcher.match(c)) }
        out += assembleLines(chunks, results)
    }
    return out
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
            out.append([TrackLine(matched: true, coords: r.coords, kmh: r.coords.map { _ in kmh })])
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
