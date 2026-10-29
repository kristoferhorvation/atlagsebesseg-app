import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// packages/app-logic/test/navigation.test.ts – az A11-es iOS-port tesztjei: egy TS `it` = egy Swift `@Test`, azonos névvel,
// ugyanazon a közös fixtúrán (packages/app-logic/src/navigation/fixtures/budapest-gyor.directions.json).

// MARK: segédek

private let T0 = 1_800_000_000_000.0
private let ORIGIN = LatLon(lat: 47.5, lon: 19.0)

/// A vitest `toBeCloseTo(b, digits)`: |a − b| < 10^(−digits) / 2.
private func close(_ a: Double?, _ b: Double, _ digits: Int = 2) -> Bool {
    guard let a else { return false }
    return abs(a - b) < pow(10, Double(-digits)) / 2
}

/// Egyenes, kelet felé futó teszt-útvonal: `lengthM` hosszú, `durationS` idejű, lépésenként 1 km.
private func lineRoute(lengthM: Double = 10_000, durationS: Double = 360, latOffset: Double = 0, limit: Double? = 90, id: String = "line") -> NavRoute {
    let proj = LocalProjection(LatLon(lat: ORIGIN.lat + latOffset, lon: ORIGIN.lon))
    let n = Int(jsRound(lengthM / 100))
    let points = (0...n).map { proj.fromXY(XY(x: Double($0) * lengthM / Double(n), y: 0)) }
    let km = Int((lengthM / 1000).rounded(.up))
    let steps = (0..<km).map { i -> NavStep in
        let last = i == km - 1
        let dist = min(1000, lengthM - Double(i) * 1000)
        let type = last ? "arrive" : "turn"
        let modifier: String? = last ? nil : "right"
        return NavStep(
            index: i,
            distanceM: dist,
            durationS: durationS * dist / lengthM,
            startM: Double(i) * 1000,
            name: "M1",
            endManeuver: NavManeuver(type: type, modifier: modifier, instruction: last ? "Megérkezett" : "Forduljon jobbra", location: points[(i + 1) * 10]),
            banners: [
                NavBanner(distanceAlongM: dist, primary: BannerText(text: "Kilométer \(i + 1)", type: type, modifier: modifier)),
                NavBanner(distanceAlongM: 300, primary: BannerText(text: "Kilométer \(i + 1) közel", type: type, modifier: modifier)),
            ],
            voice: [NavVoice(distanceAlongM: dist, text: "Hamarosan \(i + 1)"), NavVoice(distanceAlongM: 200, text: "Most \(i + 1)")]
        )
    }
    return NavRoute(
        id: id, points: points, distanceM: lengthM, durationS: durationS, typicalDurationS: durationS, steps: steps,
        segStartM: (0..<n).map { Double($0) * lengthM / Double(n) },
        segLimitKmh: Array(repeating: limit, count: n),
        segCongestion: Array(repeating: .low, count: n),
        segDurationS: Array(repeating: durationS / Double(n), count: n)
    )
}

/// A teszt-útvonal egy pontja (m-ben az elejétől), `crossM` méterrel északra eltolva.
private func at(_ route: NavRoute, _ alongM: Double, _ crossM: Double = 0, _ t: Double = T0, heading: Double? = 90) -> GpsFix {
    let p = LocalProjection(route.points[0]).fromXY(XY(x: alongM, y: crossM))
    return GpsFix(lat: p.lat, lon: p.lon, timestamp: t, speed: 25, accuracy: 5, heading: heading)
}

private func ll(_ f: GpsFix) -> LatLon { LatLon(lat: f.lat, lon: f.lon) }

private func scaleDurations(_ r: NavRoute, _ totalS: Double, _ id: String, latOffset: Double = 0) -> NavRoute {
    let f = totalS / r.segDurationS.reduce(0, +)
    var moved = r
    moved.id = id
    moved.points = r.points.map { LatLon(lat: $0.lat + latOffset, lon: $0.lon) }
    moved.durationS = totalS
    moved.segDurationS = r.segDurationS.map { $0 * f }
    return moved
}

private func makeSection(_ route: NavRoute, _ fromM: Double, _ toM: Double, limit: Double = 110, id: String = "sec", reverse: Bool = false, crossM: Double = 0) -> Section {
    let a = ll(at(route, fromM, crossM))
    let b = ll(at(route, toM, crossM))
    return Section(
        id: id, country: "HU", road: "M1", direction: "Teszt", start: reverse ? b : a, end: reverse ? a : b, lengthM: toM - fromM,
        speedLimitKmh: limit, source: .hivatalos, verified: true
    )
}

/// Munkamenet kézzel léptetett órával; a `fetchRoutes` hívásait rögzíti, a választ a teszt adja.
@MainActor
private final class Harness {
    var calls: [(reason: RouteRequestReason, from: LatLon)] = []
    var t = T0
    var next: Result<[NavRoute], Error>
    var session: NavigationSession!

    init(_ route: NavRoute, voice: Bool = true) {
        next = .success([route])
        let dest = route.points.last!
        session = NavigationSession(
            route: route,
            destination: NavDestination(name: "Cél", lat: dest.lat, lon: dest.lon),
            fetchRoutes: { [unowned self] from, _, ctx in
                self.calls.append((ctx.reason, from))
                let r = self.next
                return Task { try r.get() }
            },
            now: { [unowned self] in self.t },
            voice: voice,
            lang: .hu
        )
    }

    func respond(_ routes: [NavRoute]) { next = .success(routes) }
    func fail() { next = .failure(DirectionsError(code: "halozat")) }

    @discardableResult
    func feed(_ fix: GpsFix) -> NavView {
        t = fix.timestamp
        return session.onFix(fix)
    }

    var reasons: [RouteRequestReason] { calls.map(\.reason) }
}

private func fixtureRoutes() throws -> [NavRoute] {
    try parseDirections(try NavSim.directionsJSON(), idPrefix: "fx")
}

// MARK: Directions feldolgozása (rögzített, valódi válasz)

@Suite("Directions-válasz feldolgozása (Budapest → Győr fixtúra)")
struct DirectionsParseTests {
    @Test("két útvonal, lépésekkel, annotációkkal")
    func ketUtvonal() throws {
        let routes = try fixtureRoutes()
        let r = routes[0]
        #expect(routes.count == 2)
        #expect(r.distanceM > 100_000)
        #expect(r.steps.count > 5)
        #expect(r.segLimitKmh.count == r.points.count - 1)
        #expect(r.segCongestion.count == r.points.count - 1)
        #expect(r.segDurationS.count == r.points.count - 1)
        #expect(r.steps.last?.endManeuver.type == "arrive")
    }

    @Test("a lépések összhossza az útvonal hossza, a kezdetük növekvő")
    func lepesek() throws {
        let r = try fixtureRoutes()[0]
        let sum = r.steps.reduce(0) { $0 + $1.distanceM }
        #expect(abs(sum - r.distanceM) < r.distanceM * 0.01)
        for i in r.steps.indices.dropFirst() { #expect(r.steps[i].startM > r.steps[i - 1].startM) }
    }

    @Test("a maxspeed-annotáció km/h-ra váltva; az ismeretlen null")
    func maxspeed() throws {
        let r = try fixtureRoutes()[0]
        let known = r.segLimitKmh.compactMap { $0 }
        let unknown = r.segLimitKmh.filter { $0 == nil }
        #expect(known.count > 100)
        #expect(!unknown.isEmpty)
        #expect(known.max() == 130)
        // a TS-ben `not.toBeUndefined()`: a táv közepén van szakasz (az érték lehet nil is)
        #expect(segmentAt(r, r.distanceM * 0.5) < r.segLimitKmh.count)
        _ = limitAt(r, r.distanceM * 0.5)
    }

    @Test("a szalag- és a hangutasítások rendezettek (csökkenő távolság)")
    func rendezett() throws {
        let r = try fixtureRoutes()[0]
        for s in r.steps {
            for i in s.banners.indices.dropFirst() { #expect(s.banners[i].distanceAlongM <= s.banners[i - 1].distanceAlongM) }
            for i in s.voice.indices.dropFirst() { #expect(s.voice[i].distanceAlongM <= s.voice[i - 1].distanceAlongM) }
        }
        #expect(!r.steps[0].voice.isEmpty)
    }

    @Test("dugó-szakaszok és késés")
    func dugo() throws {
        let r = try fixtureRoutes()[0]
        let runs = congestionRuns(r)
        #expect(!runs.isEmpty)
        #expect(runs.allSatisfy { $0.points.count >= 2 })
        #expect(trafficDelayS(r) == max(0, jsRound(r.durationS - (r.typicalDurationS ?? r.durationS))))
    }

    @Test("hibás válaszra DirectionsError")
    func hibas() {
        #expect(throws: DirectionsError(code: "NoRoute", message: "x")) { try parseDirections(["code": "NoRoute", "message": "x"]) }
        #expect(throws: DirectionsError.self) { try parseDirections(nil) }
        #expect(throws: DirectionsError(code: "NoRoute")) { try parseDirections(["code": "Ok", "routes": [Any]()]) }
    }

    @Test("a kérés címe: minden kért paraméter")
    func cim() throws {
        let u = directionsUrl(from: LatLon(lat: 47.5, lon: 19.04), to: LatLon(lat: 47.69, lon: 17.65), lang: .hu, token: "pk.x", heading: 87.6)
        let c = try #require(URLComponents(url: u, resolvingAgainstBaseURL: false))
        #expect(c.path.contains("/directions/v5/mapbox/driving-traffic/19.040000,47.500000;17.650000,47.690000"))
        let q = { (k: String) in c.queryItems?.first { $0.name == k }?.value }
        #expect(q("alternatives") == "true")
        #expect(q("steps") == "true")
        #expect(q("banner_instructions") == "true")
        #expect(q("voice_instructions") == "true")
        #expect(q("annotations") == "maxspeed,congestion,duration")
        #expect(q("language") == "hu")
        #expect(q("bearings") == "88,45;")
    }
}

// MARK: illesztés, lépésváltás

@Suite("pozíció-illesztés és lépésváltás")
@MainActor
struct MatchingTests {
    @Test("az útvonalra illeszt: hátralévő táv, keresztirányú eltérés")
    func illeszt() {
        let route = lineRoute()
        let h = Harness(route)
        let v = h.feed(at(route, 4000, 20))
        #expect(close(v.alongM, 4000, -1))
        #expect(close(v.crossM, 20, -1))
        #expect(close(v.remainingM, 6000, -1))
    }

    @Test("a következő manőver távolsága a lépés végéig számol, lépésváltáskor a következő lépésre ugrik")
    func lepesvaltas() {
        let route = lineRoute()
        let h = Harness(route)
        var v = h.feed(at(route, 2300, 0, T0 + 1000))
        #expect(close(v.next.distanceM, 700, -1))
        #expect(v.next.text == "Kilométer 3")
        #expect(v.then?.text.contains("Kilométer 4") == true)
        v = h.feed(at(route, 3050, 0, T0 + 2000))
        #expect(v.next.text == "Kilométer 4")
        #expect(close(v.next.distanceM, 950, -1))
    }

    @Test("a szalag a közelítéssel pontosodik (kisebb küszöbű szalag a lépés végén)")
    func szalag() {
        let route = lineRoute()
        let h = Harness(route)
        #expect(h.feed(at(route, 100, 0, T0 + 1000)).next.text == "Kilométer 1")
        #expect(h.feed(at(route, 800, 0, T0 + 2000)).next.text == "Kilométer 1 közel")
    }

    @Test("a sebességhatár az útvonal annotációjából jön; ha nincs: null")
    func hatar() {
        let known = Harness(lineRoute(limit: 110))
        #expect(known.feed(at(known.session.view().route, 500)).limitKmh == 110)
        let unknown = Harness(lineRoute(limit: nil))
        #expect(unknown.feed(at(unknown.session.view().route, 500)).limitKmh == nil)
    }

    @Test("érkezés: a céltól 30 m-en belül")
    func erkezes() {
        let route = lineRoute()
        let h = Harness(route)
        #expect(h.feed(at(route, 9000, 0, T0 + 1000)).phase == .navigating)
        let v = h.feed(at(route, 9980, 0, T0 + 2000))
        #expect(v.phase == .arrived)
        #expect(v.remainingS == 0)
    }

    @Test("a fixtúra-útvonalon: a közepén a lépés és a határ értelmes")
    func fixturan() throws {
        let r = try fixtureRoutes()[0]
        let h = Harness(r)
        let p = r.points[r.points.count / 2]
        let v = h.feed(GpsFix(lat: p.lat, lon: p.lon, timestamp: T0, speed: 30, accuracy: 5, heading: nil))
        #expect(v.crossM < 5)
        #expect(v.alongM > r.distanceM * 0.3)
        #expect(v.alongM < r.distanceM * 0.7)
        #expect(v.next.distanceM > 0)
        #expect(!v.next.text.isEmpty)
    }
}

// MARK: letérés és újratervezés

@Suite("letérés-felismerés és újratervezés-korlát")
@MainActor
struct RerouteTests {
    @Test("50 m-en belül nincs letérés")
    func nincsLeteres() {
        let route = lineRoute()
        let h = Harness(route)
        for s in 0..<20 { h.feed(at(route, 1000 + Double(s) * 20, 45, T0 + Double(s) * 1000)) }
        #expect(h.calls.isEmpty)
        #expect(h.session.view().offRoute == false)
    }

    @Test("50 m-nél távolabb 5 mp-ig → egy újratervezés a jelenlegi pozícióból")
    func ujratervezes() async {
        let route = lineRoute()
        let h = Harness(route)
        for s in 0...4 { h.feed(at(route, 2000, 200, T0 + Double(s) * 1000)) }
        #expect(h.calls.isEmpty) // 4 mp: még nem
        #expect(h.session.view().offRoute)
        h.feed(at(route, 2000, 200, T0 + 5000))
        #expect(h.reasons == [.reroute])
        #expect(h.session.view().rerouting)
        let p = at(route, 2000, 200)
        #expect(close(h.calls[0].from.lat, p.lat, 6))
        await h.session.settle()
        #expect(h.session.view().rerouting == false)
    }

    @Test("egy 3 mp-es kitérő nem indít újratervezést")
    func kitero() {
        let route = lineRoute()
        let h = Harness(route)
        for s in 0..<3 { h.feed(at(route, 2000, 200, T0 + Double(s) * 1000)) }
        for s in 3..<12 { h.feed(at(route, 2000, 5, T0 + Double(s) * 1000)) }
        #expect(h.calls.isEmpty)
    }

    @Test("legfeljebb 1 újratervezés / 20 mp (sikertelen próba után is)")
    func korlat() async {
        let route = lineRoute()
        let h = Harness(route)
        h.fail()
        for s in 0...5 { h.feed(at(route, 2000, 300, T0 + Double(s) * 1000)) }
        await h.session.settle()
        #expect(h.calls.count == 1)
        #expect(h.session.view().rerouteFailed)
        for s in 6..<25 { h.feed(at(route, 2000, 300, T0 + Double(s) * 1000)) }
        #expect(h.calls.count == 1) // 5…24 mp: még a tilalmi időn belül
        h.feed(at(route, 2000, 300, T0 + 25_000)) // 20 mp telt el a kísérlet (5. mp) óta
        #expect(h.calls.count == 2)
    }

    @Test("az új útvonal átveszi a helyet: routeVersion nő, a letérés megszűnik")
    func atveszi() async {
        let route = lineRoute()
        let fresh = lineRoute(lengthM: 8000, latOffset: 0.0027, id: "uj") // ~300 m-rel északabbra
        let h = Harness(route)
        h.respond([fresh])
        let before = h.session.view().routeVersion
        for s in 0...5 { h.feed(at(route, 2000, 300, T0 + Double(s) * 1000)) }
        await h.session.settle()
        let v = h.session.view()
        #expect(v.routeVersion > before)
        #expect(v.route.id == "uj")
        h.feed(at(fresh, 100, 0, T0 + 7000))
        #expect(h.session.view().offRoute == false)
    }

    @Test("Directions-hívás legfeljebb 5 mp-enként: a letérés nem indít hívást közvetlenül egy másik után")
    func otMasodperc() async {
        let route = lineRoute()
        let h = Harness(route, voice: false)
        h.session.tick()
        // alternatíva-figyelés esedékes (2 perc), közvetlenül utána letérés
        h.feed(at(route, 1000, 0, T0 + 120_000))
        #expect(h.reasons == [.alternatives])
        for s in 1...8 { h.feed(at(route, 1000, 400, T0 + 120_000 + Double(s) * 1000)) }
        await h.session.settle()
        #expect(h.reasons.filter { $0 == .reroute }.count == 1)
    }
}

// MARK: alternatíva-figyelés

/// A Budapest→Győr fixtúra: a jelenlegi útvonal és az igazi alternatíva (gyorsabbra skálázva); a lehajtója a 56. kilométernél van.
private struct Fixture {
    let main: NavRoute
    let alt: NavRoute
    let core: Route

    init() throws {
        let routes = try fixtureRoutes()
        main = routes[0]
        core = coreRoute(main)!
        alt = scaleDurations(routes[1], main.durationS - 600, "alt")
    }

    func sectionOn(_ fromM: Double, _ toM: Double) -> Section {
        var s = makeSection(lineRoute(), 0, 1000)
        s.start = core.pointAt(fromM)
        s.end = core.pointAt(toM)
        s.lengthM = toM - fromM
        return s
    }

    func fix(_ alongM: Double, _ t: Double) -> GpsFix {
        let p = core.pointAt(alongM)
        return GpsFix(lat: p.lat, lon: p.lon, timestamp: t, speed: 25, accuracy: 5, heading: nil)
    }
}

@Suite("alternatíva-figyelés")
@MainActor
struct AlternativeTests {
    @Test("2 percenként kér, előtte nem")
    func ketPerc() {
        let route = lineRoute()
        let h = Harness(route)
        h.feed(at(route, 500, 0, T0 + 60_000))
        h.feed(at(route, 600, 0, T0 + 119_000))
        #expect(h.calls.isEmpty)
        h.feed(at(route, 700, 0, T0 + 120_000))
        #expect(h.reasons == [.alternatives])
    }

    /// Egy 30 perces útvonal; a válaszban a változatlan útvonal és egy alternatíva a megadott idővel.
    private func offerWith(_ altDurationS: Double, _ baseS: Double = 1800) async -> AlternativeOffer? {
        let route = lineRoute(lengthM: 40_000, durationS: baseS)
        let alt = scaleDurations(lineRoute(lengthM: 42_000, durationS: baseS, id: "alt"), altDurationS, "alt", latOffset: 0.003)
        let h = Harness(route)
        h.respond([route, alt])
        h.feed(at(route, 500, 0, T0 + 120_000))
        await h.session.settle()
        return h.session.view().offer
    }

    @Test("legalább 5 percet nyer → ajánlat")
    func otPerc() async throws {
        let offer = try #require(await offerWith(1800 - 360))
        #expect(offer.gainS >= 300)
        #expect(offer.route.id == "alt")
    }

    @Test("4 perc (és < 15%) → nincs ajánlat")
    func negyPerc() async {
        #expect(await offerWith(3600 - 240, 3600) == nil)
    }

    @Test("15%-ot nyer 5 perc alatt is → ajánlat (rövid út)")
    func tizenotSzazalek() async {
        // 20 perces út: 15% = 3 perc; a nyereség 3,5 perc
        #expect(await offerWith(1200 - 210, 1200) != nil)
    }

    private func measuringOn(_ sectionToM: Double) async throws -> (Harness, Fixture) {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData(sections: [f.sectionOn(400, sectionToM)]))
        h.respond([f.main, f.alt])
        h.session.setMeasuring(true)
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        return (h, f)
    }

    @Test("lehajtó = az alternatíva első, a jelenlegi útvonalon nem szereplő manővere")
    func lehajto() throws {
        let f = try Fixture()
        let exit = try #require(firstNewManeuver(f.main, f.alt))
        #expect(exit.distanceM > 54_000)
        #expect(exit.distanceM < 57_000)
        // a sáv/pajzs-jelzés („1”) nem tapad a kijárat nevére
        #expect(exit.name == "Kijárat 56")
        #expect(f.alt.steps.contains { $0.banners.first?.primary.text == "Kijárat 56 1" })
        // önmagával nincs eltérés
        #expect(firstNewManeuver(f.main, f.main) == nil)
    }

    @Test("kézi mérés közben nincs ajánlat; a mérés végén jelenik meg, onnan 45 mp")
    func keziMeres() async throws {
        let f = try Fixture()
        let h = Harness(f.main)
        h.respond([f.main, f.alt])
        h.session.setMeasuring(true)
        h.feed(f.fix(500, T0 + 120_000))
        await h.session.settle()
        #expect(h.session.view().offer == nil)
        #expect(!h.session.drainVoice().contains { $0.kind == .faster })
        // hosszú mérés: a visszatartott ajánlat nem évül el
        h.feed(f.fix(900, T0 + 400_000))
        #expect(h.session.view().offer == nil)
        h.session.setMeasuring(false)
        let offer = try #require(h.session.view().offer)
        #expect(offer.expiresAt == T0 + 400_000 + NAV_CONFIG.offerTtlMs)
        #expect(h.session.drainVoice().contains { $0.kind == .faster })
    }

    @Test("lehajtó-név: kijárat → cél-név → nincs")
    func lehajtoNev() throws {
        let f = try Fixture()
        func withBanner(_ edit: (inout NavBanner) -> Void) -> NavRoute {
            var copy = f.alt
            let i = copy.steps.firstIndex { $0.banners.first?.primary.exit == "Kijárat 56" }!
            edit(&copy.steps[i].banners[0])
            return copy
        }
        #expect(firstNewManeuver(f.main, f.alt)?.name == "Kijárat 56")
        #expect(firstNewManeuver(f.main, withBanner { $0.primary.exit = nil })?.name == "Tatabánya-Óváros")
        let none = try #require(firstNewManeuver(f.main, withBanner {
            $0.primary.exit = nil
            $0.secondary = nil
        }))
        #expect(none.name == nil)
    }

    @Test("mérés közben: a lehajtó a szakasz vége előtt → azonnal, kompakt ajánlat a lehajtó nevével és távolságával")
    func meresKozbenAzonnal() async throws {
        let (h, _) = try await measuringOn(60_000)
        let offer = try #require(h.session.view().offer)
        #expect(offer.compact)
        #expect(offer.exitName == "Kijárat 56")
        #expect(offer.exitInM > 54_000)
        #expect(offer.expiresAt == T0 + 120_000 + NAV_CONFIG.offerTtlMs)
        let voice = h.session.drainVoice().filter { $0.kind == .faster }
        #expect(voice.count == 1)
        #expect(voice.first?.text.contains(offer.exitKm) == true)
        // a mérés végén a forma nem kompakt, az ajánlat marad
        h.session.setMeasuring(false)
        #expect(h.session.view().offer?.compact == false)
    }

    @Test("mérés közben: a lehajtó a szakasz vége után → visszatartva, a mérés végén jelenik meg")
    func meresKozbenVisszatartva() async throws {
        let (h, _) = try await measuringOn(20_000)
        #expect(h.session.view().offer == nil)
        #expect(!h.session.drainVoice().contains { $0.kind == .faster })
        h.session.setMeasuring(false)
        #expect(h.session.view().offer != nil)
    }

    @Test("bemondás Waze-mintára: azonnal, majd 500 m-nél még egyszer")
    func waze() async throws {
        let (h, f) = try await measuringOn(60_000)
        let exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM
        #expect(h.session.drainVoice().filter { $0.kind == .faster }.count == 1)
        h.feed(f.fix(exitAlong - 2000, T0 + 125_000))
        #expect(h.session.drainVoice().filter { $0.kind == .faster }.isEmpty)
        h.feed(f.fix(exitAlong - 450, T0 + 130_000))
        let second = h.session.drainVoice().filter { $0.kind == .faster }
        #expect(second.map(\.text) == [t(.navVoiceFasterExit500, lang: .hu)])
        h.feed(f.fix(exitAlong - 300, T0 + 132_000))
        #expect(h.session.drainVoice().filter { $0.kind == .faster }.isEmpty)
    }

    @Test("a lehajtót 50 m-rel elhagyva az ajánlat eltűnik")
    func elhagyva() async throws {
        let (h, f) = try await measuringOn(60_000)
        let exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM
        h.feed(f.fix(exitAlong - 100, T0 + 130_000))
        #expect(h.session.view().offer != nil)
        h.feed(f.fix(exitAlong + 80, T0 + 131_000))
        #expect(h.session.view().offer == nil)
    }

    @Test("elfogadás: az alternatíva veszi át; elvetés: ugyanaz nem jön vissza")
    func elfogadasElvetes() async {
        let route = lineRoute(lengthM: 40_000, durationS: 1800)
        let alt = scaleDurations(lineRoute(lengthM: 42_000, durationS: 1800, id: "alt"), 1200, "alt", latOffset: 0.003)
        let h = Harness(route)
        h.respond([route, alt])
        h.feed(at(route, 500, 0, T0 + 120_000))
        await h.session.settle()
        h.session.declineOffer()
        #expect(h.session.view().offer == nil)
        h.feed(at(route, 900, 0, T0 + 240_000))
        await h.session.settle()
        #expect(h.session.view().offer == nil) // elvetett: nem ajánljuk újra
        // másik, új alternatíva viszont igen
        let alt2 = scaleDurations(lineRoute(lengthM: 43_000, durationS: 1800, id: "alt2"), 1000, "alt2", latOffset: -0.004)
        h.respond([route, alt2])
        h.feed(at(route, 1300, 0, T0 + 360_000))
        await h.session.settle()
        #expect(h.session.view().offer?.route.id == "alt2")
        let version = h.session.view().routeVersion
        h.session.acceptOffer()
        #expect(h.session.view().route.id == "alt2")
        #expect(h.session.view().routeVersion > version)
        #expect(h.session.view().offer == nil)
    }

    @Test("a le nem kezelt ajánlat lejár")
    func lejar() async {
        let route = lineRoute(lengthM: 40_000, durationS: 1800)
        let alt = scaleDurations(lineRoute(lengthM: 42_000, durationS: 1800, id: "alt"), 1200, "alt", latOffset: 0.003)
        let h = Harness(route)
        h.respond([route, alt])
        h.feed(at(route, 500, 0, T0 + 120_000))
        await h.session.settle()
        #expect(h.session.view().offer != nil)
        h.feed(at(route, 600, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs + 1))
        #expect(h.session.view().offer == nil)
    }
}

// MARK: szakaszellenőrzés az útvonalon, ETA

private func planned(_ route: NavRoute, _ id: String, _ crossM: Double) -> PlannedCheck {
    PlannedCheck(
        id: id, country: "HU", county: "Fejér", settlement: nil, roadRef: "M1", description: "",
        lines: [[ll(at(route, 3000, crossM)), ll(at(route, 5000, crossM))]], zones: [], speedLimitKmh: 90, limitSource: .osm,
        validFrom: T0 - 86_400_000, validTo: T0 + 86_400_000, timeWindow: nil, sourceUrl: "https://www.police.hu/"
    )
}

private func camera(_ id: String, _ country: String, _ p: GpsFix, heading: Double? = 90, limit: Double? = 130) -> FixedCamera {
    FixedCamera(id: id, country: country, type: .speed, lat: p.lat, lon: p.lon, headingDeg: heading, road: "M1", speedLimitKmh: limit, source: "", sourceUrl: "", sourceDate: "", verified: true)
}

@Suite("szakaszok az útvonal sávjában")
struct EnforcementTests {
    let route = lineRoute()

    @Test("a 40 m-es sávban lévő szakasz bekerül, az 100 m-re lévő nem")
    func sav() {
        let near = makeSection(route, 2000, 6000, id: "kozel", crossM: 20)
        let far = makeSection(route, 2000, 6000, id: "messze", crossM: 100)
        let items = routeEnforcement(route, EnforcementData(sections: [near, far]), now: T0)
        #expect(items.map(\.id) == ["kozel"])
        #expect(close(items.first?.startM, 2000, -1))
        #expect(close(items.first?.endM, 6000, -1))
    }

    @Test("a tervezett mérés is a 40 m-es (ROUTE_MATCH_M) sávval kerül az útra, nem a sáv 100 m-es tűrésével")
    func tervezett() {
        #expect(ROUTE_MATCH_M == 40)
        #expect(NAV_CONFIG.enforcementBandM == ROUTE_MATCH_M)
        #expect(PLANNED_MATCH_M == 100)
        let items = routeEnforcement(route, EnforcementData(planned: [planned(route, "kozel", 20), planned(route, "parhuzamos", 70)]), now: T0)
        #expect(items.map(\.id) == ["kozel"])
        #expect(close(items.first?.startM, 3000, -2))
        #expect(close(items.first?.endM, 5000, -2))
    }

    @Test("az ellenkező irányú szakasz nem kerül be")
    func ellenirany() {
        let rev = makeSection(route, 2000, 6000, reverse: true)
        #expect(routeEnforcement(route, EnforcementData(sections: [rev]), now: T0).isEmpty)
    }

    @Test("a kamera láthatósága érvényes: HU látszik, FR (zóna) és CH (rejtett) nem kerül a listára")
    func kameraLathatosag() {
        let p = at(route, 5000, 10)
        let items = routeEnforcement(route, EnforcementData(cameras: [camera("hu", "HU", p), camera("fr", "FR", p), camera("ch", "CH", p)]), now: T0)
        #expect(items.map(\.id) == ["hu"])
        #expect(items.first?.kind == .camera)
    }

    @Test("összefoglaló: szakaszok, kamerák száma, késés")
    func osszefoglalo() {
        let s = makeSection(route, 2000, 6000)
        let cam = camera("c", "HU", at(route, 8000, 5), heading: nil, limit: nil)
        var r = route
        r.durationS = 420
        r.typicalDurationS = 360
        let sum = routeSummary(r, EnforcementData(sections: [s], cameras: [cam]), now: T0)
        #expect(sum.sections == 1)
        #expect(sum.cameras == 1)
        #expect(sum.delayS == 60)
    }
}

@Suite("ETA a szakaszokon a határral")
@MainActor
struct EtaTests {
    // 10 km 360 s-ban (100 km/h); 2–6 km között szakasz, határ 60 km/h
    let route = lineRoute(lengthM: 10_000, durationS: 360)
    var section: Section { makeSection(route, 2000, 6000, limit: 60) }

    @Test("a szakasz ideje a határ szerint (4 km @ 60 = 240 s a 144 s helyett)")
    func hatarSzerint() {
        let items = routeEnforcement(route, EnforcementData(sections: [section]), now: T0)
        let cum = cumulative(adjustedDurations(route, items))
        #expect(close(cum.last, 360 - 144 + 240, 0))
        #expect(close(remainingSeconds(route, cum, 0), 456, 0))
        #expect(close(remainingSeconds(route, cum, 6000), 144, 0))
        #expect(remainingSeconds(route, cum, 10_000) == 0)
    }

    @Test("a szakaszon, ahol az útvonal lassabb a határnál, nem gyorsít")
    func nemGyorsit() {
        let slow = lineRoute(lengthM: 10_000, durationS: 900) // 40 km/h
        let items = routeEnforcement(slow, EnforcementData(sections: [makeSection(slow, 2000, 6000, limit: 110)]), now: T0)
        #expect(close(cumulative(adjustedDurations(slow, items)).last, 900, 0))
    }

    @Test("a nézet ETA-ja és hátralévő ideje a szakaszokkal számol")
    func nezet() {
        let h = Harness(route)
        h.session.setData(EnforcementData(sections: [section]))
        let v = h.feed(at(route, 0, 0, T0 + 1000))
        #expect(close(v.remainingS, 456, -1))
        #expect(close(v.etaMs, h.t + 456_000, -4))
        let w = h.feed(at(route, 7000, 0, T0 + 2000))
        #expect(close(w.remainingS, 108, -1))
    }

    @Test("közeledő szakasz: 2 km-en belül jelzi a távolságot és a határt")
    func kozeledo() {
        let h = Harness(route)
        h.session.setData(EnforcementData(sections: [section, makeSection(route, 8000, 9500, id: "tavoli")]))
        #expect(h.feed(at(route, 0, 0, T0 + 1000)).upcoming?.item.id == "sec") // pont 2 km: még jelzi
        h.session.setData(EnforcementData(sections: [makeSection(route, 3000, 7000, id: "tavoli")]))
        #expect(h.feed(at(route, 0, 0, T0 + 1500)).upcoming == nil) // 3 km: a küszöbön kívül
        h.session.setData(EnforcementData(sections: [section]))
        let v = h.feed(at(route, 400, 0, T0 + 2000))
        #expect(v.upcoming?.item.kind == .section)
        #expect(v.upcoming?.item.limitKmh == 60)
        #expect(close(v.upcoming?.distanceM, 1600, -1))
        #expect(h.feed(at(route, 2500, 0, T0 + 3000)).upcoming == nil) // már a szakaszon
    }
}

// MARK: hang

@Suite("hang-események")
@MainActor
struct VoiceTests {
    @Test("a Directions hangutasítása a küszöbnél szólal meg, egyszer")
    func kuszob() {
        let route = lineRoute()
        let h = Harness(route)
        h.feed(at(route, 10, 0, T0 + 1000)) // 990 m a lépés végéig: a „Hamarosan 1” (1000 m) esedékes
        #expect(h.session.drainVoice().map(\.text) == ["Hamarosan 1"])
        h.feed(at(route, 500, 0, T0 + 2000))
        #expect(h.session.drainVoice().isEmpty)
        h.feed(at(route, 850, 0, T0 + 3000)) // 150 m: a „Most 1” (200 m)
        #expect(h.session.drainVoice().map(\.text) == ["Most 1"])
        h.feed(at(route, 900, 0, T0 + 4000))
        #expect(h.session.drainVoice().isEmpty)
    }

    @Test("kikapcsolt hangnál semmi nem szólal meg, és nem is halmozódik")
    func kikapcsolt() {
        let route = lineRoute()
        let h = Harness(route, voice: false)
        h.feed(at(route, 10, 0, T0 + 1000))
        h.feed(at(route, 850, 0, T0 + 2000))
        #expect(h.session.drainVoice().isEmpty)
        h.session.setVoice(true)
        h.feed(at(route, 900, 0, T0 + 3000))
        #expect(h.session.drainVoice().isEmpty)
    }

    @Test("közeledő szakasz: 500 m-nél bemondja a határral, egyszer")
    func szakasz500() {
        let route = lineRoute()
        let h = Harness(route)
        h.session.setData(EnforcementData(sections: [makeSection(route, 5000, 9000, limit: 110)]))
        h.feed(at(route, 4000, 0, T0 + 1000))
        _ = h.session.drainVoice()
        h.feed(at(route, 4520, 0, T0 + 2000))
        let said = h.session.drainVoice().filter { $0.kind == .section }
        #expect(said.count == 1)
        #expect(said.first?.text == "Szakaszellenőrzés kezdődik, maximum 110")
        h.feed(at(route, 4700, 0, T0 + 3000))
        #expect(h.session.drainVoice().filter { $0.kind == .section }.isEmpty)
    }

    @Test("a „Túl gyors” a váltáskor szól, 30 mp-en belül nem ismétlődik")
    func tulGyors() {
        let route = lineRoute()
        let h = Harness(route)
        h.session.setMeasureStatus(.jo)
        h.session.setMeasureStatus(.tulGyors)
        #expect(h.session.drainVoice().map(\.kind) == [.tooFast])
        h.session.setMeasureStatus(.tulGyors)
        #expect(h.session.drainVoice().isEmpty)
        h.session.setMeasureStatus(.jo)
        h.t = T0 + 10_000
        h.session.setMeasureStatus(.tulGyors)
        #expect(h.session.drainVoice().isEmpty) // 10 mp: még a tilalmi időn belül
        h.session.setMeasureStatus(.jo)
        h.t = T0 + 31_000
        h.session.setMeasureStatus(.tulGyors)
        #expect(h.session.drainVoice().map(\.kind) == [.tooFast])
    }

    @Test("a hangszövegek mind a 6 nyelven megvannak, a határ behelyettesítve")
    func hatNyelv() {
        for lang in Lang.allCases {
            #expect(t(.navVoiceSectionAhead, ["x": "110"], lang: lang).contains("110"), "\(lang)")
            #expect(t(.navVoiceFaster, ["n": "7"], lang: lang).contains("7"), "\(lang)")
            #expect(t(.navVoiceTooFast, lang: lang).count > 3, "\(lang)")
            #expect(t(.navVoiceRerouting, lang: lang).count > 3, "\(lang)")
        }
    }

    @Test("újratervezéskor bemondja")
    func ujratervezes() async {
        let route = lineRoute()
        let h = Harness(route)
        for s in 0...5 { h.feed(at(route, 2000, 300, T0 + Double(s) * 1000)) }
        await h.session.settle()
        #expect(h.session.drainVoice().contains { $0.kind == .reroute })
    }
}

// MARK: keresés, helyek, számláló

/// Kézzel léptetett időzítő a keresőhöz (a webes teszt `setTimer` / `clearTimer`-je).
private final class FakeTimers: SearchTimers {
    var timers: [(fn: () -> Void, ms: Double, id: Int)] = []
    private var n = 0

    func set(_ ms: Double, _ fn: @escaping () -> Void) -> Int {
        n += 1
        timers.append((fn, ms, n))
        return n
    }

    func clear(_ id: Int?) { timers.removeAll { $0.id == id } }
}

/// Később feloldható érték (a webes teszt kézi `resolve`-ja).
@MainActor
private final class Deferred<T: Sendable> {
    private var result: T?
    private var waiters: [CheckedContinuation<T, Never>] = []

    var value: T {
        get async {
            if let result { return result }
            return await withCheckedContinuation { waiters.append($0) }
        }
    }

    func resolve(_ v: T) {
        result = v
        for w in waiters { w.resume(returning: v) }
        waiters = []
    }
}

/// A függő feladatok lefutása (a webes `flush()`): néhány átadás a fő aktoron.
private func flush() async {
    for _ in 0..<20 { await Task.yield() }
}

@Suite("keresés: 3 karaktertől, 300 ms késleltetéssel")
@MainActor
struct SearchTests {
    @Test("kevesebb mint 3 karakterre nem keres")
    func harom() {
        #expect(!shouldSearch("ab"))
        #expect(!shouldSearch("  ab "))
        #expect(shouldSearch("abc"))
        var calls = 0
        var states: [SearchState] = []
        let timers = FakeTimers()
        let ctl = SearchController(search: { _ in
            calls += 1
            return Task { [] }
        }, onState: { states.append($0) }, timers: timers)
        ctl.input("Gy")
        #expect(timers.timers.isEmpty)
        #expect(calls == 0)
        #expect(states.last == .idle)
    }

    @Test("gyors gépelés egyetlen kérést ad, 300 ms-os késleltetéssel")
    func egyKeres() async {
        var queries: [String] = []
        let timers = FakeTimers()
        let ctl = SearchController(search: { q in
            queries.append(q)
            return Task { parseGeocode(["features": [Any]()]) }
        }, onState: { _ in }, timers: timers)
        ctl.input("Győ")
        ctl.input("Győr")
        ctl.input("Győr ")
        #expect(timers.timers.count == 1)
        #expect(timers.timers.first?.ms == 300)
        timers.timers[0].fn()
        await ctl.settle()
        #expect(queries == ["Győr"])
    }

    @Test("a lassabban érkező régi válasz nem írja felül az újat")
    func regiValasz() async {
        var resolvers: [Deferred<[Place]>] = []
        var states: [SearchState] = []
        let timers = FakeTimers()
        let ctl = SearchController(search: { _ in
            let d = Deferred<[Place]>()
            resolvers.append(d)
            return Task { await d.value }
        }, onState: { states.append($0) }, timers: timers)
        ctl.input("Győr")
        timers.timers.removeFirst().fn()
        ctl.input("Győrszentiván")
        timers.timers.removeFirst().fn()
        resolvers[1].resolve([Place(id: "b", name: "új", address: "", lat: 1, lon: 1)])
        await flush()
        resolvers[0].resolve([Place(id: "a", name: "régi", address: "", lat: 1, lon: 1)])
        await ctl.settle()
        guard case .ok(let places) = states.last else {
            Issue.record("nem ok: \(String(describing: states.last))")
            return
        }
        #expect(places.first?.name == "új")
    }

    @Test("a Geocoding-kérés: országok, nyelv, kiegészítés; a válasz feldolgozása")
    func geocoding() throws {
        let u = geocodeUrl("Győr", lang: .de, token: "pk.x", near: LatLon(lat: 47.5, lon: 19.04))
        let c = try #require(URLComponents(url: u, resolvingAgainstBaseURL: false))
        let q = { (k: String) in c.queryItems?.first { $0.name == k }?.value }
        #expect(q("country") == "HU,AT,SK,SI,HR,RO,IT,PL,DE,CZ")
        #expect(q("language") == "de")
        #expect(q("autocomplete") == "true")
        #expect(q("proximity") == "19.04000,47.50000")
        let places = parseGeocode([
            "features": [
                ["id": "x", "geometry": ["coordinates": [17.63, 47.68]], "properties": ["mapbox_id": "m1", "name": "Győr", "place_formatted": "Győr-Moson-Sopron, Magyarország"]],
                ["geometry": NSNull()],
                ["geometry": ["coordinates": ["a", "b"]], "properties": ["name": "rossz"]],
            ] as [Any],
        ])
        #expect(places == [Place(id: "m1", name: "Győr", address: "Győr-Moson-Sopron, Magyarország", lat: 47.68, lon: 17.63)])
    }
}

@Suite("helyek")
struct PlacesTests {
    private func p(_ i: Int, lat: Double? = nil) -> Place {
        Place(id: "p\(i)", name: "Hely \(i)", address: "", lat: lat ?? 47 + Double(i), lon: 19)
    }

    @Test("az utolsó 10 cél marad, a legújabb elöl")
    func tiz() {
        var list: [Place] = []
        for i in 0..<14 { list = addRecent(list, p(i)) }
        #expect(list.count == 10)
        #expect(list.first?.id == "p13")
        #expect(list.last?.id == "p4")
    }

    @Test("ugyanaz a hely nem duplázódik, hanem előre kerül")
    func nemDuplazodik() {
        var list = addRecent(addRecent([], p(1)), p(2))
        var same = p(1, lat: 48.0004)
        same.id = "masik-azonosito"
        list = addRecent(list, same)
        #expect(list.map(\.name) == ["Hely 1", "Hely 2"])
    }

    @Test("sérült tárolt érték helyett üres lista / üres mentett helyek")
    func serult() {
        #expect(parseRecents("nem json").isEmpty)
        #expect(parseRecents(#"[{"x":1},null]"#).isEmpty)
        #expect(parseSaved("???") == .none)
        let saved = parseSaved(#"{"home":{"id":"p1","name":"Hely 1","address":"","lat":48,"lon":19},"work":"x"}"#)
        #expect(saved.home?.name == "Hely 1")
        #expect(saved.work == nil)
        // a tárolt alak visszaolvasható (a weben tárolttal azonos mezők)
        #expect(parseRecents(serializeRecents([p(1), p(2)])) == [p(1), p(2)])
        #expect(parseSaved(serializeSaved(SavedPlaces(home: p(1), work: nil))) == SavedPlaces(home: p(1), work: nil))
    }
}

/// Memória-tár (a webes teszt `memory()`-je).
private final class MemoryStore: SyncStore {
    var data: [String: String] = [:]
    func getItem(_ key: String) -> String? { data[key] }
    func setItem(_ key: String, _ value: String) { data[key] = value }
}

/// Hívásszámláló a `@Sendable` mock-fetch-hez.
private nonisolated final class CallCount: @unchecked Sendable {
    var n = 0
}

@Suite("költségvédelem: számláló és Directions-kliens")
@MainActor
struct CostTests {
    private func day(_ d: Int) -> Double {
        Calendar.current.date(from: DateComponents(year: 2026, month: 10, day: d, hour: 12))!.timeIntervalSince1970 * 1000
    }

    @Test("a napi számláló éjfélkor nullázódik, és megmarad újraindításkor")
    func szamlalo() {
        let store = MemoryStore()
        var now = day(28)
        let c = RequestCounter(store: store, now: { now })
        c.increment()
        c.increment()
        #expect(c.count == 2)
        #expect(RequestCounter(store: store, now: { now }).count == 2)
        now = day(29)
        #expect(c.count == 0)
        c.increment()
        #expect(c.count == 1)
    }

    @Test("a kliens 5 mp-en belül nem hív, és minden elküldött kérést számol")
    func kliens() async throws {
        let counter = RequestCounter(store: MemoryStore(), now: { self.day(28) })
        var now = 100_000.0
        let calls = CallCount()
        let body = try JSONSerialization.data(withJSONObject: try NavSim.directionsJSON())
        let client = DirectionsClient(token: "pk.x", lang: { .hu }, fetch: { _ in
            calls.n += 1
            return (200, body)
        }, counter: counter, now: { now })
        let a = LatLon(lat: 47.5, lon: 19.04)
        let b = LatLon(lat: 47.69, lon: 17.65)
        let routes = try await client.routes(a, b, RouteRequestContext(heading: nil, reason: .plan)).value
        #expect(routes.count == 2)
        now += 4000
        await #expect(throws: DirectionsError(code: "RateLimited")) { try await client.routes(a, b, RouteRequestContext(heading: nil, reason: .reroute)).value }
        #expect(calls.n == 1)
        #expect(counter.count == 1)
        now += 1000
        _ = try await client.routes(a, b, RouteRequestContext(heading: nil, reason: .reroute)).value
        #expect(counter.count == 2)
    }

    @Test("a Directions hibakódját (NoRoute) hibaként adja")
    func noRoute() async {
        let counter = RequestCounter(store: MemoryStore())
        let body = Data(#"{"code":"NoRoute","message":"nincs"}"#.utf8)
        let client = DirectionsClient(token: "x", lang: { .hu }, fetch: { _ in (200, body) }, counter: counter)
        do {
            _ = try await client.routes(LatLon(lat: 0, lon: 0), LatLon(lat: 1, lon: 1), RouteRequestContext(heading: nil, reason: .plan)).value
            Issue.record("nem dobott hibát")
        } catch let e as DirectionsError {
            #expect(e.code == "NoRoute")
        } catch {
            Issue.record("más hiba: \(error)")
        }
    }
}

@Suite("manőver-ikonok")
struct ManeuverTests {
    @Test("a Directions type + modifier párosa az ikon-családra képződik")
    func ikonok() {
        #expect(maneuverIcon("turn", "right") == .right)
        #expect(maneuverIcon("turn", "sharp left") == .sharp_left)
        #expect(maneuverIcon("turn", "slight right") == .slight_right)
        #expect(maneuverIcon("continue", "uturn") == .uturn)
        #expect(maneuverIcon("roundabout", "slight right") == .roundabout_right)
        #expect(maneuverIcon("rotary", "left") == .roundabout_left)
        #expect(maneuverIcon("fork", "slight left") == .fork_left)
        #expect(maneuverIcon("on ramp", "straight") == .straight)
        #expect(maneuverIcon("arrive", nil) == .arrive)
        #expect(maneuverIcon("whatever", "nonsense") == .straight)
    }
}

@Suite("szótár-teljesség a navigációhoz")
struct NavDictionaryTests {
    @Test("minden nav.* / map.search / settings.* új kulcs mind a 6 nyelven nem üres")
    func kulcsok() throws {
        let extra: Set = ["map.search", "settings.requests", "settings.voiceInstructions", "settings.group.places"]
        let keys = try Repo.dictionary(.hu).keys.filter { $0.hasPrefix("nav.") || extra.contains($0) }
        #expect(keys.count > 40)
        for lang in Lang.allCases {
            let dict = try Repo.dictionary(lang)
            let bundle = try #require(L10n.bundle(for: lang))
            for k in keys {
                #expect(dict[k]?.trimmingCharacters(in: .whitespaces).isEmpty == false, "\(lang.rawValue).\(k)")
                // az app csomagjában is ott van (a generált String Catalogból)
                #expect(L10nKey(rawValue: k).map { L10n.template($0, in: bundle) } == dict[k], "\(lang.rawValue).\(k)")
            }
        }
    }

    @Test("a hangos utasítások beállítás alapból be van, és tárolódik")
    func beallitas() {
        #expect(Settings.default.hangosUtasitasok)
        #expect(Settings.parse(#"{"hangos_utasitasok":false}"#).hangosUtasitasok == false)
        #expect(Settings.parse("{}").hangosUtasitasok)
    }
}
