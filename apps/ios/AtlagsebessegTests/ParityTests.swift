import AtlagsebessegCore
import Foundation
import SwiftUI
import Testing
import UIKit
@testable import Atlagsebesseg

// AOS18 (1.2): a jóváhagyott webes komponensek mért mérete és computed style-ja (`docs/parity/specs/*.json`, `npm run parity:specs`) az iOS-en: a SwiftUI nézet mért
// geometriája és a tokenek. A térképi és a teljes lapos nézeteket a képernyő-diff kapu (`npm run parity`) méri.

private struct ParitySpec: Decodable {
    struct Box: Decodable { let w: CGFloat; let h: CGFloat }
    struct Part: Decodable { let box: Box; let style: [String: String] }
    let component: String
    let webFile: String
    let parts: [String: Part]

    static func load(_ name: String) throws -> ParitySpec {
        let url = Repo.root.appendingPathComponent("docs/parity/specs/\(name).json")
        return try JSONDecoder().decode(ParitySpec.self, from: Data(contentsOf: url))
    }

    func part(_ name: String) throws -> Part { try #require(parts[name], "\(component): nincs \(name)") }
}

private extension ParitySpec.Part {
    func px(_ key: String) -> CGFloat { CGFloat(Double((style[key] ?? "").replacingOccurrences(of: "px", with: "")) ?? .nan) }
    var color: String { style["color"] ?? "" }
    var background: String { style["backgroundColor"] ?? "" }
}

/// `rgb(r, g, b)` / `rgba(r, g, b, a)` / `color(srgb r g b / a)` → komponensek (0…1).
private func cssColor(_ s: String) -> [Double] {
    if s.hasPrefix("color(srgb") {
        let n = s.replacingOccurrences(of: "color(srgb", with: "").replacingOccurrences(of: ")", with: "").replacingOccurrences(of: "/", with: " ").split(separator: " ").compactMap { Double($0) }
        return n.count == 3 ? n + [1] : n
    }
    let n = s.replacingOccurrences(of: "rgba(", with: "").replacingOccurrences(of: "rgb(", with: "").replacingOccurrences(of: ")", with: "").split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    return n.count == 3 ? [n[0] / 255, n[1] / 255, n[2] / 255, 1] : n.count == 4 ? [n[0] / 255, n[1] / 255, n[2] / 255, n[3]] : []
}

private func comps(_ c: Color) -> [Double] {
    var (r, g, b, a) = (CGFloat(0), CGFloat(0), CGFloat(0), CGFloat(0))
    UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
    return [r, g, b, a].map(Double.init)
}

private func same(_ token: Color, _ css: String, _ note: String) {
    let a = comps(token), b = cssColor(css)
    #expect(a.count == b.count && zip(a, b).allSatisfy { abs($0 - $1) < 0.01 }, "\(note): token \(a) ≠ web \(css)")
}

private func measured<V: View>(_ v: V, width: CGFloat? = nil) -> CGSize {
    let c = UIHostingController(rootView: v)
    return c.sizeThatFits(in: CGSize(width: width ?? .greatestFiniteMagnitude, height: .greatestFiniteMagnitude))
}

private func close(_ got: CGFloat, _ want: CGFloat, _ note: String, tol: CGFloat = 3) {
    #expect(abs(got - want) <= tol, "\(note): iOS \(got) pt ≠ web \(want) px")
}

private let hudWidth: CGFloat = 402 - 24

/// Szakaszmérés-állapot a közös szimulátor-vezetésből.
private func measuringView() throws -> SessionView {
    let fx = try SimFixture.load(.jo)
    var clock = fx.samples[0].t
    let session = TrackingSession(fx.sections, now: { clock })
    for s in fx.samples {
        clock = s.t
        guard !s.dropped else { continue }
        let v = session.onFix(GpsFix(lat: s.lat, lon: s.lon, timestamp: s.t, speed: s.speed, accuracy: s.accuracy, heading: s.heading))
        if v.phase == .meres, (v.progress ?? 0) > 0.5, v.status != nil { return v }
    }
    throw CancellationError()
}

@Suite("paritás: webes komponens-spec ↔ SwiftUI")
struct ParityTests {
    @Test("a tokenek sRGB-ben (nem Display P3), a kitöltések a webes computed style-lal egyeznek")
    func tokenek() throws {
        let pills = try ParitySpec.load("pills")
        same(Tokens.Colors.pillSurface, try pills.part("gps").background, "pill háttér")
        same(Tokens.Colors.textMuted, try pills.part("text").color, "pill felirat")
        same(Tokens.StatusColors.jo, try pills.part("icon").color, "GPS-ikon")
        let actions = try ParitySpec.load("actions")
        same(Tokens.Colors.surface, try actions.part("button").background, "kerek gomb")
        same(Tokens.Colors.near, try actions.part("report").color, "Bejelentés-ikon: borostyán")
        let re = try ParitySpec.load("recenter")
        same(Tokens.Colors.brand, try re.part("button").color, "„Vissza a helyemre”: brand")
        let heat = try ParitySpec.load("heat-switch")
        same(Tokens.Colors.fill08, try heat.part("box").background, "hőtérkép-váltó tok")
        same(Tokens.Colors.text, try heat.part("selected").background, "kiválasztott szegmens")
        same(Tokens.Colors.signText, try heat.part("selected").color, "kiválasztott felirat")
        let rows = try ParitySpec.load("settings-rows")
        same(Tokens.Colors.surfaceRaised, try rows.part("list").background, "lista")
        same(Tokens.Colors.textFaint, try rows.part("group").color, "csoportcím")
        let label = try ParitySpec.load("route-label")
        same(Tokens.Colors.signFace, try label.part("bubble").background, "„+N perc” címke: fehér")
        same(Tokens.Colors.signText, try label.part("bubble").color, "„+N perc” címke: fekete")
        let puck = try ParitySpec.load("gps-marker")
        same(Tokens.Colors.brand, try puck.part("dot").background, "GPS-jelölő")
    }

    @Test("sarkok, betűméretek és árnyék a spec szerint")
    func stilus() throws {
        let a = try ParitySpec.load("actions")
        #expect(try a.part("button").style["boxShadow"]?.contains("rgba(0, 0, 0, 0.65) 0px 24px 60px -12px") == true)
        #expect(Tokens.Shadow.card[0].y == 24 && Tokens.Shadow.card[0].blur == 60 && Tokens.Shadow.card[0].spread == -12)
        let g = try ParitySpec.load("greeting")
        #expect(try g.part("root").px("fontSize") == Tokens.FontSize.f22)
        #expect(try g.part("root").style["fontWeight"] == "640")
        let n = try ParitySpec.load("meter-full")
        #expect(try n.part("num").px("fontSize") == Tokens.FontSize.f44)
        #expect(try n.part("progress").box.h == Tokens.Size.progress)
        let top = try ParitySpec.load("nav-top")
        #expect(try top.part("dist").px("fontSize") == Tokens.FontSize.f46)
        #expect(try top.part("road").px("fontSize") == Tokens.FontSize.f26)
        #expect(try top.part("root").px("borderTopLeftRadius") == Tokens.Radius.r28)
        let r = try ParitySpec.load("route-picker")
        #expect(try r.part("duration").px("fontSize") == Tokens.FontSize.f28)
        #expect(try r.part("title").px("fontSize") == Tokens.FontSize.f24)
        #expect(try r.part("start").box.h == 64)
        let z = try ParitySpec.load("zone-picker")
        #expect(try z.part("selected").box.h == 30)
        #expect(try z.part("selected").px("fontSize") == Tokens.FontSize.f14)
        let t = try ParitySpec.load("report-tiles")
        #expect(try t.part("tile").box.h >= Tokens.Size.tile)
        #expect(try t.part("icon").box.w == 44)
        #expect(try t.part("label").px("fontSize") == Tokens.FontSize.f18)
    }

    @Test("kerek gomb, pill, köszöntés: mért méret = web")
    func kisElemek() throws {
        let a = try ParitySpec.load("actions")
        let round = measured(Button {} label: { Icon(name: .report, size: 28) }.buttonStyle(RoundButtonStyle()))
        close(round.width, try a.part("button").box.w, "kerek gomb", tol: 0.5)
        close(round.height, try a.part("button").box.h, "kerek gomb", tol: 0.5)
        let p = try ParitySpec.load("pills")
        let pill = measured(StatusPill(icon: .gps, color: Tokens.StatusColors.jo, text: "GPS ±5 m"))
        close(pill.width, try p.part("gps").box.w, "GPS-pill")
        close(pill.height, try p.part("gps").box.h, "GPS-pill", tol: 0.5)
        let wake = measured(StatusPill(icon: .screen, color: Tokens.StatusColors.jo, text: t(.pillWakeOn, lang: .hu)))
        close(wake.width, try p.part("wake").box.w, "Kijelző-pill")
        let g = try ParitySpec.load("greeting")
        let greet = measured(GreetingPill(text: "Szia!"))
        close(greet.width, try g.part("root").box.w, "köszöntés")
        close(greet.height, try g.part("root").box.h, "köszöntés")
    }

    @Test("GPS-jelölő: 60 pt, kék pont, nem a Mapbox alap-nyila")
    func gpsJelolo() throws {
        let s = try ParitySpec.load("gps-marker")
        let m = measured(Puck(rotation: 0, pitch: 0))
        close(m.width, try s.part("root").box.w, "puck", tol: 0.5)
        #expect(try s.part("dot").box.w == 22)
    }

    @Test("mérőkártya: alapállapot, teljes, kompakt; kézi kártya álló helyzetben sem üres")
    func merokartya() throws {
        let idle = measured(MeterCard(view: SessionView(), settings: .default, gpsReady: true), width: hudWidth)
        close(idle.height, try ParitySpec.load("idle-card").part("root").box.h, "alapállapot")
        let v = try measuringView()
        let full = measured(MeterCard(view: v, settings: .default, gpsReady: true), width: hudWidth)
        close(full.height, try ParitySpec.load("meter-full").part("root").box.h, "teljes mérőkártya", tol: 4)
        let compact = measured(MeterCard(view: v, settings: .default, gpsReady: true, meterCompact: true), width: hudWidth)
        close(compact.height, try ParitySpec.load("meter-compact").part("root").box.h, "kompakt mérőkártya")
        var clock = 0.0
        let session = TrackingSession([], now: { clock })
        clock = 1000
        let manual = session.startManual()
        #expect(manual.phase == .kezi)
        let card = measured(MeterCard(view: manual, settings: .default, gpsReady: true), width: hudWidth)
        close(card.height, try ParitySpec.load("manual-card").part("root").box.h, "kézi kártya", tol: 4)
    }

    @Test("navigáció: alsó sáv, felső kártya és kompakt ajánlat")
    func navigacio() async throws {
        let views = try await playNav(.worth, 1).views.map(\.view)
        let plain = try #require(views.first { $0.offer == nil && $0.then != nil && $0.upcoming == nil && $0.next.text.count < 18 } ?? views.first { $0.offer == nil })
        let bottom = measured(NavBottomBar(view: plain, unit: .kmh, currentKmh: 60, onEnd: {}), width: hudWidth)
        close(bottom.height, try ParitySpec.load("nav-bottom").part("root").box.h, "alsó sáv")
        let spec = try ParitySpec.load("offer-compact")
        if let offer = views.compactMap(\.offer).first(where: \.compact) {
            let o = measured(OfferCard(offer: offer, onAccept: {}, onDecline: {}), width: hudWidth)
            close(o.height, try spec.part("root").box.h, "kompakt ajánlat", tol: 4)
        }
        close(try spec.part("button").box.h, Tokens.Size.touch, "ajánlat gomb", tol: 0)
    }

    @Test("Bejelentés lap, Beállítások sorok, zóna-választó")
    func lapok() throws {
        let s = try ParitySpec.load("settings-rows")
        let toggle = measured(Toggle("", isOn: .constant(true)).labelsHidden().toggleStyle(SwitchStyle()))
        close(toggle.width, try s.part("switch").box.w, "kapcsoló", tol: 0.5)
        close(toggle.height, try s.part("switch").box.h, "kapcsoló", tol: 0.5)
        let group = measured(GroupLabel(text: t(.settingsGroupDisplay, lang: .hu)), width: 368)
        close(group.height, try s.part("group").box.h, "csoportcím")
        let z = try ParitySpec.load("zone-picker")
        let seg = measured(Segmented(options: [(200, "200 m"), (500, "500 m"), (1000, "1 km")], selection: .constant(200), stretch: false, compact: true).fixedSize())
        close(seg.width, try z.part("box").box.w, "zóna-választó", tol: 5)
        close(seg.height, try z.part("box").box.h, "zóna-választó", tol: 0.5)
        let r = try ParitySpec.load("report-tiles")
        let sheet = measured(ReportSheet(fix: GpsFix(lat: 47.5, lon: 19, timestamp: 0, speed: 0, accuracy: 5, heading: nil), online: true, sending: nil, gateStarted: false, onPick: { _, _, _ in }, onClose: {}), width: try r.part("root").box.w - 2)
        close(sheet.height, try r.part("root").box.h, "Bejelentés lap", tol: 6)
    }

    @Test("minden spec a webes forrásra hivatkozik, és a fájl létezik")
    func hivatkozas() throws {
        let dir = Repo.root.appendingPathComponent("docs/parity/specs")
        let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).filter { $0.pathExtension == "json" }
        #expect(files.count >= 18)
        for f in files {
            let spec = try ParitySpec.load(f.deletingPathExtension().lastPathComponent)
            #expect(FileManager.default.fileExists(atPath: Repo.root.appendingPathComponent(spec.webFile).path), "\(spec.webFile)")
        }
    }
}
