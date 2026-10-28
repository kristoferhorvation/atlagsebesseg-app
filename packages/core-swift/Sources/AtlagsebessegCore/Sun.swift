import Foundation

// Egyszerű napállás-számítás (a SunCalc / NOAA közelítő képletei alapján, ~1–2 perc pontosság).
// Függőségmentes; a térkép világos/sötét előbeállításához használjuk.

private let RAD = Double.pi / 180
private let DAY_MS = 86_400_000.0
private let J1970 = 2440588.0
private let J2000 = 2451545.0
private let OBLIQUITY = RAD * 23.4397
private let J0 = 0.0009

private func toDays(_ ms: Double) -> Double { ms / DAY_MS - 0.5 + J1970 - J2000 }
private func fromJulian(_ j: Double) -> Double { (j + 0.5 - J1970) * DAY_MS }
private func solarMeanAnomaly(_ d: Double) -> Double { RAD * (357.5291 + 0.98560028 * d) }

private func eclipticLongitude(_ m: Double) -> Double {
    let c = RAD * (1.9148 * sin(m) + 0.02 * sin(2 * m) + 0.0003 * sin(3 * m))
    return m + c + RAD * 102.9372 + Double.pi
}

private func declination(_ l: Double) -> Double { asin(sin(OBLIQUITY) * sin(l)) }
private func rightAscension(_ l: Double) -> Double { atan2(sin(l) * cos(OBLIQUITY), cos(l)) }

public struct SunPosition: Sendable {
    /// Magasság a horizont felett, fokban.
    public var altitudeDeg: Double
    /// Óraszög fokban, (−180, 180]: negatív = délelőtt, pozitív = délután.
    public var hourAngleDeg: Double
}

public func sunPosition(_ timeMs: Double, _ lat: Double, _ lon: Double) -> SunPosition {
    let lw = -lon * RAD
    let phi = lat * RAD
    let d = toDays(timeMs)
    let l = eclipticLongitude(solarMeanAnomaly(d))
    let dec = declination(l)
    var h = RAD * (280.16 + 360.9856235 * d) - lw - rightAscension(l)
    h = atan2(sin(h), cos(h))
    let altitude = asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(h))
    return SunPosition(altitudeDeg: altitude / RAD, hourAngleDeg: h / RAD)
}

public struct SunTimes: Sendable {
    /// Polgári hajnal (−6°) – `nil`, ha aznap nincs (sarki nappal/éjszaka).
    public var civilDawn: Double?
    public var sunrise: Double?
    public var solarNoon: Double
    public var sunset: Double?
    public var civilDusk: Double?
}

/// Az adott időpont napjának (a helyi szoláris nap) napkelte/napnyugta időpontjai, Unix ms-ban.
public func sunTimes(_ timeMs: Double, _ lat: Double, _ lon: Double) -> SunTimes {
    let lw = -lon * RAD
    let phi = lat * RAD
    let d = toDays(timeMs)
    // JS Math.round: fél felfelé (+∞ felé)
    let n = (d - J0 - lw / (2 * Double.pi) + 0.5).rounded(.down)
    let ds = J0 + lw / (2 * Double.pi) + n
    let m = solarMeanAnomaly(ds)
    let l = eclipticLongitude(m)
    let dec = declination(l)
    let jNoon = J2000 + ds + 0.0053 * sin(m) - 0.0069 * sin(2 * l)

    func at(_ angleDeg: Double) -> (Double?, Double?) {
        let cosW = (sin(angleDeg * RAD) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec))
        if cosW < -1 || cosW > 1 { return (nil, nil) }
        let w = acos(cosW)
        let a = J0 + (w + lw) / (2 * Double.pi) + n
        let jSet = J2000 + a + 0.0053 * sin(m) - 0.0069 * sin(2 * l)
        let jRise = jNoon - (jSet - jNoon)
        return (fromJulian(jRise), fromJulian(jSet))
    }

    let (sunrise, sunset) = at(-0.833)
    let (civilDawn, civilDusk) = at(-6)
    return SunTimes(civilDawn: civilDawn, sunrise: sunrise, solarNoon: fromJulian(jNoon), sunset: sunset, civilDusk: civilDusk)
}

public enum SunPhase: String, Sendable {
    case nappal, hajnal, alkony, ejszaka
}

/// Napszak a nap magassága alapján: ≥ 6° nappal, ≤ −6° (polgári szürkület vége) éjszaka,
/// a kettő között hajnal (délelőtt) vagy alkony (délután). Sarkvidéken is működik.
public func sunPhase(_ timeMs: Double, _ lat: Double, _ lon: Double) -> SunPhase {
    let p = sunPosition(timeMs, lat, lon)
    if p.altitudeDeg >= 6 { return .nappal }
    if p.altitudeDeg <= -6 { return .ejszaka }
    return p.hourAngleDeg < 0 ? .hajnal : .alkony
}
