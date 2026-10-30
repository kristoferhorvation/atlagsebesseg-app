import Foundation

// A packages/app-logic/src/settings.ts portja (ugyanaz a kulcs és JSON-alak, mint a weben; a jelzések csak iOS-en).

nonisolated enum SpeedUnit: String, Codable, Sendable {
    case kmh, mph
}

/// A térkép kinézete (AW16): világos (`default` téma, napközben nappali fény), színes (`default` téma, napközben alkonyi
/// fény – az alap) vagy visszafogott (`monochrome`); napnyugtakor és éjjel a fény mindháromnál azonos – `mapLightPreset`.
/// A sorrend (`allCases`) a beállítás-választóé.
nonisolated enum MapLook: String, Codable, Sendable, CaseIterable {
    case vilagos, szines, visszafogott
}

nonisolated struct Settings: Equatable, Sendable {
    /// A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz).
    var hatosagiTuresMegjelenitese = false
    var egyseg: SpeedUnit = .kmh
    var terkep: MapLook = .szines
    /// A rendőrség által előre közzétett mérési helyszínek (vonal / zóna a térképen + felső sáv).
    var tervezettMeresek = true
    /// Navigáció hangja (A11: fordulók, szakaszellenőrzés, „túl gyors”, gyorsabb út bemondása).
    var hangosUtasitasok = true
    /// Kamera- és szakaszkapu-közeledés jelzése (A10, csak iOS).
    var kameraJelzes = true
    /// Jelzés, amikor tervezett mérés vonalára / zónájába érünk (A10, csak iOS).
    var tervezettJelzes = true
    /// A jelzések módja: hang / csak rezgés / ki (A10, csak iOS; alapból hang).
    var jelzesMod: AlertMode = .hang
    /// AOS14: a köszöntés neve („Szia Kristof!”); üresen név nélkül köszön („Szia!”).
    var megszolitas = ""

    static let `default` = Settings()
    static let storageKey = "settings:v1"

    /// Tárolt beállítások beolvasása; ismeretlen / sérült érték helyett az alapértelmezés.
    static func parse(_ raw: String?) -> Settings {
        guard let raw, let data = raw.data(using: .utf8),
              let p = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return .default }
        var s = Settings.default
        if let v = p["hatosagi_tures_megjelenitese"] as? Bool { s.hatosagiTuresMegjelenitese = v }
        if let v = (p["egyseg"] as? String).flatMap(SpeedUnit.init(rawValue:)) { s.egyseg = v }
        if let v = (p["terkep"] as? String).flatMap(MapLook.init(rawValue:)) { s.terkep = v }
        if let v = p["tervezett_meresek"] as? Bool { s.tervezettMeresek = v }
        if let v = p["hangos_utasitasok"] as? Bool { s.hangosUtasitasok = v }
        if let v = p["kamera_jelzes"] as? Bool { s.kameraJelzes = v }
        if let v = p["tervezett_jelzes"] as? Bool { s.tervezettJelzes = v }
        if let v = (p["jelzes_mod"] as? String).flatMap(AlertMode.init(rawValue:)) { s.jelzesMod = v }
        if let v = p["megszolitas"] as? String { s.megszolitas = normalizeName(v) }
        return s
    }

    func serialized() -> String {
        let obj: [String: Any] = [
            "hatosagi_tures_megjelenitese": hatosagiTuresMegjelenitese, "egyseg": egyseg.rawValue, "terkep": terkep.rawValue,
            "tervezett_meresek": tervezettMeresek, "hangos_utasitasok": hangosUtasitasok,
            "kamera_jelzes": kameraJelzes, "tervezett_jelzes": tervezettJelzes, "jelzes_mod": jelzesMod.rawValue,
            "megszolitas": megszolitas,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    static func load(_ defaults: UserDefaults = .standard) -> Settings { parse(defaults.string(forKey: storageKey)) }
    func save(_ defaults: UserDefaults = .standard) { defaults.set(serialized(), forKey: Settings.storageKey) }
}

/// A tárolt / beírt név (a webes `normalizeName`): szélein vágva, a belső szóközök egyre, legfeljebb `MEGSZOLITAS_MAX` karakter.
nonisolated func normalizeName(_ raw: String) -> String {
    let collapsed = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return String(collapsed.prefix(MEGSZOLITAS_MAX)).trimmingCharacters(in: .whitespaces)
}

/// AOS14: az üres nézet köszöntője – kitöltött megszólítással „Szia Kristof!”, üresen „Szia!” (a webes `greetingText`).
nonisolated func greetingText(_ name: String, lang: Lang? = nil) -> String {
    let n = normalizeName(name)
    return n.isEmpty ? t(.greetAnon, lang: lang) : t(.greetNamed, ["name": n], lang: lang)
}

/// AOS14: a navigáció indításakor elhangzó köszönés (a kézi mérés indításakor nincs) – a webes `greetingVoice`.
nonisolated func greetingVoice(_ name: String, lang: Lang? = nil) -> String {
    let n = normalizeName(name)
    return n.isEmpty ? t(.navVoiceGreet, lang: lang) : t(.navVoiceGreetNamed, ["name": n], lang: lang)
}
