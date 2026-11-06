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

/// A CSS `box-shadow` pontos párja: a rétegek szórással (`spread`), elmosással (σ = blur / 2), és a doboz alatt NEM rajzol (a SwiftUI
/// `.shadow` a tartalmat is árnyékolja és nem ismer szórást – ettől volt iOS-en sötétebb minden üveg).
struct BoxShadow<S: InsettableShape>: View {
    let shape: S
    let layers: [ShadowLayer]

    var body: some View {
        ZStack {
            ForEach(layers.indices, id: \.self) { i in
                let l = layers[i]
                shape.fill(l.color)
                    .padding(-l.spread)
                    .blur(radius: l.blur / 2)
                    .offset(x: l.x, y: l.y)
            }
        }
        .mask {
            Rectangle()
                .padding(-160)
                .overlay(shape.blendMode(.destinationOut))
                .compositingGroup()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Üveg-felület (`.glass`): áttetsző felület + elmosás + 1 px-es él + árnyék + felső fényél. Kitöltés nélkül a `surface`; világos térképen
/// (AW15, `strongGlass`) a `surfaceStrong`, hogy a halvány szöveg is olvasható maradjon.
struct Glass: ViewModifier {
    var radius: CGFloat
    var fill: Color?
    @Environment(\.strongGlass) private var strong

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        // a CSS `border` a dobozhoz adódik: a tartalom 1 pt-tel beljebb, a külső méret 2 pt-tel nagyobb
        content
            .padding(1)
            .background(fill ?? (strong ? Tokens.Colors.surfaceStrong : Tokens.Colors.surface), in: shape)
            .background(.ultraThinMaterial, in: shape)
            .overlay(
                shape.strokeBorder(Tokens.Colors.surfaceRaised, lineWidth: 2)
                    .mask(alignment: .top) { Rectangle().frame(height: 2) }
            )
            .overlay(shape.strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
            .background(BoxShadow(shape: shape, layers: Tokens.Shadow.card))
    }
}

extension View {
    func glass(radius: CGFloat, fill: Color? = nil) -> some View {
        modifier(Glass(radius: radius, fill: fill))
    }

    /// Típus-lépcső (méret, súly, betűköz) a tokenből.
    func typeStyle(_ s: TypeStyle) -> some View {
        css(s.size, s.weight, line: s.lineHeight, tracking: s.tracking)
    }
}

/// A flexbox `flex-wrap: wrap` párja: sorokba tördel, az elemek a szélességükön; `baseline`: soron belül az első szöveg-alapvonalra igazít.
/// A `flowPushRight()`-tal jelölt elem a sor jobb szélére kerül (CSS `margin-left: auto`).
struct Flow: Layout {
    var hGap: CGFloat
    var vGap: CGFloat
    var baseline = false

    private struct Placed { let index: Int; var x: CGFloat; var y: CGFloat }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> (placed: [Placed], size: CGSize) {
        var placed: [Placed] = []
        var y: CGFloat = 0
        var maxW: CGFloat = 0
        var row: [(Int, CGSize, ViewDimensions)] = []
        func flush() {
            guard !row.isEmpty else { return }
            let ascent = baseline ? row.map { $0.2[.firstTextBaseline] }.max() ?? 0 : 0
            let height = baseline ? ascent + (row.map { $0.1.height - $0.2[.firstTextBaseline] }.max() ?? 0) : row.map(\.1.height).max() ?? 0
            var x: CGFloat = 0
            for (k, item) in row.enumerated() {
                if subviews[item.0][PushRightKey.self], k > 0 || row.count == 1 {
                    let rest = row[k...].reduce(CGFloat(0)) { $0 + $1.1.width } + CGFloat(row.count - k - 1) * hGap
                    x = max(x, width - rest)
                }
                placed.append(Placed(index: item.0, x: x, y: y + (baseline ? ascent - item.2[.firstTextBaseline] : 0)))
                x += item.1.width + hGap
            }
            maxW = max(maxW, x - hGap)
            y += height + vGap
            row = []
        }
        var used: CGFloat = 0
        for (i, sub) in subviews.enumerated() {
            let size = sub.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if !row.isEmpty, used + hGap + size.width > width {
                flush()
                used = 0
            }
            used += (row.isEmpty ? 0 : hGap) + size.width
            row.append((i, size, sub.dimensions(in: ProposedViewSize(width: width, height: nil))))
        }
        flush()
        return (placed, CGSize(width: maxW, height: max(0, y - vGap)))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? .infinity
        let r = arrange(w, subviews)
        return CGSize(width: w.isFinite ? w : r.size.width, height: r.size.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for p in arrange(bounds.width, subviews).placed {
            subviews[p.index].place(at: CGPoint(x: bounds.minX + p.x, y: bounds.minY + p.y), proposal: ProposedViewSize(width: bounds.width, height: nil))
        }
    }
}

private nonisolated struct PushRightKey: LayoutValueKey {
    static let defaultValue = false
}

extension View {
    func flowPushRight() -> some View { layoutValue(key: PushRightKey.self, value: true) }
}

/// Webes lap (`.sheet` + `.sheet-backdrop`): alulról lebegő, 8 pt-es oldalmargó, `card` sarok, a tartalma magas, legfeljebb a biztonsági zóna + 24 pt-ig;
/// háttér-koppintásra zár. A rendszer-sheet alakja és detentjei helyett (az AOS18 paritás-kapu ezt méri). `peek` (zónasugár váltása): a lap 38%-ra
/// húzódik, háttér nélkül, hogy a zóna köre látsszon, a görgetési pozíció nem változik.
struct AppSheet<Content: View>: View {
    var peek = false
    let onClose: () -> Void
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { geo in
            let full = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
            ZStack(alignment: .bottom) {
                Tokens.Colors.sheetBackdrop
                    .opacity(peek ? 0 : 1)
                    .padding(-200)
                    .contentShape(Rectangle())
                    .allowsHitTesting(!peek)
                    .onTapGesture(perform: onClose)
                let shape = RoundedRectangle(cornerRadius: Tokens.Radius.card, style: .continuous)
                CappedHeight(maxHeight: peek ? full * 0.38 : full - geo.safeAreaInsets.top - 24) { content.padding(1) }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tokens.Colors.surfaceStrong, in: shape)
                    .background(.ultraThinMaterial, in: shape)
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
                    .background(BoxShadow(shape: shape, layers: Tokens.Shadow.card))
                    .padding(.horizontal, Tokens.Space.s2)
                    .padding(.bottom, Tokens.Space.s2)
                    .animation(.easeOut(duration: Tokens.Motion.base), value: peek)
            }
            // a magas lap a biztonsági zóna fölé is érhet (a webes `max-height`): alulra zárva, felfelé lóg
            .frame(width: geo.size.width, height: geo.size.height, alignment: .bottom)
        }
        .transition(.opacity.combined(with: .offset(y: 40)))
    }
}

/// A CSS `max-height`: a tartalom saját (ideális) magassága, legfeljebb `maxHeight`; fölötte a tartalmon belüli görgetés dolgozik. A SwiftUI `.frame(maxHeight:)`
/// a rendelkezésre álló helyet kitöltené.
struct CappedHeight: Layout {
    var maxHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let sub = subviews.first else { return .zero }
        let ideal = sub.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
        return CGSize(width: proposal.width ?? ideal.width, height: min(ideal.height, maxHeight))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// A CSS `flex: 1 0 auto` sora: minden elem a tartalma szélességén, a szabad hely egyenlően elosztva.
struct GrowRow: Layout {
    var gap: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let ideal = sizes.reduce(0) { $0 + $1.width } + gap * CGFloat(max(0, subviews.count - 1))
        return CGSize(width: proposal.width ?? ideal, height: sizes.map(\.height).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let ideal = sizes.reduce(0) { $0 + $1.width } + gap * CGFloat(max(0, subviews.count - 1))
        let extra = max(0, bounds.width - ideal) / CGFloat(max(1, subviews.count))
        var x = bounds.minX
        for (i, sub) in subviews.enumerated() {
            let w = sizes[i].width + extra
            sub.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: w, height: bounds.height))
            x += w + gap
        }
    }
}

/// A webes `.nav-offer-compact`: a cím mellett a gombok, ha a cím így legalább 120 pt-et kap; különben a gombok a cím alatt, teljes szélességben.
struct OfferCompactLayout: Layout {
    var gap: CGFloat
    private static let minTitle: CGFloat = 120

    private func inRow(_ width: CGFloat, _ subviews: Subviews) -> Bool {
        width - subviews[1].sizeThatFits(.unspecified).width - gap >= Self.minTitle
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let w = proposal.width ?? 320
        if inRow(w, subviews) {
            let actions = subviews[1].sizeThatFits(.unspecified)
            let title = subviews[0].sizeThatFits(ProposedViewSize(width: w - actions.width - gap, height: nil))
            return CGSize(width: w, height: max(title.height, actions.height))
        }
        let title = subviews[0].sizeThatFits(ProposedViewSize(width: w, height: nil))
        let actions = subviews[1].sizeThatFits(ProposedViewSize(width: w, height: nil))
        return CGSize(width: w, height: title.height + gap + actions.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let w = bounds.width
        if inRow(w, subviews) {
            let actions = subviews[1].sizeThatFits(.unspecified)
            let titleW = w - actions.width - gap
            let title = subviews[0].sizeThatFits(ProposedViewSize(width: titleW, height: nil))
            subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.midY - title.height / 2), proposal: ProposedViewSize(width: titleW, height: nil))
            subviews[1].place(at: CGPoint(x: bounds.maxX - actions.width, y: bounds.midY - actions.height / 2), proposal: ProposedViewSize(actions))
        } else {
            let title = subviews[0].sizeThatFits(ProposedViewSize(width: w, height: nil))
            subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: w, height: nil))
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + title.height + gap), proposal: ProposedViewSize(width: w, height: nil))
        }
    }
}

/// A lap feje (`.sheet-head`): cím balra, kerek bezáró gomb jobbra.
struct SheetHead: View {
    let title: String
    let onClose: () -> Void

    var body: some View {
        HStack {
            Text(title).typeStyle(Tokens.Typography.title).foregroundStyle(Tokens.Colors.text)
            Spacer(minLength: 0)
            Button(action: onClose) {
                Icon(name: .close, size: 20)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .frame(width: 48, height: 48)
                    .background(Tokens.Colors.fill08, in: Circle())
                    .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(-4)
            .accessibilityLabel(t(.commonClose))
        }
        .padding(EdgeInsets(top: 0, leading: 6, bottom: 14, trailing: 6))
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
                .css(Tokens.Typography.body.size, Tokens.FontWeight.w640, tracking: -0.005)
                .lineLimit(1)
        }
        .padding(.leading, 11)
        .padding(.trailing, Tokens.Space.s4)
        .frame(height: 40)
        .foregroundStyle(neutral ? Tokens.Colors.textMuted : tone.color)
        .background(neutral ? Tokens.Colors.fill08 : tone.color.opacity(Tokens.Opacity.o17), in: Capsule())
    }
}

/// INV-22: a Mapbox-logó és az „i” helye a biztonsági zóna alatt (pt), a webes `.mapboxgl-ctrl-top-*` szerint: logó (8, + 4) 85 × 21, az „i” 24 pt-es kör.
enum TopOrnaments {
    static let logo = CGRect(x: 8, y: 4, width: 85, height: 21)
    static let infoCenterFromTrailing: CGFloat = 20
    static let infoCenterY: CGFloat = 16
    static let infoRadius: CGFloat = 12
}

/// A webes `.scrim-top`: a biztonsági zóna + 140 pt, 72% → 0. Weben a logó és az „i” a sötétítés fölött van; iOS-en az ornamentek a térkép-nézet részei
/// (alatta), ezért a sötétítés lágy széllel kihagyja a helyüket (INV-22) – a fényességük így a webesé. A paritás-háttéren nincs térkép, ott nincs kivágás.
struct ScrimTop: View {
    private let logoShape = MapboxLogoShape.shared

    var body: some View {
        GeometryReader { geo in
            let top = geo.safeAreaInsets.top
            LinearGradient(colors: [Tokens.Colors.bg.opacity(Tokens.Opacity.o72), Tokens.Colors.bg.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: top + 140)
                .mask {
                    ZStack(alignment: .topLeading) {
                        Rectangle()
                        if !Parity.on {
                            let l = TopOrnaments.logo
                            if let img = logoShape.image {
                                // a logó saját alakja: a sötétítés csak a betűk helyén marad ki, mint weben (a téglalap világos udvart hagyott)
                                Image(uiImage: img)
                                    .resizable()
                                    .frame(width: img.size.width, height: img.size.height)
                                    .offset(x: l.minX, y: top + l.minY)
                                    .blendMode(.destinationOut)
                            } else {
                                RoundedRectangle(cornerRadius: l.height / 2)
                                    .frame(width: l.width, height: l.height)
                                    .offset(x: l.minX, y: top + l.minY)
                                    .blur(radius: 3)
                                    .blendMode(.destinationOut)
                            }
                            Circle()
                                .frame(width: TopOrnaments.infoRadius * 2, height: TopOrnaments.infoRadius * 2)
                                .offset(x: geo.size.width - TopOrnaments.infoCenterFromTrailing - TopOrnaments.infoRadius, y: top + TopOrnaments.infoCenterY - TopOrnaments.infoRadius)
                                .blur(radius: 3)
                                .blendMode(.destinationOut)
                        }
                    }
                    .compositingGroup()
                }
                .offset(y: -top)
            if !Parity.on {
                WebInfoBadge()
                    .position(x: geo.size.width - TopOrnaments.infoCenterFromTrailing, y: TopOrnaments.infoCenterY)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task {
            // a térkép a sötétítéssel együtt jelenik meg: a logó nézete pár tized másodperc múlva kerül az ablakba
            for _ in 0..<20 where logoShape.image == nil {
                logoShape.capture()
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }
}

/// INV-22 (AW24): a Mapbox-logó alakja a felső sötétítés kivágásához. A logót a Mapbox belső `LogoView`-ja rajzolja (UIKit, a SwiftUI-sötétítés alatt);
/// ezt egyszer képpé rajzoljuk, és az alfája adja a kivágást – a logó rajzát nem másoljuk, és nem is takarjuk.
@MainActor @Observable final class MapboxLogoShape {
    static let shared = MapboxLogoShape()
    private(set) var image: UIImage?

    func capture() {
        guard image == nil else { return }
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        guard let view = windows.lazy.compactMap({ Self.logoView(in: $0) }).first, view.bounds.width > 0 else { return }
        image = UIGraphicsImageRenderer(bounds: view.bounds).image { view.layer.render(in: $0.cgContext) }
    }

    private static func logoView(in view: UIView) -> UIView? {
        if String(describing: type(of: view)) == "LogoView" { return view }
        return view.subviews.lazy.compactMap { logoView(in: $0) }.first
    }
}

/// INV-22: a webes kompakt „i” rajza (mapbox-gl `.mapboxgl-ctrl-attrib-button` az `.mapboxgl-compact` tartón): 24 pt-es kör, `pillSurface` (= `rgba(16,18,24,.6)`)
/// fölött 50%-os világos, közepén sötét (`bg`) 12 pt-es kör kivágott „i”-vel (a Mapbox 20 × 20-as SVG-je, evenodd). Csak rajz: a koppintás a Mapbox gombjára jut
/// (alatta, átlátszó jellel), az attribúciót az nyitja meg.
struct WebInfoBadge: View {
    var body: some View {
        ZStack {
            Circle().fill(Tokens.Colors.pillSurface)
            Circle().fill(Tokens.Colors.text.opacity(Tokens.Opacity.o50))
            Canvas { ctx, size in
                let k = size.width / 20
                var p = Path()
                p.addEllipse(in: CGRect(x: 4 * k, y: 4 * k, width: 12 * k, height: 12 * k))
                p.addEllipse(in: CGRect(x: 9 * k, y: 6 * k, width: 2 * k, height: 2 * k))
                p.addRoundedRect(in: CGRect(x: 9 * k, y: 9 * k, width: 2 * k, height: 5 * k), cornerSize: CGSize(width: k, height: k))
                ctx.fill(p, with: .color(Tokens.Colors.bg), style: FillStyle(eoFill: true))
            }
        }
        .frame(width: TopOrnaments.infoRadius * 2, height: TopOrnaments.infoRadius * 2)
    }
}

/// A webes `.scrim-bottom`: a képernyő 58%-a alul, 0 → 78% a magasság 70%-áig; kompakt kártyánál `scaleY(0.45)` az aljához képest.
struct ScrimBottom: View {
    var compact: Bool

    var body: some View {
        GeometryReader { geo in
            let full = geo.size.height + geo.safeAreaInsets.top + geo.safeAreaInsets.bottom
            LinearGradient(stops: [
                .init(color: Tokens.Colors.bg.opacity(0), location: 0),
                .init(color: Tokens.Colors.bg.opacity(Tokens.Opacity.o78), location: 0.7),
            ], startPoint: .top, endPoint: .bottom)
                .frame(height: full * 0.58)
                .scaleEffect(x: 1, y: compact ? 0.45 : 1, anchor: .bottom)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .animation(.easeOut(duration: Tokens.Motion.slow), value: compact)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// Nagy, teljes szélességű gomb (`.btn`, `.btn.primary`, `.btn.danger`).
struct WideButtonStyle: ButtonStyle {
    enum Kind { case plain, primary, danger }
    var kind: Kind = .plain
    var minHeight: CGFloat = 60
    var size: CGFloat = Tokens.Typography.body.size

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .css(size, Tokens.FontWeight.w620)
            .frame(maxWidth: .infinity, minHeight: minHeight)
            .foregroundStyle(kind == .primary ? Tokens.Colors.signText : kind == .danger ? Tokens.Colors.signFace : Tokens.Colors.text)
            .background(
                kind == .primary ? Tokens.Colors.text : kind == .danger ? Tokens.Colors.over : Tokens.Colors.fill10,
                in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous)
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
            .frame(width: Tokens.Size.roundButton - 2, height: Tokens.Size.roundButton - 2)
            .glass(radius: Tokens.Size.roundButton / 2)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: Tokens.Motion.fast), value: configuration.isPressed)
    }
}

extension EnvironmentValues {
    /// AW15: világos térkép – az üveg-felületek erősebbek (`surfaceStrong`).
    @Entry var strongGlass = false
}
