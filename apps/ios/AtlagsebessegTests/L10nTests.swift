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

    @Test("a helyhozzáférés szövege és az app neve nyelvenként (InfoPlist.xcstrings)", arguments: Lang.allCases)
    func infoPlist(lang: Lang) throws {
        let bundle = try #require(L10n.bundle(for: lang))
        let dict = try Repo.dictionary(lang)
        #expect(bundle.localizedString(forKey: "NSLocationWhenInUseUsageDescription", value: nil, table: "InfoPlist") == dict["ios.locationUsage"])
        #expect(bundle.localizedString(forKey: "CFBundleDisplayName", value: nil, table: "InfoPlist") == dict["app.name"])
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

    static func sources() -> [(rel: String, text: String)] {
        let dir = Repo.iosDir.appendingPathComponent("Atlagsebesseg")
        let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: nil)?.compactMap { $0 as? URL } ?? []
        return files.filter { $0.pathExtension == "swift" }.compactMap { url in
            let rel = String(url.path.dropFirst(dir.path.count + 1))
            guard !exempt.contains(where: rel.hasPrefix), let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
            return (rel, text)
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

    @Test("nincs szó szerinti felirat a nézetekben (Text/Button/Toggle/… szöveg-literállal)")
    func nincsLiteral() {
        let pattern = #"\b(Text|Label|Button|Toggle|Picker|LabeledContent|navigationTitle|Section|accessibilityLabel)\(\s*"\p{L}"#
        for (rel, text) in Self.sources() {
            let hits = Self.stripComments(text).split(separator: "\n").filter { $0.range(of: pattern, options: .regularExpression) != nil }
            #expect(hits.isEmpty, "szó szerinti felirat: \(rel): \(hits)")
        }
    }
}
