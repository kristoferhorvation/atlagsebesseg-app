import SwiftUI

// AOS17: a webes lista-elemek (`styles.css`: `.group-label`, `.list`, `.list-row`, `.switch`, `.segmented`, `.mini-btn`) SwiftUI-ban,
// a Beállítások és a hozzá tartozó lapok közös építőkövei. A kapcsoló és a jelölőnégyzet az `accent` (zöld), a kiválasztott szegmens fehér.

/// Csoportcím a kártya fölött (`.group-label`).
struct GroupLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased(with: L10n.lang.locale))
            .font(.inter(13, 640))
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
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.inter(17, 580))
                .foregroundStyle(Tokens.Colors.text)
                .fixedSize(horizontal: false, vertical: true)
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.inter(14, 400))
                    .lineSpacing(2)
                    .lineLimit(hintLines)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .fixedSize(horizontal: false, vertical: hintLines == nil)
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
                Capsule().fill(configuration.isOn ? Tokens.Colors.accent : Color.white.opacity(0.16))
                Circle().fill(.white).frame(width: 26, height: 26).padding(3).shadow(color: .black.opacity(0.35), radius: 3, y: 2)
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
        HStack(spacing: 0) {
            ForEach(options, id: \.value) { o in
                let on = o.value == selection
                Button { selection = o.value } label: {
                    Text(o.label)
                        .font(.inter(compact ? 14 : 15, 620))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .foregroundStyle(on ? Tokens.Colors.signText : Tokens.Colors.textMuted)
                        .padding(.horizontal, stretch ? 4 : 14)
                        .frame(maxWidth: stretch ? .infinity : nil, minHeight: compact ? 30 : 34)
                        .background(on ? Tokens.Colors.text : .clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Kis gomb a sor végén (`.mini-btn`).
struct MiniButtonStyle: ButtonStyle {
    var danger = false
    var wide = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.inter(16, 600))
            .lineLimit(1)
            .foregroundStyle(danger ? Tokens.Colors.over : Tokens.Colors.text)
            .padding(.horizontal, 16)
            .frame(maxWidth: wide ? .infinity : nil, minHeight: 48)
            .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isOn ? Tokens.Colors.accent : .clear)
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .strokeBorder(isOn ? Tokens.Colors.accent : Tokens.Colors.strokeStrong, lineWidth: 2)
                    if isOn { Icon(name: .check, size: 18).foregroundStyle(Tokens.Colors.signText) }
                }
                .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.inter(16, 560)).foregroundStyle(Tokens.Colors.text).frame(minHeight: 26, alignment: .leading)
                    if let hint {
                        Text(hint).font(.inter(14, 400)).foregroundStyle(Tokens.Colors.textMuted).fixedSize(horizontal: false, vertical: true)
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
