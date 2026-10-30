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
    @Test("előttünk askM-en belül kérdez, azon túl nem")
    func elottunk() {
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, REPORT_PROMPT.askM - 5)], skip: never)?.id == "a")
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, REPORT_PROMPT.askM + 20)], skip: never) == nil)
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

    @Test("a saját bejelentésre és a kihagyottra (kérdezett / megszavazott) nem kérdez; a legközelebbit választja")
    func sajatEsLegkozelebbi() {
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 100, own: true)], skip: never) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("a", 0, 100)], skip: { $0 == "a" }) == nil)
        #expect(reportPromptCandidate(fix(0), [rep("far", 0, 180), rep("near", 10, 90)], skip: never)?.id == "near")
    }
}

@Suite("ReportPromptWatch (egyszer kérdez)")
struct ReportPromptWatchTests {
    @Test("bejelentésenként egyszer: bezárás után ugyanarra nem kérdez újra")
    func egyszer() {
        let w = ReportPromptWatch()
        let reports = [rep("a", 0, 100)]
        #expect(w.update(fix(0), reports, voted: never, now: 0) == "a")
        w.close()
        #expect(w.update(fix(0), reports, voted: never, now: 1000) == nil)
    }

    @Test("válasz nélkül showMs után eltűnik")
    func lejar() {
        let w = ReportPromptWatch()
        let reports = [rep("a", 0, 100)]
        #expect(w.update(fix(0), reports, voted: never, now: 0) == "a")
        #expect(w.update(fix(0), reports, voted: never, now: REPORT_PROMPT.showMs - 1) == "a")
        #expect(w.update(fix(0), reports, voted: never, now: REPORT_PROMPT.showMs) == nil)
        #expect(w.current == nil)
    }

    @Test("szavazat után, vagy ha a bejelentés eltűnt a listából, bezárul")
    func szavazatUtan() {
        let w = ReportPromptWatch()
        #expect(w.update(fix(0), [rep("a", 0, 100)], voted: never, now: 0) == "a")
        #expect(w.update(fix(0), [rep("a", 0, 100)], voted: { $0 == "a" }, now: 500) == nil)
        let w2 = ReportPromptWatch()
        #expect(w2.update(fix(0), [rep("b", 0, 100)], voted: never, now: 0) == "b")
        #expect(w2.update(fix(0), [], voted: never, now: 500) == nil)
    }

    @Test("a kérdés alatt nem vált másik bejelentésre; utána a következőre kérdez")
    func kovetkezo() {
        let w = ReportPromptWatch()
        let reports = [rep("a", 0, 100), rep("b", 0, 150)]
        #expect(w.update(fix(0), reports, voted: never, now: 0) == "a")
        #expect(w.update(fix(0), reports, voted: never, now: 1000) == "a")
        w.close()
        #expect(w.update(fix(0), reports, voted: never, now: 2000) == "b")
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
        #expect(ReportChoice.allCases.map(\.rawValue) == ["rendorseg", "traffipax", "baleset", "akadaly", "utlezaras", "szakasz_hiba", "kapu_kezdo", "kapu_zaro"])
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
