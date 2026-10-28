import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing

// packages/core/test/route.test.ts – a pálya és a pontok a közös fixtúrákból
@Suite("Route")
struct RouteTests {
    let fx = try! Fixtures.sections()
    let rf = try! Fixtures.route()
    var section: Section { fx.course }
    var proj: LocalProjection { LocalProjection(fx.origin) }
    var route: Route { try! Route(section.geometry!, nominalLengthM: section.lengthM) }

    @Test("a geometriai hossz egyezik a névlegessel (≈ 10 km)")
    func hossz() {
        #expect(closeTo(route.lengthM, 10_000, -1))
        #expect(closeTo(route.geometricLengthM, route.lengthM, 6))
    }

    @Test("a kezdőpont 0, a végpont a hossz")
    func vegpontok() {
        let r = route
        #expect(closeTo(r.project(section.start).alongM, 0, 3))
        #expect(closeTo(r.project(section.end).alongM, r.lengthM, 0))
    }

    @Test("a kezdőpont előtt negatív, a végpont után nagyobb a hossznál")
    func meghosszabbitas() {
        let r = route
        let before = r.project(proj.fromXY(XY(x: 0, y: -500)))
        #expect(closeTo(before.alongM, -500, 0))
        #expect(before.crossM < 1)
        let after = proj.toXY(section.end)
        #expect(closeTo(r.project(proj.fromXY(XY(x: after.x + 300, y: after.y))).alongM, r.lengthM + 300, 0))
    }

    @Test("merőleges távolság a párhuzamos vonalon")
    func parhuzamos() {
        let r = route
        for p in rf.parallel120 {
            #expect(r.project(p).crossM > 115)
            #expect(r.project(p).crossM < 125)
        }
    }

    @Test("pointAt és project inverzek")
    func inverzek() {
        let r = route
        for s in [0.0, 1234, 5000, 7777, 9999] { #expect(closeTo(r.project(r.pointAt(s)).alongM, s, 0)) }
    }

    @Test("névleges hosszra skáláz")
    func skalaz() throws {
        let pts = rf.line1000
        let r = try Route(pts, nominalLengthM: 1100)
        #expect(closeTo(r.project(pts[pts.count - 1]).alongM, 1100, 1))
        #expect(closeTo(r.project(proj.fromXY(XY(x: 0, y: 500))).alongM, 550, 1))
    }

    @Test("a hint tartomány szűkíti a keresést (visszaforduló útnál a közelebbi ágat választja)")
    func hint() throws {
        // hajtűkanyar: fel 1000 m, majd vissza le 30 m-rel arrébb
        let r = try Route(rf.hairpin)
        let p = proj.fromXY(XY(x: 20, y: 500)) // a visszatérő ághoz van közelebb
        #expect(r.project(p).alongM > 1000)
        #expect(closeTo(r.project(p, hint: ProjectionHint(fromM: 0, toM: 900)).alongM, 500, 0))
    }

    @Test("legalább két különböző pont kell")
    func ketPont() {
        #expect(throws: RouteError.self) { try Route([section.start, section.start]) }
    }
}
