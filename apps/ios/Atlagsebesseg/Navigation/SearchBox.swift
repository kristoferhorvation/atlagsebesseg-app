import AtlagsebessegCore
import Foundation

// AW23: a packages/app-logic/src/navigation/searchbox.ts párja (azonos nevű tesztek): célkeresés a Mapbox Search Box API-n (cím, üzlet,
// étterem, pláza, nevezetesség): gépelés közben `/suggest`, választáskor `/retrieve`, munkamenet-tokennel. A Geocoding API marad a
// koordinátából címre (bejelentések, Live Activity).

nonisolated enum SEARCH_SESSION {
    static let maxSuggest = 50
    static let idleMs = 120_000.0
    static let limit = 10
    static let shown = 6
    static let nearM = 50_000.0
}

private nonisolated let searchBase = "https://api.mapbox.com/search/searchbox/v1"
private nonisolated func fold(_ s: String) -> String { s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased() }
private nonisolated func pair(_ p: LatLon) -> String { String(format: "%.5f,%.5f", p.lon, p.lat) }

nonisolated func suggestUrl(_ query: String, lang: Lang, token: String, sessionToken: String, near: LatLon? = nil) -> URL {
    var c = URLComponents(string: "\(searchBase)/suggest")!
    var items = [
        URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
        URLQueryItem(name: "language", value: directionsLanguage(lang)),
        URLQueryItem(name: "limit", value: String(SEARCH_SESSION.limit)),
        URLQueryItem(name: "country", value: NAV_COUNTRIES.joined(separator: ",").lowercased()),
        URLQueryItem(name: "session_token", value: sessionToken),
    ]
    // a közeli találatok előre, a távolság innen számol
    if let near {
        items.append(URLQueryItem(name: "proximity", value: pair(near)))
        items.append(URLQueryItem(name: "origin", value: pair(near)))
    }
    items.append(URLQueryItem(name: "access_token", value: token))
    c.queryItems = items
    return c.url!
}

nonisolated func retrieveUrl(_ id: String, lang: Lang, token: String, sessionToken: String) -> URL {
    var c = URLComponents(string: "\(searchBase)/retrieve/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? id)")!
    c.queryItems = [
        URLQueryItem(name: "language", value: directionsLanguage(lang)),
        URLQueryItem(name: "session_token", value: sessionToken),
        URLQueryItem(name: "access_token", value: token),
    ]
    return c.url!
}

/// Ezek nem egy helyre mutatnak (kategória, márka): a találatsorban nincs helyük.
private nonisolated let notAPlace: Set<String> = ["category", "brand", "list", "query"]

/// Település, régió: a távolság itt nem számít (Győr Budapestről is az első).
private nonisolated let areaTypes: Set<String> = ["place", "region", "locality", "district", "neighborhood", "postcode", "country"]

/// A `/suggest` találatai (koordináta még nincs bennük, a `retrieveId`-vel kérjük le választáskor). A közeli találatok előre (a Mapbox egy 190 km-re
/// lévő, pontos nevű utcát is elsőnek ad): elöl a település és a pontos nevű közeli hely, utána a többi `nearM`-en belül, végül a távoliak; ezeken
/// belül a Mapbox sorrendje marad.
nonisolated func parseSuggest(_ json: Any?, query: String = "") -> [Place] {
    guard let o = json as? [String: Any], let list = o["suggestions"] as? [Any] else { return [] }
    let q = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
    let ranked: [(p: Place, r: Int)] = list.compactMap { v in
        guard let s = v as? [String: Any], let id = s["mapbox_id"] as? String, !notAPlace.contains(s["feature_type"] as? String ?? "") else { return nil }
        let name = ((s["name_preferred"] as? String) ?? (s["name"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return nil }
        // rövid cím: a név után a pontos cím (üzletnél), különben a tágabb hely
        let street = ((s["address"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let place = ((s["place_formatted"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let city = place.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let address = !street.isEmpty && street != name ? (city.isEmpty ? street : "\(street), \(city)") : place
        let p = Place(id: id, name: name, address: address, lat: 0, lon: 0, retrieveId: id, distanceM: (s["distance"] as? NSNumber)?.doubleValue)
        let near = p.distanceM.map { $0 <= SEARCH_SESSION.nearM } ?? true
        let r = areaTypes.contains(s["feature_type"] as? String ?? "") ? 0 : !near ? 2 : fold(name) == q ? 0 : 1
        return (p, r)
    }
    let sorted = ranked.enumerated().sorted { $0.element.r != $1.element.r ? $0.element.r < $1.element.r : $0.offset < $1.offset }
    return sorted.prefix(SEARCH_SESSION.shown).map(\.element.p)
}

/// A `/retrieve` válaszából a választott hely, koordinátával és (ha van) az útra eső ponttal; `nil`, ha nincs benne hely.
nonisolated func parseRetrieve(_ json: Any?, hit: Place) -> Place? {
    guard let o = json as? [String: Any], let f = (o["features"] as? [Any])?.first as? [String: Any],
          let c = (f["geometry"] as? [String: Any])?["coordinates"] as? [Any], c.count >= 2,
          let lon = (c[0] as? NSNumber)?.doubleValue, let lat = (c[1] as? NSNumber)?.doubleValue else { return nil }
    let p = f["properties"] as? [String: Any]
    let rp = ((p?["coordinates"] as? [String: Any])?["routable_points"] as? [Any])?.first as? [String: Any]
    var routable: LatLon?
    if let a = (rp?["latitude"] as? NSNumber)?.doubleValue, let b = (rp?["longitude"] as? NSNumber)?.doubleValue { routable = LatLon(lat: a, lon: b) }
    return Place(id: hit.id, name: hit.name, address: hit.address, lat: lat, lon: lon, routable: routable)
}

/// A munkamenet-token: egy keresésen belül ugyanaz; új jön `retrieve` után, `maxSuggest` hívás után és `idleMs` tétlenség után
/// (így egy megnyitott kereső egy számlázott munkamenet).
nonisolated final class SearchSession: @unchecked Sendable {
    private var current: String?
    private var count = 0
    private var lastAt = 0.0
    private let newToken: () -> String
    private let now: () -> Double

    init(newToken: @escaping () -> String = { UUID().uuidString.lowercased() }, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.newToken = newToken
        self.now = now
    }

    /// A következő `/suggest` tokenje.
    func suggestToken() -> String {
        let t = now()
        if current == nil || count >= SEARCH_SESSION.maxSuggest || t - lastAt > SEARCH_SESSION.idleMs {
            current = newToken()
            count = 0
        }
        count += 1
        lastAt = t
        return current!
    }

    /// A `/retrieve` tokenje: lezárja a munkamenetet.
    func retrieveToken() -> String {
        let token = current ?? newToken()
        current = nil
        return token
    }
}


/// A mentett helyek és az utolsó úti célok közül a gépelt szöveggel egyezők (API-hívás nélkül, a találatok fölött).
nonisolated func localMatches(_ query: String, saved: SavedPlaces, recents: [Place], max: Int = 4) -> [Place] {
    let q = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
    guard !q.isEmpty else { return [] }
    var seen = Set<String>()
    var out: [Place] = []
    let all: [Place?] = [saved.home, saved.work] + saved.others.map(Optional.some) + recents.map(Optional.some)
    for case let raw? in all {
        guard seen.insert(raw.id).inserted else { continue }
        let p = displayPlace(raw) // AW25: a tárolt helyen nincs Mapbox-név; a futás alatt ismert / újra lekért névvel egyezik
        if fold(p.name).contains(q) || fold(p.address).contains(q) { out.append(p) }
        if out.count >= max { break }
    }
    return out
}

/// A Search Box hívásai (élesben `URLSession`, a tesztekben mock).
nonisolated func searchBoxSuggest(_ query: String, lang: Lang, token: String, session: SearchSession, near: LatLon?, fetch: @escaping FetchData = urlSessionFetch) -> Task<[Place], Error> {
    let url = suggestUrl(query, lang: lang, token: token, sessionToken: session.suggestToken(), near: near)
    return Task {
        let (status, data) = try await fetch(url)
        guard (200..<300).contains(status) else { throw DirectionsError(code: "http_\(status)") }
        return parseSuggest(try? JSONSerialization.jsonObject(with: data), query: query)
    }
}

nonisolated func searchBoxRetrieve(_ hit: Place, lang: Lang, token: String, session: SearchSession, fetch: @escaping FetchData = urlSessionFetch) -> Task<Place, Error> {
    let url = retrieveUrl(hit.retrieveId ?? hit.id, lang: lang, token: token, sessionToken: session.retrieveToken())
    return Task {
        let (status, data) = try await fetch(url)
        guard (200..<300).contains(status) else { throw DirectionsError(code: "http_\(status)") }
        guard let place = parseRetrieve(try? JSONSerialization.jsonObject(with: data), hit: hit) else { throw DirectionsError(code: "NoPlace") }
        return place
    }
}
