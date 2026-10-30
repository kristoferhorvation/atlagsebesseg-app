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
    /// AOS14 javítás: az „Átlagmérés eleje” elküldve – az egyetlen kapu-tétel most „Átlagmérés vége”.
    let gateStarted: Bool
    let onPick: (ReportChoice) -> Void
    @Environment(\.dismiss) private var dismiss

    private var noHeading: Bool { fix != nil && fix?.heading == nil }
    private var note: String {
        if !online { return t(.reportNoteOffline) }
        if fix == nil { return t(.reportNoteNoGps) }
        if noHeading { return t(.reportNoteGateNoHeading) }
        return gateStarted ? t(.reportNoteGateEnd) : t(.reportNoteDefault)
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
            let menu = reportMenu(gateStarted: gateStarted)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: Tokens.Space.s2), GridItem(.flexible(), spacing: Tokens.Space.s2)], spacing: Tokens.Space.s2) {
                ForEach(menu.filter { !$0.isGate && !$0.isRowTile }) { tile($0) }
            }
            // AW18: az utolsó sor négy oszlopnyi: Dugó | Beállt | az egy kapu-tétel (két oszlop széles) – a menü nem lesz magasabb.
            // AOS14 javítás: egy kapu-tétel – elküldött „eleje” után ugyanez a sor „vége”
            HStack(spacing: Tokens.Space.s2) {
                HStack(spacing: Tokens.Space.s2) {
                    ForEach(menu.filter(\.isRowTile)) { smallTile($0) }
                }
                .frame(maxWidth: .infinity)
                ForEach(menu.filter(\.isGate)) { tile($0) }
                    .frame(maxWidth: .infinity)
            }
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

    /// AW18: kis csempe az utolsó sorban – az ikon a felirat fölött, a nagy csempével azonos magasságban.
    private func smallTile(_ c: ReportChoice) -> some View {
        let disabled = !online || fix == nil || sending != nil
        return Button { onPick(c) } label: {
            VStack(spacing: 4) {
                Icon(name: c.icon, size: 22)
                    .foregroundStyle(c.tone.color)
                    .frame(width: 34, height: 34)
                    .background(c.tone.color.opacity(0.18), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                Text(c.label)
                    .font(.inter(14, 600))
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.tile)
            .background(sending == c ? c.tone.color.opacity(0.22) : Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous).strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(c.label)
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

/// Egy térképi bejelentés kártyája koppintásra: típus, mikor jelentették, megerősítés / nincs ott (`report_votes`). Vezetés
/// közben is kezelhető: minden gomb ≥ 56 pt. (A közeledő bejelentés kártyája külön: `ReportAlertRow`, felül.)
struct ReportCard: View {
    let report: ActiveReport
    let now: Double
    let canVote: Bool
    /// A saját korábbi szavazat (`nil`: még nem szavazott).
    let voted: Bool?
    let sending: Bool
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
                    voteButton(true, icon: .check, text: t(.reportCardConfirm), tone: c.tone)
                    voteButton(false, icon: .close, text: t(.reportCardGone), tone: c.tone)
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

/// A közeledő bejelentés kártyájának adatai (AOS14).
struct ReportAlertModel {
    let prompt: ReportPrompt
    let report: ActiveReport
    let canVote: Bool
    let sending: Bool
    let onVote: (Bool) -> Void
}

/// A közeledő bejelentés sora a kamera-sor kinézetével (borostyán kártyán, sötét betűvel): közeledéskor „Rendőrség 240 m”,
/// 50 m-rel a bejelentés előtt (`REPORT_PROMPT.nearM`) UGYANEZ a sor helyben „Még ott van?” + Igen / Nem (nem jön új elem).
struct ReportAlertRow: View {
    let alert: ReportAlertModel
    let unit: SpeedUnit

    var body: some View {
        let c = alert.report.choice
        let ask = alert.prompt.phase == .ask
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: c.icon, size: 40)
                if ask {
                    VStack(alignment: .leading, spacing: 0) {
                        Text(c.label).font(.inter(Tokens.Typography.body.size, 640)).lineLimit(1)
                        Text(t(.reportPromptQuestion)).font(.num(Tokens.Typography.title.size, 700)).tracking(-0.3).lineLimit(1)
                    }
                } else {
                    let d = formatDistance(alert.prompt.distanceM, unit)
                    Text(t(.reportAlertAhead, ["label": c.label, "d": "\(d.value) \(d.unit)"]))
                        .font(.num(Tokens.Typography.title.size, 700)).tracking(-0.3).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            if ask {
                HStack(spacing: Tokens.Space.s2) {
                    answer(true, icon: .check, text: t(.reportPromptYes))
                    answer(false, icon: .close, text: t(.reportPromptNo))
                }
            }
        }
        .foregroundStyle(Tokens.Colors.bg)
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
    }

    private func answer(_ confirm: Bool, icon: IconName, text: String) -> some View {
        Button { alert.onVote(confirm) } label: {
            HStack(spacing: Tokens.Space.s2) {
                Icon(name: icon)
                Text(text)
            }
            .font(.inter(Tokens.Typography.body.size, 640))
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.touch)
            .foregroundStyle(Tokens.Colors.bg)
            .background(Tokens.Colors.bg.opacity(0.16), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(!alert.canVote || alert.sending)
        .opacity(!alert.canVote || alert.sending ? 0.5 : 1)
    }
}

/// AW18: „Dugóba kerültél? Igen / Nem” – a „Még ott van?” sor helyén és stílusában (borostyán kártyán, sötét betűvel). Igen:
/// „Dugó” bejelentés a pozícióra; Nem: erre a szakaszra nem kérdez újra; válasz nélkül 15 s után eltűnik (a session dönti el).
struct JamAskRow: View {
    let onAnswer: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: .dugo, size: 40)
                // AW18-javítás: a „Dugó” cím a kérdés fölött, mint a weben és a „Még ott van?” sorban
                VStack(alignment: .leading, spacing: 0) {
                    Text(t(.reportTypeDugo)).font(.inter(Tokens.Typography.body.size, 640)).lineLimit(1)
                    Text(t(.navJamQuestion)).font(.num(Tokens.Typography.title.size, 700)).tracking(-0.3).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            HStack(spacing: Tokens.Space.s2) {
                answer(true, icon: .check, text: t(.reportPromptYes))
                answer(false, icon: .close, text: t(.reportPromptNo))
            }
        }
        .foregroundStyle(Tokens.Colors.bg)
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
    }

    private func answer(_ yes: Bool, icon: IconName, text: String) -> some View {
        Button { onAnswer(yes) } label: {
            HStack(spacing: Tokens.Space.s2) {
                Icon(name: icon)
                Text(text)
            }
            .font(.inter(Tokens.Typography.body.size, 640))
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.touch)
            .foregroundStyle(Tokens.Colors.bg)
            .background(Tokens.Colors.bg.opacity(0.16), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
    }
}

/// AW18: a „Dugóba kerültél?” önálló borostyán kártyán (ha a felső kártya nem látszik).
struct JamAskCard: View {
    let onAnswer: (Bool) -> Void

    var body: some View {
        JamAskRow(onAnswer: onAnswer)
            .padding(Tokens.Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(radius: 28, fill: Tokens.Colors.near)
    }
}

/// Navigáció nélkül (vagy ha a felső kártya nem látszik) a közeledő bejelentés kártyája önállóan, a felső kártya helyén és
/// a kamera-figyelmeztetés stílusában.
struct ReportAlertCard: View {
    let alert: ReportAlertModel
    let unit: SpeedUnit

    var body: some View {
        ReportAlertRow(alert: alert, unit: unit)
            .padding(Tokens.Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(radius: 28, fill: Tokens.Colors.near)
            .animation(.easeOut(duration: Tokens.Motion.base), value: alert.prompt.phase)
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
