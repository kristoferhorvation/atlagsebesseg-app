import AtlagsebessegCore
import AtlagsebessegTestSupport
import Testing

// packages/core/test/geo.test.ts
@Suite("geo")
struct GeoTests {
    @Test("haversine: 1 fok szélesség ≈ 111,2 km")
    func haversineEgyFok() {
        #expect(closeTo(haversineM(LatLon(lat: 45, lon: 10), LatLon(lat: 46, lon: 10)), 111_195, -1))
    }

    @Test("haversine: Bologna–Firenze légvonal ≈ 81 km")
    func haversineBolognaFirenze() {
        let d = haversineM(LatLon(lat: 44.4949, lon: 11.3426), LatLon(lat: 43.7696, lon: 11.2558))
        #expect(d / 1000 > 80)
        #expect(d / 1000 < 82)
    }

    @Test("irányszög: észak, kelet, dél, nyugat")
    func iranyszog() {
        let o = LatLon(lat: 45, lon: 10)
        #expect(closeTo(bearingDeg(o, LatLon(lat: 45.1, lon: 10)), 0, 5))
        #expect(closeTo(bearingDeg(o, LatLon(lat: 45, lon: 10.1)), 90, 0))
        #expect(closeTo(bearingDeg(o, LatLon(lat: 44.9, lon: 10)), 180, 5))
        #expect(closeTo(bearingDeg(o, LatLon(lat: 45, lon: 9.9)), 270, 0))
    }

    @Test("szögkülönbség átfordulással")
    func szogkulonbseg() {
        #expect(angleDiffDeg(350, 10) == 20)
        #expect(angleDiffDeg(10, 350) == 20)
        #expect(angleDiffDeg(0, 180) == 180)
        #expect(angleDiffDeg(-90, 270) == 0)
    }

    @Test("helyi vetület oda-vissza")
    func helyiVetulet() {
        let p = LocalProjection(LatLon(lat: 44.5, lon: 11.3))
        let back = p.fromXY(p.toXY(LatLon(lat: 44.53, lon: 11.37)))
        #expect(closeTo(back.lat, 44.53, 9))
        #expect(closeTo(back.lon, 11.37, 9))
        let xy = p.toXY(LatLon(lat: 44.5, lon: 11.4))
        #expect(closeTo(xy.x, haversineM(LatLon(lat: 44.5, lon: 11.3), LatLon(lat: 44.5, lon: 11.4)), -1))
    }

    @Test("polyline hossza")
    func polylineHossza() {
        let pts = [LatLon(lat: 45, lon: 10), LatLon(lat: 45.5, lon: 10), LatLon(lat: 46, lon: 10)]
        #expect(closeTo(polylineLengthM(pts), 111_195, -1))
    }
}
