import SwiftUI

/// Kezdőképernyő: mit csinál az app, és mire figyelj; „Indulás” vagy szimulátor.
struct StartView: View {
    let model: AppModel

    var body: some View {
        ZStack {
            Tokens.Colors.bg.ignoresSafeArea()
            RadialGradient(colors: [Tokens.Colors.accent.opacity(0.25), .clear], center: .top, startRadius: 0, endRadius: 420)
                .ignoresSafeArea()
            VStack(alignment: .leading, spacing: Tokens.Space.s6) {
                Spacer()
                Text(t(.appName))
                    .font(.inter(Tokens.Typography.display.size * 0.7, Tokens.Typography.display.weight))
                    .tracking(Tokens.Typography.display.trackingPt * 0.7)
                Text(t(.startTagline))
                    .typeStyle(Tokens.Typography.body)
                    .foregroundStyle(Tokens.Colors.textMuted)
                VStack(alignment: .leading, spacing: Tokens.Space.s4) {
                    tip(.screen, t(.startTipPhone))
                    tip(.gps, t(.startTipLocation))
                    tip(.check, t(.iosStartTipBackground))
                }
                Spacer()
                Button(t(.startGo)) { model.start() }
                    .buttonStyle(WideButtonStyle(kind: .primary))
                Button(t(.startSim)) { model.startSim(.lassit) }
                    .buttonStyle(WideButtonStyle())
            }
            .foregroundStyle(Tokens.Colors.text)
            .padding(.horizontal, Tokens.Space.s6)
            .padding(.bottom, Tokens.Space.s4)
        }
    }

    private func tip(_ icon: IconName, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Tokens.Space.s3) {
            Icon(name: icon).foregroundStyle(Tokens.Colors.accent)
            Text(text)
                .font(.inter(Tokens.Typography.caption.size + 2, Tokens.Typography.body.weight))
                .foregroundStyle(Tokens.Colors.text)
        }
    }
}
