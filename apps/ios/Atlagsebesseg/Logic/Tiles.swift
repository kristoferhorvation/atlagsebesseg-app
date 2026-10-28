import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/sectionCache.ts portja: csempénkénti betöltés, friss cache → hálózat → lejárt cache.

nonisolated struct BBox: Equatable, Sendable {
    var south: Double
    var west: Double
    var north: Double
    var east: Double
}

/// Csempeméret fokban (≈ 55 × 40 km Közép-Európában).
nonisolated let TILE_DEG = 0.5

nonisolated func tileKey(_ lat: Double, _ lon: Double) -> String {
    "\(Int((lat / TILE_DEG).rounded(.down))):\(Int((lon / TILE_DEG).rounded(.down)))"
}

nonisolated func tileBBox(_ key: String) -> BBox {
    let parts = key.split(separator: ":").compactMap { Double($0) }
    let y = parts[0]
    let x = parts[1]
    return BBox(south: y * TILE_DEG, west: x * TILE_DEG, north: (y + 1) * TILE_DEG, east: (x + 1) * TILE_DEG)
}

/// A ponttal szomszédos csempék (alapból 3 × 3).
nonisolated func tilesAround(_ lat: Double, _ lon: Double, radius: Int = 1) -> [String] {
    let y0 = Int((lat / TILE_DEG).rounded(.down))
    let x0 = Int((lon / TILE_DEG).rounded(.down))
    var out: [String] = []
    for dy in -radius...radius { for dx in -radius...radius { out.append("\(y0 + dy):\(x0 + dx)") } }
    return out
}

/// Kulcs–érték tár (a weben localStorage; itt fájlok a Caches mappában).
nonisolated protocol KeyValueStore: Sendable {
    func getItem(_ key: String) -> Data?
    func setItem(_ key: String, _ value: Data)
}

nonisolated struct FileStore: KeyValueStore {
    let directory: URL

    static let caches = FileStore(directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("tiles"))

    private func url(_ key: String) -> URL {
        directory.appendingPathComponent(key.replacingOccurrences(of: ":", with: "_") + ".json")
    }

    func getItem(_ key: String) -> Data? { try? Data(contentsOf: url(key)) }

    func setItem(_ key: String, _ value: Data) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? value.write(to: url(key), options: .atomic)
    }
}

nonisolated struct TileLoad<T> {
    var items: [T] = []
    var fromNetwork = 0
    var fromCache = 0
    /// Csempék, amelyekhez se hálózat, se cache nem volt.
    var missing = 0
    /// Igaz, ha legalább egy csempe csak lejárt cache-ből jött (offline).
    var stale = false
}

/// Bármely azonosítós réteg (szakaszok, kamerák) csempénként: friss cache → hálózat → (hiba esetén) lejárt
/// cache. Offline is működik, amíg van cache.
final class TileCache<T: Codable & Identifiable & Sendable> where T.ID == String {
    private struct CachedTile: Codable {
        var fetchedAt: Double
        var items: [T]
    }

    private let store: KeyValueStore
    private let fetchBBox: (BBox) async throws -> [T]
    private let prefix: String
    private let ttlMs: Double
    private let now: () -> Double
    private let radius: Int

    init(store: KeyValueStore, prefix: String, ttlMs: Double = 24 * 3600_000, radius: Int = 1, now: @escaping () -> Double, fetchBBox: @escaping (BBox) async throws -> [T]) {
        self.store = store
        self.prefix = prefix
        self.ttlMs = ttlMs
        self.radius = radius
        self.now = now
        self.fetchBBox = fetchBBox
    }

    func loadItems(_ lat: Double, _ lon: Double) async -> TileLoad<T> {
        var byId: [String: T] = [:]
        var res = TileLoad<T>()
        for key in tilesAround(lat, lon, radius: radius) {
            let storeKey = "\(prefix):tile:\(key)"
            let cached = read(storeKey)
            var items: [T]?
            if let cached, now() - cached.fetchedAt < ttlMs {
                items = cached.items
                res.fromCache += 1
            } else {
                do {
                    let fetched = try await fetchBBox(tileBBox(key))
                    items = fetched
                    res.fromNetwork += 1
                    if let data = try? JSONEncoder().encode(CachedTile(fetchedAt: now(), items: fetched)) { store.setItem(storeKey, data) }
                } catch {
                    if let cached {
                        items = cached.items
                        res.fromCache += 1
                        res.stale = true
                    } else {
                        res.missing += 1
                    }
                }
            }
            for s in items ?? [] { byId[s.id] = s }
        }
        res.items = byId.values.sorted { $0.id < $1.id }
        return res
    }

    private func read(_ key: String) -> CachedTile? {
        store.getItem(key).flatMap { try? JSONDecoder().decode(CachedTile.self, from: $0) }
    }
}

/// Összefésülés azonosító szerint; a későbbi lista nyer (pl. szerver > csomagolt).
nonisolated func mergeById(_ lists: [Section]...) -> [Section] {
    var byId: [String: Section] = [:]
    var order: [String] = []
    for list in lists {
        for s in list {
            if byId[s.id] == nil { order.append(s.id) }
            byId[s.id] = s
        }
    }
    return order.map { byId[$0]! }
}
