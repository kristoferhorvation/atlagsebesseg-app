import AtlagsebessegCore
import CoreLocation
import Foundation
import Testing
@testable import Atlagsebesseg

/// A szimulátor-mód: a webes `/?sim` fixtúrák CoreLocation-mockon át, ugyanazon az úton, mint a valódi GPS.
@Suite("szimulátor-mód")
struct SimTests {
    /// Végigjátssza a forgatókönyvet (seek = 1: azonnal), és a mérés nézeteit gyűjti.
    private func replay(_ scenario: SimScenario) throws -> (views: [SessionView], fixture: SimFixture) {
        let fixture = try SimFixture.load(scenario)
        let source = SimLocationSource(fixture, speed: 1, seek: 1)
        let session = TrackingSession(fixture.sections, now: { source.clockMs })
        var views: [SessionView] = []
        source.onLocation = { views.append(session.onFix(GpsFix(location: $0))) }
        source.onGap = { views.append(session.tick()) }
        source.start()
        source.stop()
        return (views, fixture)
    }

    @Test("jó ütem: végig zöld, a végén a határ alatt")
    func jo() throws {
        let (views, _) = try replay(.jo)
        let statuses = views.filter { $0.phase == .meres }.compactMap(\.status)
        #expect(!statuses.isEmpty)
        #expect(statuses.allSatisfy { $0 == .jo })
        #expect(views.last?.phase == .befejezve)
        #expect(views.last?.result?.overLimit == false)
    }

    @Test("túl gyors: túl gyors állapot és határ feletti eredmény")
    func tul() throws {
        let (views, _) = try replay(.tul)
        #expect(views.contains { $0.phase == .meres && $0.status == .tulGyors })
        #expect(views.last?.result?.overLimit == true)
    }

    @Test("gyors, majd lassít: a „lassíts” állapot is előjön (a három állapot a képernyőképekhez)")
    func lassit() throws {
        let (views, _) = try replay(.lassit)
        let statuses = Set(views.filter { $0.phase == .meres }.compactMap(\.status))
        #expect(statuses.contains(.lassits))
        #expect(statuses.contains(.tulGyors))
    }

    @Test("alagút: a kiesés alatt becsült érték")
    func alagut() throws {
        let fixture = try SimFixture.load(.alagut)
        #expect(fixture.samples.contains { $0.dropped })
        let source = SimLocationSource(fixture, speed: 1, seek: 1)
        let session = TrackingSession(fixture.sections, now: { source.clockMs })
        var estimated = false
        source.onLocation = { _ = session.onFix(GpsFix(location: $0)) }
        // a valódi appban másodpercenként jön a tick; a kiesés minden mintájánál becsül
        source.onGap = { if session.tick().live?.estimated == true { estimated = true } }
        source.start()
        source.stop()
        #expect(estimated)
    }

    @Test("Budapest → Győr: a szimulált M1-szakaszon mér, és a kamera a fixtúrában van")
    func navsim() throws {
        let (views, fixture) = try replay(.navsim)
        #expect(fixture.sections.map(\.id) == ["SIM-M1-NAV"])
        #expect(fixture.cameras.count == 1)
        #expect(views.contains { $0.phase == .meres && $0.section?.id == "SIM-M1-NAV" })
        #expect(views.contains { $0.phase == .befejezve })
    }

    /// Végigjátssza a forgatókönyvet a jelzés-figyelőkön (közeledés + tervezett mérés), hang nélkül.
    private func alerts(_ scenario: SimScenario) throws -> (events: [AlertEvent], planned: [String]) {
        let fixture = try SimFixture.load(scenario)
        let source = SimLocationSource(fixture, speed: 1, seek: 1)
        let t0 = Date().timeIntervalSince1970 * 1000
        let checks = fixture.planned.map { $0.check(at: t0) }
        let approach = ApproachWatch()
        let watch = PlannedCheckWatch()
        var events: [AlertEvent] = []
        var planned: [String] = []
        var current: String?
        source.onLocation = { l in
            let fix = GpsFix(location: l)
            events += approach.update(fix, cameras: fixture.cameras.map(\.camera), sections: fixture.sections, unit: .kmh)
            let p = watch.update(fix, checks, now: source.clockMs)?.id
            if let p, p != current { planned.append(p) }
            current = p
        }
        source.start()
        source.stop()
        return (events, planned)
    }

    @Test("Budapest → Győr: szakaszkapu, kamera-elhaladás és tervezett mérés – mindegyik egyszer")
    func navsimJelzesek() throws {
        let (events, planned) = try alerts(.navsim)
        #expect(events.map(\.kind) == [.section, .camera])
        #expect(events.map(\.targetId) == ["SIM-M1-NAV", "sim-nav-cam"])
        #expect(planned == ["sim-nav-planned"])
    }

    @Test("tervezett mérés + kamerák: mindhárom kamera egyszer, a tervezett mérés sávja megjelenik")
    func tervezett() throws {
        let (events, planned) = try alerts(.tervezett)
        #expect(events.filter { $0.kind == .camera }.map(\.targetId).sorted() == ["sim-cam-TEST-1-0", "sim-cam-TEST-1-1", "sim-cam-TEST-1-2"])
        #expect(Set(events.map(\.targetId)).count == events.count)
        #expect(planned == ["sim-planned-TEST-1"])
    }

    @Test("települészóna: a sáv a zónába érve megjelenik")
    func zona() throws {
        let (_, planned) = try alerts(.zona)
        #expect(planned == ["sim-zone-TEST-1"])
    }

    @Test("CLLocation → GpsFix: negatív sebesség / irány / pontosság = ismeretlen")
    func atalakitas() {
        let date = Date(timeIntervalSince1970: 1_700_000_000.25)
        let ok = GpsFix(location: CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.5, longitude: 19.04), altitude: 0, horizontalAccuracy: 6, verticalAccuracy: -1,
            course: 370, courseAccuracy: 5, speed: 30, speedAccuracy: 1, timestamp: date
        ))
        #expect(ok.timestamp == 1_700_000_000_250)
        #expect(ok.speed == 30)
        #expect(ok.accuracy == 6)
        #expect(ok.heading == 10)
        let unknown = GpsFix(location: CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: 47.5, longitude: 19.04), altitude: 0, horizontalAccuracy: -1, verticalAccuracy: -1,
            course: -1, courseAccuracy: -1, speed: -1, speedAccuracy: -1, timestamp: date
        ))
        #expect(unknown.speed == nil)
        #expect(unknown.accuracy == nil)
        #expect(unknown.heading == nil)
    }
}

// MARK: navigációs szimulátor: gyorsabb út kategóriánként (AOS12 – a webes apps/web/src/sim/navSim.test.ts párja)

/// A navigációs szimulátor lejátszása a munkamenettel, a `fromWindow` ablaktól: mérés a szimulált szakaszon (a pozíció a
/// kapui között), az alternatíva-figyelés válaszát a szimulátor adja a kért kategóriával (`-alt`).
@MainActor
private func playNav(_ alt: NavSim.AltMode, _ fromWindow: Int) async throws -> (views: [(view: NavView, measuring: Bool)], voice: [String]) {
    let fixture = try SimFixture.load(.navsim)
    let nav = try #require(fixture.nav)
    let main = try #require(try NavSim.mainRoutes().first)
    let w = nav.windows
    let samples = fixture.samples[w[fromWindow]..<(fromWindow + 1 < w.count ? w[fromWindow + 1] : fixture.samples.count)]
    var t = samples.first!.t
    let session = NavigationSession(
        route: main, destination: NavDestination(name: "Győr", lat: main.points.last!.lat, lon: main.points.last!.lon),
        fetchRoutes: NavSim.fetcher(main: main, nav: nav, alt: alt), now: { t }, lang: .hu
    )
    session.setData(EnforcementData(sections: fixture.sections, cameras: fixture.cameras.map(\.camera)))
    var views: [(view: NavView, measuring: Bool)] = []
    var voice: [String] = []
    for s in samples {
        t = s.t
        let fix = GpsFix(lat: s.lat, lon: s.lon, timestamp: s.t, speed: s.speed, accuracy: s.accuracy, heading: s.heading)
        let v = s.dropped ? session.tick() : session.onFix(fix)
        let sec = v.enforcement.first { $0.kind == .section }
        let measuring = sec.map { v.alongM >= $0.startM && v.alongM <= $0.endM } ?? false
        session.setMeasuring(measuring)
        await session.settle()
        views.append((session.view(), measuring))
        voice += session.drainVoice().filter { $0.kind == .faster }.map(\.text)
    }
    return (views, voice)
}

private func matchesRe(_ s: String?, _ pattern: String) -> Bool {
    guard let s, let re = try? NSRegularExpression(pattern: pattern) else { return false }
    return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}

@Suite("navigációs szimulátor: gyorsabb út kategóriánként (AW12)")
@MainActor
struct NavSimAltTests {
    @Test("a szimulált alternatívák kategóriái: 7 perc / +4 km megéri, 3 perc / +5 km lehet, 10 perc / +40 km nem éri meg")
    func kategoriak() throws {
        let alts = try #require(try SimFixture.load(.navsim).nav).alts
        #expect(alts["worth"]?.gainS == 420 && alts["worth"]?.extraM == 4000)
        #expect((alts["maybe"]?.gainS ?? 0) >= 120)
        #expect(Set(alts.keys) == Set(NavSim.AltMode.allCases.map(\.rawValue)))
    }

    private func outside(_ mode: NavSim.AltMode, _ verdict: AltVerdict, _ title: String) async throws {
        let (views, voice) = try await playNav(mode, 0)
        let offer = views.first { $0.view.offer != nil }?.view.offer
        #expect(offer?.verdict == verdict)
        #expect(matchesRe(offer?.title, title))
        #expect(matchesRe(voice.first, "^Gyorsabb út"))
    }

    @Test("?alt=worth: az 1. ablakban (mérésen kívül) „worth” ajánlat, bemondással")
    func worth() async throws { try await outside(.worth, .worth, #"^Megéri · −7 perc, \+4 km$"#) }

    @Test("?alt=maybe: az 1. ablakban (mérésen kívül) „maybe” ajánlat, bemondással")
    func maybe() async throws { try await outside(.maybe, .maybe, #"^Lehet · −3 perc, \+5 km$"#) }

    @Test("?alt=not: az 1. ablakban (mérésen kívül) „not” ajánlat, bemondással")
    func not() async throws { try await outside(.not, .not, #"^Nem éri meg · \+40 km kerülő, −10 perc$"#) }

    @Test("?alt=aftergate (AW13): mérés közben a végkapu után 500 m-rel lehajtó alternatíva → azonnal, kompakt ajánlat bemondással")
    func aftergate() async throws {
        let (views, voice) = try await playNav(.aftergate, 1)
        let shown = try #require(views.first { $0.view.offer != nil })
        #expect(shown.measuring)
        let offer = try #require(shown.view.offer)
        #expect(offer.compact)
        #expect(offer.verdict == .worth)
        // a lehajtó a kapu után van: a kártyán a lehajtóig hátralévő táv nagyobb, mint a kapuig
        let sec = try #require(shown.view.enforcement.first { $0.kind == .section })
        #expect(offer.exitInM > sec.endM - shown.view.alongM)
        #expect(matchesRe(voice.first, #"^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$"#))
    }

    @Test("?alt=worth ugyanott: mérés közben a lehajtó a szakaszon belül → kompakt ajánlat")
    func worthMeresKozben() async throws {
        let (views, _) = try await playNav(.worth, 1)
        let shown = try #require(views.first { $0.view.offer != nil })
        #expect(shown.measuring)
        #expect(shown.view.offer?.compact == true)
    }

    @Test("kamera-közeledés a 2. ablakban: a kamera max(250 m, 10 s × sebesség)-en belül borostyán, elhaladás után eltűnik")
    func kamera() async throws {
        let (views, _) = try await playNav(.worth, 1)
        let near = views.compactMap { $0.view.cameraNear?.distanceM }
        #expect(near.count > 3)
        // ~120 km/h: 10 s × 33 m/s ≈ 330 m (a 250 m-es alsó határ fölött)
        #expect((near.max() ?? 0) > 260)
        #expect((near.max() ?? 999) < 370)
        let last = try #require(views.lastIndex { $0.view.cameraNear != nil })
        #expect(last + 1 >= views.count || views[last + 1].view.cameraNear == nil)
    }
}

// MARK: helyhozzáférés (AW13 iOS-megfelelője)

@Suite("helyhozzáférés: a GPS-pill koppintása (iOS)")
@MainActor
struct LocationAccessTests {
    @Test("nem eldöntött → kérés; tiltva vagy korlátozva → lap a Beállítások-megnyitással; engedélyezve → semmi")
    func pill() {
        #expect(LocationPermission(.notDetermined) == .notDetermined)
        #expect(LocationPermission(.denied) == .denied)
        #expect(LocationPermission(.restricted) == .denied)
        #expect(LocationPermission(.authorizedWhenInUse) == .granted)
        #expect(gpsPillAction(.notDetermined, .searching) == .request)
        #expect(gpsPillAction(.denied, .denied) == .deniedHelp)
        #expect(gpsPillAction(.denied, .searching) == .deniedHelp)
        #expect(gpsPillAction(.granted, .active) == .none)
        // a rendszerszintű Helymeghatározás kikapcsolva: az app engedélye megvan, mégis tiltott
        #expect(gpsPillAction(.granted, .denied) == .deniedHelp)
        // leállított GPS-nél és a szimulátorban nincs mit kérni
        #expect(gpsPillAction(.notDetermined, .off) == .none)
        #expect(gpsPillAction(.denied, .sim) == .none)
    }
}
