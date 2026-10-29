import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/geocoding.ts és places.ts portja (A11).

/// Mapbox Geocoding (v6, előre-keresés, automatikus kiegészítés) a támogatott országokra.
nonisolated func geocodeUrl(_ query: String, lang: Lang, token: String, near: LatLon? = nil) -> URL {
    var q: [URLQueryItem] = [
        URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
        URLQueryItem(name: "country", value: NAV_COUNTRIES.joined(separator: ",")),
        URLQueryItem(name: "language", value: directionsLanguage(lang)),
        URLQueryItem(name: "autocomplete", value: "true"),
        URLQueryItem(name: "limit", value: "6"),
    ]
    if let near { q.append(URLQueryItem(name: "proximity", value: String(format: "%.5f,%.5f", near.lon, near.lat))) }
    q.append(URLQueryItem(name: "access_token", value: token))
    var c = URLComponents(string: "https://api.mapbox.com/search/geocode/v6/forward")!
    c.queryItems = q
    return c.url!
}

/// A JS `String(x)` a lazán tipizált mezőkre (szám is lehet).
nonisolated private func str(_ v: Any?) -> String? {
    if let s = v as? String { return s }
    if let n = jsonNum(v) { return n == n.rounded() && abs(n) < 1e15 ? String(Int(n)) : String(n) }
    return nil
}

/// A Geocoding-válasz találatai; hibás elemet kihagy.
nonisolated func parseGeocode(_ json: Any?) -> [Place] {
    guard let o = json as? JSONObj, let features = o["features"] as? [Any] else { return [] }
    return features.compactMap { f in
        guard let f = f as? JSONObj, let g = f["geometry"] as? JSONObj, let coords = g["coordinates"] as? [Any], coords.count >= 2,
              let lon = jsonNum(coords[0]), let lat = jsonNum(coords[1]) else { return nil }
        let p = (f["properties"] as? JSONObj) ?? [:]
        let name = (str(p["name_preferred"]) ?? str(p["name"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return nil }
        let address = (str(p["place_formatted"]) ?? str(p["full_address"]) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let id = str(p["mapbox_id"]) ?? str(f["id"]) ?? "\(lat),\(lon)"
        return Place(id: id, name: name, address: address, lat: lat, lon: lon)
    }
}

/// Keresni csak elég hosszú szövegre érdemes (költségvédelem).
nonisolated func shouldSearch(_ q: String, min: Int = NAV_CONFIG.geocodeMinChars) -> Bool {
    q.trimmingCharacters(in: .whitespacesAndNewlines).count >= min
}

nonisolated enum SearchState: Equatable, Sendable {
    case idle
    case loading
    case ok([Place])
    case error
}

/// Időzítő a kereső késleltetéséhez (a tesztek kézzel léptetik).
protocol SearchTimers {
    func set(_ ms: Double, _ fn: @escaping () -> Void) -> Int
    func clear(_ id: Int?)
}

/// A valódi időzítő: a fő szálon, `DispatchWorkItem`-mel.
final class MainQueueTimers: SearchTimers {
    private var items: [Int: DispatchWorkItem] = [:]
    private var seq = 0

    func set(_ ms: Double, _ fn: @escaping () -> Void) -> Int {
        seq += 1
        let id = seq
        let item = DispatchWorkItem { [weak self] in
            self?.items[id] = nil
            fn()
        }
        items[id] = item
        DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: item)
        return id
    }

    func clear(_ id: Int?) {
        guard let id else { return }
        items.removeValue(forKey: id)?.cancel()
    }
}

/// Keresés gépelés közben: 3 karaktertől, 300 ms-os késleltetéssel; a régi (lassabban érkező)
/// válasz nem írja felül az újabbat.
final class SearchController {
    private let search: (String) -> Task<[Place], Error>
    private let onState: (SearchState) -> Void
    private let debounceMs: Double
    private let minChars: Int
    private let timers: SearchTimers
    private var timer: Int?
    private var seq = 0
    /// A futó keresések (a tesztek `settle()`-lel várják meg).
    private var pending: [Task<Void, Never>] = []

    init(
        search: @escaping (String) -> Task<[Place], Error>,
        onState: @escaping (SearchState) -> Void,
        debounceMs: Double = NAV_CONFIG.geocodeDebounceMs,
        minChars: Int = NAV_CONFIG.geocodeMinChars,
        timers: SearchTimers = MainQueueTimers()
    ) {
        self.search = search
        self.onState = onState
        self.debounceMs = debounceMs
        self.minChars = minChars
        self.timers = timers
    }

    func input(_ query: String) {
        timers.clear(timer)
        timer = nil
        seq += 1
        let seq = seq
        if !shouldSearch(query, min: minChars) {
            onState(.idle)
            return
        }
        timer = timers.set(debounceMs) { [weak self] in
            guard let self else { return }
            self.timer = nil
            self.onState(.loading)
            let req = self.search(query.trimmingCharacters(in: .whitespacesAndNewlines))
            self.pending.append(Task { [weak self] in
                let result = await req.result
                guard let self, seq == self.seq else { return }
                switch result {
                case .success(let places): self.onState(.ok(places))
                case .failure: self.onState(.error)
                }
            })
        }
    }

    func dispose() {
        seq += 1
        timers.clear(timer)
        timer = nil
    }

    /// A függő keresések bevárása (teszthez; a webes `flush()` megfelelője).
    func settle() async {
        while !pending.isEmpty {
            let p = pending
            pending = []
            for task in p { await task.value }
        }
    }
}

// MARK: helyek (places.ts)

nonisolated let RECENTS_KEY = "nav:recents:v1"
nonisolated let SAVED_KEY = "nav:saved:v1"

nonisolated struct SavedPlaces: Equatable, Sendable {
    var home: Place?
    var work: Place?

    static let none = SavedPlaces()
}

/// Érvényes hely-e a tárolt (laza) JSON-elem; ha igen, a tisztított alakja.
nonisolated private func cleanPlace(_ v: Any?) -> Place? {
    guard let o = v as? JSONObj, let name = o["name"] as? String, let lat = jsonNum(o["lat"]), let lon = jsonNum(o["lon"]) else { return nil }
    return Place(id: str(o["id"]) ?? "\(lat),\(lon)", name: name, address: (o["address"] as? String) ?? "", lat: lat, lon: lon)
}

nonisolated private func jsonValue(_ raw: String?) -> Any? {
    guard let raw, let data = raw.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
}

/// Tárolt utolsó úti célok; sérült érték helyett üres lista.
nonisolated func parseRecents(_ raw: String?, max: Int = NAV_CONFIG.recentMax) -> [Place] {
    guard let list = jsonValue(raw ?? "[]") as? [Any] else { return [] }
    return Array(list.compactMap(cleanPlace).prefix(max))
}

/// Új cél a lista elejére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik; legfeljebb `max` marad.
nonisolated func addRecent(_ list: [Place], _ place: Place, max: Int = NAV_CONFIG.recentMax) -> [Place] {
    let rest = list.filter { $0.id != place.id && haversineM($0.latLon, place.latLon) > 100 }
    return Array(([place] + rest).prefix(max))
}

nonisolated func parseSaved(_ raw: String?) -> SavedPlaces {
    guard let o = jsonValue(raw ?? "null") as? JSONObj else { return .none }
    return SavedPlaces(home: cleanPlace(o["home"]), work: cleanPlace(o["work"]))
}

/// A helyek JSON-alakja (a weben tárolttal azonos mezők).
nonisolated func placesJSON(_ places: [Place?]) -> [Any] {
    places.map { p in p.map { ["id": $0.id, "name": $0.name, "address": $0.address, "lat": $0.lat, "lon": $0.lon] as [String: Any] } ?? NSNull() }
}

nonisolated func serializeRecents(_ list: [Place]) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: placesJSON(list), options: [.sortedKeys])) ?? Data("[]".utf8)
    return String(decoding: data, as: UTF8.self)
}

nonisolated func serializeSaved(_ s: SavedPlaces) -> String {
    let parts = placesJSON([s.home, s.work])
    let data = (try? JSONSerialization.data(withJSONObject: ["home": parts[0], "work": parts[1]], options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
}
