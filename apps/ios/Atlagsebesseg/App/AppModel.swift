import AtlagsebessegCore
import CoreLocation
import Foundation
import Observation
import UIKit

/// Az app állapota: helyzetforrás (GPS vagy szimulátor) → mérés-munkamenet → kijelző; szakaszok, kamerák és
/// tervezett mérések a szerverről (csempénként, cache-sel) a beépített adattal összefésülve; kamera-közeledés és
/// tervezett mérés jelzése (esemény → hang-réteg); navigáció (A11: keresés → útvonalválasztó → `NavigationSession`,
/// a műveletek az `AppModel+Navigation.swift`-ben).
@Observable
final class AppModel {
    var settings: Settings = .load() {
        didSet {
            guard settings != oldValue else { return }
            settings.save()
            navSession?.setUnit(settings.egyseg)
            navSession?.setVoice(settings.hangosUtasitasok)
            if !settings.hangosUtasitasok { player.stopSpeaking() }
        }
    }

    private(set) var view = SessionView()
    private(set) var started = false
    private(set) var geo: GeoStatus = .off
    private(set) var sections: [Section] = BundledData.sections
    private(set) var cameras: [FixedCamera] = BundledData.cameras
    /// Az összes betöltött tervezett mérés (a megjelenítéshez: `plannedShown`).
    private(set) var planned: [PlannedCheck] = []
    /// A tervezett mérés, amelynek vonalán / zónájában a pozíció van (a felső sáv).
    private(set) var activePlanned: PlannedCheck?
    private(set) var serverStatus: String = "–"
    /// Nő, ha a szakasz- vagy kameralista változik (a térkép csak ekkor építi újra a rétegeit).
    private(set) var dataVersion = 0
    /// A kamera a pozíciót követi; a felhasználó mozdulata elengedi, a „Vissza a helyemre” visszaadja.
    var follow = true
    /// Szimulátor-mód (a beállításokból vagy indítási argumentummal: `-sim lassit -simSeek 0.6 -simSpeed 12`).
    private(set) var sim: SimLocationSource?
    private(set) var simProgress: Double = 0
    private(set) var simPlaying = false
    var simPanel = true

    @ObservationIgnored let backend = Backend()
    @ObservationIgnored private var source: LocationSource?
    @ObservationIgnored private var session: TrackingSession!
    @ObservationIgnored private var serverSections: [Section] = []
    @ObservationIgnored var simSections: [Section] = []
    @ObservationIgnored private var serverCameras: [FixedCamera] = []
    @ObservationIgnored var simCameras: [FixedCamera] = []
    @ObservationIgnored private var loadedTile: String?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored let sectionTiles: TileCache<Section>
    @ObservationIgnored let cameraTiles: TileCache<FixedCamera>
    @ObservationIgnored let plannedTiles: TileCache<PlannedCheck>
    @ObservationIgnored private var serverPlanned: [PlannedCheck] = []
    @ObservationIgnored var simPlanned: [PlannedCheck] = []
    @ObservationIgnored private let plannedWatch = PlannedCheckWatch()
    @ObservationIgnored private let approach = ApproachWatch()
    /// A hang-réteg (jelzések és navigációs bemondások egy szintetizátoron).
    @ObservationIgnored let player = AlertPlayer()
    /// A jelzések kézbesítése (sáv + hang-réteg).
    @ObservationIgnored let alerts: AlertDispatcher

    // MARK: navigáció (A11)

    /// A felső keresőmező nyitva (a kereső-pill nyitja).
    var searchOpen = false
    var searchQuery = ""
    var searchState: SearchState = .idle
    /// Az utolsó 10 úti cél és a mentett helyek (a weben tárolttal azonos kulcs és alak).
    var recents: [Place] = []
    var saved = SavedPlaces.none
    /// Az útvonalválasztó állapota (kiválasztott cél → útvonalak).
    var plan: PlanState?
    /// Az útvonalválasztó kártya adatai útvonalanként.
    var summaries: [RouteSummary] = []
    /// A futó navigáció nézete.
    var nav: NavView?
    /// A mai Directions-kérések száma (Beállítások → Állapot).
    var requestsToday = 0
    /// Nő, ha az útvonalválasztó a térképet az útvonalakra igazítaná.
    var fitVersion = 0

    @ObservationIgnored var navSession: NavigationSession?
    @ObservationIgnored var routeData = EnforcementData.none
    @ObservationIgnored let placesStore: SyncStore = DefaultsStore()
    @ObservationIgnored var requestCounter: RequestCounter!
    @ObservationIgnored var directions: DirectionsClient?
    @ObservationIgnored var planSeq = 0
    @ObservationIgnored var searchController: SearchController?
    /// A navigációs szimulátor útvonal-szolgáltatója (csak `navsim`-ben).
    @ObservationIgnored var simFetcher: RouteFetcher?
    /// A szimulátor indítási argumentuma: `-navStage search|picker|nav` (a képernyőképekhez).
    @ObservationIgnored var navStage: String?

    init() {
        alerts = AlertDispatcher(sink: player)
        let wallClock = { Date().timeIntervalSince1970 * 1000 }
        sectionTiles = TileCache(store: FileStore.caches, prefix: "sections", now: wallClock) { [backend] b in try await backend.sections(in: b) }
        cameraTiles = TileCache(store: FileStore.caches, prefix: "cameras", now: wallClock) { [backend] b in try await backend.cameras(in: b) }
        // a tervezett mérések gyakrabban frissülnek (a webes `plannedCache`-hez hasonlóan 3 óra)
        plannedTiles = TileCache(store: FileStore.caches, prefix: "planned", ttlMs: 3 * 3600_000, now: wallClock) { [backend] b in
            try await backend.plannedChecks(in: b)
        }
        session = TrackingSession(sections, now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 })
        view = session.view()
        serverStatus = backend.configured ? "…" : "offline"
        setUpNavigation()
        let args = UserDefaults.standard
        navStage = args.string(forKey: "navStage")
        if let raw = args.string(forKey: "sim"), let scenario = SimScenario(rawValue: raw) {
            simPanel = args.object(forKey: "simPanel") == nil || args.bool(forKey: "simPanel")
            startSim(scenario, speed: args.object(forKey: "simSpeed") == nil ? 4 : args.double(forKey: "simSpeed"), seek: args.double(forKey: "simSeek"))
        }
    }

    /// Óra (ms): szimulátorban a lejátszás ideje.
    func nowMs() -> Double {
        sim?.clockMs ?? Date().timeIntervalSince1970 * 1000
    }

    var lastFix: GpsFix? { view.lastFix }

    var allSections: [Section] { sections }

    // MARK: indítás / leállítás

    /// „Indulás”: a GPS indul, a kijelző ébren marad.
    func start() {
        guard !started else { return }
        started = true
        let s = CoreLocationSource()
        attach(s)
        s.start()
        beginTicking()
        Task { await signIn() }
    }

    /// Szimulátor: a felvett vezetés lejátszása GPS nélkül.
    func startSim(_ scenario: SimScenario, speed: Double = 4, seek: Double = 0) {
        endNav()
        cancelPlan()
        stopSource()
        guard let fixture = try? SimFixture.load(scenario) else { return }
        simSections = fixture.sections
        simCameras = fixture.cameras.map(\.camera)
        let t0 = (Date().timeIntervalSince1970 * 1000).rounded()
        simPlanned = fixture.planned.map { $0.check(at: t0) }
        resetAlerts()
        rebuildData()
        session = TrackingSession(sections, now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 })
        let s = SimLocationSource(fixture, speed: speed, seek: seek, windows: fixture.nav?.windows ?? [])
        s.onProgress = { [weak self, weak s] p in
            self?.simProgress = p
            self?.simPlaying = s?.playing ?? false
        }
        sim = s
        started = true
        follow = true
        attach(s)
        if let navData = fixture.nav {
            // a navigációs szimulátor (mint a webes `/?navsim`): indulás előtt áll a kiindulópontnál, a lejátszás a navigáció indításakor kezdődik
            simFetcher = (try? NavSim.mainRoutes()).flatMap(\.first).map { NavSim.fetcher(main: $0, detour: navData.detour) }
            s.hold(at: navData.from)
            runNavStage()
        } else {
            simFetcher = nil
            s.start()
        }
        beginTicking()
    }

    func exitSim() {
        endNav()
        cancelPlan()
        simFetcher = nil
        stopSource()
        sim = nil
        simSections = []
        simCameras = []
        simPlanned = []
        resetAlerts()
        rebuildData()
        session = TrackingSession(sections, now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 })
        view = session.view()
        started = false
        UIApplication.shared.isIdleTimerDisabled = false
    }

    private func attach(_ s: LocationSource) {
        source = s
        s.onLocation = { [weak self] l in self?.onLocation(l) }
        s.onGap = { [weak self] in self?.tick() }
        s.onStatus = { [weak self] st in self?.geo = st }
        // a kijelző mérés közben ne aludjon el
        UIApplication.shared.isIdleTimerDisabled = true
    }

    private func stopSource() {
        source?.stop()
        source = nil
        ticker?.invalidate()
        ticker = nil
    }

    private func beginTicking() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    // MARK: mérés

    private func onLocation(_ l: CLLocation) {
        let fix = GpsFix(location: l)
        view = session.onFix(fix)
        navSession?.onFix(fix)
        syncNavMeasure()
        updateAlerts(fix)
        let key = tileKey(fix.lat, fix.lon)
        if key != loadedTile, sim == nil {
            loadedTile = key
            Task { await loadData(fix.lat, fix.lon) }
        }
    }

    private func tick() {
        view = session.tick()
        navSession?.tick()
        syncNavMeasure()
        alerts.expire(now: nowMs())
    }

    // MARK: tervezett mérések és jelzések

    /// A térképen és a sávban látható tervezett mérések: a beállítás szerint, csak a most érvényesek.
    var plannedShown: [PlannedCheck] {
        settings.tervezettMeresek ? planned.filter { plannedCheckActive($0, now: nowMs()) } : []
    }

    /// Egy új fix: a tervezett mérés sávja és a közeledés-figyelő eseményei → a beállítások szerint a hang-rétegnek.
    private func updateAlerts(_ fix: GpsFix) {
        let before = activePlanned?.id
        activePlanned = plannedWatch.update(fix, plannedShown, now: nowMs())
        var events = approach.update(fix, cameras: cameras, sections: sections, unit: settings.egyseg)
        if let p = activePlanned, p.id != before {
            events.append(AlertEvent(kind: .planned, targetId: p.id, text: plannedAlertText(p, unit: settings.egyseg)))
        }
        for e in events { emit(e) }
    }

    /// Az utolsó jelzés a képernyőn (néhány másodpercig látszik).
    var alert: AlertEvent? { alerts.current }

    private func emit(_ e: AlertEvent) {
        // a szimulátor ugrása (seek) alatt csak az állapot frissül, hang nem szól
        alerts.emit(e, settings: settings, now: nowMs(), quiet: sim?.seeking == true)
    }

    private func resetAlerts() {
        plannedWatch.reset()
        approach.reset()
        activePlanned = nil
        alerts.clear()
    }

    func startManual() {
        view = session.startManual()
        syncNavMeasure()
    }

    func stopManual() {
        view = session.stopManual()
        syncNavMeasure()
    }

    func dismiss() {
        view = session.dismiss()
        syncNavMeasure()
    }

    // MARK: adat

    private func signIn() async {
        guard backend.configured else { return }
        do {
            _ = try await backend.ensureSignedIn()
        } catch {
            // olvasáshoz nem kell bejelentkezés (RLS: a szakaszok és kamerák nyilvánosak)
        }
    }

    private func loadData(_ lat: Double, _ lon: Double) async {
        guard backend.configured else { return }
        let s = await sectionTiles.loadItems(lat, lon)
        let c = await cameraTiles.loadItems(lat, lon)
        let p = await plannedTiles.loadItems(lat, lon)
        serverSections = s.items
        serverCameras = c.items
        serverPlanned = p.items
        serverStatus = s.missing > 0 && s.fromCache == 0 ? "offline" : "\(s.items.count) · \(c.items.count)"
        rebuildData()
    }

    private func rebuildData() {
        sections = mergeById(BundledData.sections, serverSections, simSections)
        var byId: [String: FixedCamera] = [:]
        for c in BundledData.cameras + serverCameras + simCameras { byId[c.id] = c }
        cameras = byId.values.sorted { $0.id < $1.id }
        planned = serverPlanned + simPlanned
        dataVersion += 1
        session?.setSections(sections)
    }

    // MARK: szimulátor-vezérlés

    func simPlayPause() {
        guard let sim else { return }
        if sim.playing { sim.pause() } else { sim.play() }
        simProgress = sim.progress
        simPlaying = sim.playing
    }

    func simSetSpeed(_ v: Double) { sim?.setSpeed(v) }
}
