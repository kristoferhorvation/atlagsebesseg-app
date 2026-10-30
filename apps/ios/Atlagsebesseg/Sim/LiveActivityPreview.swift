import SwiftUI

// AOS14: a Live Activity szimulátoros előnézete (mock). A fej nélküli (GUI nélküli) szimulátoron a lezárt képernyő és a
// Dynamic Island nem fotózható, ezért a widget SAJÁT nézeteit (AtlagsebessegWidget/LiveActivityViews.swift – az app is
// fordítja) rajzoljuk ki az app élő állapotából (`AppModel.liveState`): felül a Dynamic Island szűk és kibontott alakja,
// alatta a lezárt képernyő értesítés-kártyája (AOS15: a térképképpel). Indítás: `-livePreview YES` (a `-sim …` mellett).

struct LiveActivityPreview: View {
    let model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [Color(white: 0.16), Color(white: 0.05)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            if let state = model.liveState {
                VStack(spacing: 16) {
                    compactIsland(state).padding(.top, 11)
                    Text("9:41").font(.num(86, 600)).foregroundStyle(.white.opacity(0.92)).padding(.top, 10)
                    caption("Lezárt képernyő (mock)")
                    LockScreenView(state: state)
                        .background(Tokens.Colors.bg.opacity(0.92), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .frame(width: 374)
                    caption("Dynamic Island – kibontva (mock)")
                    expandedIsland(state)
                    caption("Dynamic Island – szűk alak (fent) és minimális: ")
                    minimalIsland(state)
                }
                .environment(\.colorScheme, .dark)
            } else {
                Text("nincs Live Activity (nincs GPS)").foregroundStyle(.white).padding(.top, 200)
            }
        }
    }

    private func caption(_ s: String) -> some View {
        Text(s).font(.inter(13, 560)).foregroundStyle(.white.opacity(0.55))
    }

    /// A szűk alak: a kamera-kivágás (126 × 37 pt) két oldalán a bal és a jobb tartalom.
    private func compactIsland(_ s: LiveState) -> some View {
        HStack(spacing: 0) {
            IslandCompactLeading(state: s).frame(width: 64, alignment: .leading).padding(.leading, 14)
            Spacer(minLength: 126)
            IslandCompactTrailing(state: s).frame(width: 64, alignment: .trailing).padding(.trailing, 14)
        }
        .frame(width: 290, height: 37)
        .background(.black, in: Capsule())
    }

    /// A kibontott alak: két oszlop (bal: a fő szám, jobb: tábla / érkezés), alatta a részletek – térképkép nélkül.
    private func expandedIsland(_ s: LiveState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                IslandLeading(state: s)
                Spacer(minLength: 8)
                IslandTrailing(state: s)
            }
            IslandBottom(state: s)
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 16)
        .frame(width: 370)
        .background(.black, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
    }

    private func minimalIsland(_ s: LiveState) -> some View {
        HStack(spacing: 6) {
            Capsule().fill(.black).frame(width: 126, height: 37)
            IslandMinimal(state: s).frame(width: 37, height: 37).background(.black, in: Circle())
        }
    }
}
