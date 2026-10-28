import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/display.ts portja.

/// A mérőkártya állapota: jó / lassíts / túl gyors (DESIGN.md; a logika a core `meterState`-je).
typealias SpeedStatus = MeterState

/// Az állapot az átlagból és a várható végső átlagból; befejezve mindkettő a végső átlag. Átlag nélkül `nil`.
nonisolated func speedStatus(_ averageKmh: Double?, _ projectedKmh: Double?, _ limitKmh: Double) -> SpeedStatus? {
    meterState(averageKmh: averageKmh, projectedKmh: projectedKmh, speedLimitKmh: limitKmh)
}

nonisolated let KMH_PER_MPH = 1.609344

/// A JS `Math.round` (fél felfelé, +∞ felé) – a webbel azonos kerekítéshez.
nonisolated func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

/// km/h → a választott egységre, egészre kerekítve (`nil` marad `nil`).
nonisolated func speedIn(_ kmh: Double?, _ unit: SpeedUnit) -> Int? {
    guard let kmh, kmh.isFinite else { return nil }
    return Int(jsRound(unit == .mph ? kmh / KMH_PER_MPH : kmh))
}

/// Mint a `speedIn`, de lefelé kerekítve (a tűrés-kijelzés ne ígérjön többet a valóságosnál).
nonisolated func speedFloorIn(_ kmh: Double?, _ unit: SpeedUnit) -> Int? {
    guard let kmh, kmh.isFinite else { return nil }
    return Int((unit == .mph ? kmh / KMH_PER_MPH : kmh).rounded(.down))
}

nonisolated func unitLabel(_ unit: SpeedUnit) -> String { unit == .mph ? "mph" : "km/h" }

/// Távolság: 1 km alatt 10 m-re kerekítve, felette egy tizedessel (mph-nál mérföldben).
nonisolated func formatDistance(_ m: Double, _ unit: SpeedUnit, lang: Lang = L10n.lang) -> (value: String, unit: String) {
    if unit == .mph {
        let mi = m / 1609.344
        return mi < 0.2 ? (String(Int(jsRound((m * 3.28084) / 50) * 50)), "ft") : (decimal1(mi, lang: lang), "mi")
    }
    if m < 1000 { return (String(Int(max(0, jsRound(m / 10) * 10))), "m") }
    return (decimal1(m / 1000, lang: lang), "km")
}

/// Eltelt idő „m:ss” vagy „h:mm:ss” alakban.
nonisolated func formatDuration(_ ms: Double) -> String {
    let s = Int(max(0, jsRound(ms / 1000)))
    let h = s / 3600
    let mm = (s % 3600) / 60
    let ss = String(format: "%02d", s % 60)
    return h > 0 ? "\(h):\(String(format: "%02d", mm)):\(ss)" : "\(mm):\(ss)"
}

/// Megtett hányad 0…1 között.
nonisolated func progressOf(_ doneM: Double, _ lengthM: Double) -> Double {
    lengthM > 0 ? min(1, max(0, doneM / lengthM)) : 0
}

/// „Forrás: Polizia di Stato, 2026-08” – a szakasz-kártyára.
nonisolated func sectionSourceLabel(_ s: Section, lang: Lang? = nil) -> String {
    if let p = s.provenance { return t(.sourceNamed, ["name": p.name, "date": p.date], lang: lang) }
    switch s.source {
    case .osm: return t(.sourceOsm, lang: lang)
    case .hivatalos: return t(.sourceOfficial, lang: lang)
    case .kozosseg: return t(.sourceCommunity, lang: lang)
    }
}

/// Az appban a `Section` a mérőszakasz (a SwiftUI `Section` helyett: ott `SwiftUI.Section`).
typealias Section = AtlagsebessegCore.Section
