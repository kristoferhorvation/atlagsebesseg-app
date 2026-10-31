import ActivityKit
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

    @Test("navigáció mérés nélkül: manőver, távolság, utcanév, érkezés; se mérés, se navigáció: „figyel”, GPS nélkül nincs Live Activity")
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
        #expect(n.remaining == "\(formatTripDuration(nav.remainingS, lang: .hu)) · \(formatDistance(nav.remainingM, .kmh, lang: .hu).value) km")
        #expect(n.delay == nil)
        #expect(s.watch == nil)
        #expect(liveActivityState(SessionView(), nav: nil, unit: .kmh)?.watch != nil)
        #expect(liveActivityState(SessionView(), nav: nil, unit: .kmh, gps: false) == nil)
        #expect(liveActivityState(SessionView(), nav: nav, unit: .kmh, gps: false) == nil)
    }
}

@Suite("Live Activity (AOS15)")
@MainActor
struct LiveActivityAOS15Tests {
    private let proj = LocalProjection(LatLon(lat: 47.4, lon: 19.0))
    private func at(_ x: Double, _ y: Double) -> LatLon { proj.fromXY(XY(x: x, y: y)) }
    /// Kelet felé haladó autó (heading 90) az origóban.
    private func fix(heading: Double? = 90, speed: Double = 25) -> GpsFix {
        let p = at(0, 0)
        return GpsFix(lat: p.lat, lon: p.lon, timestamp: 0, speed: speed, accuracy: 5, heading: heading)
    }
    private func section(_ id: String, from: (Double, Double), to: (Double, Double)) -> Section {
        Section(
            id: id, country: "HU", road: "M1", direction: id, start: at(from.0, from.1), end: at(to.0, to.1), lengthM: 2000, speedLimitKmh: 130,
            source: .osm, verified: false, geometry: [at(from.0, from.1), at(to.0, to.1)]
        )
    }

    @Test("figyel: pillanatnyi sebesség, tábla nélkül (navigáció nélkül nincs tábla-adat), a következő szakasz 5 km-en belül")
    func figyel() throws {
        var v = SessionView()
        v.lastFix = fix()
        v.currentKmh = 87.4
        let s = try #require(liveActivityState(v, nav: nil, unit: .kmh, nextSectionM: 3200, lang: .hu))
        let w = try #require(s.watch)
        #expect(s.measure == nil && s.nav == nil)
        #expect(w.title == "Figyel")
        #expect(w.speed == "87" && w.unit == "km/h" && w.limit == nil)
        #expect(w.nextSection == "Szakasz 3,2 km múlva")
        #expect(liveActivityState(SessionView(), nav: nil, unit: .kmh, lang: .hu)?.watch?.speed == "–")
        #expect(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu)?.watch?.nextSection == nil)
    }

    @Test("a következő szakasz: előttünk, azonos irányban, 5 km-en belül; mögöttünk, szemben, messzebb, irány nélkül nincs")
    func kovetkezoSzakasz() {
        let ahead = section("a", from: (3000, 100), to: (5000, 100))
        let near = section("n", from: (1200, -50), to: (3200, -50))
        let behind = section("b", from: (-1500, 0), to: (500, 0))
        let opposite = section("o", from: (2000, 0), to: (0, 0))
        let far = section("f", from: (6000, 0), to: (8000, 0))
        let d = nextSectionAheadM(fix(), [ahead, near, behind, opposite, far])
        #expect(d.map { abs($0 - 1201) < 5 } == true)
        #expect(nextSectionAheadM(fix(), [behind, opposite, far]) == nil)
        #expect(nextSectionAheadM(fix(heading: nil), [ahead]) == nil)
        #expect(nextSectionAheadM(nil, [ahead]) == nil)
    }

    @Test("mérés: „Maradj X alatt” (jó és lassíts), „Lassíts · max X” (túl gyors); kézi mérésnél az eltelt idő")
    func tanacs() throws {
        var views: [SessionView] = []
        for scenario in [SimScenario.jo, .lassit, .tul] {
            let fixture = try SimFixture.load(scenario)
            // seek: 1 – a teljes vezetés szinkronban lejátszva (mint az AOS14-es mérés-tesztben)
            let source = SimLocationSource(fixture, speed: 1, seek: 1)
            let session = TrackingSession(fixture.sections, now: { source.clockMs })
            source.onLocation = { views.append(session.onFix(GpsFix(location: $0))) }
            source.start()
            source.stop()
        }
        var checked = 0
        for status in [SpeedStatus.jo, .lassits, .tulGyors] {
            guard let v = views.first(where: { $0.phase == .meres && $0.status == status }), let live = v.live, case let .ok(maxKmh) = live.required else { continue }
            checked += 1
            let a = try #require(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu)?.measure?.advice)
            let x = String(speedIn(maxKmh, .kmh)!)
            #expect(a == (status == .tulGyors ? "Lassíts · max \(x)" : "Maradj \(x) alatt"))
        }
        #expect(checked >= 2)
        // kézi mérés 252 s-ig, 16 m/s-mal kelet felé
        var clock = 0.0
        let manual = TrackingSession([], now: { clock })
        _ = manual.startManual()
        var k = SessionView()
        for i in 0...252 {
            clock = Double(i) * 1000
            let p = at(Double(i) * 16, 0)
            k = manual.onFix(GpsFix(lat: p.lat, lon: p.lon, timestamp: clock, speed: 16, accuracy: 5, heading: 90))
        }
        #expect(k.phase == .kezi)
        let m = try #require(liveActivityState(k, nav: nil, unit: .kmh, lang: .hu)?.measure)
        #expect(m.elapsed == "4:12" && m.avg == "58" && m.advice == nil && m.limit == nil)
    }

    @Test("koppintás: mérés → measure, navigáció → nav, figyel → map")
    func link() throws {
        var k = SessionView()
        k.phase = .kezi
        #expect(try #require(liveActivityState(k, nav: nil, unit: .kmh)).link.absoluteString == "atlagsebesseg://live/measure")
        #expect(try #require(liveActivityState(SessionView(), nav: nil, unit: .kmh)).link.absoluteString == "atlagsebesseg://live/map")
    }

    @Test("térképkép: manővernél / állapotváltáskor azonnal, különben ≤ 30 s-enként és csak > 100 m mozgásnál; 1500 m-en túl elavult")
    func terkepkepSzabaly() {
        let p0 = at(0, 0), p50 = at(50, 0), p150 = at(150, 0), p1600 = at(1600, 0)
        #expect(liveMapDue(nil, nowMs: 0, pos: p0, key: "k"))
        let st = LiveMapStamp(atMs: 0, pos: p0, key: "k")
        #expect(liveMapDue(st, nowMs: 1000, pos: p0, key: "m"))
        #expect(!liveMapDue(st, nowMs: 29_000, pos: p150, key: "k"))
        #expect(!liveMapDue(st, nowMs: 60_000, pos: p50, key: "k"))
        #expect(liveMapDue(st, nowMs: 30_000, pos: p150, key: "k"))
        #expect(liveMapShown(st, version: 3, pos: p150) == 3)
        #expect(liveMapShown(st, version: 3, pos: p1600) == nil)
        #expect(liveMapShown(nil, version: 3, pos: p0) == nil)
        #expect(liveMapShown(st, version: nil, pos: p0) == nil)
    }

    @Test("térképkép-kérés: kódolt vonallánc, menetirány felfelé, @2x, logó nélkül; zoom a sebességből")
    func terkepkepKeres() throws {
        // a Google-féle példa (developers.google.com/maps/documentation/utilities/polylinealgorithm)
        #expect(encodePolyline([LatLon(lat: 38.5, lon: -120.2), LatLon(lat: 40.7, lon: -120.95), LatLon(lat: 43.252, lon: -126.453)]) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@")
        let r = LiveMapRequest(
            center: at(0, 0), bearing: -90, zoom: 13.5, route: [at(-300, 0), at(0, 0), at(2000, 0)], sections: [[at(500, 20), at(1500, 20)]],
            active: nil, routeHex: "1F5BFF", sectionHex: "7A86FF", activeHex: "2EE59D"
        )
        let url = try #require(liveMapURL(r, token: "pk.test")).absoluteString
        #expect(url.hasPrefix("https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/path-4+7A86FF-0.7("))
        #expect(url.contains(",path-6+1F5BFF-1("))
        #expect(url.contains(String(format: "/%.5f,%.5f,13.50,270,0/120x120@2x?access_token=pk.test&logo=false&attribution=false", r.center.lon, r.center.lat)))
        #expect(liveMapZoom(30) == 14 && liveMapZoom(130) == 13 && liveMapZoom(nil) == 14)
        #expect(thinPoints([at(0, 0), at(5, 0), at(30, 0), at(31, 0)]).count == 3)
    }

    @Test("figyel állapotban 0,5 Hz, mérés vagy navigáció közben 1 Hz")
    func frissitesUtem() throws {
        var v = SessionView()
        v.lastFix = fix()
        let watch = try #require(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu))
        #expect(liveMinInterval(watch) == 2)
        var m = watch
        m.watch = nil
        m.measure = .init(title: "", avg: "", avgLabel: "", tone: .kezi, limit: nil, nowLabel: "", now: nil, nowOver: false, expectedLabel: "", expected: nil, remaining: nil)
        #expect(liveMinInterval(m) == 1)
    }

    @Test("lezárás: az elhúzás a GPS következő indításáig tilt, a rendszer lezárása (8 óra) előtérben újraindul")
    func lezarasOka() {
        #expect(liveEndKind(.dismissed) == .user)
        #expect(liveEndKind(.ended) == .system)
        #expect(liveEndKind(.active) == nil && liveEndKind(.stale) == nil)
        let c = LiveActivityController()
        // nincs futó GPS: nincs mit újraindítani; a tiltás alapból nincs
        c.resume(nil)
        #expect(!c.userEnded)
    }

    @Test("térképkép attribúciója: csak kép mellett, „© Mapbox © OpenStreetMap”")
    func attribucio() throws {
        var v = SessionView()
        v.lastFix = fix()
        #expect(liveActivityState(v, nav: nil, unit: .kmh, mapVersion: 3, lang: .hu)?.attribution == "© Mapbox © OpenStreetMap")
        #expect(liveActivityState(v, nav: nil, unit: .kmh, lang: .hu)?.attribution == nil)
    }

    @Test("az útvonal látható része: 300 m mögöttünk, 2,5 km előttünk")
    func utvonalAblak() throws {
        let route = try #require(try NavSim.mainRoutes().first)
        let w = routeWindow(route, alongM: 10_000)
        #expect(w.count >= 2 && w.count < route.points.count)
        let along = { (p: LatLon) in route.segStartM[route.points.firstIndex(of: p)!] }
        #expect(along(w.first!) <= 9_700 + 1 && along(w.last!) >= 12_500 - 600 && along(w.last!) <= 12_500 + 1)
    }
}
