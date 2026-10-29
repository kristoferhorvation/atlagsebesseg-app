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
    /// AW15: navigáció közben a kézi mérés teljes kártyája bökésre pillé zsugorodik (a Leállítás gomb kivételével).
    var onCollapseManual: (() -> Void)?

    @Environment(\.horizontalSizeClass) private var sizeClass

    private var unit: SpeedUnit { settings.egyseg }
    private var u: String { unitLabel(unit) }

    var body: some View {
        let tone = toneOf(view)
        switch view.phase {
        case .meres: measuring(tone)
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
            HStack(alignment: .center, spacing: 14) {
                VStack(spacing: Tokens.Space.s2) {
                    LimitSign(kmh: s.speedLimitKmh, unit: unit, small: true)
                    if settings.hatosagiTuresMegjelenitese {
                        Text(t(.hudTolerance, ["x": speedFloorIn(limitWithToleranceKmh(s.speedLimitKmh), unit).map(String.init) ?? ""]))
                            .font(.num(Tokens.Typography.body.size, 600))
                            .foregroundStyle(Tokens.Colors.textMuted)
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                // az állapot nem változik: a „most” önállóan jelzi, ha a pillanatnyi sebesség a határ felett van
                MeterFigure(label: t(.hudNow), value: speedIn(view.currentKmh, unit), over: (view.currentKmh ?? 0) > s.speedLimitKmh)
                Text("·")
                    .font(.inter(32, 600))
                    .foregroundStyle(Tokens.Colors.textFaint)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 6)
                    .accessibilityHidden(true)
                MeterFigure(label: t(.hudExpected), value: speedIn(live.projectedKmh, unit), over: false)
                Spacer(minLength: 0)
            }
            .fixedSize(horizontal: false, vertical: true)
            ProgressRow(value: view.progress ?? 0, label: dist(live.remainingM), tone: tone)
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
                    HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                        Text(d?.value ?? "–")
                            .font(.num(Tokens.Typography.display.size, Tokens.Typography.display.weight))
                            .tracking(Tokens.Typography.display.trackingPt)
                        if let d {
                            Text(t(.hudAhead, ["u": d.unit]))
                                .font(.inter(Tokens.Typography.body.size, 560))
                                .foregroundStyle(Tokens.Colors.textMuted)
                        }
                    }
                    Text([s.road, s.direction].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? t(.hudApproachDefault))
                        .typeStyle(Tokens.Typography.body)
                        .foregroundStyle(Tokens.Colors.textMuted)
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
        return HStack(spacing: Tokens.Space.s4) {
            Text(speedIn(r.averageKmh, unit).map(String.init) ?? "–")
                .font(.num(Tokens.Typography.title.size, 700))
                .tracking(Tokens.Typography.title.trackingPt)
                .foregroundStyle(tone.color)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(t(.hudDoneFinal, ["u": u]))
                    .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
                HStack(spacing: 6) {
                    Icon(name: status.icon, size: 16)
                    Text(r.overLimit ? t(.hudDoneOver, ["x": String(diff), "u": u]) : t(.hudDoneUnder))
                        .font(.inter(Tokens.Typography.caption.size, 620))
                }
                .foregroundStyle(tone.color)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            Button(t(.commonDone), action: onDismiss)
                .font(.inter(16, 620))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Tokens.Colors.text)
                .padding(.horizontal, Tokens.Space.s4)
                .frame(height: 48)
                .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .frame(minHeight: 48)
        .padding(.vertical, Tokens.Space.s3)
        .padding(.horizontal, Tokens.Space.s5)
        .background(CardBackground(tone: tone, glow: 0.1))
        // a státusz-tónus fénye a kártyán túlnyúlna (mint a nagy kártyánál, vágjuk)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .glass(radius: 24)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t(.hudDoneAria))
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
                    .font(.num(Tokens.Typography.title.size, Tokens.Typography.title.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            Hero(value: speedIn(m.averageKmh, unit), tone: tone)
            HStack {
                Text(t(.hudAvg, ["u": u]))
                    .typeStyle(Tokens.Typography.body)
                    .foregroundStyle(Tokens.Colors.textMuted)
                Spacer(minLength: 0)
                Text(dist(m.distanceM)).font(.num(Tokens.Typography.body.size, Tokens.Typography.body.weight))
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
        return HStack(spacing: Tokens.Space.s4) {
            Text(speedIn(r.averageKmh, unit).map(String.init) ?? "–")
                .font(.num(Tokens.Typography.title.size, 700))
                .tracking(Tokens.Typography.title.trackingPt)
                .foregroundStyle(tone.color)
                .fixedSize()
            VStack(alignment: .leading, spacing: 2) {
                Text(t(.hudAvg, ["u": u]))
                    .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                    .foregroundStyle(Tokens.Colors.textMuted)
                HStack(spacing: 6) {
                    Icon(name: .stopwatch, size: 16)
                    Text("\(dist(r.distanceM)) · \(formatDuration(r.elapsedMs))")
                        .font(.num(Tokens.Typography.caption.size, 620))
                }
                .foregroundStyle(tone.color)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
            Button(t(.commonDone), action: onDismiss)
                .font(.inter(16, 620))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Tokens.Colors.text)
                .padding(.horizontal, Tokens.Space.s4)
                .frame(height: 48)
                .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .frame(minHeight: 48)
        .padding(.vertical, Tokens.Space.s3)
        .padding(.horizontal, Tokens.Space.s5)
        .background(CardBackground(tone: tone, glow: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .glass(radius: 24)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(t(.hudManualDoneAria))
    }

    /// Kompakt alapállapot: egy sor, hogy a térkép lássa a képernyő ~80%-át.
    private func idle(_ tone: Tone) -> some View {
        HStack(spacing: Tokens.Space.s4) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(gpsReady ? String(speedIn(view.currentKmh ?? 0, unit) ?? 0) : "–")
                    .font(.num(Tokens.Typography.title.size, 700))
                    .tracking(Tokens.Typography.title.trackingPt)
                Text(u)
                    .font(.inter(Tokens.Typography.body.size, 560))
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            .fixedSize()
            Text(gpsReady ? t(.hudNoneNear) : t(.hudNoneWaiting))
                .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                .foregroundStyle(Tokens.Colors.textMuted)
                .lineSpacing(0)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 48)
        .padding(.vertical, Tokens.Space.s3)
        .padding(.horizontal, Tokens.Space.s5)
        .background(CardBackground(tone: tone, glow: 0.1))
        .glass(radius: 24)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(t(.hudNoneAria))
    }

    private func dist(_ m: Double) -> String {
        let d = formatDistance(m, unit)
        return "\(d.value) \(d.unit)"
    }
}

// MARK: elemek

/// AW15: navigáció közben a kézi mérés kis pillje a gombsor jobb oldalán – átlag + eltelt idő, Leállítás nélkül;
/// bökésre a teljes kártya nyílik.
struct ManualPill: View {
    let view: SessionView
    let unit: SpeedUnit
    let onExpand: () -> Void

    var body: some View {
        let m = view.manual
        Button(action: onExpand) {
            HStack(spacing: 10) {
                Icon(name: .stopwatch, size: 22).foregroundStyle(Tone.kezi.color)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(speedIn(m?.averageKmh, unit).map(String.init) ?? "–")
                        .font(.num(26, 700))
                        .foregroundStyle(Tone.kezi.color)
                    Text(unitLabel(unit))
                        .font(.inter(Tokens.Typography.caption.size, 560))
                        .foregroundStyle(Tokens.Colors.textMuted)
                }
                Text(formatDuration(m?.elapsedMs ?? 0))
                    .font(.num(Tokens.Typography.body.size, 600))
                    .foregroundStyle(Tokens.Colors.textMuted)
            }
            .lineLimit(1)
            .fixedSize()
            .padding(.leading, 14)
            .padding(.trailing, 18)
            .frame(height: Tokens.Size.roundButton)
            .glass(radius: Tokens.Size.roundButton / 2)
            .overlay(Capsule().strokeBorder(Tone.kezi.color.opacity(0.55), lineWidth: 1))
            .contentShape(Capsule())
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

/// A kártya háttere: a tónus fényíve felül, a státusznál 9%-os árnyalat, és a felső fénycsík.
struct CardBackground: View {
    let tone: Tone
    var glow: Double = 0.2

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .top) {
                if tone.isStatus { tone.color.opacity(0.09) }
                RadialGradient(colors: [tone.color, .clear], center: .center, startRadius: 0, endRadius: geo.size.width * 0.8)
                    .frame(width: geo.size.width * 1.6, height: geo.size.height * 1.3)
                    .offset(y: -geo.size.height * 0.6)
                    .opacity(glow)
                LinearGradient(colors: [.clear, tone.color, .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(height: 1.5)
                    .padding(.horizontal, 28)
                    .opacity(0.9)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .top)
        }
        .allowsHitTesting(false)
        .animation(.easeInOut(duration: Tokens.Motion.slow), value: tone)
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
            .background(CardBackground(tone: tone))
            .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.card, style: .continuous))
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
            .shadow(color: tone.color.opacity(0.35), radius: 20)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.inter(Tokens.Typography.body.size, Tokens.Typography.body.weight))
                .foregroundStyle(Tokens.Colors.textMuted)
            Text(value.map(String.init) ?? "–")
                .font(.num(44, 700))
                .tracking(-0.03 * 44)
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
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.09))
                    Capsule()
                        .fill(tone.color)
                        .shadow(color: tone.color, radius: 9)
                        .frame(width: geo.size.width * value)
                        .animation(.linear(duration: Tokens.Motion.data), value: value)
                }
            }
            .frame(height: Tokens.Size.progress)
            .accessibilityElement()
            .accessibilityValue("\(Int(jsRound(value * 100)))%")
            Text(label)
                .font(.num(Tokens.Typography.body.size, 620))
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
        .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// A szakasz forrása és (ha hivatalos listán ellenőrzött) a jelölés.
private struct SourceLine: View {
    let section: Section

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
            if section.verified {
                HStack(spacing: Tokens.Space.s1) {
                    Icon(name: .check, size: 18)
                    Text(t(.sourceVerified)).font(.inter(Tokens.Typography.body.size, 640))
                }
                .foregroundStyle(Tokens.Colors.ok)
            }
            Text(sectionSourceLabel(section))
                .font(.inter(Tokens.Typography.body.size, 540))
                .foregroundStyle(Tokens.Colors.textMuted)
        }
    }
}
