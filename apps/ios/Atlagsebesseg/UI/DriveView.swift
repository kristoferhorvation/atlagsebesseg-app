import SwiftUI

/// Vezetés közbeni nézet: térkép a háttérben, alul a mérőkártya, fölötte a „Lassíts” sáv és a gombok; felül a
/// tervezett mérés sávja és a jelzések (kamera, szakaszkapu) sávja.
struct DriveView: View {
    @Bindable var model: AppModel
    @State private var settingsOpen = false

    private var view: SessionView { model.view }
    private var measuring: Bool { [.meres, .kezi].contains(view.phase) }

    var body: some View {
        ZStack(alignment: .bottom) {
            MapScreen(model: model, follow: $model.follow)

            VStack(spacing: Tokens.Space.s3) {
                if model.sim != nil && model.simPanel { SimPanel(model: model) }
                Spacer()
                HStack(alignment: .bottom, spacing: Tokens.Space.s3) {
                    Button { settingsOpen = true } label: { Icon(name: .sliders, size: 26) }
                        .buttonStyle(RoundButtonStyle())
                        .accessibilityLabel(t(.mapSettings))
                    Spacer()
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
                }
                ZStack(alignment: .top) {
                    MeterCard(
                        view: view,
                        settings: model.settings,
                        gpsReady: view.lastFix != nil,
                        onStopManual: model.stopManual,
                        onDismiss: model.dismiss
                    )
                    SlowDownBar(view: view, unit: model.settings.egyseg)
                        .alignmentGuide(.top) { $0[.bottom] + 4 }
                }
                .animation(.easeOut(duration: Tokens.Motion.base), value: view.phase)
            }
            .padding(.horizontal, Tokens.Space.s3)
            .padding(.bottom, Tokens.Space.s3)
        }
        // külön, felülre igazított réteg: a magas kártya sem tolja fel (a Mapbox-logó és az attribúció látszik)
        .overlay(alignment: .top) {
            VStack(spacing: Tokens.Space.s2) {
                if let p = model.activePlanned {
                    PlannedBand(check: p, compact: measuring, unit: model.settings.egyseg)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
                if let a = model.alert {
                    AlertBanner(event: a)
                        .transition(.opacity.combined(with: .offset(y: -12)))
                }
            }
            .padding(.top, model.sim != nil && model.simPanel ? 96 : 44)
            .padding(.horizontal, Tokens.Space.s3)
            .animation(.easeOut(duration: Tokens.Motion.slow), value: model.activePlanned?.id)
            .animation(.easeOut(duration: Tokens.Motion.base), value: model.alert)
            .allowsHitTesting(false)
        }
        .sheet(isPresented: $settingsOpen) {
            SettingsSheet(model: model)
                .presentationDetents([.large])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
    }
}
