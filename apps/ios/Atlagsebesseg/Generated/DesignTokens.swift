// GENERÁLT FÁJL – kézzel ne szerkeszd.
// Forrás: packages/design-tokens/src/index.ts; újragenerálás: npm run generate -w @atlagsebesseg/ios

import SwiftUI

/// Dizájn-tokenek (DESIGN.md) – a webes CSS-változók Swift-megfelelője.
enum Tokens {
    enum Colors {
        /// `#06070A`
        static let bg = Color(.sRGB, red: 0.023529, green: 0.027451, blue: 0.039216, opacity: 1)
        /// `rgba(14,16,22,0.72)`
        static let surface = Color(.sRGB, red: 0.054902, green: 0.062745, blue: 0.086275, opacity: 0.72)
        /// `rgba(22,25,32,0.88)`
        static let surfaceStrong = Color(.sRGB, red: 0.086275, green: 0.098039, blue: 0.12549, opacity: 0.88)
        /// `rgba(255,255,255,0.06)`
        static let surfaceRaised = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.06)
        /// `rgba(255,255,255,0.08)`
        static let stroke = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.08)
        /// `rgba(255,255,255,0.16)`
        static let strokeStrong = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.16)
        /// `#F4F6FA`
        static let text = Color(.sRGB, red: 0.956863, green: 0.964706, blue: 0.980392, opacity: 1)
        /// `rgba(244,246,250,0.64)`
        static let textMuted = Color(.sRGB, red: 0.956863, green: 0.964706, blue: 0.980392, opacity: 0.64)
        /// `rgba(244,246,250,0.40)`
        static let textFaint = Color(.sRGB, red: 0.956863, green: 0.964706, blue: 0.980392, opacity: 0.4)
        /// `#7A86FF`
        static let accent = Color(.sRGB, red: 0.478431, green: 0.52549, blue: 1, opacity: 1)
        /// `#2EE59D`
        static let ok = Color(.sRGB, red: 0.180392, green: 0.898039, blue: 0.615686, opacity: 1)
        /// `#FFB224`
        static let near = Color(.sRGB, red: 1, green: 0.698039, blue: 0.141176, opacity: 1)
        /// `#FF4D61`
        static let over = Color(.sRGB, red: 1, green: 0.301961, blue: 0.380392, opacity: 1)
        /// `#8C93A3`
        static let idle = Color(.sRGB, red: 0.54902, green: 0.576471, blue: 0.639216, opacity: 1)
        /// `#F2DC82`
        static let planned = Color(.sRGB, red: 0.94902, green: 0.862745, blue: 0.509804, opacity: 1)
        /// `#E5303F`
        static let signRing = Color(.sRGB, red: 0.898039, green: 0.188235, blue: 0.247059, opacity: 1)
        /// `#FFFFFF`
        static let signFace = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
        /// `#0B0C10`
        static let signText = Color(.sRGB, red: 0.043137, green: 0.047059, blue: 0.062745, opacity: 1)
    }

    /// Státusz → szín (a nagy szám, a progress és az aktív szakasz vonala).
    enum StatusColors {
        static let jo = Colors.ok
        static let lassits = Colors.near
        static let tul_gyors = Colors.over
        static let hataron = Colors.near
        static let tul = Colors.over
        static let semleges = Colors.idle
        static let kezi = Colors.accent
    }

    /// A betűcsalád (a web `Inter Variable`-je; az app a Resources/Fonts/InterVariable.ttf-et regisztrálja).
    enum Fonts {
        static let family = "Inter Variable"
    }

    enum Typography {
        static let hero = TypeStyle(size: 196, weight: 680, lineHeight: 0.9, tracking: -0.045)
        static let heroMin: CGFloat = 120
        static let heroVw: CGFloat = 42
        static let display = TypeStyle(size: 64, weight: 650, lineHeight: 1, tracking: -0.03)
        static let title = TypeStyle(size: 28, weight: 620, lineHeight: 1.15, tracking: -0.015)
        static let body = TypeStyle(size: 20, weight: 500, lineHeight: 1.3, tracking: -0.005)
        static let caption = TypeStyle(size: 15, weight: 500, lineHeight: 1.35, tracking: 0)
    }

    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 20
        static let s6: CGFloat = 24
        static let s8: CGFloat = 32
        static let s10: CGFloat = 40
        static let s12: CGFloat = 48
    }

    enum Radius {
        static let button: CGFloat = 14
        static let tile: CGFloat = 22
        static let card: CGFloat = 32
        static let pill: CGFloat = 999
    }

    enum Size {
        static let touch: CGFloat = 56
        static let roundButton: CGFloat = 64
        static let progress: CGFloat = 10
        static let tile: CGFloat = 76
    }

    enum Blur {
        static let glass: CGFloat = 28
    }

    enum Shadow {
        static let card: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 24, blur: 60, spread: -12, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.65)),
            ShadowLayer(x: 0, y: 2, blur: 8, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.35)),
        ]
    }

    /// Másodpercben (a token ms-ben van).
    enum Motion {
        static let fast: Double = 0.16
        static let base: Double = 0.28
        static let slow: Double = 0.48
        static let data: Double = 1
        static let easePoints: (Double, Double, Double, Double) = (0.2, 0.8, 0.2, 1)
    }
}

/// Egy típus-lépcső: méret (pt), súly (100–900), sormagasság (szorzó), betűköz (em).
struct TypeStyle {
    let size: CGFloat
    let weight: CGFloat
    let lineHeight: CGFloat
    let tracking: CGFloat
}

/// A CSS `box-shadow` egy rétege (`spread` SwiftUI-ban nem jeleníthető meg, csak tájékoztató).
struct ShadowLayer {
    let x: CGFloat
    let y: CGFloat
    let blur: CGFloat
    let spread: CGFloat
    let color: Color
}
