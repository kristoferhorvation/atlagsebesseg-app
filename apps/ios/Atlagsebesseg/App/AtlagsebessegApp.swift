import MapboxCommon
import SwiftUI

@main
struct AtlagsebessegApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // AW22: a térkép feliratai az app nyelvén (a Map létrejötte előtt)
        HttpServiceFactory.setHttpServiceInterceptorForInterceptor(MapLanguageInterceptor())
    }

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
            // AOS18-javítás: `-liveStress YES`: a widget archiválásának próbája (`packages/parity/scripts/live-stress.mjs`)
            .task { if UserDefaults.standard.bool(forKey: "liveStress") { await LiveStress.run() } }
            // AW15: a választott nyelv a rendszer-elemek (formázás, felolvasás) nyelve is
            .environment(\.locale, L10n.lang.locale)
            .tint(Tokens.Colors.accent)
            // AOS15: a Live Activity koppintása a megfelelő nézetre nyit
            .onOpenURL { model.openLink($0) }
            // AOS18: a Live Activity „Haza” / „Munka” gombja, ha az app már fut
            .onReceive(NotificationCenter.default.publisher(for: LiveNavRouter.notification)) { _ in model.consumeLiveNav() }
            // AOS15-javítás: a lejárt / hiányzó Live Activity előtérben újraindul
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { model.appBecameActive() }
                // AW19 javítás 2: háttérbe kerüléskor az út NEM zárul – pillanatkép a naplóba (ha az app leáll, ne vesszen el)
                if phase == .background { model.checkpointTrip() }
            }
        }
    }
}
