import AtlagsebessegCore
import CoreLocation
import Foundation
import Observation
import UIKit

/// Az app állapota: helyzetforrás (GPS vagy szimulátor) → mérés-munkamenet → kijelző; szakaszok és kamerák
/// a szerverről (csempénként, cache-sel) a beépített adattal összefésülve.
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

    init() {
        let wallClock = { Date().timeIntervalSince1970 * 1000 }
        sectionTiles = TileCache(store: FileStore.caches, prefix: "sections", now: wallClock) { [backend] b in try await backend.sections(in: b) }
        cameraTiles = TileCache(store: FileStore.caches, prefix: "cameras", now: wallClock) { [backend] b in try await backend.cameras(in: b) }
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
        let key = tileKey(fix.lat, fix.lon)
        if key != loadedTile, sim == nil {
            loadedTile = key
            Task { await loadData(fix.lat, fix.lon) }
        }
    }

    private func tick() {
        view = session.tick()
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
        serverSections = s.items
        serverCameras = c.items
        serverStatus = s.missing > 0 && s.fromCache == 0 ? "offline" : "\(s.items.count) · \(c.items.count)"
        rebuildData()
    }

    private func rebuildData() {
        sections = mergeById(BundledData.sections, serverSections, simSections)
        var byId: [String: FixedCamera] = [:]
        for c in BundledData.cameras + serverCameras + simCameras { byId[c.id] = c }
        cameras = byId.values.sorted { $0.id < $1.id }
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
