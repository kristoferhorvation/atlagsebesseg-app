import AtlagsebessegCore
import Foundation

// AW20: hőtérkép bekötése (a webes `useHeat` párja). Saját mód: a `TripStore` heat tábláiból épülő `HeatIndex` (út végén
// inkrementálisan, indításkor a még be nem olvasztott utak visszamenőleg). Közösségi mód: a `heat_global` / `heat_global_r8`
// nézet a látható téglalapra (10 perces gyorsítótár). Feltöltés (csak bekapcsolt megosztásnál): az út végén a cellánkénti
// aggregátum a várólistába, onnan a `heat_cells` táblába; az út első és utolsó 300 m-ének cellái sosem mennek fel
// (`uploadRows`). Szimulátorban nincs feltöltés (az éles adatbázisba nem megy tesztadat).
extension AppModel {
    static let heatOutboxKey = "heat:outbox:v1"

    /// A várakozó feltöltési sorok törlése (a webes `clearHeatOutbox`).
    static func clearHeatOutbox(_ defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: heatOutboxKey)
    }

    func setUpHeat() {
        let args = UserDefaults.standard
        // mint a weben: kikapcsolt megosztásnál induláskor sem marad várakozó sor
        if !settings.adatmegosztas { Self.clearHeatOutbox() }
        // képernyőképekhez: `-heat ki|sajat|kozossegi`, `-heatView gyakorisag|atlagsebesseg`
        if let m = args.string(forKey: "heat").flatMap(HeatMode.init(rawValue:)) { settings.hoterkep = m }
        if let v = args.string(forKey: "heatView").flatMap(HeatView.init(rawValue:)) { settings.hoterkepNezet = v }
        // `-heatSeed YES`: mesterséges, több utas adat (a közösségi mód is ebből, hálózat nélkül) – a saját utak helyett
        if args.bool(forKey: "heatSeed") {
            let cells = heatSeedCells(cellOf: tripCell)
            heatSeedList = cells
            heatIndex.setAll(cells)
            heatVersion += 1
            return
        }
        // a már mentett, de még be nem olvasztott utak (AW19 első indulása, leállt app) – egyszer, a háttérben-ütemezve a fő szálon
        Task { @MainActor [weak self] in
            guard let self else { return }
            for id in self.tripStore.unabsorbedTripIds() {
                if let r = self.tripStore.absorbTrip(id) { self.heatIndex.upsert(r.changed) }
                await Task.yield()
            }
            self.heatIndex.setAll(self.tripStore.heatCells())
            self.heatVersion += 1
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

    /// Az adatvédelmi zónák: minden mentett hely körül, helyenként a `zona_m` szerinti sugárral (alapból 500 m).
    var heatZoneList: [HeatZone] { heatZones(saved, settings.zonaM) }

    /// A zónák az indexbe (csak változáskor számolódik újra a felosztás).
    private func syncHeatZones() {
        let z = heatZoneList
        if z != heatZonesApplied {
            heatZonesApplied = z
            heatIndex.setZones(z)
        }
    }

    /// A mostani rajzolandó pontok a módnak megfelelően; a `grey` a zónában lévő cellák (csak saját módban, szürkén, nem színezve).
    func heatLayers() -> (points: [HeatPoint], grey: [HeatPoint]) {
        guard heatVisible, let vp = heatViewport else { return ([], []) }
        switch settings.hoterkep {
        case .ki: return ([], [])
        case .sajat:
            syncHeatZones()
            let r = heatIndex.points(vp, settings.hoterkepNezet)
            return (r.points, r.grey)
        case .kozossegi:
            // a lekért téglalap már tartalmazza a ráhagyást (+25%), mint a weben: a nézet szélén a folt nem vágódik el
            return (globalPoints(heatGlobalRows, settings.hoterkepNezet), [])
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
        let res = heatResForZoom(vp.zoom)
        let box = heatQueryBox(vp.bbox)
        let key = heatQueryKey(box, res)
        if let seed = heatSeedList {
            if key != heatGlobalKey { showHeatGlobal(heatSeedGlobal(seed, geo: H3Geo(), res: res), key) }
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
                let rows = try await self.backend.heatGlobal(in: box, res: res)
                self.heatGlobalCache.set(key, rows)
                // közben újabb téglalapot kértünk: az érvényes marad, ez csak a gyorsítótárba kerül
                if self.heatGlobalPending == key { self.showHeatGlobal(rows, key) }
            } catch {
                // a következő mozdulat újra próbál
                NSLog("HEAT global fetch failed: %@", String(describing: error))
            }
        }
    }

    private func showHeatGlobal(_ rows: [HeatGlobalRow], _ key: String) {
        heatGlobalKey = key
        heatGlobalRows = rows
        if !heatGlobalLoaded { heatGlobalLoaded = true }
        heatVersion += 1
    }

    /// Egy lezárt út beolvasztása a hőtérképbe, és (bekapcsolt megosztásnál) a feltöltés-várólistába.
    func absorbIntoHeat(_ trip: Trip) {
        guard let r = tripStore.absorbTrip(trip.id) else { return }
        heatIndex.upsert(r.changed)
        heatVersion += 1
        guard settings.adatmegosztas, sim == nil else { return }
        let rows = uploadRows(r.passes, geo: H3Geo(), tzOffsetMin: Double(TimeZone.current.secondsFromGMT()) / 60, zones: heatZoneList)
        guard !rows.isEmpty else { return }
        let queue = appendHeatOutbox(parseHeatOutbox(UserDefaults.standard.string(forKey: Self.heatOutboxKey)), rows)
        UserDefaults.standard.set(serializeHeatOutbox(queue), forKey: Self.heatOutboxKey)
        flushHeatOutbox()
    }

    /// A várólista feltöltése; sikernél kiürül, hibánál marad (a következő út vége / előtérbe kerülés újra próbál).
    func flushHeatOutbox() {
        guard backend.configured, sim == nil, settings.adatmegosztas else { return }
        let queue = parseHeatOutbox(UserDefaults.standard.string(forKey: Self.heatOutboxKey))
        guard !queue.isEmpty, !heatFlushing else { return }
        heatFlushing = true
        Task { [weak self] in
            guard let self else { return }
            defer { self.heatFlushing = false }
            do {
                try await self.backend.uploadHeat(queue)
                // közben érkezett új sorok megmaradnak
                let now = parseHeatOutbox(UserDefaults.standard.string(forKey: Self.heatOutboxKey))
                UserDefaults.standard.set(serializeHeatOutbox(Array(now.dropFirst(queue.count))), forKey: Self.heatOutboxKey)
            } catch {
                NSLog("HEAT upload failed: %@", String(describing: error))
            }
        }
    }
}
