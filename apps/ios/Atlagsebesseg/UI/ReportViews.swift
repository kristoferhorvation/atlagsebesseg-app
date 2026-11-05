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
    let onPick: (ReportChoice, MapErrorKind?, HazardKind?, GpsFix?) -> Void
    let onClose: () -> Void

    private var noHeading: Bool { fix != nil && fix?.heading == nil }
    private var note: String {
        if !online { return t(.reportNoteOffline) }
        if fix == nil { return t(.reportNoteNoGps) }
        if noHeading { return t(.reportNoteGateNoHeading) }
        return gateStarted ? t(.reportNoteGateEnd) : t(.reportNoteDefault)
    }

    /// AOS17: a „Térképhiba” második választója nyitva – a küldés az első koppintáskori helyről megy.
    @State private var mapErrorFix: GpsFix?
    /// AW22: a „Veszély” második választója nyitva (ugyanígy).
    @State private var hazardFix: GpsFix?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SheetHead(title: mapErrorFix != nil ? ReportChoice.szakaszHiba.label : hazardFix != nil ? ReportChoice.akadaly.label : t(.reportTitle), onClose: onClose)
                if let fix = mapErrorFix {
                    mapErrorList(fix)
                } else if let fix = hazardFix {
                    hazardList(fix)
                } else {
                    let menu = reportMenu(gateStarted: gateStarted)
                    VStack(spacing: Tokens.Space.s2) {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: Tokens.Space.s2), GridItem(.flexible(), spacing: Tokens.Space.s2)], spacing: Tokens.Space.s2) {
                            ForEach(menu.filter { !$0.isGate }) { tile($0) }
                        }
                        // az egy kapu-tétel teljes szélességben; elküldött „eleje” után ugyanez a sor „vége” (AOS14 javítás)
                        ForEach(menu.filter(\.isGate)) { tile($0) }
                    }
                    .padding(.horizontal, -7)
                    GreedyText(text: note, font: .inter(Tokens.Typography.caption.size, Tokens.FontWeight.w400), lineHeight: 19)
                        .padding(EdgeInsets(top: 12, leading: 6, bottom: 2, trailing: 6))
                }
            }
            .padding(EdgeInsets(top: 20, leading: 16, bottom: 16, trailing: 16))
        }
        .scrollBounceBehavior(.basedOnSize)
        // `-reportMapError YES` (képernyőkép, `-reportOpen YES` mellett): rögtön a második választó
        .onAppear {
            if UserDefaults.standard.bool(forKey: "reportMapError") { mapErrorFix = fix }
            // `-reportHazard YES`: ugyanígy a Veszély választója
            if UserDefaults.standard.bool(forKey: "reportHazard") { hazardFix = fix }
        }
    }

    /// AOS17: mi a hiba? Egy koppintás elküldi, alkategóriával.
    private func mapErrorList(_ fix: GpsFix) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            GroupLabel(text: t(.reportSubQuestion))
            ListCard {
                ForEach(MapErrorKind.allCases) { k in
                    Button { onPick(.szakaszHiba, k, nil, fix) } label: {
                        HStack(spacing: 14) {
                            RowText(label: k.label, hint: k.hint)
                            Icon(name: .chevronRight, size: 20).foregroundStyle(Tokens.Colors.textFaint)
                        }
                        .listRow()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(sending != nil)
                    if k != MapErrorKind.allCases.last { RowDivider() }
                }
            }
        }
    }

    /// AW22: milyen veszély? Egy koppintás elküldi, altípussal (a Térképhiba-választó mintájára).
    private func hazardList(_ fix: GpsFix) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            GroupLabel(text: t(.reportHazardQuestion))
            ListCard {
                ForEach(HazardKind.allCases) { k in
                    Button { onPick(.akadaly, nil, k, fix) } label: {
                        HStack(spacing: 14) {
                            RowText(label: k.label)
                            Icon(name: .chevronRight, size: 20).foregroundStyle(Tokens.Colors.textFaint)
                        }
                        .listRow()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(sending != nil)
                    if k != HazardKind.allCases.last { RowDivider() }
                }
            }
        }
    }

    /// AOS17: az A5-ös csempe (76 pt, 44 pt-es ikon, 18 pt-es felirat). Szó közben soha nem törik: az egyszavas felirat egy sor, és
    /// ha nem fér ki, a betű enged.
    private func tile(_ c: ReportChoice) -> some View {
        let disabled = !online || fix == nil || sending != nil || (c.isGate && noHeading)
        // a webes `@media (max-width: 389px)`: keskeny kijelzőn a térköz enged
        let narrow = UIScreen.main.bounds.width < 390
        return Button {
            if c == .szakaszHiba { mapErrorFix = fix } else if c == .akadaly { hazardFix = fix } else { onPick(c, nil, nil, nil) }
        } label: {
            HStack(spacing: narrow ? Tokens.Space.s2 : 10) {
                Icon(name: c.icon)
                    .foregroundStyle(c.tone.color)
                    .frame(width: 44, height: 44)
                    .background(c.tone.color.opacity(Tokens.Opacity.o18), in: RoundedRectangle(cornerRadius: Tokens.Radius.r14, style: .continuous))
                Text(c.label)
                    .css(Tokens.FontSize.f18, Tokens.FontWeight.w600, line: 1.2)
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(c.label.contains(" ") ? 2 : 1)
                    .minimumScaleFactor(0.7)
                    .multilineTextAlignment(.leading)
                    // a webes `.tile-label { flex: 1 }`
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // a CSS-keret (1 pt) a belső margóhoz adódik
            .padding(.horizontal, narrow ? 9 : 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.tile, alignment: .leading)
            .background(sending == c ? c.tone.color.opacity(Tokens.Opacity.o22) : Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
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
                    .background(c.tone.color.opacity(Tokens.Opacity.o18), in: RoundedRectangle(cornerRadius: Tokens.Radius.r16, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(report.label).font(.inter(Tokens.FontSize.f22, Tokens.FontWeight.w640)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                    Text(timeAgo(now - report.createdAt)).font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w500)).foregroundStyle(Tokens.Colors.textMuted)
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
                Text(t(.reportCardOwn)).font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w500)).foregroundStyle(Tokens.Colors.textMuted)
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
        .accessibilityLabel(t(.reportCardAria, ["label": report.label]))
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
            RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous)
                .fill(tone.color.opacity(voted == confirm ? 0.28 : 0))
                .allowsHitTesting(false)
        )
        .disabled(!canVote || sending)
        .opacity(!canVote || sending ? 0.5 : 1)
    }
}

/// AOS15: egy fix kamera kártyája koppintásra (a webes `CameraCard` 1:1): típus, út · limit, irány a haladásunkhoz képest és
/// távolság, forrás (ellenőrzöttnél zöld pipa). Szavazás nincs – nem bejelentés. Ugyanott és ugyanúgy nyílik, mint a
/// bejelentés kártyája.
struct CameraCard: View {
    let camera: FixedCamera
    let fix: GpsFix?
    let unit: SpeedUnit
    let onClose: () -> Void

    var body: some View {
        let label = camera.type.label
        let detail = cameraCardDetail(road: camera.road, speedLimitKmh: camera.speedLimitKmh, unit)
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Icon(name: camera.type.icon, size: 26)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .frame(width: 52, height: 52)
                    .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.inter(Tokens.FontSize.f22, Tokens.FontWeight.w640)).foregroundStyle(Tokens.Colors.text).lineLimit(1).minimumScaleFactor(0.8)
                    if !detail.isEmpty {
                        Text(detail).font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w500)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
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
            Text(cameraCardMeta(headingDeg: camera.headingDeg, at: LatLon(lat: camera.lat, lon: camera.lon), fix: fix, unit))
                .font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w600))
                .foregroundStyle(Tokens.Colors.text)
            HStack(spacing: 8) {
                if camera.verified { Icon(name: .check, size: 18).foregroundStyle(Tokens.Colors.ok) }
                Text(cameraSourceText(camera)).font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w500)).foregroundStyle(Tokens.Colors.textMuted)
            }
        }
        .padding(16)
        .glass(radius: Tokens.Radius.card)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t(.cameraAria, ["label": label]))
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
                        Text(alert.report.label).font(.inter(Tokens.Typography.body.size, Tokens.FontWeight.w640)).lineLimit(1)
                        Text(t(.reportPromptQuestion)).font(.num(Tokens.Typography.title.size, Tokens.FontWeight.w700)).tracking(-0.3).lineLimit(1)
                    }
                } else {
                    let d = formatDistance(alert.prompt.distanceM, unit)
                    Text(t(.reportAlertAhead, ["label": alert.report.label, "d": "\(d.value) \(d.unit)"]))
                        .font(.num(Tokens.Typography.title.size, Tokens.FontWeight.w700)).tracking(-0.3).lineLimit(1).minimumScaleFactor(0.8)
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
            .font(.inter(Tokens.Typography.body.size, Tokens.FontWeight.w640))
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.touch)
            .foregroundStyle(Tokens.Colors.bg)
            .background(Tokens.Colors.bg.opacity(Tokens.Opacity.o16), in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
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
    /// Bejelentés küldése közben a gombok tiltva (mint a weben).
    var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: .dugo, size: 40)
                // AW23: csak a kérdés (a „Dugó” cím ugyanazt mondta)
                Text(t(.navJamQuestion)).font(.num(Tokens.Typography.title.size, Tokens.FontWeight.w700)).tracking(-0.3).lineLimit(1).minimumScaleFactor(0.8)
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
            .font(.inter(Tokens.Typography.body.size, Tokens.FontWeight.w640))
            .frame(maxWidth: .infinity, minHeight: Tokens.Size.touch)
            .foregroundStyle(Tokens.Colors.bg)
            .background(Tokens.Colors.bg.opacity(Tokens.Opacity.o16), in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressScaleStyle())
        .disabled(sending)
        .opacity(sending ? 0.5 : 1)
    }
}

/// AW18: a „Dugóba kerültél?” önálló borostyán kártyán (ha a felső kártya nem látszik).
struct JamAskCard: View {
    let onAnswer: (Bool) -> Void
    var sending = false

    var body: some View {
        JamAskRow(onAnswer: onAnswer, sending: sending)
            .padding(Tokens.Space.s4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(radius: Tokens.Radius.r28, fill: Tokens.Colors.near)
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
            .glass(radius: Tokens.Radius.r28, fill: Tokens.Colors.near)
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
            .shadow(color: c.tone.color.opacity(Tokens.Opacity.o40), radius: Tokens.Glow.reportPin)
            .background(BoxShadow(shape: Circle(), layers: Tokens.Shadow.reportPin))
            .scaleEffect(selected ? 1.18 : 1)
            .frame(width: Tokens.Size.touch, height: Tokens.Size.touch)
            .contentShape(Circle())
            .accessibilityLabel(t(.reportCardAria, ["label": report.label]))
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
                .font(.inter(Tokens.Typography.body.size - 3, Tokens.FontWeight.w600))
                .foregroundStyle(Tokens.Colors.text)
                .lineLimit(2)
        }
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, 12)
        .glass(radius: Tokens.Radius.r22)
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
