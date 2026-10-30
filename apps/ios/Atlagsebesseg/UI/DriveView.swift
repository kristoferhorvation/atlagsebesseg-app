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
    private var navSign: Bool { model.nav != nil && (view.phase == .nincsSzakasz || model.manualPillCollapsed) }
    /// Mérés közbeni, kompakt „Gyorsabb út” ajánlat: a mérőkártya + egysoros sáv fölött, a 45 mp alatt a gombsor és a
    /// pillek nélkül (a nagy mérőkártya mellett különben nem fér ki).
    private var compactOffer: AlternativeOffer? { model.nav?.offer.flatMap { $0.compact ? $0 : nil } }
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
            MapScreen(model: model, follow: $model.follow)

            VStack(spacing: Tokens.Space.s3) {
                if model.sim != nil && model.simPanel { SimPanel(model: model) }
                Spacer()
                if !model.destSearchOpen {
                    if let plan = model.plan {
                        RoutePickerCard(model: model, plan: plan)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else {
                        // a záradék az ehhez az elrendezéshez tartozó sáv-állapotot látja (nem a következő renderét)
                        let strip = stripShown, stripSpace = stripH + Tokens.Space.s2
                        VStack(spacing: Tokens.Space.s3) { hud }
                            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: {
                                model.hudTop = $0
                                hudTopNoStrip = $0 + (strip ? stripSpace : 0)
                            }
                    }
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.bottom, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.plan?.status == .ready)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.manualPillCollapsed)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.shownReport?.id)
        }
        // külön, felülre igazított réteg: a magas kártya sem tolja fel (a Mapbox-logó és az attribúció látszik)
        .overlay(alignment: .top) {
            VStack(spacing: Tokens.Space.s2) {
                if model.destSearchOpen {
                    SearchPanel(model: model)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                } else {
                    if compactOffer == nil {
                        StatusPills(
                            geo: model.geo,
                            accuracy: view.lastFix?.accuracy,
                            compact: driving || model.nav != nil,
                            onGps: model.gpsPillTapped,
                            onSearch: emptyView ? { model.openSearch() } : nil,
                            greeting: emptyView && alert == nil ? greetingText(model.settings.megszolitas) : nil
                        )
                    }
                    if let nav = model.nav, !measuringLayout {
                        // sáv-módban is elrendezve (nulla magasságú keretben, rejtve), hogy a teljes kártya alja mérhető
                        // maradjon: ebből dől el, mikor fér ki újra
                        NavTopCard(view: nav, unit: unit, report: stepStrip ? nil : alert, onJamAnswer: stepStrip ? nil : jamAnswer, onRetry: retry)
                            .fixedSize(horizontal: false, vertical: true)
                            .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { navCardBottom = $0 }
                            .opacity(stepStrip ? 0 : 1)
                            .frame(height: stepStrip ? 0 : nil, alignment: .top)
                            .allowsHitTesting(!stepStrip)
                            .accessibilityHidden(stepStrip)
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    }
                    // AOS14: navigáció nélkül (vagy ha a felső kártya nem látszik) a közeledő bejelentés kártyája önállóan, ugyanott
                    // AW18: ha a felső kártya nem látszik (sáv-mód / mérés), a „Dugóba kerültél?” önálló borostyán kártyán, ugyanott
                    if standaloneJamAsk {
                        JamAskCard(onAnswer: jamAnswer)
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    } else if let alert, !(model.nav != nil && !measuringLayout && !stepStrip) {
                        ReportAlertCard(alert: alert, unit: unit)
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    }
                    Group {
                        if let p = model.activePlanned {
                            PlannedBand(check: p, compact: measuring, unit: unit)
                                .transition(.opacity.combined(with: .offset(y: -12)))
                        }
                        if let a = model.alert {
                            AlertBanner(event: a)
                                .transition(.opacity.combined(with: .offset(y: -12)))
                        }
                        if let toast = model.toast {
                            ToastView(toast: toast)
                                .transition(.opacity.combined(with: .offset(y: -12)))
                        }
                    }
                    .allowsHitTesting(false)
                }
            }
            .padding(.top, model.sim != nil && model.simPanel ? 96 : 44)
            .padding(.horizontal, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.slow), value: model.activePlanned?.id)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.alert)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.toast)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.reportPromptState?.id)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.destSearchOpen)
            .animation(.easeOut(duration: Tokens.Motion.base), value: measuringLayout)
            .animation(.easeOut(duration: Tokens.Motion.base), value: stepStrip)
        }
        .environment(\.strongGlass, strongGlassFor(model.settings.terkep, mapLightPreset(model.settings.terkep, lightPresetAt(model.lightNowMs(), view.lastFix))))
        .sheet(isPresented: $model.geoHelpOpen) {
            GeoBlockedSheet()
                .presentationDetents([.medium])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
        .sheet(isPresented: $model.reportSheetOpen) {
            ReportSheet(fix: view.lastFix, online: model.backend.configured, sending: model.reportSending, gateStarted: model.gateStarted, onPick: { [model] in model.sendReport($0) })
                .presentationDetents([.large])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsSheet(model: model)
                .presentationDetents([.large])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
    }

    /// AW18: a „Dugóba kerültél?” válasza és az újratervezés azonnali újrapróbája.
    private var jamAnswer: (Bool) -> Void { { [model] in model.answerJam($0) } }
    private var retry: () -> Void { { [model] in model.retryReroute() } }

    /// AW18: a dugó-kérdés önálló kártyán, ha a felső kártya nem látszik (sáv-mód / mérés); a közeli kamera elsőbbséget kap.
    private var standaloneJamAsk: Bool {
        guard let nav = model.nav, nav.jamAsk, nav.phase != .arrived, nav.cameraNear == nil else { return false }
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

    /// Az alsó rész: ajánlat, bejelentés-kártya, gombok, és a mérőkártya / érkezés-sáv.
    @ViewBuilder private var hud: some View {
        if let offer = model.nav?.offer, !offer.compact {
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
        if compactOffer == nil {
            HStack(alignment: .bottom, spacing: Tokens.Space.s3) {
                if navSign, let nav = model.nav {
                    LimitSign(kmh: nav.limitKmh, unit: unit, small: true)
                } else {
                    Button { settingsOpen = true } label: { Icon(name: .sliders, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapSettings))
                }
                Spacer()
                if model.manualPillCollapsed {
                    ManualMini(view: view, unit: unit, onExpand: model.tapManualPill)
                }
                if !model.follow && view.lastFix != nil {
                    Button { model.follow = true } label: { Icon(name: .crosshair, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapRecenter))
                }
                if view.phase == .nincsSzakasz || view.phase == .kozeledik {
                    Button { model.startManual() } label: { Icon(name: .stopwatch, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapManualStart))
                }
                // AOS14: a Bejelentés menü (mint a weben: mindig a sor jobb szélén)
                Button { model.reportSheetOpen = true } label: { Icon(name: .report, size: 28) }
                    .buttonStyle(RoundButtonStyle())
                    .accessibilityLabel(t(.mapReport))
            }
        }
        if let nav = model.nav, hudCardHidden {
            if stripShown { strip(nav) }
        } else {
            // a „Lassíts” sáv a navigációs sáv fölé kerül (nem takarja el a lépést)
            ZStack(alignment: .top) {
                VStack(spacing: Tokens.Space.s2) {
                    if let offer = compactOffer {
                        OfferCard(offer: offer, onAccept: model.acceptOffer, onDecline: model.declineOffer)
                            .transition(.opacity.combined(with: .offset(y: 12)))
                    }
                    if let nav = model.nav, stripShown { strip(nav) }
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
                }
                // AW17-javítás: egysoros mérőkártyánál (mérés + ajánlat) nincs külön sáv – a max érték a kártyában
                if slowDownBarShown(navMeterCompact(view.phase, offer: model.nav?.offer != nil)) {
                    SlowDownBar(view: view, unit: unit)
                        .alignmentGuide(.top) { $0[.bottom] + 4 }
                }
            }
            .animation(.easeOut(duration: Tokens.Motion.base), value: view.phase)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.nav?.offer != nil)
        }
        if let nav = model.nav {
            NavBottomBar(
                view: nav, unit: unit, currentKmh: view.currentKmh, showSpeed: navBottomShowsSpeed(view.phase),
                over: navSpeedOver(view.currentKmh, nav.limitKmh), onEnd: model.endNav
            )
        }
    }

    private func strip(_ nav: NavView) -> some View {
        NavStrip(view: nav, unit: unit)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { stripH = $0 }
            .transition(.opacity.combined(with: .offset(y: 12)))
    }
}
