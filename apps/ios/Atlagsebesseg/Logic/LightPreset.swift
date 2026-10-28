import AtlagsebessegCore

// A packages/app-logic/src/lightPreset.ts portja.

/// A Mapbox Standard stílus fény-előbeállítása.
nonisolated enum LightPreset: String, Sendable {
    case dawn, day, dusk, night
}

/// Térkép-előbeállítás a helyi napszakból és a rendszer világos/sötét módjából.
/// - Világos mód: a napszak dönt (nappal → day, hajnal → dawn, alkony → dusk, éjszaka → night).
/// - Sötét mód: sosem világos – nappal is `dusk`, szürkületben és éjjel `night`.
/// - Helyzet nélkül (még nincs GPS): csak a rendszer módja (sötét → night, világos → day).
nonisolated func chooseLightPreset(_ phase: SunPhase?, dark: Bool) -> LightPreset {
    guard let phase else { return dark ? .night : .day }
    if dark { return phase == .nappal ? .dusk : .night }
    switch phase {
    case .nappal: return .day
    case .hajnal: return .dawn
    case .alkony: return .dusk
    case .ejszaka: return .night
    }
}

/// Előbeállítás egy időpontra és helyre (helyzet nélkül csak a rendszer módja számít).
nonisolated func lightPresetAt(_ nowMs: Double, _ pos: (any Coordinate)?, dark: Bool) -> LightPreset {
    chooseLightPreset(pos.map { sunPhase(nowMs, $0.lat, $0.lon) }, dark: dark)
}
