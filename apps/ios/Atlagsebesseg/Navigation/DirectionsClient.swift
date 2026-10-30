import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/client.ts portja (A11).

/// Szinkron kulcs-érték tár (a webes localStorage-burok; itt `UserDefaults`, a tesztekben memória).
protocol SyncStore: AnyObject {
    func getItem(_ key: String) -> String?
    func setItem(_ key: String, _ value: String)
}

final class DefaultsStore: SyncStore {
    private let defaults: UserDefaults

    init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

    func getItem(_ key: String) -> String? { defaults.string(forKey: key) }
    func setItem(_ key: String, _ value: String) { defaults.set(value, forKey: key) }
}

nonisolated let REQUEST_COUNT_KEY = "nav:requests:v1"

/// Helyi nap kulcsa: „2026-10-28”.
nonisolated func dayKey(_ ms: Double) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: ms / 1000))
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

/// Napi útvonal-kérés számláló (Beállítások → Állapot); éjfélkor nullázódik.
final class RequestCounter {
    private let store: SyncStore
    private let now: () -> Double
    private var day = ""
    private var n = 0
    var onChange: (() -> Void)?

    init(store: SyncStore, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }) {
        self.store = store
        self.now = now
        load()
    }

    private func load() {
        day = dayKey(now())
        n = 0
        guard let raw = store.getItem(REQUEST_COUNT_KEY), let data = raw.data(using: .utf8),
              let p = (try? JSONSerialization.jsonObject(with: data)) as? JSONObj else { return }
        if (p["day"] as? String) == day, let c = jsonNum(p["n"]) { n = Int(c) }
    }

    /// A mai kérések száma.
    var count: Int {
        let today = dayKey(now())
        if day != today {
            day = today
            n = 0
        }
        return n
    }

    func increment() {
        n = count + 1
        if let data = try? JSONSerialization.data(withJSONObject: ["day": day, "n": n], options: [.sortedKeys]) {
            store.setItem(REQUEST_COUNT_KEY, String(decoding: data, as: UTF8.self))
        }
        onChange?()
    }
}

nonisolated enum RouteRequestReason: String, Sendable {
    /// Az első tervezés, újratervezés, alternatíva-figyelés (AW18 óta egyben a 2 perces forgalom-frissítés), vagy
    /// forgalom-lekérés a jelenlegi útvonalon (`traffic`, a `via` köztes ponttal), ha az alternatívák között nem volt meg.
    case plan, reroute, alternatives, traffic
}

nonisolated struct RouteRequestContext: Sendable {
    var heading: Double?
    var reason: RouteRequestReason
    /// AW18: néma köztes pont (a következő manőver), hogy a lekérés a jelenlegi útvonalon maradjon.
    var via: LatLon? = nil
}

/// Az útvonal-kérés függvénye – a `NavigationSession` ezt kapja (élesben a `DirectionsClient`, a szimulátorban a fixtúra).
/// A hívás szinkron indul (a költségvédelem és a számláló azonnal érvényes, mint a weben a Promise első lépése), az
/// eredmény a visszaadott `Task`-ból jön.
typealias RouteFetcher = (LatLon, LatLon, RouteRequestContext) -> Task<[NavRoute], Error>

/// HTTP-lekérés (élesben `URLSession`, a tesztekben mock): státusz + törzs.
typealias FetchData = @Sendable (URL) async throws -> (status: Int, data: Data)

nonisolated let urlSessionFetch: FetchData = { url in
    let (data, res) = try await URLSession.shared.data(from: url)
    return ((res as? HTTPURLResponse)?.statusCode ?? 0, data)
}

/// A Mapbox Directions-kliens költségvédelemmel: két hívás között legalább `directionsMinGapMs`
/// (különben `RateLimited`), és minden elküldött kérés beleszámít a napi számlálóba.
final class DirectionsClient {
    private let token: String
    private let lang: () -> Lang
    private let fetch: FetchData
    private let counter: RequestCounter
    private let now: () -> Double
    private let minGapMs: Double
    private let timeoutMs: Double
    private var lastCallAt = -Double.infinity

    init(token: String, lang: @escaping () -> Lang, fetch: @escaping FetchData = urlSessionFetch, counter: RequestCounter,
         now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 }, minGapMs: Double = NAV_CONFIG.directionsMinGapMs,
         timeoutMs: Double = TRAFFIC.directionsTimeoutMs) {
        self.timeoutMs = timeoutMs
        self.token = token
        self.lang = lang
        self.fetch = fetch
        self.counter = counter
        self.now = now
        self.minGapMs = minGapMs
    }

    func routes(_ from: LatLon, _ to: LatLon, _ ctx: RouteRequestContext) -> Task<[NavRoute], Error> {
        let now = now()
        if now - lastCallAt < minGapMs { return Task { throw DirectionsError(code: "RateLimited") } }
        lastCallAt = now
        counter.increment()
        let url = directionsUrl(from: from, to: to, lang: lang(), token: token, heading: ctx.heading, via: ctx.via)
        let fetch = fetch
        let timeoutNs = UInt64(max(0, timeoutMs) * 1_000_000)
        let prefix = "r\(Int(jsRound(now / 1000)))-"
        return Task {
            // AW18: időtúllépés (a naplóban „timeout”, a hálózati hiba „network”, a HTTP-hiba „http_<státusz>”)
            let (status, data) = try await withThrowingTaskGroup(of: (status: Int, data: Data).self) { group in
                group.addTask { try await fetch(url) }
                group.addTask {
                    try await Task.sleep(nanoseconds: timeoutNs)
                    throw DirectionsError(code: "timeout")
                }
                let first = try await group.next()!
                group.cancelAll()
                return first
            }
            // a Directions hibakódja (pl. NoRoute) 200-nál is, 4xx-nél is a törzsben jön
            let json = try? JSONSerialization.jsonObject(with: data)
            let ok = (200..<300).contains(status)
            if !ok, (json as? JSONObj)?["code"] == nil { throw DirectionsError(code: "http_\(status)") }
            return try parseDirections(json, idPrefix: prefix)
        }
    }

    var fetcher: RouteFetcher { { [weak self] from, to, ctx in self?.routes(from, to, ctx) ?? Task { throw DirectionsError(code: "disposed") } } }
}

/// A Mapbox Geocoding-keresés (a `SearchController` `search`-e).
nonisolated func geocodeSearch(_ query: String, lang: Lang, token: String, near: LatLon?, fetch: @escaping FetchData = urlSessionFetch) -> Task<[Place], Error> {
    let url = geocodeUrl(query, lang: lang, token: token, near: near)
    return Task {
        let (status, data) = try await fetch(url)
        guard (200..<300).contains(status) else { throw DirectionsError(code: "http_\(status)") }
        return parseGeocode(try? JSONSerialization.jsonObject(with: data))
    }
}
