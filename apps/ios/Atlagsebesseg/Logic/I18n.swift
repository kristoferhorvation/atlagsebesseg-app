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

    /// `{név}` helyőrzők kitöltése; a hiányzó paraméter a helyén marad (mint a webes `t()`). AW25: ICU-többesszám
    /// (`{n, plural, one {# perc} few {…} many {…} other {…}}`, a `#` a kiírt érték) – a webes `fill` párja.
    static func fill(_ template: String, _ params: [String: String], lang: Lang = L10n.lang) -> String {
        guard !params.isEmpty else { return template }
        let chars = Array(template)
        var out = ""
        var i = 0
        while i < chars.count {
            if chars[i] == "{", let (name, body, end) = pluralBlock(chars, i) {
                if let v = params[name] {
                    let branches = pluralBranches(body)
                    let branch = branches[pluralCategory(pluralNumber(v), lang).rawValue] ?? branches["other"] ?? ""
                    out += branch.replacingOccurrences(of: "#", with: v)
                } else {
                    out += String(chars[i...end])
                }
                i = end + 1
            } else if chars[i] == "{", let close = chars[i...].firstIndex(of: "}") {
                let name = String(chars[(i + 1)..<close])
                out += params[name] ?? String(chars[i...close])
                i = close + 1
            } else {
                out.append(chars[i])
                i += 1
            }
        }
        return out
    }

    /// `{név, plural, …}` blokk az `i`-edik karaktertől: a név, a törzs és a záró `}` indexe (kapcsos-egyensúllyal).
    private static func pluralBlock(_ c: [Character], _ i: Int) -> (String, String, Int)? {
        var j = i + 1
        while j < c.count, c[j].isLetter || c[j].isNumber || c[j] == "_" { j += 1 }
        let head = ", plural,"
        guard j > i + 1, j + head.count <= c.count, String(c[j..<(j + head.count)]) == head else { return nil }
        var depth = 0
        var k = i
        while k < c.count {
            if c[k] == "{" { depth += 1 } else if c[k] == "}" { depth -= 1; if depth == 0 { break } }
            k += 1
        }
        guard k < c.count else { return nil }
        return (String(c[(i + 1)..<j]), String(c[(j + head.count)..<k]), k)
    }

    private static func pluralBranches(_ body: String) -> [String: String] {
        let c = Array(body)
        var out: [String: String] = [:]
        var k = 0
        while k < c.count {
            while k < c.count, c[k].isWhitespace { k += 1 }
            var e = k
            while e < c.count, c[e].isLetter { e += 1 }
            let key = String(c[k..<e])
            while e < c.count, c[e].isWhitespace { e += 1 }
            guard !key.isEmpty, e < c.count, c[e] == "{" else { break }
            var d = 1
            var f = e + 1
            while f < c.count, d > 0 { if c[f] == "{" { d += 1 } else if c[f] == "}" { d -= 1 }; f += 1 }
            out[key] = String(c[(e + 1)..<(f - 1)])
            k = f
        }
        return out
    }

    /// A paraméter számértéke (a kiírt „2,1” is szám); nem szám → `nan` (az `other` ág).
    private static func pluralNumber(_ v: String) -> Double {
        Double(v.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "\u{00A0}", with: "").replacingOccurrences(of: ",", with: ".")) ?? .nan
    }
}

/// AW25: CLDR többesszám-kategória a 6 nyelvre (a webes `pluralCategory` párja, bitre azonos szabállyal).
nonisolated enum PluralCategory: String, Sendable { case one, few, many, other }

nonisolated func pluralCategory(_ n: Double, _ lang: Lang) -> PluralCategory {
    if n.isNaN { return .other }
    let a = abs(n)
    let isInt = a == a.rounded(.towardZero)
    switch lang {
    case .sk, .cs:
        if !isInt { return .many }
        return a == 1 ? .one : (a >= 2 && a <= 4 ? .few : .other)
    case .pl:
        if !isInt { return .other }
        if a == 1 { return .one }
        let m10 = Int(a.truncatingRemainder(dividingBy: 10)), m100 = Int(a.truncatingRemainder(dividingBy: 100))
        return m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? .few : .many
    default:
        return isInt && a == 1 ? .one : .other
    }
}

/// Fordítás paraméterekkel: `t(.slowdownStay, ["x": "90"])` → „Maradj 90 alatt”. `lang` nélkül a választott nyelv
/// (automatikusnál a rendszeré).
nonisolated func t(_ key: L10nKey, _ params: [String: String] = [:], lang: Lang? = nil) -> String {
    let bundle = (lang ?? LangChoice.shared.preference).flatMap(L10n.bundle(for:)) ?? .main
    return L10n.fill(L10n.template(key, in: bundle), params, lang: lang ?? L10n.lang)
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
