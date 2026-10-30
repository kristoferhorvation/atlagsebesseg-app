import SwiftUI

// AOS14: a Live Activity szimulátoros előnézete (mock). A fej nélküli (GUI nélküli) szimulátoron a lezárt képernyő és a
// Dynamic Island nem fotózható, ezért a widget SAJÁT nézeteit (AtlagsebessegWidget/LiveActivityViews.swift – az app is
// fordítja) rajzoljuk ki az app élő állapotából (`liveActivityState`): felül a Dynamic Island szűk és kibontott alakja,
// alatta a lezárt képernyő értesítés-kártyája. Indítás: `-livePreview YES` (a `-sim …` mellett).

struct LiveActivityPreview: View {
    let model: AppModel

    var body: some View {
        let state = liveActivityState(model.view, nav: model.nav, unit: model.settings.egyseg)
        ZStack(alignment: .top) {
            LinearGradient(colors: [Color(white: 0.16), Color(white: 0.05)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            if let state {
                VStack(spacing: 18) {
                    compactIsland(state).padding(.top, 11)
                    Text("9:41").font(.num(86, 600)).foregroundStyle(.white.opacity(0.92)).padding(.top, 18)
                    caption("Dynamic Island – kibontva (mock)")
                    expandedIsland(state)
                    caption("Lezárt képernyő (mock)")
                    LockScreenView(state: state)
                        .background(Tokens.Colors.bg.opacity(0.92), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .padding(.horizontal, 12)
                    caption("Dynamic Island – szűk alak, és minimális: ")
                    minimalIsland(state)
                }
                .environment(\.colorScheme, .dark)
            } else {
                Text("nincs Live Activity (nincs mérés / navigáció)").foregroundStyle(.white).padding(.top, 200)
            }
        }
    }

    private func caption(_ s: String) -> some View {
        Text(s).font(.inter(13, 560)).foregroundStyle(.white.opacity(0.55))
    }

    /// A szűk alak: a kamera-kivágás (126 × 37 pt) két oldalán a bal és a jobb tartalom.
    private func compactIsland(_ s: DriveActivityAttributes.ContentState) -> some View {
        HStack(spacing: 0) {
            IslandCompactLeading(state: s).frame(width: 64, alignment: .leading).padding(.leading, 14)
            Spacer(minLength: 126)
            IslandCompactTrailing(state: s).frame(width: 64, alignment: .trailing).padding(.trailing, 14)
        }
        .frame(width: 290, height: 37)
        .background(.black, in: Capsule())
    }

    private func expandedIsland(_ s: DriveActivityAttributes.ContentState) -> some View {
        VStack(spacing: 8) {
            HStack(alignment: .top) {
                IslandLeading(state: s)
                Spacer(minLength: 8)
                IslandCenter(state: s)
                Spacer(minLength: 8)
                IslandTrailing(state: s)
            }
            IslandBottom(state: s)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(width: 370)
        .background(.black, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
    }

    private func minimalIsland(_ s: DriveActivityAttributes.ContentState) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(.black).frame(width: 126, height: 37)
            IslandMinimal(state: s).frame(width: 37, height: 37).background(.black, in: Circle())
        }
    }
}
