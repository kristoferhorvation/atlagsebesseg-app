import SwiftUI

// A szimulátor vezérlője (a szimulátor feliratai a CLAUDE.md szerint kivételek a szótár-szabály alól).

/// Forgatókönyv, sebesség, lejátszás – a webes SimPanel megfelelője.
struct SimPanel: View {
    let model: AppModel

    private static let labels: [SimScenario: String] = [
        .jo: "Jó ütem", .tul: "Túl gyors", .lassit: "Gyors, majd lassít", .alagut: "Alagút", .navsim: "Budapest → Győr",
    ]

    var body: some View {
        HStack(spacing: Tokens.Space.s2) {
            Menu {
                ForEach(SimScenario.allCases) { s in
                    Button(Self.labels[s] ?? s.rawValue) { model.startSim(s, speed: model.sim?.speed ?? 4) }
                }
            } label: {
                Text("SIM · \(Self.labels[SimScenario(rawValue: model.sim?.fixture.id ?? "") ?? .lassit] ?? "")")
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ForEach([1.0, 4, 12], id: \.self) { v in
                Button("\(Int(v))×") { model.simSetSpeed(v) }
                    .font(.system(size: 15, weight: model.sim?.speed == v ? .bold : .regular))
            }
            Button { model.simPlayPause() } label: {
                Icon(name: model.simPlaying ? .pause : .play, size: 18)
            }
        }
        .foregroundStyle(Tokens.Colors.text)
        .padding(.horizontal, Tokens.Space.s4)
        .frame(height: 44)
        .overlay(alignment: .bottom) {
            GeometryReader { g in
                Capsule().fill(Tokens.Colors.accent).frame(width: g.size.width * model.simProgress, height: 2)
            }
            .frame(height: 2)
        }
        .glass(radius: 22)
        .padding(.top, 40)
    }
}
