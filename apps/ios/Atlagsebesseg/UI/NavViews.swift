import AtlagsebessegCore
import SwiftUI

// A navigáció nézetei (A11) – a webes NavHud.tsx, RoutePicker.tsx, SearchScreen.tsx és StatusPills.tsx megfelelői.

private func dist(_ m: Double, _ unit: SpeedUnit) -> String {
    let d = formatDistance(m, unit)
    return "\(d.value) \(d.unit)"
}

/// A manőver vonalrajza (a webes ManeuverIcon.tsx, stroke 2,2).
struct ManeuverGlyph: View {
    let icon: ManeuverIcon
    var size: CGFloat = 56

    var body: some View {
        let scale = size / 24
        icon.path
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .stroke(style: StrokeStyle(lineWidth: 2.2 * scale, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: állapot-pillek + kereső-pill

/// Felső állapotsor (a webes `StatusPills`): GPS és kijelző; jobbra mellettük a kereső-pill (csak az üres nézeten).
/// Vezetés közben (`compact`) csak ikon – nincs apró szöveg; a szín beszél.
struct StatusPills: View {
    let geo: GeoStatus
    let accuracy: Double?
    let awake: Bool
    var compact = false
    var onSearch: (() -> Void)?

    private struct Pill: Identifiable {
        let id: String
        let color: Color
        let icon: IconName
        let text: String
    }

    private var pills: [Pill] {
        let acc = accuracy.map { Int(jsRound($0)) }
        let gps: Pill
        switch geo {
        case .off: gps = Pill(id: "gps", color: Tokens.StatusColors.semleges, icon: .gps, text: t(.pillGpsOff))
        case .searching: gps = Pill(id: "gps", color: Tokens.StatusColors.hataron, icon: .gps, text: t(.pillGpsSearching))
        case .active, .sim:
            if let acc, acc > 25 {
                gps = Pill(id: "gps", color: Tokens.StatusColors.hataron, icon: .gps, text: t(.pillGpsAccuracy, ["m": String(acc)]))
            } else {
                gps = Pill(id: "gps", color: Tokens.StatusColors.jo, icon: .gps, text: acc.map { t(.pillGpsAccuracy, ["m": String($0)]) } ?? t(.pillGpsActive))
            }
        case .denied: gps = Pill(id: "gps", color: Tokens.StatusColors.tul, icon: .gps, text: t(.pillGpsDenied))
        case .unavailable: gps = Pill(id: "gps", color: Tokens.StatusColors.tul, icon: .gps, text: t(.pillGpsUnavailable))
        case .error: gps = Pill(id: "gps", color: Tokens.StatusColors.tul, icon: .gps, text: t(.pillGpsError))
        }
        let wake = awake
            ? Pill(id: "wake", color: Tokens.StatusColors.jo, icon: .screen, text: t(.pillWakeOn))
            : Pill(id: "wake", color: Tokens.StatusColors.semleges, icon: .screen, text: t(.pillWakeOff))
        return [gps, wake]
    }

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            ForEach(pills) { p in
                HStack(spacing: Tokens.Space.s2) {
                    Icon(name: p.icon, size: 18).foregroundStyle(p.color)
                    if !compact {
                        Text(p.text)
                            .font(.inter(Tokens.Typography.caption.size, 580))
                            .foregroundStyle(Tokens.Colors.textMuted)
                            .lineLimit(1)
                    }
                }
                .padding(.leading, 11)
                .padding(.trailing, compact ? 11 : 13)
                .frame(height: 36)
                .pillBackground()
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(p.text)
            }
            if let onSearch {
                Button(action: onSearch) {
                    Icon(name: .search, size: 20)
                        .foregroundStyle(Tokens.Colors.text)
                        .frame(width: 48, height: 36)
                        .pillBackground()
                        // a látható 36 pt köré 56 pt-es érintési cél (mint a webes `button.pill`)
                        .frame(minWidth: Tokens.Size.touch, minHeight: Tokens.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.vertical, -10)
                .accessibilityLabel(t(.mapSearch))
            }
            Spacer(minLength: 0)
        }
    }
}

private extension View {
    /// A webes `.pill` háttere: sötét, elmosott, 1 px-es éllel.
    func pillBackground() -> some View {
        background(Tokens.Colors.surface, in: Capsule())
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
    }
}

// MARK: kereső (felül, teljes szélességben)

/// A kereső-pillre nyíló, teljes szélességű keresőmező a térkép tetején: billentyűzettel, gépelés közben
/// találatokkal (3 karaktertől, 300 ms késleltetéssel), üresen az utolsó 10 úti céllal.
struct SearchPanel: View {
    @Bindable var model: AppModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: Tokens.Space.s2) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: .search, size: 22).foregroundStyle(Tokens.Colors.textMuted)
                TextField(t(.navSearchPlaceholder), text: Binding(get: { model.searchQuery }, set: { model.searchInput($0) }))
                    .font(.inter(Tokens.Typography.body.size, 560))
                    .foregroundStyle(Tokens.Colors.text)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.words)
                    .onSubmit {
                        if case .ok(let places) = model.searchState, let first = places.first { model.choose(first) }
                    }
                Button { model.closeSearch() } label: {
                    Icon(name: .close, size: 20).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Tokens.Colors.text)
                .accessibilityLabel(t(.commonClose))
            }
            .padding(.leading, Tokens.Space.s4)
            .padding(.trailing, Tokens.Space.s1)
            .frame(height: 56)
            .glass(radius: 22, fill: Tokens.Colors.surfaceStrong)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) { content }
                    .padding(.vertical, Tokens.Space.s2)
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: 420)
            .fixedSize(horizontal: false, vertical: true)
            .glass(radius: 22, fill: Tokens.Colors.surfaceStrong)
        }
        .onAppear { focused = true }
    }

    @ViewBuilder private var content: some View {
        switch model.searchState {
        case .loading: note(t(.navSearchLoading))
        case .error: note(t(.navSearchError), color: Tokens.Colors.over)
        case .ok(let places):
            if places.isEmpty { note(t(.navSearchEmpty)) }
            ForEach(places) { p in row(.pin, p.name, p.address) { model.choose(p) } }
        case .idle:
            let q = model.searchQuery.trimmingCharacters(in: .whitespaces)
            if !q.isEmpty && q.count < NAV_CONFIG.geocodeMinChars {
                note(t(.navSearchHint, ["n": String(NAV_CONFIG.geocodeMinChars)]))
            }
            if let home = model.saved.home { row(.home, t(.navPlaceHome), home.name) { model.choose(home) } }
            if let work = model.saved.work { row(.work, t(.navPlaceWork), work.name) { model.choose(work) } }
            Text(t(.navSearchRecent))
                .font(.inter(Tokens.Typography.caption.size, 600))
                .foregroundStyle(Tokens.Colors.textFaint)
                .padding(.horizontal, Tokens.Space.s4)
                .padding(.top, Tokens.Space.s2)
                .padding(.bottom, Tokens.Space.s1)
            if model.recents.isEmpty { note(t(.navSearchNoRecent)) }
            ForEach(model.recents) { p in row(.pin, p.name, p.address) { model.choose(p) } }
        }
    }

    private func note(_ text: String, color: Color = Tokens.Colors.textMuted) -> some View {
        Text(text)
            .font(.inter(Tokens.Typography.caption.size + 1, 500))
            .foregroundStyle(color)
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.vertical, Tokens.Space.s3)
    }

    private func row(_ icon: IconName, _ name: String, _ address: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: icon, size: 22)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .frame(width: 40, height: 40)
                    .background(Tokens.Colors.surfaceRaised, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(name).font(.inter(17, 620)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                    if !address.isEmpty {
                        Text(address).font(.inter(Tokens.Typography.caption.size, 500)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, Tokens.Space.s4)
            .frame(minHeight: Tokens.Size.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: útvonalválasztó

/// Útvonalválasztó kártya: útvonalanként „X perc · Y km · N kamera · M ellenőrzött”, alatta a szakaszellenőrzések
/// és a dugó; „Indítás”.
struct RoutePickerCard: View {
    @Bindable var model: AppModel
    let plan: PlanState

    private var unit: SpeedUnit { model.settings.egyseg }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            HStack {
                Text(t(.navPickerTitle, ["name": plan.dest.name]))
                    .typeStyle(Tokens.Typography.title)
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: Tokens.Space.s2)
                Button { model.cancelPlan() } label: {
                    Icon(name: .close, size: 20).frame(width: 44, height: 44).background(Tokens.Colors.surfaceRaised, in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Tokens.Colors.text)
                .accessibilityLabel(t(.commonClose))
            }
            if let msg {
                VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                    Text(msg).font(.inter(Tokens.Typography.body.size - 2, 520)).foregroundStyle(Tokens.Colors.textMuted)
                    if plan.status != .loading {
                        Button { model.retryPlan() } label: {
                            HStack { Icon(name: .restart, size: 22); Text(t(.navPickerRetry)) }
                        }
                        .buttonStyle(WideButtonStyle())
                    }
                }
            }
            if plan.status == .ready {
                VStack(spacing: Tokens.Space.s2) {
                    ForEach(Array(plan.routes.enumerated()), id: \.element.id) { i, r in
                        if i < model.summaries.count { option(i, model.summaries[i]) }
                    }
                }
                Button { model.startNav() } label: {
                    HStack(spacing: Tokens.Space.s2) {
                        Icon(name: .play, size: 22)
                        Text(t(.navPickerStart))
                    }
                }
                .buttonStyle(WideButtonStyle(kind: .primary))
            }
        }
        .padding(Tokens.Space.s5)
        .glass(radius: Tokens.Radius.card, fill: Tokens.Colors.surfaceStrong)
    }

    private var msg: String? {
        switch plan.status {
        case .loading: t(.navPickerLoading)
        case .nogps: t(.navPickerNoGps)
        case .ratelimited: t(.navPickerRateLimited)
        case .error: t(.navPickerError)
        case .ready: nil
        }
    }

    private func option(_ i: Int, _ s: RouteSummary) -> some View {
        let selected = plan.selected == i
        let cams = t(.navPickerCameras, ["n": String(s.cameras), "v": String(s.camerasVerified)])
        let delay = s.delayS >= 60 ? t(.navPickerDelay, ["n": String(Int(jsRound(s.delayS / 60)))]) : t(.navPickerNoDelay)
        return Button { model.selectRoute(i) } label: {
            VStack(alignment: .leading, spacing: 6) {
                // „1 ó 26 perc · 121,0 km · / 13 kamera · 3 ellenőrzött” – a „·” határon törve, csonkítás nélkül
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                    (Text(formatTripDuration(s.durationS)).font(.num(24, 700)).foregroundColor(Tokens.Colors.text)
                        + Text(" · " + dist(s.distanceM, unit) + " ·").font(.num(17, 560)).foregroundColor(Tokens.Colors.textMuted))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Spacer(minLength: 0)
                    Text(formatClock(model.nowMs() + s.durationS * 1000)).font(.num(15, 620)).foregroundStyle(Tokens.Colors.textMuted).fixedSize()
                }
                Text(cams).font(.num(17, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s2) {
                    Text(i == 0 ? t(.navPickerFastest) : t(.navPickerAlt, ["n": String(i)]))
                        .font(.inter(14, 650))
                        .foregroundStyle(selected ? Tokens.Colors.accent : Tokens.Colors.textMuted)
                        .fixedSize()
                    (Text(t(.navPickerSections, ["n": String(s.sections)])).foregroundColor(s.sections == 0 ? Tokens.Colors.textFaint : Tokens.Colors.textMuted)
                        + Text(" · ").foregroundColor(Tokens.Colors.textFaint)
                        + Text(delay).foregroundColor(s.delayS >= 60 ? Tokens.Colors.near : Tokens.Colors.textFaint))
                        .font(.inter(14, 540))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.vertical, Tokens.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Tokens.Colors.accent.opacity(0.14) : Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous).strokeBorder(selected ? Tokens.Colors.accent : Tokens.Colors.stroke, lineWidth: selected ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: navigáció közben

/// A közeledő szakasz / kamera / mérés kis jelzése: „Szakaszellenőrzés 2 km · max 110”.
func upcomingText(_ view: NavView, _ unit: SpeedUnit) -> String? {
    guard let u = view.upcoming else { return nil }
    let d = dist(u.distanceM, unit)
    if u.item.kind == .camera { return t(.navUpcomingCamera, ["d": d]) }
    let x = u.item.limitKmh.flatMap { speedIn($0, unit) }.map(String.init) ?? "–"
    return t(u.item.kind == .section ? .navUpcomingSection : .navUpcomingPlanned, ["d": d, "x": x])
}

/// Felső kártya: következő manőver (ikon + távolság + út), alatta a közeledő szakasz és a rákövetkező manőver.
struct NavTopCard: View {
    let view: NavView
    let unit: SpeedUnit

    var body: some View {
        let arrived = view.phase == .arrived
        let busy = view.rerouting || view.offRoute
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if busy || view.rerouteFailed {
                HStack(spacing: Tokens.Space.s3) {
                    Icon(name: .restart, size: 34)
                    Text(view.rerouting || !view.rerouteFailed ? t(.navRerouting) : t(.navRerouteFailed))
                        .font(.inter(Tokens.Typography.body.size, 620))
                        .lineLimit(2)
                }
                .foregroundStyle(!view.rerouting && view.rerouteFailed ? Tokens.Colors.near : Tokens.Colors.text)
            } else if arrived {
                HStack(spacing: Tokens.Space.s4) {
                    ManeuverGlyph(icon: .arrive, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t(.navArrived)).font(.inter(30, 700))
                        Text(view.destination.name).font(.inter(Tokens.Typography.body.size, 560)).foregroundStyle(Tokens.Colors.textMuted)
                    }
                }
            } else {
                HStack(spacing: Tokens.Space.s4) {
                    ManeuverGlyph(icon: view.next.icon, size: 64)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(dist(view.next.distanceM, unit)).font(.num(40, 720)).tracking(-0.8)
                        Text(view.next.text).font(.inter(Tokens.Typography.body.size + 2, 600)).lineLimit(2).minimumScaleFactor(0.8)
                    }
                    Spacer(minLength: 0)
                }
            }
            if let up = upcomingText(view, unit), !arrived {
                HStack(spacing: Tokens.Space.s2) {
                    Icon(name: view.upcoming?.item.kind == .camera ? .cam_speed : .rendorseg, size: 20)
                    Text(up).font(.inter(Tokens.Typography.caption.size + 1, 620)).lineLimit(1)
                }
                .foregroundStyle(view.upcoming?.item.kind == .planned ? Tokens.Colors.planned : Tokens.Colors.near)
                .padding(.horizontal, Tokens.Space.s3)
                .frame(height: 34)
                .background((view.upcoming?.item.kind == .planned ? Tokens.Colors.planned : Tokens.Colors.near).opacity(0.16), in: Capsule())
            }
            if let then = view.then, !arrived, !busy {
                HStack(spacing: Tokens.Space.s2) {
                    Text(t(.navThen)).font(.inter(Tokens.Typography.caption.size, 560)).foregroundStyle(Tokens.Colors.textMuted)
                    ManeuverGlyph(icon: then.icon, size: 24)
                    Text(then.text).font(.inter(Tokens.Typography.caption.size, 600)).lineLimit(1)
                }
                .foregroundStyle(Tokens.Colors.text)
            }
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(Tokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: 28, fill: Tokens.Colors.surfaceStrong)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(view.next.instruction.isEmpty ? t(.navAria) : view.next.instruction)
    }
}

/// Mérés közben a navigációs lépés egysoros sávvá zsugorodik a mérőkártya fölött.
struct NavStrip: View {
    let view: NavView
    let unit: SpeedUnit

    var body: some View {
        HStack(spacing: Tokens.Space.s3) {
            ManeuverGlyph(icon: view.phase == .arrived ? .arrive : view.next.icon, size: 32)
            Text(dist(view.next.distanceM, unit)).font(.num(20, 720))
            Text(view.next.text).font(.inter(17, 580)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            Spacer(minLength: Tokens.Space.s2)
            Text(formatClock(view.etaMs)).font(.num(17, 620)).foregroundStyle(Tokens.Colors.textMuted)
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(.horizontal, Tokens.Space.s4)
        .frame(height: 56)
        .glass(radius: 22, fill: Tokens.Colors.surfaceStrong)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(view.next.instruction.isEmpty ? t(.navAria) : view.next.instruction)
    }
}

/// Alsó sáv: pillanatnyi sebesség, érkezés, hátralévő idő és táv, „Befejezés”.
struct NavBottomBar: View {
    let view: NavView
    let unit: SpeedUnit
    let currentKmh: Double?
    let onEnd: () -> Void

    var body: some View {
        HStack(spacing: Tokens.Space.s4) {
            VStack(spacing: 0) {
                Text(String(speedIn(currentKmh ?? 0, unit) ?? 0)).font(.num(34, 720))
                Text(unitLabel(unit)).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
            }
            .frame(minWidth: 64)
            VStack(alignment: .leading, spacing: 2) {
                Text(formatClock(view.etaMs)).font(.num(28, 720)).accessibilityLabel(t(.navEta))
                Text("\(formatTripDuration(view.remainingS)) · \(dist(view.remainingM, unit))")
                    .font(.num(Tokens.Typography.caption.size + 1, 560))
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .layoutPriority(1)
            Spacer(minLength: 0)
            Button(t(.navEnd), action: onEnd)
                .font(.inter(17, 650))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Color.white)
                .padding(.horizontal, Tokens.Space.s4)
                .frame(height: Tokens.Size.touch)
                .background(Tokens.Colors.over, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s3)
        .glass(radius: Tokens.Radius.card, fill: Tokens.Colors.surfaceStrong)
    }
}

/// „Gyorsabb út: −7 perc” – Elvet / Elfogad (56 pt-es gombok); mérés közben egysoros, a mérőkártya fölött, a lehajtó
/// nevével és távolságával (a webes `OfferCard` kinézete).
struct OfferCard: View {
    let offer: AlternativeOffer
    let onAccept: () -> Void
    let onDecline: () -> Void

    private var minutes: String { String(wholeMinutes(offer.gainS)) }

    var body: some View {
        if offer.compact {
            let title = offer.exitName.map { t(.navOfferExitNamed, ["name": $0, "km": offer.exitKm, "n": minutes]) }
                ?? t(.navOfferExit, ["km": offer.exitKm, "n": minutes])
            HStack(spacing: Tokens.Space.s2) {
                Text(title)
                    .font(.inter(15, 650))
                    .foregroundStyle(Tokens.Colors.ok)
                    .lineLimit(2)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: .infinity, alignment: .leading)
                small(t(.navOfferDecline), primary: false, action: onDecline)
                small(t(.navOfferAccept), primary: true, action: onAccept)
            }
            .padding(.leading, Tokens.Space.s4)
            .padding(.trailing, 10)
            .padding(.vertical, Tokens.Space.s2)
            .glass(radius: 22, fill: Tokens.Colors.surfaceStrong)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Tokens.Colors.ok.opacity(0.55), lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
        } else {
            let title = t(.navOfferTitle, ["n": minutes])
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                Text(title).typeStyle(Tokens.Typography.title).foregroundStyle(Tokens.Colors.ok)
                HStack(spacing: Tokens.Space.s3) {
                    Button(t(.navOfferDecline), action: onDecline).buttonStyle(WideButtonStyle())
                    Button(t(.navOfferAccept), action: onAccept).buttonStyle(WideButtonStyle(kind: .primary))
                }
            }
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.top, 14)
            .padding(.bottom, Tokens.Space.s4)
            .glass(radius: 26, fill: Tokens.Colors.surfaceStrong)
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(Tokens.Colors.ok.opacity(0.55), lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(title)
        }
    }

    private func small(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.inter(16, 620))
            .foregroundStyle(primary ? Tokens.Colors.signText : Tokens.Colors.text)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(primary ? Tokens.Colors.text : Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Az alternatív útvonal címkéje a térképen: „+4 perc” / „−3 perc” a kiválasztotthoz képest (A8d).
func altDeltaText(_ deltaS: Double) -> String {
    let n = Int(jsRound(abs(deltaS) / 60))
    if n == 0 { return t(.navAltSame) }
    return deltaS > 0 ? t(.navAltSlower, ["n": String(n)]) : t(.navAltFaster, ["n": String(n)])
}
