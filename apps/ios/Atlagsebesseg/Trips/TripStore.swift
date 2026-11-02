import Foundation
import SQLite3
import SwiftyH3

// AW19: az utak naplójának helyi tárolója – a rendszer SQLite-ja (külső függőség nélkül; a webes IndexedDB párja,
// `apps/web/src/trips/tripStore.ts`). Két tábla: `trips` (a rekord JSON-ban, a webes `Trip` alakjával) és `samples`
// (1 Hz GPS-minták, a H3-cellával a következő kör hőtérképéhez). Szerverre semmi nem megy.
//
//   trips(id TEXT PK, started_at REAL, ended_at REAL, record TEXT)          – index: started_at
//   samples(trip_id TEXT, t REAL, lat REAL, lon REAL, speed_kmh REAL, heading REAL, accuracy REAL, h3 TEXT, limit_kmh REAL)
//                                                                          – index: (trip_id, t)
//
// AW20 (user_version 2): a hőtérkép helyi összesítése és a navigáció tábla-limitje a mintákon (az út színezéséhez):
//   heat(h3 TEXT PK, count INTEGER, avg_kmh REAL, last_t REAL)             – cellánként egy sor (res 10)
//   heat_trips(trip_id TEXT PK)                                            – melyik út van már beolvasztva (idempotencia)
// Az út törlése a hőtérképből NEM von vissza (az összesítés cellánkénti, nem útonkénti); az „Összes törlése” a hőtérképet is törli.

/// A minta H3-cellája (`TRIP.h3Res` felbontás, a h3-js `latLngToCell` párja); hibánál `nil`.
nonisolated func tripCell(_ lat: Double, _ lon: Double) -> String? {
    guard let res = H3Cell.Resolution(rawValue: Int32(TRIP.h3Res)) else { return nil }
    return try? H3LatLng(latitudeDegs: lat, longitudeDegs: lon).cell(at: res).description
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class TripStore {
    // a kapcsolat a deinitben zárul (az nem a fő szálhoz kötött); máshol csak a fő szálról használjuk
    nonisolated(unsafe) private var db: OpaquePointer?

    /// Alapból az Application Support mappában (`trips.sqlite`); a tesztek ideiglenes fájlt adnak.
    init(url: URL? = nil) {
        let file = url ?? TripStore.defaultURL()
        if sqlite3_open(file.path, &db) != SQLITE_OK {
            NSLog("TRIPS: sqlite open failed: %@", file.path)
            db = nil
            return
        }
        exec("PRAGMA journal_mode = WAL")
        exec("""
        CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, started_at REAL NOT NULL, ended_at REAL NOT NULL, record TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS trips_started ON trips(started_at);
        CREATE TABLE IF NOT EXISTS samples (trip_id TEXT NOT NULL, t REAL NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
          speed_kmh REAL, heading REAL, accuracy REAL, h3 TEXT);
        CREATE INDEX IF NOT EXISTS samples_trip ON samples(trip_id, t);
        """)
        migrate()
    }

    /// AW20: user_version 1 → 2 (a minták tábla-limitje, a hőtérkép táblái).
    private func migrate() {
        guard let db else { return }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &st, nil)
        let version = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int(st, 0) : 0
        sqlite3_finalize(st)
        if version < 2 {
            exec("""
            ALTER TABLE samples ADD COLUMN limit_kmh REAL;
            CREATE TABLE IF NOT EXISTS heat (h3 TEXT PRIMARY KEY, count INTEGER NOT NULL, avg_kmh REAL NOT NULL, last_t REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS heat_trips (trip_id TEXT PRIMARY KEY);
            PRAGMA user_version = 2;
            """)
        }
    }

    deinit { sqlite3_close(db) }

    static func defaultURL() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("trips.sqlite")
    }

    /// Új minták egy tranzakcióban; a H3-cella itt számolódik.
    func addSamples(_ samples: [TripSample]) {
        guard let db, !samples.isEmpty else { return }
        exec("BEGIN")
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT INTO samples (trip_id, t, lat, lon, speed_kmh, heading, accuracy, h3, limit_kmh) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", -1, &st, nil)
        for s in samples {
            sqlite3_bind_text(st, 1, s.tripId, -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(st, 2, s.t)
            sqlite3_bind_double(st, 3, s.lat)
            sqlite3_bind_double(st, 4, s.lon)
            bind(st, 5, s.speedKmh)
            bind(st, 6, s.heading)
            bind(st, 7, s.accuracy)
            if let h = s.h3 ?? tripCell(s.lat, s.lon) { sqlite3_bind_text(st, 8, h, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(st, 8) }
            bind(st, 9, s.limitKmh)
            sqlite3_step(st)
            sqlite3_reset(st)
        }
        sqlite3_finalize(st)
        exec("COMMIT")
    }

    func saveTrip(_ trip: Trip) {
        guard let db, let data = try? JSONEncoder().encode(trip), let json = String(data: data, encoding: .utf8) else { return }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO trips (id, started_at, ended_at, record) VALUES (?, ?, ?, ?)", -1, &st, nil)
        sqlite3_bind_text(st, 1, trip.id, -1, SQLITE_TRANSIENT)
        sqlite3_bind_double(st, 2, trip.startedAt)
        sqlite3_bind_double(st, 3, trip.endedAt)
        sqlite3_bind_text(st, 4, json, -1, SQLITE_TRANSIENT)
        sqlite3_step(st)
        sqlite3_finalize(st)
    }

    /// A napló (legújabb elöl).
    func trips() -> [Trip] {
        guard let db else { return [] }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT record FROM trips ORDER BY started_at DESC", -1, &st, nil)
        var out: [Trip] = []
        let dec = JSONDecoder()
        while sqlite3_step(st) == SQLITE_ROW {
            guard let c = sqlite3_column_text(st, 0), let trip = try? dec.decode(Trip.self, from: Data(String(cString: c).utf8)) else { continue }
            out.append(trip)
        }
        sqlite3_finalize(st)
        return out
    }

    /// Egy út a mintáival.
    func deleteTrip(_ id: String) {
        run("DELETE FROM samples WHERE trip_id = ?", id)
        run("DELETE FROM trips WHERE id = ?", id)
    }

    /// Csak a minták (az eldobott, túl rövid út).
    func deleteSamples(_ tripId: String) { run("DELETE FROM samples WHERE trip_id = ?", tripId) }

    func deleteAll() {
        exec("DELETE FROM samples; DELETE FROM trips; DELETE FROM heat; DELETE FROM heat_trips;")
        exec("VACUUM")
    }

    /// Egy út mintái (időrendben) – a tesztekhez és a következő kör hőtérképéhez.
    func samples(_ tripId: String) -> [TripSample] {
        guard let db else { return [] }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT t, lat, lon, speed_kmh, heading, accuracy, h3, limit_kmh FROM samples WHERE trip_id = ? ORDER BY t", -1, &st, nil)
        sqlite3_bind_text(st, 1, tripId, -1, SQLITE_TRANSIENT)
        var out: [TripSample] = []
        while sqlite3_step(st) == SQLITE_ROW {
            out.append(TripSample(
                tripId: tripId, t: sqlite3_column_double(st, 0), lat: sqlite3_column_double(st, 1), lon: sqlite3_column_double(st, 2),
                speedKmh: column(st, 3), heading: column(st, 4), accuracy: column(st, 5),
                h3: sqlite3_column_text(st, 6).map { String(cString: $0) }, limitKmh: column(st, 7)
            ))
        }
        sqlite3_finalize(st)
        return out
    }

    // MARK: hőtérkép (AW20)

    /// A hőtérkép összes cellája (a térkép indexének).
    func heatCells() -> [HeatCell] {
        guard let db else { return [] }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT h3, count, avg_kmh, last_t FROM heat", -1, &st, nil)
        var out: [HeatCell] = []
        while sqlite3_step(st) == SQLITE_ROW {
            guard let c = sqlite3_column_text(st, 0) else { continue }
            out.append(HeatCell(h3: String(cString: c), count: Int(sqlite3_column_int64(st, 1)), avgKmh: sqlite3_column_double(st, 2), lastT: sqlite3_column_double(st, 3)))
        }
        sqlite3_finalize(st)
        return out
    }

    /// Azok az utak, amelyek még nincsenek a hőtérképbe beolvasztva (a visszamenőleges feldolgozáshoz).
    func unabsorbedTripIds() -> [String] {
        guard let db else { return [] }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT id FROM trips WHERE id NOT IN (SELECT trip_id FROM heat_trips) ORDER BY started_at", -1, &st, nil)
        var out: [String] = []
        while sqlite3_step(st) == SQLITE_ROW { if let c = sqlite3_column_text(st, 0) { out.append(String(cString: c)) } }
        sqlite3_finalize(st)
        return out
    }

    /// Egy út beolvasztása a hőtérképbe egy tranzakcióban: áthaladások a mintákból → cellák (upsert) → az út jelölése.
    /// Idempotens: a már beolvasztott utat nem számolja újra (`nil`). A változott cellákat és az áthaladásokat adja
    /// (az utóbbiból megy fel a közösségi összesítés, ha be van kapcsolva).
    func absorbTrip(_ tripId: String) -> (changed: [HeatCell], passes: [HeatPass])? {
        guard let db else { return nil }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT 1 FROM heat_trips WHERE trip_id = ?", -1, &st, nil)
        sqlite3_bind_text(st, 1, tripId, -1, SQLITE_TRANSIENT)
        let already = sqlite3_step(st) == SQLITE_ROW
        sqlite3_finalize(st)
        if already { return nil }
        let passes = tripPasses(samples(tripId))
        var cells: [String: HeatCell] = [:]
        for h in Set(passes.map(\.h3)) {
            var q: OpaquePointer?
            sqlite3_prepare_v2(db, "SELECT count, avg_kmh, last_t FROM heat WHERE h3 = ?", -1, &q, nil)
            sqlite3_bind_text(q, 1, h, -1, SQLITE_TRANSIENT)
            if sqlite3_step(q) == SQLITE_ROW { cells[h] = HeatCell(h3: h, count: Int(sqlite3_column_int64(q, 0)), avgKmh: sqlite3_column_double(q, 1), lastT: sqlite3_column_double(q, 2)) }
            sqlite3_finalize(q)
        }
        let changed = mergePasses(&cells, passes)
        exec("BEGIN")
        var up: OpaquePointer?
        sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO heat (h3, count, avg_kmh, last_t) VALUES (?, ?, ?, ?)", -1, &up, nil)
        for c in changed {
            sqlite3_bind_text(up, 1, c.h3, -1, SQLITE_TRANSIENT)
            sqlite3_bind_int64(up, 2, Int64(c.count))
            sqlite3_bind_double(up, 3, c.avgKmh)
            sqlite3_bind_double(up, 4, c.lastT)
            sqlite3_step(up)
            sqlite3_reset(up)
        }
        sqlite3_finalize(up)
        run("INSERT OR IGNORE INTO heat_trips (trip_id) VALUES (?)", tripId)
        exec("COMMIT")
        return (changed, passes)
    }

    // MARK: segédek

    private func exec(_ sql: String) {
        guard let db else { return }
        if sqlite3_exec(db, sql, nil, nil, nil) != SQLITE_OK { NSLog("TRIPS: sqlite error: %@", String(cString: sqlite3_errmsg(db))) }
    }

    private func run(_ sql: String, _ arg: String) {
        guard let db else { return }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, sql, -1, &st, nil)
        sqlite3_bind_text(st, 1, arg, -1, SQLITE_TRANSIENT)
        sqlite3_step(st)
        sqlite3_finalize(st)
    }

    private func bind(_ st: OpaquePointer?, _ i: Int32, _ v: Double?) {
        if let v { sqlite3_bind_double(st, i, v) } else { sqlite3_bind_null(st, i) }
    }

    private func column(_ st: OpaquePointer?, _ i: Int32) -> Double? {
        sqlite3_column_type(st, i) == SQLITE_NULL ? nil : sqlite3_column_double(st, i)
    }
}
