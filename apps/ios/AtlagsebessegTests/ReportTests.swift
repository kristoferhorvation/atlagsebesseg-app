import AtlagsebessegCore
import Foundation
import Testing
@testable import Atlagsebesseg

// AOS14: a packages/app-logic/test/reportPrompt.test.ts párja (azonos nevekkel), és a bejelentés, a köszöntés és a
// Live Activity iOS-oldali részei.

private let HOME = LatLon(lat: 47.5, lon: 19.05)

/// Pont a HOME-tól `bearing` irányban `distM` méterre (kis távolságon a sík közelítés elég) – a TS-teszt segédje.
private func destinationPoint(_ from: LatLon, _ bearing: Double, _ distM: Double) -> LatLon {
    let r = bearing * .pi / 180
    let mPerDeg = 111_195.0
    return LatLon(lat: from.lat + distM * cos(r) / mPerDeg, lon: from.lon + distM * sin(r) / (mPerDeg * cos(from.lat * .pi / 180)))
}

private func fix(_ heading: Double?) -> GpsFix {
    GpsFix(lat: HOME.lat, lon: HOME.lon, timestamp: 0, speed: heading == nil ? 0 : 20, accuracy: 5, heading: heading)
}

private func rep(_ id: String, _ bearing: Double, _ distM: Double, own: Bool = false) -> ActiveReport {
    let p = destinationPoint(HOME, bearing, distM)
    return ActiveReport(id: id, type: .rendorseg, lat: p.lat, lon: p.lon, createdAt: 0, expiresAt: 10_000_000, own: own)
}

private let never: (String) -> Bool = { _ in false }

@Suite("reportPromptCandidate (közeledés)")
struct ReportPromptCandidateTests {
    @Test("előttünk a kamerával azonos távolságon belül figyelmeztet, azon túl nem")
    func elottunk() {
        // 20 m/s → max(250, 10 × 20) = 250 m; 30 m/s → 300 m
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 240)], skip: never)?.id == "a")
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 270)], skip: never) == nil)
        var fast = fix(0)
        fast.speed = 30
        #expect(reportPromptCandidate(fast, [rep("a", 0, 290)], skip: never)?.id == "a")
        #expect(reportAlertM(nil) == 250)
    }

    @Test("mögöttünk vagy oldalt (a kúpon kívül) csak nearM-en belül")
    func mogottunk() {
        #expect(reportPromptCandidate(fix(0), [rep("a", 180, 120)], skip: never) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("a", 90, 120)], skip: never) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("a", 180, REPORT_PROMPT.nearM - 5)], skip: never)?.id == "a")
    }

    @Test("irány nélkül (álló autó) csak nearM-en belül")
    func iranyNelkul() {
        #expect(reportPromptCandidate(fix(nil), [rep("a", 0, 120)], skip: never) == nil)
        #expect(reportPromptCandidate(fix(nil), [rep("a", 0, 30)], skip: never)?.id == "a")
    }

    @Test("a saját bejelentésre és a kihagyottra (volt már / megszavazott) nem figyelmeztet; a legközelebbit választja")
    func sajatEsLegkozelebbi() {
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 100, own: true)], skip: never) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 100)], skip: { $0 == "a" }) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("far", 0, 180), rep("near", 10, 90)], skip: never)?.id == "near")
    }
}

@Suite("ReportPromptWatch (egy kártya: figyelmeztetés → kérdés)")
struct ReportPromptWatchTests {
    // a bejelentés 300 m-re északra; az autó észak felé halad, `along` méterrel a kiindulás után
    private let R = [rep("a", 0, 300)]
    private func at(_ along: Double, heading: Double = 0) -> GpsFix {
        let p = destinationPoint(HOME, 0, along)
        return GpsFix(lat: p.lat, lon: p.lon, timestamp: 0, speed: 20, accuracy: 5, heading: heading)
    }

    @Test("előbb figyelmeztet, 50 m-rel a bejelentés előtt ugyanaz a kártya helyben kérdésre vált")
    func valt() throws {
        let w = ReportPromptWatch()
        let a = try #require(w.update(at(60), R, voted: never, now: 0))
        #expect(a.id == "a" && a.phase == .approach && Int(a.distanceM.rounded()) == 240)
        #expect(w.update(at(200), R, voted: never, now: 1000)?.phase == .approach)
        let b = w.update(at(255), R, voted: never, now: 2000)
        #expect(b?.id == "a" && b?.phase == .ask)
    }

    @Test("a kérdés az elhaladás után még showMs-ig látható, aztán eltűnik, és arra a bejelentésre nem tér vissza")
    func lejar() {
        let w = ReportPromptWatch()
        #expect(w.update(at(260), R, voted: never, now: 0)?.phase == .ask)
        // elhaladás előtt nincs időkorlát
        #expect(w.update(at(290), R, voted: never, now: 20_000)?.phase == .ask)
        // elhaladás (mögöttünk): innen számít a showMs
        #expect(w.update(at(320), R, voted: never, now: 21_000)?.phase == .ask)
        #expect(w.update(at(380), R, voted: never, now: 21_000 + REPORT_PROMPT.showMs - 1)?.phase == .ask)
        #expect(w.update(at(400), R, voted: never, now: 21_000 + REPORT_PROMPT.showMs) == nil)
        #expect(w.update(at(260), R, voted: never, now: 40_000) == nil)
    }

    @Test("kérdés nélküli elhaladás (a bejelentés 50 m-nél messzebb maradt): eltűnik, és nem tér vissza")
    func oldalt() {
        let p = destinationPoint(destinationPoint(HOME, 0, 300), 90, 70)
        let side = [ActiveReport(id: "s", type: .rendorseg, lat: p.lat, lon: p.lon, createdAt: 0, expiresAt: 10_000_000)]
        let w = ReportPromptWatch()
        #expect(w.update(at(200), side, voted: never, now: 0)?.phase == .approach)
        #expect(w.update(at(300), side, voted: never, now: 1000)?.phase == .approach)
        #expect(w.update(at(380), side, voted: never, now: 2000) == nil)
        #expect(w.update(at(200), side, voted: never, now: 3000) == nil)
    }

    @Test("hajtűkanyar: ha még nem voltunk a közelében, a „mögöttünk” nem elhaladás")
    func hajtu() {
        let w = ReportPromptWatch()
        #expect(w.update(at(60), R, voted: never, now: 0)?.phase == .approach)
        // 150 m-re, de az út visszafordul: a haladási irány dél, a bejelentés mögöttünk – még nem haladtunk el mellette
        #expect(w.update(at(150, heading: 180), R, voted: never, now: 1000)?.id == "a")
    }

    @Test("kanyarban (a kúpon kívül, de nem mögöttünk) a kártya megmarad; messzire kerülve eltűnik")
    func kanyar() {
        let w = ReportPromptWatch()
        #expect(w.update(at(60), R, voted: never, now: 0)?.phase == .approach)
        // az út elkanyarodik: a haladási irány 70°-ra fordul, a bejelentés még előttünk-oldalt
        #expect(w.update(at(80, heading: 70), R, voted: never, now: 1000)?.id == "a")
        let far = ReportPromptWatch()
        #expect(far.update(at(60), R, voted: never, now: 0) != nil)
        let p = destinationPoint(HOME, 90, 600)
        #expect(far.update(GpsFix(lat: p.lat, lon: p.lon, timestamp: 0, speed: 20, accuracy: 5, heading: 90), R, voted: never, now: 1000) == nil)
    }

    @Test("válaszra (bezárás / szavazat) azonnal eltűnik, és akkor is, ha a bejelentés eltűnt a listából")
    func valasz() {
        let w = ReportPromptWatch()
        #expect(w.update(at(260), R, voted: never, now: 0)?.phase == .ask)
        w.close()
        #expect(w.update(at(260), R, voted: never, now: 500) == nil)
        let w2 = ReportPromptWatch()
        #expect(w2.update(at(260), R, voted: never, now: 0) != nil)
        #expect(w2.update(at(260), R, voted: { $0 == "a" }, now: 500) == nil)
        let w3 = ReportPromptWatch()
        #expect(w3.update(at(260), R, voted: never, now: 0) != nil)
        #expect(w3.update(at(260), [], voted: never, now: 500) == nil)
    }

    @Test("álló autó (irány nélkül) 50 m-en belül rögtön kérdez")
    func allo() {
        let w = ReportPromptWatch()
        let p = w.update(fix(nil), [rep("a", 0, 30)], voted: never, now: 0)
        #expect(p?.id == "a" && p?.phase == .ask)
    }

    @Test("egyszerre egy bejelentés; a lezárása után a következőre figyelmeztet")
    func kovetkezo() {
        let w = ReportPromptWatch()
        let both = [rep("a", 0, 100), rep("b", 0, 150)]
        #expect(w.update(fix(0), both, voted: never, now: 0)?.id == "a")
        #expect(w.update(fix(0), both, voted: never, now: 1000)?.id == "a")
        w.close()
        #expect(w.update(fix(0), both, voted: never, now: 2000)?.id == "b")
    }
}

@Suite("Bejelentés menü – egy kapu-tétel")
struct GateMenuTests {
    @Test("az „Átlagmérés eleje” és „vége” egy tétel a menü végén; elküldött eleje után „vége”")
    func menu() {
        #expect(reportMenu(gateStarted: false).map(\.rawValue) == ["rendorseg", "traffipax", "baleset", "akadaly", "utlezaras", "szakasz_hiba", "dugo", "beallt", "kapu_kezdo"])
        #expect(reportMenu(gateStarted: true).last == .kapuZaro)
        #expect(reportMenu(gateStarted: true).count == 9)
    }

    @Test("eleje → vége; a vége elküldése, illetve a mérés / navigáció vége visszaállítja; más típus nem változtat")
    func allapot() {
        #expect(gateStartedAfter(false, .sent(.kapuKezdo)) == true)
        #expect(gateStartedAfter(true, .sent(.rendorseg)) == true)
        #expect(gateStartedAfter(true, .sent(.kapuZaro)) == false)
        #expect(gateStartedAfter(true, .activityEnded) == false)
        #expect(gateStartedAfter(false, .sent(.baleset)) == false)
    }
}

@Suite("köszöntés (megszólítás)")
struct GreetingTests {
    @Test("kitöltve névvel, üresen név nélkül – felirat és hang")
    func koszontes() {
        #expect(greetingText("Kristof", lang: .hu) == "Szia Kristof!")
        #expect(greetingText("", lang: .hu) == "Szia!")
        #expect(greetingText("   ", lang: .hu) == "Szia!")
        #expect(greetingVoice("Kristof", lang: .hu) == "Szia Kristof, indulhatunk!")
        #expect(greetingVoice("", lang: .hu) == "Szia, indulhatunk!")
        #expect(greetingText("Kristof", lang: .de) == "Hallo Kristof!")
        #expect(greetingVoice("", lang: .de) == "Hallo, los geht’s!")
    }

    @Test("a név vágva, a belső szóközök egyre, legfeljebb 24 karakter")
    func nev() {
        #expect(normalizeName("  Kis   Péter ") == "Kis Péter")
        #expect(normalizeName(String(repeating: "x", count: 40)).count == 24)
    }

    @Test("beállítás: a megszólítás tárolva, alapból üres; nem szöveg helyett üres")
    func beallitas() {
        #expect(Settings.default.megszolitas == "")
        #expect(Settings.parse(#"{"megszolitas":" Kristof "}"#).megszolitas == "Kristof")
        #expect(Settings.parse(#"{"megszolitas":42}"#).megszolitas == "")
        var s = Settings.default
        s.megszolitas = "Kristof"
        #expect(Settings.parse(s.serialized()).megszolitas == "Kristof")
    }
}

@Suite("bejelentés (iOS-port)")
struct ReportLogicTests {
    @Test("a menü tételei és sorrendje a webes REPORT_CHOICES; a kapu irány nélkül nem küldhető")
    func menu() {
        #expect(ReportChoice.allCases.map(\.rawValue) == ["rendorseg", "traffipax", "baleset", "akadaly", "utlezaras", "szakasz_hiba", "dugo", "beallt", "kapu_kezdo", "kapu_zaro"])
        let f = GpsFix(lat: 47.5, lon: 19.05, timestamp: 0, speed: 20, accuracy: 5, heading: 359.6)
        #expect(reportFromFix(.rendorseg, f) == ReportInsert(type: .rendorseg, lat: 47.5, lon: 19.05, headingDeg: 0))
        #expect(reportFromFix(.kapuZaro, f)?.gateKind == "zaro")
        #expect(reportFromFix(.kapuKezdo, fix(nil)) == nil)
        #expect(reportFromFix(.baleset, fix(nil))?.headingDeg == nil)
    }

    @Test("a sor JSON-ja: kapunál gate_kind + road + speed_limit_kmh, egyszerűnél csak a négy mező")
    func json() throws {
        let simple = try JSONSerialization.jsonObject(with: JSONEncoder().encode(ReportInsert(type: .baleset, lat: 1, lon: 2, headingDeg: 90))) as? [String: Any]
        #expect(Set(simple?.keys ?? [:].keys) == ["type", "lat", "lon", "heading_deg"])
        let gate = try JSONSerialization.jsonObject(with: JSONEncoder().encode(reportFromFix(.kapuKezdo, fix(10))!)) as? [String: Any]
        #expect(gate?["type"] as? String == "ideiglenes_kapu")
        #expect(gate?["gate_kind"] as? String == "kezdo")
        #expect(Set(gate?.keys ?? [:].keys) == ["type", "lat", "lon", "heading_deg", "gate_kind", "road", "speed_limit_kmh"])
    }

    @Test("reportQuery: csempe-téglalap a nézetből, kizoomolva 3 × 3, nézet nélkül a pont körül")
    func query() {
        let q = reportQuery(BBox(south: 46.21, west: 11.61, north: 46.26, east: 11.68), center: nil)
        #expect(q?.bbox == BBox(south: 46, west: 11.5, north: 46.5, east: 12))
        let wide = reportQuery(BBox(south: 40, west: 5, north: 50, east: 20), center: nil)
        #expect(wide?.key == "89:24:91:26")
        #expect(reportQuery(nil, center: LatLon(lat: 46.2, lon: 11.7))?.key == "91:22:93:24")
        #expect(reportQuery(nil, center: nil) == nil)
    }

    @Test("ReportFeed: a saját bejelentés azonnal látszik, a szavazat megjegyezve, a lejártak eltűnnek")
    func feed() async {
        var now = 1000.0
        let server = ActiveReport(id: "s", type: .akadaly, lat: 46.2, lon: 11.7, createdAt: 0, expiresAt: 5000)
        let feed = ReportFeed(fetch: { _ in [server] }, now: { now })
        let q = reportQuery(nil, center: LatLon(lat: 46.2, lon: 11.7))!
        #expect(await feed.refresh(q))
        #expect(feed.shouldFetch(q) == false)
        feed.addOwn(ownReport(ReportInsert(type: .baleset, lat: 46.2, lon: 11.7), id: "o", now: now))
        #expect(feed.list().map(\.id) == ["s", "o"])
        #expect(feed.list().last?.own == true)
        feed.vote("s", false)
        #expect(feed.myVote("s") == false)
        now = 6000
        #expect(feed.list().map(\.id) == ["o"])
        now = 1000 + REPORT_REFRESH_MS
        #expect(feed.shouldFetch(q))
    }

    @Test("ideiglenes kapu a térképen: a kezdő / záró ikonja és tónusa a menüével egyezik; „12 perce”")
    func megjelenes() {
        let g = ActiveReport(id: "g", type: .ideiglenesKapu, gateKind: "zaro", lat: 0, lon: 0, createdAt: 0, expiresAt: 1)
        #expect(g.choice == .kapuZaro)
        #expect(g.choice.icon == .kapu_zaro)
        #expect(ReportChoice.baleset.tone == .tul)
        #expect(ReportChoice.traffipax.tone == .hataron)
        #expect(timeAgo(12 * 60_000 + 5000).isEmpty == false)
    }

    @Test("szimulátor: a minta-bejelentések a fixtúrában, a lejátszás kezdetéhez tolva (a webes simReports)")
    func simMintak() throws {
        let fixture = try SimFixture.load(.jo)
        #expect(fixture.reports.count == 6)
        #expect(try SimFixture.load(.navsim).reports.map(\.id) == ["sim-nav-report"])
        let r = fixture.reports.map { $0.report(at: 1_000_000_000) }
        #expect(r.allSatisfy { $0.createdAt < 1_000_000_000 && $0.expiresAt > 1_000_000_000 })
        #expect(r.contains { $0.type == .ideiglenesKapu && $0.gateKind == "kezdo" })
    }
}

@Suite("Live Activity (AOS14)")
@MainActor
struct LiveActivityStateTests {
    @Test("mérés közben: átlag státusz-színnel, limit, most, várható, hátralévő km")
    func meres() throws {
        let fixture = try SimFixture.load(.lassit)
        let source = SimLocationSource(fixture, speed: 1, seek: 1)
        let session = TrackingSession(fixture.sections, now: { source.clockMs })
        var views: [SessionView] = []
        source.onLocation = { views.append(session.onFix(GpsFix(location: $0))) }
        source.start()
        source.stop()
        let v = try #require(views.first { $0.phase == .meres && $0.status == .tulGyors && $0.live?.averageKmh != nil })
        let s = try #require(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu))
        let m = try #require(s.measure)
        #expect(m.tone == .tulGyors)
        #expect(m.limit == String(Int(v.section!.speedLimitKmh)))
        #expect(m.avg == String(speedIn(v.live?.averageKmh, .kmh)!))
        #expect(m.avgLabel == "km/h átlag")
        #expect(m.now != nil && m.expected != nil)
        #expect(m.remaining?.hasSuffix("hátra") == true)
        #expect(s.nav == nil)
    }

    @Test("kézi mérés: csak az átlag, accent színben, limit nélkül")
    func kezi() throws {
        var v = SessionView()
        v.phase = .kezi
        let m = try #require(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu)?.measure)
        #expect(m.tone == .kezi)
        #expect(m.limit == nil && m.now == nil && m.expected == nil && m.remaining == nil)
        #expect(m.title == "Kézi átlagmérés")
    }

    @Test("navigáció mérés nélkül: manőver, távolság, utcanév, érkezés; se mérés, se navigáció: nincs Live Activity")
    func navigacio() throws {
        let route = try #require(try NavSim.mainRoutes().first)
        let dest = route.points.last!
        let session = NavigationSession(
            route: route,
            destination: NavDestination(name: "Győr", lat: dest.lat, lon: dest.lon, routable: nil),
            fetchRoutes: { _, _, _ in Task { [route] } },
            now: { 1_000_000 },
            voice: false,
            lang: .hu
        )
        let p = route.points[0]
        let nav = session.onFix(GpsFix(lat: p.lat, lon: p.lon, timestamp: 1_000_000, speed: 10, accuracy: 5, heading: nil))
        let s = try #require(liveActivityState(SessionView(), nav: nav, unit: .kmh, lang: .hu))
        #expect(s.measure == nil)
        let n = try #require(s.nav)
        #expect(n.maneuver == nav.next.icon.rawValue)
        #expect(n.street == nav.next.text)
        #expect(n.etaLabel == "Érkezés")
        #expect(n.eta == formatClock(nav.etaMs, lang: .hu))
        #expect(liveActivityState(SessionView(), nav: nil, unit: .kmh) == nil)
    }
}
