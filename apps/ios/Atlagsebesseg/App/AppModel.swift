import AtlagsebessegCore
import CoreLocation
import Foundation
import Observation
import UIKit

/// Az app állapota: helyzetforrás (GPS vagy szimulátor) → mérés-munkamenet → kijelző; szakaszok, kamerák és
/// tervezett mérések a szerverről (csempénként, cache-sel) a beépített adattal összefésülve; kamera-közeledés és
/// tervezett mérés jelzése (esemény → hang-réteg).
@Observable
final class AppModel {
    var settings: Settings = .load() {
        didSet { if settings != oldValue { settings.save() } }
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

    @ObservationIgnored private let backend = Backend()
    @ObservationIgnored private var source: LocationSource?
    @ObservationIgnored private var session: TrackingSession!
    @ObservationIgnored private var serverSections: [Section] = []
    @ObservationIgnored private var simSections: [Section] = []
    @ObservationIgnored private var serverCameras: [FixedCamera] = []
    @ObservationIgnored private var simCameras: [FixedCamera] = []
    @ObservationIgnored private var loadedTile: String?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private let sectionTiles: TileCache<Section>
    @ObservationIgnored private let cameraTiles: TileCache<FixedCamera>
    @ObservationIgnored private let plannedTiles: TileCache<PlannedCheck>
    @ObservationIgnored private var serverPlanned: [PlannedCheck] = []
    @ObservationIgnored private var simPlanned: [PlannedCheck] = []
    @ObservationIgnored private let plannedWatch = PlannedCheckWatch()
    @ObservationIgnored private let approach = ApproachWatch()
    /// A jelzések kézbesítése (sáv + hang-réteg).
    @ObservationIgnored let alerts = AlertDispatcher(sink: AlertPlayer())

    init() {
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
        let args = UserDefaults.standard
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
        stopSource()
        guard let fixture = try? SimFixture.load(scenario) else { return }
        simSections = fixture.sections
        simCameras = fixture.cameras.map(\.camera)
        let t0 = (Date().timeIntervalSince1970 * 1000).rounded()
        simPlanned = fixture.planned.map { $0.check(at: t0) }
        resetAlerts()
        rebuildData()
        session = TrackingSession(sections, now: { [weak self] in self?.nowMs() ?? Date().timeIntervalSince1970 * 1000 })
        let s = SimLocationSource(fixture, speed: speed, seek: seek)
        s.onProgress = { [weak self, weak s] p in
            self?.simProgress = p
            self?.simPlaying = s?.playing ?? false
        }
        sim = s
        started = true
        follow = true
        attach(s)
        s.start()
        beginTicking()
    }

    func exitSim() {
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
        updateAlerts(fix)
        let key = tileKey(fix.lat, fix.lon)
        if key != loadedTile, sim == nil {
            loadedTile = key
            Task { await loadData(fix.lat, fix.lon) }
        }
    }

    private func tick() {
        view = session.tick()
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

    func startManual() { view = session.startManual() }
    func stopManual() { view = session.stopManual() }
    func dismiss() { view = session.dismiss() }

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
