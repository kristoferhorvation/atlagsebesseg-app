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
        // a cím útra illesztett pontja (AW12): ide tervezünk, a jelölő a címen marad
        let rp = ((p["coordinates"] as? JSONObj)?["routable_points"] as? [Any])?.first as? JSONObj
        let routable = rp.flatMap { r in jsonNum(r["latitude"]).flatMap { la in jsonNum(r["longitude"]).map { LatLon(lat: la, lon: $0) } } }
        return Place(id: id, name: name, address: address, lat: lat, lon: lon, routable: routable)
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
    /// További mentett címek (a Haza / Munka mellett), a mentés sorrendjében.
    var others: [Place] = []

    static let none = SavedPlaces()
}

/// Legfeljebb ennyi további mentett cím.
nonisolated let SAVED_OTHERS_MAX = 10

/// AW25 (INV-25, Mapbox-feltételek): tartósan (helyi tár, fiók-szinkron) a keresési találatból csak a koordináta (+ az útra illesztett
/// pont) és a felhasználó saját címkéje kerül; a Mapbox-név és -cím nem. A webes `clean` (places.ts) párja.
nonisolated func storedPlace(_ p: Place) -> Place {
    let label = p.label?.trimmingCharacters(in: .whitespacesAndNewlines)
    return Place(id: p.id, name: "", address: "", lat: p.lat, lon: p.lon, routable: p.routable, label: (label?.isEmpty ?? true) ? nil : String(label!.prefix(40)))
}

/// A hely kulcsa a névtárhoz: a koordináta 5 tizedesre (~1 m).
nonisolated func placeKey(_ p: Place) -> String { String(format: "%.5f,%.5f", p.lat, p.lon) }

/// AW25: a futás alatt látott Mapbox-nevek – csak memóriában (a Mapbox ideiglenes tárolást enged), soha nem a tárba.
nonisolated private final class PlaceNames: @unchecked Sendable {
    static let shared = PlaceNames()
    private let lock = NSLock()
    private var names: [String: (name: String, address: String)] = [:]
    func set(_ key: String, _ v: (name: String, address: String)) { lock.withLock { names[key] = v } }
    func get(_ key: String) -> (name: String, address: String)? { lock.withLock { names[key] } }
    func clear() { lock.withLock { names = [:] } }
}

/// Egy találat nevének megjegyzése a futás idejére (választáskor, mentéskor, fordított geokódoláskor).
nonisolated func rememberPlaceName(_ p: Place) {
    let name = p.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if !name.isEmpty { PlaceNames.shared.set(placeKey(p), (name, p.address)) }
}

/// Megjelenítésre: a saját címke, különben a futás alatt látott / újra lekért név; ha még nincs, a koordináta.
nonisolated func displayPlace(_ p: Place) -> Place {
    var out = p
    let known = PlaceNames.shared.get(placeKey(p))
    if let label = p.label, !label.isEmpty {
        out.name = label
        out.address = known.map { [$0.name, $0.address].filter { !$0.isEmpty }.joined(separator: ", ") } ?? ""
    } else if p.name.isEmpty {
        out.name = known?.name ?? String(format: "%.4f, %.4f", p.lat, p.lon)
        out.address = known?.address ?? ""
    }
    return out
}

/// A helyek, amelyeknek se címkéje, se ismert neve nincs – ezekre megy fordított geokódolás (egyszer helyenként).
nonisolated func placesNeedingNames(_ ps: [Place]) -> [Place] {
    ps.filter { ($0.label ?? "").isEmpty && $0.name.isEmpty && PlaceNames.shared.get(placeKey($0)) == nil }
}

/// Csak teszthez: a névtár ürítése (egy újraindított app állapota).
nonisolated func forgetPlaceNames() { PlaceNames.shared.clear() }

/// AW25: fordított geokódolás (koordináta → név) a mentett / legutóbbi hely megjelenítéséhez; az eredmény csak memóriában marad.
nonisolated func reverseGeocodeUrl(_ p: LatLon, lang: Lang, token: String) -> URL {
    var c = URLComponents(string: "https://api.mapbox.com/search/geocode/v6/reverse")!
    c.queryItems = [
        URLQueryItem(name: "longitude", value: String(format: "%.6f", p.lon)),
        URLQueryItem(name: "latitude", value: String(format: "%.6f", p.lat)),
        URLQueryItem(name: "language", value: directionsLanguage(lang)),
        URLQueryItem(name: "limit", value: "1"),
        URLQueryItem(name: "access_token", value: token),
    ]
    return c.url!
}

/// Érvényes hely-e a tárolt (laza) JSON-elem; ha igen, a tisztított alakja (a régi, névvel tárolt elem neve a futás idejére a memóriába kerül).
nonisolated private func cleanPlace(_ v: Any?) -> Place? {
    guard let o = v as? JSONObj, let name = o["name"] as? String, let lat = jsonNum(o["lat"]), let lon = jsonNum(o["lon"]) else { return nil }
    let r = o["routable"] as? JSONObj
    let routable = r.flatMap { r in jsonNum(r["lat"]).flatMap { la in jsonNum(r["lon"]).map { LatLon(lat: la, lon: $0) } } }
    let p = Place(id: str(o["id"]) ?? "\(lat),\(lon)", name: name, address: (o["address"] as? String) ?? "", lat: lat, lon: lon, routable: routable, label: o["label"] as? String)
    rememberPlaceName(p)
    return storedPlace(p)
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
    rememberPlaceName(place)
    let rest = list.filter { $0.id != place.id && haversineM($0.latLon, place.latLon) > 100 }
    return Array(([storedPlace(place)] + rest).prefix(max))
}

nonisolated func parseSaved(_ raw: String?) -> SavedPlaces {
    guard let o = jsonValue(raw ?? "null") as? JSONObj else { return .none }
    let others = ((o["others"] as? [Any]) ?? []).compactMap(cleanPlace)
    return SavedPlaces(home: cleanPlace(o["home"]), work: cleanPlace(o["work"]), others: Array(others.prefix(SAVED_OTHERS_MAX)))
}

/// Új további mentett cím a lista végére; ugyanaz a hely (azonos azonosító vagy 100 m-en belül) nem duplázódik.
nonisolated func addSavedOther(_ saved: SavedPlaces, _ place: Place) -> SavedPlaces {
    if saved.others.contains(where: { $0.id == place.id || haversineM($0.latLon, place.latLon) <= 100 }) { return saved }
    rememberPlaceName(place)
    var s = saved
    s.others = Array((saved.others + [storedPlace(place)]).prefix(SAVED_OTHERS_MAX))
    return s
}

/// AW25: Haza / Munka beállítása vagy törlése – a tárba csak a koordináta és a saját címke kerül (INV-25).
nonisolated func setSavedPlace(_ saved: SavedPlaces, _ kind: SavedChip.Kind, _ place: Place?) -> SavedPlaces {
    if let place { rememberPlaceName(place) }
    var s = saved
    if kind == .home { s.home = place.map(storedPlace) }
    if kind == .work { s.work = place.map(storedPlace) }
    return s
}

nonisolated func removeSavedOther(_ saved: SavedPlaces, _ id: String) -> SavedPlaces {
    var s = saved
    s.others.removeAll { $0.id == id }
    return s
}

/// A kereső egy mentett-cím chipje.
nonisolated struct SavedChip: Identifiable, Equatable, Sendable {
    enum Kind: String, Sendable { case home, work, pin }
    var id: String
    var icon: Kind
    var label: String
    var place: Place
}

/// A kereső chip-sora: Haza, Munka (ha be vannak állítva), majd a további mentett címek a nevükkel.
nonisolated func savedChips(_ saved: SavedPlaces, lang: Lang? = nil) -> [SavedChip] {
    var out: [SavedChip] = []
    if let h = saved.home { out.append(SavedChip(id: "home", icon: .home, label: t(.navPlaceHome, lang: lang), place: h)) }
    if let w = saved.work { out.append(SavedChip(id: "work", icon: .work, label: t(.navPlaceWork, lang: lang), place: w)) }
    return out + saved.others.map { SavedChip(id: "other:\($0.id)", icon: .pin, label: displayPlace($0).name, place: displayPlace($0)) }
}

/// A helyek JSON-alakja (a weben tárolttal azonos mezők).
nonisolated func placesJSON(_ places: [Place?]) -> [Any] {
    places.map { p in
        p.map { p -> [String: Any] in
            // AW25 (INV-25): a Mapbox-név és -cím nem kerül a tárba (a mező a régi olvasókért marad, üresen)
            let sp = storedPlace(p)
            var o: [String: Any] = ["id": sp.id, "name": "", "address": "", "lat": sp.lat, "lon": sp.lon]
            if let r = sp.routable { o["routable"] = ["lat": r.lat, "lon": r.lon] }
            if let l = sp.label { o["label"] = l }
            return o
        } ?? NSNull()
    }
}

nonisolated func serializeRecents(_ list: [Place]) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: placesJSON(list), options: [.sortedKeys])) ?? Data("[]".utf8)
    return String(decoding: data, as: UTF8.self)
}

nonisolated func serializeSaved(_ s: SavedPlaces) -> String {
    let parts = placesJSON([s.home, s.work])
    let obj: [String: Any] = ["home": parts[0], "work": parts[1], "others": placesJSON(s.others)]
    let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(decoding: data, as: UTF8.self)
}
