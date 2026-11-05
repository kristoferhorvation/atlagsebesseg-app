import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/traffic.ts portja (AW18): forgalom navigáció közben, helyi dugó-érzékelés,
// közösségi dugó-adat, újratervezés-újrapróbálás. A küszöbök a generált `TRAFFIC`-ből (AppLogicConstants.swift).

// MARK: útvonalválasztó

/// AW23: a kártyák sorrendje: a leggyorsabb legfelül, a többi menetidő szerint (egyenlőnél az eredeti sorrend).
nonisolated func routeOrder(_ durationsS: [Double]) -> [Int] {
    durationsS.enumerated().sorted { $0.element != $1.element ? $0.element < $1.element : $0.offset < $1.offset }.map(\.offset)
}

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
    // a webes `TypeError` (a fetch hálózati hibája) párja a `URLError`; minden más hiba az üzenetével, mint a weben
    if e is URLError { return "network" }
    let msg = e.localizedDescription
    return msg.isEmpty ? "network" : "network: \(msg)"
}

// MARK: helyi dugó-érzékelés

nonisolated enum JamChange: String, Sendable {
    case enter, exit
}

/// A dugó-érzékelés bemenete a jelenlegi helyről.
nonisolated struct JamContext: Sendable {
    /// A megengedett sebesség (m/s): `permittedKmhAt`.
    var limitMps: Double
    /// Autópálya vagy autóút: nincs lámpa-türelem, nagyobb a kilépési táv.
    var highway: Bool
    /// Jelzőlámpa, kereszteződés vagy kanyar `lightNearM`-en belül.
    var nearStopPoint: Bool
    /// A hátralévő úton van heavy / severe szakasz: a helyi ETA-korrekció addig nem jár le.
    var heavyAhead: Bool
}

/// Dugó-állapot a mért haladásból (AW23). A megtett utat az útvonal menti legtávolabbi elért pont növekedése adja (álló
/// helyzetben az oda-vissza GPS-zaj nem „halad”); útvonal-csere után `rebase()`. Az ablak „érvényes” időben mér: a lámpa-türelem
/// alatti állás nem számít bele. Belépés: `jamWindowMs` érvényes idő átlaga a megengedett sebesség `jamSlowFraction`-ja alatt, és
/// az ablak előtt már haladtunk. Kilépés: az útkategória szerinti ablakban a megengedett sebesség `jamClearFraction`-ja fölött.
nonisolated final class JamDetector {
    private var odo = 0.0
    /// Az útvonal mentén eddig elért legtávolabbi pont: csak ennek növekedése haladás (a zaj oda-vissza nem).
    private var maxAlong: Double?
    /// Érvényes idő (ms): a lámpa-türelem nélkül.
    private var eff = 0.0
    private var lastT: Double?
    private var hist: [(eff: Double, odo: Double)] = []
    private var hold: (odo: Double, ms: Double)?
    private var jam = false
    /// A tempó helyreállt, de a hátralévő úton még van heavy / severe: az ETA-korrekció marad.
    private var etaHold = false
    private var lastClear: (avgMps: Double, m: Double)?

    /// Új fix: `t` (ms), útvonal menti hely (m), pillanatnyi sebesség (m/s; `nil`: a haladásból).
    func update(_ t: Double, _ alongM: Double, _ speedMps: Double?, _ ctx: JamContext) -> JamChange? {
        let before = odo
        if let m = maxAlong { odo += max(0, alongM - m) }
        maxAlong = max(maxAlong ?? alongM, alongM)
        let dt = lastT.map { max(0, t - $0) } ?? 0
        let speed = speedMps ?? (dt > 0 ? (odo - before) * 1000 / dt : 0)
        lastT = t
        // lámpa-türelem: csak nem autópálya-jellegű úton, pontonként legfeljebb `lightPatienceMs`
        var counted = true
        if !ctx.highway && ctx.nearStopPoint && speed <= TRAFFIC.jamStoppedMps {
            if hold == nil || odo - hold!.odo > TRAFFIC.lightNearM { hold = (odo, 0) }
            hold!.ms += dt
            counted = hold!.ms > TRAFFIC.lightPatienceMs
        } else if let h = hold, odo - h.odo > TRAFFIC.lightNearM {
            hold = nil
        }
        if counted { eff += dt }
        hist.append((eff, odo))
        let keep = max(TRAFFIC.jamWindowMs, TRAFFIC.jamClearHighwayMs)
        while hist.count > 2 && hist[1].eff <= eff - keep { hist.removeFirst() }
        if !jam {
            if etaHold && !ctx.heavyAhead { etaHold = false }
            if let w = windowOf(TRAFFIC.jamWindowMs), w.startOdo >= TRAFFIC.jamStartMovedM, w.avgMps < TRAFFIC.jamSlowFraction * ctx.limitMps {
                jam = true
                etaHold = false
                return .enter
            }
            return nil
        }
        if let w = windowOf(ctx.highway ? TRAFFIC.jamClearHighwayMs : TRAFFIC.jamClearCityMs),
           w.m >= (ctx.highway ? TRAFFIC.jamClearHighwayM : TRAFFIC.jamClearCityM), w.avgMps >= TRAFFIC.jamClearFraction * ctx.limitMps {
            lastClear = (w.avgMps, w.m)
            jam = false
            etaHold = ctx.heavyAhead
            // a dugós ablak ne indítson azonnal újra
            hist = [(eff, odo)]
            return .exit
        }
        return nil
    }

    /// A legutóbbi `ms` érvényes idő átlaga és hossza; `nil`, ha még nincs ennyi adat.
    private func windowOf(_ ms: Double) -> (avgMps: Double, m: Double, startOdo: Double)? {
        guard let b = hist.last else { return nil }
        var a: (eff: Double, odo: Double)?
        for h in hist {
            if h.eff > b.eff - ms { break }
            a = h
        }
        guard let a, b.eff > a.eff else { return nil }
        let m = b.odo - a.odo
        return (m * 1000 / (b.eff - a.eff), m, a.odo)
    }

    /// Új útvonal: a hely mostantól az új útvonalon mérődik (a megtett út megmarad).
    func rebase() {
        maxAlong = nil
    }

    /// „Nem” válasz: a sofőr szerint nincs dugó, az állapot és az ablak törlődik.
    func dismiss() {
        jam = false
        etaHold = false
        hist = hist.last.map { [$0] } ?? []
    }

    var active: Bool { jam }

    /// A helyi ETA-korrekció él: dugóban, vagy amíg a hátralévő úton heavy / severe szakasz van.
    var correcting: Bool { jam || etaHold }

    /// Az utolsó ablak átlaga (m/s); egy mintánál `nil`.
    var avgMps: Double? {
        guard let a = hist.first, let b = hist.last, b.eff > a.eff else { return nil }
        return (b.odo - a.odo) * 1000 / (b.eff - a.eff)
    }

    /// A dugó végét jelző szakasz átlaga (m/s) – a „feloldva” közösségi mintához.
    var clearedAvgMps: Double? { lastClear?.avgMps }

    /// A dugó végét jelző szakasz hossza (m).
    var clearedM: Double { lastClear?.m ?? TRAFFIC.jamClearCityM }

    /// A megtett út (m) – a minta hosszához.
    var odometerM: Double { odo }
}

// MARK: a megengedett sebesség, útkategória, lámpák

/// Az útkategória országos alapértelmezése (km/h), ha a szakaszon nincs táblaadat (magyar értékek: a célpiac).
nonisolated enum DEFAULT_LIMIT_KMH {
    static let motorway = 130.0
    static let trunk = 110.0
    static let rural = 90.0
    static let city = 50.0
}

private nonisolated let highwayClasses: Set<String> = ["motorway", "motorway_link", "trunk", "trunk_link"]
private nonisolated let ruralClasses: Set<String> = ["primary", "primary_link", "secondary", "secondary_link"]

/// A lépés a hely alatt.
nonisolated func stepAt(_ route: NavRoute, _ alongM: Double) -> NavStep? {
    var found = route.steps.first
    for s in route.steps {
        if s.startM > alongM { break }
        found = s
    }
    return found
}

/// A nyers Directions-tempó (km/h) a szakaszon: útkategória nélkül ebből becsülünk.
private nonisolated func rawKmhAt(_ route: NavRoute, _ i: Int) -> Double {
    let b = i + 1 < route.segStartM.count ? route.segStartM[i + 1] : route.distanceM
    let d = i < route.segDurationS.count ? route.segDurationS[i] : 0
    return d > 0 ? (b - route.segStartM[i]) / d * 3.6 : 0
}

/// A megengedett sebesség (km/h) a helyen: a tábla (maxspeed), ennek hiányában az útkategória alapértelmezése.
nonisolated func permittedKmhAt(_ route: NavRoute, _ alongM: Double) -> Double {
    let i = segmentAt(route, alongM)
    if i < route.segLimitKmh.count, let sign = route.segLimitKmh[i] { return sign }
    if let cls = stepAt(route, alongM)?.roadClass {
        if cls == "motorway" || cls == "motorway_link" { return DEFAULT_LIMIT_KMH.motorway }
        if cls == "trunk" || cls == "trunk_link" { return DEFAULT_LIMIT_KMH.trunk }
        return ruralClasses.contains(cls) ? DEFAULT_LIMIT_KMH.rural : DEFAULT_LIMIT_KMH.city
    }
    let raw = rawKmhAt(route, i)
    return raw >= 90 ? DEFAULT_LIMIT_KMH.motorway : raw >= 60 ? DEFAULT_LIMIT_KMH.rural : DEFAULT_LIMIT_KMH.city
}

/// Autópálya-jellegű-e az út a helyen (autópálya, autóút; kategória nélkül a 100 km/h feletti tábla).
nonisolated func highwayAt(_ route: NavRoute, _ alongM: Double) -> Bool {
    if let cls = stepAt(route, alongM)?.roadClass { return highwayClasses.contains(cls) }
    return permittedKmhAt(route, alongM) >= 100
}

/// Jelzőlámpa, kereszteződés vagy kanyar `lightNearM`-en belül (a Directions-lépések kereszteződései és manőverei).
nonisolated func nearStopPoint(_ route: NavRoute, _ alongM: Double) -> Bool {
    route.stopPointsM.contains { abs($0 - alongM) <= TRAFFIC.lightNearM }
}

/// A hátralévő úton van-e heavy / severe szakasz.
nonisolated func heavyAhead(_ route: NavRoute, _ alongM: Double) -> Bool {
    route.segCongestion[min(route.segCongestion.count, segmentAt(route, alongM))...].contains { $0 == .heavy || $0 == .severe }
}

/// A dugó-többlet (s) a hátralévő úton – EGY számítás az útvonalválasztónak és a navigációnak (AW23). Heavy / severe szakasz
/// nélkül 0 (nincs felirat térképi szakasz nélkül). Különben a hátralévő idő a tipikus fölött (a lépések `duration_typical`-ja;
/// ha nincs, a dugós idő fele), legfeljebb a dugós szakaszok ideje és a hátralévő idő `delayMaxFraction`-ja.
nonisolated func routeDelayS(_ route: NavRoute, _ alongM: Double = 0) -> Double {
    let n = route.segDurationS.count
    guard n > 0 else { return 0 }
    let first = min(n - 1, segmentAt(route, alongM))
    var remS = 0.0
    var heavyS = 0.0
    for i in first..<n {
        let a = route.segStartM[i]
        let b = i + 1 < route.segStartM.count ? route.segStartM[i + 1] : route.distanceM
        let part = i == first && b > a ? max(0, min(1, (b - alongM) / (b - a))) : 1
        let d = route.segDurationS[i] * part
        remS += d
        if route.segCongestion[i] == .heavy || route.segCongestion[i] == .severe { heavyS += d }
    }
    if heavyS <= 0 { return 0 }
    var typicalS: Double? = 0
    for s in route.steps {
        let end = s.startM + s.distanceM
        if end <= alongM { continue }
        guard let tp = s.durationTypicalS else {
            typicalS = nil
            break
        }
        typicalS! += tp * (s.startM >= alongM || s.distanceM <= 0 ? 1 : (end - alongM) / s.distanceM)
    }
    if typicalS == nil, let tp = route.typicalDurationS { typicalS = tp * max(0, route.distanceM - alongM) / (route.distanceM != 0 ? route.distanceM : 1) }
    let excess = typicalS.map { max(0, remS - $0) } ?? heavyS / 2
    return jsRound(min(excess, heavyS, TRAFFIC.delayMaxFraction * remS))
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

// MARK: AW19-javítás 2: a dugós ETA horizontja

/// A mért dugó-átlag érvényességi szakasza az útvonalon (m); `linear`: nincs congestion-adat, a tempó átmegy a tervezettbe.
nonisolated struct JamRun: Equatable, Sendable {
    var startM: Double
    var endM: Double
    var linear: Bool
}

/// Az előttünk lévő dugós szakasz: a Directions congestion-annotációjában az első heavy / severe összefüggő szakasz, a
/// pozíciónktól legfeljebb `jamAheadMaxM`-ig. Congestion-adat nélkül (minden szakasz `unknown`) a következő `jamNoDataMaxM`.
/// `nil`: az annotáció szerint nincs dugó előttünk.
nonisolated func jamAheadRun(_ route: NavRoute, _ alongM: Double) -> JamRun? {
    let n = route.segCongestion.count
    func end(_ i: Int) -> Double { i + 1 < route.segStartM.count ? route.segStartM[i + 1] : route.distanceM }
    if !route.segCongestion.contains(where: { $0 != .unknown }) {
        let endM = min(route.distanceM, alongM + TRAFFIC.jamNoDataMaxM)
        return endM > alongM ? JamRun(startM: alongM, endM: endM, linear: true) : nil
    }
    func heavy(_ i: Int) -> Bool { route.segCongestion[i] == .heavy || route.segCongestion[i] == .severe }
    let limit = min(route.distanceM, alongM + TRAFFIC.jamAheadMaxM)
    var i = segmentAt(route, alongM)
    while i < n, !heavy(i), end(i) < limit { i += 1 }
    guard i < n, heavy(i) else { return nil }
    let startM = max(alongM, route.segStartM[i])
    var j = i
    while j + 1 < n, heavy(j + 1) { j += 1 }
    let endM = min(end(j), limit)
    return endM > startM ? JamRun(startM: startM, endM: endM, linear: false) : nil
}

/// A mért tempó (`avgMps`) miatti többletidő (s) a `run` szakaszon, a tervezett idő (`plannedS`) fölött: dugós szakaszon végig a
/// mért átlag; `linear` esetben a tempó a mértről lineárisan a tervezettre vált (a tempó-reciprok átlaga).
nonisolated func jamExtraS(_ run: JamRun, avgMps: Double, plannedS: Double) -> Double {
    let d = run.endM - run.startM
    let v = max(avgMps, TRAFFIC.jamMinKmh / 3.6)
    let slow = d / v
    return max(0, run.linear ? (slow - plannedS) / 2 : slow - plannedS)
}

// MARK: AW23 – a hátralévő út eseményei (timeline.ts)

nonisolated enum TimelineKind: String, Sendable {
    case section, camera, planned, jam, report
}

/// Egy esemény a hátralévő út sávján: `aheadM` a mostani helytől, `at` a sáv mentén (0 = itt, 1 = a cél).
nonisolated struct TimelineEvent: Equatable, Sendable {
    var kind: TimelineKind
    var aheadM: Double
    var at: Double
}

/// A hátralévő út eseményei a távval arányos helyen: szakaszellenőrzés, kamera, tervezett mérés (az `enforcement`-ből), dugó (a heavy /
/// severe szakaszok eleje), bejelentés (az útvonal sávjában lévők).
nonisolated func routeTimeline(_ route: NavRoute, _ alongM: Double, _ enforcement: [EnforcementItem], _ reports: [LatLon]) -> [TimelineEvent] {
    let rest = max(1, route.distanceM - alongM)
    var out: [TimelineEvent] = []
    func add(_ kind: TimelineKind, _ m: Double) {
        if m >= alongM && m <= route.distanceM { out.append(TimelineEvent(kind: kind, aheadM: m - alongM, at: (m - alongM) / rest)) }
    }
    for it in enforcement { add(TimelineKind(rawValue: it.kind.rawValue) ?? .section, it.startM) }
    func heavy(_ i: Int) -> Bool { route.segCongestion[i] == .heavy || route.segCongestion[i] == .severe }
    let first = segmentAt(route, alongM)
    if first < route.segCongestion.count {
        for i in first..<route.segCongestion.count where heavy(i) && (i == first || !heavy(i - 1)) {
            add(.jam, max(alongM, route.segStartM[i]))
        }
    }
    if !reports.isEmpty, let core = coreRoute(route) {
        for r in reports {
            let p = core.project(r)
            if p.crossM <= ROUTE_MATCH_M { add(.report, p.alongM) }
        }
    }
    return out.enumerated().sorted { $0.element.aheadM != $1.element.aheadM ? $0.element.aheadM < $1.element.aheadM : $0.offset < $1.offset }.map(\.element)
}

/// AW23: egy választható útvonal a navigáció közbeni panelen.
nonisolated struct AltChoice: Identifiable, Sendable {
    var route: NavRoute
    var summary: RouteSummary
    var current: Bool
    var id: String { route.id }
}

/// A panel alternatíva-állapota.
enum PanelAlts {
    case idle, loading, error
    case ok([AltChoice])
}
