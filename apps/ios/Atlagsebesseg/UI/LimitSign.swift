import SwiftUI

/// KRESZ-tábla stílusú sebességhatár (a választott egységben); `nil`: nincs adat → „–”.
struct LimitSign: View {
    let kmh: Double?
    let unit: SpeedUnit
    var small = false

    var body: some View {
        let shown = speedIn(kmh, unit)
        let d: CGFloat = small ? 72 : 92
        let ring: CGFloat = small ? 7 : 9
        Text(shown.map(String.init) ?? "–")
            .font(.num(small ? 26 : 34, 760))
            .tracking(-0.05 * (small ? 26 : 34))
            .foregroundStyle(Tokens.Colors.signText)
            .minimumScaleFactor(0.6)
            .frame(width: d, height: d)
            .background(Circle().fill(Tokens.Colors.signFace))
            .overlay(Circle().strokeBorder(Tokens.Colors.signRing, lineWidth: ring))
            .shadow(color: .black.opacity(0.45), radius: 12, y: 8)
            .accessibilityLabel(shown.map { t(.hudLimitAria, ["x": String($0), "u": unitLabel(unit)]) } ?? t(.navLimitNone))
    }
}
