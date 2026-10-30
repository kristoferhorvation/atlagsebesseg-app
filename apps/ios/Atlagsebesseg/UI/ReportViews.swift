import AtlagsebessegCore
import SwiftUI

// AOS14: a webes ReportSheet.tsx, ReportCard.tsx és a térképi `.report-pin` SwiftUI-ban (a web A5 + AW16 bejelentése).

extension ReportTone {
    var color: Color {
        switch self {
        case .kezi: Tokens.StatusColors.kezi
        case .hataron: Tokens.StatusColors.hataron
        case .tul: Tokens.StatusColors.tul
        case .semleges: Tokens.StatusColors.semleges
        }
    }
}

/// Bejelentés: 1. koppintás (a figyelmeztető-ikon gomb) megnyitja, 2. koppintás a típusra azonnal elküldi a jelenlegi
/// helyről és irányból – nincs megerősítő lépés. A menü alján az „Átlagmérés eleje / vége” egy-egy ideiglenes kaput jelent
/// be (ismeretlen mérési zóna); irány nélkül nem küldhető. A tételek és a sorrend a webes `REPORT_CHOICES`.
struct ReportSheet: View {
    let fix: GpsFix?
    let online: Bool
    let sending: ReportChoice?
    let onPick: (ReportChoice) -> Void
    @Environment(\.dismiss) private var dismiss

    private var noHeading: Bool { fix != nil && fix?.heading == nil }
    private var note: String {
        if !online { return t(.reportNoteOffline) }
        if fix == nil { return t(.reportNoteNoGps) }
        if noHeading { return t(.reportNoteGateNoHeading) }
        return t(.reportNoteDefault)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack {
                Text(t(.reportTitle)).typeStyle(Tokens.Typography.title).foregroundStyle(Tokens.Colors.text)
                Spacer()
                Button { dismiss() } label: { Icon(name: .close, size: 22) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
                    .accessibilityLabel(t(.commonClose))
            }
            let simple = ReportChoice.allCases.filter { !$0.isGate }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Tokens.Space.s2), GridItem(.flexible(), spacing: Tokens.Space.s2)], spacing: Tokens.Space.s2) {
                ForEach(simple) { tile($0) }
            }
            ForEach(ReportChoice.allCases.filter(\.isGate)) { tile($0) }
            Text(note)
                .font(.inter(Tokens.Typography.caption.size, 500))
                .foregroundStyle(Tokens.Colors.textMuted)
                .padding(.horizontal, 6)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.top, Tokens.Space.s3)
    }

    private func tile(_ c: ReportChoice) -> some View {
        let disabled = !online || fix == nil || sending != nil || (c.isGate && noHeading)
        return Button { onPick(c) } label: {
            // 390 pt szélességen is egy sorban férjen a leghosszabb egyszavas felirat („Rendőrség”) – nincs szó közbeni törés
            HStack(spacing: 10) {
                Icon(name: c.icon)
                    .foregroundStyle(c.tone.color)
                    .frame(width: 40, height: 40)
                    .background(c.tone.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(c.label)
                    .font(.inter(18, 600))
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.tile, alignment: .leading)
            .background(sending == c ? c.tone.color.opacity(0.22) : Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous).strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
    }
}

/// Egy térképi bejelentés kártyája: típus, mikor jelentették, megerősítés / nincs ott (`report_votes`). Közeledéskor
/// (`prompt`) „Még ott van?” kérdéssel, Igen / Nem gombbal. Vezetés közben is kezelhető: minden gomb ≥ 56 pt.
struct ReportCard: View {
    let report: ActiveReport
    let now: Double
    let canVote: Bool
    /// A saját korábbi szavazat (`nil`: még nem szavazott).
    let voted: Bool?
    let sending: Bool
    var prompt = false
    let onVote: (Bool) -> Void
    let onClose: () -> Void

    var body: some View {
        let c = report.choice
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Icon(name: c.icon, size: 28)
                    .foregroundStyle(c.tone.color)
                    .frame(width: 52, height: 52)
                    .background(c.tone.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(c.label).font(.inter(22, 640)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                    Text(timeAgo(now - report.createdAt)).font(.inter(Tokens.Typography.body.size - 3, 500)).foregroundStyle(Tokens.Colors.textMuted)
                    if prompt {
                        Text(t(.reportPromptQuestion)).font(.inter(20, 640)).foregroundStyle(c.tone.color).padding(.top, 4)
                    }
                }
                Spacer(minLength: 0)
                Button(action: onClose) { Icon(name: .close, size: 22) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
                    .contentShape(Rectangle())
                    .accessibilityLabel(t(.commonClose))
            }
            if report.own {
                Text(t(.reportCardOwn)).font(.inter(Tokens.Typography.body.size - 3, 500)).foregroundStyle(Tokens.Colors.textMuted)
            } else {
                HStack(spacing: Tokens.Space.s2) {
                    voteButton(true, icon: .check, text: t(prompt ? .reportPromptYes : .reportCardConfirm), tone: c.tone)
                    voteButton(false, icon: .close, text: t(prompt ? .reportPromptNo : .reportCardGone), tone: c.tone)
                }
            }
        }
        .padding(16)
        .glass(radius: Tokens.Radius.card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t(.reportCardAria, ["label": c.label]))
    }

    private func voteButton(_ confirm: Bool, icon: IconName, text: String, tone: ReportTone) -> some View {
        Button { onVote(confirm) } label: {
            HStack(spacing: Tokens.Space.s2) {
                Icon(name: icon)
                Text(text)
            }
        }
        .buttonStyle(WideButtonStyle())
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(tone.color.opacity(voted == confirm ? 0.28 : 0))
                .allowsHitTesting(false)
        )
        .disabled(!canVote || sending)
        .opacity(!canVote || sending ? 0.5 : 1)
    }
}

/// Bejelentés-jelölő a térképen (a webes `.report-pin`): tónusszínű korong a típus ikonjával; kiválasztva nagyobb, kitöltött.
struct ReportPin: View {
    let report: ActiveReport
    let selected: Bool

    var body: some View {
        let c = report.choice
        Icon(name: c.icon, size: 24)
            .foregroundStyle(selected ? Tokens.Colors.bg : c.tone.color)
            .frame(width: 44, height: 44)
            .background {
                // a tónus 22 %-a a sötét felületen (a webes `color-mix`); kiválasztva teli
                ZStack {
                    Circle().fill(Tokens.Colors.surfaceStrong)
                    Circle().fill(c.tone.color.opacity(selected ? 1 : 0.22))
                }
            }
            .overlay(Circle().strokeBorder(c.tone.color, lineWidth: 2))
            .shadow(color: c.tone.color.opacity(0.4), radius: 7)
            .shadow(color: .black.opacity(0.5), radius: 9, y: 6)
            .scaleEffect(selected ? 1.18 : 1)
            .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
            .contentShape(Circle())
            .accessibilityLabel(t(.reportCardAria, ["label": c.label]))
            .animation(.easeOut(duration: Tokens.Motion.fast), value: selected)
    }
}

/// Rövid visszajelzés (a webes `.toast`): ikon + szöveg üveg-kapszulán, a tónus színével.
struct ToastView: View {
    let toast: AppToast

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            Icon(name: toast.icon, size: 22).foregroundStyle(toast.color)
            Text(toast.text)
                .font(.inter(Tokens.Typography.body.size - 3, 600))
                .foregroundStyle(Tokens.Colors.text)
                .lineLimit(2)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, 12)
        .glass(radius: 22)
        .accessibilityElement(children: .combine)
    }
}

/// Lenyomásra kicsit összemegy (a webes `.tile:active`).
struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: Tokens.Motion.fast), value: configuration.isPressed)
    }
}
