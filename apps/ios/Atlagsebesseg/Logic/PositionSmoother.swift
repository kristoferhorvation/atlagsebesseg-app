import AtlagsebessegCore
import Foundation

// AW23: a jelölő és a követő kamera közös mozgása – a packages/app-logic/src/positionSmoother.ts párja (azonos nevű tesztek:
// PositionSmootherTests). A fixek között a jelölő a sebességgel és az iránnyal halad tovább; új fixnél nem ugrik, hanem korlátozott
// tempóval áll rá az új becslésre.

nonisolated enum POSITION_SMOOTH {
    /// Az utolsó fix után legfeljebb eddig becsül előre (s); GPS-kiesésnél a jelölő megáll.
    static let predictMaxS = 1.5
    /// A korrekció időállandója (s).
    static let correctTauS = 0.8
    /// A menetirányú sebesség a mért sebesség ennyiszeresére gyorsulhat (`1 + x`), illetve lassulhat (`1 - x`).
    static let alongFactor = 0.5
    /// Az oldalirányú korrekció a mért sebesség ennyiszereséig.
    static let crossFactor = 0.5
    /// Lassú haladásnál / állva is legalább ekkora korrekciós tempó (m/s).
    static let correctMinMps = 1.0
    /// Ez alatt (m/s) áll: nincs előrebecslés.
    static let stillMps = 0.7
    /// A megjelenített sebesség időállandója (s): a GPS-sebesség ugrása nem látszik.
    static let speedTauS = 0.5
    /// Az irány időállandója (s).
    static let bearingTauS = 0.35
    /// Ennél nagyobb eltérésnél (m) ugrik: GPS újraindulás, szimulátor-ablak.
    static let snapM = 80.0
}

nonisolated struct SmoothPose: Equatable, Sendable {
    var lat: Double
    var lon: Double
    var bearing: Double
    /// A simított sebesség (m/s) – a sebességfüggő zoomhoz.
    var speedMps: Double
}

private nonisolated let mPerDeg = 111_195.0
private nonisolated func rad(_ d: Double) -> Double { d * .pi / 180 }
private nonisolated func clampAbs(_ x: Double, _ cap: Double) -> Double { max(-cap, min(cap, x)) }

nonisolated final class PositionSmoother {
    private var fix: GpsFix?
    private var fixAt = 0.0
    /// A fix sebessége (m/s) és iránya (°) – irány vagy sebesség nélküli fixnél az előzőből számolva.
    private var vMps = 0.0
    private var dir = 0.0
    private var pose: SmoothPose?
    private var lastT = 0.0
    private var scale = 1.0
    private let simClock: Bool

    /// `simClock`: szimulátor-lejátszás – a fixek saját óráját követi (gyorsított lejátszásnál is); éles módban mindig valós idő.
    init(simClock: Bool = false) {
        self.simClock = simClock
    }

    /// Új fix: `now` a platform monoton órája (ms).
    func onFix(_ f: GpsFix, now: Double) {
        let prev = fix
        if simClock, let prev, now > fixAt, f.timestamp > prev.timestamp { scale = max(1, (f.timestamp - prev.timestamp) / (now - fixAt)) }
        fix = f
        fixAt = now
        let dt = prev.map { (f.timestamp - $0.timestamp) / 1000 } ?? 0
        let dx = prev.map { (f.lon - $0.lon) * mPerDeg * cos(rad(f.lat)) } ?? 0
        let dy = prev.map { (f.lat - $0.lat) * mPerDeg } ?? 0
        let moved = (dx * dx + dy * dy).squareRoot()
        if let s = f.speed, s >= 0 { vMps = s } else { vMps = dt > 0 ? moved / dt : 0 }
        if let h = f.heading {
            dir = h
        } else if moved > 4 {
            dir = (atan2(dx, dy) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        }
        if pose == nil {
            pose = SmoothPose(lat: f.lat, lon: f.lon, bearing: dir, speedMps: vMps)
            lastT = now
        }
    }

    /// A megjelenítendő póz a `now` pillanatban (képkockánként hívva); fix nélkül `nil`.
    func at(_ now: Double) -> SmoothPose? {
        guard let f = fix, let p = pose else { return nil }
        let dt = max(0, now - lastT) / 1000 * scale
        lastT = now
        if dt == 0 { return p }
        typealias C = POSITION_SMOOTH
        let v = p.speedMps + (vMps - p.speedMps) * (1 - exp(-dt / C.speedTauS))
        let age = max(0, now - fixAt) / 1000 * scale
        // a becsült helyzet most: az utolsó fix + sebesség × eltelt idő (korlátozva), álló autónál maga a fix
        let predict = vMps >= C.stillMps ? vMps * min(C.predictMaxS, age) : 0
        let dirRad = rad(dir)
        let (sinD, cosD) = (sin(dirRad), cos(dirRad))
        let cosLat = cos(rad(f.lat))
        let ex = (f.lon - p.lon) * mPerDeg * cosLat + sinD * predict
        let ey = (f.lat - p.lat) * mPerDeg + cosD * predict
        var lat: Double
        var lon: Double
        if (ex * ex + ey * ey).squareRoot() > C.snapM {
            lat = f.lat + cosD * predict / mPerDeg
            lon = f.lon + sinD * predict / (mPerDeg * cosLat)
        } else {
            // az eltérés a menetirány szerint felbontva
            let along = ex * sinD + ey * cosD
            let cross = ex * cosD - ey * sinD
            let k = 1 - exp(-dt / C.correctTauS)
            let stepAlong: Double
            let stepCross: Double
            if v < C.stillMps || age > C.predictMaxS {
                // áll, vagy nincs friss fix: lassan a becslésre (hátrafelé is)
                let cap = C.correctMinMps * dt
                stepAlong = clampAbs(along * k, cap)
                stepCross = clampAbs(cross * k, cap)
            } else {
                // menetirányban a mért sebesség körül, korlátok között: nem ugrik és nem megy hátra
                stepAlong = max(v * (1 - C.alongFactor) * dt, min(v * (1 + C.alongFactor) * dt, v * dt + along * k))
                stepCross = clampAbs(cross * k, max(C.correctMinMps, v * C.crossFactor) * dt)
            }
            lat = p.lat + (cosD * stepAlong - sinD * stepCross) / mPerDeg
            lon = p.lon + (sinD * stepAlong + cosD * stepCross) / (mPerDeg * cosLat)
        }
        let delta = ((dir - p.bearing).truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180
        let bearing = (p.bearing + delta * (1 - exp(-dt / C.bearingTauS)) + 360).truncatingRemainder(dividingBy: 360)
        let next = SmoothPose(lat: lat, lon: lon, bearing: bearing, speedMps: v)
        pose = next
        return next
    }
}
