import AtlagsebessegCore
import Foundation

// AOS14: a packages/app-logic/src/reports.ts, reportFeed.ts és reportPrompt.ts portja (bejelentés, a térkép bejelentései,
// közeledő bejelentés: figyelmeztetés → „Még ott van?”, egy kapu-tétel a menüben). A Supabase-hívások a Backend.swift-ben, a kötés az AppModel+Reports.swift-ben.

/// A `public.report_type` enum értékei (supabase/migrations).
nonisolated enum ReportType: String, Codable, Sendable {
    case traffipax, rendorseg, baleset, akadaly, utlezaras
    case szakaszHiba = "szakasz_hiba"
    /// AW18: dugó (lassan halad) és beállt (áll) – a navigáció „Dugóba kerültél?” kártyája is `dugo`-t küld.
    case dugo, beallt
    case ideiglenesKapu = "ideiglenes_kapu"
}

/// A bejelentés-lap választható elemei (a webes `ReportChoice`); a sorrend a lapé (`REPORT_CHOICES`). AW16: az „Átlagmérés
/// eleje / vége” (`kapu_kezdo` / `kapu_zaro`) egy-egy ideiglenes kapu a jelenlegi helyről, irány nélkül nem küldhető.
nonisolated enum ReportChoice: String, CaseIterable, Sendable, Identifiable {
    case rendorseg, traffipax, baleset, akadaly, utlezaras
    case szakaszHiba = "szakasz_hiba"
    case dugo, beallt
    case kapuKezdo = "kapu_kezdo"
    case kapuZaro = "kapu_zaro"

    var id: String { rawValue }
    var isGate: Bool { self == .kapuKezdo || self == .kapuZaro }
    /// AW18: a menü utolsó sorának kis csempéi (egy sorban, a kapu-tétel mellett).
    var isRowTile: Bool { self == .dugo || self == .beallt }
    /// AW18: a dugó-típusok (a közösségi dugó-mintát is küldik).
    var isJamReport: Bool { self == .dugo || self == .beallt }

    var label: String {
        switch self {
        case .rendorseg: t(.reportTypeRendorseg)
        case .traffipax: t(.reportTypeTraffipax)
        case .baleset: t(.reportTypeBaleset)
        case .akadaly: t(.reportTypeAkadaly)
        case .utlezaras: t(.reportTypeUtlezaras)
        case .szakaszHiba: t(.reportTypeSzakaszHiba)
        case .dugo: t(.reportTypeDugo)
        case .beallt: t(.reportTypeBeallt)
        case .kapuKezdo: t(.reportTypeKapuKezdo)
        case .kapuZaro: t(.reportTypeKapuZaro)
        }
    }

    /// Ikon (a webes `Icon` neve) és tónus – a bejelentés-lapon és a térképen azonos (`REPORT_TONE`).
    var icon: IconName {
        switch self {
        case .rendorseg: .rendorseg
        case .traffipax: .traffipax
        case .baleset: .baleset
        case .akadaly: .akadaly
        case .utlezaras: .utlezaras
        case .szakaszHiba: .szakasz_hiba
        case .dugo: .dugo
        case .beallt: .beallt
        case .kapuKezdo: .kapu_kezdo
        case .kapuZaro: .kapu_zaro
        }
    }

    var tone: ReportTone {
        switch self {
        case .rendorseg, .kapuKezdo, .kapuZaro: .kezi
        case .traffipax, .akadaly, .dugo: .hataron
        case .baleset, .utlezaras, .beallt: .tul
        case .szakaszHiba: .semleges
        }
    }
}

/// A webes `data-tone` a bejelentéseknél (`REPORT_TONE`).
nonisolated enum ReportTone: String, Sendable {
    case kezi, hataron, tul, semleges
}

/// A `reports` táblába írt sor (a `user_id`-t a szerver adja). A kapu-mezők csak ideiglenes kapunál kerülnek a JSON-ba.
nonisolated struct ReportInsert: Encodable, Equatable, Sendable {
    var type: ReportType
    var gateKind: String?
    var lat: Double
    var lon: Double
    var headingDeg: Double?

    enum CodingKeys: String, CodingKey {
        case type, lat, lon
        case gateKind = "gate_kind"
        case headingDeg = "heading_deg"
        case road
        case speedLimitKmh = "speed_limit_kmh"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(lat, forKey: .lat)
        try c.encode(lon, forKey: .lon)
        try c.encode(headingDeg, forKey: .headingDeg)
        if type == .ideiglenesKapu {
            try c.encode(gateKind, forKey: .gateKind)
            try c.encodeNil(forKey: .road)
            try c.encodeNil(forKey: .speedLimitKmh)
        }
    }
}

nonisolated private func normalizedHeading(_ h: Double?) -> Double? {
    guard let h else { return nil }
    let r = Int(jsRound(h)) % 360
    return Double((r + 360) % 360)
}

/// Egy koppintásos bejelentés a jelenlegi helyről (a webes `reportFromFix`). Kapunál irány kell – ha nincs, `nil`.
nonisolated func reportFromFix(_ choice: ReportChoice, _ fix: GpsFix) -> ReportInsert? {
    let h = normalizedHeading(fix.heading)
    switch choice {
    case .kapuKezdo, .kapuZaro:
        guard let h else { return nil }
        return ReportInsert(type: .ideiglenesKapu, gateKind: choice == .kapuKezdo ? "kezdo" : "zaro", lat: fix.lat, lon: fix.lon, headingDeg: h)
    default:
        return ReportInsert(type: ReportType(rawValue: choice.rawValue)!, lat: fix.lat, lon: fix.lon, headingDeg: h)
    }
}

/// Egy le nem járt bejelentés a térképen (a webes `ActiveReport`).
nonisolated struct ActiveReport: Identifiable, Equatable, Sendable {
    var id: String
    var type: ReportType
    var gateKind: String?
    var lat: Double
    var lon: Double
    var headingDeg: Double?
    var createdAt: Double
    var expiresAt: Double
    var confirmations = 0
    var denials = 0
    /// A saját bejelentés (erre nem lehet szavazni – RLS).
    var own = false

    /// A bejelentés-lap eleme, amelyhez tartozik (ikon, tónus, felirat).
    var choice: ReportChoice {
        if type == .ideiglenesKapu { return gateKind == "zaro" ? .kapuZaro : .kapuKezdo }
        return ReportChoice(rawValue: type.rawValue) ?? .akadaly
    }
}

/// Az `active_reports` nézet sora.
nonisolated struct ReportRow: Decodable, Sendable {
    var id: String
    var type: String
    var lat: Double
    var lon: Double
    var heading_deg: Double?
    var gate_kind: String?
    var confirmations: Int
    var denials: Int
    var created_at: String
    var expires_at: String
    var user_id: String?

    private static func parseDate(_ s: String) -> Double {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d.timeIntervalSince1970 * 1000 }
        f.formatOptions = [.withInternetDateTime]
        return (f.date(from: s)?.timeIntervalSince1970 ?? 0) * 1000
    }

    func active(myUserId: String?) -> ActiveReport? {
        guard let t = ReportType(rawValue: type) else { return nil }
        return ActiveReport(
            id: id, type: t, gateKind: gate_kind, lat: lat, lon: lon, headingDeg: heading_deg,
            createdAt: Self.parseDate(created_at), expiresAt: Self.parseDate(expires_at),
            confirmations: confirmations, denials: denials,
            own: myUserId != nil && user_id?.lowercased() == myUserId?.lowercased()
        )
    }
}

/// Frissítés ennyi időnként, akkor is, ha a nézet nem mozdult (ms).
nonisolated let REPORT_REFRESH_MS = 60_000.0
/// A szerver alapértelmezett élettartama (`reports.expires_at`) – a saját, még le nem kért soroknál (ms).
nonisolated let REPORT_TTL_MS = 2 * 3600_000.0
/// Ennél nagyobb (kizoomolt) nézetnél a középpont körüli 3 × 3 csempe.
nonisolated let MAX_REPORT_TILE_SPAN = 3

/// A frissen elküldött saját bejelentés, amíg a szerver-lista még nem tartalmazza.
nonisolated func ownReport(_ row: ReportInsert, id: String, now: Double) -> ActiveReport {
    ActiveReport(
        id: id, type: row.type, gateKind: row.type == .ideiglenesKapu ? row.gateKind : nil, lat: row.lat, lon: row.lon,
        headingDeg: row.headingDeg, createdAt: now, expiresAt: now + REPORT_TTL_MS, own: true
    )
}

nonisolated struct ReportQuery: Equatable, Sendable {
    /// Csempe-rácsra kerekített téglalap kulcsa: ha nem változik, nincs új lekérés (csak 60 s-enként).
    var key: String
    var bbox: BBox
}

nonisolated private func tileRange(_ y0: Int, _ x0: Int, _ y1: Int, _ x1: Int) -> ReportQuery {
    let a = tileBBox("\(y0):\(x0)")
    let b = tileBBox("\(y1):\(x1)")
    return ReportQuery(key: "\(y0):\(x0):\(y1):\(x1)", bbox: BBox(south: a.south, west: a.west, north: b.north, east: b.east))
}

/// A lekérés téglalapja (a webes `reportQuery`): a látható terület a csempe-rácsra kifelé kerekítve (kizoomolva legfeljebb
/// 3 × 3 csempe a nézet közepén); térkép-nézet nélkül a pont körüli 3 × 3 csempe.
nonisolated func reportQuery(_ view: BBox?, center: LatLon?) -> ReportQuery? {
    func around(_ lat: Double, _ lon: Double) -> ReportQuery {
        let tiles = tilesAround(lat, lon).map { $0.split(separator: ":").compactMap { Int($0) } }
        return tileRange(tiles.first![0], tiles.first![1], tiles.last![0], tiles.last![1])
    }
    if let v = view {
        let y0 = Int((v.south / TILE_DEG).rounded(.down))
        let y1 = Int((v.north / TILE_DEG).rounded(.down))
        let x0 = Int((v.west / TILE_DEG).rounded(.down))
        let x1 = Int((v.east / TILE_DEG).rounded(.down))
        if y1 - y0 < MAX_REPORT_TILE_SPAN && x1 - x0 < MAX_REPORT_TILE_SPAN { return tileRange(y0, x0, y1, x1) }
        return around((v.south + v.north) / 2, (v.west + v.east) / 2)
    }
    return center.map { around($0.lat, $0.lon) }
}

/// A térképen látható bejelentések (a webes `ReportFeed`): a szerver legutóbbi listája + a saját, még le nem kért
/// bejelentések + a saját szavazatok. Lekérés nézetváltáskor (új csempe-téglalap) vagy 60 s-enként; a késve érkező,
/// elavult kérés eredményét eldobja. A lejártak a lekérések között is eltűnnek.
@MainActor
final class ReportFeed {
    typealias Fetch = (BBox) async throws -> [ActiveReport]

    private let fetch: Fetch
    private let now: () -> Double
    private let refreshMs: Double
    private var server: [ActiveReport] = []
    private var local: [String: ActiveReport] = [:]
    private var votes: [String: Bool] = [:]
    private var key: String?
    private var fetchedAt = -Double.infinity
    private var seq = 0
    private var inFlight: String?

    init(fetch: @escaping Fetch, now: @escaping () -> Double, refreshMs: Double = REPORT_REFRESH_MS) {
        self.fetch = fetch
        self.now = now
        self.refreshMs = refreshMs
    }

    /// Kell-e lekérni: új téglalap, vagy lejárt a frissítési idő (és nem fut már ugyanerre kérés).
    func shouldFetch(_ q: ReportQuery) -> Bool {
        if inFlight == q.key { return false }
        return q.key != key || now() - fetchedAt >= refreshMs
    }

    /// Lekér, ha kell; igaz, ha a lista változott. Hálózati hibánál a régi lista marad.
    func refresh(_ q: ReportQuery) async -> Bool {
        guard shouldFetch(q) else { return false }
        seq += 1
        let mySeq = seq
        inFlight = q.key
        defer { if mySeq == seq { inFlight = nil } }
        do {
            let rows = try await fetch(q.bbox)
            guard mySeq == seq else { return false }
            server = rows
            key = q.key
            fetchedAt = now()
            for r in rows { local[r.id] = nil }
            return true
        } catch {
            if mySeq == seq {
                // a következő próbálkozás a frissítési idő után (nem minden kamera-mozdulatnál)
                key = q.key
                fetchedAt = now()
            }
            return false
        }
    }

    /// A saját bejelentés azonnal látszik (a következő lekérésig helyben).
    func addOwn(_ r: ActiveReport) {
        var own = r
        own.own = true
        local[r.id] = own
    }

    /// Saját szavazat (megerősítés / nincs ott) – a kártya ebből tudja, hogy már szavaztunk.
    func vote(_ id: String, _ confirm: Bool) { votes[id] = confirm }

    func myVote(_ id: String) -> Bool? { votes[id] }

    /// A most látható (le nem járt) bejelentések.
    func list() -> [ActiveReport] {
        let t = now()
        var out = server
        let ids = Set(server.map(\.id))
        out += local.values.filter { !ids.contains($0.id) }.sorted { $0.createdAt < $1.createdAt }
        return out.filter { $0.expiresAt > t }
    }
}

// MARK: közeledő bejelentés – figyelmeztetés → „Még ott van?” (AOS14)

nonisolated enum ReportPromptPhase: String, Sendable {
    case approach, ask
}

/// A kártya állapota (a webes `ReportPrompt`): melyik bejelentés, figyelmeztet vagy kérdez, és milyen messze van.
nonisolated struct ReportPrompt: Equatable, Sendable {
    var id: String
    var phase: ReportPromptPhase
    var distanceM: Double
}

/// A figyelmeztetés távolsága a sebességből (m/s), mint a közeli kameránál (a webes `reportAlertM`).
nonisolated func reportAlertM(_ speedMps: Double?) -> Double {
    max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS * max(0, speedMps ?? 0))
}

nonisolated private func promptGeometry(_ fix: GpsFix, _ r: ActiveReport) -> (d: Double, ahead: Bool, behind: Bool) {
    let p = LatLon(lat: r.lat, lon: r.lon)
    let d = haversineM(fix, p)
    let diff = fix.heading.map { angleDiffDeg($0, bearingDeg(fix, p)) }
    return (d, diff.map { $0 <= REPORT_PROMPT.coneDeg } ?? false, diff.map { $0 > 90 } ?? false)
}

/// Ennyire meg kellett közelíteni, hogy a „mögöttünk van” elhaladásnak számítson (hajtűkanyarban a légvonal megtéveszt).
nonisolated let REPORT_PASSED_NEAR_M = 100.0

/// Elhaladtunk mellette (már a közelében voltunk, és most mögöttünk van), vagy messzire kerültünk (letértünk). Kanyarban a
/// bejelentés kicsúszhat a ±`coneDeg` kúpból, hajtűkanyarban átmenetileg mögénk is kerülhet – az még nem elhaladás.
nonisolated private func promptGone(_ g: (d: Double, ahead: Bool, behind: Bool), minD: Double, alertM: Double) -> Bool {
    (g.behind && minD <= REPORT_PASSED_NEAR_M && g.d > REPORT_PROMPT.nearM) || g.d > 2 * alertM
}

/// A legközelebbi bejelentés, amelyre most figyelmeztetni kell (a webes `reportPromptCandidate`; `skip`: már volt /
/// szavaztunk rá): előttünk (±`coneDeg`) a kamerával azonos távolságon belül, irány nélkül csak `nearM`-en belül.
nonisolated func reportPromptCandidate(_ fix: GpsFix, _ reports: [ActiveReport], skip: (String) -> Bool) -> ActiveReport? {
    let alertM = reportAlertM(fix.speed)
    var best: ActiveReport?
    var bestM = Double.infinity
    for r in reports where !r.own && !skip(r.id) {
        let g = promptGeometry(fix, r)
        guard g.d <= REPORT_PROMPT.nearM || (g.ahead && g.d <= alertM) else { continue }
        if g.d < bestM {
            best = r
            bestM = g.d
        }
    }
    return best
}

/// EGY kártya a kamera-figyelmeztetés helyén (a webes `ReportPromptWatch`): figyelmeztetés → kérdés (`nearM`-rel a bejelentés
/// előtt, helyben) → elhaladás után `showMs` → vége; válaszra (vagy ha a bejelentés eltűnt, vagy messzire kerültünk) azonnal.
/// Kérdés nélküli elhaladás (a bejelentés `nearM`-nél messzebb maradt): rögtön vége. Egy bejelentés egyszer kerül sorra.
nonisolated final class ReportPromptWatch {
    private var done = Set<String>()
    private var cur: (id: String, asking: Bool, passedAt: Double?, minD: Double)?

    func update(_ fix: GpsFix?, _ reports: [ActiveReport], voted: (String) -> Bool, now: Double) -> ReportPrompt? {
        if var c = cur {
            let r = reports.first { $0.id == c.id }
            let g = r.flatMap { r in fix.map { promptGeometry($0, r) } }
            if let g {
                c.minD = min(c.minD, g.d)
                if !c.asking, g.d <= REPORT_PROMPT.nearM { c.asking = true }
                // a kérdés alatt az elhaladás (mögöttünk van) indítja a `showMs`-t
                if c.asking, c.passedAt == nil, g.behind { c.passedAt = now }
            }
            cur = c
            let alertM = reportAlertM(fix?.speed)
            let far = g.map { $0.d > 2 * alertM } ?? false
            let ended = c.asking
                ? c.passedAt.map { now - $0 >= REPORT_PROMPT.showMs } ?? false
                : g.map { promptGone($0, minD: c.minD, alertM: alertM) } ?? false
            if r != nil, !voted(c.id), !far, !ended {
                return ReportPrompt(id: c.id, phase: c.asking ? .ask : .approach, distanceM: g?.d ?? .nan)
            }
            finish()
        }
        guard let fix, let r = reportPromptCandidate(fix, reports, skip: { done.contains($0) || voted($0) }) else { return nil }
        let g = promptGeometry(fix, r)
        let asking = g.d <= REPORT_PROMPT.nearM
        cur = (r.id, asking, nil, g.d)
        return ReportPrompt(id: r.id, phase: asking ? .ask : .approach, distanceM: g.d)
    }

    /// Válasz (Igen / Nem) vagy ×: a kártya azonnal eltűnik, erre a bejelentésre nem tér vissza.
    func close() { finish() }

    var current: String? { cur?.id }

    func reset() {
        done = []
        cur = nil
    }

    private func finish() {
        if let c = cur { done.insert(c.id) }
        cur = nil
    }
}

// MARK: egy kapu-tétel (AOS14 javítás)

/// A bejelentés-lap tételei (a webes `reportMenu`): az „Átlagmérés eleje” és „vége” EGY tétel a végén – elküldött „eleje”
/// után „vége”, amíg el nem küldik, vagy a mérés / navigáció véget nem ér. AW18: az utolsó sorban a „Dugó” és a „Beállt” a
/// kapu-tétel mellett (a menü magassága nem nő), lásd `isRowTile`.
nonisolated func reportMenu(gateStarted: Bool) -> [ReportChoice] {
    ReportChoice.allCases.filter { !$0.isGate } + [gateStarted ? .kapuZaro : .kapuKezdo]
}

/// Az „eleje elküldve” állapot változása (a webes `gateStartedAfter`).
nonisolated enum GateEvent: Sendable {
    case sent(ReportChoice)
    case activityEnded
}

nonisolated func gateStartedAfter(_ started: Bool, _ event: GateEvent) -> Bool {
    switch event {
    case .activityEnded: false
    case .sent(.kapuKezdo): true
    case .sent(.kapuZaro): false
    case .sent: started
    }
}

/// „most” / „12 perce” / „2 órája” (a webes `timeAgo`).
nonisolated func timeAgo(_ ms: Double) -> String {
    let min = Int((max(0, ms) / 60_000).rounded(.down))
    if min < 1 { return t(.timeNow) }
    if min < 60 { return t(.timeMinutes, ["n": String(min)]) }
    return t(.timeHours, ["n": String(min / 60)])
}
