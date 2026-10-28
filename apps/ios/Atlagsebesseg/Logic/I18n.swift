import Foundation

/// A támogatott nyelvek (a webes `LANGUAGES` sorrendjében).
nonisolated enum Lang: String, CaseIterable, Sendable {
    case hu, en, de, sk, cs, pl

    /// BCP 47 címke a számformázáshoz (a webes `LOCALES`).
    var locale: Locale {
        let tag = ["hu": "hu-HU", "en": "en-GB", "de": "de-DE", "sk": "sk-SK", "cs": "cs-CZ", "pl": "pl-PL"][rawValue]!
        return Locale(identifier: tag)
    }
}

/// Többnyelvűség: a feliratok a szótárból generált Localizable.xcstrings-ben vannak (`npm run generate -w
/// @atlagsebesseg/ios`). A nyelv a rendszerből jön: az iOS a támogatott lokalizációk közül választ, nem
/// támogatott rendszernyelvnél az angol (a fejlesztési nyelv) – mint a weben az `auto`.
nonisolated enum L10n {
    static var lang: Lang {
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

/// Fordítás paraméterekkel: `t(.slowdownStay, ["x": "90"])` → „Maradj 90 alatt”. `lang` nélkül a rendszer nyelve.
nonisolated func t(_ key: L10nKey, _ params: [String: String] = [:], lang: Lang? = nil) -> String {
    let bundle = lang.flatMap(L10n.bundle(for:)) ?? .main
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
