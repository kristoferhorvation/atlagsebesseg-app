import AtlagsebessegCore
import Foundation

// AW20: hőtérkép bekötése (a webes `useHeat` párja). Saját mód: a `TripStore` heat tábláiból épülő `HeatIndex` (út végén
// inkrementálisan, indításkor a még be nem olvasztott utak visszamenőleg). Közösségi mód: a `heat_global` / `heat_global_r8`
// nézet a látható téglalapra (10 perces gyorsítótár). Feltöltés (csak bekapcsolt megosztásnál): az út végén a cellánkénti
// aggregátum a várólistába, onnan a `heat_cells` táblába; az út első és utolsó 300 m-ének cellái sosem mennek fel
// (`uploadRows`). Szimulátorban nincs feltöltés (az éles adatbázisba nem megy tesztadat).
extension AppModel {
    static let heatOutboxKey = "heat:outbox:v1"

    func setUpHeat() {
        let args = UserDefaults.standard
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
        settings.hoterkep != .ki && nav == nil && plan == nil && ![.meres, .kezi, .keziEredmeny].contains(view.phase)
    }

    /// A térkép látható része megváltozott (kamera-mozdulat): közösségi módban új téglalapnál lekérés.
    func setHeatViewport(_ vp: HeatViewport) {
        heatViewport = vp
        if settings.hoterkep == .kozossegi { fetchHeatGlobal() }
    }

    /// A mostani rajzolandó pontok a módnak megfelelően.
    func heatPoints() -> [HeatPoint] {
        guard heatVisible, let vp = heatViewport else { return [] }
        switch settings.hoterkep {
        case .ki: return []
        case .sajat: return heatIndex.points(vp, settings.hoterkepNezet).points
        case .kozossegi:
            let box = vp.bbox
            return globalPoints(heatGlobalRows.filter { $0.lat >= box.south && $0.lat <= box.north && $0.lon >= box.west && $0.lon <= box.east }, settings.hoterkepNezet)
        }
    }

    func fetchHeatGlobal() {
        guard let vp = heatViewport else { return }
        let res = heatResForZoom(vp.zoom)
        let box = heatQueryBox(vp.bbox)
        let key = heatQueryKey(box, res)
        if key == heatGlobalKey { return }
        heatGlobalKey = key
        if let seed = heatSeedList {
            heatGlobalRows = heatSeedGlobal(seed, geo: H3Geo(), res: res)
            heatVersion += 1
            return
        }
        if let rows = heatGlobalCache.get(key) {
            heatGlobalRows = rows
            heatVersion += 1
            return
        }
        guard backend.configured, sim == nil else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                let rows = try await self.backend.heatGlobal(in: box, res: res)
                self.heatGlobalCache.set(key, rows)
                if self.heatGlobalKey == key {
                    self.heatGlobalRows = rows
                    self.heatVersion += 1
                }
            } catch {
                // a következő mozdulat újra próbál
                if self.heatGlobalKey == key { self.heatGlobalKey = nil }
                NSLog("HEAT global fetch failed: %@", String(describing: error))
            }
        }
    }

    /// Egy lezárt út beolvasztása a hőtérképbe, és (bekapcsolt megosztásnál) a feltöltés-várólistába.
    func absorbIntoHeat(_ trip: Trip) {
        guard let r = tripStore.absorbTrip(trip.id) else { return }
        heatIndex.upsert(r.changed)
        heatVersion += 1
        guard settings.adatmegosztas, sim == nil else { return }
        let rows = uploadRows(r.passes, geo: H3Geo(), tzOffsetMin: Double(TimeZone.current.secondsFromGMT()) / 60)
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
