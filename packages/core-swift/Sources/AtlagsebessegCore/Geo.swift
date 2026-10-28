import Foundation

public let EARTH_RADIUS_M = 6_371_008.8

@inline(__always) func toRad(_ deg: Double) -> Double { deg * Double.pi / 180 }
@inline(__always) func toDeg(_ rad: Double) -> Double { rad * 180 / Double.pi }

/// Nagykör-távolság méterben.
public func haversineM(_ a: some Coordinate, _ b: some Coordinate) -> Double {
    let dLat = toRad(b.lat - a.lat)
    let dLon = toRad(b.lon - a.lon)
    let s1 = sin(dLat / 2)
    let s2 = sin(dLon / 2)
    let h = s1 * s1 + cos(toRad(a.lat)) * cos(toRad(b.lat)) * s2 * s2
    return 2 * EARTH_RADIUS_M * asin(min(1, h.squareRoot()))
}

/// Kezdeti irányszög a-ból b-be, fokban [0, 360).
public func bearingDeg(_ a: some Coordinate, _ b: some Coordinate) -> Double {
    let φ1 = toRad(a.lat)
    let φ2 = toRad(b.lat)
    let dλ = toRad(b.lon - a.lon)
    let y = sin(dλ) * cos(φ2)
    let x = cos(φ1) * sin(φ2) - sin(φ1) * cos(φ2) * cos(dλ)
    return normalizeDeg(toDeg(atan2(y, x)))
}

public func normalizeDeg(_ deg: Double) -> Double {
    let d = deg.truncatingRemainder(dividingBy: 360)
    return d < 0 ? d + 360 : d
}

/// Két irányszög abszolút különbsége, [0, 180].
public func angleDiffDeg(_ a: Double, _ b: Double) -> Double {
    let d = abs(normalizeDeg(a) - normalizeDeg(b))
    return d > 180 ? 360 - d : d
}

public struct XY: Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

/// Helyi, ekvirektanguláris vetület egy origó körül (x = kelet, y = észak, méterben).
/// Néhány tíz km-en belül a hossztorzulás elhanyagolható (< 0,1%).
public struct LocalProjection: Sendable {
    public let origin: LatLon
    private let cosLat: Double

    public init(_ origin: some Coordinate) {
        self.origin = LatLon(lat: origin.lat, lon: origin.lon)
        cosLat = cos(toRad(origin.lat))
    }

    public func toXY(_ p: some Coordinate) -> XY {
        XY(x: toRad(p.lon - origin.lon) * EARTH_RADIUS_M * cosLat, y: toRad(p.lat - origin.lat) * EARTH_RADIUS_M)
    }

    public func fromXY(_ p: XY) -> LatLon {
        LatLon(lat: origin.lat + toDeg(p.y / EARTH_RADIUS_M), lon: origin.lon + toDeg(p.x / (EARTH_RADIUS_M * cosLat)))
    }
}

/// Polyline hossza méterben (haversine-összeg).
public func polylineLengthM(_ points: [some Coordinate]) -> Double {
    var sum = 0.0
    for i in points.indices.dropFirst() { sum += haversineM(points[i - 1], points[i]) }
    return sum
}
