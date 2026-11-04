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
    /// AOS16: nincs szerver-adat (a webes „offline” pill, semleges pont).
    var offline = false
    var onGps: (() -> Void)?
    var onSearch: (() -> Void)?
    /// AOS14: a köszöntő felirat az üres nézeten, a kereső-gomb sora alatt (nem a térkép közepén).
    var greeting: String?
    /// AW19: a futó út halvány állapotsora a köszöntés alatt („Krúzing · 12,4 km · 23 perc”).
    var cruise: String?
    /// A webes rétegsorrend: a pillek a gombsor ALATT (`.pills`), a kereső, a köszöntés és a krúzing-sor fölötte (`z-index`).
    enum Part { case pills, above }
    var part: Part = .above

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
        // a webes abszolút helyek: pillek és kereső `safe + 40`, köszöntés `+ 64 + 8`, krúzing-sor `+ 52`
        ZStack(alignment: .topLeading) {
            if part == .pills {
                row.padding(.top, 40).padding(.trailing, onSearch == nil ? 0 : Tokens.Size.roundButton + Tokens.Space.s2)
            } else {
                // AW16: a kereső kerek gombja a GPS-pill sorában, a jobb szélre zárva (mint az alsó kerek gombok)
                if let onSearch {
                    Button(action: onSearch) { Icon(name: .search, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapSearch))
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.top, 40)
                }
                if let greeting {
                    GreetingPill(text: greeting)
                        .transition(.opacity)
                        .padding(.top, 112)
                }
                if let cruise {
                    Text(cruise)
                        .css(Tokens.FontSize.f15, Tokens.FontWeight.w560, num: true)
                        .foregroundStyle(Tokens.Colors.textMuted)
                        .lineLimit(1)
                        .padding(.horizontal, Tokens.Space.s3)
                        .padding(.vertical, 5)
                        .glass(radius: Tokens.Radius.r999)
                        .opacity(Tokens.Opacity.o85)
                        .allowsHitTesting(false)
                        .accessibilityIdentifier("cruise-status")
                        .transition(.opacity)
                        .padding(.top, 164)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var row: some View {
        // a webes `.pills { flex-wrap: wrap }`
        Flow(hGap: Tokens.Space.s2, vGap: Tokens.Space.s2) {
            let p = gps
            Button { onGps?() } label: {
                StatusPill(icon: .gps, color: p.color, text: p.text, compact: compact)
                    // a látható 36 pt köré 56 pt-es érintési cél
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(onGps == nil)
            .padding(.vertical, -10)
            .accessibilityLabel(p.text)
            // AOS18: a webes „Kijelző ébren” pill, ugyanott (az app a GPS indításától ébren tartja a kijelzőt)
            StatusPill(icon: .screen, color: Tokens.StatusColors.jo, text: t(.pillWakeOn), compact: compact)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(t(.pillWakeOn))
            if offline {
                StatusPill(icon: nil, color: Tokens.StatusColors.semleges, text: t(.pillOffline), compact: compact)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(t(.pillOffline))
            }
        }
    }
}

/// Egy pill (a webes `.pill`): ikon vagy pont + felirat; vezetés közben (`compact`) csak az ikon.
struct StatusPill: View {
    let icon: IconName?
    let color: Color
    let text: String
    var compact = false

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            if let icon {
                Icon(name: icon, size: 18).foregroundStyle(color)
            } else {
                Circle().fill(color).frame(width: 8, height: 8).shadow(color: color, radius: Tokens.Glow.dot)
            }
            if !compact {
                Text(text)
                    .css(Tokens.Typography.caption.size, Tokens.FontWeight.w580)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(.leading, compact ? 10 : 11)
        .padding(.trailing, compact ? 10 : 13)
        .frame(height: 36)
        .pillBackground()
    }
}

/// A köszöntés (a webes `.greeting`).
struct GreetingPill: View {
    let text: String

    var body: some View {
        Text(text)
            .css(Tokens.FontSize.f22, Tokens.FontWeight.w640, tracking: -0.01)
            .foregroundStyle(Tokens.Colors.text)
            .lineLimit(1)
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.vertical, Tokens.Space.s2)
            .glass(radius: Tokens.Radius.r999)
            .allowsHitTesting(false)
    }
}

/// A tiltott helyhozzáférés lapja (AW13, a webes `GeoBlockedSheet` iOS-változata): mi a gond, a bekapcsolás útja, és a
/// „Megnyitás” gomb az app saját beállításaira (Hely › „Az app használata közben”).
struct GeoBlockedSheet: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: Tokens.Space.s4) {
            Text(t(.geoBlockedTitle)).typeStyle(Tokens.Typography.title).foregroundStyle(Tokens.Colors.text)
            Text(t(.geoBlockedIntro)).font(.inter(Tokens.Typography.caption.size + 2, Tokens.FontWeight.w520)).foregroundStyle(Tokens.Colors.textMuted)
            ForEach(Array([t(.iosGeoHelp1), t(.iosGeoHelp2)].enumerated()), id: \.offset) { i, step in
                HStack(alignment: .firstTextBaseline, spacing: Tokens.Space.s3) {
                    Text(String(i + 1))
                        .font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w700))
                        .foregroundStyle(Tokens.Colors.signText)
                        .frame(width: 26, height: 26)
                        .background(Tokens.Colors.text, in: Circle())
                    Text(step).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w540)).foregroundStyle(Tokens.Colors.text).fixedSize(horizontal: false, vertical: true)
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
        background(Tokens.Colors.pillSurface, in: Capsule())
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
                    .font(.inter(Tokens.Typography.body.size, Tokens.FontWeight.w560))
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
            .glass(radius: Tokens.Radius.r22, fill: Tokens.Colors.surfaceStrong)

            // AW12: a mentett címek vékony chip-sora a mező és a találatok között (csak úti cél keresésekor)
            if model.pickFor == .dest, !chips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Tokens.Space.s2) {
                        ForEach(chips) { c in
                            Button { model.choose(c.place) } label: {
                                HStack(spacing: 6) {
                                    Icon(name: c.icon == .home ? .home : c.icon == .work ? .work : .pin, size: 18).foregroundStyle(Tokens.Colors.brand)
                                    Text(c.label).font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w600)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
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
            .glass(radius: Tokens.Radius.r22, fill: Tokens.Colors.surfaceStrong)
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
                .font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w600))
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
            .font(.inter(Tokens.Typography.caption.size + 1, Tokens.FontWeight.w500))
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
                    Text(name).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                    if !address.isEmpty {
                        Text(address).font(.inter(Tokens.Typography.caption.size, Tokens.FontWeight.w500)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
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
            HStack(spacing: Tokens.Space.s3) {
                Text(t(.navPickerTitle, ["name": plan.dest.name]))
                    .css(Tokens.FontSize.f24, Tokens.Typography.title.weight, line: Tokens.Typography.title.lineHeight, tracking: Tokens.Typography.title.tracking)
                    .foregroundStyle(Tokens.Colors.text)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button { model.cancelPlan() } label: {
                    Icon(name: .close, size: 20).frame(width: 48, height: 48).background(Tokens.Colors.fill08, in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Tokens.Colors.textMuted)
                .accessibilityLabel(t(.commonClose))
            }
            if let msg {
                VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                    Text(msg).css(Tokens.Typography.body.size, Tokens.FontWeight.w400).foregroundStyle(plan.status == .error ? Tokens.Colors.over : Tokens.Colors.textMuted)
                    if plan.status != .loading {
                        Button { model.retryPlan() } label: {
                            HStack(spacing: 10) { Icon(name: .restart, size: 22); Text(t(.navPickerRetry)) }
                        }
                        .buttonStyle(WideButtonStyle())
                    }
                }
            }
            if plan.status == .ready {
                // a webes `.picker-list`: legfeljebb a képernyő 38%-a, utána görgethető
                ViewThatFits(in: .vertical) {
                    routes
                    ScrollView { routes }.frame(maxHeight: UIScreen.main.bounds.height * 0.38)
                }
                .frame(maxHeight: UIScreen.main.bounds.height * 0.38)
                .fixedSize(horizontal: false, vertical: true)
                Button { model.startNav() } label: {
                    HStack(spacing: 10) {
                        Icon(name: .play, size: 22)
                        Text(t(.navPickerStart))
                    }
                }
                .buttonStyle(WideButtonStyle(kind: .primary, minHeight: 64, size: 22))
            }
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 16, trailing: 16))
        .glass(radius: Tokens.Radius.card)
    }

    private var routes: some View {
        VStack(spacing: 10) {
            ForEach(Array(plan.routes.enumerated()), id: \.element.id) { i, _ in
                if i < model.summaries.count { option(i, model.summaries[i]) }
            }
        }
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

    /// A webes `.route-opt`: nagy perc, mellette km · idő, „Leggyorsabb” jobbra; alatta a szakaszok, a kamerák és a dugó, „·” nélkül.
    private func option(_ i: Int, _ s: RouteSummary) -> some View {
        let selected = plan.selected == i
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.tile, style: .continuous)
        return Button { model.selectRoute(i) } label: {
            VStack(alignment: .leading, spacing: 6) {
                Flow(hGap: Tokens.Space.s3, vGap: Tokens.Space.s1, baseline: true) {
                    Text(formatTripDuration(s.durationS))
                        .css(Tokens.FontSize.f28, Tokens.FontWeight.w680, tracking: -0.02, num: true)
                        .foregroundStyle(Tokens.Colors.text)
                    Text("\(dist(s.distanceM, unit)) · \(formatClock(model.nowMs() + s.durationS * 1000))")
                        .css(Tokens.FontSize.f18, Tokens.FontWeight.w400, num: true)
                        .foregroundStyle(Tokens.Colors.textMuted)
                    // AW18: a „Leggyorsabb” a legkisebb menetidejű (nem a Mapbox 0. indexe)
                    Text(routeTagText(i, model.fastestRoute))
                        .css(Tokens.FontSize.f16, Tokens.FontWeight.w620)
                        .foregroundStyle(Tokens.Colors.brand)
                        .flowPushRight()
                }
                Flow(hGap: 14, vGap: Tokens.Space.s1) {
                    metaItem(.rendorseg, t(.navPickerSections, ["n": String(s.sections)]), zero: s.sections == 0)
                    metaItem(.cam_speed, t(.navPickerCameras, ["n": String(s.cameras), "v": String(s.camerasVerified)]), zero: s.cameras == 0)
                    Text(s.delayS >= 60 ? t(.navPickerDelay, ["n": String(Int(jsRound(s.delayS / 60)))]) : t(.navPickerNoDelay))
                        .css(Tokens.FontSize.f16, s.delayS >= 60 ? Tokens.FontWeight.w620 : Tokens.FontWeight.w400)
                        .foregroundStyle(s.delayS >= 60 ? Tokens.Colors.near : Tokens.Colors.text)
                }
            }
            // a 2 pt-es keret a dobozhoz adódik (12 / 14 + 2)
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Tokens.Colors.accent.opacity(Tokens.Opacity.o14) : Tokens.Colors.surfaceRaised, in: shape)
            .overlay(shape.strokeBorder(selected ? Tokens.Colors.accent : Tokens.Colors.stroke, lineWidth: 2))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func metaItem(_ icon: IconName, _ text: String, zero: Bool) -> some View {
        HStack(spacing: 6) {
            Icon(name: icon, size: 18)
            Text(text).css(Tokens.FontSize.f16, Tokens.FontWeight.w400).lineLimit(1)
        }
        .foregroundStyle(zero ? Tokens.Colors.textMuted : Tokens.Colors.text)
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
        VStack(alignment: .leading, spacing: 10) {
            if busy || view.rerouteFailed {
                // AW18: a sikertelen újratervezés kártyája a következő próbáig hátralévő másodperccel; koppintásra azonnal
                Button { onRetry?() } label: {
                    HStack(spacing: 14) {
                        // AOS15 (AW18-paritás, a webes `.nav-reroute`): újratervezés közben borostyán, title-méret, forgó ikon;
                        // hibánál piros, 22 pt
                        SpinningIcon(spinning: view.rerouting)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(view.rerouting || !view.rerouteFailed ? t(.navRerouting) : t(.navRerouteFailed))
                                .css(failed ? Tokens.FontSize.f22 : Tokens.Typography.title.size, Tokens.FontWeight.w620)
                                .lineLimit(2)
                            if failed, let s = view.rerouteRetryInS {
                                Text(t(.navRerouteRetryIn, ["s": String(s)]))
                                    .css(Tokens.FontSize.f17, Tokens.FontWeight.w560, num: true)
                                    .foregroundStyle(Tokens.Colors.textMuted)
                                    .lineLimit(2)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 64)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!failed)
                .foregroundStyle(failed ? Tokens.Colors.over : Tokens.Colors.near)
            } else if arrived {
                HStack(spacing: Tokens.Space.s4) {
                    ManeuverGlyph(icon: .arrive, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(t(.navArrived)).css(Tokens.FontSize.f34, Tokens.FontWeight.w700, tracking: -0.02)
                        Text(view.destination.name).css(Tokens.FontSize.f26, Tokens.FontWeight.w600, line: 1.15).lineLimit(2)
                    }
                }
            } else {
                HStack(spacing: Tokens.Space.s4) {
                    ManeuverGlyph(icon: view.next.icon, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(dist(view.next.distanceM, unit)).css(Tokens.FontSize.f46, Tokens.FontWeight.w700, line: 1, tracking: -0.03, num: true)
                        // a webes `-webkit-line-clamp: 2`, mohó tördeléssel
                        GreedyText(text: view.next.text, font: .inter(Tokens.FontSize.f26, Tokens.FontWeight.w600), lineHeight: 1.15 * Tokens.FontSize.f26, color: ink, lines: 2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if let cam {
                VStack(alignment: .leading, spacing: 0) {
                    Rectangle().fill(Tokens.Colors.bg.opacity(Tokens.Opacity.o25)).frame(height: 1)
                    HStack(spacing: 14) {
                        Icon(name: .cam_speed, size: 40)
                        Text(cam).css(Tokens.Typography.title.size, Tokens.FontWeight.w700, line: 1.15, tracking: -0.01, num: true).lineLimit(2)
                    }
                    .padding(.top, 10)
                }
                .accessibilityAddTraits(.updatesFrequently)
            } else if jamAsk, let onJamAnswer {
                JamAskRow(onAnswer: onJamAnswer, sending: jamSending)
            } else if let rep {
                ReportAlertRow(alert: rep, unit: unit)
            } else if let up = upcomingText(view, unit), !arrived {
                // a webes `.nav-badge`
                let kind = view.upcoming?.item.kind
                let tint = kind == .planned ? Tokens.Colors.planned : Tokens.Colors.brand
                HStack(spacing: Tokens.Space.s2) {
                    Icon(name: kind == .camera ? .cam_speed : .rendorseg, size: 22)
                    GreedyText(text: up, font: .inter(Tokens.Typography.body.size, Tokens.FontWeight.w620), lineHeight: 24, color: Tokens.Colors.text, hug: true)
                }
                .foregroundStyle(Tokens.Colors.text)
                .padding(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 14))
                .background(kind == .camera ? Tokens.Colors.surfaceRaised : tint.opacity(kind == .planned ? 0.2 : 0.22), in: Capsule())
                .overlay(Capsule().strokeBorder(kind == .camera ? Tokens.Colors.strokeStrong : tint.opacity(Tokens.Opacity.o55), lineWidth: 1))
            }
            if let then = view.then, !arrived, !busy {
                // „Utána” – ikon + utcanév / rövid manőver-szó (AW12, `thenText`)
                VStack(alignment: .leading, spacing: 0) {
                    Rectangle().fill(amber ? Tokens.Colors.bg.opacity(Tokens.Opacity.o25) : Tokens.Colors.stroke).frame(height: 1)
                    HStack(spacing: 10) {
                        Text(t(.navThen)).css(Tokens.Typography.body.size, Tokens.FontWeight.w400).foregroundStyle(amber ? ink : Tokens.Colors.textMuted)
                        ManeuverGlyph(icon: then.icon, size: 26).foregroundStyle(amber ? ink : Tokens.Colors.textMuted)
                        Text(then.text).css(Tokens.Typography.body.size, Tokens.FontWeight.w580).lineLimit(1).foregroundStyle(ink)
                    }
                    .padding(.top, Tokens.Space.s2)
                }
            }
        }
        .foregroundStyle(ink)
        .padding(.vertical, 14)
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glass(radius: Tokens.Radius.r28, fill: amber ? Tokens.Colors.near : nil)
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
                Text(cam).css(Tokens.Typography.body.size, Tokens.FontWeight.w700, num: true).lineLimit(1)
                Spacer(minLength: 0)
            }
            .foregroundStyle(Tokens.Colors.bg)
            .padding(.horizontal, Tokens.Space.s4)
            .frame(height: Tokens.Size.touch - 2)
            .glass(radius: Tokens.Radius.r20, fill: Tokens.Colors.near)
            .accessibilityElement(children: .combine)
        } else {
            step
        }
    }

    private var step: some View {
        HStack(spacing: Tokens.Space.s3) {
            ManeuverGlyph(icon: view.phase == .arrived ? .arrive : view.next.icon, size: 32)
            Text(dist(view.next.distanceM, unit)).css(Tokens.Typography.body.size, Tokens.FontWeight.w700, num: true).fixedSize()
            Text(view.next.text).css(Tokens.Typography.body.size, Tokens.FontWeight.w580).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text(formatClock(view.etaMs)).css(Tokens.Typography.body.size, Tokens.FontWeight.w400, num: true).foregroundStyle(Tokens.Colors.textMuted).fixedSize()
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(.horizontal, Tokens.Space.s4)
        .frame(height: Tokens.Size.touch - 2)
        .glass(radius: Tokens.Radius.r20)
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

    @State private var speedColumn: CGFloat = 70

    var body: some View {
        // a webes `.card.compact.nav-bottom`: fénycsíkkal; AOS15 (AW18-paritás): a rács 4 px-es sorköze és a kapszula 1 × 10 px-es belső margója
        CompactCard(tone: .kezi, label: t(.navAria)) {
            VStack(alignment: .leading, spacing: 4) {
                // AW18: a friss ETA ≥ 3 perccel az indulási terv után – „+N perc dugó” borostyán kapszula a sáv felső sorában, az
                // érkezési idő oszlopának elejéhez igazítva (390 pt-en a sebesség és a Befejezés mellé nem férne)
                if let d = view.delayMin {
                    Text(trafficDelayLabel(d))
                        .css(Tokens.FontSize.f17, Tokens.FontWeight.w650, line: 1.3, num: true)
                        .foregroundStyle(Tokens.Colors.near)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .padding(.vertical, 1)
                        .background(Tokens.Colors.near.opacity(Tokens.Opacity.o16), in: Capsule())
                        .padding(.leading, showSpeed ? speedColumn + 10 : 0)
                }
                row
            }
            .foregroundStyle(Tokens.Colors.text)
        }
    }

    private var row: some View {
        HStack(spacing: 10) {
            if showSpeed {
                VStack(alignment: .leading, spacing: 0) {
                    Text(String(speedIn(currentKmh ?? 0, unit) ?? 0))
                        .css(Tokens.Typography.title.size, Tokens.FontWeight.w700, tracking: Tokens.Typography.title.tracking, num: true)
                        .lineLimit(1)
                        .foregroundStyle(over ? Tokens.Colors.over : Tokens.Colors.text)
                    Text(unitLabel(unit)).css(Tokens.FontSize.f16, Tokens.FontWeight.w560).foregroundStyle(Tokens.Colors.textMuted)
                }
                .fixedSize()
                .frame(minWidth: 70, alignment: .leading)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { speedColumn = $0 }
            }
            VStack(alignment: .leading, spacing: 0) {
                Text(formatClock(view.etaMs)).css(Tokens.FontSize.f28, Tokens.FontWeight.w700, line: 1.2, num: true).accessibilityLabel(t(.navEta))
                Text("\(formatTripDuration(view.remainingS)) · \(dist(view.remainingM, unit))")
                    .css(Tokens.FontSize.f17, Tokens.FontWeight.w400, line: 1.2, num: true)
                    .foregroundStyle(Tokens.Colors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(t(.navEnd), action: onEnd)
                .css(Tokens.Typography.body.size, Tokens.FontWeight.w620)
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(Tokens.Colors.signFace)
                .padding(.horizontal, 14)
                .frame(height: Tokens.Size.touch)
                .background(Tokens.Colors.over, in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
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
        case .worth: Tokens.Colors.ok.opacity(Tokens.Opacity.o55)
        case .maybe: Tokens.Colors.near.opacity(Tokens.Opacity.o55)
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
            // AW17: „Kijárat 56 · 2,5 km · −7 perc gyorsabb” – keskeny képernyőn tördelve, nem levágva; ha a cím a gombok mellett nem kapna
            // 120 pt-et, a gombok alá kerülnek és kitöltik a sort (a webes `.nav-offer-compact`, AOS17-javítás)
            let text = altOfferCompactText(title: offer.title, gainS: offer.gainS, exitAlongM: offer.exitAlongM, exitName: offer.exitName, exitKm: offer.exitKm)
            let title = Text(text).css(Tokens.Typography.caption.size, Tokens.Typography.title.weight, line: 1.25, tracking: Tokens.Typography.title.tracking, num: true).foregroundStyle(tint).fixedSize(horizontal: false, vertical: true)
            OfferCompactLayout(gap: Tokens.Space.s2) {
                title
                GrowRow(gap: Tokens.Space.s2) {
                    small(t(.navOfferDecline), primary: !acceptByDefault, action: onDecline)
                    small(t(.navOfferAccept), primary: acceptByDefault, action: onAccept)
                }
            }
            .padding(.leading, Tokens.Space.s4)
            .padding(.trailing, 10)
            .padding(.vertical, Tokens.Space.s2)
            .glass(radius: Tokens.Radius.r22)
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.r22, style: .continuous).strokeBorder(border, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(offer.title)
        } else {
            VStack(alignment: .leading, spacing: Tokens.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(offer.title).typeStyle(Tokens.Typography.title).foregroundStyle(tint).lineLimit(2)
                    if let exitLine {
                        Text(exitLine).css(Tokens.Typography.caption.size, Tokens.FontWeight.w400, num: true).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                    }
                }
                HStack(spacing: 10) {
                    Button(t(.navOfferDecline), action: onDecline)
                        .buttonStyle(WideButtonStyle(kind: acceptByDefault ? .plain : .primary, minHeight: Tokens.Size.touch))
                        .overlay(alignment: .bottom) { if !acceptByDefault { timer } }
                    Button(t(.navOfferAccept), action: onAccept)
                        .buttonStyle(WideButtonStyle(kind: acceptByDefault ? .primary : .plain, minHeight: Tokens.Size.touch))
                        .overlay(alignment: .bottom) { if acceptByDefault { timer } }
                }
            }
            .padding(.horizontal, Tokens.Space.s4)
            .padding(.top, 14)
            .padding(.bottom, Tokens.Space.s4)
            .glass(radius: Tokens.Radius.r26)
            .overlay(RoundedRectangle(cornerRadius: Tokens.Radius.r26, style: .continuous).strokeBorder(border, lineWidth: 1))
            .accessibilityElement(children: .contain)
            .accessibilityLabel(offer.title)
        }
    }

    /// AW13: a kiemelt (45 s után magától történő) gomb alatt fogyó csík; a nézet másodpercenként frissül, az átmenet simít.
    private var timer: some View {
        Capsule()
            .fill(Tokens.Colors.text.opacity(Tokens.Opacity.o70))
            .frame(height: 3)
            .scaleEffect(x: offer.timeLeft, y: 1, anchor: .leading)
            .animation(.linear(duration: 1), value: offer.timeLeft)
            .padding(.horizontal, 14)
            .offset(y: 6)
            .accessibilityHidden(true)
    }

    private func small(_ title: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .css(Tokens.Typography.body.size, Tokens.FontWeight.w620)
            .lineLimit(1)
            .fixedSize()
            .foregroundStyle(primary ? Tokens.Colors.signText : Tokens.Colors.text)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .frame(height: Tokens.Size.touch)
            .background(primary ? Tokens.Colors.text : Tokens.Colors.fill10, in: RoundedRectangle(cornerRadius: Tokens.Radius.r18, style: .continuous))
            .overlay(alignment: .bottom) { if primary { timer } }
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
