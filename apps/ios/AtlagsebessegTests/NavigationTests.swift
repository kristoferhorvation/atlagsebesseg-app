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
private func at(_ route: NavRoute, _ alongM: Double, _ crossM: Double = 0, _ t: Double = T0, heading: Double? = 90, speed: Double? = 25) -> GpsFix {
    let p = LocalProjection(route.points[0]).fromXY(XY(x: alongM, y: crossM))
    return GpsFix(lat: p.lat, lon: p.lon, timestamp: t, speed: speed, accuracy: 5, heading: heading)
}

/// A teljes szöveg illeszkedik-e a mintára (a vitest `toMatch(/^…$/)`).
private func matches(_ s: String?, _ pattern: String) -> Bool {
    guard let s, let re = try? NSRegularExpression(pattern: pattern) else { return false }
    return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
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
    var calls: [(reason: RouteRequestReason, from: LatLon, to: LatLon)] = []
    var t = T0
    var next: Result<[NavRoute], Error>
    var session: NavigationSession!

    init(_ route: NavRoute, voice: Bool = true, routable: LatLon? = nil) {
        next = .success([route])
        let dest = route.points.last!
        session = NavigationSession(
            route: route,
            destination: NavDestination(name: "Cél", lat: dest.lat, lon: dest.lon, routable: routable),
            fetchRoutes: { [unowned self] from, to, ctx in
                self.calls.append((ctx.reason, from, to))
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

    /// A lehajtó helye a fő útvonal mentén, ha az ajánlat az 1000 m-es pozíción érkezik.
    var exitAlong: Double { 1000 + firstNewManeuver(main, alt)!.distanceM }
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

    @Test("legalább 2 perc nyereség → ajánlat (AW12: a 15%-os szabály nincs)")
    func ketPercNyereseg() async throws {
        let offer = try #require(await offerWith(3600 - ALT_OFFER.minGainS, 3600))
        #expect(offer.gainS >= 120)
        #expect(offer.route.id == "alt")
    }

    @Test("2 percnél kevesebb nyereség → nincs ajánlat, rövid úton sem")
    func ketPercAlatt() async {
        #expect(await offerWith(3600 - 110, 3600) == nil)
        // 10 perces út, 1,8 perc (18%) – régen ajánlat lett volna
        #expect(await offerWith(600 - 108, 600) == nil)
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
        #expect(exit.distanceM > 66_000)
        #expect(exit.distanceM < 68_000)
        // a banner többi része (itt a cél-név, „Tata”) nem tapad a kijárat nevére
        #expect(exit.name == "Kijárat 67")
        #expect(f.alt.steps.contains { $0.banners.first?.primary.text == "Kijárat 67 Tata" })
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
            let i = copy.steps.firstIndex { $0.banners.first?.primary.exit == "Kijárat 67" }!
            edit(&copy.steps[i].banners[0])
            return copy
        }
        #expect(firstNewManeuver(f.main, f.alt)?.name == "Kijárat 67")
        // a felvételben ennek a lehajtónak nincs második sora: a cél-nevet a teszt adja
        let dest = BannerText(text: "Tata", type: "off ramp", modifier: "right", exit: nil)
        #expect(firstNewManeuver(f.main, withBanner {
            $0.primary.exit = nil
            $0.secondary = dest
        })?.name == "Tata")
        let none = try #require(firstNewManeuver(f.main, withBanner {
            $0.primary.exit = nil
            $0.secondary = nil
        }))
        #expect(none.name == nil)
    }

    @Test("mérés közben: a lehajtó a szakasz vége előtt → azonnal, kompakt ajánlat a lehajtó nevével és távolságával")
    func meresKozbenAzonnal() async throws {
        let (h, _) = try await measuringOn(70_000)
        let offer = try #require(h.session.view().offer)
        #expect(offer.compact)
        #expect(offer.exitName == "Kijárat 67")
        #expect(offer.exitInM > 66_000)
        #expect(offer.expiresAt == T0 + 120_000 + NAV_CONFIG.offerTtlMs)
        let voice = h.session.drainVoice().filter { $0.kind == .faster }
        #expect(voice.count == 1)
        #expect(voice.first?.text == altOfferVoice(altWorth(offer.gainS, offer.extraM, routeAvgKmh(offer.route)), exitKm: offer.exitKm, lang: .hu))
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
        let (h, f) = try await measuringOn(70_000)
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
        let (h, f) = try await measuringOn(70_000)
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

// MARK: alternatív útvonal a térképen (A8d / AW11)

@Suite("alternatív útvonal a térképen: címke és kiválasztás (A8d)")
struct AltLabelTests {
    @Test("a címke szövege: „+1 perc” / „−2 perc”, egy percen belül „Ugyanannyi idő”")
    func cimkeSzoveg() {
        #expect(altDeltaText(60, lang: .hu) == "+1 perc")
        #expect(altDeltaText(-120, lang: .hu) == "−2 perc")
        #expect(altDeltaText(-95, lang: .hu) == "−2 perc")
        #expect(altDeltaText(25, lang: .hu) == "Ugyanannyi idő")
        #expect(altDeltaText(180, lang: .en) == "+3 min")
    }

    @Test("a leágazás az alternatíva első, a kiválasztott sávján kívüli pontja; önmagától nem ágazik le")
    func leagazas() throws {
        let routes = try fixtureRoutes()
        let (main, alt) = (routes[0], routes[1])
        let d = try #require(divergenceAlongM(main, alt))
        #expect(d > 0)
        let core = coreRoute(main)!
        let a = coreRoute(alt)!
        #expect(core.project(a.pointAt(d)).crossM > ROUTE_MATCH_M)
        #expect(core.project(a.pointAt(max(0, d - 25))).crossM <= ROUTE_MATCH_M)
        #expect(divergenceAlongM(main, main) == nil)
    }

    @Test("címke csak az alternatíván, a leágazás után ~300 m-rel, a kártya menetidejével számolva")
    func cimkeHelye() throws {
        let routes = try fixtureRoutes()
        let labels = altLabels(routes, [3600, 3660], 0, lang: .hu)
        #expect(labels.count == 1)
        let l = try #require(labels.first)
        #expect(l.routeId == routes[1].id)
        #expect(l.index == 1)
        #expect(l.deltaS == 60)
        #expect(l.text == "+1 perc")
        let p = coreRoute(routes[1])!.project(l.at)
        #expect(p.crossM < 1)
        #expect(close(p.alongM - divergenceAlongM(routes[0], routes[1])!, ALT_LABEL_AFTER_M, -1))
    }

    @Test("kiválasztás-váltás: az érintett alternatíva lesz a kiválasztott, a címke a másikra kerül, előjelet vált")
    func valtas() throws {
        let routes = try fixtureRoutes()
        let sel = selectRouteById(routes, 0, routes[1].id)
        #expect(sel == 1)
        let labels = altLabels(routes, [3600, 3720], sel, lang: .hu)
        #expect(labels.map(\.routeId) == [routes[0].id])
        #expect(labels.map(\.text) == ["−2 perc"])
        // ismeretlen azonosító (pl. elavult érintés): marad a régi
        #expect(selectRouteById(routes, sel, "nincs") == 1)
        // egyetlen útvonalnál nincs címke
        #expect(altLabels([routes[0]], [3600], 0).isEmpty)
    }
}

// MARK: AW12 – az első éles navi-teszt javításai

@Suite("AW12: „megéri”-szabály a gyorsabb útra")
@MainActor
struct WorthTests {
    private let cityKmh = 30.0
    private let motorwayKmh = 120.0
    private func verdict(_ min: Double, _ km: Double, _ kmh: Double) -> AltVerdict { altWorth(min * 60, km * 1000, kmh).verdict }

    @Test("a kerülő ára az alternatíva átlagsebességéből: ≤ 40 km/h → 1,0, ≥ 110 → 0,3, között lineáris")
    func keruloAra() {
        #expect(detourCostPerKm(20) == 1)
        #expect(detourCostPerKm(40) == 1)
        #expect(close(detourCostPerKm(75), 0.65, 10))
        #expect(detourCostPerKm(110) == 0.3)
        #expect(detourCostPerKm(140) == 0.3)
        #expect(detourCostPerKm(.nan) == 1)
        // a Directions duration / distance: 10 km 10 perc alatt = 60 km/h
        #expect(close(routeAvgKmh(lineRoute(lengthM: 10_000, durationS: 600)), 60, 10))
    }

    @Test("példa-táblázat, város: 1 perc / 1 km nem, 3/1 igen, 7/4 igen, 10/20 nem")
    func varos() {
        #expect(verdict(1, 1, cityKmh) == .not)
        #expect(1 * 60 < ALT_OFFER.minGainS) // ajánlat sem lesz belőle
        #expect(verdict(3, 1, cityKmh) == .worth)
        #expect(verdict(7, 4, cityKmh) == .worth)
        #expect(verdict(10, 20, cityKmh) == .not)
    }

    @Test("példa-táblázat, autópálya: 20/50 igen, 20/100 nem, 10/20 igen, 100/100 igen")
    func autopalya() {
        #expect(verdict(20, 50, motorwayKmh) == .worth)
        #expect(verdict(20, 100, motorwayKmh) == .not)
        #expect(verdict(10, 20, motorwayKmh) == .worth)
        #expect(verdict(100, 100, motorwayKmh) == .worth)
    }

    @Test("a nettó nyereség határai: net ≥ 2 → megéri, 0 < net < 2 → lehet, net ≤ 0 → nem éri meg")
    func hatarok() {
        let a = altWorth(120, 0, cityKmh)
        #expect(a.net == 2 && a.verdict == .worth)
        let b = altWorth(120, 1000, cityKmh)
        #expect(b.net == 1 && b.verdict == .maybe)
        let c = altWorth(120, 2000, cityKmh)
        #expect(c.net == 0 && c.verdict == .not)
        // rövidebb alternatíva: a megtakarított km is nyereség
        #expect(altWorth(120, -1000, cityKmh).net == 3)
    }

    /// A városi teszt-útvonal (10 km, 30 perc) és egy alternatíva a megadott többlet-távval és nyereséggel.
    private func categoryOffer(_ gainMin: Double, _ extraKm: Double) async throws -> (h: Harness, route: NavRoute, offer: AlternativeOffer, voice: [String]) {
        let route = lineRoute(lengthM: 10_000, durationS: 1800)
        let alt = scaleDurations(lineRoute(lengthM: 10_000 + extraKm * 1000, durationS: 1800, id: "alt"), 1800 - gainMin * 60, "alt", latOffset: 0.003)
        let h = Harness(route)
        h.respond([route, alt])
        h.feed(at(route, 300, 0, T0 + 120_000))
        await h.session.settle()
        let offer = try #require(h.session.view().offer)
        return (h, route, offer, h.session.drainVoice().filter { $0.kind == .faster }.map(\.text))
    }

    @Test("három kategória: kártya és bemondás (megéri / lehet / nem éri meg)")
    func haromKategoria() async throws {
        let worth = try await categoryOffer(7, 4)
        #expect(worth.offer.verdict == .worth)
        #expect(worth.offer.title == "Megéri · −7 perc, +4 km")
        // AW13: a „megéri” bemondás a lehajtó távolságával
        #expect(worth.voice.count == 1)
        #expect(matches(worth.voice.first, #"^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$"#))

        let maybe = try await categoryOffer(2, 1)
        #expect(maybe.offer.verdict == .maybe)
        #expect(maybe.offer.title == "Lehet · −2 perc, +1 km")
        #expect(maybe.voice == ["Gyorsabb út, 2 perc, 1 kilométer kerülő, te döntesz"])

        let not = try await categoryOffer(10, 20)
        #expect(not.offer.verdict == .not)
        #expect(not.offer.title == "Nem éri meg · +20 km kerülő, −10 perc")
        #expect(not.voice == ["Gyorsabb út, de nem éri meg, 20 kilométer kerülő"])
    }

    @Test("a kártya-szöveg rövidebb alternatívánál „−km”, egyező távnál km nélkül; mind a 6 nyelven van szöveg")
    func kartyaSzoveg() {
        #expect(altOfferTitle(AltWorth(gainMin: 5, extraKm: -2, verdict: .worth), lang: .hu) == "Megéri · −5 perc, −2 km")
        #expect(altOfferTitle(AltWorth(gainMin: 5, extraKm: 0.2, verdict: .worth), lang: .hu) == "Megéri · −5 perc")
        for lang in Lang.allCases {
            for v in [AltVerdict.worth, .maybe, .not] {
                let w = AltWorth(gainMin: 7, extraKm: 4, verdict: v)
                #expect(matches(altOfferTitle(w, lang: lang), "7|4"), "\(lang) \(v)")
                #expect(!matches(altOfferVoice(w, lang: lang), "[{}]"), "\(lang) \(v)")
            }
        }
    }

    @Test("lejáratkor (45 s) a „megéri” elfogadódik, a „lehet” és a „nem éri meg” esetén marad a régi")
    func lejaratkor() async throws {
        for (gain, km, accepted) in [(7.0, 4.0, true), (2, 1, false), (10, 20, false)] {
            let c = try await categoryOffer(gain, km)
            c.h.feed(at(c.route, 400, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs - 1))
            #expect(c.h.session.view().offer != nil)
            c.h.feed(at(c.route, 500, 0, T0 + 120_000 + NAV_CONFIG.offerTtlMs))
            #expect(c.h.session.view().offer == nil)
            #expect(c.h.session.view().route.id == (accepted ? "alt" : "line"), "\(gain)/\(km)")
        }
    }

    @Test("több jelölt közül a legnagyobb nettó nyereségű (nem a leggyorsabb)")
    func legjobbJelolt() async {
        let route = lineRoute(lengthM: 10_000, durationS: 1800)
        let fast = scaleDurations(lineRoute(lengthM: 30_000, durationS: 1800, id: "fast"), 1800 - 600, "fast", latOffset: 0.003)
        let short = scaleDurations(lineRoute(lengthM: 11_000, durationS: 1800, id: "short"), 1800 - 300, "short", latOffset: -0.003)
        let h = Harness(route)
        h.respond([route, fast, short])
        h.feed(at(route, 300, 0, T0 + 120_000))
        await h.session.settle()
        #expect(h.session.view().offer?.route.id == "short")
    }
}

@Suite("AW13: mérés közben a kapu utáni közeli lehajtó azonnal")
@MainActor
struct ExitAfterGateTests {
    private func measuring(_ endBeforeExitM: Double) async throws -> (Harness, Fixture) {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData(sections: [f.sectionOn(400, f.exitAlong - endBeforeExitM)]))
        h.respond([f.main, f.alt])
        h.session.setMeasuring(true)
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        return (h, f)
    }

    @Test("a lehajtó a végkapu után 1 km-en belül → azonnal, kompakt ajánlat bemondással (mint a kapu előtti esetben)")
    func kapuUtanAzonnal() async throws {
        let (h, _) = try await measuring(500)
        let offer = try #require(h.session.view().offer)
        #expect(offer.compact)
        #expect(h.session.drainVoice().filter { $0.kind == .faster }.count == 1)
        // a mérés végén az ajánlat marad, teljes formában
        h.session.setMeasuring(false)
        #expect(h.session.view().offer?.compact == false)
    }

    @Test("a határ: a végkapu után pontosan 1 km → azonnal; 1 km-nél messzebb → visszatartva, a mérés végén megjelenik")
    func hatar() async throws {
        // 1 cm-rel a határon belül: a kapu és a lehajtó helye két vetítésből jön, a különbségük ~1e-9 m-t ingadozik
        let (at1km, _) = try await measuring(ALT_OFFER.exitAfterGateM - 0.01)
        #expect(at1km.session.view().offer?.compact == true)
        let (h, _) = try await measuring(ALT_OFFER.exitAfterGateM + 300)
        #expect(h.session.view().offer == nil)
        #expect(!h.session.drainVoice().contains { $0.kind == .faster })
        h.session.setMeasuring(false)
        #expect(h.session.view().offer != nil)
        #expect(h.session.drainVoice().filter { $0.kind == .faster }.count == 1)
    }

    @Test("a már látható ajánlat marad (kompakt formában), ha mérés kezdődik és a lehajtó a kapu után 1 km-en belül van")
    func lathatoMarad() async throws {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData(sections: [f.sectionOn(400, f.exitAlong - 200)]))
        h.respond([f.main, f.alt])
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        let id = try #require(h.session.view().offer).id
        h.session.setMeasuring(true)
        #expect(h.session.view().offer?.id == id)
        #expect(h.session.view().offer?.compact == true)
    }

    @Test("a már látható ajánlat visszatartódik, ha mérés kezdődik és a lehajtó a kaputól 1 km-nél messzebb van")
    func lathatoVisszatartva() async throws {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData(sections: [f.sectionOn(400, f.exitAlong - ALT_OFFER.exitAfterGateM - 300)]))
        h.respond([f.main, f.alt])
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        #expect(h.session.view().offer != nil)
        h.session.setMeasuring(true)
        #expect(h.session.view().offer == nil)
        h.session.setMeasuring(false)
        #expect(h.session.view().offer != nil)
    }

    @Test("a munkamenet „megéri” bemondása a lehajtó távolságával (a Budapest→Győr fixtúrán)")
    func megeriBemondas() async throws {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData())
        h.respond([f.main, f.alt])
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        let offer = try #require(h.session.view().offer)
        #expect(offer.verdict == .worth)
        let voice = try #require(h.session.drainVoice().first { $0.kind == .faster })
        #expect(matches(voice.text, #"^Gyorsabb út, \d+ perc megtakarítás, lehajtó \d+,\d kilométernél$"#))
        #expect(voice.text.contains(offer.exitKm))
    }

    @Test("timeLeft (a fogyó csík): 1-ről a lejáratig fogy")
    func timeLeft() async throws {
        let f = try Fixture()
        let h = Harness(f.main)
        h.session.setData(EnforcementData())
        h.respond([f.main, f.alt])
        h.feed(f.fix(1000, T0 + 120_000))
        await h.session.settle()
        #expect(h.session.view().offer?.timeLeft == 1)
        h.feed(f.fix(1100, T0 + 120_000 + NAV_CONFIG.offerTtlMs / 3))
        #expect(close(h.session.view().offer?.timeLeft, 2.0 / 3, 5))
    }
}

@Suite("AW13: „megéri” bemondás a lehajtóval")
struct WorthVoiceTests {
    @Test("„Gyorsabb út, {perc} perc megtakarítás, lehajtó {km} kilométernél”; ismeretlen lehajtónál a lehajtó nélkül; 6 nyelven")
    func bemondas() {
        let w = AltWorth(gainMin: 7, extraKm: 4, verdict: .worth)
        #expect(altOfferVoice(w, exitKm: "5,2", lang: .hu) == "Gyorsabb út, 7 perc megtakarítás, lehajtó 5,2 kilométernél")
        #expect(altOfferVoice(w, lang: .hu) == "Gyorsabb út, 7 perc megtakarítás")
        // a „lehet” és a „nem éri meg” szövege nem változik
        #expect(altOfferVoice(AltWorth(gainMin: 7, extraKm: 4, verdict: .maybe), exitKm: "5,2", lang: .hu) == "Gyorsabb út, 7 perc, 4 kilométer kerülő, te döntesz")
        #expect(altOfferVoice(AltWorth(gainMin: 7, extraKm: 4, verdict: .not), exitKm: "5,2", lang: .hu) == "Gyorsabb út, de nem éri meg, 4 kilométer kerülő")
        for lang in Lang.allCases {
            let text = altOfferVoice(w, exitKm: "5,2", lang: lang)
            #expect(text.contains("7"), "\(lang)")
            #expect(text.contains("5,2"), "\(lang)")
            #expect(!matches(text, "[{}]"), "\(lang)")
        }
    }
}

@Suite("AW13: kétsoros kompakt ajánlat")
struct CompactOfferTests {
    @Test("„Kijárat 56” / „2,1 km · −7 perc”; név nélkül „Lehajtó 2,1 km-nél” / „−7 perc”; ismeretlen lehajtónál a cím")
    func ketSor() {
        let title = "Megéri · −7 perc, +4 km"
        let lines = { (gainS: Double, exitAlongM: Double?, exitName: String?, lang: Lang) in
            altOfferCompactLines(title: title, gainS: gainS, exitAlongM: exitAlongM, exitName: exitName, exitKm: "2,1", lang: lang)
        }
        let gain = 7.0 * 60 + 10
        #expect(lines(gain, 12_000, "Kijárat 56", .hu) == ("Kijárat 56", "2,1 km · −7 perc"))
        #expect(lines(gain, 12_000, nil, .hu) == ("Lehajtó 2,1 km-nél", "−7 perc"))
        #expect(lines(gain, 12_000, "", .hu) == ("Lehajtó 2,1 km-nél", "−7 perc"))
        #expect(lines(gain, nil, "Kijárat 56", .hu) == (title, nil))
        #expect(lines(20, 12_000, "Kijárat 56", .hu).1 == "2,1 km · −1 perc")
        for lang in Lang.allCases {
            #expect(matches(lines(gain, 12_000, "Kijárat 56", lang).1, #"^2,1 km · −7 \S+$"#), "\(lang)")
        }
    }
}

/// Az Építész utca 11 valódi Directions-válaszának vége (2026-10-29): a cél a sarki mellékutcára (Abádi utca) illesztve.
private func epiteszUtca(_ lastStepM: Double = 8.039) -> [String: Any] {
    [
        "code": "Ok",
        "routes": [[
            "distance": 300 + 162.746 + lastStepM,
            "duration": 80,
            "geometry": ["coordinates": [[19.0337, 47.4482], [19.037655, 47.448162], [19.039807, 47.448023], [19.039796, 47.447951]]],
            "legs": [[
                "annotation": ["maxspeed": [Any](), "congestion": [Any](), "duration": [Any]()],
                "steps": [
                    [
                        "distance": 300, "duration": 40, "name": "Bártfai utca",
                        "maneuver": ["type": "depart", "location": [19.0337, 47.4482], "instruction": "Hajtson keletre."],
                        "bannerInstructions": [["distanceAlongGeometry": 300, "primary": ["text": "Építész utca", "type": "turn", "modifier": "left"]]],
                        "voiceInstructions": [Any](),
                    ],
                    [
                        "distance": 162.746, "duration": 35, "name": "Építész utca",
                        "maneuver": ["type": "turn", "modifier": "left", "location": [19.037655, 47.448162], "instruction": "Forduljon balra az Építész utcára."],
                        "bannerInstructions": [["distanceAlongGeometry": 162.746, "primary": ["text": "Abádi utca", "type": "turn", "modifier": "right"]]],
                        "voiceInstructions": [
                            ["distanceAlongGeometry": 146.079, "announcement": "200 méter múlva, Forduljon jobbra az Abádi utcára."],
                            ["distanceAlongGeometry": 61.75, "announcement": "Forduljon jobbra az Abádi utcára. Utána Az Ön úti célja balra lesz."],
                        ],
                    ],
                    [
                        "distance": lastStepM, "duration": 5, "name": "Abádi utca",
                        "maneuver": ["type": "turn", "modifier": "right", "location": [19.039807, 47.448023], "instruction": "Forduljon jobbra az Abádi utcára."],
                        "bannerInstructions": [["distanceAlongGeometry": lastStepM, "primary": ["text": "Az úti célja balra van", "type": "arrive", "modifier": "left"]]],
                        "voiceInstructions": [["distanceAlongGeometry": 4.039, "announcement": "Az Ön úti célja balra van."]],
                    ],
                    [
                        "distance": 0, "duration": 0, "name": "Abádi utca",
                        "maneuver": ["type": "arrive", "modifier": "left", "location": [19.039796, 47.447951], "instruction": "Az úti célja balra van."],
                    ],
                ],
            ]],
        ]],
    ]
}

@Suite("AW12: újratervezés, kamera, „Utána”, érkezés, követő zoom, mentett címek")
@MainActor
struct Aw12Tests {
    @Test("az „Újratervezés” a letéréskor szól (a kiírással együtt), az új útvonal érkezése előtt, és egyszer")
    func ujratervezesHang() async {
        let route = lineRoute()
        let h = Harness(route)
        h.feed(at(route, 2000, 0, T0))
        _ = h.session.drainVoice()
        let v1 = h.feed(at(route, 2050, 300, T0 + 1000))
        #expect(v1.offRoute)
        #expect(h.session.drainVoice().map(\.kind) == [.reroute])
        #expect(h.calls.isEmpty) // még nincs új útvonal-kérés
        for s in 2...7 { h.feed(at(route, 2050, 300, T0 + Double(s) * 1000)) }
        #expect(h.reasons == [.reroute])
        await h.session.settle()
        #expect(h.session.drainVoice().filter { $0.kind == .reroute }.isEmpty)
    }

    @Test("kamera-közeledés: max(250 m, 10 s × sebesség) – 60 km/h → 250 m, 130 km/h → 361 m; elhaladás után eltűnik")
    func kamera() {
        #expect(cameraAlertM(60 / 3.6) == 250)
        #expect(close(cameraAlertM(130 / 3.6), 361.1, 1))
        #expect(cameraAlertM(nil) == CAMERA_ALERT.minM)
        let route = lineRoute()
        let cam = camera("cam", "HU", at(route, 5000, 10), heading: nil, limit: 50)
        let h = Harness(route)
        h.session.setData(EnforcementData(cameras: [cam]))
        let v60 = 60 / 3.6
        #expect(h.feed(at(route, 4700, 0, T0, speed: v60)).cameraNear == nil)
        #expect(h.feed(at(route, 4760, 0, T0 + 1000, speed: v60)).cameraNear?.item.id == "cam")
        // gyorsan már 360 m-ről
        #expect(close(h.feed(at(route, 4650, 0, T0 + 2000, speed: 130 / 3.6)).cameraNear?.distanceM, 350, 0))
        #expect(h.feed(at(route, 5010, 0, T0 + 3000, speed: v60)).cameraNear == nil)
        // a távoli jelzés (kis sor) közben megmarad
        #expect(h.feed(at(route, 3500, 0, T0 + 4000, speed: v60)).upcoming?.item.kind == .camera)
    }

    @Test("az „Utána” sor: manőver-ikon + utcanév, név nélkül rövid manőver-szó – nem a teljes Directions-mondat")
    func utana() throws {
        func step(_ instruction: String, _ bannerText: String, _ type: String = "turn", _ modifier: String = "right") -> NavStep {
            NavStep(
                index: 0, distanceM: 100, durationS: 10, startM: 0, name: "",
                endManeuver: NavManeuver(type: type, modifier: modifier, instruction: instruction, location: ORIGIN),
                banners: [NavBanner(distanceAlongM: 100, primary: BannerText(text: bannerText, type: type, modifier: modifier))],
                voice: []
            )
        }
        func after(_ name: String) -> NavStep {
            var s = step("", "")
            s.name = name
            return s
        }
        // a szalag a mondat (név nélküli manőver): az utcanév kerül a helyére, ha van; különben a manőver-szó
        #expect(thenText(step("Forduljon jobbra, hogy a bekötőútra hajtson.", "Forduljon jobbra, hogy a bekötőútra hajtson"), after("Fő utca"), .right, lang: .hu) == "Fő utca")
        #expect(thenText(step("Forduljon jobbra, hogy ráhajtson a bekötőútra.", "Forduljon jobbra, hogy a bekötőútra"), after(""), .right, lang: .hu) == "Jobbra")
        #expect(thenText(step("Forduljon jobbra.", "Forduljon jobbra"), nil, .right, lang: .hu) == "Jobbra")
        // valódi utcanév / útszám a szalagon: az marad
        #expect(thenText(step("Forduljon balra az 1 irányába.", "1"), after(""), .left, lang: .hu) == "1")
        #expect(thenText(step("Forduljon jobbra az Abádi utcára.", "Abádi utca"), after("Abádi utca"), .right, lang: .hu) == "Abádi utca")
        #expect(thenText(step("Megérkezett.", "Megérkezett", "arrive", ""), nil, .arrive, lang: .hu) == "Cél")
        // a fixtúrán: egyik „Utána” sem a teljes mondat
        let main = try fixtureRoutes()[0]
        let h = Harness(main)
        let core = coreRoute(main)!
        for s in main.steps.dropLast(2) {
            let p = core.pointAt(s.startM + 1)
            let v = h.feed(GpsFix(lat: p.lat, lon: p.lon, timestamp: T0, speed: 10, accuracy: 5, heading: nil))
            if let then = v.then { #expect(!matches(then.text, "^(Forduljon|Tartson|Hajtson|Megérkezett)"), "\(s.index)") }
        }
    }

    @Test("érkezés (Építész utca 11): az érkezési küszöbnél rövidebb utolsó kanyar beolvad az érkezésbe")
    func erkezesCsonka() throws {
        let r = try #require(try parseDirections(epiteszUtca(), idPrefix: "ep").first)
        // a „Forduljon jobbra az Abádi utcára” (8 m) nem önálló manőver: az Építész utca lépés vége már az érkezés
        #expect(r.steps.map(\.endManeuver.type) == ["turn", "arrive", "arrive"])
        let last = r.steps[1]
        #expect(last.name == "Építész utca")
        #expect(close(last.distanceM, 162.746 + 8.039, 6))
        #expect(last.banners.first?.primary.type == "arrive")
        #expect(last.banners.first?.primary.text == "Az úti célja balra van")
        #expect(last.voice.map(\.text) == ["Az Ön úti célja balra van."])
        #expect((last.voice.first?.distanceAlongM ?? 0) > NAV_CONFIG.arriveM)
        #expect(r.steps.map(\.index) == [0, 1, 2])
        // a lépések összhossza továbbra is az útvonal hossza
        #expect(close(r.steps.reduce(0) { $0 + $1.distanceM }, r.distanceM, 6))
        // a kanyar előtt a felső kártya már az érkezést mutatja, nem a mellékutcát
        let h = Harness(r)
        let p = coreRoute(r)!.pointAt(320)
        let v = h.feed(GpsFix(lat: p.lat, lon: p.lon, timestamp: T0, speed: 8, accuracy: 5, heading: nil))
        #expect(v.next.icon == .arrive)
        #expect(v.then == nil)
        // a küszöbnél hosszabb utolsó lépés valódi manőver: marad
        let long = try #require(try parseDirections(epiteszUtca(60), idPrefix: "ep").first)
        #expect(long.steps.map(\.endManeuver.type) == ["turn", "turn", "arrive", "arrive"])
        var steps = long.steps
        absorbArrivalStub(&steps, maxM: 30)
        #expect(steps.count == 4)
    }

    @Test("érkezés: a tervezés a cím útra illesztett pontjára (routable point) megy, a jelölő a címen marad")
    func routablePoint() async throws {
        let places = parseGeocode([
            "features": [
                [
                    "geometry": ["coordinates": [19.039894, 47.447944]],
                    "properties": ["mapbox_id": "ep11", "name": "Építész utca 11", "place_formatted": "Budapest, 1116", "coordinates": ["routable_points": [["name": "default", "latitude": 47.448016, "longitude": 19.039905]]]],
                ],
                ["geometry": ["coordinates": [19.04, 47.45]], "properties": ["name": "Építész utca", "coordinates": [String: Any]()]],
            ],
        ])
        let routable = LatLon(lat: 47.448016, lon: 19.039905)
        #expect(places[0].lat == 47.447944 && places[0].lon == 19.039894)
        #expect(places[0].routable == routable)
        #expect(places[0].routeTarget == routable)
        #expect(places[1].routable == nil)
        #expect(places[1].routeTarget == LatLon(lat: 47.45, lon: 19.04))
        // a tárolt utolsó célok és mentett helyek megtartják
        #expect(parseRecents(serializeRecents(addRecent([], places[0]))).first?.routable == routable)
        // az újratervezés is oda tervez
        let route = lineRoute()
        let target = LatLon(lat: 47.6, lon: 19.2)
        let h = Harness(route, routable: target)
        for s in 0...6 { h.feed(at(route, 2000, 300, T0 + Double(s) * 1000)) }
        await h.session.settle()
        #expect(h.calls.first?.to == target)
        #expect(h.session.view().destination.lat == route.points.last!.lat)
    }

    @Test("követő zoom a sebességgel: < 40 km/h 17, 90 km/h 15,5, 130 km/h 14,5, között lineáris")
    func kovetoZoom() {
        #expect(navFollowZoom(0) == 17)
        #expect(navFollowZoom(40) == 17)
        #expect(close(navFollowZoom(65), 16.25, 10))
        #expect(navFollowZoom(90) == 15.5)
        #expect(close(navFollowZoom(110), 15, 10))
        #expect(navFollowZoom(130) == 14.5)
        #expect(navFollowZoom(180) == 14.5)
        #expect(navFollowZoom(.nan) == 17)
    }

    @Test("mentett címek: Haza, Munka, továbbiak – chip-sorrend, nem duplázódik, törölhető, tárolódik")
    func mentettCimek() {
        func p(_ i: Int, _ name: String? = nil) -> Place { Place(id: "p\(i)", name: name ?? "Hely \(i)", address: "", lat: 47 + Double(i), lon: 19) }
        var saved = SavedPlaces(home: p(1, "Otthon utca"), work: nil, others: [])
        saved = addSavedOther(saved, p(2, "Edzőterem"))
        saved = addSavedOther(saved, p(3, "Nagymama"))
        var dup = p(2)
        dup.id = "masik"
        #expect(addSavedOther(saved, dup) == saved)
        let chips = savedChips(saved, lang: .hu)
        #expect(chips.map(\.icon) == [.home, .pin, .pin])
        #expect(chips.map(\.label) == ["Haza", "Edzőterem", "Nagymama"])
        #expect(parseSaved(serializeSaved(saved)).others.map(\.name) == ["Edzőterem", "Nagymama"])
        #expect(removeSavedOther(saved, "p2").others.map(\.id) == ["p3"])
    }
}

@Suite("AOS13: a felső lépés-kártya nem kerülhet az alsó kártya-csoport alá")
struct NavStepLayoutTests {
    @Test("mérés közben mindig sáv; egyébként sáv, ha a teljes kártya (+ térköz) az alsó csoport teteje alá érne; méretlenül kártya")
    func savVagyKartya() {
        let strip = { (measuring: Bool, cardBottom: Double?, bottomTop: Double?) in
            navStepStrip(NavStepLayout(measuring: measuring, cardBottom: cardBottom, bottomTop: bottomTop, gap: 8))
        }
        // a mérés utáni eredménykártya a 390 × 844-es nézetben (AOS13): a kártya alja 322, a „Szakasz vége” teteje 237
        #expect(strip(false, 322, 237))
        // navigációs alsó sáv (nincs szakasz): bőven elfér
        #expect(!strip(false, 322, 740))
        // a határ: pontosan a térköznyi rés még elfér
        #expect(!strip(false, 322, 330))
        #expect(strip(false, 322.5, 330))
        // mérés közben a mérési adatoktól függetlenül sáv
        #expect(strip(true, 322, 740))
        #expect(strip(true, nil, nil))
        // az első elrendezés előtt a teljes kártya marad
        #expect(!strip(false, nil, 237))
        #expect(!strip(false, 322, nil))
    }

    @Test("navigáció közben a mérés eredménye kompakt; navigáció nélkül és más fázisban a nagy kártya marad")
    func kompaktEredmeny() {
        #expect(navResultCompact(.befejezve, navigating: true))
        #expect(!navResultCompact(.befejezve, navigating: false))
        for phase in [SessionPhase.nincsSzakasz, .kozeledik, .meres, .kezi, .megszakadt] {
            #expect(!navResultCompact(phase, navigating: true), "\(phase)")
        }
    }
}

@Suite("AW15: kézi átlagmérés navigáció közben")
struct ManualPillTests {
    @Test("a kézi mérés eredménye navigáció közben kompakt, navigáció nélkül nagy")
    func kompaktKeziEredmeny() {
        #expect(navResultCompact(.keziEredmeny, navigating: true))
        #expect(!navResultCompact(.keziEredmeny, navigating: false))
    }

    @Test("a zsugorított kártya: navigáció nélkül nincs; induláskor teljes kártya, 5 s után zsugorított; bökésre ki, újabb bökésre vagy 5 s után vissza")
    func pillAllapotgep() throws {
        #expect(MANUAL_PILL.collapseAfterMs == 5000)
        #expect(manualPillTick(nil, active: false, space: false, now: 0) == nil)
        var s = try #require(manualPillTick(nil, active: true, space: false, now: 1000))
        #expect(!s.collapsed)
        s = try #require(manualPillTick(s, active: true, space: false, now: 5999))
        #expect(!s.collapsed)
        s = try #require(manualPillTick(s, active: true, space: false, now: 6000))
        #expect(s.collapsed)
        // bökésre teljes kártya, az 5 s újraindul
        s = manualPillTap(s, now: 10_000)
        #expect(!s.collapsed)
        #expect(manualPillTick(s, active: true, space: false, now: 14_999)?.collapsed == false)
        #expect(manualPillTick(s, active: true, space: false, now: 15_000)?.collapsed == true)
        // újabb bökésre azonnal vissza
        #expect(manualPillTap(s, now: 11_000).collapsed)
        // a navigáció vége / a mérés vége: nincs pill
        #expect(manualPillTick(s, active: false, space: false, now: 11_000) == nil)
        // változatlan állapotnál ugyanaz az érték
        #expect(manualPillTick(s, active: true, space: false, now: 11_000) == s)
    }

    @Test("a zsugorított kártya: magától összemegy, ha a navigációnak hely kell (manőver < 500 m, ajánlat, közeli kamera)")
    func pillHelyigeny() throws {
        #expect(navNeedsSpace(maneuverM: 499, offer: false, cameraNear: false))
        #expect(!navNeedsSpace(maneuverM: 500, offer: false, cameraNear: false))
        #expect(!navNeedsSpace(maneuverM: nil, offer: false, cameraNear: false))
        #expect(navNeedsSpace(maneuverM: 3000, offer: true, cameraNear: false))
        #expect(navNeedsSpace(maneuverM: 3000, offer: false, cameraNear: true))
        // a hely-igény a nyitott (felhasználó által kinyitott) kártyát azonnal összecsukja
        var s = try #require(manualPillTick(nil, active: true, space: false, now: 0))
        s = try #require(manualPillTick(s, active: true, space: false, now: 5000))  // 5 s: zsugorított
        s = manualPillTap(s, now: 6000)  // a felhasználó kinyitja
        #expect(manualPillTick(s, active: true, space: false, now: 7000)?.collapsed == false)
        #expect(manualPillTick(s, active: true, space: true, now: 7000)?.collapsed == true)  // felfutó él → azonnal
        // ha a hely-igény már fennáll, miközben kinyitják: 5 s-ig nyitva marad
        var t = try #require(manualPillTick(nil, active: true, space: true, now: 0))
        t = try #require(manualPillTick(t, active: true, space: true, now: 3000))  // 3 s: összement
        t = manualPillTap(t, now: 4000)
        #expect(manualPillTick(t, active: true, space: true, now: 8999)?.collapsed == false)
        #expect(manualPillTick(t, active: true, space: true, now: 9000)?.collapsed == true)
    }

    @Test("indítás után az első 5 s-ban nyitva marad hely-igény mellett is, de 3 s után összemegy (az indítástól)")
    func indulasUtaniHelyigeny() throws {
        #expect(MANUAL_PILL.startSpaceCollapseMs == 3000)
        // indításkor már fennálló hely-igény: 0–2,999 s nyitva, 3 s-tól zsugorított
        var s = try #require(manualPillTick(nil, active: true, space: true, now: 10_000))
        #expect(!s.collapsed)
        #expect(manualPillTick(s, active: true, space: true, now: 12_999)?.collapsed == false)
        #expect(manualPillTick(s, active: true, space: true, now: 13_000)?.collapsed == true)
        // a hely-igény 1 s-nál jelenik meg: nem csuk azonnal, 3 s-nál igen
        s = try #require(manualPillTick(nil, active: true, space: false, now: 0))
        s = try #require(manualPillTick(s, active: true, space: true, now: 1000))
        #expect(!s.collapsed)
        #expect(manualPillTick(s, active: true, space: true, now: 3000)?.collapsed == true)
        // 4 s-nál jelenik meg: már elmúlt a 3 s → azonnal zsugorított
        s = try #require(manualPillTick(nil, active: true, space: false, now: 0))
        #expect(manualPillTick(s, active: true, space: true, now: 4000)?.collapsed == true)
        // hely-igény nélkül marad az 5 s
        s = try #require(manualPillTick(nil, active: true, space: false, now: 0))
        #expect(manualPillTick(s, active: true, space: false, now: 4999)?.collapsed == false)
        #expect(manualPillTick(s, active: true, space: false, now: 5000)?.collapsed == true)
    }

    @Test("a zsugorított kártya státusz-színe a navigáció határából: jó / lassíts / túl gyors; ismeretlen határnál nincs")
    func zsugoritottStatusz() {
        #expect(manualMiniStatus(88, 90, 90) == .jo)
        #expect(manualMiniStatus(95, 85, 90) == .lassits)
        #expect(manualMiniStatus(95, 100, 90) == .tulGyors)
        #expect(manualMiniStatus(95, nil, 90) == .tulGyors)
        #expect(manualMiniStatus(nil, 80, 90) == nil)
        #expect(manualMiniStatus(95, 85, nil) == nil)
    }
}
