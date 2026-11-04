import SwiftUI

/// KRESZ-tábla stílusú sebességhatár (a választott egységben); `nil`: nincs adat → „–”.
struct LimitSign: View {
    let kmh: Double?
    let unit: SpeedUnit
    var small = false
    /// A webes keskeny-kijelzős méret (`@media`): 62 / 50 pt; a gyűrű és a betű arányosan.
    var diameter: CGFloat? = nil

    var body: some View {
        let shown = speedIn(kmh, unit)
        let d: CGFloat = diameter ?? (small ? 72 : 92)
        let ring: CGFloat = diameter == 62 ? 6 : diameter == 50 ? 5 : small ? 7 : 9
        let fontSize: CGFloat = diameter == 62 ? Tokens.FontSize.f23 : diameter == 50 ? Tokens.FontSize.f19 : small ? Tokens.FontSize.f26 : Tokens.FontSize.f34
        Text(shown.map(String.init) ?? "–")
            .font(.num(fontSize, Tokens.FontWeight.w760))
            .tracking(-0.05 * fontSize)
            .lineLimit(1)
            .foregroundStyle(Tokens.Colors.signText)
            .minimumScaleFactor(0.6)
            .frame(width: d, height: d)
            // a kitöltés a gyűrű közepéig: a külső élen ne látsszon fehér szegély
            .background(Circle().fill(Tokens.Colors.signFace).padding(ring / 2))
            .overlay(Circle().strokeBorder(Tokens.Colors.signRing, lineWidth: ring))
            .background(BoxShadow(shape: Circle(), layers: Tokens.Shadow.sign))
            .accessibilityLabel(shown.map { t(.hudLimitAria, ["x": String($0), "u": unitLabel(unit)]) } ?? t(.navLimitNone))
    }
}
