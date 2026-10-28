import SwiftUI

/// Vezetés közbeni nézet: térkép a háttérben, alul a mérőkártya, fölötte a „Lassíts” sáv és a gombok.
struct DriveView: View {
    @Bindable var model: AppModel
    @State private var settingsOpen = false

    private var view: SessionView { model.view }

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
        .sheet(isPresented: $settingsOpen) {
            SettingsSheet(model: model)
                .presentationDetents([.large])
                .presentationBackground(Tokens.Colors.surfaceStrong)
        }
    }
}
