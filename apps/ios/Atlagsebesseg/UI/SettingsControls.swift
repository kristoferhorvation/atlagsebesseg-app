import SwiftUI

// AOS17: a webes lista-elemek (`styles.css`: `.group-label`, `.list`, `.list-row`, `.switch`, `.segmented`, `.mini-btn`) SwiftUI-ban,
// a Beállítások és a hozzá tartozó lapok közös építőkövei. A kapcsoló és a jelölőnégyzet az `accent` (zöld), a kiválasztott szegmens fehér.

/// Csoportcím a kártya fölött (`.group-label`).
struct GroupLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased(with: L10n.lang.locale))
            .font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w640))
            .tracking(0.06 * 13)
            .foregroundStyle(Tokens.Colors.textFaint)
            .padding(EdgeInsets(top: 18, leading: 8, bottom: 8, trailing: 8))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Kártyás csoport (`.list`).
struct ListCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(1)
            .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous).strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
    }
}

/// A sorok közti vonal (a `.list-row` alsó éle).
struct RowDivider: View {
    var body: some View {
        Rectangle().fill(Tokens.Colors.stroke).frame(height: 1)
    }
}

/// Egy sor keretezése (`.list-row`): 14 / 16 pt belső margó, legalább 60 pt magas.
struct RowFrame: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
    }
}

extension View {
    func listRow() -> some View { modifier(RowFrame()) }
}

/// Főcím és leírás egy sorban, közöttük nincs vonal (`.label` + `.hint`).
struct RowText: View {
    let label: String
    var hint: String? = nil
    var hintLines: Int? = nil

    var body: some View {
        // a webes sortörés és sormagasság: 17 pt → 20 pt-es, 14 pt → 18,9 pt-es sor, mohó tördeléssel
        VStack(alignment: .leading, spacing: 3) {
            GreedyText(text: label, font: .inter(Tokens.FontSize.f17, Tokens.FontWeight.w580), lineHeight: 20, color: Tokens.Colors.text)
            if let hint, !hint.isEmpty {
                GreedyText(text: hint, font: .inter(Tokens.FontSize.f14, Tokens.FontWeight.w400), lineHeight: 1.35 * Tokens.FontSize.f14, lines: hintLines ?? 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Kapcsoló (`.switch`): 52 × 32, bekapcsolva zöld.
struct SwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button { configuration.isOn.toggle() } label: {
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                Capsule().fill(configuration.isOn ? Tokens.Colors.accent : Tokens.Colors.strokeStrong)
                Circle().fill(Tokens.Colors.signFace).frame(width: 26, height: 26).background(BoxShadow(shape: Circle(), layers: Tokens.Shadow.knob)).padding(3)
            }
            .frame(width: 52, height: 32)
            .animation(.easeOut(duration: Tokens.Motion.fast), value: configuration.isOn)
        }
        .buttonStyle(.plain)
    }
}

/// Sor kapcsolóval: bal oldalt a főcím és a leírás, jobbra a kapcsoló.
struct ToggleRow: View {
    let label: String
    let hint: String?
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 14) {
            RowText(label: label, hint: hint)
            Toggle(label, isOn: $isOn).labelsHidden().toggleStyle(SwitchStyle())
        }
        .listRow()
    }
}

/// Szegmens-választó (`.segmented`): a kiválasztott fehér, sötét felirattal (mint a weben). `compact`: a zóna-választó kisebb szegmensei.
struct Segmented<T: Hashable>: View {
    let options: [(value: T, label: String)]
    @Binding var selection: T
    var stretch = true
    var compact = false

    var body: some View {
        FlexRow(stretch: stretch) {
            ForEach(options, id: \.value) { o in
                let on = o.value == selection
                Button { selection = o.value } label: {
                    Text(o.label)
                        .font(.inter(compact ? Tokens.FontSize.f14 : Tokens.FontSize.f15, Tokens.FontWeight.w620))
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, stretch ? Tokens.Space.s2 : compact ? 12 : 14)
                        .frame(maxWidth: stretch ? .infinity : nil, minHeight: compact ? 30 : 34)
                        .foregroundStyle(on ? Tokens.Colors.signText : Tokens.Colors.textMuted)
                        .background(on ? Tokens.Colors.text : .clear, in: RoundedRectangle(cornerRadius: Tokens.Radius.r9, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Tokens.Colors.fill08, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
    }
}

/// A webes `button { flex: 1 }` sora: egyenlő szélességek, de egy elem sem kisebb a tartalmánál (a többi osztozik a maradékon). `stretch` nélkül a tartalom szélességén.
struct FlexRow: Layout {
    var stretch: Bool

    private func widths(_ total: CGFloat?, _ ideal: [CGFloat]) -> [CGFloat] {
        guard stretch, let total else { return ideal }
        var fixed = Set<Int>()
        var result = ideal
        for _ in ideal {
            let rest = total - fixed.reduce(0) { $0 + ideal[$1] }
            let share = rest / CGFloat(max(1, ideal.count - fixed.count))
            let next = ideal.indices.filter { !fixed.contains($0) && ideal[$0] > share }
            for i in ideal.indices { result[i] = fixed.contains(i) ? ideal[i] : share }
            if next.isEmpty { break }
            fixed.formUnion(next)
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let w = widths(proposal.width, sizes.map(\.width)).reduce(0, +)
        return CGSize(width: stretch ? (proposal.width ?? w) : w, height: sizes.map(\.height).max() ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let w = widths(bounds.width, subviews.map { $0.sizeThatFits(.unspecified).width })
        var x = bounds.minX
        for (i, sub) in subviews.enumerated() {
            sub.place(at: CGPoint(x: x, y: bounds.minY), proposal: ProposedViewSize(width: w[i], height: bounds.height))
            x += w[i]
        }
    }
}

/// Kis gomb a sor végén (`.mini-btn`).
struct MiniButtonStyle: ButtonStyle {
    var danger = false
    var wide = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(Tokens.FontSize.f16, Tokens.FontWeight.w600))
            .lineLimit(1)
            .foregroundStyle(danger ? Tokens.Colors.over : Tokens.Colors.text)
            .padding(.horizontal, 16)
            .frame(maxWidth: wide ? .infinity : nil, minHeight: 48)
            .background(Tokens.Colors.fill10, in: RoundedRectangle(cornerRadius: Tokens.Radius.r14, style: .continuous))
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
    }
}

/// Jelölőnégyzet-sor a törlés-párbeszédben (`.check-row`).
struct CheckRow: View {
    let label: String
    var hint: String? = nil
    @Binding var isOn: Bool

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: Tokens.Radius.r8, style: .continuous)
                        .fill(isOn ? Tokens.Colors.accent : .clear)
                    RoundedRectangle(cornerRadius: Tokens.Radius.r8, style: .continuous)
                        .strokeBorder(isOn ? Tokens.Colors.accent : Tokens.Colors.strokeStrong, lineWidth: 2)
                    if isOn { Icon(name: .check, size: 18).foregroundStyle(Tokens.Colors.signText) }
                }
                .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.inter(Tokens.FontSize.f16, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.text).frame(minHeight: 26, alignment: .leading)
                    if let hint {
                        Text(hint).font(.inter(Tokens.FontSize.f14, Tokens.FontWeight.w400)).foregroundStyle(Tokens.Colors.textMuted).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isSelected] : [])
    }
}
