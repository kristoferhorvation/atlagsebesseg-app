import AtlagsebessegCore
import SwiftUI

/// AW24: a krúzing-kártya a felső manőver-kártya helyén (a webes `apps/web/src/ui/CruiseCard.tsx`, `.cruise-card`; spec: `cruise-card`): égkék `cruiseCard` háttér, a kártya szegélye és árnyéka.
struct CruiseCardView: View {
    let card: CruiseCardModel

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.r28, style: .continuous)
        Group {
            switch card {
            case .hidden:
                EmptyView()
            case let .ready(text), let .strip(text):
                compact(text)
                    .padding(EdgeInsets(top: Tokens.Space.s2, leading: Tokens.Space.s4 + 2, bottom: Tokens.Space.s2, trailing: Tokens.Space.s4 + 2))
            case let .full(title, distance, time, line2, section):
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).css(Tokens.FontSize.f15, Tokens.FontWeight.w620)
                    HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
                        Text(distance).css(Tokens.FontSize.f34, Tokens.FontWeight.w700, line: 38.0 / 34).monospacedDigit().lineLimit(1)
                        Text(time).css(Tokens.FontSize.f18, Tokens.FontWeight.w620).lineLimit(1)
                    }
                    line(line2)
                    if let section { line(section) }
                }
                .padding(EdgeInsets(top: 14, leading: Tokens.Space.s4 + 2, bottom: 14, trailing: Tokens.Space.s4 + 2))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(Tokens.Colors.cruiseCardText)
        .padding(1)
        .background(Tokens.Colors.cruiseCard, in: shape)
        .overlay(shape.strokeBorder(Tokens.Colors.strokeStrong, lineWidth: 1))
        .background(BoxShadow(shape: shape, layers: Tokens.Shadow.card))
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("cruise-card")
        .allowsHitTesting(false)
    }

    private func line(_ s: String) -> some View {
        Text(s).css(Tokens.FontSize.f15, Tokens.FontWeight.w560, line: 20.0 / 15).monospacedDigit().lineLimit(1).truncationMode(.tail)
    }

    private func compact(_ s: String) -> some View {
        Text(s).css(Tokens.FontSize.f15, Tokens.FontWeight.w620, line: 20.0 / 15).monospacedDigit().lineLimit(1).truncationMode(.tail)
    }
}
