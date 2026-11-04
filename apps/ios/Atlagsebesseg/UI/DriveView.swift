import SwiftUI

/// Vezetés közbeni nézet: térkép a háttérben, alul a mérőkártya, fölötte a „Lassíts” sáv és a gombok; felül az
/// állapot-pillek (mellettük a kereső-pill), a tervezett mérés sávja és a jelzések (kamera, szakaszkapu) sávja.
/// Navigációban (A11) felül a lépés-kártya, alul az érkezés-sáv; mérés közben a mérőkártya marad a fő elem, a
/// navigációs lépés egysoros sávként fölötte. A kereső-pill a térkép tetején nyit teljes szélességű keresőmezőt.
/// AOS13: az alsó kártya-csoport soha nem ér a felső lépés-kártya alá – ha a teljes kártya nem fér ki (pl. a mérés
/// utáni eredménykártya mellett), a lépés ugyanúgy egysoros sáv lesz, mint mérés közben (`navStepStrip`).
/// AW15: navigáció közben a kézi mérés kártyája 5 s után (vagy ha a navigációnak hely kell) kis pillé zsugorodik a gombsor
/// jobb oldalán; ilyenkor a navigáció úgy látszik, mint mérés nélkül (teljes felső kártya, alsó sáv).
struct DriveView: View {
    @Bindable var model: AppModel
    /// `-settingsOpen language` (AW15): a Beállítások nyitva, a nyelvválasztónál (a képernyőképhez).
    @State private var settingsOpen = UserDefaults.standard.string(forKey: "settingsOpen") != nil
    /// AW20-javítás, AOS18: zónasugár váltásakor a lap 6 s-ra 38%-ra húzódik (a webes `peek`), hogy a zóna-kör a térképen látsszon; a görgetési pozíció marad.
    @State private var zonePeek = UserDefaults.standard.string(forKey: "settingsDetent") == "medium"
    @State private var hudFloatH: CGFloat = 0
    /// A teljes felső lépés-kártya alja (globális, pont) – sáv-módban is mérve, a rejtett kártyán.
    @State private var navCardBottom: CGFloat?
    /// Az alsó kártya-csoport teteje a navigációs sáv NÉLKÜL (a sáv megjelenése így nem kapcsolja vissza a kártyát).
    @State private var hudTopNoStrip: CGFloat?
    @State private var stripH: CGFloat = 56

    private var view: SessionView { model.view }
    private var measuring: Bool { [.meres, .kezi].contains(view.phase) }
    private var driving: Bool { [.meres, .kozeledik, .kezi].contains(view.phase) }
    /// Az elrendezés szerinti mérés: a pillé zsugorodott kézi mérés nem foglalja a helyet (AW15).
    private var measuringLayout: Bool { measuring && !model.manualPillCollapsed }
    /// AW17: navigáció közben az alsó sáv MINDIG a képernyő alján; a mérőkártya (és minden más kártya) fölötte, soha nem
    /// alatta és nem helyette. Szakasz nélkül (vagy a zsugorított kézi mérésnél) csak a sáv látszik, kártya nélkül.
    private var hudCardHidden: Bool { model.nav != nil && (view.phase == .nincsSzakasz || model.manualPillCollapsed) }
    /// Navigáció közben a kézi mérés teljes kártyája bökésre zsugorodik (AW15).
    private var collapseManual: (() -> Void)? {
        guard model.manualPill != nil else { return nil }
        return { [model] in model.tapManualPill() }
    }
    private var unit: SpeedUnit { model.settings.egyseg }
    /// A bal alsó sebességhatár-tábla navigációban, amikor a mérőkártya saját táblája nem látszik (mint a weben).
    private var navSign: Bool {
        model.nav != nil && ([.nincsSzakasz, .befejezve, .megszakadt, .keziEredmeny].contains(view.phase) || model.manualPillCollapsed)
    }
    /// Egysoros navigációs sáv a mérőkártya fölött a teljes felső kártya helyett (mérés közben mindig).
    private var stepStrip: Bool {
        navStepStrip(NavStepLayout(
            measuring: measuringLayout,
            cardBottom: navCardBottom.map(Double.init),
            bottomTop: hudTopNoStrip.map(Double.init),
            gap: Double(Tokens.Space.s3)
        ))
    }
    private var stripShown: Bool { model.nav != nil && stepStrip }

    var body: some View {
        ZStack(alignment: .bottom) {
            if Parity.on {
                Tokens.Colors.parityBackdrop.ignoresSafeArea()
            } else {
                MapScreen(model: model, follow: $model.follow)
            }
            // a webes `.scrim-top` / `.scrim-bottom` (kompakt kártyánál az alsó kisebb)
            ScrimTop()
            ScrimBottom(compact: compactCard)
                .ignoresSafeArea()
            if !model.destSearchOpen {
                statusPills(.pills).padding(.top, simTop).padding(.horizontal, Tokens.Space.s3)
                    .frame(maxHeight: .infinity, alignment: .top)
            }

            if model.sim != nil && model.simPanel {
                VStack { SimPanel(model: model); Spacer() }.padding(.horizontal, Tokens.Space.s3)
            }
            // a webes `.hud { bottom: 0 }`: alulra zárva, ha nem fér ki, felfelé lóg (SE) – a `VStack` + `Spacer` középre tolná, és az alja levágódna
            Color.clear.overlay(alignment: .bottom) {
                Group {
                    if !model.destSearchOpen {
                        if let plan = model.plan {
                            RoutePickerCard(model: model, plan: plan)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        } else {
                            // a záradék az ehhez az elrendezéshez tartozó sáv-állapotot látja (nem a következő renderét)
                            let strip = stripShown, stripSpace = stripH + Tokens.Space.s3, floatSpace = hudFloatH > 0 ? hudFloatH + Tokens.Space.s3 : 0
                            VStack(spacing: Tokens.Space.s3) { hud }
                                // a webes `.slowdown` és `.hud-float`: a HUD fölött lebegnek, a magasságát nem növelik (a gombsor a kártya fölött 12 pt-re marad)
                                .overlay(alignment: .top) { floats }
                                .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: {
                                    model.hudTop = $0
                                    hudTopNoStrip = $0 - floatSpace + (strip ? stripSpace : 0)
                                }
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.bottom, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.plan?.status == .ready)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.manualPillCollapsed)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.shownReport?.id)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.shownCamera?.id)
        }
        // külön, felülre igazított réteg: a magas kártya sem tolja fel (a Mapbox-logó és az attribúció látszik)
        .overlay(alignment: .top) { top }
        // a webes `.sheet-backdrop { backdrop-filter: blur(3px) }` (a zóna megmutatásakor nincs)
        .blur(radius: (settingsOpen && !zonePeek) || model.reportSheetOpen ? Tokens.Blur.backdrop / 2 : 0)
        .overlay {
            if settingsOpen {
                SettingsSheet(model: model, peek: zonePeek, onPeekEnd: { zonePeek = false }, onClose: { settingsOpen = false })
                    .zIndex(2)
            }
        }
        .overlay {
            if model.reportSheetOpen {
                AppSheet(onClose: { model.reportSheetOpen = false }) {
                    ReportSheet(fix: view.lastFix, online: model.backend.configured, sending: model.reportSending, gateStarted: model.gateStarted, onPick: { [model] c, sub, fix in model.sendReport(c, subtype: sub, fix: fix) }, onClose: { model.reportSheetOpen = false })
                }
                .zIndex(2)
            }
        }
        .animation(.easeOut(duration: Tokens.Motion.base), value: settingsOpen)
        .animation(.easeOut(duration: Tokens.Motion.base), value: model.reportSheetOpen)
        .environment(\.strongGlass, strongGlassFor(model.settings.terkep, mapLightPreset(model.settings.terkep, lightPresetAt(model.lightNowMs(), view.lastFix))))
        .sheet(isPresented: $model.geoHelpOpen) {
            GeoBlockedSheet()
                .presentationDetents([.medium])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
        // AOS15: a Live Activity koppintása a Beállításokat is bezárja (a vezetési nézet látszik)
        .onChange(of: model.liveLinkSeq) { settingsOpen = false }
        // AW20-javítás: a zóna-körök látszanak, amíg a Beállítások (és a Részletek lap) nyitva van; sugárváltáskor a lap lejjebb húzódik
        .onChange(of: settingsOpen) { _, open in
            model.zonesVisible = open
            if !open { zonePeek = false }
        }
        .onChange(of: model.zoneFocusSeq) { zonePeek = true }
        .task(id: zonePeek ? model.zoneFocusSeq : -1) {
            guard zonePeek else { return }
            try? await Task.sleep(for: .seconds(6))
            if !Task.isCancelled { zonePeek = false }
        }
        // AOS16: közösségi módban a réteg megjelenésekor és módváltáskor is lekérés (nem csak a következő kamera-mozdulatnál)
        .onChange(of: model.heatVisible) { model.fetchHeatGlobal() }
        .onChange(of: model.settings.hoterkep) { model.fetchHeatGlobal() }
        .onAppear { model.zonesVisible = settingsOpen }
    }

    /// A webes `.app:has(.card.compact)`: az egysoros alapkártya vagy az érkezés-sáv (az is `.card.compact`) mellett az alsó sötétítés kisebb; a rejtett HUD
    /// az útvonalválasztó alatt is számít.
    private var compactCard: Bool { model.nav != nil || view.phase == .nincsSzakasz }

    /// A felső réteg a webes abszolút helyekkel (a biztonsági zónához képest): pillek + 40, felső kártya + 84, önálló bejelentés + 112, hőtérkép-váltó + 202,
    /// tervezett mérés + 96 (kompakt 92, felső kártya mellett 262), toast + 88.
    private var top: some View {
        ZStack(alignment: .top) {
            if model.destSearchOpen {
                SearchPanel(model: model)
                    .padding(.top, Tokens.Space.s10 + Tokens.Space.s1)
                    .transition(.opacity.combined(with: .offset(y: -12)))
            } else {
                statusPills(.above)
                // AW20: hőtérkép-mód (Gyakoriság | Átlagsebesség) és jelmagyarázat – a krúzing-sor alatt, csak kész rétegnél (mint a weben)
                if model.heatReady {
                    HeatSwitch(model: model)
                        .padding(.top, 202)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
                if let nav = model.nav, !measuringLayout {
                    // sáv-módban is elrendezve (nulla magasságú keretben, rejtve), hogy a teljes kártya alja mérhető
                    // maradjon: ebből dől el, mikor fér ki újra. A rejtett kártyán is ott a bejelentés és a dugó-kérdés
                    // (mint a weben), különben a mért magasság kisebb, a kártya visszajönne, és a sor nem férne ki.
                    NavTopCard(view: nav, unit: unit, report: alert, onJamAnswer: jamAnswer, jamSending: model.reportSending != nil, onRetry: retry)
                        .fixedSize(horizontal: false, vertical: true)
                        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { navCardBottom = $0 }
                        .opacity(stepStrip ? 0 : 1)
                        .frame(height: stepStrip ? 0 : nil, alignment: .top)
                        .allowsHitTesting(!stepStrip)
                        .accessibilityHidden(stepStrip)
                        .padding(.top, 84)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
                // AOS14: navigáció nélkül (vagy ha a felső kártya nem látszik) a közeledő bejelentés kártyája önállóan, ugyanott
                // AW18: ha a felső kártya nem látszik (sáv-mód / mérés), a „Dugóba kerültél?” önálló borostyán kártyán, ugyanott
                if standaloneJamAsk {
                    JamAskCard(onAnswer: jamAnswer, sending: model.reportSending != nil)
                        .padding(.top, 112)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                } else if let alert, !(model.nav != nil && !measuringLayout && !stepStrip) {
                    ReportAlertCard(alert: alert, unit: unit)
                        .padding(.top, 112)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
                VStack(spacing: Tokens.Space.s2) {
                    if let p = model.activePlanned {
                        PlannedBand(check: p, compact: measuring, unit: unit)
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    }
                    // csak iOS-en van (A10): a paritás-kép a webes elrendezést méri
                    if let a = model.alert, !Parity.on {
                        AlertBanner(event: a)
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    }
                }
                .padding(.top, model.nav != nil && !measuringLayout && !stepStrip ? 262 : measuring ? 92 : 96)
                .allowsHitTesting(false)
                if let toast = model.toast {
                    ToastView(toast: toast)
                        .padding(.top, 88)
                        .allowsHitTesting(false)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
            }
        }
        .padding(.top, simTop)
        .padding(.horizontal, Tokens.Space.s3)
        .animation(.easeOut(duration: Tokens.Motion.slow), value: model.activePlanned?.id)
        .animation(.easeOut(duration: Tokens.Motion.base), value: model.alert)
        .animation(.easeOut(duration: Tokens.Motion.base), value: model.toast)
        .animation(.easeOut(duration: Tokens.Motion.base), value: model.reportPromptState?.id)
        .animation(.easeOut(duration: Tokens.Motion.base), value: model.destSearchOpen)
        .animation(.easeOut(duration: Tokens.Motion.base), value: measuringLayout)
        .animation(.easeOut(duration: Tokens.Motion.base), value: stepStrip)
    }

    /// A szimulátor-panel a felső réteget lejjebb tolja.
    private var simTop: CGFloat { model.sim != nil && model.simPanel ? 56 : 0 }

    private func statusPills(_ part: StatusPills.Part) -> some View {
        StatusPills(
            geo: model.geo,
            accuracy: view.lastFix?.accuracy,
            compact: driving || model.nav != nil,
            offline: model.isOffline,
            onGps: model.gpsPillTapped,
            onSearch: emptyView ? { model.openSearch() } : nil,
            greeting: emptyView && alert == nil ? greetingText(model.settings.megszolitas) : nil,
            cruise: emptyView && alert == nil ? model.cruiseText : nil,
            part: part
        )
    }

    /// A `.slowdown` (a HUD teteje fölött 4 pt-re, középen) és a `.hud-float` (12 pt-re, mérés közben 84 pt-tel feljebb, hogy a sáv helye szabad maradjon).
    private var floats: some View {
        ZStack(alignment: .bottom) {
            if view.phase == .meres, slowDownBarShown(navMeterCompact(view.phase, offer: model.nav?.offer != nil)) {
                SlowDownBar(view: view, unit: unit)
                    .padding(.bottom, Tokens.Space.s1)
            }
            VStack(spacing: Tokens.Space.s3) { float }
                .padding(.bottom, view.phase == .meres ? Tokens.Space.s3 + 84 : Tokens.Space.s3)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { hudFloatH = max(0, $0 - (view.phase == .meres ? Tokens.Space.s3 + 84 : Tokens.Space.s3)) }
        }
        .frame(height: 0, alignment: .bottom)
    }

    /// AW18: a „Dugóba kerültél?” válasza és az újratervezés azonnali újrapróbája.
    private var jamAnswer: (Bool) -> Void { { [model] in model.answerJam($0) } }
    private var retry: () -> Void { { [model] in model.retryReroute() } }

    /// AW18: a dugó-kérdés önálló kártyán, ha a felső kártya nem látszik (sáv-mód / mérés); a közeli kamera elsőbbséget kap.
    private var standaloneJamAsk: Bool {
        // AOS15 (AW18-paritás): a weben a közeli kamera nem rejti el az önálló kártyát
        guard let nav = model.nav, nav.jamAsk, nav.phase != .arrived else { return false }
        return measuringLayout || stepStrip
    }

    /// AOS14: a közeledő bejelentés kártyájának adatai (figyelmeztetés → „Még ott van?”).
    private var alert: ReportAlertModel? {
        model.reportAlert.map { a in
            ReportAlertModel(
                prompt: a.prompt, report: a.report, canVote: model.backend.configured || model.sim != nil, sending: model.voting,
                onVote: { [model] in model.vote(a.report.id, confirm: $0) }
            )
        }
    }

    /// AOS14: az üres nézet (nincs navigáció, tervezés, mérés) – a kereső-gomb és a köszöntés ilyenkor látszik.
    private var emptyView: Bool { model.nav == nil && model.plan == nil && !driving && view.phase != .keziEredmeny }

    /// A `.hud-float` tartalma: a teljes ajánlat, a koppintott jelölő kártyája, a tábla és a „Vissza a helyemre”. A kompakt ajánlat is itt (mint a weben).
    @ViewBuilder private var float: some View {
        if let offer = model.nav?.offer {
            OfferCard(offer: offer, onAccept: model.acceptOffer, onDecline: model.declineOffer)
                .transition(.opacity.combined(with: .offset(y: 12)))
        }
        // AOS14: a koppintott jelölő kártyája (a közeledő bejelentés kártyája felül, a kamera-figyelmeztetés helyén)
        if let shown = model.shownReport {
            ReportCard(
                report: shown,
                now: model.nowMs(),
                canVote: model.backend.configured || model.sim != nil,
                voted: model.myVote(shown.id),
                sending: model.voting,
                onVote: { model.vote(shown.id, confirm: $0) },
                onClose: model.closeReportCard
            )
            .id(shown.id)
            .transition(.opacity.combined(with: .offset(y: 12)))
        }
        // AOS15: a koppintott kamera kártyája ugyanott (a webes `CameraCard`; a bejelentésé elsőbbséget kap)
        if model.shownReport == nil, let cam = model.shownCamera {
            CameraCard(camera: cam, fix: view.lastFix, unit: unit, onClose: model.closeCameraCard)
                .id(cam.id)
                .transition(.opacity.combined(with: .offset(y: 12)))
        }
        // a bal alsó tábla a gombsor fölött (a webes `.recenter-row`)
        if navSign, let nav = model.nav {
            HStack {
                LimitSign(kmh: nav.limitKmh, unit: unit, small: true)
                Spacer()
            }
        }
    }

    /// Az alsó rész (a webes `.hud`): gombsor, lépés-sáv, mérőkártya, érkezés-sáv – 12 pt-es térközzel.
    @ViewBuilder private var hud: some View {
        // a gombsor jobbra zárva; Beállítások és stopper mérés / közeledés / kézi eredmény közben nincs (a webes feltétel)
        HStack(alignment: .bottom, spacing: Tokens.Space.s3) {
            Spacer()
            if model.manualPillCollapsed {
                ManualMini(view: view, unit: unit, onExpand: model.tapManualPill)
            }
            if !driving && view.phase != .keziEredmeny {
                Button { settingsOpen = true } label: { Icon(name: .sliders, size: 26) }
                    .buttonStyle(RoundButtonStyle())
                    .accessibilityLabel(t(.mapSettings))
                Button { model.startManual() } label: { Icon(name: .stopwatch, size: 26) }
                    .buttonStyle(RoundButtonStyle())
                    .accessibilityLabel(t(.mapManualStart))
            }
            // AOS14: a Bejelentés menü (mint a weben: mindig a sor jobb szélén); a webes `.round-btn.report`: borostyán ikon
            Button { model.reportSheetOpen = true } label: { Icon(name: .report, size: 28).foregroundStyle(Tokens.Colors.near) }
                .buttonStyle(RoundButtonStyle())
                .accessibilityLabel(t(.mapReport))
            // AOS18-javítás: a webes `.actions .recenter`: mindig a gombsor jobb szélén, táblától és mérőkártyától függetlenül; csak ha nem a pozíción áll a kamera
            if !model.follow && view.lastFix != nil {
                Button { model.follow = true } label: { Icon(name: .crosshair, size: 28).foregroundStyle(Tokens.Colors.brand) }
                    .buttonStyle(RoundButtonStyle())
                    .accessibilityLabel(t(.mapRecenter))
            }
        }
        if let nav = model.nav, stripShown { strip(nav) }
        if !hudCardHidden {
            MeterCard(
                view: view,
                settings: model.settings,
                gpsReady: view.lastFix != nil,
                onStopManual: model.stopManual,
                onDismiss: model.dismiss,
                compact: navResultCompact(view.phase, navigating: model.nav != nil),
                meterCompact: navMeterCompact(view.phase, offer: model.nav?.offer != nil),
                onCollapseManual: collapseManual
            )
            .id(view.phase)
            .transition(.opacity.combined(with: .offset(y: 14)))
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { model.navCardTop = $0 }
        }
        if let nav = model.nav {
            NavBottomBar(
                view: nav, unit: unit, currentKmh: view.currentKmh, showSpeed: navBottomShowsSpeed(view.phase),
                over: navSpeedOver(view.currentKmh, nav.limitKmh), onEnd: model.endNav
            )
            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { if hudCardHidden { model.navCardTop = $0 } }
        }
    }

    private func strip(_ nav: NavView) -> some View {
        NavStrip(view: nav, unit: unit)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { stripH = $0 }
            .transition(.opacity.combined(with: .offset(y: 12)))
    }
}
