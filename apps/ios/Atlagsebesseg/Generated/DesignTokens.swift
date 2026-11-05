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
        /// `#2EE59D`
        static let accent = Color(.sRGB, red: 0.180392, green: 0.898039, blue: 0.615686, opacity: 1)
        /// `#7A86FF`
        static let brand = Color(.sRGB, red: 0.478431, green: 0.52549, blue: 1, opacity: 1)
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
        /// `#1F5BFF`
        static let route = Color(.sRGB, red: 0.121569, green: 0.356863, blue: 1, opacity: 1)
        /// `#FFFFFF`
        static let routeCasing = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
        /// `#799CF8`
        static let routeAltDay = Color(.sRGB, red: 0.47451, green: 0.611765, blue: 0.972549, opacity: 1)
        /// `#1E49C1`
        static let routeAltNight = Color(.sRGB, red: 0.117647, green: 0.286275, blue: 0.756863, opacity: 1)
        /// `#1A2130`
        static let routeAltCasingDay = Color(.sRGB, red: 0.101961, green: 0.129412, blue: 0.188235, opacity: 1)
        /// `rgba(232,235,239,0.6)`
        static let routeAltCasingNight = Color(.sRGB, red: 0.909804, green: 0.921569, blue: 0.937255, opacity: 0.6)
        /// `#E8EBEF`
        static let mapBgDay = Color(.sRGB, red: 0.909804, green: 0.921569, blue: 0.937255, opacity: 1)
        /// `#1B2030`
        static let mapBgNight = Color(.sRGB, red: 0.105882, green: 0.12549, blue: 0.188235, opacity: 1)
        /// `#5B6CFF`
        static let heatFreqLow = Color(.sRGB, red: 0.356863, green: 0.423529, blue: 1, opacity: 1)
        /// `#C65CFF`
        static let heatFreqMid = Color(.sRGB, red: 0.776471, green: 0.360784, blue: 1, opacity: 1)
        /// `#FFD166`
        static let heatFreqHigh = Color(.sRGB, red: 1, green: 0.819608, blue: 0.4, opacity: 1)
        /// `#2EE59D`
        static let heatSpeedLow = Color(.sRGB, red: 0.180392, green: 0.898039, blue: 0.615686, opacity: 1)
        /// `#FFB224`
        static let heatSpeedMid = Color(.sRGB, red: 1, green: 0.698039, blue: 0.141176, opacity: 1)
        /// `#FF4D61`
        static let heatSpeedHigh = Color(.sRGB, red: 1, green: 0.301961, blue: 0.380392, opacity: 1)
        /// `rgba(140,147,163,0.55)`
        static let heatGrey = Color(.sRGB, red: 0.54902, green: 0.576471, blue: 0.639216, opacity: 0.55)
        /// `#2EE59D`
        static let tripSlow = Color(.sRGB, red: 0.180392, green: 0.898039, blue: 0.615686, opacity: 1)
        /// `#FFB224`
        static let tripMid = Color(.sRGB, red: 1, green: 0.698039, blue: 0.141176, opacity: 1)
        /// `#FF4D61`
        static let tripFast = Color(.sRGB, red: 1, green: 0.301961, blue: 0.380392, opacity: 1)
        /// `#FFFFFF`
        static let appleButton = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
        /// `#000000`
        static let appleButtonText = Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 1)
        /// `#4285F4`
        static let googleBlue = Color(.sRGB, red: 0.258824, green: 0.521569, blue: 0.956863, opacity: 1)
        /// `#34A853`
        static let googleGreen = Color(.sRGB, red: 0.203922, green: 0.658824, blue: 0.32549, opacity: 1)
        /// `#FBBC05`
        static let googleYellow = Color(.sRGB, red: 0.984314, green: 0.737255, blue: 0.019608, opacity: 1)
        /// `#EA4335`
        static let googleRed = Color(.sRGB, red: 0.917647, green: 0.262745, blue: 0.207843, opacity: 1)
        /// `#E5303F`
        static let signRing = Color(.sRGB, red: 0.898039, green: 0.188235, blue: 0.247059, opacity: 1)
        /// `#FFFFFF`
        static let signFace = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
        /// `#0B0C10`
        static let signText = Color(.sRGB, red: 0.043137, green: 0.047059, blue: 0.062745, opacity: 1)
        /// `rgba(255,255,255,0.08)`
        static let fill08 = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.08)
        /// `rgba(255,255,255,0.09)`
        static let fill09 = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.09)
        /// `rgba(255,255,255,0.10)`
        static let fill10 = Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0.1)
        /// `rgba(16,18,24,0.6)`
        static let pillSurface = Color(.sRGB, red: 0.062745, green: 0.070588, blue: 0.094118, opacity: 0.6)
        /// `rgba(0,0,0,0.45)`
        static let sheetBackdrop = Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.45)
        /// `#4A5568`
        static let parityBackdrop = Color(.sRGB, red: 0.290196, green: 0.333333, blue: 0.407843, opacity: 1)
    }

    /// Státusz → szín (a nagy szám, a progress és az aktív szakasz vonala).
    enum StatusColors {
        static let jo = Colors.accent
        static let lassits = Colors.near
        static let tul_gyors = Colors.over
        static let hataron = Colors.near
        static let tul = Colors.over
        static let semleges = Colors.idle
        static let kezi = Colors.brand
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
        static let r3: CGFloat = 3
        static let r8: CGFloat = 8
        static let r9: CGFloat = 9
        static let r10: CGFloat = 10
        static let r12: CGFloat = 12
        static let r14: CGFloat = 14
        static let r16: CGFloat = 16
        static let r18: CGFloat = 18
        static let r20: CGFloat = 20
        static let r22: CGFloat = 22
        static let r24: CGFloat = 24
        static let r26: CGFloat = 26
        static let r28: CGFloat = 28
        static let r999: CGFloat = 999
    }

    /// Betűméret (pt) és -súly (AOS18: az iOS-en literál tilos, AppTests-őr).
    enum FontSize {
        static let f8: CGFloat = 8
        static let f12: CGFloat = 12
        static let f13: CGFloat = 13
        static let f14: CGFloat = 14
        static let f15: CGFloat = 15
        static let f16: CGFloat = 16
        static let f17: CGFloat = 17
        static let f18: CGFloat = 18
        static let f19: CGFloat = 19
        static let f20: CGFloat = 20
        static let f22: CGFloat = 22
        static let f23: CGFloat = 23
        static let f24: CGFloat = 24
        static let f26: CGFloat = 26
        static let f28: CGFloat = 28
        static let f30: CGFloat = 30
        static let f32: CGFloat = 32
        static let f34: CGFloat = 34
        static let f36: CGFloat = 36
        static let f38: CGFloat = 38
        static let f40: CGFloat = 40
        static let f44: CGFloat = 44
        static let f46: CGFloat = 46
        static let f50: CGFloat = 50
        static let f64: CGFloat = 64
    }

    enum FontWeight {
        static let w400: CGFloat = 400
        static let w500: CGFloat = 500
        static let w520: CGFloat = 520
        static let w540: CGFloat = 540
        static let w560: CGFloat = 560
        static let w580: CGFloat = 580
        static let w600: CGFloat = 600
        static let w620: CGFloat = 620
        static let w640: CGFloat = 640
        static let w650: CGFloat = 650
        static let w680: CGFloat = 680
        static let w700: CGFloat = 700
        static let w720: CGFloat = 720
        static let w760: CGFloat = 760
    }

    enum Opacity {
        static let o09: Double = 0.09
        static let o10: Double = 0.1
        static let o12: Double = 0.12
        static let o14: Double = 0.14
        static let o16: Double = 0.16
        static let o17: Double = 0.17
        static let o18: Double = 0.18
        static let o22: Double = 0.22
        static let o24: Double = 0.24
        static let o25: Double = 0.25
        static let o28: Double = 0.28
        static let o35: Double = 0.35
        static let o40: Double = 0.4
        static let o45: Double = 0.45
        static let o50: Double = 0.5
        static let o55: Double = 0.55
        static let o60: Double = 0.6
        static let o70: Double = 0.7
        static let o72: Double = 0.72
        static let o78: Double = 0.78
        static let o85: Double = 0.85
        static let o90: Double = 0.9
        static let o92: Double = 0.92
        static let o94: Double = 0.94
    }

    /// AW23: a követő kamera (web + iOS azonos számokkal).
    nonisolated enum Camera {
        static let pitch: Double = 58
        static let focusMaxY: Double = 0.8
        static let focusMinY: Double = 0.18
        static let focusGap: Double = 56
        static let focusTau: Double = 150
        static let zoomTau: Double = 1500
        static let recenter: Double = 900
        static let zoomStops: [(kmh: Double, zoom: Double)] = [(30, 17.2), (50, 16.8), (90, 15.6), (130, 14.8)]
    }

    /// A SwiftUI `shadow(radius:)` a CSS-elmosás fele.
    enum Glow {
        static let hero: CGFloat = 20
        static let progress: CGFloat = 9
        static let dot: CGFloat = 5
        static let reportPin: CGFloat = 7
    }

    enum Size {
        static let touch: CGFloat = 56
        static let roundButton: CGFloat = 64
        static let progress: CGFloat = 10
        static let tile: CGFloat = 76
    }

    enum Blur {
        static let glass: CGFloat = 28
        static let backdrop: CGFloat = 3
    }

    enum Shadow {
        static let card: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 24, blur: 60, spread: -12, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.65)),
            ShadowLayer(x: 0, y: 2, blur: 8, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.35)),
        ]
        static let sign: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 8, blur: 24, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.45)),
        ]
        static let knob: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 2, blur: 6, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.35)),
        ]
        static let startMark: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 12, blur: 40, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.5)),
        ]
        static let cameraPin: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 4, blur: 10, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.45)),
        ]
        static let routeLabel: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 3, blur: 8, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.35)),
        ]
        static let puck: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 4, blur: 14, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.5)),
        ]
        static let reportPin: [ShadowLayer] = [
            ShadowLayer(x: 0, y: 6, blur: 18, spread: 0, color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0.5)),
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
