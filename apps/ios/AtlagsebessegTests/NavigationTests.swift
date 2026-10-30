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
private func lineRoute(lengthM: Double = 10_000, durationS: Double = 360, latOffset: Double = 0, limit: Double? = 90, id: String = "line", startX: Double = 0) -> NavRoute {
    let proj = LocalProjection(LatLon(lat: ORIGIN.lat + latOffset, lon: ORIGIN.lon))
    let n = Int(jsRound(lengthM / 100))
    // AW18: `startX` – a kelet felé futó egyenes ennyi méterrel később indul (a friss, a jelenlegi pozíciótól kért útvonal)
    let points = (0...n).map { proj.fromXY(XY(x: startX + Double($0) * lengthM / Double(n), y: 0)) }
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
            endManeuver: NavManeuver(type: type, modifier: modifier, instruction: last ? "Megérkezett" : "Forduljon jobbra", location: points[min((i + 1) * 10, n)]),
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
    var calls: [(reason: RouteRequestReason, from: LatLon, to: LatLon, via: LatLon?, t: Double)] = []
    var t = T0
    var next: Result<[NavRoute], Error>
    var session: NavigationSession!
    /// AW18: a session naplója (az újratervezés hibájának oka).
    var logs: [String] = []

    init(_ route: NavRoute, voice: Bool = true, routable: LatLon? = nil) {
        next = .success([route])
        let dest = route.points.last!
        session = NavigationSession(
            route: route,
            destination: NavDestination(name: "Cél", lat: dest.lat, lon: dest.lon, routable: routable),
            fetchRoutes: { [unowned self] from, to, ctx in
                self.calls.append((ctx.reason, from, to, ctx.via, self.t))
                let r = self.next
                return Task { try r.get() }
            },
            now: { [unowned self] in self.t },
            voice: voice,
            lang: .hu,
            log: { [unowned self] in self.logs.append($0) }
        )
    }

    func respond(_ routes: [NavRoute]) { next = .success(routes) }
    func fail(_ e: Error = DirectionsError(code: "halozat")) { next = .failure(e) }

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

    @Test("AW18: sikertelen újratervezés után növekvő várakozással próbál újra (5 → 10 → 20 → 30 → 30 s), a kártya a hátralévő másodpercet mutatja, az ok a naplóba")
    func backoff() async {
        let route = lineRoute()
        let h = Harness(route, voice: false)
        h.fail(DirectionsError(code: "http_503"))
        for s in 0...130 {
            h.feed(at(route, 2000, 300, T0 + Double(s) * 1000))
            await h.session.settle()
            if s == 7 { #expect(h.session.view().rerouteRetryInS == 3) }
        }
        // 5 s letérés → 1. próba; utána 5, 10, 20, 30, 30 s várakozás
        #expect(h.calls.map { ($0.t - T0) / 1000 } == [5, 10, 20, 40, 70, 100, 130])
        #expect(h.session.view().rerouteFailed)
        #expect(h.logs.first?.contains("http_503") == true)
        #expect(h.logs.count == 7)
    }

    @Test("AW18: koppintásra azonnal újrapróbál; visszatérve az útvonalra a hiba-kártya eltűnik")
    func koppintas() async {
        let route = lineRoute()
        let h = Harness(route, voice: false)
        h.fail(URLError(.notConnectedToInternet))
        for s in 0...12 {
            h.feed(at(route, 2000, 300, T0 + Double(s) * 1000))
            await h.session.settle()
        }
        // próbák: 5 s, 10 s (a következő a 20. s-nál lenne)
        #expect(h.calls.count == 2)
        #expect(h.session.view().rerouteRetryInS == 8)
        h.t = T0 + 16_000
        h.session.retryReroute()
        #expect(h.calls.count == 3)
        #expect(h.calls[2].t == T0 + 16_000)
        await h.session.settle()
        #expect(h.logs.last?.contains("network") == true)
        // az előző hívás után 5 s-on belül a koppintás a korlát leteltét várja (a visszaszámlálás ezt mutatja)
        h.t = T0 + 18_000
        h.session.retryReroute()
        #expect(h.calls.count == 3)
        #expect(h.session.view().rerouteRetryInS == 3)
        // vissza az útvonalra: nincs több próba, a kártya eltűnik
        h.feed(at(route, 2100, 0, T0 + 17_000))
        #expect(h.session.view().rerouteFailed == false)
        #expect(h.session.view().rerouteRetryInS == nil)
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

    /// `gainS`: 600 s → „Megéri”, `MAYBE_GAIN_S` → „Lehet”, `NOT_GAIN_S` → „Nem éri meg”.
    init(gainS: Double = 600) throws {
        let routes = try fixtureRoutes()
        main = routes[0]
        core = coreRoute(main)!
        alt = scaleDurations(routes[1], main.durationS - gainS, "alt")
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

/// A Budapest→Győr alternatívája ennyi nyereséggel „Lehet” (a 7,3 km-es kerülő ára ~2,3 perc), 130 s-mal „Nem éri meg”.
private let MAYBE_GAIN_S = 240.0
private let NOT_GAIN_S = 130.0

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

    private func measuringOn(_ sectionToM: Double, gainS: Double = 600) async throws -> (Harness, Fixture) {
        let f = try Fixture(gainS: gainS)
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

    @Test("bemondás Waze-mintára („Lehet”): azonnal, majd 500 m-nél még egyszer")
    func waze() async throws {
        let (h, f) = try await measuringOn(70_000, gainS: MAYBE_GAIN_S)
        #expect(h.session.view().offer?.verdict == .maybe)
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

    @Test("a lehajtót 50 m-rel elhagyva az ajánlat eltűnik („Lehet”)")
    func elhagyva() async throws {
        let (h, f) = try await measuringOn(70_000, gainS: MAYBE_GAIN_S)
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

    @Test("AW17: a „Megéri” ajánlat a lehajtó előtt 500 m-en belül magától elfogad, a 45 s kivárása nélkül; a hang a kézi elfogadásé")
    func autoValtas() async throws {
        let (h, f) = try await measuringOn(70_000)
        #expect(h.session.view().offer?.verdict == .worth)
        let exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM
        h.feed(f.fix(exitAlong - 600, T0 + 125_000))
        #expect(h.session.view().offer != nil)
        _ = h.session.drainVoice()
        // 10 s-mal az ajánlat után (a 45 s-ból még bőven van), 450 m-rel a lehajtó előtt
        let v = h.feed(f.fix(exitAlong - 450, T0 + 130_000))
        #expect(v.offer == nil)
        #expect(v.route.id == "alt")
        let auto = h.session.drainVoice()
        // nincs külön „Gyorsabb út, lehajtó 500 méternél”: a váltás után az új útvonal szól, mint kézi elfogadásnál
        #expect(!auto.contains { $0.kind == .faster })
        let (mh, mf) = try await measuringOn(70_000)
        mh.feed(mf.fix(exitAlong - 600, T0 + 125_000))
        _ = mh.session.drainVoice()
        mh.session.acceptOffer()
        mh.feed(mf.fix(exitAlong - 450, T0 + 130_000))
        let manual = mh.session.drainVoice()
        #expect(auto.map { "\($0.kind)|\($0.text)" } == manual.map { "\($0.kind)|\($0.text)" })
    }

    @Test("AW17: „Lehet” és „Nem éri meg” ajánlatnál 500 m-en belül sincs automatikus váltás")
    func nincsAutoValtas() async throws {
        for (gainS, verdict) in [(MAYBE_GAIN_S, AltVerdict.maybe), (NOT_GAIN_S, AltVerdict.not)] {
            let (h, f) = try await measuringOn(70_000, gainS: gainS)
            #expect(h.session.view().offer?.verdict == verdict, "\(verdict)")
            let exitAlong = 1000 + firstNewManeuver(f.main, f.alt)!.distanceM
            let v = h.feed(f.fix(exitAlong - 300, T0 + 130_000))
            #expect(v.offer?.verdict == verdict, "\(verdict)")
            #expect(v.route.id == f.main.id, "\(verdict)")
        }
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
    @Test("AW18: a címke a kártyák kerekített perceiből: 42 vs 41 → „−1 perc”; „Ugyanannyi idő” csak egyenlő kerekített percnél")
    func cimkeSzoveg() {
        #expect(altDeltaText(41 * 60, 42 * 60, lang: .hu) == "−1 perc")
        #expect(altDeltaText(43 * 60, 41 * 60, lang: .hu) == "+2 perc")
        // 41,5 → 42 és 41,2 → 41 perc a kártyán: 20 s különbség is „+1 perc”
        #expect(altDeltaText(2490, 2470, lang: .hu) == "+1 perc")
        // mindkettő 41 perc a kártyán
        #expect(altDeltaText(2470, 2440, lang: .hu) == "Ugyanannyi idő")
        #expect(altDeltaText(180, 60, lang: .en) == "+2 min")
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

    @Test("címke csak az alternatíván, horgony a saját szakasz legtávolabbi pontján, a kártya menetidejével számolva")
    func cimkeHelye() throws {
        let routes = try fixtureRoutes()
        let labels = altLabels(routes, [3600, 3660], 0, lang: .hu)
        #expect(labels.count == 1)
        let l = try #require(labels.first)
        #expect(l.routeId == routes[1].id)
        #expect(l.index == 1)
        #expect(l.deltaS == 60)
        #expect(l.text == "+1 perc")
        // AW18: élesben 42 perc (0.) vs 41 perc (1.): a kiválasztott 41 perces mellett a 42 perces „+1 perc”, fordítva „−1 perc”
        #expect(altLabels(routes, [2520, 2460], 1, lang: .hu).first?.text == "+1 perc")
        #expect(altLabels(routes, [2520, 2460], 0, lang: .hu).first?.text == "−1 perc")
        let a = coreRoute(routes[1])!
        let core = coreRoute(routes[0])!
        // a horgony az alternatíván van, a saját szakaszán, és onnan a legmesszebb van a kiválasztottól
        #expect(a.project(l.at).crossM < 1)
        #expect(l.own.count > 10)
        let far = core.project(l.at).crossM
        for p in l.own { #expect(core.project(p).crossM <= far + 1e-6) }
        #expect(far > 1000)
        // a saját szakasz minden pontja a kiválasztott sávján kívül van; a leágazás az alternatíván
        for p in l.own { #expect(core.project(p).crossM > ROUTE_MATCH_M) }
        #expect(close(a.project(l.divergence).alongM, divergenceAlongM(routes[0], routes[1])!, 0))
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
    @Test("AW17: „Kijárat 56 · 2,5 km · −7 perc gyorsabb”; név nélkül „Lehajtó 2,5 km-nél · −7 perc gyorsabb”; ismeretlen lehajtónál a cím")
    func egySor() {
        let title = "Megéri · −7 perc, +4 km"
        let gain = 7.0 * 60 + 10
        let lines = { (gainS: Double, exitAlongM: Double?, exitName: String?, lang: Lang) in
            altOfferCompactLines(title: title, gainS: gainS, exitAlongM: exitAlongM, exitName: exitName, exitKm: "2,5", lang: lang)
        }
        let text = { (exitAlongM: Double?, exitName: String?, lang: Lang) in
            altOfferCompactText(title: title, gainS: gain, exitAlongM: exitAlongM, exitName: exitName, exitKm: "2,5", lang: lang)
        }
        #expect(lines(gain, 12_000, "Kijárat 56", .hu) == ("Kijárat 56", "2,5 km · −7 perc gyorsabb"))
        #expect(text(12_000, "Kijárat 56", .hu) == "Kijárat 56 · 2,5 km · −7 perc gyorsabb")
        #expect(text(12_000, nil, .hu) == "Lehajtó 2,5 km-nél · −7 perc gyorsabb")
        #expect(text(12_000, "", .hu) == "Lehajtó 2,5 km-nél · −7 perc gyorsabb")
        #expect(text(nil, "Kijárat 56", .hu) == title)
        #expect(lines(20, 12_000, "Kijárat 56", .hu).1 == "2,5 km · −1 perc gyorsabb")
        // a „gyorsabb” szó mind a 6 nyelven ott van
        let faster: [Lang: String] = [.hu: "gyorsabb", .en: "faster", .de: "schneller", .sk: "rýchlejšie", .cs: "rychleji", .pl: "szybciej"]
        for lang in Lang.allCases {
            #expect(matches(text(12_000, "Kijárat 56", lang), "^Kijárat 56 · 2,5 km · −7 \\S+ ?\(faster[lang]!)$"), "\(lang)")
            #expect(text(12_000, nil, lang).contains(faster[lang]!), "\(lang)")
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
}

// MARK: AW17 – elrendezés, „Utána” 5 km-en belül, tábla és mérés, Beállítások

@Suite("AW17: elrendezés, „Utána” 5 km-en belül, tábla és mérés, Beállítások")
@MainActor
struct AW17LayoutTests {
    @Test("az „Utána” sor csak akkor, ha a következő manőver 5 km-en belül van")
    func utana5km() throws {
        let main = try fixtureRoutes()[0]
        let core = coreRoute(main)!
        // egy 5 km-nél hosszabb lépés, amely után még jön manőver (az autópálya-szakasz)
        let step = try #require(main.steps.enumerated().first { $0.element.distanceM > NAV_CONFIG.thenWithinM + 1000 && $0.offset + 2 < main.steps.count }?.element)
        func fix(_ alongM: Double, _ t: Double) -> GpsFix {
            let p = core.pointAt(alongM)
            return GpsFix(lat: p.lat, lon: p.lon, timestamp: t, speed: 25, accuracy: 5, heading: nil)
        }
        let h = Harness(main)
        let endM = step.startM + step.distanceM
        let far = h.feed(fix(endM - NAV_CONFIG.thenWithinM - 500, T0))
        #expect(far.next.distanceM > NAV_CONFIG.thenWithinM)
        #expect(far.then == nil)
        let near = h.feed(fix(endM - NAV_CONFIG.thenWithinM + 500, T0 + 1000))
        #expect(near.next.distanceM <= NAV_CONFIG.thenWithinM)
        #expect(near.then != nil)
    }

    @Test("alsó sáv: mérés közben nincs benne sebesség (a mérőkártya „most” mezője mutatja), máskor van")
    func alsoSavSebesseg() {
        #expect(!navBottomShowsSpeed(.meres))
        for phase in [SessionPhase.nincsSzakasz, .kozeledik, .befejezve, .megszakadt, .kezi, .keziEredmeny] {
            #expect(navBottomShowsSpeed(phase), "\(phase)")
        }
    }

    @Test("alsó sáv km/h: piros, ha a kijelzett sebesség a bal alsó tábla limitje fölött van; limit nélkül soha")
    func pirosKmh() {
        #expect(navSpeedOver(111, 110))
        #expect(!navSpeedOver(110.4, 110))
        #expect(navSpeedOver(110.5, 110))
        #expect(!navSpeedOver(110, 110))
        #expect(!navSpeedOver(150, nil))
        #expect(!navSpeedOver(nil, 50))
    }

    @Test("egysoros kártyánál nincs külön „Lassíts” sáv – a max érték a kártyában; teljes kártyánál a sáv visszajön")
    func lassitsSavEgysoros() {
        #expect(!slowDownBarShown(navMeterCompact(.meres, offer: true)))
        #expect(slowDownBarShown(navMeterCompact(.meres, offer: false)))
        // a 137 / 130 / 108-as példa: „lassíts”, max 115
        #expect(compactMeterBarText(meterBar(.lassits, .ok(maxKmh: 115.28)), .kmh, lang: .hu) == "max 115")
        #expect(compactMeterBarText(meterBar(.tulGyors, .ok(maxKmh: 103.4)), .kmh, lang: .hu) == "max 103")
        #expect(compactMeterBarText(meterBar(.tulGyors, .nemLehetseges(maxKmh: 40)), .kmh, lang: .hu) == "nem hozható")
        #expect(compactMeterBarText(meterBar(.jo, .ok(maxKmh: 140)), .kmh, lang: .hu) == nil)
        #expect(compactMeterBarText(meterBar(.tulGyors, .ok(maxKmh: 160.934)), .mph, lang: .hu) == "max 100")
        for lang in Lang.allCases {
            #expect(compactMeterBarText(.max(maxKmh: 115), .kmh, lang: lang)?.contains("115") == true, "\(lang)")
            #expect(!(compactMeterBarText(.nemHozhato, .kmh, lang: lang) ?? "").isEmpty, "\(lang)")
        }
    }

    @Test("mérés + ajánlat egyszerre: a mérőkártya egysoros; ajánlat nélkül vagy mérésen kívül teljes")
    func egysorosMero() {
        #expect(navMeterCompact(.meres, offer: true))
        #expect(!navMeterCompact(.meres, offer: false))
        #expect(!navMeterCompact(.kozeledik, offer: true))
        #expect(!navMeterCompact(.befejezve, offer: true))
    }

    @Test("szakaszon belüli alacsonyabb Mapbox-tábla (110) nem változtatja a mérés határát (130) – csak a bal alsó tábla követi")
    func tablaEsMeres() {
        let route = lineRoute(lengthM: 10_000, durationS: 300, limit: 110)
        let section = makeSection(route, 1000, 9000, limit: 130)
        let h = Harness(route)
        h.session.setData(EnforcementData(sections: [section]))
        let measure = TrackingSession([section], now: { [h] in h.t })
        let v120 = 120 / 3.6
        var nav = h.feed(at(route, 0, 0, T0, speed: v120))
        var meter = measure.onFix(at(route, 0, 0, T0, speed: v120))
        for s in 1...150 {
            let fix = at(route, Double(s) * v120, 0, T0 + Double(s) * 1000, speed: v120)
            nav = h.feed(fix)
            meter = measure.onFix(fix)
        }
        // a navigáció táblája a Mapbox-limit (110), a mérés a szakasz határával (130) számol
        #expect(nav.limitKmh == 110)
        #expect(nav.enforcement.first { $0.kind == .section }?.limitKmh == 130)
        #expect(meter.phase == .meres)
        #expect(meter.section?.speedLimitKmh == 130)
        #expect(close(meter.live?.averageKmh, 120, 0))
        #expect(meter.status == .jo)
        // 120 > 110: az alsó sáv piros (csak a tábla követi), a mérés állapota jó (130 alatt)
        #expect(navSpeedOver(meter.currentKmh, nav.limitKmh))
    }

    @Test("Beállítások: a hang elérhetősége zárójelben a „Hangos utasítások” leírásának végén")
    func hangInfo() {
        #expect(voiceInstructionsHint(.ok, lang: .hu) == "Fordulók, szakaszellenőrzés és „túl gyors” bemondása (Van hang ehhez a nyelvhez)")
        #expect(matches(voiceInstructionsHint(.missing, lang: .hu), #"^Fordulók, .* \(Ehhez a nyelvhez nincs hang az eszközön – .*\)$"#))
        #expect(matches(voiceInstructionsHint(.unsupported, lang: .hu), #"\(A böngésző nem tud beszélni\)$"#))
        #expect(!L10nKey.allCases.map(\.rawValue).contains("settings.voice"))
        #expect(voiceInstructionsHint(.ok, lang: .en) == "Spoken turns, section checks and “too fast” warnings (A voice is available for this language)")
    }
}

@Suite("AW17: az útvonalválasztó „+N perc” címkéjének helye (képernyő-pixelben)")
struct AW17LabelTests {
    private let VP = (w: 390.0, h: 844.0)
    private let LABEL = (w: 72.0, h: 30.0)

    private func dist(_ p: Px, _ line: [Px]) -> Double {
        var d = Double.infinity
        for i in 0..<(line.count - 1) {
            let a = line[i], b = line[i + 1]
            let len2 = pow(b.x - a.x, 2) + pow(b.y - a.y, 2)
            let u = len2 == 0 ? 0 : max(0, min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2))
            d = min(d, hypot(p.x - (a.x + u * (b.x - a.x)), p.y - (a.y + u * (b.y - a.y))))
        }
        return d
    }

    private func boxDist(_ p: Px, _ b: LabelBox) -> Double {
        hypot(p.x - max(b.x, min(p.x, b.x + b.w)), p.y - max(b.y, min(p.y, b.y + b.h)))
    }

    private func pts(_ xy: [(Double, Double)], dy: Double = 0) -> [Px] { xy.map { Px(x: $0.0, y: $0.1 + dy) } }

    @Test("szintetikus: a horgony a legtávolabbi pont, a címke tőle elfelé (fölé), vonalat nem takar")
    func szintetikusFole() throws {
        let base = pts([(0, 500), (400, 500)])
        let alt = pts([(0, 500), (100, 500), (100, 300), (200, 280), (300, 300), (300, 500), (400, 500)])
        let own = pts([(100, 400), (100, 300), (150, 290), (200, 280), (250, 290), (300, 300), (300, 400)])
        let p = try #require(placeAltLabel(own: own, base: base, alt: alt, divergence: Px(x: 100, y: 500), label: (60, 28), viewport: (400, 800)))
        #expect(p.anchor == Px(x: 200, y: 280))
        #expect(p.side == .above)
        #expect(p.box == LabelBox(x: 170, y: 280 - ALT_LABEL_PLACE.gapPx - 28, w: 60, h: 28))
    }

    @Test("szintetikus: ha a legtávolabbi pont mellett minden oldal a célt takarná, a következő legtávolabbi a horgony")
    func szintetikusCel() throws {
        // a kiválasztott a (300,500)-nál ér véget (cél); az alternatíva legtávolabbi pontja a cél-jelölőn van (30 px-rel
        // fölötte): bármelyik oldalra kerülne, a jelölőt takarná
        let base = pts([(0, 500), (300, 500)])
        let alt = pts([(0, 500), (100, 500), (150, 515), (300, 470), (300, 500)])
        let own = pts([(150, 515), (300, 470)])
        let p = try #require(placeAltLabel(own: own, base: base, alt: alt, divergence: Px(x: 100, y: 500), label: (60, 28), viewport: (400, 800)))
        #expect(p.anchor == Px(x: 150, y: 515))
        #expect(boxDist(Px(x: 300, y: 500), p.box) >= ALT_LABEL_PLACE.divergenceClearPx)
    }

    @Test("szintetikus: a képernyő szélén nem lóg ki, ha máshová kifér; ha sehová, rálóghat")
    func szintetikusSzel() throws {
        let base = pts([(0, 500), (400, 500)], dy: -260)
        let alt = pts([(0, 500), (100, 500), (100, 300), (200, 280), (300, 300), (300, 500), (400, 500)], dy: -260)
        let own = pts([(100, 300), (200, 280), (300, 300)], dy: -260)
        let p = try #require(placeAltLabel(own: own, base: base, alt: alt, divergence: Px(x: 100, y: 240), label: (60, 28), viewport: (400, 800)))
        #expect(p.anchor == Px(x: 200, y: 20))
        #expect(p.side != .above)
        #expect(p.box.y >= 0)
        // apró nézet: sehová sem fér ki – akkor is van hely (rálóg)
        #expect(placeAltLabel(own: own, base: base, alt: alt, divergence: Px(x: 100, y: 240), label: (60, 28), viewport: (40, 40)) != nil)
        #expect(placeAltLabel(own: [], base: base, alt: alt, divergence: Px(x: 100, y: 240), label: (60, 28), viewport: (400, 800)) == nil)
    }

    @Test("Budapest→Győr, M19 kiválasztva, címke a Győr-belvárosi alternatíván: nem takarja a leágazást és a célt, a saját szakasz legtávolabbi része mellett")
    func budapestGyorM19() throws { try fixtureCase(0) }

    @Test("Budapest→Győr, Győr-belváros kiválasztva, címke az M19-es alternatíván: nem takarja a leágazást és a célt, a saját szakasz legtávolabbi része mellett")
    func budapestGyorBelvaros() throws { try fixtureCase(1) }

    /// A két Budapest→Győr eset közös törzse.
    private func fixtureCase(_ selected: Int) throws {
        let routes = try fixtureRoutes()
        let l = try #require(altLabels(routes, routes.map(\.durationS), selected).first)
        let all = routes.flatMap(\.points)
        let lat = all.map(\.lat), lon = all.map(\.lon)
        let center = LatLon(lat: (lat.min()! + lat.max()!) / 2, lon: (lon.min()! + lon.max()!) / 2)
        // a nézet, mint az útvonalválasztóban: felül 120, alul 400 (a kártya), oldalt 36 px
        let pad = (top: 120.0, bottom: 400.0, side: 36.0)
        let area = (w: VP.w, h: VP.h - pad.bottom)
        let shiftY = (pad.top - pad.bottom) / 2
        func project(_ p: LatLon, _ z: Double) -> Px {
            let q = mercatorScreen(p, center: center, zoom: z, viewport: VP)
            return Px(x: q.x, y: q.y + shiftY)
        }
        func fits(_ z: Double) -> Bool {
            all.allSatisfy { p in
                let q = project(p, z)
                return q.x >= pad.side && q.x <= VP.w - pad.side && q.y >= pad.top && q.y <= VP.h - pad.bottom
            }
        }
        var zoom = 12.0
        while !fits(zoom) { zoom -= 0.05 }
        let base = l.basePath.map { project($0, zoom) }
        let alt = l.altPath.map { project($0, zoom) }
        let own = l.own.map { project($0, zoom) }
        let divergence = project(l.divergence, zoom)
        let p = try #require(placeAltLabel(own: own, base: base, alt: alt, divergence: divergence, label: LABEL, viewport: area))
        // a horgony a saját szakasz pontja, a legtávolabbi közelében (legalább 80%-a) azok közül, amelyek mellett van a
        // leágazástól és a céltól szabad oldal
        let far = dist(p.anchor, base)
        #expect(own.contains(p.anchor))
        let clear = ALT_LABEL_PLACE.divergenceClearPx + ALT_LABEL_PLACE.gapPx + LABEL.h
        let dest = base.last!
        let free = own.filter { hypot($0.x - divergence.x, $0.y - divergence.y) >= clear && hypot($0.x - dest.x, $0.y - dest.y) >= clear }
        #expect(far >= 0.8 * (free.map { dist($0, base) }.max() ?? 0))
        // a leágazást nem takarja, a horgony mellett van (rés), a képernyőn belül
        #expect(boxDist(divergence, p.box) >= ALT_LABEL_PLACE.divergenceClearPx)
        #expect(boxDist(dest, p.box) >= ALT_LABEL_PLACE.divergenceClearPx)
        // a cél-jelölő (alsó csúcsával a célon) dobozát sem takarja
        let pin = ALT_LABEL_PLACE.destPinPx
        #expect(!(p.box.x < dest.x + pin / 2 && p.box.x + p.box.w > dest.x - pin / 2 && p.box.y < dest.y && p.box.y + p.box.h > dest.y - pin))
        #expect(close(boxDist(p.anchor, p.box), ALT_LABEL_PLACE.gapPx, 6))
        #expect(p.box.x >= 0)
        #expect(p.box.x + p.box.w <= area.w)
        #expect(p.box.y + p.box.h <= area.h)
    }
}


// MARK: AW18 – útvonalválasztó, élő forgalom, helyi dugó, közösségi dugó-adat

/// Egyenletes haladás `fromS`-től `toS`-ig (mp-enként egy fix), `mps` sebességgel, `alongM`-től. Visszaadja a végső helyet.
@MainActor
@discardableResult
private func drive(_ h: Harness, _ route: NavRoute, fromS: Int, toS: Int, alongM: Double, mps: Double, respond: ((Int, Double) -> [NavRoute]?)? = nil) async -> Double {
    var along = alongM
    for s in fromS...toS {
        if s > fromS { along += mps }
        if let r = respond?(s, along) { h.respond(r) }
        h.feed(at(route, along, 0, T0 + Double(s) * 1000, speed: mps))
        await h.session.settle()
    }
    return along
}

/// A 100 km-es, 3600 s-os egyenes friss változata a pozíciótól: a tervezett hátralévő idő + `extraS` dugó.
private func freshFrom(_ alongM: Double, _ extraS: Double, lengthM: Double = 100_000, durationS: Double = 3600) -> NavRoute {
    lineRoute(lengthM: lengthM - alongM, durationS: durationS * (lengthM - alongM) / lengthM + extraS, id: "fresh-\(alongM)", startX: alongM)
}

@Suite("AW18: útvonalválasztó – „Leggyorsabb” és a címke")
struct AW18PickerTests {
    @Test("a „Leggyorsabb” címke és az előválasztás a legkisebb menetidejű útvonal, nem a 0. index")
    func leggyorsabb() {
        // élesben: a Mapbox 0. útvonala 42 perc, az alternatíva 41
        #expect(fastestRouteIndex([42 * 60, 41 * 60]) == 1)
        #expect(fastestRouteIndex([41 * 60, 41 * 60, 45 * 60]) == 0)
        #expect(fastestRouteIndex([50 * 60, 47 * 60, 46 * 60]) == 2)
        #expect(fastestRouteIndex([]) == 0)
        #expect(routeTagText(1, 1, lang: .hu) == "Leggyorsabb")
        #expect(routeTagText(0, 1, lang: .hu) == "Alternatíva 1")
        #expect(routeTagText(2, 1, lang: .hu) == "Alternatíva 2")
        #expect(routeTagText(1, 0, lang: .hu) == "Alternatíva 1")
    }
}

@Suite("AW18: élő forgalom navigáció közben")
@MainActor
struct AW18TrafficTests {
    @Test("2 percenként friss lekérés; a jelenlegi útvonal friss ideje adja az ETA-t és a hátralévő időt (a lekérés helyétől)")
    func frissLekeres() async {
        let route = lineRoute(lengthM: 100_000, durationS: 3600)
        let h = Harness(route, voice: false)
        let v = 100_000.0 / 3600
        let along = await drive(h, route, fromS: 0, toS: 119, alongM: 0, mps: v)
        #expect(h.calls.isEmpty)
        h.respond([freshFrom(along + v, 600)])
        await drive(h, route, fromS: 120, toS: 120, alongM: along + v, mps: v)
        #expect(h.reasons == [.alternatives])
        let view = h.session.view()
        // a tervezett hátralévő idő + 10 perc dugó
        #expect(close(view.remainingS, 3600 - 120 + 600, -1))
        #expect(close(view.etaMs, view.plannedEtaMs + 600_000, -4))
        #expect(view.delayMin == 10)
        // a friss útvonal mentén fogy tovább
        await drive(h, route, fromS: 121, toS: 180, alongM: along + 2 * v, mps: v)
        // a 10 perc a friss útvonal teljes hosszán oszlik el: 60 s alatt annak arányos része fogy
        let left = 100_000 - 120 * v
        #expect(close(h.session.view().remainingS, (3600 - 120 + 600) * (1 - 60 * v / left), -1))
    }

    @Test("ha a válaszban nincs a jelenlegi útvonal: forgalom-lekérés köztes ponttal a következő manőveren, a jelenlegi útvonalon")
    func koztesPont() async throws {
        let route = lineRoute(lengthM: 100_000, durationS: 3600)
        let h = Harness(route, voice: false)
        let v = 100_000.0 / 3600
        var along = await drive(h, route, fromS: 0, toS: 119, alongM: 0, mps: v)
        // csak egy másik (lassabb, 5 km-rel északabbra futó) útvonal jön
        h.respond([lineRoute(lengthM: 100_000, durationS: 9000, latOffset: 0.05, id: "mas")])
        along = await drive(h, route, fromS: 120, toS: 124, alongM: along + v, mps: v)
        #expect(h.reasons == [.alternatives])
        h.respond([freshFrom(along + v, 300)])
        along = await drive(h, route, fromS: 125, toS: 125, alongM: along + v, mps: v)
        #expect(h.reasons == [.alternatives, .traffic])
        // a köztes pont a következő manőver (a lépés vége, 4 km-nél)
        let via = try #require(h.calls[1].via)
        let m = route.steps[3].endManeuver.location
        #expect(close(via.lat, m.lat, 6))
        #expect(close(via.lon, m.lon, 6))
        #expect(h.session.view().delayMin == 5)
        #expect(h.session.view().offer == nil)
    }

    @Test("a kérés címe köztes ponttal: három koordináta, waypoints=0;2, alternatíva nélkül; az irány az első ponté")
    func koztesCim() throws {
        let u = directionsUrl(from: LatLon(lat: 47.5, lon: 19), to: LatLon(lat: 47.7, lon: 17.6), lang: .hu, token: "pk.x", heading: 90, via: LatLon(lat: 47.55, lon: 18.9))
        #expect(u.absoluteString.contains("/19.000000,47.500000;18.900000,47.550000;17.600000,47.700000?"))
        let c = try #require(URLComponents(url: u, resolvingAgainstBaseURL: false))
        let q = { (k: String) in c.queryItems?.first { $0.name == k }?.value }
        #expect(q("waypoints") == "0;2")
        #expect(q("alternatives") == "false")
        #expect(q("bearings") == "90,45;;")
        // köztes pont nélkül a régi forma
        let plain = try #require(URLComponents(url: directionsUrl(from: LatLon(lat: 47.5, lon: 19), to: LatLon(lat: 47.7, lon: 17.6), lang: .hu, token: "pk.x", heading: 90), resolvingAgainstBaseURL: false))
        let pq = { (k: String) in plain.queryItems?.first { $0.name == k }?.value }
        #expect(pq("waypoints") == nil)
        #expect(pq("alternatives") == "true")
    }

    @Test("„+N perc dugó” 3 perctől; a hang egyszer, aztán legfeljebb 5 percenként, ha a késés tovább nőtt")
    func kesesHang() async {
        let route = lineRoute(lengthM: 100_000, durationS: 3600)
        let h = Harness(route)
        let v = 100_000.0 / 3600
        let extra: [Double] = [120, 240, 360, 480, 480]
        await drive(h, route, fromS: 0, toS: 600, alongM: 0, mps: v) { s, along in
            s % 120 == 0 && s > 0 ? [freshFrom(along, extra[s / 120 - 1])] : nil
        }
        let said = h.session.drainVoice().filter { $0.kind == .traffic }.map(\.text)
        // 2 perc: nincs; 4 perc (240 s): „4 perccel” – egyszer; 6 perc (360 s): csak 2 perce szólt; 8 perc (480): 5 perc után, nőtt
        #expect(said == ["Dugó az útvonalon, az érkezés 4 perccel később.", "Dugó az útvonalon, az érkezés 8 perccel később."])
        #expect(h.session.view().delayMin == 8)
    }

    @Test("2 percnél kisebb késésnél nincs „+N perc dugó”; friss adat nélkül sincs (csak a lassabb haladás miatt)")
    func nincsKeses() async {
        let route = lineRoute(lengthM: 100_000, durationS: 3600)
        let h = Harness(route, voice: false)
        // a tervezett tempó felével halad, de friss adat még nincs (az első 2 percben)
        await drive(h, route, fromS: 0, toS: 110, alongM: 0, mps: 100_000 / 3600 / 1.6)
        #expect(h.session.view().delayMin == nil)
    }

    @Test("a Directions-kliens hibájának oka: időtúllépés „timeout”, HTTP „http_<státusz>”, hálózat „network”")
    func hibaOka() async {
        let counter = RequestCounter(store: MemoryStore(), now: { T0 })
        let never = DirectionsClient(token: "pk.x", lang: { .hu }, fetch: { _ in
            try await Task.sleep(nanoseconds: 10_000_000_000)
            return (200, Data())
        }, counter: counter, now: { T0 }, timeoutMs: 20)
        let a = LatLon(lat: 47.5, lon: 19)
        let b = LatLon(lat: 47.6, lon: 19.1)
        let r1 = await never.routes(a, b, RouteRequestContext(heading: nil, reason: .reroute)).result
        if case .failure(let e) = r1 { #expect(routeErrorKind(e) == "timeout") } else { Issue.record("nem bukott") }
        let http = DirectionsClient(token: "pk.x", lang: { .hu }, fetch: { _ in (503, Data()) }, counter: counter, now: { T0 })
        let r2 = await http.routes(a, b, RouteRequestContext(heading: nil, reason: .reroute)).result
        if case .failure(let e) = r2 { #expect(routeErrorKind(e) == "http_503") } else { Issue.record("nem bukott") }
        #expect(routeErrorKind(URLError(.notConnectedToInternet)) == "network")
        #expect([1, 2, 3, 4, 5, 9].map(rerouteRetryDelayMs) == [5000, 10_000, 20_000, 30_000, 30_000, 30_000])
    }
}

@Suite("AW18: helyi dugó-érzékelés")
@MainActor
struct AW18JamTests {
    /// A detektor mp-enkénti etetése: `(mp, m/s)` szakaszok egymás után.
    private func run(_ d: JamDetector, _ parts: [(Int, Double)], expected: Double = 25, t0: Int = 0, along0: Double = 0) -> (changes: [(s: Int, c: JamChange, along: Double)], s: Int, along: Double) {
        var changes: [(s: Int, c: JamChange, along: Double)] = []
        var s = t0
        var along = along0
        for (secs, mps) in parts {
            for _ in 0..<secs {
                s += 1
                along += mps
                if let c = d.update(Double(s) * 1000, along, mps, expected) { changes.append((s, c, along)) }
            }
        }
        return (changes, s, along)
    }

    @Test("2 percen át a várt tempó felénél lassabban (állás + araszolás) → dugó; egy 1 perces állás nem dugó")
    func belepes() {
        let d = JamDetector()
        let r = run(d, [(60, 0), (70, 3)])
        #expect(r.changes.map(\.c) == [.enter])
        #expect(r.changes[0].s >= 119 && r.changes[0].s <= 122)
        #expect(d.active)
        #expect(d.avgMps! < 3)
        let free = JamDetector()
        #expect(run(free, [(50, 0), (200, 25)]).changes.isEmpty)
    }

    @Test("dugóban a lámpák közti rövid (< 500 m) gyorsulás nem szakítja meg; ≥ 500 m a várt tempó közelében → vége")
    func kilepes() {
        let d = JamDetector()
        _ = run(d, [(125, 1)])
        #expect(d.active)
        // 300 m gyorsulás, majd újra araszolás: marad
        var r = run(d, [(12, 25), (30, 2)], t0: 125, along0: 125)
        #expect(r.changes.isEmpty)
        #expect(d.active)
        // 500 m megszakítás nélkül a várt tempó 80%-a fölött
        r = run(d, [(24, 22)], t0: r.s, along0: r.along)
        #expect(r.changes.map(\.c) == [.exit])
        #expect(!d.active)
        #expect(close(d.clearedAvgMps, 22, 0))
    }

    @Test("a GPS-zaj álló helyzetben nem haladás (csak az útvonal menti előrehaladás számít)")
    func zaj() {
        let d = JamDetector()
        var along = 1000.0
        for s in 1...125 {
            along += s % 2 == 1 ? 3 : -3
            _ = d.update(Double(s) * 1000, along, 0, 25)
        }
        #expect(d.active)
        #expect(d.avgMps! < 0.1)
    }

    @Test("dugóba lépéskor „Dugóba kerültél?” kártya + hang egyszer; 15 s után válasz nélkül eltűnik, a dugó-állapot marad")
    func kartya() async {
        let route = lineRoute()
        let h = Harness(route)
        await drive(h, route, fromS: 0, toS: 125, alongM: 100, mps: 2)
        let v = h.session.view()
        #expect(v.jam)
        #expect(v.jamAsk)
        let said = h.session.drainVoice().filter { $0.kind == .traffic }.map(\.text)
        #expect(said.contains("Lassú forgalom. Dugóba kerültél?"))
        await drive(h, route, fromS: 126, toS: 142, alongM: 352, mps: 2)
        #expect(h.session.view().jamAsk == false)
        #expect(h.session.view().jam)
        #expect(h.session.drainVoice().filter { $0.text.contains("Dugóba") }.isEmpty)
    }

    @Test("„Nem” → ebben az útban ugyanarra a szakaszra nem kérdez újra; „Igen” → bejelentett közösségi minta")
    func nemIgen() async {
        let route = lineRoute()
        let h = Harness(route, voice: false)
        var along = await drive(h, route, fromS: 0, toS: 125, alongM: 0, mps: 1)
        #expect(h.session.view().jamAsk)
        h.session.answerJam(false)
        #expect(h.session.view().jamAsk == false)
        // kijön a dugóból (520 m), majd ugyanazon a lépésen (1 km-ig) újra beáll
        along = await drive(h, route, fromS: 126, toS: 146, alongM: along + 26, mps: 26)
        #expect(h.session.view().jam == false)
        await drive(h, route, fromS: 147, toS: 275, alongM: along + 0.5, mps: 0.5)
        #expect(h.session.view().jam)
        #expect(h.session.view().jamAsk == false)
        #expect(h.session.drainJamSamples().map(\.kind) == [.erzekelt, .oldott, .erzekelt])
        h.session.answerJam(true)
        let rep = h.session.drainJamSamples()
        #expect(rep.count == 1)
        #expect(rep.first?.kind == .bejelentett)
        #expect(rep.first?.heading_deg == 90)
        #expect(rep.first?.length_m == Int(TRAFFIC.reportedLengthM))
    }

    @Test("dugóban az ETA a mért átlaggal a következő manőverig, onnan a tervezett idővel; a nagyobb késés számít")
    func dugoEta() async {
        let route = lineRoute() // 10 km, 360 s, 1 km-es lépések
        let h = Harness(route, voice: false)
        // csak a helyi becslés (a 2 perces Mapbox-lekérés most nem ad választ)
        h.fail(URLError(.notConnectedToInternet))
        await drive(h, route, fromS: 0, toS: 125, alongM: 0, mps: 2)
        let v = h.session.view()
        #expect(v.jam)
        // 250 m-nél: a következő manőverig (1000 m) 750 m / 2 m/s = 375 s, onnan a terv: 9 km → 324 s
        #expect(close(v.remainingS, 375 + 324, -1))
        // késés: 125 s + 699 s − 360 s ≈ 464 s → 8 perc
        #expect(v.delayMin == 8)
        // dugó közben 2 percenként új közösségi minta
        #expect(h.session.drainJamSamples().map(\.kind) == [.erzekelt])
        await drive(h, route, fromS: 126, toS: 246, alongM: 252, mps: 2)
        #expect(h.session.drainJamSamples().map(\.kind) == [.erzekelt])
    }
}

@Suite("AW18: közösségi dugó-adat")
@MainActor
struct AW18CommunityTests {
    private let route = lineRoute() // 10 km, 360 s → 36 s / km
    private func total(_ d: [Double]) -> Double { d.reduce(0, +) }
    private func jam(lat: Double? = nil, lon: Double? = nil, headingDeg: Double? = 90, avgKmh: Double = 18, createdAt: Double = T0 - 60_000, own: Bool = false, id: String = "j") -> CommunityJam {
        let p = at(route, 5000)
        return CommunityJam(id: id, lat: lat ?? p.lat, lon: lon ?? p.lon, headingDeg: headingDeg, avgKmh: avgKmh, lengthM: 1000, createdAt: createdAt, own: own)
    }

    @Test("a 15 percnél frissebb, azonos irányú, más felhasználótól származó minta felülírja az érintett szakasz idejét a mért átlaggal")
    func felulir() {
        // 4–5 km: 1000 m / 5 m/s = 200 s a 36 s helyett
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [jam()], now: T0)), 360 - 36 + 200, 3))
        // ellenirányú, saját, 16 perces, 100 m-re lévő: nem számít
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [jam(headingDeg: 270)], now: T0)), 360, 3))
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [jam(own: true)], now: T0)), 360, 3))
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [jam(createdAt: T0 - 16 * 60_000)], now: T0)), 360, 3))
        let off = at(route, 5000, 100)
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [jam(lat: off.lat, lon: off.lon)], now: T0)), 360, 3))
        // a frissebb nyer: a dugó után „oldott” 90 km/h-val → 1000 m / 25 m/s = 40 s
        let cleared = jam(avgKmh: 90, createdAt: T0 - 10_000, id: "k")
        #expect(close(total(applyCommunityJams(route, route.segDurationS, [cleared, jam()], now: T0)), 360 - 36 + 40, 3))
    }

    @Test("a munkamenet ETA-ja a közösségi adattal számol")
    func sessionEta() {
        let h = Harness(route, voice: false)
        h.feed(at(route, 1000, 0, T0))
        let before = h.session.view().remainingS
        h.session.setCommunityJams([jam()])
        #expect(close(h.session.view().remainingS - before, 164, 0))
    }

    @Test("a feltöltött minta: km/h egészre, irány 0–359, hossz legalább 1 m")
    func minta() {
        #expect(jamSample(.erzekelt, lat: 47.5, lon: 19, heading: 361.6, avgMps: 2.1, lengthM: 0.2) == JamSampleInsert(kind: .erzekelt, lat: 47.5, lon: 19, heading_deg: 2, avg_kmh: 8, length_m: 1))
        #expect(jamSample(.bejelentett, lat: 47.5, lon: 19, heading: nil, avgMps: 0, lengthM: 300).heading_deg == nil)
    }
}
