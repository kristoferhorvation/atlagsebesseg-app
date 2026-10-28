import Foundation

public struct RouteProjection: Equatable, Sendable {
    /// Útvonal menti távolság a kezdőponttól méterben, a névleges hosszra skálázva.
    /// A kezdőpont előtt negatív, a végpont után nagyobb a hossznál
    /// (az első és az utolsó szakasz meghosszabbításán mérve).
    public var alongM: Double
    /// Merőleges távolság az útvonaltól méterben (előjel nélkül).
    public var crossM: Double
    /// Az útvonal irányszöge a vetített pontban.
    public var bearingDeg: Double
}

public struct ProjectionHint: Sendable {
    /// Csak az ebbe az útvonal menti tartományba eső szakaszokat vizsgálja (méter, skálázott).
    public var fromM: Double
    public var toM: Double

    public init(fromM: Double, toM: Double) {
        self.fromM = fromM
        self.toM = toM
    }
}

public enum RouteError: Error {
    /// Legalább két különböző pont kell.
    case tulKevesPont
}

private struct Segment {
    let a: LatLon
    let b: LatLon
    let proj: LocalProjection
    let bx: Double
    let by: Double
    let len2: Double
    /// Geometriai (haversine) hossz.
    let lengthM: Double
    /// Kumulált geometriai távolság a szakasz elején.
    let startM: Double
    let bearing: Double
}

/// Egy szakasz vonala, amire a GPS-pontokat vetítjük. A geometriai hosszt a névleges (hivatalos)
/// hosszra skálázza, így a vetítés a végponton pontosan `lengthM`-et ad.
public final class Route: Sendable {
    public let geometricLengthM: Double
    public let lengthM: Double
    private let segments: [Segment]
    private let scale: Double

    public init(_ points: [some Coordinate], nominalLengthM: Double? = nil) throws {
        let pts = dedupe(points)
        guard pts.count >= 2 else { throw RouteError.tulKevesPont }
        var segs: [Segment] = []
        var cum = 0.0
        for i in 1..<pts.count {
            let a = pts[i - 1]
            let b = pts[i]
            let proj = LocalProjection(a)
            let bxy = proj.toXY(b)
            let lengthM = haversineM(a, b)
            segs.append(Segment(
                a: a, b: b, proj: proj, bx: bxy.x, by: bxy.y, len2: bxy.x * bxy.x + bxy.y * bxy.y,
                lengthM: lengthM, startM: cum, bearing: AtlagsebessegCore.bearingDeg(a, b)
            ))
            cum += lengthM
        }
        segments = segs
        geometricLengthM = cum
        if let n = nominalLengthM, n > 0 { lengthM = n } else { lengthM = cum }
        scale = lengthM / cum
    }

    public var start: LatLon { segments[0].a }
    public var end: LatLon { segments[segments.count - 1].b }

    /// A pont vetítése a legközelebbi szakaszra (a `hint` tartományon belül, ha van).
    public func project(_ p: some Coordinate, hint: ProjectionHint? = nil) -> RouteProjection {
        var best: RouteProjection?
        let last = segments.count - 1
        var pass = 0
        while pass < 2 && best == nil {
            defer { pass += 1 }
            let useHint = pass == 0 && hint != nil
            if pass == 1 && hint == nil { break }
            for i in 0...last {
                let s = segments[i]
                if useHint, let hint {
                    let from = s.startM * scale
                    let to = (s.startM + s.lengthM) * scale
                    // Az első/utolsó szakasz meghosszabbítása is a tartományhoz tartozik.
                    let lo = i == 0 ? -Double.infinity : from
                    let hi = i == last ? Double.infinity : to
                    if hi < hint.fromM || lo > hint.toM { continue }
                }
                let xy = s.proj.toXY(p)
                var t = s.len2 > 0 ? (xy.x * s.bx + xy.y * s.by) / s.len2 : 0
                if i > 0 { t = max(t, 0) }
                if i < last { t = min(t, 1) }
                let dx = xy.x - t * s.bx
                let dy = xy.y - t * s.by
                let crossM = hypot(dx, dy)
                if best == nil || crossM < best!.crossM {
                    best = RouteProjection(alongM: (s.startM + t * s.lengthM) * scale, crossM: crossM, bearingDeg: s.bearing)
                }
            }
        }
        return best!
    }

    /// Az útvonal irányszöge adott (skálázott) távolságnál.
    public func bearingAt(_ alongM: Double) -> Double {
        segmentAt(alongM).bearing
    }

    /// Az útvonal pontja adott (skálázott) távolságnál; a végeken túl a meghosszabbításon.
    public func pointAt(_ alongM: Double) -> LatLon {
        let s = segmentAt(alongM)
        let t = s.lengthM > 0 ? (alongM / scale - s.startM) / s.lengthM : 0
        return s.proj.fromXY(XY(x: t * s.bx, y: t * s.by))
    }

    private func segmentAt(_ alongM: Double) -> Segment {
        let g = alongM / scale
        for s in segments where g < s.startM + s.lengthM { return s }
        return segments[segments.count - 1]
    }
}

private func dedupe(_ points: [some Coordinate]) -> [LatLon] {
    var out: [LatLon] = []
    for p in points {
        if let prev = out.last, haversineM(prev, p) <= 0.01 { continue }
        out.append(LatLon(lat: p.lat, lon: p.lon))
    }
    return out
}
