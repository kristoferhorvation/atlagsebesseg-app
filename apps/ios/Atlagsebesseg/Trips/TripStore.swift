import Foundation
import SQLite3
import SwiftyH3

// AW19: az utak naplójának helyi tárolója – a rendszer SQLite-ja (külső függőség nélkül; a webes IndexedDB párja,
// `apps/web/src/trips/tripStore.ts`). Két tábla: `trips` (a rekord JSON-ban, a webes `Trip` alakjával) és `samples`
// (1 Hz GPS-minták, a H3-cellával a következő kör hőtérképéhez). Szerverre semmi nem megy.
//
//   trips(id TEXT PK, started_at REAL, ended_at REAL, record TEXT)          – index: started_at
//   samples(trip_id TEXT, t REAL, lat REAL, lon REAL, speed_kmh REAL, heading REAL, accuracy REAL, h3 TEXT)
//                                                                          – index: (trip_id, t)

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
        PRAGMA user_version = 1;
        """)
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
        sqlite3_prepare_v2(db, "INSERT INTO samples (trip_id, t, lat, lon, speed_kmh, heading, accuracy, h3) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", -1, &st, nil)
        for s in samples {
            sqlite3_bind_text(st, 1, s.tripId, -1, SQLITE_TRANSIENT)
            sqlite3_bind_double(st, 2, s.t)
            sqlite3_bind_double(st, 3, s.lat)
            sqlite3_bind_double(st, 4, s.lon)
            bind(st, 5, s.speedKmh)
            bind(st, 6, s.heading)
            bind(st, 7, s.accuracy)
            if let h = s.h3 ?? tripCell(s.lat, s.lon) { sqlite3_bind_text(st, 8, h, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(st, 8) }
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
        exec("DELETE FROM samples; DELETE FROM trips;")
        exec("VACUUM")
    }

    /// Egy út mintái (időrendben) – a tesztekhez és a következő kör hőtérképéhez.
    func samples(_ tripId: String) -> [TripSample] {
        guard let db else { return [] }
        var st: OpaquePointer?
        sqlite3_prepare_v2(db, "SELECT t, lat, lon, speed_kmh, heading, accuracy, h3 FROM samples WHERE trip_id = ? ORDER BY t", -1, &st, nil)
        sqlite3_bind_text(st, 1, tripId, -1, SQLITE_TRANSIENT)
        var out: [TripSample] = []
        while sqlite3_step(st) == SQLITE_ROW {
            out.append(TripSample(
                tripId: tripId, t: sqlite3_column_double(st, 0), lat: sqlite3_column_double(st, 1), lon: sqlite3_column_double(st, 2),
                speedKmh: column(st, 3), heading: column(st, 4), accuracy: column(st, 5),
                h3: sqlite3_column_text(st, 6).map { String(cString: $0) }
            ))
        }
        sqlite3_finalize(st)
        return out
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
