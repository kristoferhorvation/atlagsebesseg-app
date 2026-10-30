import SwiftUI

// AOS14: a Live Activity nézetei. A widget-kiterjesztés (DriveLiveActivity.swift) és az app szimulátoros előnézete
// (Sim/LiveActivityPreview.swift – ha a szimulátor a lezárt képernyőt / Dynamic Islandet nem tudja lefotózni) is fordítja.

/// A lezárt képernyő: mérés közben a mérés dominál (a navigáció egy kompakt sorban alatta), különben a következő manőver.
struct LockScreenView: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        Group {
            if let m = state.measure {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .center, spacing: 12) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(m.title).font(.inter(15, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                            Text(m.avg).font(.num(58, 720)).tracking(-1.5).foregroundStyle(m.tone.color).minimumScaleFactor(0.6)
                            Text(m.avgLabel).font(.inter(15, 560)).foregroundStyle(Tokens.Colors.textMuted)
                        }
                        Spacer(minLength: 0)
                        if let limit = m.limit { Sign(text: limit, size: 64) }
                    }
                    MeasureFigures(m: m)
                    if let n = state.nav { NavLine(nav: n) }
                }
            } else if let n = state.nav {
                HStack(spacing: 14) {
                    Glyph(maneuver: n.maneuver, size: 52).foregroundStyle(Tokens.Colors.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(n.distance).font(.num(34, 720)).foregroundStyle(Tokens.Colors.text)
                        Text(n.street).font(.inter(17, 600)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(n.etaLabel).font(.inter(14, 560)).foregroundStyle(Tokens.Colors.textMuted)
                        Text(n.eta).font(.num(24, 700)).foregroundStyle(Tokens.Colors.text)
                    }
                }
            }
        }
        .padding(16)
    }
}

/// „most 92 · várható 88 · 3,2 km hátra” – ami van (kézi mérésnél egyik sincs).
struct MeasureFigures: View {
    let m: DriveActivityAttributes.Measure

    var body: some View {
        if m.now != nil || m.expected != nil || m.remaining != nil {
            HStack(spacing: 14) {
                if let now = m.now { figure(m.nowLabel, now, over: m.nowOver) }
                if let exp = m.expected { figure(m.expectedLabel, exp, over: false) }
                Spacer(minLength: 0)
                if let rem = m.remaining {
                    Text(rem).font(.num(15, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                }
            }
        }
    }

    private func figure(_ label: String, _ value: String, over: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(label).font(.inter(14, 560)).foregroundStyle(Tokens.Colors.textMuted)
            Text(value).font(.num(20, 700)).foregroundStyle(over ? Tokens.StatusColors.tul_gyors : Tokens.Colors.text)
        }
    }
}

/// Mérés közben a navigáció egy kompakt sorban: ikon, távolság, utcanév, érkezés.
struct NavLine: View {
    let nav: DriveActivityAttributes.Nav

    var body: some View {
        HStack(spacing: 8) {
            Glyph(maneuver: nav.maneuver, size: 22).foregroundStyle(Tokens.Colors.accent)
            Text(nav.distance).font(.num(16, 700)).foregroundStyle(Tokens.Colors.text)
            Text(nav.street).font(.inter(15, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            Spacer(minLength: 0)
            Text(nav.eta).font(.num(15, 620)).foregroundStyle(Tokens.Colors.textMuted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// KRESZ-tábla stílusú sebességhatár (a webes / appbeli `LimitSign` kicsiben).
struct Sign: View {
    let text: String
    let size: CGFloat

    var body: some View {
        Text(text)
            .font(.num(size * 0.36, 760))
            .foregroundStyle(Tokens.Colors.signText)
            .minimumScaleFactor(0.5)
            .frame(width: size, height: size)
            .background(Circle().fill(Tokens.Colors.signFace))
            .overlay(Circle().strokeBorder(Tokens.Colors.signRing, lineWidth: size * 0.1))
    }
}

/// A manőver vonalrajza (a webes ManeuverIcon.tsx, stroke 2,2).
struct Glyph: View {
    let maneuver: String
    let size: CGFloat

    var body: some View {
        let icon = ManeuverIcon(rawValue: maneuver) ?? .straight
        let scale = size / 24
        icon.path
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .stroke(style: StrokeStyle(lineWidth: 2.2 * scale, lineCap: .round, lineJoin: .round))
            .frame(width: size, height: size)
    }
}

extension DriveActivityAttributes.Tone {
    var color: Color {
        switch self {
        case .jo: Tokens.StatusColors.jo
        case .lassits: Tokens.StatusColors.lassits
        case .tulGyors: Tokens.StatusColors.tul_gyors
        case .kezi: Tokens.StatusColors.kezi
        case .semleges: Tokens.StatusColors.semleges
        }
    }
}

// MARK: Dynamic Island

/// Kibontva, bal: mérésnél az átlag (státusz-színnel), navigációnál a manőver.
struct IslandLeading: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            VStack(alignment: .leading, spacing: 0) {
                Text(m.avg).font(.num(44, 720)).foregroundStyle(m.tone.color).minimumScaleFactor(0.6)
                Text(m.avgLabel).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            }
            .padding(.leading, 4)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 44).foregroundStyle(Tokens.Colors.accent).padding(.leading, 4)
        }
    }
}

/// Kibontva, jobb: mérésnél a tábla-limit (kézinél semmi), navigációnál az érkezés.
struct IslandTrailing: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            if let limit = m.limit { Sign(text: limit, size: 50).padding(.trailing, 4) }
        } else if let n = state.nav {
            VStack(alignment: .trailing, spacing: 0) {
                Text(n.etaLabel).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
                Text(n.eta).font(.num(22, 700)).foregroundStyle(Tokens.Colors.text)
            }
            .padding(.trailing, 4)
        }
    }
}

/// Kibontva, közép: mérésnél a cím, navigációnál a távolság és az utcanév.
struct IslandCenter: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            Text(m.title).font(.inter(15, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
        } else if let n = state.nav {
            VStack(spacing: 0) {
                Text(n.distance).font(.num(30, 720)).foregroundStyle(Tokens.Colors.text)
                Text(n.street).font(.inter(15, 600)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            }
        }
    }
}

/// Kibontva, alul: mérésnél „most · várható · hátra”, alatta (navigáció mellett) a manőver egy sorban.
struct IslandBottom: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            VStack(spacing: 8) {
                MeasureFigures(m: m)
                if let n = state.nav { NavLine(nav: n) }
            }
        }
    }
}

struct IslandCompactLeading: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(16, 720)).foregroundStyle(m.tone.color)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 20).foregroundStyle(Tokens.Colors.accent)
        }
    }
}

struct IslandCompactTrailing: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            if let limit = m.limit {
                Sign(text: limit, size: 24)
            } else {
                Text(m.avgLabel).font(.inter(12, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            }
        } else if let n = state.nav {
            Text(n.distance).font(.num(15, 680)).foregroundStyle(Tokens.Colors.text)
        }
    }
}

struct IslandMinimal: View {
    let state: DriveActivityAttributes.ContentState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(14, 720)).foregroundStyle(m.tone.color).minimumScaleFactor(0.6)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 18).foregroundStyle(Tokens.Colors.accent)
        }
    }
}
