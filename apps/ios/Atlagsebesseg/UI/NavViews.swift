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

/// Felső állapotsor (a webes `StatusPills`): a GPS-pill, jobbra mellette a kereső-pill (csak az üres nézeten). AOS12: a
/// „Kijelző ébren” pill nincs (a kijelző mérés közben mindig ébren marad); a GPS-pill koppintható (`onGps`): nem
/// eldöntött engedélynél kér, tiltottnál a lapot nyitja. Vezetés közben (`compact`) csak ikon – nincs apró szöveg.
struct StatusPills: View {
    let geo: GeoStatus
    let accuracy: Double?
    var compact = false
    var onGps: (() -> Void)?
    var onSearch: (() -> Void)?
    /// AOS14: a köszöntő felirat az üres nézeten, a kereső-gomb sora alatt (nem a térkép közepén).
    var greeting: String?

    private var gps: (color: Color, text: String) {
        let acc = accuracy.map { Int(jsRound($0)) }
        switch geo {
        case .off: return (Tokens.StatusColors.semleges, t(.pillGpsOff))
        case .searching: return (Tokens.StatusColors.hataron, t(.pillGpsSearching))
        case .active, .sim:
            if let acc, acc > 25 { return (Tokens.StatusColors.hataron, t(.pillGpsAccuracy, ["m": String(acc)])) }
            return (Tokens.StatusColors.jo, acc.map { t(.pillGpsAccuracy, ["m": String($0)]) } ?? t(.pillGpsActive))
        case .denied: return (Tokens.StatusColors.tul, t(.pillGpsDenied))
        case .unavailable: return (Tokens.StatusColors.tul, t(.pillGpsUnavailable))
        case .error: return (Tokens.StatusColors.tul, t(.pillGpsError))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s2) {
            row
            if let greeting {
                Text(greeting)
                    .font(.inter(22, 640))
                    .tracking(-0.01 * 22)
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(1)
                    .padding(.horizontal, Tokens.Space.s4)
                    .padding(.vertical, Tokens.Space.s2)
                    .glass(radius: 22)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
    }

    private var row: some View {
        HStack(alignment: .top, spacing: Tokens.Space.s2) {
            let p = gps
            Button { onGps?() } label: {
                HStack(spacing: Tokens.Space.s2) {
                    Icon(name: .gps, size: 18).foregroundStyle(p.color)
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
                // a látható 36 pt köré 56 pt-es érintési cél
                .frame(minHeight: Tokens.Size.touch)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onGps == nil)
            .padding(.vertical, -10)
            .accessibilityLabel(p.text)
            Spacer(minLength: 0)
            // AW16: a kereső kerek gombja a GPS-pill sorában, a jobb szélre zárva (mint az alsó kerek gombok)
            if let onSearch {
                Button(action: onSearch) { Icon(name: .search, size: 26) }
                    .buttonStyle(RoundButtonStyle())
                    .accessibilityLabel(t(.mapSearch))
            }
        }
    }
}

/// A tiltott helyhozzáférés lapja (AW13, a webes `GeoBlockedSheet` iOS-változata): mi a gond, a bekapcsolás útja, és a
/// „Megnyitás” gomb az app saját beállításaira (Hely › „Az app használata közben”).
struct GeoBlockedSheet: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            Text(t(.geoBlockedTitle)).typeStyle(Tokens.Typography.title).foregroundStyle(Tokens.Colors.text)
            Text(t(.geoBlockedIntro)).font(.inter(Tokens.Typography.caption.size + 2, 520)).foregroundStyle(Tokens.Colors.textMuted)
            ForEach(Array([t(.iosGeoHelp1), t(.iosGeoHelp2)].enumerated()), id: \.offset) { i, step in
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
                    Text(String(i + 1))
                        .font(.num(15, 700))
                        .foregroundStyle(Tokens.Colors.signText)
                        .frame(width: 26, height: 26)
                        .background(Tokens.Colors.text, in: Circle())
                    Text(step).font(.inter(17, 540)).foregroundStyle(Tokens.Colors.text).fixedSize(horizontal: false, vertical: true)
                }
            }
            Button(t(.iosGeoOpen)) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            .buttonStyle(WideButtonStyle(kind: .primary))
        }
        .padding(Tokens.Space.s5)
        .frame(maxWidth: .infinity, alignment: .leading)
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
                TextField(placeholder, text: Binding(get: { model.searchQuery }, set: { model.searchInput($0) }))
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

            // AW12: a mentett címek vékony chip-sora a mező és a találatok között (csak úti cél keresésekor)
            if model.pickFor == .dest, !chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Tokens.Space.s2) {
                        ForEach(chips) { c in
                            Button { model.choose(c.place) } label: {
                                HStack(spacing: 6) {
                                    Icon(name: c.icon == .home ? .home : c.icon == .work ? .work : .pin, size: 18).foregroundStyle(Tokens.Colors.accent)
                                    Text(c.label).font(.inter(Tokens.Typography.caption.size, 600)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                                }
                                .padding(.leading, 11)
                                .padding(.trailing, 14)
                                .frame(height: 36)
                                .frame(maxWidth: UIScreen.main.bounds.width * 0.6)
                                .pillBackground()
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(c.place.address.isEmpty ? c.label : "\(c.label), \(c.place.address)")
                        }
                    }
                    .padding(.horizontal, 2)
                }
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                .accessibilityLabel(t(.navSearchSaved))
            }

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

    private var chips: [SavedChip] { savedChips(model.saved) }

    /// A mező szövege: úti cél, vagy (a Beállításokból) a mentendő hely.
    private var placeholder: String {
        switch model.pickFor {
        case .dest: t(.navSearchPlaceholder)
        case .home: t(.navSearchPickHome)
        case .work: t(.navSearchPickWork)
        case .other: t(.navSearchPickOther)
        }
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
                    // AW18: a „Leggyorsabb” a legkisebb menetidejű (nem a Mapbox 0. indexe)
                    Text(routeTagText(i, model.fastestRoute))
                        // AOS15 (AW18-paritás): mindig accent, 16 / 620, mint a webes `.route-opt-tag`
                        .font(.inter(16, 620))
                        .foregroundStyle(Tokens.Colors.accent)
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

/// Közeli kamera (AW12): „Kamera 270 m · max 130” (határ nélkül csak a távolság).
func cameraNearText(_ view: NavView, _ unit: SpeedUnit) -> String? {
    guard let c = view.cameraNear else { return nil }
    let d = dist(c.distanceM, unit)
    if let x = c.item.limitKmh.flatMap({ speedIn($0, unit) }) { return t(.navCameraNear, ["d": d, "x": String(x)]) }
    return t(.navUpcomingCamera, ["d": d])
}

/// Felső kártya: következő manőver (ikon + távolság + út), alatta a közeledő szakasz és a rákövetkező manőver.
/// Közeli kameránál (AW12) a kártya borostyánra vált, nagy kamera-ikonnal; elhaladás után vissza.
struct NavTopCard: View {
    let view: NavView
    let unit: SpeedUnit
    /// AOS14: a közeledő bejelentés – a kamera-sor helyén és stílusában (a közeli kamera elsőbbséget kap).
    var report: ReportAlertModel?
    /// AW18: „Dugóba kerültél?” válasz (Igen / Nem); `nil`: nincs kérdés-sor.
    var onJamAnswer: ((Bool) -> Void)?
    var jamSending = false
    /// AW18: koppintás a „nem sikerült” kártyára – azonnali újrapróba.
    var onRetry: (() -> Void)?

    var body: some View {
        let arrived = view.phase == .arrived
        let busy = view.rerouting || view.offRoute
        let cam = busy || arrived ? nil : cameraNearText(view, unit)
        // AW18: a dugó-kérdés a közeledő bejelentés előtt (a közeli kamera elsőbbséget kap)
        let jamAsk = cam == nil && !busy && !arrived && view.jamAsk && onJamAnswer != nil
        let rep = cam != nil || busy || jamAsk ? nil : report
        let amber = cam != nil || rep != nil || jamAsk
        let ink = amber ? Tokens.Colors.bg : Tokens.Colors.text
        let failed = !view.rerouting && view.rerouteFailed
        VStack(alignment: .leading, spacing: Tokens.Space.s3) {
            if busy || view.rerouteFailed {
                // AW18: a sikertelen újratervezés kártyája a következő próbáig hátralévő másodperccel; koppintásra azonnal
                Button { onRetry?() } label: {
                    HStack(spacing: Tokens.Space.s3) {
                        // AOS15 (AW18-paritás, a webes `.nav-reroute`): újratervezés közben borostyán, title-méret, forgó ikon;
                        // hibánál piros, 22 pt
                        SpinningIcon(spinning: view.rerouting)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(view.rerouting || !view.rerouteFailed ? t(.navRerouting) : t(.navRerouteFailed))
                                .font(.inter(failed ? 22 : Tokens.Typography.title.size, 620))
                                .lineLimit(2)
                                .minimumScaleFactor(0.8)
                            if failed, let s = view.rerouteRetryInS {
                                Text(t(.navRerouteRetryIn, ["s": String(s)]))
                                    .font(.num(17, 560))
                                    .foregroundStyle(Tokens.Colors.textMuted)
                                    .lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!failed)
                .foregroundStyle(failed ? Tokens.Colors.over : Tokens.Colors.near)
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
            if let cam {
                HStack(spacing: Tokens.Space.s3) {
                    Icon(name: .cam_speed, size: 40)
                    Text(cam).font(.num(Tokens.Typography.title.size, 700)).tracking(-0.3).lineLimit(1).minimumScaleFactor(0.8)
                }
                .padding(.top, 2)
                .accessibilityAddTraits(.updatesFrequently)
            } else if jamAsk, let onJamAnswer {
                JamAskRow(onAnswer: onJamAnswer, sending: jamSending)
            } else if let rep {
                ReportAlertRow(alert: rep, unit: unit)
            } else if let up = upcomingText(view, unit), !arrived {
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
                // „Utána” – ikon + utcanév / rövid manőver-szó (AW12, `thenText`)
                HStack(spacing: Tokens.Space.s2) {
                    Text(t(.navThen)).font(.inter(Tokens.Typography.caption.size, 560)).foregroundStyle(amber ? ink : Tokens.Colors.textMuted)
                    ManeuverGlyph(icon: then.icon, size: 24)
                    Text(then.text).font(.inter(Tokens.Typography.caption.size, 600)).lineLimit(1)
                }
                .foregroundStyle(ink)
            }
        }
        .foregroundStyle(ink)
        .padding(Tokens.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: 28, fill: amber ? Tokens.Colors.near : Tokens.Colors.surfaceStrong)
        .animation(.easeOut(duration: Tokens.Motion.base), value: amber)
        .animation(.easeOut(duration: Tokens.Motion.base), value: rep?.prompt.phase)
        // a kérdés gombjai külön elérhetők maradjanak
        .accessibilityElement(children: rep?.prompt.phase == .ask || jamAsk || failed ? .contain : .combine)
        .accessibilityLabel(view.next.instruction.isEmpty ? t(.navAria) : view.next.instruction)
    }
}

/// Mérés közben a navigációs lépés egysoros sávvá zsugorodik a mérőkártya fölött; közeli kameránál borostyán kamera-sor.
struct NavStrip: View {
    let view: NavView
    let unit: SpeedUnit

    var body: some View {
        if view.phase != .arrived, let cam = cameraNearText(view, unit) {
            HStack(spacing: Tokens.Space.s3) {
                Icon(name: .cam_speed, size: 32)
                Text(cam).font(.num(20, 720)).lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Tokens.Colors.bg)
            .padding(.horizontal, Tokens.Space.s4)
            .frame(height: 56)
            .glass(radius: 22, fill: Tokens.Colors.near)
            .accessibilityElement(children: .combine)
        } else {
            step
        }
    }

    private var step: some View {
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

/// Alsó sáv: pillanatnyi sebesség, érkezés, hátralévő idő és táv, „Befejezés” – AW17: navigáció közben mindig a képernyő
/// alján, a mérőkártya fölötte. Mérés közben sebesség nélkül (`showSpeed`, a mérőkártya „most” mezője mutatja); a km/h
/// piros, ha a bal alsó tábla limitje fölött van (`over`) – csak szín, hang és rezgés nincs.
struct NavBottomBar: View {
    let view: NavView
    let unit: SpeedUnit
    let currentKmh: Double?
    var showSpeed = true
    var over = false
    let onEnd: () -> Void

    /// A sebesség-oszlop szélessége (a dugó-pill ehhez igazodik).
    private let speedColumn: CGFloat = 64

    var body: some View {
        // AOS15 (AW18-paritás): a webes rács 4 px-es sorköze és a kapszula 1 × 10 px-es belső margója
        VStack(alignment: .leading, spacing: 4) {
            // AW18: a friss ETA ≥ 3 perccel az indulási terv után – „+N perc dugó” borostyán kapszula a sáv felső sorában, az
            // érkezési idő oszlopának elejéhez igazítva (390 pt-en a sebesség és a Befejezés mellé nem férne)
            if let d = view.delayMin {
                Text(trafficDelayLabel(d))
                    .font(.inter(17, 650))
                    .foregroundStyle(Tokens.Colors.near)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .padding(.vertical, 1)
                    .background(Tokens.Colors.near.opacity(0.16), in: Capsule())
                    .padding(.leading, showSpeed ? speedColumn + Tokens.Space.s4 : 0)
            }
            row
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(.horizontal, Tokens.Space.s4)
        .padding(.vertical, Tokens.Space.s3)
        .glass(radius: Tokens.Radius.card, fill: Tokens.Colors.surfaceStrong)
    }

    private var row: some View {
        HStack(spacing: Tokens.Space.s4) {
            if showSpeed {
                VStack(spacing: 0) {
                    Text(String(speedIn(currentKmh ?? 0, unit) ?? 0)).font(.num(34, 720))
                        .foregroundStyle(over ? Tokens.Colors.over : Tokens.Colors.text)
                    Text(unitLabel(unit)).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
                }
                .frame(width: speedColumn)
            }
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
    }
}

/// Felugró ajánlat (AW12): „Megéri · −7 perc, +4 km” / „Lehet · −2 perc, +1 km” / „Nem éri meg · +20 km kerülő, −10 perc”,
/// alatta a lehajtó; Elvet / Elfogad (56 pt-es gombok). A kiemelt gomb az, ami 45 s után magától történik; alatta vékony,
/// fogyó csík mutatja a hátralévő időt, szám nélkül (AW13). Mérés közben kompakt: „Kijárat 56 · 2,5 km · −7 perc
/// gyorsabb” (AW17; a kategória a sor színéből látszik). A webes `OfferCard` kinézete.
struct OfferCard: View {
    let offer: AlternativeOffer
    let onAccept: () -> Void
    let onDecline: () -> Void

    /// A „megéri” lejáratkor elfogadódik, a másik kettő elvetődik – a kiemelt gomb ezt mutatja.
    private var acceptByDefault: Bool { offer.verdict == .worth }

    /// A kategória színe: megéri zöld, lehet borostyán, nem éri meg halvány.
    private var tint: Color {
        switch offer.verdict {
        case .worth: Tokens.Colors.ok
        case .maybe: Tokens.Colors.near
        case .not: Tokens.Colors.textMuted
        }
    }

    private var border: Color {
        switch offer.verdict {
        case .worth: Tokens.Colors.ok.opacity(0.55)
        case .maybe: Tokens.Colors.near.opacity(0.55)
        case .not: Tokens.Colors.strokeStrong
        }
    }

    /// A lehajtó sora: „Lehajtó: Kijárat 56 · 5,2 km” / „Lehajtó 5,2 km-nél”; ismeretlen lehajtónál nincs.
    private var exitLine: String? {
        guard offer.exitAlongM != nil else { return nil }
        if let name = offer.exitName, !name.isEmpty { return t(.navOfferExitAtNamed, ["name": name, "km": offer.exitKm]) }
        return t(.navOfferExitAt, ["km": offer.exitKm])
    }

    var body: some View {
        if offer.compact {
            // AW17: „Kijárat 56 · 2,5 km · −7 perc gyorsabb” – keskeny képernyőn tördelve, nem levágva
            let text = altOfferCompactText(title: offer.title, gainS: offer.gainS, exitAlongM: offer.exitAlongM, exitName: offer.exitName, exitKm: offer.exitKm)
            HStack(spacing: Tokens.Space.s2) {
                Text(text).font(.num(Tokens.Typography.caption.size, 650)).foregroundStyle(tint)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                small(t(.navOfferDecline), primary: !acceptByDefault, action: onDecline)
                small(t(.navOfferAccept), primary: acceptByDefault, action: onAccept)
            }
            .padding(.leading, Tokens.Space.s4)
            .padding(.trailing, 10)
            .padding(.vertical, Tokens.Space.s2)
            .glass(radius: 22, fill: Tokens.Colors.surfaceStrong)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(border, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(offer.title)
        } else {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(offer.title).typeStyle(Tokens.Typography.title).foregroundStyle(tint).lineLimit(2).minimumScaleFactor(0.8)
                    if let exitLine {
                        Text(exitLine).font(.num(Tokens.Typography.caption.size, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                    }
                }
                HStack(spacing: Tokens.Space.s3) {
                    Button(t(.navOfferDecline), action: onDecline)
                        .buttonStyle(WideButtonStyle(kind: acceptByDefault ? .plain : .primary))
                        .overlay(alignment: .bottom) { if !acceptByDefault { timer } }
                    Button(t(.navOfferAccept), action: onAccept)
                        .buttonStyle(WideButtonStyle(kind: acceptByDefault ? .primary : .plain))
                        .overlay(alignment: .bottom) { if acceptByDefault { timer } }
                }
                .padding(.bottom, 4)
            }
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.top, 14)
            .padding(.bottom, Tokens.Space.s4)
            .glass(radius: 26, fill: Tokens.Colors.surfaceStrong)
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).strokeBorder(border, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(offer.title)
        }
    }

    /// AW13: a kiemelt (45 s után magától történő) gomb alatt fogyó csík; a nézet másodpercenként frissül, az átmenet simít.
    private var timer: some View {
        Capsule()
            .fill(Tokens.Colors.text.opacity(0.7))
            .frame(height: 3)
            .scaleEffect(x: offer.timeLeft, y: 1, anchor: .leading)
            .animation(.linear(duration: 1), value: offer.timeLeft)
            .padding(.horizontal, 14)
            .offset(y: 7)
            .accessibilityHidden(true)
    }

    private func small(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.inter(16, 620))
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(primary ? Tokens.Colors.signText : Tokens.Colors.text)
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(primary ? Tokens.Colors.text : Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(alignment: .bottom) { if primary { timer.padding(.horizontal, -8).offset(y: -1) } }
    }
}

/// Az újratervezés ikonja – újratervezés közben forog (a webes `.spin`, 1,1 s / fordulat).
private struct SpinningIcon: View {
    let spinning: Bool
    @State private var angle = 0.0

    var body: some View {
        Icon(name: .restart, size: 34)
            .rotationEffect(.degrees(angle))
            .onAppear { spin(spinning) }
            .onChange(of: spinning) { _, on in spin(on) }
    }

    private func spin(_ on: Bool) {
        if on {
            withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { angle = 360 }
        } else {
            withAnimation(.none) { angle = 0 }
        }
    }
}
