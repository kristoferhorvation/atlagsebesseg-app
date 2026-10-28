import Foundation

// A packages/app-logic/src/settings.ts portja (ugyanaz a kulcs és JSON-alak, mint a weben).

nonisolated enum SpeedUnit: String, Codable, Sendable {
    case kmh, mph
}

/// A térkép kinézete: színes (Mapbox Standard `default`) vagy visszafogott (`monochrome`).
nonisolated enum MapLook: String, Codable, Sendable {
    case szines, visszafogott
}

nonisolated struct Settings: Equatable, Sendable {
    /// A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz).
    var hatosagiTuresMegjelenitese = false
    var egyseg: SpeedUnit = .kmh
    var terkep: MapLook = .szines
    /// A rendőrség által előre közzétett mérési helyszínek (A10+ az iOS-en; a beállítás megmarad).
    var tervezettMeresek = true
    /// Navigáció hangja (A10+ az iOS-en; a beállítás megmarad).
    var hangosUtasitasok = true

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
        return s
    }

    func serialized() -> String {
        let obj: [String: Any] = [
            "hatosagi_tures_megjelenitese": hatosagiTuresMegjelenitese, "egyseg": egyseg.rawValue, "terkep": terkep.rawValue,
            "tervezett_meresek": tervezettMeresek, "hangos_utasitasok": hangosUtasitasok,
        ]
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    static func load(_ defaults: UserDefaults = .standard) -> Settings { parse(defaults.string(forKey: storageKey)) }
    func save(_ defaults: UserDefaults = .standard) { defaults.set(serialized(), forKey: Settings.storageKey) }
}
