import AtlagsebessegCore
import SwiftUI

// A webes styles.css kártya-elemei SwiftUI-ban; minden szín és méret a generált tokenekből (DESIGN.md). A betű (Inter)
// az InterFont.swift-ben (a Live Activity widgetje is fordítja).

/// A kijelző tónusa (a webes `data-tone`): státusz, kézi mód vagy semleges.
enum Tone: Equatable, Sendable {
    case status(MeterState)
    case kezi
    case semleges

    var color: Color {
        switch self {
        case .status(.jo): Tokens.StatusColors.jo
        case .status(.lassits): Tokens.StatusColors.lassits
        case .status(.tulGyors): Tokens.StatusColors.tul_gyors
        case .kezi: Tokens.StatusColors.kezi
        case .semleges: Tokens.StatusColors.semleges
        }
    }

    var isStatus: Bool {
        if case .status = self { true } else { false }
    }
}

/// A webes `toneOf`: mérésnél a státusz, kézi módban az accent.
func toneOf(_ view: SessionView) -> Tone {
    switch view.phase {
    case .kezi, .keziEredmeny: return .kezi
    case .megszakadt: return .semleges
    case .kozeledik: return view.status.map(Tone.status) ?? .kezi
    default: return view.status.map(Tone.status) ?? .semleges
    }
}

/// A web 24 × 24-es vonalikonja (stroke 2, kerek végek), a generált `IconName.path`-ból.
struct Icon: View {
    let name: IconName
    var size: CGFloat = 24

    var body: some View {
        let scale = size / 24
        let path = name.path.applying(CGAffineTransform(scaleX: scale, y: scale))
        Group {
            if name.filled {
                path.fill(style: FillStyle())
            } else {
                path.stroke(style: StrokeStyle(lineWidth: 2 * scale, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Üveg-felület (`.glass`): áttetsző felület + elmosás + 1 px-es él + árnyék. Kitöltés nélkül a `surface`; világos térképen
/// (AW15, `strongGlass`) a `surfaceStrong`, hogy a halvány szöveg is olvasható maradjon.
struct Glass: ViewModifier {
    var radius: CGFloat
    var fill: Color?
    @Environment(\.strongGlass) private var strong

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(fill ?? (strong ? Tokens.Colors.surfaceStrong : Tokens.Colors.surface), in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
            .shadow(color: Tokens.Shadow.card[0].color, radius: Tokens.Shadow.card[0].blur / 2, x: Tokens.Shadow.card[0].x, y: Tokens.Shadow.card[0].y)
            .shadow(color: Tokens.Shadow.card[1].color, radius: Tokens.Shadow.card[1].blur / 2, x: Tokens.Shadow.card[1].x, y: Tokens.Shadow.card[1].y)
    }
}

extension View {
    func glass(radius: CGFloat, fill: Color? = nil) -> some View {
        modifier(Glass(radius: radius, fill: fill))
    }

    /// Típus-lépcső (méret, súly, betűköz) a tokenből.
    func typeStyle(_ s: TypeStyle) -> some View {
        font(s.font).tracking(s.trackingPt)
    }
}

/// Állapot-chip: ikon + szó a tónus színében (a szín sosem egyedül beszél).
struct Chip: View {
    let tone: Tone
    let icon: IconName?
    let text: String
    var neutral = false

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            if let icon { Icon(name: icon) }
            Text(text)
                .font(.inter(Tokens.Typography.body.size, 640))
                .tracking(-0.005 * Tokens.Typography.body.size)
                .lineLimit(1)
        }
        .padding(.leading, 11)
        .padding(.trailing, Tokens.Space.s4)
        .frame(height: 40)
        .foregroundStyle(neutral ? Tokens.Colors.textMuted : tone.color)
        .background(neutral ? Color.white.opacity(0.08) : tone.color.opacity(0.17), in: Capsule())
    }
}

/// Nagy, teljes szélességű gomb (`.btn`, `.btn.primary`, `.btn.danger`).
struct WideButtonStyle: ButtonStyle {
    enum Kind { case plain, primary, danger }
    var kind: Kind = .plain

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(Tokens.Typography.body.size, 620))
            .frame(maxWidth: .infinity, minHeight: 60)
            .foregroundStyle(kind == .primary ? Tokens.Colors.signText : kind == .danger ? Color.white : Tokens.Colors.text)
            .background(
                kind == .primary ? Tokens.Colors.text : kind == .danger ? Tokens.Colors.over : Color.white.opacity(0.1),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: Tokens.Motion.fast), value: configuration.isPressed)
    }
}

/// Kerek üveggomb a térkép fölött (`.round-btn`).
struct RoundButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Tokens.Colors.text)
            .frame(width: Tokens.Size.roundButton, height: Tokens.Size.roundButton)
            .glass(radius: Tokens.Size.roundButton / 2)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: Tokens.Motion.fast), value: configuration.isPressed)
    }
}

extension EnvironmentValues {
    /// AW15: világos térkép – az üveg-felületek erősebbek (`surfaceStrong`).
    @Entry var strongGlass = false
}
