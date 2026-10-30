import AtlagsebessegCore

// A packages/app-logic/src/lightPreset.ts portja.

/// A Mapbox Standard stílus fény-előbeállítása.
nonisolated enum LightPreset: String, Sendable {
    case dawn, day, dusk, night
}

/// Térkép-előbeállítás a helyi napszakból (AW16: a készülék sötét módja sehol nem számít): nappal → day, hajnal → dawn,
/// alkony → dusk, éjszaka → night. Helyzet nélkül (még nincs GPS) nappal.
nonisolated func chooseLightPreset(_ phase: SunPhase?) -> LightPreset {
    guard let phase else { return .day }
    switch phase {
    case .nappal: return .day
    case .hajnal: return .dawn
    case .alkony: return .dusk
    case .ejszaka: return .night
    }
}

/// Napszak szerinti előbeállítás egy időpontra és helyre.
nonisolated func lightPresetAt(_ nowMs: Double, _ pos: (any Coordinate)?) -> LightPreset {
    chooseLightPreset(pos.map { sunPhase(nowMs, $0.lat, $0.lon) })
}

/// A Mapbox Standard téma a térkép kinézetéből (a „Világos” és a „Színes” is a színes téma) – a webes `mapTheme`.
nonisolated func mapThemeIsMonochrome(_ look: MapLook) -> Bool { look == .visszafogott }

/// A térképre ténylegesen alkalmazott fény (AW16, a webes `mapLightPreset`): a napszak szerinti `preset`-ből napközben a
/// beállítás dönt (Világos = day, Színes = dusk, Visszafogott a napszak szerint); hajnalban, napnyugtakor és éjjel
/// mindhárom ugyanazt kapja. A térkép-rétegek (pl. az alternatív útvonal színe) is ehhez igazodnak.
nonisolated func mapLightPreset(_ look: MapLook, _ preset: LightPreset) -> LightPreset {
    preset == .day ? (look == .szines ? .dusk : .day) : preset
}

/// Erősebb üveg kell-e: csak ha a „Világos” térkép ténylegesen nappali fényben van (a webes `strongGlassFor`).
nonisolated func strongGlassFor(_ look: MapLook, _ applied: LightPreset) -> Bool { look == .vilagos && applied == .day }
