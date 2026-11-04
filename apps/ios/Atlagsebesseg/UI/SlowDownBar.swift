import AtlagsebessegCore
import SwiftUI

/// „Lassíts · max X” / „Maradj X alatt” – külön, nagy, középen a kártya fölött, csak amikor kell. Késleltetett
/// kapcsoló (1,5 s be, 3 s ki), hogy a határ körüli 1 Hz-es ingadozás ne villogtasson; eltűnéskor az utolsó
/// tartalom marad (a webes `SlowDown` + `useSteady`).
struct SlowDownBar: View {
    let view: SessionView
    let unit: SpeedUnit

    @State private var steady = false
    @State private var last: (bar: MeterBar, tone: MeterState)?

    private var bar: MeterBar? {
        guard view.phase == .meres, let live = view.live else { return nil }
        return meterBar(view.status, live.required)
    }

    var body: some View {
        let active = bar != nil
        content
            .opacity(steady && last != nil ? 1 : 0)
            .scaleEffect(steady ? 1 : 0.96)
            .offset(y: steady ? 0 : 12)
            .animation(.easeOut(duration: Tokens.Motion.slow), value: steady)
            .allowsHitTesting(false)
            .accessibilityHidden(!steady)
            .onAppear { remember() }
            .onChange(of: view.live?.distanceM) { remember() }
            .task(id: active) {
                guard active != steady else { return }
                try? await Task.sleep(for: .seconds(active ? 1.5 : 3))
                if !Task.isCancelled { steady = active }
            }
    }

    private func remember() {
        if let bar { last = (bar, view.status ?? .tulGyors) }
    }

    @ViewBuilder private var content: some View {
        let tone = Tone.status(last?.tone ?? .tulGyors)
        HStack(spacing: Tokens.Space.s3) {
            switch last?.bar {
            case .nemHozhato:
                Icon(name: .arrowUp, size: 30)
                Text(t(.slowdownCant)).modifier(SlowLabel())
            case let .max(maxKmh):
                Icon(name: .arrowDown, size: 30)
                sentence(last?.tone == .lassits ? .slowdownStay : .slowdownSlow, speedIn(maxKmh, unit) ?? 0)
            case nil:
                EmptyView()
            }
        }
        .foregroundStyle(tone.color)
        .padding(.leading, Tokens.Space.s5)
        .padding(.trailing, 26)
        .frame(height: Tokens.Size.tile - 2)
        .glass(radius: Tokens.Size.tile / 2, fill: Tokens.Colors.surfaceStrong)
    }

    /// A szám a mondat közepén (nyelvenként más a szórend): nagy, fehér. A webes `.slowdown-label`: `inline-flex`, alapvonalra, 6 pt-es térköz.
    private func sentence(_ key: L10nKey, _ x: Int) -> some View {
        let parts = t(key, ["x": "\u{1}"]).components(separatedBy: "\u{1}").map { $0.trimmingCharacters(in: .whitespaces) }
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let before = parts.first, !before.isEmpty { Text(before).modifier(SlowLabel()) }
            Text(String(x)).css(Tokens.FontSize.f44, Tokens.FontWeight.w700, tracking: -0.03, num: true).foregroundStyle(Tokens.Colors.text)
            if parts.count > 1, !parts[1].isEmpty { Text(parts[1]).modifier(SlowLabel()) }
        }
    }
}

private struct SlowLabel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.inter(Tokens.Typography.title.size, Tokens.FontWeight.w680))
            .tracking(Tokens.Typography.title.trackingPt)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
    }
}
