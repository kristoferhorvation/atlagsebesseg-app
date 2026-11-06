import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

/// AW24: az invariánsok iOS-oldali őrei (docs/INVARIANTS.md, a párja: scripts/invariants.mts). Módosítás csak a prompt szó szerinti engedélyével.
@Suite("invariánsok")
struct InvariantsTests {
    private static func source(_ rel: String) throws -> String {
        try String(contentsOf: Repo.iosDir.appendingPathComponent("Atlagsebesseg/\(rel)"), encoding: .utf8)
    }
    private static func repoFile(_ rel: String) throws -> String {
        try String(contentsOf: Repo.iosDir.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent(rel), encoding: .utf8)
    }
    private static func inOrder(_ text: String, _ needles: [String]) -> Bool {
        var from = text.startIndex
        for n in needles {
            guard let r = text.range(of: n, range: from..<text.endIndex) else { return false }
            from = r.upperBound
        }
        return true
    }

    @Test("INV-01: Mapbox Standard 3D épületekkel")
    func inv01() throws {
        let map = try Self.source("Map/MapScreen.swift")
        #expect(map.contains(".mapStyle(.standard("))
        #expect(map.contains("show3dObjects: true"))
        #expect(!map.contains("show3dObjects: false"))
    }

    @Test("INV-02: térképstílusok és fényszabályok")
    func inv02() {
        #expect(MapLook.allCases.map(\.rawValue) == ["vilagos", "szines", "visszafogott"])
        #expect(Settings().terkep == .szines)
        #expect(chooseLightPreset(nil) == .day)
        #expect(MapLook.allCases.map { mapLightPreset($0, .day) } == [.day, .dusk, .day])
        for p in [LightPreset.dawn, .dusk, .night] { #expect(MapLook.allCases.map { mapLightPreset($0, p) } == [p, p, p]) }
        #expect(MapLook.allCases.map(mapThemeIsMonochrome) == [false, false, true])
    }

    @Test("INV-03: a mérőkártya 3 állapota, az átlag dönt")
    func inv03() {
        let s = { (a: Double?, p: Double?) in meterState(averageKmh: a, projectedKmh: p, speedLimitKmh: 130) }
        #expect(s(nil, 120) == nil)
        #expect(s(130, 200) == .jo)
        #expect(s(131, 130) == .lassits)
        #expect(s(131, 131) == .tulGyors)
        #expect(s(140, nil) == .tulGyors)
    }

    @Test("INV-04: a kézi mérés soha nem színezett")
    func inv04() throws {
        #expect(try Self.source("UI/Theme.swift").contains("case .kezi, .keziEredmeny: return .kezi"))
    }

    @Test("INV-05: végleges gombelrendezés")
    func inv05() throws {
        let d = try Self.source("UI/DriveView.swift")
        #expect(Self.inOrder(d, ["private var upperRow", "Spacer(minLength: 0)", "ManualMini(", "recenterButton", "private var hud", "Spacer()", "Icon(name: .sliders", "Icon(name: .stopwatch", "Icon(name: .report"]))
    }

    @Test("INV-06: a hőtérkép-váltó a webes spec szerint")
    func inv06() throws {
        #expect(FileManager.default.fileExists(atPath: Repo.root.appendingPathComponent("docs/parity/specs/heat-switch.json").path))
        #expect(try Self.source("UI/HeatViews.swift").contains("HeatSwitch"))
    }

    @Test("INV-07: a webes színvilág az etalon (a generált tokenek a lockkal egyeznek)")
    func inv07() throws {
        struct Lock: Decodable { let colors: [String: String] }
        let lock = try JSONDecoder().decode(Lock.self, from: Data(contentsOf: Repo.root.appendingPathComponent("docs/invariants.lock.json")))
        let tokens = try Self.source("Generated/DesignTokens.swift")
        #expect(!lock.colors.isEmpty)
        for (k, v) in lock.colors where v.hasPrefix("#") {
            let hex = v.dropFirst().uppercased()
            #expect(tokens.uppercased().contains(hex), "token \(k)")
        }
    }

    @Test("INV-08: kijelzőnevek")
    func inv08() throws {
        let want: [Lang: String] = [.hu: "Átlagsebesség", .en: "Tempomate", .de: "Tempo Nav", .sk: "Rýchlosť Nav", .cs: "Prům. rychlost", .pl: "Prędkość Nav"]
        for (l, v) in want { #expect(try Repo.dictionary(l)["ios.displayName"] == v) }
        #expect(try Repo.dictionary(.en)["app.name"] == "Tempomate")
        #expect(try Repo.dictionary(.hu)["app.name"] == "Átlagsebesség")
    }

    @Test("INV-09: a Bejelentés lap alsó szövege szó szerint")
    func inv09() throws {
        #expect(try Repo.dictionary(.hu)["report.note.default"] == "A jelenlegi helyed és haladási irányod kerül a bejelentésbe. Ideiglenes szakasz: a mérés végén a „Vége” gomb jelenti be a záró kaput.")
        #expect(try Self.source("UI/ReportViews.swift").contains(".reportNoteDefault"))
    }

    @Test("INV-10: zóna alap 200 m, út eleje és vége 300 m")
    func inv10() {
        #expect(HEAT.zoneDefaultM == 200)
        #expect(HEAT.shareEndsM == 300)
        #expect(ZONE_RADII == [200, 500, 1000])
    }

    @Test("INV-11: az alternatíva megéri-szabálya")
    func inv11() {
        #expect([ALT_OFFER.minGainS, ALT_OFFER.worthNetMin, ALT_OFFER.kSlow, ALT_OFFER.kFast] == [120, 2, 1, 0.3])
        #expect(altWorth(240, 0, 100).verdict == .worth)
        #expect(altWorth(180, 2000, 40).verdict == .maybe)
        #expect(altWorth(120, 3000, 30).verdict == .not)
    }

    @Test("INV-12: dugó-küszöbök")
    func inv12() {
        #expect([TRAFFIC.jamSlowFraction, TRAFFIC.jamWindowMs, TRAFFIC.lightPatienceMs, TRAFFIC.lightNearM, TRAFFIC.jamClearFraction] == [0.4, 180_000, 120_000, 60, 0.7])
        #expect([TRAFFIC.jamClearCityM, TRAFFIC.jamClearCityMs, TRAFFIC.jamClearHighwayM, TRAFFIC.jamClearHighwayMs] == [1000, 120_000, 3000, 180_000])
    }

    @Test("INV-13: krúzing-küszöbök")
    func inv13() {
        #expect([TRIP.startKmh, TRIP.startHoldS, TRIP.maxAccuracyM] == [15, 30, 30])
    }

    @Test("INV-14: a GPS-jelölő folyamatosság-tesztje megvan")
    func inv14() throws {
        let t = try String(contentsOf: Repo.iosDir.appendingPathComponent("AtlagsebessegTests/PositionSmootherTests.swift"), encoding: .utf8)
        #expect(t.contains("valódi 1 Hz-es nyomat"))
    }

    @Test("INV-15: web↔iOS paritás-kapu és specek")
    func inv15() throws {
        let specs = try FileManager.default.contentsOfDirectory(atPath: Repo.root.appendingPathComponent("docs/parity/specs").path)
        #expect(specs.count >= 20)
    }

    @Test("INV-16: Mapbox-attribúció és logó")
    func inv16() throws {
        let map = try Self.source("Map/MapScreen.swift")
        #expect(map.contains("attributionButton: AttributionButtonOptions(position: .topTrailing"))
        #expect(map.contains("logo: LogoViewOptions(position: .topLeading"))
    }

    @Test("INV-17: Release-ben nincs teszt-gyorsítás")
    func inv17() throws {
        let m = try Self.source("App/AppModel.swift")
        #expect(Self.inOrder(m, ["func launchSimSpeed", "#if DEBUG", "simSpeed", "#else", "return 4", "#endif"]))
    }

    @Test("INV-18: a hőtérkép vonal-réteg, az útvonal-vonal vastagságával")
    func inv18() throws {
        let m = try Self.source("Map/MapScreen.swift")
        #expect(Tokens.Size.routeLine == 7)
        #expect(m.contains("private static let routeW = Double(Tokens.Size.routeLine)"))
        #expect(m.contains("LineLayer(id: \"heat-layer\", source: \"heat\")"))
        #expect(Self.inOrder(m, ["LineLayer(id: \"heat-layer\"", ".lineCap(.round)", ".lineJoin(.round)", ".lineWidth(Self.routeW)"]))
        #expect(!m.contains("HeatmapLayer"))
    }

    @Test("INV-19: krúzing-kártya")
    func inv19() throws {
        let tokens = try Self.source("Generated/DesignTokens.swift")
        #expect(tokens.contains("static let cruiseCard"))
        let d = try Self.source("UI/DriveView.swift")
        #expect(d.contains("CruiseCardView(card: card)"))
        #expect(d.contains("return CGFloat(112)"))
        #expect(d.contains("cruiseIsStrip ? 158 : 112"))
        #expect(try Self.source("UI/CruiseCardView.swift").contains("Tokens.Radius.r28"))
        let v = CruiseView(tripId: "x", startedAt: 0, distanceM: 1000, elapsedS: 60, movingS: 60, dirChanges: 1)
        #expect(cruiseCard(cruise: nil, active: true, collapsed: false, sectionAheadM: nil, unit: .kmh) != .hidden)
        #expect(cruiseCard(cruise: v, active: false, collapsed: false, sectionAheadM: nil, unit: .kmh) == .hidden)
        #expect(LIVE_NEXT_SECTION_M == 5000)
    }

    @Test("INV-20: a Fiók-kártya és a Beállítások sorrendje")
    func inv20() throws {
        let s = try Self.source("UI/SettingsSheet.swift")
        #expect(Self.inOrder(s, ["AccountCard(model: model)", ".settingsGroupDisplay", ".settingsGroupPrivacy", "privacyCard", ".settingsAttribution", "SignOutRow(model: model)"]))
        #expect(Self.inOrder(s, ["private var privacyCard", ".settingsShare", "BackupRow(model: model)", "DeleteAccountRow(model: model)"]))
        #expect(try Self.source("UI/AccountViews.swift").contains("MiniButtonStyle(danger: true, wide: true)"))
    }

    @Test("INV-21: a felhős mentés alapból BE")
    func inv21() {
        #expect(Settings().felhoMentes)
    }

    @Test("INV-22: felső sáv – a logó és az „i” a webes helyen, a sötétítés kihagyja őket")
    func inv22() throws {
        #expect(TopOrnaments.logo == CGRect(x: 8, y: 4, width: 85, height: 21))
        #expect(TopOrnaments.infoCenterFromTrailing == 20 && TopOrnaments.infoCenterY == 16 && TopOrnaments.infoRadius == 12)
        let theme = try Self.source("UI/Theme.swift")
        #expect(theme.contains(".frame(height: top + 140)") && theme.contains(".blendMode(.destinationOut)"))
        #expect(theme.contains("WebInfoBadge()"))
        #expect(try Self.source("Map/MapScreen.swift").contains(".ornamentOptions(.web)"))
        #expect(try Self.source("UI/StartView.swift").contains(".ornamentOptions(.web)"))
    }

    @Test("INV-23: a webes alsó sáv a látható nézetablakhoz mérve (a webes őr: scripts/invariants.mts + webkit:layout)")
    func inv23() throws {
        let standalone = try Self.repoFile("apps/web/src/sw/standalone.ts")
        #expect(standalone.contains("setProperty('--app-h', `${window.innerHeight}px`)"))
        #expect(!standalone.contains("screen.height"))
        #expect(try Self.repoFile("package.json").contains("\"webkit:layout\""))
    }
}
