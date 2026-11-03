import SwiftUI

// AOS14: a Live Activity szimulátoros előnézete (mock). A fej nélküli (GUI nélküli) szimulátoron a lezárt képernyő és a
// Dynamic Island nem fotózható, ezért a widget SAJÁT nézeteit (AtlagsebessegWidget/LiveActivityViews.swift – az app is
// fordítja) rajzoljuk ki az app élő állapotából (`AppModel.liveState`): felül a Dynamic Island szűk és kibontott alakja,
// alatta a lezárt képernyő értesítés-kártyája (AOS15: a térképképpel). Indítás: `-livePreview YES` (a `-sim …` mellett).

// AOS16: `-liveGallery figyel|nav|meres|meresnav|kezi` – az öt állapot mintaadattal (dizájn-átnézés, hosszú feliratokkal).

/// Az öt állapot mintaadata: a galéria, a `#Preview` és a magasság-teszt (LiveActivityTests) is ebből rajzol.
enum LiveActivitySamples {
    static let nav = DriveActivityAttributes.Nav(
        maneuver: "right", distance: "1,2 km", street: "Budaörsi út – Kelenföldi pályaudvar", etaLabel: "Érkezés", eta: "14:32",
        remaining: "1 óra 18 perc · 121,4 km", delay: "+7 perc dugó"
    )
    static let measure = DriveActivityAttributes.Measure(
        title: "Mérés", avg: "127", avgLabel: "km/h átlag", tone: .lassits, limit: "130", nowLabel: "most", now: "134", nowOver: true,
        expectedLabel: "várható", expected: "129", remaining: "12,4 km hátra", advice: "Lassíts · max 118"
    )
    static let manual = DriveActivityAttributes.Measure(
        title: "Kézi átlagmérés", avg: "96", avgLabel: "km/h átlag", tone: .kezi, limit: nil, nowLabel: "most", now: nil, nowOver: false,
        expectedLabel: "várható", expected: nil, remaining: nil, elapsed: "24:12"
    )
    static let watch = DriveActivityAttributes.Watch(
        title: "Figyel", speed: "87", unit: "km/h", limit: nil, speedOver: false, nextSection: "Szakasz 3,2 km múlva",
        cruise: "124,6 km · 1 óra 23 perc · 90 km/h", dirChanges: "Irányváltások: 17"
    )
    private static let att = "© Mapbox © OpenStreetMap"
    static let all: [(name: String, state: LiveState)] = [
        ("figyel", .init(watch: watch, mapVersion: 1, attribution: att)),
        ("nav", .init(nav: nav, mapVersion: 1, attribution: att)),
        ("meres", .init(measure: measure, mapVersion: 1, attribution: att)),
        ("meresnav", .init(measure: measure, nav: nav, mapVersion: 1, attribution: att)),
        ("kezi", .init(measure: manual, mapVersion: 1, attribution: att)),
    ]

    /// Sötét, útszerű mintakép a térképkép helyére.
    static let mapImage: UIImage = UIGraphicsImageRenderer(size: CGSize(width: 240, height: 240)).image { c in
        UIColor(white: 0.13, alpha: 1).setFill()
        c.fill(CGRect(x: 0, y: 0, width: 240, height: 240))
        UIColor(Tokens.Colors.route).setStroke()
        let p = UIBezierPath()
        p.move(to: CGPoint(x: 120, y: 240))
        p.addLine(to: CGPoint(x: 120, y: 110))
        p.addLine(to: CGPoint(x: 210, y: 20))
        p.lineWidth = 12
        p.stroke()
    }
}

struct LiveActivityPreview: View {
    let model: AppModel

    private var sample: LiveState? {
        let name = UserDefaults.standard.string(forKey: "liveGallery")
        return LiveActivitySamples.all.first { $0.name == name }?.state
    }

    var body: some View {
        ZStack(alignment: .top) {
            LinearGradient(colors: [Color(white: 0.16), Color(white: 0.05)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
            if let state = sample ?? model.liveState {
                VStack(spacing: 16) {
                    compactIsland(state).padding(.top, 11)
                    Text("9:41").font(.num(86, 600)).foregroundStyle(.white.opacity(0.92)).padding(.top, 10)
                    caption("Lezárt képernyő (mock)")
                    LockScreenView(state: state, mapImage: sample == nil ? nil : LiveActivitySamples.mapImage)
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

#Preview("Live Activity – öt állapot") {
    ScrollView {
        VStack(spacing: 12) {
            ForEach(LiveActivitySamples.all, id: \.name) { item in
                LockScreenView(state: item.state, mapImage: LiveActivitySamples.mapImage)
                    .background(Tokens.Colors.bg.opacity(0.92), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
        }
        .padding()
    }
    .background(.black)
    .environment(\.colorScheme, .dark)
}
