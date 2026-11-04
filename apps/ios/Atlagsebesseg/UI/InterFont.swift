import SwiftUI
import UIKit

// AOS14: külön fájlban, mert a Live Activity widget-kiterjesztése is fordítja (project.yml); a betűfájlt a widget a saját
// `UIAppFonts`-ából regisztrálja.

extension TypeStyle {
    var font: Font { .inter(size, weight) }
    /// A CSS `letter-spacing` em-ben → pontban.
    var trackingPt: CGFloat { tracking * size }
}

extension Font {
    /// Inter (mint a weben) a token pontos súlyával (100–900, a változó betű `wght` tengelyén).
    static func inter(_ size: CGFloat, _ weight: CGFloat) -> Font {
        #if WIDGET_EXTENSION
        widgetFont(size, weight)
        #else
        Font(UIFont.inter(size, weight))
        #endif
    }

    /// Szám (a web `.num` osztálya: táblázatos számjegyek).
    static func num(_ size: CGFloat, _ weight: CGFloat) -> Font {
        #if WIDGET_EXTENSION
        widgetFont(size, weight).monospacedDigit()
        #else
        Font(UIFont.inter(size, weight, tabular: true))
        #endif
    }

    #if WIDGET_EXTENSION
    /// AOS18: a widget nézeteit a rendszer archiválja: `UIFont`-ból épített `Font`-tal az archiválás időnként `KEY_TYPE_OF_DICTIONARY_VIOLATES_HASHABLE`-re fut
    /// (crash-napló az AOS14 óta), ezért itt natív `Font.custom`, a legközelebbi nevesített súllyal.
    private static func widgetFont(_ size: CGFloat, _ weight: CGFloat) -> Font {
        let w: Font.Weight = weight < 450 ? .regular : weight < 550 ? .medium : weight < 650 ? .semibold : weight < 750 ? .bold : .heavy
        return .custom(Tokens.Fonts.family, fixedSize: size).weight(w)
    }
    #endif
}

/// A CSS `line-height: normal` az Inter metrikáiból (hhea: 0,96875 + 0,2412): ehhez képest számol a `css` sorköze.
let interNormalLine: CGFloat = 1.21

extension View {
    /// A webes betű-szabály egy lépésben: méret, súly, sormagasság (szorzó, mint a CSS `line-height`), betűköz (em), `.num`.
    /// A sormagasság a szöveg dobozát is adja, ezért egysoros szövegnél a magasság pontosan a webes.
    func css(_ size: CGFloat, _ weight: CGFloat, line: CGFloat? = nil, tracking: CGFloat = 0, num: Bool = false) -> some View {
        // `line-height: normal` a böngészőben: az ascent és a descent külön kerekítve (Inter: 0,96875 / 0,2412)
        let normal = ((0.96875 * size).rounded() + (0.2412 * size).rounded()) / size
        let extra = ((line ?? normal) - interNormalLine) * size
        return font(num ? Font.num(size, weight) : Font.inter(size, weight))
            .tracking(tracking * size)
            .lineSpacing(max(0, extra))
            .padding(.vertical, extra / 2)
    }
}

extension UIFont {
    private static var interCache: [String: UIFont] = [:]

    /// A Resources/Fonts/InterVariable.ttf (Info.plist `UIAppFonts`) adott súllyal; számoknál `tnum`. A webes betűfájl (`@fontsource-variable/inter`, `wght` tengely) az
    /// optikai méretet nem követi, és a `cv11` / `ss01` sem hat rajta: ezért itt is rögzített `opsz` 14 és e kettő nélkül (AOS18, a paritás-kapu mérte: így egyezik a szövegszélesség és a sortörés).
    static func inter(_ size: CGFloat, _ weight: CGFloat, tabular: Bool = false) -> UIFont {
        let key = "\(size)/\(weight)/\(tabular)"
        if let f = interCache[key] { return f }
        // a változó betű tengelyei: 'wght' és 'opsz' (négybetűs OpenType-címkék számként)
        let wght = 0x7767_6874
        let opsz = 0x6F70_737A
        let features = (tabular ? ["tnum"] : []).map { [kCTFontOpenTypeFeatureTag as String: $0, kCTFontOpenTypeFeatureValue as String: 1] as [String: Any] }
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: Tokens.Fonts.family,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: weight, opsz: 14],
            UIFontDescriptor.AttributeName(rawValue: kCTFontFeatureSettingsAttribute as String): features,
        ])
        let f = UIFont(descriptor: descriptor, size: size)
        interCache[key] = f
        return f
    }
}
