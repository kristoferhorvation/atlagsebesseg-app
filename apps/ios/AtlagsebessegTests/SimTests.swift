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
