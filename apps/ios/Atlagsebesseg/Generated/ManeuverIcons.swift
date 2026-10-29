// GENERÁLT FÁJL – kézzel ne szerkeszd.
// Forrás: apps/web/src/ui/ManeuverIcon.tsx (MANEUVER_PATHS); újragenerálás: npm run generate -w @atlagsebesseg/ios

import SwiftUI

/// A manőver-ikonok vonalrajzai (24 × 24, az autó lentről halad felfelé; stroke 2,2, kerek végek).
extension ManeuverIcon {
    var path: Path {
        var p = Path()
        switch self {
        case .straight:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.move(to: CGPoint(x: 7, y: 10))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.addLine(to: CGPoint(x: 17, y: 10))
        case .depart:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.move(to: CGPoint(x: 7, y: 10))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.addLine(to: CGPoint(x: 17, y: 10))
        case .right:
            p.move(to: CGPoint(x: 8, y: 21))
            p.addLine(to: CGPoint(x: 8, y: 13))
            p.addCurve(to: CGPoint(x: 12, y: 9), control1: CGPoint(x: 8, y: 10.791), control2: CGPoint(x: 9.791, y: 9))
            p.addLine(to: CGPoint(x: 18, y: 9))
            p.move(to: CGPoint(x: 15, y: 5.5))
            p.addLine(to: CGPoint(x: 18.5, y: 9))
            p.addLine(to: CGPoint(x: 15, y: 12.5))
        case .left:
            p.move(to: CGPoint(x: 16, y: 21))
            p.addLine(to: CGPoint(x: 16, y: 13))
            p.addCurve(to: CGPoint(x: 12, y: 9), control1: CGPoint(x: 16, y: 10.791), control2: CGPoint(x: 14.209, y: 9))
            p.addLine(to: CGPoint(x: 6, y: 9))
            p.move(to: CGPoint(x: 9, y: 5.5))
            p.addLine(to: CGPoint(x: 5.5, y: 9))
            p.addLine(to: CGPoint(x: 9, y: 12.5))
        case .slight_right:
            p.move(to: CGPoint(x: 10, y: 21))
            p.addLine(to: CGPoint(x: 10, y: 15))
            p.addLine(to: CGPoint(x: 17, y: 8))
            p.move(to: CGPoint(x: 11, y: 8))
            p.addLine(to: CGPoint(x: 17, y: 8))
            p.addLine(to: CGPoint(x: 17, y: 14))
        case .slight_left:
            p.move(to: CGPoint(x: 14, y: 21))
            p.addLine(to: CGPoint(x: 14, y: 15))
            p.addLine(to: CGPoint(x: 7, y: 8))
            p.move(to: CGPoint(x: 13, y: 8))
            p.addLine(to: CGPoint(x: 7, y: 8))
            p.addLine(to: CGPoint(x: 7, y: 14))
        case .sharp_right:
            p.move(to: CGPoint(x: 8, y: 21))
            p.addLine(to: CGPoint(x: 8, y: 8))
            p.addLine(to: CGPoint(x: 17, y: 17))
            p.move(to: CGPoint(x: 17, y: 11))
            p.addLine(to: CGPoint(x: 17, y: 17))
            p.addLine(to: CGPoint(x: 11, y: 17))
        case .sharp_left:
            p.move(to: CGPoint(x: 16, y: 21))
            p.addLine(to: CGPoint(x: 16, y: 8))
            p.addLine(to: CGPoint(x: 7, y: 17))
            p.move(to: CGPoint(x: 7, y: 11))
            p.addLine(to: CGPoint(x: 7, y: 17))
            p.addLine(to: CGPoint(x: 13, y: 17))
        case .uturn:
            p.move(to: CGPoint(x: 7, y: 21))
            p.addLine(to: CGPoint(x: 7, y: 9))
            p.addCurve(to: CGPoint(x: 12, y: 4), control1: CGPoint(x: 7, y: 6.239), control2: CGPoint(x: 9.239, y: 4))
            p.addCurve(to: CGPoint(x: 17, y: 9), control1: CGPoint(x: 14.761, y: 4), control2: CGPoint(x: 17, y: 6.239))
            p.addLine(to: CGPoint(x: 17, y: 18))
            p.move(to: CGPoint(x: 13.5, y: 15.5))
            p.addLine(to: CGPoint(x: 17, y: 19))
            p.addLine(to: CGPoint(x: 20.5, y: 15.5))
        case .roundabout_right:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 16))
            p.move(to: CGPoint(x: 12, y: 16))
            p.addCurve(to: CGPoint(x: 8, y: 12), control1: CGPoint(x: 9.791, y: 16), control2: CGPoint(x: 8, y: 14.209))
            p.addCurve(to: CGPoint(x: 12, y: 8), control1: CGPoint(x: 8, y: 9.791), control2: CGPoint(x: 9.791, y: 8))
            p.addCurve(to: CGPoint(x: 16, y: 12), control1: CGPoint(x: 14.209, y: 8), control2: CGPoint(x: 16, y: 9.791))
            p.move(to: CGPoint(x: 15, y: 8))
            p.addLine(to: CGPoint(x: 19, y: 4))
            p.move(to: CGPoint(x: 15, y: 4))
            p.addLine(to: CGPoint(x: 19, y: 4))
            p.addLine(to: CGPoint(x: 19, y: 8))
        case .roundabout_left:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 16))
            p.move(to: CGPoint(x: 12, y: 16))
            p.addCurve(to: CGPoint(x: 16, y: 12), control1: CGPoint(x: 14.209, y: 16), control2: CGPoint(x: 16, y: 14.209))
            p.addCurve(to: CGPoint(x: 12, y: 8), control1: CGPoint(x: 16, y: 9.791), control2: CGPoint(x: 14.209, y: 8))
            p.addCurve(to: CGPoint(x: 8, y: 12), control1: CGPoint(x: 9.791, y: 8), control2: CGPoint(x: 8, y: 9.791))
            p.move(to: CGPoint(x: 9, y: 8))
            p.addLine(to: CGPoint(x: 5, y: 4))
            p.move(to: CGPoint(x: 9, y: 4))
            p.addLine(to: CGPoint(x: 5, y: 4))
            p.addLine(to: CGPoint(x: 5, y: 8))
        case .merge:
            p.move(to: CGPoint(x: 7, y: 21))
            p.addCurve(to: CGPoint(x: 12, y: 11), control1: CGPoint(x: 7, y: 15), control2: CGPoint(x: 12, y: 15))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.move(to: CGPoint(x: 17, y: 21))
            p.addCurve(to: CGPoint(x: 12, y: 11), control1: CGPoint(x: 17, y: 15), control2: CGPoint(x: 12, y: 15))
            p.move(to: CGPoint(x: 8, y: 9))
            p.addLine(to: CGPoint(x: 12, y: 5))
            p.addLine(to: CGPoint(x: 16, y: 9))
        case .fork_left:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 14))
            p.addLine(to: CGPoint(x: 7, y: 9))
            p.move(to: CGPoint(x: 7, y: 14))
            p.addLine(to: CGPoint(x: 7, y: 9))
            p.addLine(to: CGPoint(x: 12, y: 9))
            p.move(to: CGPoint(x: 12, y: 14))
            p.addLine(to: CGPoint(x: 16, y: 10))
        case .fork_right:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addLine(to: CGPoint(x: 12, y: 14))
            p.addLine(to: CGPoint(x: 17, y: 9))
            p.move(to: CGPoint(x: 17, y: 14))
            p.addLine(to: CGPoint(x: 17, y: 9))
            p.addLine(to: CGPoint(x: 12, y: 9))
            p.move(to: CGPoint(x: 12, y: 14))
            p.addLine(to: CGPoint(x: 8, y: 10))
        case .arrive:
            p.move(to: CGPoint(x: 12, y: 21))
            p.addCurve(to: CGPoint(x: 18, y: 10), control1: CGPoint(x: 12, y: 21), control2: CGPoint(x: 18, y: 15.5))
            p.addCurve(to: CGPoint(x: 12, y: 4), control1: CGPoint(x: 18, y: 6.686), control2: CGPoint(x: 15.314, y: 4))
            p.addCurve(to: CGPoint(x: 6, y: 10), control1: CGPoint(x: 8.686, y: 4), control2: CGPoint(x: 6, y: 6.686))
            p.addCurve(to: CGPoint(x: 12, y: 21), control1: CGPoint(x: 6, y: 15.5), control2: CGPoint(x: 12, y: 21))
            p.closeSubpath()
            p.move(to: CGPoint(x: 12, y: 12.2))
            p.addCurve(to: CGPoint(x: 14.4, y: 9.8), control1: CGPoint(x: 13.325, y: 12.2), control2: CGPoint(x: 14.4, y: 11.125))
            p.addCurve(to: CGPoint(x: 12, y: 7.4), control1: CGPoint(x: 14.4, y: 8.475), control2: CGPoint(x: 13.325, y: 7.4))
            p.addCurve(to: CGPoint(x: 9.6, y: 9.8), control1: CGPoint(x: 10.675, y: 7.4), control2: CGPoint(x: 9.6, y: 8.475))
            p.addCurve(to: CGPoint(x: 12, y: 12.2), control1: CGPoint(x: 9.6, y: 11.125), control2: CGPoint(x: 10.675, y: 12.2))
            p.closeSubpath()
        }
        return p
    }
}
