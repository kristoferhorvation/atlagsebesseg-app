import AppIntents
import SwiftUI
import UIKit

// AOS14: a Live Activity nézetei. A widget-kiterjesztés (DriveLiveActivity.swift) és az app szimulátoros előnézete
// (Sim/LiveActivityPreview.swift – ha a szimulátor a lezárt képernyőt / Dynamic Islandet nem tudja lefotózni) is fordítja.
// AOS15: öt állapot (figyel / navigáció / mérés / mérés + navigáció / kézi), a lezárt képernyőn bal oldalt térképkép.
// A lezárt képernyő az app arca: nagy számok, levegős sorköz, a tokenek színei (DESIGN.md › Live Activity).

typealias LiveState = DriveActivityAttributes.ContentState

/// A rendszer a 160 pt-nél magasabb lezárt képernyős / kibontott tartalmat levágja (AOS16: LiveActivityTests méri).
let LIVE_MAX_HEIGHT: CGFloat = 160

/// A lezárt képernyő: bal oldalt a térképkép (ha van), mellette az állapot tartalma; mérés + navigáció esetén a manőver egy
/// kompakt sorban alul, teljes szélességben, ilyenkor a kép és az átlag kisebb, hogy minden beférjen a 160 pt-be.
struct LockScreenView: View {
    let state: LiveState
    /// A térképkép felülírása (galéria, mérő-teszt); `nil`: az App Group tárolóból.
    var mapImage: UIImage?

    var body: some View {
        let dense = state.measure != nil && state.nav != nil
        // AOS18: a Haza / Munka gomb mellett a kisebb kép: a krúzing-sorok így nem vágódnak le
        let withButtons = state.watch?.homeLabel != nil || state.watch?.workLabel != nil
        let image = mapImage ?? state.mapVersion.flatMap(LiveMapImage.load)
        VStack(alignment: .leading, spacing: dense ? 6 : 8) {
            HStack(alignment: .center, spacing: 12) {
                if let image {
                    MapThumb(image: image, tone: state.measure?.tone.color ?? Tokens.Colors.brand, size: dense || withButtons ? 62 : 84)
                }
                Group {
                    if let m = state.measure {
                        MeasureBlock(m: m, figures: false, dense: dense)
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
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        // a térképkép attribúciója (a képről a logó és a felirat kikerült) – halványan, az alsó margóban (nem növeli a magasságot)
        .overlay(alignment: .bottomLeading) {
            if let a = state.attribution, image != nil {
                Text(a)
                    .font(.inter(Tokens.FontSize.f8, Tokens.FontWeight.w500))
                    .foregroundStyle(Tokens.Colors.textFaint)
                    .padding(.leading, 16)
                    .padding(.bottom, 3)
            }
        }
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
    var size: CGFloat = 84

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size >= 80 ? 18 : 14, style: .continuous)
        Image(uiImage: image)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(shape)
            .overlay {
                ZStack {
                    Circle().fill(tone.opacity(Tokens.Opacity.o28)).frame(width: 30, height: 30)
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
                    Circle().fill(Tokens.Colors.brand).frame(width: 7, height: 7)
                    Text(w.title).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    // AOS17: a krúzing-sorok és a következő szakasz mellett is 160 pt-en belül
                    Text(w.speed).font(.num(w.cruise != nil && w.nextSection != nil ? Tokens.FontSize.f40 : Tokens.FontSize.f50, Tokens.FontWeight.w720)).tracking(-1.5)
                        .foregroundStyle(w.speedOver ? Tokens.StatusColors.tul_gyors : Tokens.Colors.text)
                    Text(w.unit).font(.inter(Tokens.FontSize.f16, Tokens.FontWeight.w600)).foregroundStyle(Tokens.Colors.textMuted)
                }
                if let next = w.nextSection {
                    HStack(spacing: 6) {
                        LiveIcon(name: .kapu_kezdo, size: 16).foregroundStyle(Tokens.Colors.brand)
                        Text(next).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w620)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                }
                // AOS17: a futó út km · idő · átlag és az irányváltások száma
                if let c = w.cruise {
                    Text(c).font(.num(Tokens.FontSize.f13, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.7)
                }
                if let d = w.dirChanges {
                    Text(d).font(.num(Tokens.FontSize.f13, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.7)
                }
            }
            Spacer(minLength: 0)
            if let limit = w.limit { Sign(text: limit, size: 54) }
            // AOS18: Haza / Munka – csak mentett helynél; koppintásra az app előtérbe jön, a navigáció azonnal indul
            if w.homeLabel != nil || w.workLabel != nil {
                VStack(spacing: 6) {
                    if let l = w.homeLabel { destButton(l, .home, LiveNavRouter.home) }
                    if let l = w.workLabel { destButton(l, .work, LiveNavRouter.work) }
                }
            }
        }
    }

    private func destButton(_ label: String, _ icon: IconName, _ dest: String) -> some View {
        Button(intent: StartNavIntent(dest: dest)) {
            HStack(spacing: 4) {
                LiveIcon(name: icon, size: 16).foregroundStyle(Tokens.Colors.brand)
                Text(label).font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.text).lineLimit(1).minimumScaleFactor(0.75)
            }
            .frame(width: 74, height: 40)
            .background(Tokens.Colors.fill10, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// b) Navigáció: manőver + távolság nagyban, utcanév, érkezés · hátralévő idő és út, „+N perc dugó”.
struct NavBlock: View {
    let nav: DriveActivityAttributes.Nav

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Glyph(maneuver: nav.maneuver, size: 38).foregroundStyle(Tokens.Colors.brand)
                Text(nav.distance).font(.num(Tokens.FontSize.f36, Tokens.FontWeight.w720)).tracking(-0.8).lineLimit(1).minimumScaleFactor(0.7)
            }
            Text(nav.street).font(.inter(Tokens.FontSize.f17, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(nav.eta).font(.num(Tokens.FontSize.f17, Tokens.FontWeight.w700))
                Text(nav.remaining).font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
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
            .font(.inter(Tokens.FontSize.f14, Tokens.FontWeight.w650))
            .foregroundStyle(Tokens.Colors.near)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .background(Tokens.Colors.near.opacity(Tokens.Opacity.o16), in: Capsule())
    }
}

/// c) / e) Mérés: az átlag nagyban a tónus színében (kézinél accent), a tábla, „Maradj X alatt”, most · várható · hátra; kézi
/// mérésnél az eltelt idő a tábla helyén.
struct MeasureBlock: View {
    let m: DriveActivityAttributes.Measure
    /// A „most · várható · hátra” sor a blokkban (a lezárt képernyőn külön, teljes szélességben).
    var figures = true
    /// Mérés + navigáció: kisebb átlag, a felirat mellette (a 160 pt miatt).
    var dense = false

    var body: some View {
        VStack(alignment: .leading, spacing: dense ? 0 : 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(m.title).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                Spacer(minLength: 0)
                if let a = m.advice {
                    Text(a).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w680)).foregroundStyle(m.tone == .jo ? Tokens.Colors.textMuted : m.tone.color).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            HStack(alignment: .center, spacing: 10) {
                if dense {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(m.avg).font(.num(Tokens.FontSize.f38, Tokens.FontWeight.w720)).tracking(-1).foregroundStyle(m.tone.color).lineLimit(1)
                        Text(m.avgLabel).font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
                    }
                } else {
                    VStack(alignment: .leading, spacing: -2) {
                        Text(m.avg).font(.num(Tokens.FontSize.f50, Tokens.FontWeight.w720)).tracking(-1.5).foregroundStyle(m.tone.color).minimumScaleFactor(0.6).lineLimit(1)
                        Text(m.avgLabel).font(.inter(Tokens.FontSize.f14, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if let limit = m.limit {
                    Sign(text: limit, size: dense ? 42 : 54)
                } else if let e = m.elapsed {
                    VStack(alignment: .trailing, spacing: 2) {
                        LiveIcon(name: .stopwatch, size: 18).foregroundStyle(Tokens.Colors.textMuted)
                        Text(e).font(.num(Tokens.FontSize.f26, Tokens.FontWeight.w700)).monospacedDigit()
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
                    Text(rem).font(.num(Tokens.FontSize.f14, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
        }
    }

    private func figure(_ label: String, _ value: String, over: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).fixedSize()
            Text(value).font(.num(Tokens.FontSize.f19, Tokens.FontWeight.w700)).lineLimit(1).fixedSize().foregroundStyle(over ? Tokens.StatusColors.tul_gyors : Tokens.Colors.text)
        }
    }
}

/// d) Mérés közben a navigáció egy kompakt sorban: ikon, távolság, utcanév, érkezés.
struct NavLine: View {
    let nav: DriveActivityAttributes.Nav

    var body: some View {
        HStack(spacing: 8) {
            Glyph(maneuver: nav.maneuver, size: 20).foregroundStyle(Tokens.Colors.brand)
            Text(nav.distance).font(.num(Tokens.FontSize.f16, Tokens.FontWeight.w700)).foregroundStyle(Tokens.Colors.text).lineLimit(1).fixedSize()
            Text(nav.street).font(.inter(Tokens.FontSize.f15, Tokens.FontWeight.w560)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1)
            Spacer(minLength: 0)
            if let d = nav.delay {
                // a dugó teljesen látszik, az utcanév rövidül
                Text(d).font(.inter(Tokens.FontSize.f13, Tokens.FontWeight.w650)).foregroundStyle(Tokens.Colors.near).lineLimit(1).fixedSize()
            }
            Text(nav.eta).font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w620)).foregroundStyle(Tokens.Colors.textMuted).lineLimit(1).fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Tokens.Colors.surfaceRaised, in: RoundedRectangle(cornerRadius: Tokens.Radius.r12, style: .continuous))
    }
}

/// KRESZ-tábla stílusú sebességhatár (a webes / appbeli `LimitSign` kicsiben).
struct Sign: View {
    let text: String
    let size: CGFloat

    var body: some View {
        Text(text)
            .font(.num(size * 0.36, Tokens.FontWeight.w760))
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

/// Szűk alak, bal: ikon – mérésnél a státusz (a tónus színében), navigációnál a manőver, figyelésnél a GPS.
struct IslandCompactLeading: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            LiveIcon(name: m.tone.icon, size: 20).foregroundStyle(m.tone.color)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 20).foregroundStyle(Tokens.Colors.brand)
        } else {
            LiveIcon(name: .gps, size: 18).foregroundStyle(Tokens.Colors.brand)
        }
    }
}

/// Szűk alak, jobb: a fő szám – az átlag, a manőver távolsága, vagy a sebesség.
struct IslandCompactTrailing: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(Tokens.FontSize.f17, Tokens.FontWeight.w720)).foregroundStyle(m.tone.color)
        } else if let n = state.nav {
            Text(n.distance).font(.num(Tokens.FontSize.f15, Tokens.FontWeight.w700)).foregroundStyle(Tokens.Colors.text).lineLimit(1).minimumScaleFactor(0.7)
        } else if let w = state.watch {
            Text(w.speed).font(.num(Tokens.FontSize.f17, Tokens.FontWeight.w720)).foregroundStyle(Tokens.Colors.text)
        }
    }
}

struct IslandMinimal: View {
    let state: LiveState

    var body: some View {
        if let m = state.measure {
            Text(m.avg).font(.num(Tokens.FontSize.f14, Tokens.FontWeight.w720)).foregroundStyle(m.tone.color).minimumScaleFactor(0.6)
        } else if let n = state.nav {
            Glyph(maneuver: n.maneuver, size: 18).foregroundStyle(Tokens.Colors.brand)
        } else if let w = state.watch {
            Text(w.speed).font(.num(Tokens.FontSize.f14, Tokens.FontWeight.w720)).foregroundStyle(Tokens.Colors.text).minimumScaleFactor(0.6)
        }
    }
}
