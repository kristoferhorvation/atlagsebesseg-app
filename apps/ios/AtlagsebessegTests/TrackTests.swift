import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// AW24: a `packages/app-logic/test/track.test.ts` párja (egy TS `it` = egy Swift `@Test`, azonos névvel), közös fixtúrán. AW25: saját rács-illesztő (Map Matching nélkül).

nonisolated private struct Fixture: @unchecked Sendable {
    let samples: [TripSample]
    let gap: (before: Double, after: Double)
    let uturnT: Double
    let uturn: [Double]
    let roads: [[[Double]]]

    nonisolated(unsafe) static let shared: Fixture = {
        let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("packages/app-logic/src/fixtures")
        let j = try! JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("track-budapest.json"))) as! [String: Any]
        let r = try! JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("track-budapest-roads.json"))) as! [String: Any]
        let gap = j["gap"] as! [String: Double]
        let raw = j["samples"] as! [[Double]]
        let uturnT = j["uturnT"] as! Double
        return Fixture(
            samples: raw.map { TripSample(tripId: "budapest", t: $0[0], lat: $0[1], lon: $0[2], speedKmh: $0[3], heading: nil, accuracy: 8, h3: nil, limitKmh: nil) },
            gap: (gap["beforeT"]!, gap["afterT"]!),
            uturnT: uturnT,
            uturn: raw.first { $0[0] == uturnT }!,
            roads: r["roads"] as! [[[Double]]]
        )
    }()
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

private let fixtureParts = recordTrace(Fixture.shared.samples)
private let fixtureLines = gridLines(fixtureParts)

@Suite("AW25: valódi budapesti nyomat, saját rács-illesztő")
struct TrackFixtureTests {
    @Test("a csík a nyers pontokból, az utcán halad: a csúcsok a cellán belül az OSM-úthálózat mellett")
    func utcan() {
        let vertices = fixtureLines.flatMap(\.coords)
        #expect(vertices.count > 30)
        let allMatched = fixtureLines.allSatisfy { $0.matched }
        #expect(allMatched)
        for v in vertices { #expect(roadDist(ll(v)) < 25) }
        let avg = vertices.map { roadDist(ll($0)) }.reduce(0, +) / Double(vertices.count)
        #expect(avg < 10)
    }

    @Test("a kanyart követi: a kirajzolt vonal irányt vált (40 m-enként mérve)")
    func kanyar() {
        let all = smoothLine(fixtureLines[0].coords)
        var c: [[Double]] = [all[0]]
        for x in all where haversineM(ll(c[c.count - 1]), ll(x)) >= 40 { c.append(x) }
        var turns = 0
        var prev: Double?
        for i in 1..<c.count {
            let b = bearingDeg(ll(c[i - 1]), ll(c[i]))
            if let p = prev, abs((b - p + 540).truncatingRemainder(dividingBy: 360) - 180) > 45 { turns += 1 }
            prev = b
        }
        #expect(turns >= 2)
    }

    @Test("két áthaladás ugyanazon az utcán (eltolt GPS-zajjal) többnyire ugyanazokat a szakaszkulcsokat adja")
    func kulcsok() {
        let shifted = recordTrace(Fixture.shared.samples.enumerated().map { i, x in
            var y = x
            y.lat += Double(i % 3 - 1) * 0.00002
            y.lon += Double((i % 2) * 2 - 1) * 0.00002
            return y
        })
        let a = Set(trackSegments(fixtureLines).map(\.key))
        let b = trackSegments(gridLines(shifted)).map(\.key)
        #expect(Double(b.filter { a.contains($0) }.count) / Double(b.count) > 0.7)
    }

    @Test("a megfordulásnál nincs kerülő: a csík hossza a nyers nyomat körül marad")
    func megfordulas() {
        let rawLen = fixtureParts.reduce(0) { $0 + lengthM($1.map { [$0.lat, $0.lon] }) }
        #expect(fixtureLines.reduce(0) { $0 + lengthM(smoothLine($1.coords)) } < rawLen * 1.25)
        let u = Fixture.shared.uturn
        #expect(fixtureLines.contains { l in l.coords.contains { haversineM(ll($0), LatLon(lat: u[1], lon: u[2])) < 40 } })
    }

    @Test("a GPS-kiesésnél megszakad: két darab, köztük nincs vonal")
    func kieses() {
        #expect(fixtureParts.count == 2)
        let a = fixtureParts[0].last!
        let b = fixtureParts[1][0]
        #expect(a.t == Fixture.shared.gap.before)
        #expect(b.t == Fixture.shared.gap.after)
        #expect(haversineM(a.latLon, b.latLon) > TRACK.gapM)
        #expect(fixtureLines.count == 2)
        let crossing = fixtureLines.contains { l in l.coords.contains { haversineM(ll($0), a.latLon) < 30 } && l.coords.contains { haversineM(ll($0), b.latLon) < 30 } }
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
}

@Suite("AW25: illesztő-réteg (saját, cserélhető)")
struct TrackMatcherTests {
    @Test("a rács-illesztő: a cellasor folytonos (szomszédos cellák), a cellaközéppont a rácsé, a visszalépés kimarad")
    func racs() async throws {
        let l = try await gridMatcher.lines([northPts(40, 5)])
        #expect(gridMatcher.id == MATCHER_GRID)
        #expect(l.count == 1)
        for i in 1..<l[0].coords.count { #expect(haversineM(ll(l[0].coords[i - 1]), ll(l[0].coords[i])) < 32) }
        let edge = floor(47.5 / TRACK.gridDeg + 1) * TRACK.gridDeg
        let jitter = [pt(0, edge - 0.00003, 19), pt(1000, edge + 0.00001, 19), pt(2000, edge - 0.00002, 19), pt(3000, edge - 0.0001, 19)]
        #expect(gridLines([jitter]).isEmpty)
    }

    @Test("másik illesztő ugyanazon a felületen cserélhető")
    func csere() async throws {
        struct Other: TrackMatcher {
            let id = "valhalla"
            func lines(_ parts: [[TrackPoint]]) async throws -> [TrackLine] { parts.map { p in TrackLine(matched: true, coords: p.map { [$0.lat, $0.lon] }, kmh: p.map { $0.kmh ?? 0 }) } }
        }
        let l = try await Other().lines([northPts(2, 50)])
        #expect(l.count == 1)
        #expect(l[0].matched)
    }

    @Test("a tárolt Mapbox-illesztés cseréje: nyers pontsorral újraépül, nélküle a geometria törlődik; a rács-illesztett és a függő változatlan")
    func migracio() {
        let base = TripTrack(tripId: "t", startedAt: 0, status: "done", share: false, parts: fixtureParts, lines: [line([[47.5, 19], [47.51, 19]])], matcher: MATCHER_MAPBOX)
        let re = migrateTrack(base)
        #expect(re.matcher == MATCHER_GRID)
        #expect(re.lines == gridLines(fixtureParts))
        var noParts = base
        noParts.parts = []
        let gone = migrateTrack(noParts)
        #expect(gone.lines.isEmpty && gone.matcher == MATCHER_GRID)
        var ok = base
        ok.matcher = MATCHER_GRID
        #expect(migrateTrack(ok) == ok)
        var pending = base
        pending.status = "pending"
        #expect(migrateTrack(pending) == pending)
        var old = base
        old.matcher = nil
        #expect(migrateTrack(old).matcher == MATCHER_GRID)
        var bare = old
        bare.parts = []
        #expect(migrateTrack(bare) == bare)
    }

    @Test("kirajzolás: a lépcső simított, a végpontok maradnak, két pontnál változatlan")
    func simitas() {
        let stair: [[Double]] = [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]]
        let sm = smoothLine(stair)
        #expect(sm[0] == [0, 0])
        #expect(sm[sm.count - 1] == [2, 2])
        #expect(sm.count > stair.count)
        #expect(smoothLine([[0, 0], [1, 1]]) == [[0, 0], [1, 1]])
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
