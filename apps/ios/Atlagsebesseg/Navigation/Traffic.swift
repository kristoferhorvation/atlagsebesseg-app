import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/traffic.ts portja (AW18): forgalom navigáció közben, helyi dugó-érzékelés,
// közösségi dugó-adat, újratervezés-újrapróbálás. A küszöbök a generált `TRAFFIC`-ből (AppLogicConstants.swift).

// MARK: útvonalválasztó

/// A „Leggyorsabb”: a legkisebb menetidejű útvonal indexe (egyenlőnél az előbbi); üres listánál 0.
nonisolated func fastestRouteIndex(_ durationsS: [Double]) -> Int {
    var best = 0
    for i in durationsS.indices.dropFirst() where durationsS[i] < durationsS[best] { best = i }
    return best
}

/// A kártya címkéje: a leggyorsabbon „Leggyorsabb”, a többin „Alternatíva N” (N a leggyorsabb nélküli sorszám).
nonisolated func routeTagText(_ index: Int, _ fastest: Int, lang: Lang? = nil) -> String {
    if index == fastest { return t(.navPickerFastest, lang: lang) }
    return t(.navPickerAlt, ["n": String(index < fastest ? index + 1 : index)], lang: lang)
}

// MARK: újratervezés-hiba

/// A `failures`. sikertelen újratervezés után ennyi idő múlva jön a következő próba (ms): 5 → 10 → 20 → 30 s, max 30.
nonisolated func rerouteRetryDelayMs(_ failures: Int) -> Double {
    let b = TRAFFIC.rerouteBackoffS
    return b[min(b.count - 1, max(0, failures - 1))] * 1000
}

/// A Directions-hiba oka a naplóhoz: HTTP-státusz (`http_503`), `timeout`, `network`, vagy a Directions kódja (`NoRoute`).
nonisolated func routeErrorKind(_ e: Error) -> String {
    if let d = e as? DirectionsError { return d.code }
    if let u = e as? URLError, u.code == .timedOut { return "timeout" }
    return "network"
}

// MARK: helyi dugó-érzékelés

nonisolated enum JamChange: String, Sendable {
    case enter, exit
}

/// Dugó-állapot a mért haladásból. A megtett utat az útvonal menti legtávolabbi elért pont növekedése adja (álló
/// helyzetben az oda-vissza GPS-zaj nem „halad”); útvonal-csere után `rebase()`. Belépés: legalább `jamWindowMs` adat, és
/// az ablak átlaga a várt tempó `jamSlowFraction`-ja alatt. Kilépés: legalább `jamClearM` megszakítás nélkül a várt tempó
/// `jamNearFraction`-ja fölött.
nonisolated final class JamDetector {
    private var odo = 0.0
    /// Az útvonal mentén eddig elért legtávolabbi pont: csak ennek növekedése haladás (a zaj oda-vissza nem).
    private var maxAlong: Double?
    private var hist: [(t: Double, odo: Double)] = []
    private var jam = false
    private var clear: (odo: Double, t: Double)?
    private var lastClearAvg: Double?

    /// Új fix: `t` (ms), útvonal menti hely (m), pillanatnyi sebesség (m/s; `nil`: a haladásból), várt tempó (m/s).
    func update(_ t: Double, _ alongM: Double, _ speedMps: Double?, _ expectedMps: Double) -> JamChange? {
        let prev = hist.last
        if let m = maxAlong { odo += max(0, alongM - m) }
        maxAlong = max(maxAlong ?? alongM, alongM)
        hist.append((t, odo))
        while hist.count > 2 && hist[1].t <= t - TRAFFIC.jamWindowMs { hist.removeFirst() }
        let speed = speedMps ?? (prev.map { t > $0.t ? (odo - $0.odo) * 1000 / (t - $0.t) : 0 } ?? 0)
        if !jam {
            let span = t - hist[0].t
            if let avg = avgMps, span >= TRAFFIC.jamWindowMs - 1000, avg < TRAFFIC.jamSlowFraction * expectedMps {
                jam = true
                clear = nil
                return .enter
            }
            return nil
        }
        if speed >= TRAFFIC.jamNearFraction * expectedMps {
            if clear == nil { clear = (odo, t) }
            if let c = clear, odo - c.odo >= TRAFFIC.jamClearM {
                lastClearAvg = t > c.t ? (odo - c.odo) * 1000 / (t - c.t) : speed
                jam = false
                clear = nil
                // a dugós ablak ne indítson azonnal újra
                hist = [(t, odo)]
                return .exit
            }
        } else {
            clear = nil
        }
        return nil
    }

    /// Új útvonal: a hely mostantól az új útvonalon mérődik (a megtett út megmarad).
    func rebase() {
        maxAlong = nil
    }

    var active: Bool { jam }

    /// Az utolsó (legfeljebb `jamWindowMs`-os) ablak átlaga (m/s); egy mintánál `nil`.
    var avgMps: Double? {
        guard let a = hist.first, let b = hist.last, b.t > a.t else { return nil }
        return (b.odo - a.odo) * 1000 / (b.t - a.t)
    }

    /// A dugó végét jelző szakasz átlaga (m/s) – a „feloldva” közösségi mintához.
    var clearedAvgMps: Double? { lastClearAvg }

    /// A megtett út (m) – a minta hosszához.
    var odometerM: Double { odo }
}

// MARK: közösségi dugó-adat

/// A `public.jam_kind` enum: érzékelt / bejelentett dugó, illetve a feloldódás (normál tempó újra).
nonisolated enum JamKind: String, Codable, Sendable {
    case erzekelt, bejelentett, oldott
}

/// Egy feltöltendő minta (`jam_samples` sor; user_id-t a szerver adja). A pont a mért szakasz VÉGE, irányban.
nonisolated struct JamSampleInsert: Codable, Equatable, Sendable {
    var kind: JamKind
    var lat: Double
    var lon: Double
    var heading_deg: Int?
    var avg_kmh: Int
    var length_m: Int
}

/// Egy friss közösségi minta (`active_jams`).
nonisolated struct CommunityJam: Equatable, Sendable {
    var id: String
    var lat: Double
    var lon: Double
    var headingDeg: Double?
    var avgKmh: Double
    var lengthM: Double
    var createdAt: Double
    var own: Bool
}

nonisolated private func normHeading(_ h: Double?) -> Int? {
    guard let h, h.isFinite else { return nil }
    return ((Int(jsRound(h)) % 360) + 360) % 360
}

/// A minta a jelenlegi fixből: átlag (m/s → km/h, egészre), a mért szakasz hossza.
nonisolated func jamSample(_ kind: JamKind, lat: Double, lon: Double, heading: Double?, avgMps: Double, lengthM: Double) -> JamSampleInsert {
    JamSampleInsert(
        kind: kind, lat: lat, lon: lon, heading_deg: normHeading(heading),
        avg_kmh: max(0, Int(jsRound(avgMps * 3.6))), length_m: max(1, Int(jsRound(lengthM)))
    )
}

/// Más felhasználók friss (`communityMaxAgeMs`-nál fiatalabb), azonos irányú (±`communityHeadingDeg`) mintái az útvonal
/// `ROUTE_MATCH_M` sávjában: az érintett szakasz (`lengthM` a minta pontja előtt) ideje a mért átlaggal (legalább
/// `jamMinKmh`). Átfedésnél az újabb minta nyer. A saját és az irány nélküli minta nem számít.
nonisolated func applyCommunityJams(_ route: NavRoute, _ durations: [Double], _ jams: [CommunityJam], now: Double) -> [Double] {
    var out = durations
    let fresh = jams.filter { !$0.own && $0.headingDeg != nil && now - $0.createdAt < TRAFFIC.communityMaxAgeMs }.sorted { $0.createdAt < $1.createdAt }
    guard !fresh.isEmpty, let core = coreRoute(route) else { return out }
    for j in fresh {
        let p = core.project(LatLon(lat: j.lat, lon: j.lon))
        if p.crossM > ROUTE_MATCH_M || angleDiffDeg(j.headingDeg!, p.bearingDeg) > TRAFFIC.communityHeadingDeg { continue }
        let to = min(route.distanceM, p.alongM)
        let from = max(0, to - j.lengthM)
        let mps = max(TRAFFIC.jamMinKmh, j.avgKmh) / 3.6
        for i in out.indices {
            let a = route.segStartM[i]
            let b = i + 1 < route.segStartM.count ? route.segStartM[i + 1] : route.distanceM
            let overlap = min(b, to) - max(a, from)
            if overlap <= 0 || b <= a { continue }
            out[i] = out[i] - out[i] * overlap / (b - a) + overlap / mps
        }
    }
    return out
}

/// Egy `active_jams` sor (a 15 percnél frissebb közösségi dugó-minta).
nonisolated struct JamRow: Decodable, Sendable {
    var id: String
    var kind: String
    var lat: Double
    var lon: Double
    var heading_deg: Double?
    var avg_kmh: Double
    var length_m: Double
    var user_id: String?
    var created_at: String
}

nonisolated func rowToCommunityJam(_ row: JamRow, myUserId: String?) -> CommunityJam {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var d = f.date(from: row.created_at)
    if d == nil {
        f.formatOptions = [.withInternetDateTime]
        d = f.date(from: row.created_at)
    }
    return CommunityJam(
        id: row.id, lat: row.lat, lon: row.lon, headingDeg: row.heading_deg, avgKmh: row.avg_kmh, lengthM: row.length_m,
        createdAt: (d?.timeIntervalSince1970 ?? 0) * 1000, own: myUserId != nil && row.user_id?.lowercased() == myUserId?.lowercased()
    )
}

/// A közösségi minták lekérésének téglalapja: az útvonal előttünk lévő `aheadM` része, `padM`-rel (fok).
nonisolated func jamQueryBBox(_ route: NavRoute, _ alongM: Double, aheadM: Double = 30_000, padM: Double = 500) -> BBox? {
    guard let core = coreRoute(route) else { return nil }
    var pts: [LatLon] = []
    let end = min(route.distanceM, alongM + aheadM)
    var d = max(0, alongM - 1000)
    while d < end {
        pts.append(core.pointAt(d))
        d += 500
    }
    pts.append(core.pointAt(end))
    let s = pts.map(\.lat).min()!, n = pts.map(\.lat).max()!
    let w = pts.map(\.lon).min()!, e = pts.map(\.lon).max()!
    let dLat = padM / 111_195
    let dLon = padM / (111_195 * cos((s + n) / 2 * .pi / 180))
    return BBox(south: s - dLat, west: w - dLon, north: n + dLat, east: e + dLon)
}

/// Az alsó sáv borostyán felirata: „+N perc dugó”.
nonisolated func trafficDelayLabel(_ min: Int, lang: Lang? = nil) -> String { t(.navDelay, ["n": String(min)], lang: lang) }
