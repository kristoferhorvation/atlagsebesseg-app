import AtlagsebessegCore
import Foundation

// AW20 + AW24: hőtérkép bekötése (a webes `useHeat` és `trackPipeline` párja). Saját mód: az utak vonalai (`TripStore.tracks`) a `TrackIndex`-ben, szakaszonként összesítve. Közösségi mód: a
// `heat_segments_global` nézet a látható téglalapra (10 perces gyorsítótár). Út végén a pontsor az illesztőhöz megy (`TrackMatcher`; AW25 óta a saját rács-illesztő a nyers pontokból, a Mapbox Map Matching kikerült); hibánál a sor függőben marad és később
// újrapróbálódik. Feltöltés (csak bekapcsolt megosztásnál): a szakaszok a várólistába, onnan a `heat_segments` táblába; az út első és utolsó 300 m-e és a zónák sosem mennek fel
// (`segmentUploadRows`). A régi utak a nyers mintákból visszamenőleg épülnek újra, de közösségbe nem mennek. Szimulátorban nincs illesztés és feltöltés.
extension AppModel {
    static let segmentOutboxKey = "heat:segments:outbox:v1"
    private static let oldOutboxKey = "heat:outbox:v1"

    /// A várakozó feltöltési sorok törlése (a webes `clearSegmentOutbox`).
    static func clearSegmentOutbox(_ defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: segmentOutboxKey)
    }

    func setUpHeat() {
        let args = UserDefaults.standard
        // a régi cella-sor nem megy fel többé
        args.removeObject(forKey: Self.oldOutboxKey)
        // mint a weben: kikapcsolt megosztásnál induláskor sem marad várakozó sor
        if !settings.adatmegosztas { Self.clearSegmentOutbox() }
        // képernyőképekhez: `-heat ki|sajat|kozossegi`, `-heatView gyakorisag|atlagsebesseg`
        if let m = args.string(forKey: "heat").flatMap(HeatMode.init(rawValue:)) { settings.hoterkep = m }
        if let v = args.string(forKey: "heatView").flatMap(HeatView.init(rawValue:)) { settings.hoterkepNezet = v }
        // AOS18: paritás-módban nincs térkép, ami a látható részt küldené
        if Parity.on { heatHasViewport = true }
        // `-heatSeed YES`: mesterséges, több utas adat (a közösségi mód is ebből, hálózat nélkül) – a saját utak helyett
        if args.bool(forKey: "heatSeed") {
            heatSeedList = heatSeedTrackLines(loadHeatSeedRoutes())
            rebuildTrackIndex()
            heatVersion += 1
            return
        }
        rebuildTrackIndex()
        heatVersion += 1
        catchUpTracks()
    }

    /// A szakasz-összesítés újraépítése a vonalakból (indításkor, törlés és szinkron után).
    func rebuildTrackIndex() {
        trackIndex.clear()
        if let seed = heatSeedList {
            for l in seed { trackIndex.add(l) }
        } else {
            for t in tripStore.tracks() where t.status == "done" { trackIndex.add(t.lines) }
        }
    }

    /// AW25 (Kristof, Mapbox-feltételek): a saját rács-illesztő; cserélhető (később saját Valhalla-szerver).
    private var trackMatcher: TrackMatcher { gridMatcher }

    /// A vonal elkészítése; a kész utat a hőtérképre és (ha kérték) a feltöltési sorba teszi. Hálózati hibánál kivétel: a sor függőben marad.
    private func completeTrack(_ t: TripTrack) async throws {
        // egy út egyszer: a folyamatban lévő illesztést a visszatérés nem indítja újra
        guard tracksInFlight.insert(t.tripId).inserted else { return }
        defer { tracksInFlight.remove(t.tripId) }
        let matcher = trackMatcher
        let lines: [TrackLine]
        lines = try await matcher.lines(t.parts)
        var done = t
        done.status = "done"
        done.lines = lines
        done.matcher = matcher.id
        tripStore.saveTrack(done)
        trackIndex.add(lines)
        heatVersion += 1
        guard done.share, settings.adatmegosztas, sim == nil else { return }
        let rows = segmentUploadRows(lines: lines, startedAt: done.startedAt, tzOffsetMin: Double(TimeZone.current.secondsFromGMT()) / 60, zones: heatZoneList)
        guard !rows.isEmpty else { return }
        let queue = appendSegmentOutbox(parseSegmentOutbox(UserDefaults.standard.string(forKey: Self.segmentOutboxKey)), rows)
        UserDefaults.standard.set(serializeSegmentOutbox(queue), forKey: Self.segmentOutboxKey)
        flushSegmentOutbox()
    }

    /// Indításkor és előtérbe kerüléskor: a függő illesztések és a még vonal nélküli régi utak; hálózat nélkül a következő alkalom folytatja.
    func catchUpTracks() {
        guard !tracksCatchingUp, heatSeedList == nil else { return }
        tracksCatchingUp = true
        Task { [weak self] in
            guard let self else { return }
            defer { self.tracksCatchingUp = false }
            // a futó út pillanatképe a naplóban van, de még nem zárult le
            let open = self.tripRecorder.openTripId
            for trip in self.tripStore.tripsWithoutTrack() where trip.id != open {
                self.tripStore.saveTrack(pendingTrack(trip.id, startedAt: trip.startedAt, samples: self.tripStore.samples(trip.id), share: false))
                await Task.yield()
            }
            // AW25: a tárolt Mapbox-illesztett (és régi egyenes) vonal a nyers pontsorból újra; nyers pontsor nélkül a Mapbox-geometria törlődik
            var migrated = false
            for t in self.tripStore.tracks() {
                let m = migrateTrack(t)
                if m != t {
                    self.tripStore.saveTrack(m)
                    migrated = true
                }
            }
            if migrated {
                self.rebuildTrackIndex()
                self.heatVersion += 1
            }
            for t in self.tripStore.tracks() where t.status == "pending" && t.tripId != open {
                do {
                    try await self.completeTrack(t)
                } catch {
                    NSLog("HEAT match failed: %@", String(describing: error))
                    break
                }
            }
        }
    }

    /// Az út vége: pontsor a mintákból, majd illesztés; hiba esetén függőben marad.
    func finishTrack(_ trip: Trip) {
        let t = pendingTrack(trip.id, startedAt: trip.startedAt, samples: tripStore.samples(trip.id), share: settings.adatmegosztas && sim == nil)
        tripStore.saveTrack(t)
        Task { [weak self] in
            do {
                try await self?.completeTrack(t)
            } catch {
                NSLog("HEAT match failed: %@", String(describing: error))
            }
        }
    }

    /// Hogy a hőtérkép most látszik-e: bekapcsolva, és csak az üres nézeten / krúzingban (nincs navigáció, útvonaltervezés,
    /// szakasz- vagy kézi mérés) – a webes `heatVisible` párja.
    var heatVisible: Bool {
        settings.hoterkep != .ki && nav == nil && plan == nil && ![.meres, .kozeledik, .kezi, .keziEredmeny].contains(view.phase)
    }

    /// A réteg kész: látható, van nézet, és közösségi módban megjött az első válasz (a webes `heat !== null`).
    var heatReady: Bool {
        heatVisible && heatHasViewport && (settings.hoterkep == .sajat || heatGlobalLoaded)
    }

    /// A térkép látható része megváltozott (kamera-mozdulat): közösségi módban új téglalapnál lekérés.
    func setHeatViewport(_ vp: HeatViewport) {
        heatViewport = vp
        if !heatHasViewport { heatHasViewport = true }
        fetchHeatGlobal()
    }

    /// Az adatvédelmi zónák: minden mentett hely körül, helyenként a `zona_m` szerinti sugárral (alapból 200 m).
    var heatZoneList: [HeatZone] { heatZones(saved, settings.zonaM) }

    /// A mostani rajzolandó vonalak a módnak megfelelően (a szürke a zónás és a csak út-végi szakasz, csak saját módban).
    func heatLines() -> [HeatLine] {
        guard heatVisible, let vp = heatViewport else { return [] }
        switch settings.hoterkep {
        case .ki: return []
        case .sajat: return trackIndex.lines(vp, settings.hoterkepNezet, zones: heatZoneList)
        case .kozossegi: return globalLines(heatGlobalRows, settings.hoterkepNezet)
        }
    }

    /// Sugárváltáskor / zóna-választáskor: a kamera a zónára áll (a lap alatt hagyott hellyel), hogy a kör látsszon.
    func focusZone(_ id: String) {
        guard let z = heatZoneList.first(where: { $0.id == id }) else { return }
        zoneFocus = z
        zoneFocusSeq += 1
        follow = false
    }

    /// Egy hely zónasugara (m).
    func zoneRadius(_ id: String) -> Int { heatZoneList.first { $0.id == id }.map { Int($0.radiusM) } ?? Int(HEAT.zoneDefaultM) }

    func setZoneRadius(_ id: String, _ m: Int) {
        guard ZONE_RADII.contains(m) else { return }
        settings.zonaM[id] = m
        heatVersion += 1
        focusZone(id)
    }

    /// Közösségi módban a látható téglalap sorai (csak látható rétegnél; a webes `useHeat` lekérése). A kész válaszra a
    /// gyorsítótár felel: ugyanaz a téglalap 10 perc után újra lekérődik.
    func fetchHeatGlobal() {
        guard settings.hoterkep == .kozossegi, heatVisible, let vp = heatViewport else { return }
        let box = heatQueryBox(vp.bbox)
        let key = heatQueryKey(box, 0)
        if let seed = heatSeedList {
            if key != heatGlobalKey { showHeatGlobal(seedGlobalRows(seed), key) }
            return
        }
        if let rows = heatGlobalCache.get(key) {
            if key != heatGlobalKey { showHeatGlobal(rows, key) }
            return
        }
        guard backend.configured, sim == nil, key != heatGlobalPending else { return }
        heatGlobalPending = key
        Task { [weak self] in
            guard let self else { return }
            defer { if self.heatGlobalPending == key { self.heatGlobalPending = nil } }
            do {
                let rows = try await self.backend.heatSegments(in: box)
                self.heatGlobalCache.set(key, rows)
                // közben újabb téglalapot kértünk: az érvényes marad, ez csak a gyorsítótárba kerül
                if self.heatGlobalPending == key { self.showHeatGlobal(rows, key) }
            } catch {
                // a következő mozdulat újra próbál
                NSLog("HEAT global fetch failed: %@", String(describing: error))
            }
        }
    }

    private func showHeatGlobal(_ rows: [SegmentGlobalRow], _ key: String) {
        heatGlobalKey = key
        heatGlobalRows = rows
        if !heatGlobalLoaded { heatGlobalLoaded = true }
        heatVersion += 1
    }

    /// Egy lezárt út: a régi cella-összesítésbe és (AW24) a vonalak közé.
    func absorbIntoHeat(_ trip: Trip) {
        _ = tripStore.absorbTrip(trip.id)
        finishTrack(trip)
    }

    /// A várólista feltöltése; sikernél kiürül, hibánál marad (a következő út vége / előtérbe kerülés újra próbál).
    func flushSegmentOutbox() {
        guard backend.configured, sim == nil, settings.adatmegosztas else { return }
        let queue = parseSegmentOutbox(UserDefaults.standard.string(forKey: Self.segmentOutboxKey))
        guard !queue.isEmpty, !heatFlushing else { return }
        heatFlushing = true
        Task { [weak self] in
            guard let self else { return }
            defer { self.heatFlushing = false }
            do {
                try await self.backend.uploadSegments(queue, matcher: MATCHER_GRID)
                // közben érkezett új sorok megmaradnak
                let now = parseSegmentOutbox(UserDefaults.standard.string(forKey: Self.segmentOutboxKey))
                UserDefaults.standard.set(serializeSegmentOutbox(Array(now.dropFirst(queue.count))), forKey: Self.segmentOutboxKey)
            } catch {
                NSLog("HEAT upload failed: %@", String(describing: error))
            }
        }
    }
}
