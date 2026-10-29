import SwiftUI

/// Vezetés közbeni nézet: térkép a háttérben, alul a mérőkártya, fölötte a „Lassíts” sáv és a gombok; felül az
/// állapot-pillek (mellettük a kereső-pill), a tervezett mérés sávja és a jelzések (kamera, szakaszkapu) sávja.
/// Navigációban (A11) felül a lépés-kártya, alul az érkezés-sáv; mérés közben a mérőkártya marad a fő elem, a
/// navigációs lépés egysoros sávként fölötte. A kereső-pill a térkép tetején nyit teljes szélességű keresőmezőt.
struct DriveView: View {
    @Bindable var model: AppModel
    @State private var settingsOpen = false

    private var view: SessionView { model.view }
    private var measuring: Bool { [.meres, .kezi].contains(view.phase) }
    private var driving: Bool { [.meres, .kozeledik, .kezi].contains(view.phase) }
    private var unit: SpeedUnit { model.settings.egyseg }
    /// A bal alsó sebességhatár-tábla navigációban, amikor a mérőkártya saját táblája nem látszik (mint a weben).
    private var navSign: Bool { model.nav != nil && view.phase == .nincsSzakasz }
    /// Mérés közbeni, kompakt „Gyorsabb út” ajánlat: a mérőkártya + egysoros sáv fölött, a 45 mp alatt a gombsor és a
    /// pillek nélkül (a nagy mérőkártya mellett különben nem fér ki).
    private var compactOffer: AlternativeOffer? { model.nav?.offer.flatMap { $0.compact ? $0 : nil } }

    var body: some View {
        ZStack(alignment: .bottom) {
            MapScreen(model: model, follow: $model.follow)

            VStack(spacing: Tokens.Space.s3) {
                if model.sim != nil && model.simPanel { SimPanel(model: model) }
                Spacer()
                if !model.searchOpen {
                    if let plan = model.plan {
                        RoutePickerCard(model: model, plan: plan)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    } else {
                        hud
                    }
                }
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.bottom, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.plan?.status == .ready)
        }
        // külön, felülre igazított réteg: a magas kártya sem tolja fel (a Mapbox-logó és az attribúció látszik)
        .overlay(alignment: .top) {
            VStack(spacing: Tokens.Space.s2) {
                if model.searchOpen {
                    SearchPanel(model: model)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                } else {
                    if compactOffer == nil {
                        StatusPills(
                            geo: model.geo,
                            accuracy: view.lastFix?.accuracy,
                            awake: model.started,
                            compact: driving || model.nav != nil,
                            onSearch: model.nav == nil && model.plan == nil && !driving ? { model.openSearch() } : nil
                        )
                    }
                    if let nav = model.nav, !measuring {
                        NavTopCard(view: nav, unit: unit)
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
                    }
                    .allowsHitTesting(false)
                }
            }
            .padding(.top, model.sim != nil && model.simPanel ? 96 : 44)
            .padding(.horizontal, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.slow), value: model.activePlanned?.id)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.alert)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.searchOpen)
            .animation(.easeOut(duration: Tokens.Motion.base), value: measuring)
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsSheet(model: model)
                .presentationDetents([.large])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
    }

    /// Az alsó rész: ajánlat, gombok, és a mérőkártya / érkezés-sáv.
    @ViewBuilder private var hud: some View {
        if let offer = model.nav?.offer, !offer.compact {
            OfferCard(offer: offer, onAccept: model.acceptOffer, onDecline: model.declineOffer)
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
                if !model.follow && view.lastFix != nil {
                    Button { model.follow = true } label: { Icon(name: .crosshair, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapRecenter))
                }
                if model.nav != nil && view.phase != .nincsSzakasz {
                    Button { model.endNav() } label: { Icon(name: .stop, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.navEnd))
                }
                if view.phase == .nincsSzakasz || view.phase == .kozeledik {
                    Button { model.startManual() } label: { Icon(name: .stopwatch, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapManualStart))
                }
            }
        }
        if let nav = model.nav, view.phase == .nincsSzakasz {
            NavBottomBar(view: nav, unit: unit, currentKmh: view.currentKmh, onEnd: model.endNav)
        } else {
            // a „Lassíts” sáv a navigációs sáv fölé kerül (nem takarja el a lépést)
            ZStack(alignment: .top) {
                VStack(spacing: Tokens.Space.s2) {
                    if let offer = compactOffer {
                        OfferCard(offer: offer, onAccept: model.acceptOffer, onDecline: model.declineOffer)
                            .transition(.opacity.combined(with: .offset(y: 12)))
                    }
                    if let nav = model.nav, measuring {
                        NavStrip(view: nav, unit: unit)
                            .transition(.opacity.combined(with: .offset(y: 12)))
                    }
                    MeterCard(
                        view: view,
                        settings: model.settings,
                        gpsReady: view.lastFix != nil,
                        onStopManual: model.stopManual,
                        onDismiss: model.dismiss
                    )
                }
                SlowDownBar(view: view, unit: unit)
                    .alignmentGuide(.top) { $0[.bottom] + 4 }
            }
            .animation(.easeOut(duration: Tokens.Motion.base), value: view.phase)
        }
    }
}
