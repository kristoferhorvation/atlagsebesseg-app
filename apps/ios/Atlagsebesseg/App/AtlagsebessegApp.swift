import SwiftUI

@main
struct AtlagsebessegApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if model.started {
                    DriveView(model: model)
                        // AOS14: `-livePreview YES` – a Live Activity mock-előnézete a szimulátorban (képernyőképhez)
                        .overlay {
                            if model.sim != nil, UserDefaults.standard.bool(forKey: "livePreview") { LiveActivityPreview(model: model) }
                        }
                } else {
                    StartView(model: model)
                }
            }
            .preferredColorScheme(.dark)
            // AW15: a választott nyelv a rendszer-elemek (formázás, felolvasás) nyelve is
            .environment(\.locale, L10n.lang.locale)
            .tint(Tokens.Colors.accent)
            // AOS15: a Live Activity koppintása a megfelelő nézetre nyit
            .onOpenURL { model.openLink($0) }
            // AOS15-javítás: a lejárt / hiányzó Live Activity előtérben újraindul
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { model.appBecameActive() }
            }
        }
    }
}
