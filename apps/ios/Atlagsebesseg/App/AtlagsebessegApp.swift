import SwiftUI

@main
struct AtlagsebessegApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if model.started {
                    DriveView(model: model)
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
