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
            .tint(Tokens.Colors.accent)
        }
    }
}
