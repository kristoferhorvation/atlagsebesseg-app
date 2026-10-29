import Foundation

/// A támogatott nyelvek (a webes `LANGUAGES` sorrendjében).
nonisolated enum Lang: String, CaseIterable, Sendable {
    case hu, en, de, sk, cs, pl

    /// BCP 47 címke a számformázáshoz (a webes `LOCALES`).
    var locale: Locale {
        let tag = ["hu": "hu-HU", "en": "en-GB", "de": "de-DE", "sk": "sk-SK", "cs": "cs-CZ", "pl": "pl-PL"][rawValue]!
        return Locale(identifier: tag)
    }

    /// A nyelv neve a saját nyelvén (a nyelvválasztóban; nem fordítandó).
    var nativeName: String { LANGUAGE_NAMES[rawValue] ?? rawValue }
    var flag: String { LANGUAGE_FLAGS[rawValue] ?? "" }
}

/// A nyelvválasztó sorai (AW15, a webes `languageMenu`): zászló + a saját nyelvén írt név, a név szerint ábécérendben
/// (ékezet nélkül összevetve: Čeština a C-nél). Az „Automatikus” sor nem része, az mindig legfelül áll.
nonisolated func languageMenu() -> [(lang: Lang, label: String)] {
    Lang.allCases
        .sorted { $0.nativeName.compare($1.nativeName, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedAscending }
        .map { ($0, "\($0.flag) \($0.nativeName)") }
}

/// A választott nyelv (AW15; `nil`: automatikus – a készülék nyelve). Ugyanaz a kulcs és érték, mint a weben (`lang:v1`:
/// nyelvkód vagy `auto`). Megfigyelhető: a `t()` az `L10n.lang`-on át olvassa, így a nézetek, amelyek a törzsükben
/// feliratot kérnek, a választásra újrarajzolnak (a SwiftUI a törzsben olvasott megfigyelhető értékre feliratkozik).
nonisolated final class LangChoice: Observable, @unchecked Sendable {
    static let shared = LangChoice()
    static let storageKey = "lang:v1"

    private let registrar = ObservationRegistrar()
    private let lock = NSLock()
    private let defaults: UserDefaults
    private var stored: Lang?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        stored = defaults.string(forKey: Self.storageKey).flatMap(Lang.init(rawValue:))
    }

    var preference: Lang? {
        get {
            registrar.access(self, keyPath: \.preference)
            return lock.withLock { stored }
        }
        set {
            registrar.withMutation(of: self, keyPath: \.preference) { lock.withLock { stored = newValue } }
            defaults.set(newValue?.rawValue ?? "auto", forKey: Self.storageKey)
        }
    }
}

/// Többnyelvűség: a feliratok a szótárból generált Localizable.xcstrings-ben vannak (`npm run generate -w
/// @atlagsebesseg/ios`). A nyelv a Beállításokban választott (AW15), automatikusnál a rendszerből jön: az iOS a
/// támogatott lokalizációk közül választ, nem támogatott rendszernyelvnél az angol (a fejlesztési nyelv) – mint a weben.
nonisolated enum L10n {
    static var lang: Lang { LangChoice.shared.preference ?? systemLang }

    /// A készülék nyelve (az „Automatikus” választás).
    static var systemLang: Lang {
        Lang(rawValue: Bundle.main.preferredLocalizations.first ?? "en") ?? .en
    }

    /// Egy nyelv saját szótára (a tesztek mind a 6 nyelvet így ellenőrzik).
    static func bundle(for lang: Lang) -> Bundle? {
        Bundle.main.path(forResource: lang.rawValue, ofType: "lproj").flatMap(Bundle.init(path:))
    }

    static func template(_ key: L10nKey, in bundle: Bundle = .main) -> String {
        bundle.localizedString(forKey: key.rawValue, value: nil, table: "Localizable")
    }

    /// `{név}` helyőrzők kitöltése; a hiányzó paraméter a helyén marad (mint a webes `t()`).
    static func fill(_ template: String, _ params: [String: String]) -> String {
        guard !params.isEmpty else { return template }
        var out = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{") {
            out += rest[..<open]
            guard let close = rest[open...].firstIndex(of: "}") else { break }
            let name = String(rest[rest.index(after: open)..<close])
            out += params[name] ?? String(rest[open...close])
            rest = rest[rest.index(after: close)...]
        }
        return out + rest
    }
}

/// Fordítás paraméterekkel: `t(.slowdownStay, ["x": "90"])` → „Maradj 90 alatt”. `lang` nélkül a választott nyelv
/// (automatikusnál a rendszeré).
nonisolated func t(_ key: L10nKey, _ params: [String: String] = [:], lang: Lang? = nil) -> String {
    let bundle = (lang ?? LangChoice.shared.preference).flatMap(L10n.bundle(for:)) ?? .main
    return L10n.fill(L10n.template(key, in: bundle), params)
}

/// Egy tizedesjegy, a nyelv tizedesjelével („12,3” / „12.3”), ezres tagolás nélkül.
nonisolated func decimal1(_ x: Double, lang: Lang = L10n.lang) -> String {
    let f = NumberFormatter()
    f.locale = lang.locale
    f.numberStyle = .decimal
    f.usesGroupingSeparator = false
    f.minimumFractionDigits = 1
    f.maximumFractionDigits = 1
    f.roundingMode = .halfUp
    return f.string(from: NSNumber(value: x)) ?? String(format: "%.1f", x)
}
