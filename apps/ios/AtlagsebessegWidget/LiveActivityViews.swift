import SwiftUI
import UIKit

// AOS14: a Live Activity nézetei. A widget-kiterjesztés (DriveLiveActivity.swift) és az app szimulátoros előnézete
// (Sim/LiveActivityPreview.swift – ha a szimulátor a lezárt képernyőt / Dynamic Islandet nem tudja lefotózni) is fordítja.
// AOS15: öt állapot (figyel / navigáció / mérés / mérés + navigáció / kézi), a lezárt képernyőn bal oldalt térképkép.
// A lezárt képernyő az app arca: nagy számok, levegős sorköz, a tokenek színei (DESIGN.md › Live Activity).

typealias LiveState = DriveActivityAttributes.ContentState

/// A lezárt képernyő: bal oldalt a térképkép (ha van), mellette az állapot tartalma; mérés + navigáció esetén a manőver egy
/// kompakt sorban alul, teljes szélességben.
struct LockScreenView: View {
    let state: LiveState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                if let v = state.mapVersion, let img = LiveMapImage.load(v) {
                    MapThumb(image: img, tone: state.measure?.tone.color ?? Tokens.Colors.accent)
                }
                Group {
                    if let m = state.measure {
                        MeasureBlock(m: m, figures: false)
                    } else if let n = state.nav {
                        NavBlock(nav: n)
                    } else if let w = state.watch {
                        WatchBlock(w: w)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            // a „most · várható · hátra” sor teljes szélességben (a térképkép mellett eltörne)
            if let m = state.measure { MeasureFigures(m: m) }
            if state.measure != nil, let n = state.nav { NavLine(nav: n) }
        }
        .padding(16)
        .foregroundStyle(Tokens.Colors.text)
    }
}

/// A térképkép betöltése az App Group tárolóból (a widget minden frissítéskor újraolvassa – a változat a fájlnevet adja).
enum LiveMapImage {
    static func load(_ version: Int) -> UIImage? {
        guard let url = LiveMapStore.url(version: version) else { return nil }
        return UIImage(contentsOfFile: url.path)
    }
}

/// Négyzetes mini térkép: menetirány felfelé, a pozíció a közepén (nyíl a tónus színében).
struct MapThumb: View {
    let image: UIImage
    let tone: Color
    var size: CGFloat = 92

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay {
                ZStack {
                    Circle().fill(tone.opacity(0.28)).frame(width: 30, height: 30)
                    Circle().fill(Tokens.Colors.text).frame(width: 18, height: 18)
                    HeadingArrow().fill(tone).frame(width: 10, height: 11).offset(y: -0.5)
                }
            }
            .overlay(shape.strokeBorder(Tokens.Colors.stroke, lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// A pozíció-nyíl (felfelé – a kép a menetirányba forgatott).
nonisolated struct HeadingArrow: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.midX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.midX, y: r.maxY - r.height * 0.28))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

/// a) „Figyel”: a pillanatnyi sebesség nagyban, a tábla (ha ismert), a következő ismert szakasz 5 km-en belül.
struct WatchBlock: View {
    let w: DriveActivityAttributes.Watch

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Circle().fill(Tokens.Colors.accent).frame(width: 7, height: 7)
                    Text(w.title).font(.inter(15, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(w.speed).font(.num(54, 720)).tracking(-1.5)
                        .foregroundStyle(w.speedOver ? Tokens.StatusColors.tul_gyors : Tokens.Colors.text)
                    Text(w.unit).font(.inter(16, 600)).foregroundStyle(Tokens.Colors.textMuted)
                }
                if let next = w.nextSection {
                    HStack(spacing: 6) {
                        LiveIcon(name: .kapu_kezdo, size: 16).foregroundStyle(Tokens.Colors.accent)
                        Text(next).font(.inter(15, 620)).lineLimit(1).minimumScaleFactor(0.85)
                    }
                }
            }
            Spacer(minLength: 0)
            if let limit = w.limit { Sign(text: limit, size: 56) }
        }
    }
}

/// b) Navigáció: manőver + távolság nagyban, utcanév, érkezés · hátralévő idő és út, „+N perc dugó”.
struct NavBlock: View {
    let nav: DriveActivityAttributes.Nav

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Glyph(maneuver: nav.maneuver, size: 38).foregroundStyle(Tokens.Colors.accent)
                Text(nav.distance).font(.num(36, 720)).tracking(-0.8).lineLimit(1).minimumScaleFactor(0.7)
            }
            Text(nav.street).font(.inter(17, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(nav.eta).font(.num(17, 700))
                Text(nav.remaining).font(.num(15, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
            }
            if let d = nav.delay { DelayPill(text: d) }
        }
    }
}

/// „+7 perc dugó” – borostyán kapszula (mint az alsó navigációs sávban, AW18).
struct DelayPill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.inter(14, 650))
            .foregroundStyle(Tokens.Colors.near)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Tokens.Colors.near.opacity(0.16), in: Capsule())
    }
}

/// c) / e) Mérés: az átlag nagyban a tónus színében (kézinél accent), a tábla, „Maradj X alatt”, most · várható · hátra; kézi
/// mérésnél az eltelt idő a tábla helyén.
struct MeasureBlock: View {
    let m: DriveActivityAttributes.Measure
    /// A „most · várható · hátra” sor a blokkban (a lezárt képernyőn külön, teljes szélességben).
    var figures = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(m.title).font(.inter(15, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                Spacer(minLength: 0)
                if let a = m.advice {
                    Text(a).font(.inter(15, 680)).foregroundStyle(m.tone == .jo ? Tokens.Colors.textMuted : m.tone.color).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            HStack(alignment: .center, spacing: 10) {
                VStack(alignment: .leading, spacing: -2) {
                    Text(m.avg).font(.num(54, 720)).tracking(-1.5).foregroundStyle(m.tone.color).minimumScaleFactor(0.6).lineLimit(1)
                    Text(m.avgLabel).font(.inter(14, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                if let limit = m.limit {
                    Sign(text: limit, size: 54)
                } else if let e = m.elapsed {
                    VStack(alignment: .trailing, spacing: 2) {
                        LiveIcon(name: .stopwatch, size: 18).foregroundStyle(Tokens.Colors.textMuted)
                        Text(e).font(.num(26, 700)).monospacedDigit()
                    }
                }
            }
            if figures { MeasureFigures(m: m) }
        }
    }
}

/// „most 92 · várható 88 · 3,2 km hátra” – ami van (kézi mérésnél egyik sincs).
struct MeasureFigures: View {
    let m: DriveActivityAttributes.Measure

    var body: some View {
        if m.now != nil || m.expected != nil || m.remaining != nil {
            HStack(spacing: 12) {
                if let now = m.now { figure(m.nowLabel, now, over: m.nowOver) }
                if let exp = m.expected { figure(m.expectedLabel, exp, over: false) }
                Spacer(minLength: 0)
                if let rem = m.remaining {
                    Text(rem).font(.num(14, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
    }

    private func figure(_ label: String, _ value: String, over: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).fixedSize()
            Text(value).font(.num(19, 700)).lineLimit(1).fixedSize().foregroundStyle(over ? Tokens.StatusColors.tul_gyors : Tokens.Colors.text)
        }
    }
}

/// d) Mérés közben a navigáció egy kompakt sorban: ikon, távolság, utcanév, érkezés.
struct NavLine: View {
    let nav: DriveActivityAttributes.Nav

    var body: some View {
        HStack(spacing: 8) {
            Glyph(maneuver: nav.maneuver, size: 22).foregroundStyle(Tokens.Colors.accent)
            Text(nav.distance).font(.num(16, 700)).foregroundStyle(Tokens.Colors.text)
            Text(nav.street).font(.inter(15, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            Spacer(minLength: 0)
            if let d = nav.delay {
                Text(d).font(.inter(13, 650)).foregroundStyle(Tokens.Colors.near).lineLimit(1)
            }
            Text(nav.eta).font(.num(15, 620)).foregroundStyle(Tokens.Colors.textMuted)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
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

/// A webes vonalikon (a generált `IconName.path`) – az app `Icon`-ja a widgetben nem érhető el (Theme.swift).
struct LiveIcon: View {
    let name: IconName
    var size: CGFloat = 24

    var body: some View {
        let scale = size / 24
        let path = name.path.applying(CGAffineTransform(scaleX: scale, y: scale))
        Group {
            if name.filled {
                path.fill(style: FillStyle())
            } else {
                path.stroke(style: StrokeStyle(lineWidth: 2 * scale, lineCap: .round, lineJoin: .round))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
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

    /// A Dynamic Island szűk alakjának ikonja: jó → pipa, lassíts / túl gyors → lefelé nyíl, kézi → stopper.
    var icon: IconName {
        switch self {
        case .jo: .check
        case .lassits, .tulGyors: .arrowDown
        case .kezi: .stopwatch
        case .semleges: .kapu_kezdo
        }
    }
}

// MARK: Dynamic Island

/// Kibontva, bal oszlop: a fő szám (mérésnél az átlag a tónus színében, navigációnál manőver + távolság, figyelésnél a
/// sebesség), fölötte a cím.
struct IslandLeading: View {
    let state: LiveState

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let m = state.measure {
                Text(m.title).font(.inter(13, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                Text(m.avg).font(.num(44, 720)).tracking(-1).foregroundStyle(m.tone.color).minimumScaleFactor(0.6).lineLimit(1)
                Text(m.avgLabel).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            } else if let n = state.nav {
                Glyph(maneuver: n.maneuver, size: 34).foregroundStyle(Tokens.Colors.accent)
                Text(n.distance).font(.num(30, 720)).foregroundStyle(Tokens.Colors.text).lineLimit(1).minimumScaleFactor(0.7)
            } else if let w = state.watch {
                Text(w.title).font(.inter(13, 620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(w.speed).font(.num(44, 720)).tracking(-1).foregroundStyle(Tokens.Colors.text)
                    Text(w.unit).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
                }
            }
        }
        .padding(.leading, 6)
    }
}

/// Kibontva, jobb oszlop: mérésnél a tábla (kézinél az idő), navigációnál az érkezés és a hátralévő út, figyelésnél a tábla.
struct IslandTrailing: View {
    let state: LiveState

    var body: some View {
        VStack(alignment: .trailing, spacing: 3) {
            if let m = state.measure {
                if let limit = m.limit {
                    Sign(text: limit, size: 52)
                } else if let e = m.elapsed {
                    LiveIcon(name: .stopwatch, size: 18).foregroundStyle(Tokens.Colors.textMuted)
                    Text(e).font(.num(26, 700)).foregroundStyle(Tokens.Colors.text).monospacedDigit()
                }
            } else if let n = state.nav {
                Text(n.etaLabel).font(.inter(13, 560)).foregroundStyle(Tokens.Colors.textMuted)
                Text(n.eta).font(.num(26, 720)).foregroundStyle(Tokens.Colors.text)
                Text(n.remaining).font(.num(13, 560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            } else if let w = state.watch, let limit = w.limit {
                Sign(text: limit, size: 52)
            }
        }
        .padding(.trailing, 6)
    }
}

/// Kibontva, alul: mérésnél „Maradj X” + most · várható · hátra, alatta (navigáció mellett) a manőver egy sorban;
/// navigációnál az utcanév és a dugó; figyelésnél a következő szakasz.
struct IslandBottom: View {
    let state: LiveState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let m = state.measure {
                if let a = m.advice {
                    Text(a).font(.inter(15, 680)).foregroundStyle(m.tone == .jo ? Tokens.Colors.text : m.tone.color).lineLimit(1)
                }
                MeasureFigures(m: m)
                if let n = state.nav { NavLine(nav: n) }
            } else if let n = state.nav {
                HStack(spacing: 8) {
                    Text(n.street).font(.inter(16, 620)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                    Spacer(minLength: 0)
                    if let d = n.delay { DelayPill(text: d) }
                }
            } else if let next = state.watch?.nextSection {
                HStack(spacing: 6) {
                    LiveIcon(name: .kapu_kezdo, size: 16).foregroundStyle(Tokens.Colors.accent)
                    Text(next).font(.inter(15, 620)).foregroundStyle(Tokens.Colors.text).lineLimit(1)
                }
            }
        }
        .padding(.horizontal, 6)
    }
}

/// Szűk alak, bal: ikon – mérésnél a státusz (a tónus színében), navigációnál a manőver, figyelésnél a GPS.
struct IslandCompactLeading: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            LiveIcon(name: m.tone.icon, size: 20).foregroundStyle(m.tone.color)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 20).foregroundStyle(Tokens.Colors.accent)
        } else {
            LiveIcon(name: .gps, size: 18).foregroundStyle(Tokens.Colors.accent)
        }
    }
}

/// Szűk alak, jobb: a fő szám – az átlag, a manőver távolsága, vagy a sebesség.
struct IslandCompactTrailing: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(17, 720)).foregroundStyle(m.tone.color)
        } else if let n = state.nav {
            Text(n.distance).font(.num(15, 700)).foregroundStyle(Tokens.Colors.text).lineLimit(1).minimumScaleFactor(0.7)
        } else if let w = state.watch {
            Text(w.speed).font(.num(17, 720)).foregroundStyle(Tokens.Colors.text)
        }
    }
}

struct IslandMinimal: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(14, 720)).foregroundStyle(m.tone.color).minimumScaleFactor(0.6)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 18).foregroundStyle(Tokens.Colors.accent)
        } else if let w = state.watch {
            Text(w.speed).font(.num(14, 720)).foregroundStyle(Tokens.Colors.text).minimumScaleFactor(0.6)
        }
    }
}
