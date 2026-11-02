import SwiftUI

/// AW20: a hőtérkép módváltója (Gyakoriság | Átlagsebesség) üveg-szegmensben, alatta halvány jelmagyarázat – a webes
/// `HeatSwitch` párja. Csak az üres nézeten és krúzingban látszik.
struct HeatSwitch: View {
    @Bindable var model: AppModel

    var body: some View {
        let view = model.settings.hoterkepNezet
        VStack(alignment: .leading, spacing: Tokens.Space.s1) {
            HStack(spacing: 0) {
                segment(.gyakorisag, .heatViewFrequency, selected: view == .gyakorisag)
                segment(.atlagsebesseg, .heatViewSpeed, selected: view == .atlagsebesseg)
            }
            .padding(3)
            .glass(radius: 22)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(t(.heatViewAria))
            HStack(spacing: Tokens.Space.s2) {
                Capsule()
                    .fill(LinearGradient(colors: ramp(view), startPoint: .leading, endPoint: .trailing))
                    .frame(width: 56, height: 5)
                Text(t(view == .gyakorisag ? .heatLegendFrequency : .heatLegendSpeed))
                    .font(.inter(Tokens.Typography.caption.size, 500))
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            .padding(.leading, Tokens.Space.s3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func ramp(_ v: HeatView) -> [Color] {
        v == .gyakorisag ? [Tokens.Colors.heatFreqLow, Tokens.Colors.heatFreqMid, Tokens.Colors.heatFreqHigh] : [Tokens.Colors.heatSpeedLow, Tokens.Colors.heatSpeedMid, Tokens.Colors.heatSpeedHigh]
    }

    private func segment(_ v: HeatView, _ key: L10nKey, selected: Bool) -> some View {
        Button { model.settings.hoterkepNezet = v } label: {
            Text(t(key))
                .font(.inter(Tokens.Typography.caption.size, 620))
                .foregroundStyle(selected ? Tokens.Colors.text : Tokens.Colors.textMuted)
                .padding(.horizontal, Tokens.Space.s3)
                .frame(minHeight: 36)
                .background(selected ? Tokens.Colors.surfaceRaised : .clear, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
