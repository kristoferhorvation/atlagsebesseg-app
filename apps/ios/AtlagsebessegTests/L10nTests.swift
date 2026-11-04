import Foundation
import Testing
@testable import Atlagsebesseg

/// A repó mappái (a teszt a szimulátorban is a gazdagép fájljait olvassa).
enum Repo {
    static let iosDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    static let root = iosDir.deletingLastPathComponent().deletingLastPathComponent()

    static func dictionary(_ lang: Lang) throws -> [String: String] {
        let url = root.appendingPathComponent("packages/app-logic/src/i18n/\(lang.rawValue).json")
        return try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
    }
}

/// CLAUDE.md-szabály az iOS-en is: minden felirat a 6 nyelvű szótárból (Localizable.xcstrings, generálva).
@Suite("szótár: minden kulcs mind a 6 nyelven")
struct L10nTests {
    @Test("az L10nKey pontosan a szótár kulcsai (a generált fájl friss)")
    func kulcsok() throws {
        let hu = try Repo.dictionary(.hu)
        #expect(Set(L10nKey.allCases.map(\.rawValue)) == Set(hu.keys))
    }

    @Test("minden nyelv minden kulcsa az app csomagjában, a szótár szövegével", arguments: Lang.allCases)
    func nyelv(lang: Lang) throws {
        let bundle = try #require(L10n.bundle(for: lang), "nincs \(lang.rawValue).lproj")
        let dict = try Repo.dictionary(lang)
        for key in L10nKey.allCases {
            let value = L10n.template(key, in: bundle)
            #expect(value != key.rawValue, "hiányzik: \(lang.rawValue) \(key.rawValue)")
            #expect(value == dict[key.rawValue], "eltér: \(lang.rawValue) \(key.rawValue)")
        }
    }

    /// AW21: szándékosan a magyarral azonos értékek (márkanév, mértékegység, szám, rövidítés, közös szó) – a webes `i18n.test.ts` `SAME_AS_HU` párja.
    static let sameAsHu: [Lang: Set<String>] = {
        let all: Set<String> = ["pill.gps.accuracy", "pill.gps.active", "settings.gps", "report.alert.ahead", "ios.live.attribution", "heat.zone.200", "heat.zone.500", "heat.zone.1000", "account.google"]
        let maxKeys: Set<String> = ["slowdown.compactMax", "planned.max", "planned.maxApprox"]
        return [
            .en: all.union(maxKeys).union(["date.range.day", "date.range.month", "date.range.months"]),
            .de: all, .pl: all.union(["account.email"]),
            .cs: all.union(maxKeys).union(["account.email"]),
            .sk: all.union(["date.month.1", "date.month.5", "date.month.6", "date.month.7", "date.month.8", "date.month.10", "date.month.11", "date.month.12", "sections.status.cache", "nav.picker.alt", "account.email"]),
        ]
    }()

    @Test("AW21: a lefordított csomagból renderelve egyetlen szöveg sem egyezik a hu értékével, és nincs ő / ű (kivéve a szándékosan azonosakat)", arguments: Lang.allCases.filter { $0 != .hu })
    func nincsMagyarMasNyelven(lang: Lang) throws {
        let bundle = try #require(L10n.bundle(for: lang))
        let huBundle = try #require(L10n.bundle(for: .hu))
        let allowed = Self.sameAsHu[lang] ?? []
        for key in L10nKey.allCases {
            let value = L10n.template(key, in: bundle)
            if value == L10n.template(key, in: huBundle) {
                #expect(allowed.contains(key.rawValue), "magyar szöveg maradt: \(lang.rawValue) \(key.rawValue) = \(value)")
            }
            #expect(value.range(of: "[őűŐŰ]", options: .regularExpression) == nil, "magyar betű: \(lang.rawValue) \(key.rawValue) = \(value)")
        }
    }

    @Test("a helyhozzáférés szövege és az app neve nyelvenként (InfoPlist.xcstrings)", arguments: Lang.allCases)
    func infoPlist(lang: Lang) throws {
        let bundle = try #require(L10n.bundle(for: lang))
        let dict = try Repo.dictionary(lang)
        #expect(bundle.localizedString(forKey: "NSLocationWhenInUseUsageDescription", value: nil, table: "InfoPlist") == dict["ios.locationUsage"])
        #expect(bundle.localizedString(forKey: "CFBundleDisplayName", value: nil, table: "InfoPlist") == dict["ios.displayName"])
    }

    @Test("AW15: a nyelvválasztó zászlóval, a saját nyelvén írt név szerint ábécérendben")
    func nyelvLista() {
        #expect(languageMenu().map(\.label) == ["🇨🇿 Čeština", "🇩🇪 Deutsch", "🇬🇧 English", "🇭🇺 Magyar", "🇵🇱 Polski", "🇸🇰 Slovenčina"])
        #expect(languageMenu().map(\.lang) == [.cs, .de, .en, .hu, .pl, .sk])
    }

    @Test("AW15: a választott nyelv tárolva (a webes kulcs és érték), automatikusnál a rendszer nyelve")
    func nyelvValasztas() throws {
        let defaults = try #require(UserDefaults(suiteName: "aw15-lang-test"))
        defaults.removePersistentDomain(forName: "aw15-lang-test")
        let c = LangChoice(defaults: defaults)
        #expect(c.preference == nil)
        c.preference = .de
        #expect(defaults.string(forKey: "lang:v1") == "de")
        #expect(LangChoice(defaults: defaults).preference == .de)
        c.preference = nil
        #expect(defaults.string(forKey: "lang:v1") == "auto")
        #expect(LangChoice(defaults: defaults).preference == nil)
    }

    @Test("t(): paraméterek; a hiányzó paraméter a helyén marad")
    func parameterek() {
        #expect(t(.slowdownStay, ["x": "90"], lang: .hu) == "Maradj 90 alatt")
        #expect(t(.slowdownStay, [:], lang: .hu) == "Maradj {x} alatt")
        #expect(t(.slowdownStay, ["y": "1"], lang: .hu) == "Maradj {x} alatt")
        #expect(t(.slowdownStay, ["x": "56"], lang: .en).contains("56"))
    }
}

/// A webes `i18n-guard.test.ts` iOS-megfelelője: a nézetekben nincs szótáron kívüli felirat.
@Suite("nincs szótáron kívüli felirat az iOS-kódban")
struct LiteralGuardTests {
    /// A szimulátor feliratai (Sim/) kivételek; a generált fájlok (Generated/) a szótárból jönnek.
    static let exempt = ["Sim/", "Generated/"]

    /// Az app és (AOS14) a Live Activity widget-kiterjesztésének forrásai.
    static func sources() -> [(rel: String, text: String)] {
        ["Atlagsebesseg", "AtlagsebessegWidget"].flatMap { name -> [(rel: String, text: String)] in
            let dir = Repo.iosDir.appendingPathComponent(name)
            let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL } ?? []
            return files.filter { $0.pathExtension == "swift" }.compactMap { url in
                let rel = String(url.path.dropFirst(dir.path.count + 1))
                guard !exempt.contains(where: rel.hasPrefix), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
                return (name == "Atlagsebesseg" ? rel : "\(name)/\(rel)", text)
            }
        }.sorted { $0.rel < $1.rel }
    }

    /// Kommentek nélkül (a `//` csak akkor komment, ha nem `:` előzi, mint az URL-ekben).
    static func stripComments(_ s: String) -> String {
        let noBlocks = s.replacingOccurrences(of: #"/\*[\s\S]*?\*/"#, with: "", options: .regularExpression)
        return noBlocks.split(separator: "\n", omittingEmptySubsequences: false).map { line in
            String(line).replacingOccurrences(of: #"(^|[^:])//.*$"#, with: "$1", options: .regularExpression)
        }.joined(separator: "\n")
    }

    @Test("a forrásfájlok megvannak")
    func vannakForrasok() {
        #expect(Self.sources().count > 10)
    }

    @Test("nincs ékezetes magyar szöveg a kódban (kommenteken kívül)")
    func nincsMagyar() {
        for (rel, text) in Self.sources() {
            let hits = Self.stripComments(text).split(separator: "\n").enumerated().filter { _, line in
                line.range(of: "[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]", options: .regularExpression) != nil
            }
            #expect(hits.isEmpty, "magyar felirat a kódban – a szótárba való: \(rel): \(hits.map { "\($0.offset + 1): \($0.element)" })")
        }
    }

    @Test("nincs rendszerbetű: minden felirat Interrel, a token súlyával (DESIGN.md)")
    func nincsRendszerbetu() {
        for (rel, text) in Self.sources() {
            let hits = Self.stripComments(text).split(separator: "\n").filter { $0.contains(".system(size:") }
            #expect(hits.isEmpty, "rendszerbetű: \(rel): \(hits)")
        }
    }

    @Test("nincs szó szerinti felirat a nézetekben (Text/Button/Toggle/… szöveg-literállal)")
    func nincsLiteral() {
        // AW21: kiterjesztve – több nézet-forma, `Text(verbatim:)`, névvel adott felirat-argumentum (`title:` / `label:` / `message:` …),
        // AppIntent-feliratok; a szótár-kulcs (`ios.intent.x`, szóköz nélkül, pontos) szabad
        let patterns = [
            #"\b(Text|Label|Button|Toggle|Picker|LabeledContent|navigationTitle|Section|accessibilityLabel|accessibilityHint|TextField|SecureField|Link|Menu|ShareLink|help|alert|confirmationDialog)\(\s*"\p{L}"#,
            #"\bText\(\s*verbatim:\s*"\p{L}"#,
            #"\b(title|label|message|placeholder|prompt|subtitle|hint|text)\s*:\s*"[\p{Lu}][\p{L}]*[ ,.!?…]"#,
            #"LocalizedStringResource\s*=\s*"[^"]*\s"#,
        ]
        for (rel, text) in Self.sources() {
            let hits = Self.stripComments(text).split(separator: "\n").filter { line in
                patterns.contains { line.range(of: $0, options: .regularExpression) != nil }
            }
            #expect(hits.isEmpty, "szó szerinti felirat: \(rel): \(hits)")
        }
    }
}

/// AOS18 (1.1): az apps/ios-ban literál szín / árnyék / sarok / betűméret tilos, minden a generált tokenekből (`packages/design-tokens`), és a SwiftUI
/// alapértelmezései (rendszer-árnyék, alap Mapbox puck, natív segmented picker, alap gombstílus) sem kerülhetnek vissza. Új iOS-UI: CLAUDE.md › Paritás.
@Suite("paritás-lint: nincs literál dizájn-érték az iOS-kódban")
struct ParityLintTests {
    /// A térképkép CPU-s színpalettája (`LIVE_MAP_PALETTE`) és a Static Images API URL-jének Mapbox-stílus azonosítói nem UI-tokenek.
    static let whitelist = ["LiveActivity/LiveMap.swift"]

    private func hits(_ pattern: String) -> [String] {
        LiteralGuardTests.sources().filter { !Self.whitelist.contains($0.rel) }.flatMap { rel, text in
            LiteralGuardTests.stripComments(text).split(separator: "\n").enumerated()
                .filter { _, line in line.range(of: pattern, options: .regularExpression) != nil }
                .map { "\(rel):\($0.offset + 1): \($0.element.trimmingCharacters(in: .whitespaces))" }
        }
    }

    @Test("betűméret és -súly csak tokenből", arguments: [
        #"\.(inter|num|css)\(\s*[\d.]+"#,
        #"\.(inter|num|css)\([^,()]+,\s*[\d.]+"#,
        #"\.font\(\.(largeTitle|title|title2|title3|headline|subheadline|body|callout|footnote|caption|caption2)\b"#,
        #"\.system\(size:"#,
    ])
    func betu(pattern: String) { #expect(hits(pattern).isEmpty, "\(hits(pattern))") }

    @Test("szín csak tokenből", arguments: [
        #"\bColor\.(white|black|red|blue|green|gray|yellow|orange|pink|purple|primary|secondary)\b"#,
        #"\bColor\(\s*(\.sRGB|red:|white:|hue:|\.display|uiColor|")"#,
        #"\bUIColor\((red|white|hue|displayP3):"#,
        #"(fill|foregroundStyle|foregroundColor|background|tint)\(\s*\.(white|black|red|blue|green|gray|yellow|orange)\b"#,
        #"\.(white|black)\.opacity\("#,
    ])
    func szin(pattern: String) { #expect(hits(pattern).isEmpty, "\(hits(pattern))") }

    @Test("árnyék és sarok csak tokenből", arguments: [
        #"\.shadow\([^)]*radius:\s*[\d.]+"#,
        #"\.shadow\(\s*color:\s*\.(black|white)"#,
        #"cornerRadius:\s*[\d.]+"#,
        #"glass\(radius:\s*[\d.]+"#,
    ])
    func arnyek(pattern: String) { #expect(hits(pattern).isEmpty, "\(hits(pattern))") }

    @Test("átlátszóság csak tokenből")
    func atlatszosag() { #expect(hits(#"\.opacity\(0?\.\d+\)"#).isEmpty, "\(hits(#"\.opacity\(0?\.\d+\)"#))") }

    @Test("SwiftUI / Mapbox alapértelmezés tilos", arguments: [
        #"\.pickerStyle\("#,
        #"\.buttonStyle\(\.(automatic|bordered|borderedProminent|borderless)\)"#,
        #"\.toggleStyle\(\.(automatic|switch|button)\)"#,
        #"\b(Puck2D|Puck3D|puck2D|puck3D|\.puckType)\b"#,
        #"\bUISegmentedControl\b"#,
    ])
    func alap(pattern: String) { #expect(hits(pattern).isEmpty, "\(hits(pattern))") }
}
