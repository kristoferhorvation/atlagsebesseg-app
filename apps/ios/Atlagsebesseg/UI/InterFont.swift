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
    /// Inter (mint a weben) a token pontos súlyával (100–900, a változó betű `wght` tengelyén); az optikai
    /// méret a betűmérethez igazodik (`opsz` 14–32), mint a CSS `font-optical-sizing: auto`.
    static func inter(_ size: CGFloat, _ weight: CGFloat) -> Font {
        Font(UIFont.inter(size, weight))
    }

    /// Szám (a web `.num` osztálya: táblázatos számjegyek).
    static func num(_ size: CGFloat, _ weight: CGFloat) -> Font {
        .inter(size, weight).monospacedDigit()
    }
}

extension UIFont {
    private static var interCache: [String: UIFont] = [:]

    /// A Resources/Fonts/InterVariable.ttf (Info.plist `UIAppFonts`) adott súllyal és optikai mérettel.
    static func inter(_ size: CGFloat, _ weight: CGFloat) -> UIFont {
        let key = "\(size)/\(weight)"
        if let f = interCache[key] { return f }
        // a változó betű tengelyei: 'wght' és 'opsz' (négybetűs OpenType-címkék számként)
        let wght = 0x7767_6874
        let opsz = 0x6F70_737A
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: Tokens.Fonts.family,
            UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: weight, opsz: min(32, max(14, size))],
        ])
        let f = UIFont(descriptor: descriptor, size: size)
        interCache[key] = f
        return f
    }
}
