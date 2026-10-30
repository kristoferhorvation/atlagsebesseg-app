import SwiftUI

@main
struct AtlagsebessegApp: App {
    @State private var model = AppModel()

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
        }
    }
}
