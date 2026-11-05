import AtlagsebessegCore
import SwiftUI

/// A mérőkártya – a webes `Hud` (apps/web/src/ui/Hud.tsx) portja: ugyanazok az állapotok, elrendezés és tokenek.
struct MeterCard: View {
    let view: SessionView
    let settings: Settings
    let gpsReady: Bool
    var onStopManual: () -> Void = {}
    var onDismiss: () -> Void = {}
    /// Navigáció közben (AOS13) a mérés eredménye egy sor (`navResultCompact`; AW15: a kézi mérésé is).
    var compact = false
    /// AW17: mérés + „Gyorsabb út” ajánlat egyszerre – a mérőkártya egy sor (`navMeterCompact`), hogy az ajánlat elférjen.
    var meterCompact = false
    /// AW15: navigáció közben a kézi mérés teljes kártyája bökésre pillé zsugorodik (a Leállítás gomb kivételével).
    var onCollapseManual: (() -> Void)?

    @Environment(\.horizontalSizeClass) private var sizeClass

    private var unit: SpeedUnit { settings.egyseg }
    private var u: String { unitLabel(unit) }
    /// A webes `@media (max-width: 340px)`.
    private var narrow: Bool { UIScreen.main.bounds.width <= 340 }

    var body: some View {
        let tone = toneOf(view)
        switch view.phase {
        case .meres: if meterCompact { measuringCompact(tone) } else { measuring(tone) }
        case .kozeledik: approaching(tone)
        case .befejezve: if compact { finishedCompact(tone) } else { finished(tone) }
        case .megszakadt: interrupted(tone)
        case .kezi: manual(tone)
        case .keziEredmeny: if compact { manualResultCompact(tone) } else { manualResult(tone) }
        case .nincsSzakasz: idle(tone)
        }
    }

    // MARK: állapotok

    private func measuring(_ tone: Tone) -> some View {
        let s = view.section!
        let live = view.live!
        return Card(tone: tone, label: t(.hudMeasure)) {
            HStack(spacing: Tokens.Space.s4) {
                if let status = view.status {
                    Chip(tone: tone, icon: status.icon, text: status.label)
                } else {
                    Chip(tone: tone, icon: nil, text: t(.hudStarting), neutral: true)
                }
                Spacer(minLength: 0)
                if live.estimated {
                    Chip(tone: tone, icon: .tunnel, text: t(.hudEstimate), neutral: true)
                        .accessibilityLabel(t(.hudEstimateAria))
                }
            }
            Hero(value: speedIn(live.averageKmh, unit), tone: tone)
            Text(t(.hudAvg, ["u": u]))
                .typeStyle(Tokens.Typography.body)
                .foregroundStyle(Tokens.Colors.textMuted)
                .padding(.top, -6)
            HStack(alignment: .center, spacing: narrow ? 10 : 14) {
                VStack(spacing: Tokens.Space.s2) {
                    LimitSign(kmh: s.speedLimitKmh, unit: unit, small: true, diameter: narrow ? 62 : nil)
                    if settings.hatosagiTuresMegjelenitese {
                        Text(t(.hudTolerance, ["x": speedFloorIn(limitWithToleranceKmh(s.speedLimitKmh), unit).map(String.init) ?? ""]))
                            .font(.num(Tokens.Typography.body.size, Tokens.FontWeight.w600))
                            .foregroundStyle(Tokens.Colors.textMuted)
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                // az állapot nem változik: a „most” önállóan jelzi, ha a pillanatnyi sebesség a határ felett van
                MeterFigure(label: t(.hudNow), value: speedIn(view.currentKmh, unit), over: (view.currentKmh ?? 0) > s.speedLimitKmh)
                Text("·")
                    .css(Tokens.FontSize.f32, Tokens.FontWeight.w600)
                    .foregroundStyle(Tokens.Colors.textFaint)
                    .padding(.bottom, 6)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .accessibilityHidden(true)
                MeterFigure(label: t(.hudExpected), value: speedIn(live.projectedKmh, unit), over: false)
                Spacer(minLength: 0)
            }
            .fixedSize(horizontal: false, vertical: true)
            ProgressRow(value: view.progress ?? 0, label: dist(live.remainingM), tone: tone)
        }
    }

    /// AW17: egy sor – átlag a státusz színével, most · várható, tábla (a webes `.compact-row.meter-compact`); az ajánlat eltűnése után visszanő.
    private func measuringCompact(_ tone: Tone) -> some View {
        let s = view.section!
        let live = view.live!
        let small = UIScreen.main.bounds.width < 340
        let figure: CGFloat = small ? Tokens.FontSize.f24 : Tokens.FontSize.f28
        return CompactCard(tone: tone, label: t(.hudMeasure), padH: small ? 12 : 20) {
            HStack(alignment: .center, spacing: small ? 4 : 8) {
                HStack(alignment: .center, spacing: small ? 4 : 6) {
                    Text(speedIn(live.averageKmh, unit).map(String.init) ?? "–")
                        .css(figure, Tokens.FontWeight.w700, tracking: Tokens.Typography.title.tracking, num: true)
                        .foregroundStyle(tone.color)
                    // AW17-javítás: a külön „Lassíts” sáv ilyenkor nincs – egység, alatta a max érték a státusz színében
                    VStack(alignment: .leading, spacing: 0) {
                        Text(u).css(Tokens.Typography.body.size, Tokens.FontWeight.w560, line: 1.15).foregroundStyle(Tokens.Colors.textMuted).padding(.leading, 5)
                        if let bar = compactMeterBarText(meterBar(view.status, live.required), unit) {
                            Text(bar).css(Tokens.Typography.caption.size, Tokens.FontWeight.w700, line: 1.15, num: true).foregroundStyle(tone.color)
                        }
                    }
                }
                .lineLimit(1)
                .fixedSize()
                // a webes `margin-right: auto`: a többi a jobb szélre zárva (a `Spacer` a két oldalán is térközt adna)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(-1)
                MeterFigure(label: t(.hudNow), value: speedIn(view.currentKmh, unit), over: (view.currentKmh ?? 0) > s.speedLimitKmh, size: figure, compact: true)
                MeterFigure(label: t(.hudExpected), value: speedIn(live.projectedKmh, unit), over: false, size: figure, compact: true)
                LimitSign(kmh: s.speedLimitKmh, unit: unit, small: true, diameter: small ? 50 : UIScreen.main.bounds.width < 390 ? 62 : nil)
            }
        }
    }

    private func approaching(_ tone: Tone) -> some View {
        let s = view.section!
        let d = view.approachM.map { formatDistance($0, unit) }
        return Card(tone: tone, label: t(.hudApproachAria)) {
            HStack {
                Chip(tone: tone, icon: .approach, text: t(.hudApproachChip))
                Spacer(minLength: 0)
            }
            HStack(alignment: .bottom, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: Tokens.Space.s2) {
                    // a webes `.display` inline: a szám és a felirat együtt, mohón tördel („780 m / múlva”), a szám soha nem törik szét
                    ApproachLabel(value: d?.value ?? "–", label: d.map { t(.hudAhead, ["u": $0.unit]) } ?? "")
                    GreedyText(text: [s.road, s.direction].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? t(.hudApproachDefault), font: .inter(Tokens.Typography.body.size, Tokens.Typography.body.weight), lineHeight: Tokens.Typography.body.lineHeight * Tokens.Typography.body.size)
                }
                Spacer(minLength: 0)
                LimitSign(kmh: s.speedLimitKmh, unit: unit)
            }
            SourceLine(section: s)
        }
    }

    private func finished(_ tone: Tone) -> some View {
        let r = view.result!
        let diff = abs((speedIn(r.averageKmh, unit) ?? 0) - (speedIn(r.speedLimitKmh, unit) ?? 0))
        let status = view.status ?? .jo
        return Card(tone: tone, label: t(.hudDoneAria)) {
            HStack {
                Chip(tone: tone, icon: status.icon, text: r.overLimit ? t(.hudDoneOver, ["x": String(diff), "u": u]) : t(.hudDoneUnder))
                Spacer(minLength: 0)
            }
            Hero(value: speedIn(r.averageKmh, unit), tone: tone)
            HStack(spacing: Tokens.Space.s4) {
                LimitSign(kmh: r.speedLimitKmh, unit: unit, small: true)
                Text(t(.hudDoneFinal, ["u": u]))
                    .typeStyle(Tokens.Typography.body)
                    .foregroundStyle(Tokens.Colors.textMuted)
                Spacer(minLength: 0)
            }
            HStack(spacing: Tokens.Space.s2) {
                Stat(value: dist(r.lengthM), label: t(.hudDoneSection))
                Stat(value: formatDuration(r.exitTime - r.entryTime), label: t(.hudDoneDuration))
            }
            if let s = view.section { SourceLine(section: s) }
            Button(t(.commonDone), action: onDismiss).buttonStyle(WideButtonStyle())
        }
    }

    /// Kompakt eredmény (navigáció közben): átlag a tónus színében, alatta a határhoz mért állapot, jobbra „Kész”.
    private func finishedCompact(_ tone: Tone) -> some View {
        let r = view.result!
        let diff = abs((speedIn(r.averageKmh, unit) ?? 0) - (speedIn(r.speedLimitKmh, unit) ?? 0))
        let status = view.status ?? .jo
        return CompactCard(tone: tone, label: t(.hudDoneAria)) { HStack(spacing: Tokens.Space.s4) {
            Text(speedIn(r.averageKmh, unit).map(String.init) ?? "–")
                .css(Tokens.Typography.title.size, Tokens.FontWeight.w700, tracking: Tokens.Typography.title.tracking, num: true)
                .foregroundStyle(tone.color)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(t(.hudDoneFinal, ["u": u]))
                    .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
                HStack(spacing: 6) {
                    Icon(name: status.icon, size: 16)
                    Text(r.overLimit ? t(.hudDoneOver, ["x": String(diff), "u": u]) : t(.hudDoneUnder))
                        .font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w620))
                }
                .foregroundStyle(tone.color)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            Button(t(.commonDone), action: onDismiss)
                .font(.inter(Tokens.FontSize.f16, Tokens.FontWeight.w620))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Tokens.Colors.text)
                .padding(.horizontal, Tokens.Space.s4)
                .frame(height: 48)
                .background(Tokens.Colors.fill10, in: RoundedRectangle(cornerRadius: Tokens.Radius.r14, style: .continuous))
        } }
    }

    private func interrupted(_ tone: Tone) -> some View {
        let reason = view.interruption?.reason ?? .jelvesztes
        let manual = view.section == nil
        return Card(tone: tone, label: t(.hudInterruptedAria)) {
            HStack {
                Chip(tone: tone, icon: .pause, text: manual ? t(.hudInterruptedManual) : t(.hudInterruptedAuto))
                Spacer(minLength: 0)
            }
            Text(reason.label)
                .typeStyle(Tokens.Typography.title)
                .foregroundStyle(Tokens.Colors.text)
            Text("\(t(.hudInterruptedInvalid)) \(reason == .hatter ? t(.hudInterruptedBackground) : t(.hudInterruptedRestart))")
                .typeStyle(Tokens.Typography.body)
                .foregroundStyle(Tokens.Colors.textMuted)
            Button(t(.commonOk), action: onDismiss).buttonStyle(WideButtonStyle())
        }
    }

    private func manual(_ tone: Tone) -> some View {
        let m = view.manual!
        return Card(tone: tone, label: t(.hudManual)) {
            HStack {
                Chip(tone: tone, icon: .stopwatch, text: t(.hudManual))
                Spacer(minLength: 0)
                Text(formatDuration(m.elapsedMs))
                    .css(Tokens.Typography.title.size, Tokens.Typography.title.weight, line: Tokens.Typography.title.lineHeight, tracking: Tokens.Typography.title.tracking, num: true)
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            Hero(value: speedIn(m.averageKmh, unit), tone: tone)
            HStack {
                Text(t(.hudAvg, ["u": u]))
                    .typeStyle(Tokens.Typography.body)
                    .foregroundStyle(Tokens.Colors.textMuted)
                Spacer(minLength: 0)
                Text(dist(m.distanceM)).css(Tokens.Typography.body.size, Tokens.Typography.body.weight, line: Tokens.Typography.body.lineHeight, num: true)
            }
            Button(action: onStopManual) {
                HStack(spacing: 10) {
                    Icon(name: .stop)
                    Text(t(.hudManualStop))
                }
            }
            .buttonStyle(WideButtonStyle(kind: .danger))
        }
        .contentShape(Rectangle())
        .onTapGesture { onCollapseManual?() }
    }

    private func manualResult(_ tone: Tone) -> some View {
        let r = view.manualResult!
        return Card(tone: tone, label: t(.hudManualDoneAria)) {
            HStack {
                Chip(tone: tone, icon: .check, text: t(.hudManualDoneChip))
                Spacer(minLength: 0)
            }
            Hero(value: speedIn(r.averageKmh, unit), tone: tone)
            Text(t(.hudAvg, ["u": u]))
                .typeStyle(Tokens.Typography.body)
                .foregroundStyle(Tokens.Colors.textMuted)
            HStack(spacing: Tokens.Space.s2) {
                Stat(value: dist(r.distanceM), label: t(r.estimatedGapM > 0 ? .hudManualDoneDistanceEst : .hudManualDoneDistance))
                Stat(value: formatDuration(r.elapsedMs), label: t(.hudManualDoneTime))
            }
            Button(t(.commonDone), action: onDismiss).buttonStyle(WideButtonStyle())
        }
    }

    /// AW15: a kézi mérés eredménye navigáció közben egy sorban – átlag a tónus színében, alatta táv · idő, jobbra „Kész”.
    /// (iOS-en nincs ideiglenes szakasz, így kapu-küldés és „Újra” sincs.)
    private func manualResultCompact(_ tone: Tone) -> some View {
        let r = view.manualResult!
        return CompactCard(tone: tone, label: t(.hudManualDoneAria)) { HStack(spacing: Tokens.Space.s4) {
            Text(speedIn(r.averageKmh, unit).map(String.init) ?? "–")
                .css(Tokens.Typography.title.size, Tokens.FontWeight.w700, tracking: Tokens.Typography.title.tracking, num: true)
                .foregroundStyle(tone.color)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(t(.hudAvg, ["u": u]))
                    .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
                HStack(spacing: 6) {
                    Icon(name: .stopwatch, size: 16)
                    Text("\(dist(r.distanceM)) · \(formatDuration(r.elapsedMs))")
                        .font(.num(Tokens.Typography.caption.size, Tokens.FontWeight.w620))
                }
                .foregroundStyle(tone.color)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            Button(t(.commonDone), action: onDismiss)
                .font(.inter(Tokens.FontSize.f16, Tokens.FontWeight.w620))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Tokens.Colors.text)
                .padding(.horizontal, Tokens.Space.s4)
                .frame(height: 48)
                .background(Tokens.Colors.fill10, in: RoundedRectangle(cornerRadius: Tokens.Radius.r14, style: .continuous))
        } }
    }

    /// Kompakt alapállapot: egy sor, hogy a térkép lássa a képernyő ~80%-át.
    private func idle(_ tone: Tone) -> some View {
        CompactCard(tone: tone, label: t(.hudNoneAria)) {
            HStack(spacing: Tokens.Space.s4) {
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    Text(gpsReady ? String(speedIn(view.currentKmh ?? 0, unit) ?? 0) : "–")
                        .css(Tokens.Typography.title.size, Tokens.FontWeight.w700, tracking: Tokens.Typography.title.tracking, num: true)
                    // a webes `small` örökli a szám `letter-spacing`-jét (px-ben): −0,42 px
                    Text(u)
                        .css(Tokens.Typography.body.size, Tokens.FontWeight.w560, tracking: Tokens.Typography.title.tracking * Tokens.Typography.title.size / Tokens.Typography.body.size)
                        .foregroundStyle(Tokens.Colors.textMuted)
                }
                .fixedSize()
                // AW23: egysoros (a webes `FitText`): soha nem törik, ha nem fér ki, arányosan kisebb
                Text(gpsReady ? t(.hudNoneNear) : t(.hudNoneWaiting))
                    .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }

    private func dist(_ m: Double) -> String {
        let d = formatDistance(m, unit)
        return "\(d.value) \(d.unit)"
    }
}

// MARK: elemek

/// AW16: navigáció közben a kézi mérés a mérőkártya lekicsinyített változata a gombsor jobb oldalán: a nagy átlag-szám a
/// kézi-mérés (accent) színében – mint a teljes kézi kártyán, nincs referencia –, alatta „km/h átlag” és az eltelt idő; Leállítás
/// nélkül. Bökésre a teljes kártya nyílik.
struct ManualMini: View {
    let view: SessionView
    let unit: SpeedUnit
    let onExpand: () -> Void

    var body: some View {
        let m = view.manual
        let tone = Tone.kezi
        Button(action: onExpand) {
            VStack(spacing: 0) {
                Text(speedIn(m?.averageKmh, unit).map(String.init) ?? "–")
                    .css(Tokens.FontSize.f40, Tokens.FontWeight.w700, line: 1.05, tracking: -0.03, num: true)
                    .foregroundStyle(tone.color)
                Text(t(.hudAvg, ["u": unitLabel(unit)]))
                    .font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w560))
                    .foregroundStyle(Tokens.Colors.textMuted)
                HStack(spacing: 4) {
                    Icon(name: .stopwatch, size: 14)
                    Text(formatDuration(m?.elapsedMs ?? 0)).font(.num(Tokens.Typography.caption.size, Tokens.FontWeight.w600))
                }
                .foregroundStyle(Tokens.Colors.textMuted)
                .padding(.top, 2)
            }
            .lineLimit(1)
            .fixedSize()
            // a webes `min-width: 112px` a margóval együtt
            .frame(minWidth: 112 - 2 * 14)
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 9)
            .background(tone.color.opacity(Tokens.Opacity.o12), in: RoundedRectangle(cornerRadius: Tokens.Radius.card, style: .continuous))
            .glass(radius: Tokens.Radius.card)
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.card, style: .continuous).strokeBorder(tone.color.opacity(Tokens.Opacity.o55), lineWidth: 1))
            .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.card))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(t(.hudManualPillAria))
        .transition(.opacity.combined(with: .offset(y: 12)))
    }
}

extension MeterState {
    var icon: IconName {
        switch self {
        case .jo: .check
        case .lassits: .arrowDown
        case .tulGyors: .arrowUp
        }
    }

    var label: String {
        switch self {
        case .jo: t(.statusGood)
        case .lassits: t(.statusSlow)
        case .tulGyors: t(.statusFast)
        }
    }
}

extension InterruptReason {
    var label: String {
        switch self {
        case .hatter: t(.interruptBackground)
        case .letert: t(.interruptOffRoute)
        case .ellenirany: t(.interruptWrongWay)
        case .jelvesztes: t(.interruptGpsLoss)
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

/// A kártya háttere (a webes `.card::before`, `::after`): a tónus fényíve felül – `inset: -60% -30% auto`, magassága 130%, `closest-side` –, a
/// státusznál 9%-os árnyalat, és a felső fénycsík (`left / right: 28 px`, 1,5 px).
struct CardBackground: View {
    let tone: Tone
    var glow: Double = 0.2

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                if tone.isStatus { tone.color.opacity(Tokens.Opacity.o09) }
                EllipticalGradient(colors: [tone.color, tone.color.opacity(0)], center: .center, startRadiusFraction: 0, endRadiusFraction: 0.5)
                    .frame(width: geo.size.width * 1.6, height: geo.size.height * 1.3)
                    .offset(x: -geo.size.width * 0.3, y: -geo.size.height * 0.6)
                    .opacity(glow)
                LinearGradient(colors: [tone.color.opacity(0), tone.color, tone.color.opacity(0)], startPoint: .leading, endPoint: .trailing)
                    .frame(width: max(0, geo.size.width - 56), height: 1.5)
                    .offset(x: 28)
                    .opacity(Tokens.Opacity.o90)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: Tokens.Motion.slow), value: tone)
    }
}

/// `.card.compact`: egysoros kártya, 24 pt-es sarok, 12 / 20 pt margó, legalább 48 pt magas sor, halványabb fényív.
struct CompactCard<Content: View>: View {
    let tone: Tone
    let label: String
    var padH: CGFloat = Tokens.Space.s5
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.r24, style: .continuous)
        content
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .padding(.vertical, Tokens.Space.s3)
            .padding(.horizontal, padH)
            .background(CardBackground(tone: tone, glow: 0.1).clipShape(shape))
            .glass(radius: Tokens.Radius.r24)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
    }
}

/// Többsoros szöveg mohó sortöréssel, mint a CSS: a SwiftUI `Text` a rövid utolsó sor elkerülésére (a rendszer `lineBreakStrategy`-je) korábban törne.
struct GreedyText: UIViewRepresentable {
    let text: String
    let font: UIFont
    /// Pontos sormagasság (pt), mint a CSS `line-height`.
    let lineHeight: CGFloat
    var color: Color = Tokens.Colors.textMuted
    var lines = 0
    /// A saját szélességén (CSS `align-self: flex-start`), nem a teljes felkínált szélességen.
    var hug = false

    func makeUIView(context: Context) -> UILabel {
        let l = UILabel()
        l.lineBreakMode = .byWordWrapping
        l.lineBreakStrategy = []
        l.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        l.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return l
    }

    func updateUIView(_ l: UILabel, context: Context) {
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = lineHeight
        p.maximumLineHeight = lineHeight
        p.lineBreakStrategy = []
        p.lineBreakMode = lines == 1 ? .byTruncatingTail : .byWordWrapping
        l.numberOfLines = lines
        l.attributedText = NSAttributedString(string: text, attributes: [
            .font: font,
            .paragraphStyle: p,
            .foregroundColor: UIColor(color),
            .baselineOffset: (lineHeight - font.lineHeight) / 2,
        ])
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
        let w = proposal.width ?? 300
        let fit = uiView.sizeThatFits(CGSize(width: w, height: .greatestFiniteMagnitude))
        // a CSS shrink-to-fit: egy sornál a szöveg széles, tördelve a teljes felkínált szélesség
        return CGSize(width: hug && fit.height <= lineHeight + 1 ? min(w, ceil(fit.width)) : w, height: fit.height)
    }
}

/// A webes `.display` + `small`: nagy szám és kis felirat inline, minden sor 64 pt-es (`line-height: 1`), a felirat szavanként tördel („780 m / múlva”).
struct ApproachLabel: View {
    let value: String
    let label: String

    var body: some View {
        let words = label.split(separator: " ").map(String.init)
        ViewThatFits(in: .horizontal) {
            lines(first: words, rest: [])
            lines(first: Array(words.prefix(max(0, words.count - 1))), rest: Array(words.suffix(1)))
            lines(first: [], rest: words)
        }
    }

    private func lines(first: [String], rest: [String]) -> some View {
        let d = Tokens.Typography.display
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                Text(value).font(.num(d.size, d.weight)).tracking(d.trackingPt).foregroundStyle(Tokens.Colors.text)
                if !first.isEmpty { small(first.joined(separator: " ")) }
            }
            .fixedSize()
            .frame(height: d.size * d.lineHeight)
            if !rest.isEmpty {
                // a `line-height: 1` sorának alapvonala: 55 pt a sor tetejétől
                small(rest.joined(separator: " "))
                    .fixedSize()
                    .frame(height: d.size * d.lineHeight, alignment: .bottomLeading)
                    .padding(.bottom, 0)
                    .offset(y: -Tokens.Space.s1)
            }
        }
    }

    private func small(_ s: String) -> some View {
        Text(s).font(.inter(Tokens.Typography.body.size, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted)
    }
}

/// `.card.card-stack`: üvegkártya a tónus árnyalatával, 14 pt-os oszlopközzel.
private struct Card<Content: View>: View {
    let tone: Tone
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CardBackground(tone: tone).clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.card, style: .continuous)))
            .glass(radius: Tokens.Radius.card)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(label)
    }
}

/// A nagy szám (az átlag): `clamp(120, 42vw, 196)`, a tónus színében, enyhe fénnyel.
private struct Hero: View {
    let value: Int?
    let tone: Tone

    var body: some View {
        let t = Tokens.Typography.self
        let size = min(t.hero.size, max(t.heroMin, UIScreen.main.bounds.width * t.heroVw / 100))
        Text(value.map(String.init) ?? "–")
            .font(.num(size, t.hero.weight))
            .tracking(t.hero.tracking * size)
            .foregroundStyle(tone.color)
            .shadow(color: tone.color.opacity(Tokens.Opacity.o35), radius: Tokens.Glow.hero)
            .lineLimit(1)
            .fixedSize()
            // a webes `line-height: 0.9`: a doboz kisebb a betűnél, a szöveg belóg (nem kicsinyítjük)
            .frame(height: size * t.hero.lineHeight)
            .padding(.leading, -0.045 * size)
            .padding(.top, 2)
            .contentTransition(.numericText())
    }
}

/// „most 144” / „várható 122” – táblázatos számok, 1,5 m-ről olvasható.
private struct MeterFigure: View {
    let label: String
    let value: Int?
    let over: Bool
    var size: CGFloat = 44
    /// AW17-javítás: az egysoros kártyán caption-méretű felirat.
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .css(compact ? Tokens.Typography.caption.size : Tokens.Typography.body.size, Tokens.Typography.body.weight, line: 1.1)
                .foregroundStyle(Tokens.Colors.textMuted)
            Text(value.map(String.init) ?? "–")
                .css(size, Tokens.FontWeight.w700, line: 1.05, tracking: -0.03, num: true)
                .foregroundStyle(over ? Tokens.Colors.near : Tokens.Colors.text)
                .lineLimit(1)
        }
        .fixedSize()
    }
}

private struct ProgressRow: View {
    let value: Double
    let label: String
    let tone: Tone

    var body: some View {
        HStack(spacing: 14) {
            GeometryReader { geo in
                // a webes `.progress { overflow: hidden }`: a kitöltés fénye nem lóg a sávon túl
                ZStack(alignment: .leading) {
                    Capsule().fill(Tokens.Colors.fill09)
                    Capsule()
                        .fill(tone.color)
                        .shadow(color: tone.color, radius: Tokens.Glow.progress)
                        .frame(width: geo.size.width * value)
                        .animation(.linear(duration: Tokens.Motion.data), value: value)
                }
                .clipShape(Capsule())
            }
            .frame(height: Tokens.Size.progress)
            .accessibilityElement()
            .accessibilityValue("\(Int(jsRound(value * 100)))%")
            Text(label)
                .css(Tokens.Typography.body.size, Tokens.FontWeight.w620, num: true)
                .foregroundStyle(Tokens.Colors.textMuted)
                .frame(minWidth: 84, alignment: .trailing)
                .fixedSize()
        }
    }
}

private struct Stat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.num(Tokens.Typography.title.size, Tokens.Typography.title.weight))
                .tracking(-0.02 * Tokens.Typography.title.size)
            Text(label)
                .font(.inter(Tokens.Typography.caption.size, Tokens.Typography.caption.weight))
                .foregroundStyle(Tokens.Colors.textMuted)
        }
        .padding(.vertical, Tokens.Space.s3)
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
    }
}

/// A szakasz forrása és (ha hivatalos listán ellenőrzött) a jelölés.
private struct SourceLine: View {
    let section: Section

    var body: some View {
        // a webes `.source-line`: `flex-wrap`, 4 / 12 pt-es térköz
        Flow(hGap: Tokens.Space.s3, vGap: Tokens.Space.s1) {
            if section.verified {
                HStack(spacing: Tokens.Space.s1) {
                    Icon(name: .check, size: 18)
                    Text(t(.sourceVerified)).css(Tokens.Typography.body.size, Tokens.FontWeight.w640, line: 1.25)
                }
                .foregroundStyle(Tokens.Colors.ok)
            }
            // a böngésző a kötőjel után is törhet („2026-/10”): nulla szélességű szóköz
            GreedyText(text: sectionSourceLabel(section).replacingOccurrences(of: "-", with: "-\u{200B}"), font: .inter(Tokens.Typography.body.size, Tokens.FontWeight.w540), lineHeight: 1.25 * Tokens.Typography.body.size)
        }
    }
}
