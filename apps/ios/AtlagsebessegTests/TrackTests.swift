import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// AW24: a `packages/app-logic/test/track.test.ts` párja (egy TS `it` = egy Swift `@Test`, azonos névvel), közös fixtúrán.

nonisolated private struct Fixture: @unchecked Sendable {
    let samples: [TripSample]
    let matches: [Any]
    let gap: (before: Double, after: Double)
    let uturnT: Double
    let roads: [[[Double]]]

    nonisolated(unsafe) static let shared: Fixture = {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("packages/app-logic/src/fixtures")
        let j = try! JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("track-budapest.json"))) as! [String: Any]
        let r = try! JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("track-budapest-roads.json"))) as! [String: Any]
        let gap = j["gap"] as! [String: Double]
        return Fixture(
            samples: (j["samples"] as! [[Double]]).map { TripSample(tripId: "budapest", t: $0[0], lat: $0[1], lon: $0[2], speedKmh: $0[3], heading: nil, accuracy: 8, h3: nil, limitKmh: nil) },
            matches: (j["matches"] as! [[Any]]).flatMap { $0 },
            gap: (gap["beforeT"]!, gap["afterT"]!),
            uturnT: j["uturnT"] as! Double,
            roads: r["roads"] as! [[[Double]]]
        )
    }()
}

/// A felvett illesztő: a rögzített valódi válaszokat adja vissza, sorrendben.
nonisolated private final class ReplayMatcher: MapMatcher, @unchecked Sendable {
    let id = MATCHER_MAPBOX
    private var i = 0
    func match(_ points: [TrackPoint]) async throws -> MatchResult {
        defer { i += 1 }
        return parseMapboxMatch(Fixture.shared.matches[i], points.count)
    }
}

private func segDist(_ p: LatLon, _ a: [Double], _ b: [Double]) -> Double {
    let k = cos(p.lat * .pi / 180) * 111_195
    let ax = (a[1] - p.lon) * k
    let ay = (a[0] - p.lat) * 111_195
    let dx = (b[1] - a[1]) * k
    let dy = (b[0] - a[0]) * 111_195
    let len2 = dx * dx + dy * dy
    let t = len2 == 0 ? 0 : max(0, min(1, -(ax * dx + ay * dy) / len2))
    return hypot(ax + t * dx, ay + t * dy)
}

private func roadDist(_ p: LatLon) -> Double {
    var best = Double.infinity
    for r in Fixture.shared.roads where r.count >= 2 {
        for i in 0..<(r.count - 1) { best = min(best, segDist(p, r[i], r[i + 1])) }
    }
    return best
}

private func ll(_ c: [Double]) -> LatLon { LatLon(lat: c[0], lon: c[1]) }
private func lengthM(_ c: [[Double]]) -> Double { c.count < 2 ? 0 : (1..<c.count).reduce(0) { $0 + haversineM(ll(c[$1 - 1]), ll(c[$1])) } }
private func pt(_ t: Double, _ lat: Double, _ lon: Double, _ kmh: Double = 40, _ acc: Double? = 8) -> TrackPoint { TrackPoint(t: t, lat: lat, lon: lon, kmh: kmh, acc: acc) }
private func sample(_ t: Double, _ lat: Double, _ lon: Double, _ accuracy: Double? = 8) -> TripSample { TripSample(tripId: "x", t: t, lat: lat, lon: lon, speedKmh: 40, heading: nil, accuracy: accuracy, h3: nil, limitKmh: nil) }
private func line(_ coords: [[Double]], matched: Bool = true, kmh: Double = 50) -> TrackLine { TrackLine(matched: matched, coords: coords, kmh: coords.map { _ in kmh }) }
/// Észak felé egyenes, `n` darab `stepM` méteres lépéssel.
private func north(_ n: Int, _ stepM: Double, lat0: Double = 47.5, lon0: Double = 19) -> [[Double]] { (0...n).map { [lat0 + Double($0) * stepM / 111_195, lon0] } }
private func northPts(_ n: Int, _ stepM: Double, lat0: Double = 47.5) -> [TrackPoint] { north(n, stepM, lat0: lat0).enumerated().map { pt(Double($0.offset) * 1000, $0.element[0], $0.element[1]) } }

private struct ScriptedMatcher: MapMatcher {
    let id = "teszt"
    let result: @Sendable ([TrackPoint]) throws -> MatchResult
    func match(_ points: [TrackPoint]) async throws -> MatchResult { try result(points) }
}

@Suite("AW24: valódi budapesti nyomat")
struct TrackFixtureTests {
    private func all() async throws -> (parts: [[TrackPoint]], lines: [TrackLine]) {
        let parts = recordTrace(Fixture.shared.samples)
        return (parts, try await matchTrace(parts, ReplayMatcher()))
    }

    @Test("az illesztett vonal az utcán halad: minden csúcs az OSM-úthálózaton van, a nyers pontok átlagosan távolabb")
    func utcan() async throws {
        let (parts, lines) = try await all()
        let vertices = lines.filter(\.matched).flatMap(\.coords)
        #expect(vertices.count > 30)
        for v in vertices { #expect(roadDist(ll(v)) < 6) }
        let avg = { (x: [Double]) in x.reduce(0, +) / Double(x.count) }
        #expect(avg(vertices.map { roadDist(ll($0)) }) < avg(parts.flatMap { $0 }.map { roadDist($0.latLon) }))
    }

    @Test("a kanyart követi: a vonal irányt vált, és nem vágja le a sarkot (több csúcs, mint az egyszerűsített pontok közti egyenes)")
    func kanyar() async throws {
        let (parts, lines) = try await all()
        let c = lines.filter(\.matched)[0].coords
        var turns = 0
        var prev: Double?
        for i in 1..<c.count {
            if haversineM(ll(c[i - 1]), ll(c[i])) < 10 { continue }
            let b = bearingDeg(ll(c[i - 1]), ll(c[i]))
            if let p = prev, angleDiffDeg(b, p) > 45 { turns += 1 }
            prev = b
        }
        #expect(turns >= 2)
        #expect(c.count > simplifyForMatch(parts[0]).count)
    }

    @Test("a tilos megfordulás egyenes: a két irány külön illeszkedik, a visszaforduló pontnál nincs körbevezető vonal")
    func megfordulas() async throws {
        let (parts, lines) = try await all()
        #expect(traceChunks(simplifyForMatch(parts[1])).count >= 2)
        let rawLen = parts.reduce(0) { $0 + lengthM($1.map { [$0.lat, $0.lon] }) }
        #expect(lines.reduce(0) { $0 + lengthM($1.coords) } < rawLen * 1.1)
        let u = Fixture.shared.samples.first { $0.t == Fixture.shared.uturnT }!
        #expect(lines.contains { $0.coords.contains { haversineM(ll($0), LatLon(lat: u.lat, lon: u.lon)) < 40 } })
    }

    @Test("a GPS-kiesésnél megszakad: két darab, köztük nincs vonal")
    func kieses() async throws {
        let (parts, lines) = try await all()
        #expect(parts.count == 2)
        let a = parts[0].last!
        let b = parts[1][0]
        #expect(a.t == Fixture.shared.gap.before)
        #expect(b.t == Fixture.shared.gap.after)
        #expect(haversineM(a.latLon, b.latLon) > TRACK.gapM)
        let crossing = lines.contains { l in l.coords.contains { haversineM(ll($0), a.latLon) < 1 } && l.coords.contains { haversineM(ll($0), b.latLon) < 1 } }
        #expect(!crossing)
    }
}

@Suite("AW24: pontsor a mintákból")
struct TrackTraceTests {
    @Test("kb. 20 méterenként egy pont, a ±30 m-nél rosszabb minta kimarad")
    func pontok() {
        let s = north(100, 5).enumerated().map { sample(Double($0.offset) * 1000, $0.element[0], $0.element[1], $0.offset == 50 ? 31 : 8) }
        let p = recordTrace(s)[0]
        #expect(p.count > 20)
        #expect(p.count < 30)
        #expect(!p.contains { $0.t == 50_000 })
    }

    @Test("irányváltásnál akkor is pont kerül be, ha még nem telt le a 20 méter")
    func irany() {
        let a = north(4, 10).enumerated().map { sample(Double($0.offset) * 1000, $0.element[0], $0.element[1]) }
        let end = a.last!
        let b = [1.0, 2.0].map { sample(4000 + $0 * 1000, end.lat, end.lon + $0 * 10 / (111_195 * cos(end.lat * .pi / 180))) }
        #expect(recordTrace(a + b)[0].contains { $0.t == 5000 })
    }

    @Test("a 200 m-nél nagyobb ugrás új darabot kezd, a kisebb nem")
    func ugras() {
        let near = [sample(0, 47.5, 19), sample(1000, 47.5002, 19), sample(2000, 47.5004, 19)]
        #expect(recordTrace(near).count == 1)
        #expect(recordTrace(near + [sample(3000, 47.51, 19), sample(4000, 47.5103, 19)]).count == 2)
    }

    @Test("az egyszerűsítés egyenesen kevesebb pontot hagy, a kanyart megtartja, nagy hézagot nem")
    func egyszerusites() {
        let s = simplifyForMatch(northPts(100, 20))
        #expect(s.count < 10)
        for i in 1..<s.count { #expect(haversineM(s[i - 1].latLon, s[i].latLon) <= TRACK.maxSpacingM + 20) }
        let corner = northPts(5, 40) + [pt(6000, 47.5018, 19.001)]
        #expect(simplifyForMatch(corner).count >= 3)
    }

    @Test("megfordulásnál új kérés indul, a közös ponttal")
    func megfordulasKeres() {
        let fwd = northPts(5, 40)
        let back = north(4, 40).reversed().enumerated().map { pt(6000 + Double($0.offset) * 1000, $0.element[0], $0.element[1]) }
        let c = traceChunks(fwd + back)
        #expect(c.count == 2)
        #expect(c[0].last == fwd.last)
        #expect(c[1][0] == fwd.last)
        #expect(traceChunks(fwd).count == 1)
    }

    @Test("a darabolás a pontkorlát szerint, egy közös ponttal")
    func darabolas() {
        let p = northPts(249, 20)
        let c = matchChunks(p)
        #expect(c.allSatisfy { $0.count <= 100 })
        #expect(c.count == 3)
        #expect(c[0].last == c[1][0])
        #expect(c.flatMap { $0 }.count == 252)
        #expect(matchChunks(Array(p.prefix(1))).isEmpty)
    }
}

@Suite("AW24: illesztő-réteg")
struct TrackMatcherTests {
    @Test("a kérés: driving, teljes geometria, sugár a pontosságból, növekvő időbélyeg")
    func keres() throws {
        let url = try #require(mapboxMatchUrl([pt(1000, 47.5, 19, 40, 8), pt(1000, 47.501, 19, 40, nil), pt(2000, 47.502, 19, 40, 80)], token: "pk.x"))
        let c = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        let q = Dictionary(uniqueKeysWithValues: (c.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(c.path.contains("/matching/v5/mapbox/driving/19.000000,47.500000;"))
        #expect(q["geometries"] == "geojson")
        #expect(q["overview"] == "full")
        #expect(q["radiuses"] == "12;30;50")
        let ts = q["timestamps"]!.split(separator: ";").map { Int($0)! }
        #expect(ts[1] > ts[0])
        #expect(ts[2] > ts[1])
        #expect(matchRadius(1) == Int(TRACK.radiusMinM))
    }

    @Test("a 422 és a NoMatch egyenes vonalat ad, a szerverhiba kivétel (később újrapróba)")
    func hibak() async throws {
        let p = northPts(3, 50)
        let n = try await matchTrace([p], ScriptedMatcher { parseMapboxMatch(["code": "NoMatch"], $0.count) })
        #expect(n[0].matched == false)
        let e = try await matchTrace([p], ScriptedMatcher { .empty($0.count) })
        #expect(e.count == 1)
        #expect(e[0].matched == false)
        await #expect(throws: MatchHTTPError.self) { _ = try await matchTrace([p], ScriptedMatcher { _ in throw MatchHTTPError(status: 503) }) }
    }

    @Test("másik illesztő ugyanazon a felületen cserélhető")
    func csere() async throws {
        let p = northPts(2, 50)
        let other = ScriptedMatcher { c in
            MatchResult(matchings: [.init(confidence: 1, coords: c.map { [$0.lat, $0.lon] }, legsM: (1..<c.count).map { haversineM(c[$0 - 1].latLon, c[$0].latLon) })], tracepoints: c.map { .init(matching: 0, lat: $0.lat, lon: $0.lon) })
        }
        let l = try await matchTrace([p], other)
        #expect(l.count == 1)
        #expect(l[0].matched)
    }

    @Test("illesztő nélkül a nyers pontok egyenesei, a darabok külön")
    func nyers() {
        let l = rawLines([northPts(2, 50), northPts(2, 50, lat0: 47.6)])
        #expect(l.count == 2)
        #expect(l.allSatisfy { !$0.matched })
    }

    @Test("kerülő-őr: a két pont közti háztömb-megkerülés helyett egyenes")
    func kerulo() {
        let loop = [[47.5, 19], [47.502, 19], [47.502, 19.002], [47.5003, 19.002], [47.5003, 19]]
        let r = MatchResult(matchings: [.init(confidence: 0.9, coords: loop, legsM: [lengthM(loop)])], tracepoints: [.init(matching: 0, lat: 47.5, lon: 19), .init(matching: 0, lat: 47.5003, lon: 19)])
        let l = assembleLines([[pt(0, 47.5, 19), pt(1000, 47.5003, 19)]], [r])
        #expect(l.count == 1)
        #expect(l[0].matched == false)
        #expect(l[0].coords.count == 2)
    }

    @Test("gyenge bizalmú illesztés nem számít")
    func bizalom() {
        let r = MatchResult(matchings: [.init(confidence: 0.05, coords: [[47.5, 19], [47.5003, 19]], legsM: [33])], tracepoints: [.init(matching: 0, lat: 47.5, lon: 19), .init(matching: 0, lat: 47.5003, lon: 19)])
        #expect(assembleLines([[pt(0, 47.5, 19), pt(1000, 47.5003, 19)]], [r])[0].matched == false)
    }

    @Test("illesztett és egyenes darab váltásánál nincs rés")
    func valtas() {
        let p = [pt(0, 47.5, 19), pt(1000, 47.5003, 19), pt(2000, 47.5006, 19)]
        let r = MatchResult(matchings: [.init(confidence: 0.9, coords: [[47.5, 19], [47.5003, 19]], legsM: [33])], tracepoints: [.init(matching: 0, lat: 47.5, lon: 19), .init(matching: 0, lat: 47.5003, lon: 19), nil])
        let l = assembleLines([p], [r])
        #expect(l.map(\.matched) == [true, false])
        #expect(l[1].coords[0] == l[0].coords.last)
    }
}

@Suite("AW24: útszakaszok")
struct TrackSegmentTests {
    @Test("az él 25 m-es darabokra, a végpontok az eredeti csúcsok; a kulcs irányfüggetlen és csúcsokhoz kötött")
    func szakaszok() {
        let c = north(1, 100)
        let s = trackSegments([line(c)])
        #expect(s.count == 4)
        for x in s { #expect(abs(haversineM(ll(x.a), ll(x.b)) - 25) < 0.5) }
        #expect(s[0].a == c[0])
        #expect(s.last!.b == c[1])
        #expect(segmentKey(c[0], c[1]) == segmentKey(c[1], c[0]))
        let back = trackSegments([line([c[1], c[0]])])
        #expect(back.map(\.key).sorted() == s.map(\.key).sorted())
    }

    @Test("az út első és utolsó 300 m-e védett")
    func vegek() {
        let s = trackSegments([line(north(40, 25))])
        #expect(s.count == 40)
        #expect(s.prefix(12).allSatisfy { $0.nearEnd })
        #expect(s.suffix(12).allSatisfy { $0.nearEnd })
        #expect(s.filter { !$0.nearEnd }.count == 16)
    }

    @Test("feltöltés: csak illesztett szakasz, a védett és a zónás kimarad, a visszafelé ág is")
    func feltoltes() throws {
        let c = north(60, 25)
        let start = 1_800_000_000_000.0
        let rows = segmentUploadRows(lines: [line(c)], startedAt: start, tzOffsetMin: 60)
        #expect(rows.count == 60 - 24)
        let keys = try JSONSerialization.jsonObject(with: JSONEncoder().encode(rows[0])) as! [String: Any]
        #expect(keys.keys.sorted() == ["avg_speed", "count", "dow", "hour", "lat1", "lat2", "lon1", "lon2", "seg_key"])
        #expect(segmentUploadRows(lines: [line(c, matched: false)], startedAt: start, tzOffsetMin: 60).isEmpty)
        let zone = HeatZone(id: "home", lat: c[30][0], lon: c[30][1], radiusM: 200)
        let zoned = segmentUploadRows(lines: [line(c)], startedAt: start, tzOffsetMin: 60, zones: [zone])
        #expect(zoned.count < rows.count)
        for r in zoned { #expect(haversineM(LatLon(lat: (r.lat1 + r.lat2) / 2, lon: (r.lon1 + r.lon2) / 2), LatLon(lat: zone.lat, lon: zone.lon)) > 200) }
        let backOver = c + c[30...].reversed()
        let returned = segmentUploadRows(lines: [line(backOver)], startedAt: start, tzOffsetMin: 60)
        #expect(!returned.contains { haversineM(LatLon(lat: $0.lat1, lon: $0.lon1), ll(c[36])) < 100 })
    }

    @Test("a feltöltési sor sérült tartalomnál üres")
    func sor() {
        #expect(parseSegmentOutbox("{x").isEmpty)
        #expect(parseSegmentOutbox(#"[{"seg_key":"a","count":1},{"nope":1}]"#).count == 1)
    }
}

@Suite("AW24: kirajzolás")
struct TrackDrawTests {
    private let vp = HeatViewport(zoom: 15, bbox: BBox(south: 47.49, west: 18.99, north: 47.52, east: 19.01))

    @Test("egyetlen áthaladás is látható vonal, nem szürke; a több áthaladás nagyobb súlyú")
    func egy() {
        let i = TrackIndex()
        let c = north(60, 25)
        i.add([line(c)])
        let one = i.lines(vp, .gyakorisag, zones: []).filter { !$0.grey }
        #expect(one.count == 1)
        #expect(one[0].weight > 0)
        i.add([line(c)])
        i.add([line(c)])
        let three = i.lines(vp, .gyakorisag, zones: []).filter { !$0.grey }
        #expect(three.map(\.weight).max()! > one[0].weight)
    }

    @Test("az azonos súlyú szomszédos szakaszok egy vonallá állnak, sorrendben")
    func lanc() throws {
        let i = TrackIndex()
        i.add([line(north(60, 25))])
        let l = i.lines(vp, .gyakorisag, zones: []).filter { !$0.grey }[0]
        #expect(l.coords.count == 60 - 24 + 1)
        for k in 1..<l.coords.count { #expect(abs(haversineM(ll(l.coords[k - 1]), ll(l.coords[k])) - 25) < 0.5) }
    }

    @Test("átlagsebesség módban a sebesség adja a súlyt")
    func sebesseg() {
        let slow = TrackIndex()
        slow.add([line(north(60, 25), kmh: 30)])
        let fast = TrackIndex()
        fast.add([line(north(60, 25), kmh: 120)])
        let w = { (x: TrackIndex) in x.lines(vp, .atlagsebesseg, zones: []).filter { !$0.grey }[0].weight }
        #expect(w(fast) > w(slow))
    }

    @Test("a zónán belül és az út végein szürke, a látható területen kívül semmi")
    func szurke() {
        let i = TrackIndex()
        let c = north(60, 25)
        i.add([line(c)])
        let free = i.lines(vp, .gyakorisag, zones: [])
        #expect(free.filter(\.grey).count == 2)
        let zone = HeatZone(id: "home", lat: c[30][0], lon: c[30][1], radiusM: 200)
        let zoned = i.lines(vp, .gyakorisag, zones: [zone])
        let greyLen = { (l: [HeatLine]) in l.filter(\.grey).reduce(0) { $0 + lengthM($1.coords) } }
        #expect(greyLen(zoned) > greyLen(free) + 300)
        #expect(i.lines(HeatViewport(zoom: 15, bbox: BBox(south: 48, west: 19, north: 48.1, east: 19.1)), .gyakorisag, zones: []).isEmpty)
    }

    @Test("közösségi sorokból vonalak, szürke nélkül")
    func kozossegi() {
        let rows = seedGlobalRows([[line(north(10, 25))], [line(north(10, 25))]])
        #expect(rows.count == 10)
        #expect(rows[0].count == 2)
        let l = globalLines(rows, .gyakorisag)
        #expect(l.count == 1)
        #expect(l[0].grey == false)
        #expect(l[0].coords.count == 11)
        #expect(HEAT.shareEndsM == 300)
    }
}
