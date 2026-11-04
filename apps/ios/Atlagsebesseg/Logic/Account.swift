import Foundation

// AW22: a packages/app-logic/src/account.ts portja (azonos nevű tesztekkel: AccountTests.swift ↔ account.test.ts). A valódi, nem kötelező fiók közös
// logikája: név, ajánlat, mezőnkénti szinkron (a legutóbb módosított nyer), a napló + saját hőtérkép felhős mentése. A Supabase-hívások a
// Backend/AccountBackend.swift-ben, a kötés az App/AppModel+Account.swift-ben.

nonisolated enum AccountProvider: String, Sendable {
    case apple, google, email
}

nonisolated struct AccountUser: Equatable, Sendable {
    var id: String
    var email: String?
    var isAnonymous: Bool
    var provider: AccountProvider?
    var givenName: String?
    var fullName: String?
}

nonisolated enum SyncStatus: String, Sendable {
    case idle, syncing, ok, error
}

/// A bejelentkezés-ajánlat ennyi időnként jöhet újra (legfeljebb egyszer).
nonisolated let NUDGE_INTERVAL_MS = 30 * 24 * 3600_000.0
nonisolated let NUDGE_KEY = "account:nudge:v1"
nonisolated let FIELDS_KEY = "account:fields:v1"
nonisolated let CLOUD_STATE_KEY = "account:cloud:v1"
nonisolated let DEVICE_KEY = "account:device:v1"
nonisolated let MERGE_KEY = "account:merge:v1"
nonisolated let SEEN_KEY = "account:seen:v1"
nonisolated let AUTH_REDIRECT_IOS = "atlagsebesseg://auth-callback"
/// A felhőbe mentett minták sűrűsége: a színezett útvonalhoz ennyi elég, a tárhely ötödére esik (a készüléken 1 Hz marad).
nonisolated let CLOUD_SAMPLE_STEP_S = 5.0
/// Egy feltöltési kör legfeljebb ennyi utat visz: a többi a következő körben (mobilnet, időkorlát).
nonisolated let CLOUD_TRIP_BATCH = 20

/// Egy befejezett út után, névtelenül, legfeljebb 30 naponta egyszer.
nonisolated func signinNudgeDue(_ lastShownMs: Double?, now: Double, isAnonymous: Bool) -> Bool {
    isAnonymous && (lastShownMs == nil || now - lastShownMs! >= NUDGE_INTERVAL_MS)
}

// MARK: felhasználó és név

nonisolated private func trimmed(_ s: String?) -> String? {
    let t = s?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return t.isEmpty ? nil : t
}

/// A szolgáltatótól kapott keresztnév: `given_name`, különben a teljes név első szava (átírható lépésben kínáljuk fel).
nonisolated func firstNameFromMeta(givenName: String?, claimsGivenName: String?, fullName: String?, name: String?) -> String? {
    if let g = trimmed(givenName) ?? trimmed(claimsGivenName) { return g }
    return (trimmed(fullName) ?? trimmed(name))?.split(whereSeparator: \.isWhitespace).first.map(String.init)
}

/// A Supabase-felhasználó az app alakjában. A név csak a szolgáltató adatából jön, e-mailes belépésnél nincs.
nonisolated func accountUser(id: String, email: String?, isAnonymous: Bool, identities: [String], givenName: String?, claimsGivenName: String?, fullName: String?, name: String?) -> AccountUser {
    let provider = [AccountProvider.apple, .google, .email].first { identities.contains($0.rawValue) } ?? (trimmed(email) != nil ? .email : nil)
    let social = provider == .apple || provider == .google
    return AccountUser(
        id: id, email: trimmed(email), isAnonymous: isAnonymous, provider: provider,
        givenName: social ? firstNameFromMeta(givenName: givenName, claimsGivenName: claimsGivenName, fullName: fullName, name: name) : nil,
        fullName: social ? (trimmed(fullName) ?? trimmed(name)) : nil
    )
}

nonisolated struct Profile: Codable, Equatable, Sendable {
    var megszolitas = ""
    var megszolitas_ms = 0.0
    var given_name: String?
    var full_name: String?
    var name_prompted = false
}

/// Az „Így szólítsunk?” lépés: csak ha még nincs Megszólítás (se helyben, se a profilban), és nem hagyták ki korábban.
nonisolated func nameStepNeeded(_ localName: String, _ profile: Profile?) -> Bool {
    normalizeName(localName).isEmpty && normalizeName(profile?.megszolitas ?? "").isEmpty && profile?.name_prompted != true
}

/// A lépés kitöltött értéke: az Apple/Google keresztneve; e-mailnél üres.
nonisolated func nameStepPrefill(_ user: AccountUser?, _ profile: Profile?) -> String {
    normalizeName(profile?.given_name ?? user?.givenName ?? "")
}

/// A kártya első sora: név, különben e-mail.
nonisolated func accountTitle(_ user: AccountUser, name: String) -> String {
    let n = normalizeName(name)
    return !n.isEmpty ? n : user.fullName ?? user.email ?? t(.accountTitle)
}

/// A szinkron állapotsora.
nonisolated func syncStatusText(_ status: SyncStatus, lastSyncMs: Double?, formatTime: (Double) -> String) -> String {
    switch status {
    case .syncing: return t(.accountSyncSyncing)
    case .error: return t(.accountSyncError)
    default: return lastSyncMs.map { t(.accountSyncAt, ["time": formatTime($0)]) } ?? t(.accountSyncWaiting)
    }
}

/// A bejelentkezési hiba felirata: a beépített levelező korlátja és a hibás cím külön üzenet, más hiba általános.
nonisolated func accountErrorKey(code: String?, message: String?, status: Int?) -> L10nKey {
    let c = code ?? ""
    let msg = (message ?? "").lowercased()
    if c == "over_email_send_rate_limit" || c == "over_request_rate_limit" || status == 429 { return .accountErrRate }
    if c == "email_address_not_authorized" || msg.contains("not authorized") { return .accountErrNotAllowed }
    if c == "email_address_invalid" || c == "validation_failed" || msg.contains("invalid") { return .accountErrEmail }
    return .accountErrGeneric
}

/// Elfogadható e-mail-cím (a részletes ellenőrzés a szerveré).
nonisolated func validEmail(_ s: String) -> Bool {
    s.trimmingCharacters(in: .whitespacesAndNewlines).range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
}

/// Már létező fiók jele linkeléskor.
nonisolated func isIdentityTaken(code: String?, message: String?) -> Bool {
    code == "identity_already_exists" || code == "email_exists" || (message ?? "").range(of: "already (been )?(linked|registered)", options: [.regularExpression, .caseInsensitive]) != nil
}

// MARK: mezőnkénti szinkron

/// A szinkron időbélyege: egész ezredmásodperc (a szerver oszlopa `bigint`, a tört érték elutasított kérést adna; a webes `Date.now()` párja).
nonisolated func accountNowMs(_ date: Date = Date()) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

/// Egy szinkronizált mező értéke (JSON). A szám mindig `Double`: a két platform azonos értéke így egyenlő.
nonisolated enum FieldValue: Codable, Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([FieldValue])
    case object([String: FieldValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([FieldValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: FieldValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case let .bool(v): try c.encode(v)
        case let .number(v): try c.encode(v)
        case let .string(v): try c.encode(v)
        case let .array(v): try c.encode(v)
        case let .object(v): try c.encode(v)
        }
    }

    var json: String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return (try? e.encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "null"
    }

    var stringValue: String? { if case let .string(v) = self { v } else { nil } }
    var numberValue: Double? { if case let .number(v) = self { v } else { nil } }
    var boolValue: Bool? { if case let .bool(v) = self { v } else { nil } }
}

nonisolated struct FieldRow: Codable, Equatable, Sendable {
    var key: String
    var value: FieldValue
    var updated_ms: Double

    init(key: String, value: FieldValue, updated_ms: Double) {
        self.key = key
        self.value = value
        self.updated_ms = updated_ms
    }

    // a `null` érték (törlési jelölő) is sor: hiányzó érték helyett `.null`
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        value = try c.decodeIfPresent(FieldValue.self, forKey: .value) ?? .null
        updated_ms = try c.decode(Double.self, forKey: .updated_ms)
    }
}

nonisolated struct FieldState: Codable, Equatable, Sendable {
    var values: [String: FieldValue] = [:]
    var times: [String: Double] = [:]

    static func parse(_ raw: String?) -> FieldState {
        guard let raw, let data = raw.data(using: .utf8), let s = try? JSONDecoder().decode(FieldState.self, from: data) else { return FieldState() }
        return s
    }

    var serialized: String { (try? JSONEncoder().encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "{}" }
}

/// A mentett hely / zóna törölhető mező: eltűnéskor törlési jelölő (`null`) megy tovább, különben a másik készülék visszahozná.
nonisolated private func isDynamicKey(_ k: String) -> Bool { k.hasPrefix("place.other.") || k.hasPrefix("zone.") }

nonisolated struct AccountData: Equatable, Sendable {
    var settings: Settings
    /// `auto` vagy a választott nyelv kódja.
    var lang: String
    var saved: SavedPlaces
    var recents: [Place]
}

nonisolated private func fieldValue(_ p: Place?) -> FieldValue {
    guard let p else { return .null }
    var o: [String: FieldValue] = ["id": .string(p.id), "name": .string(p.name), "address": .string(p.address), "lat": .number(p.lat), "lon": .number(p.lon)]
    if let r = p.routable { o["routable"] = .object(["lat": .number(r.lat), "lon": .number(r.lon)]) }
    return .object(o)
}

/// Az app adata mezőkre bontva. A Megszólítás külön mező (a szerveren a `profiles` sorban él). A beállítások közül az iOS a jelzésekét is adja: a webes
/// kliens ezeket nem ismeri, de nem bántja.
nonisolated func accountFieldsOf(_ d: AccountData) -> [String: FieldValue] {
    let s = d.settings
    var out: [String: FieldValue] = [
        "lang": .string(d.lang),
        "megszolitas": .string(normalizeName(s.megszolitas)),
        "recents": .array(d.recents.map { fieldValue($0) }),
        "place.home": fieldValue(d.saved.home),
        "place.work": fieldValue(d.saved.work),
        "settings.hatosagi_tures_megjelenitese": .bool(s.hatosagiTuresMegjelenitese),
        "settings.egyseg": .string(s.egyseg.rawValue),
        "settings.terkep": .string(s.terkep.rawValue),
        "settings.tervezett_meresek": .bool(s.tervezettMeresek),
        "settings.hangos_utasitasok": .bool(s.hangosUtasitasok),
        "settings.hoterkep": .string(s.hoterkep.rawValue),
        "settings.hoterkep_nezet": .string(s.hoterkepNezet.rawValue),
        "settings.adatmegosztas": .bool(s.adatmegosztas),
        "settings.felho_mentes": .bool(s.felhoMentes),
        "settings.kamera_jelzes": .bool(s.kameraJelzes),
        "settings.tervezett_jelzes": .bool(s.tervezettJelzes),
        "settings.jelzes_mod": .string(s.jelzesMod.rawValue),
    ]
    for p in d.saved.others { out["place.other.\(p.id)"] = fieldValue(p) }
    for (id, m) in s.zonaM { out["zone.\(id)"] = .number(Double(m)) }
    return out
}

/// Helyi változás: ami eltér a legutóbb ismert értéktől, `now` időt kap. Más platform mezőit nem bántja; a törölt helyből / zónából törlési jelölő lesz.
/// A további helyek sorrendje az időből jön, ezért az első felvételkor sorban kapnak időt.
nonisolated func noteLocalFields(_ prev: FieldState, _ current: [String: FieldValue], order others: [String] = [], now: Double) -> FieldState {
    var next = prev
    let empty = prev.values.isEmpty
    for (k, v) in current {
        if prev.values[k] == nil {
            next.times[k] = empty ? (others.firstIndex(of: k).map { Double($0 + 1) } ?? 0) : now
        } else if prev.values[k] != v {
            next.times[k] = now
        }
        next.values[k] = v
    }
    for (k, v) in prev.values where current[k] == nil && isDynamicKey(k) && v != .null {
        next.values[k] = .null
        next.times[k] = now
    }
    return next
}

/// A `noteLocalFields` sorrendje: a további helyek kulcsai a lista sorrendjében.
nonisolated func otherPlaceKeys(_ saved: SavedPlaces) -> [String] { saved.others.map { "place.other.\($0.id)" } }

/// Két úti cél-lista egyesítése (az újabb lista elöl, duplikátum és a 10 fölötti rész nélkül): a legutóbbi célokból semmi nem vész el összefésüléskor.
nonisolated func mergeRecents(_ newer: [Place], _ older: [Place]) -> [Place] {
    var out: [Place] = []
    for p in older.reversed() { out = addRecent(out, p) }
    for p in newer.reversed() { out = addRecent(out, p) }
    return out
}

/// Összefésülés a szerver soraival: mezőnként a nagyobb idő nyer, azonos időnél a szerveré (így minden készülék ugyanarra jut). A `recents` lista egyesül.
/// Az `upload` azok a mezők, amikben a szerver lemaradt.
nonisolated func mergeFields(_ local: FieldState, _ remote: [FieldRow]) -> (state: FieldState, upload: [FieldRow], changed: [String]) {
    var values = local.values
    var times = local.times
    var changed: [String] = []
    var upload: [FieldRow] = []
    var seen = Set<String>()
    for r in remote {
        seen.insert(r.key)
        let lt = local.times[r.key] ?? -1
        if r.key == "recents", let mine = local.values[r.key] {
            let remoteNewer = r.updated_ms >= lt
            let a = parseRecents((remoteNewer ? r.value : mine).json)
            let b = parseRecents((remoteNewer ? mine : r.value).json)
            let merged = FieldValue.array(mergeRecents(a, b).map { fieldValue($0) })
            var when = max(lt, r.updated_ms)
            if merged != mine { changed.append(r.key) }
            values[r.key] = merged
            if merged != r.value {
                when += 1
                upload.append(FieldRow(key: r.key, value: merged, updated_ms: when))
            }
            times[r.key] = when
            continue
        }
        if r.updated_ms >= lt {
            if values[r.key] != r.value { changed.append(r.key) }
            values[r.key] = r.value
            times[r.key] = r.updated_ms
        } else {
            upload.append(FieldRow(key: r.key, value: values[r.key] ?? .null, updated_ms: lt))
        }
    }
    for (k, v) in values where !seen.contains(k) {
        upload.append(FieldRow(key: k, value: v, updated_ms: times[k] ?? 0))
    }
    return (FieldState(values: values, times: times), upload, changed)
}

/// A mezőkből vissza az app adata; az ismeretlen vagy hibás érték az eddigit hagyja. A további helyek a felvétel sorrendjében.
nonisolated func applyFields(_ state: FieldState, base: AccountData) -> AccountData {
    let v = state.values
    var merged = (try? JSONSerialization.jsonObject(with: Data(base.settings.serialized().utf8))) as? [String: Any] ?? [:]
    for (k, val) in v where k.hasPrefix("settings.") {
        switch val {
        case let .bool(b): merged[String(k.dropFirst(9))] = b
        case let .string(s): merged[String(k.dropFirst(9))] = s
        default: break
        }
    }
    if let n = v["megszolitas"]?.stringValue { merged["megszolitas"] = n }
    var zones: [String: Int] = [:]
    for (k, m) in v where k.hasPrefix("zone.") {
        if let n = m.numberValue, ZONE_RADII.contains(Int(n)) { zones[String(k.dropFirst(5))] = Int(n) }
    }
    merged["zona_m"] = zones
    merged["adatmegosztas_v2"] = true
    let raw = (try? JSONSerialization.data(withJSONObject: merged)).map { String(decoding: $0, as: UTF8.self) }
    let others = v.keys
        .filter { $0.hasPrefix("place.other.") && v[$0] != .null }
        .sorted { (state.times[$0] ?? 0, $0) < (state.times[$1] ?? 0, $1) }
        .compactMap { v[$0] }
    let savedJson = FieldValue.object([
        "home": v["place.home"] ?? fieldValue(base.saved.home),
        "work": v["place.work"] ?? fieldValue(base.saved.work),
        "others": .array(others),
    ]).json
    return AccountData(
        settings: Settings.parse(raw),
        lang: v["lang"]?.stringValue ?? base.lang,
        saved: parseSaved(savedJson),
        recents: v["recents"].map { parseRecents($0.json) } ?? base.recents
    )
}

// MARK: napló + saját hőtérkép felhős mentése

nonisolated struct CloudTripListRow: Codable, Equatable, Sendable {
    var id: String
    var deleted: Bool
    var updated_ms: Double
}

nonisolated struct CloudState: Codable, Equatable, Sendable {
    /// Törölt utak, amik még nem jutottak el a szerverre (hálózat nélkül is megmarad).
    var pendingDeletes: [String] = []
    /// Visszaállított utak: a szerver törlési jelölőjét felülírják.
    var pendingRestores: [String] = []
    /// A hőtérkép törlése a többi készülék cellájára is vonatkozik.
    var pendingHeatClear = false
    /// A legutóbb feltöltött saját hőtérkép ujjlenyomata (csak változáskor megy újra).
    var heatHash = ""

    static func parse(_ raw: String?) -> CloudState {
        guard let raw, let data = raw.data(using: .utf8), let s = try? JSONDecoder().decode(CloudState.self, from: data) else { return CloudState() }
        return s
    }

    var serialized: String { (try? JSONEncoder().encode(self)).map { String(decoding: $0, as: UTF8.self) } ?? "{}" }
}

/// Mit kell tenni az utakkal. Lezárt út csak egyszer megy fel; a futó (`openId`) még nem. A helyi törlés megelőzi a szerver példányát.
nonisolated func planTripSync(_ localIds: [String], _ remote: [CloudTripListRow], _ state: CloudState, openId: String?) -> (upload: [String], download: [String], deleteLocal: [String], pushDeletes: [String]) {
    let local = Set(localIds)
    let byId = Dictionary(remote.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let restores = Set(state.pendingRestores)
    let pending = Set(state.pendingDeletes)
    let upload = localIds.filter { id in
        guard id != openId, !pending.contains(id) else { return false }
        guard let r = byId[id] else { return true }
        return r.deleted && restores.contains(id)
    }
    let download = remote.filter { !$0.deleted && !local.contains($0.id) && !pending.contains($0.id) }.map(\.id)
    let deleteLocal = remote.filter { $0.deleted && local.contains($0.id) && !restores.contains($0.id) && !pending.contains($0.id) }.map(\.id)
    return (upload, download, deleteLocal, state.pendingDeletes)
}

/// Cloud-minta: `[t, lat, lon, km/h, irány, pontosság, limit]`, `CLOUD_SAMPLE_STEP_S` másodpercenként.
nonisolated func compactSamples(_ samples: [TripSample], stepS: Double = CLOUD_SAMPLE_STEP_S) -> [[Double?]] {
    var out: [[Double?]] = []
    var last = -Double.infinity
    for (i, s) in samples.enumerated() {
        if s.t - last < stepS * 1000 && i != samples.count - 1 { continue }
        last = s.t
        out.append([s.t, s.lat, s.lon, s.speedKmh, s.heading, s.accuracy, s.limitKmh])
    }
    return out
}

/// Vissza a napló alakjára. A letöltött út a hőtérképbe nem olvad be újra (a cellái a másik készülék sorában jönnek), a H3 ezért üres.
nonisolated func expandSamples(_ tripId: String, _ rows: [[Double?]]) -> [TripSample] {
    rows.compactMap { r in
        guard r.count >= 7, let t = r[0], let lat = r[1], let lon = r[2] else { return nil }
        return TripSample(tripId: tripId, t: t, lat: lat, lon: lon, speedKmh: r[3], heading: r[4], accuracy: r[5], h3: nil, limitKmh: r[6])
    }
}

/// Cloud-cella: `[h3, darab, átlag, utolsó idő]`.
nonisolated func heatBlob(_ cells: [HeatCell]) -> [FieldValue] {
    cells.map { .array([.string($0.h3), .number(Double($0.count)), .number($0.avgKmh), .number($0.lastT)]) }
}

nonisolated func parseHeatBlob(_ rows: [FieldValue]) -> [HeatCell] {
    rows.compactMap { r in
        guard case let .array(a) = r, a.count == 4, let h3 = a[0].stringValue, let n = a[1].numberValue, let avg = a[2].numberValue, let last = a[3].numberValue else { return nil }
        return HeatCell(h3: h3, count: Int(n), avgKmh: avg, lastT: last)
    }
}

/// A saját hőtérkép ujjlenyomata: új áthaladás mindig változtat rajta.
nonisolated func heatHash(_ cells: [HeatCell]) -> String {
    var sum = 0
    var last = 0.0
    for c in cells {
        sum += c.count
        last = max(last, c.lastT)
    }
    return "\(cells.count):\(sum):\(String(format: "%.0f", last))"
}

/// A saját és a többi készülék cellái együtt: minden készülék a saját számlálóját írja, ezért az összeg nem duplázódik.
nonisolated func mergeRemoteHeat(_ own: [HeatCell], _ remote: [[HeatCell]]) -> [HeatCell] {
    var map = Dictionary(own.map { ($0.h3, $0) }, uniquingKeysWith: { a, _ in a })
    for list in remote {
        for c in list { map[c.h3] = mergeHeatCells(c, map[c.h3]) }
    }
    return Array(map.values)
}

nonisolated struct CloudHeatRow: Codable, Equatable, Sendable {
    var device_id: String
    var cells: [FieldValue]
    var updated_ms: Double
}

/// A felhő-szinkron távoli oldala (a Supabase vagy a teszt hamis szervere).
nonisolated protocol AccountRemote: Sendable {
    func pullFields() async throws -> [FieldRow]
    func pushFields(_ rows: [FieldRow]) async throws
    func pullProfile() async throws -> Profile?
    func pushProfile(megszolitas: String?, megszolitasMs: Double?, givenName: String?, fullName: String?, namePrompted: Bool?) async throws
    func listTrips() async throws -> [CloudTripListRow]
    func getTrip(_ id: String) async throws -> (record: Trip?, samples: [[Double?]])?
    func putTrip(_ trip: Trip, samples: [[Double?]], updatedMs: Double) async throws
    func markTripsDeleted(_ ids: [String], updatedMs: Double) async throws
    func listHeat() async throws -> [CloudHeatRow]
    func putHeat(_ deviceId: String, cells: [FieldValue], updatedMs: Double) async throws
    func clearHeat() async throws
}

/// A felhő-szinkron helyi oldala (`TripStore`).
protocol BackupStore: AnyObject {
    func backupTrips() -> [Trip]
    func backupSamples(_ tripId: String) -> [TripSample]
    /// A letöltött út a naplóba, a hőtérkép beolvasztása nélkül.
    func saveDownloaded(_ trip: Trip, samples: [TripSample])
    func deleteDownloaded(_ id: String)
    func ownHeatCells() -> [HeatCell]
    func setRemoteHeat(_ lists: [[HeatCell]])
}

/// Egy mező-szinkron kör: letöltés, összefésülés, feltöltés. Az új állapotot adja, és mely mezők változtak a másik készülék miatt.
func syncFieldsOnce(_ remote: AccountRemote, _ local: FieldState) async throws -> (state: FieldState, changed: [String], profile: Profile?) {
    let profile = try await remote.pullProfile()
    var rows = try await remote.pullFields()
    // a Megszólítás a profilban él: mezőként fésüljük, de oda írjuk vissza; soha be nem állított profil-név nem számít
    if let p = profile, !p.megszolitas.isEmpty || p.megszolitas_ms > 0 {
        rows.append(FieldRow(key: "megszolitas", value: .string(p.megszolitas), updated_ms: p.megszolitas_ms))
    }
    let r = mergeFields(local, rows)
    if let name = r.upload.first(where: { $0.key == "megszolitas" }) {
        try await remote.pushProfile(megszolitas: name.value.stringValue ?? "", megszolitasMs: name.updated_ms, givenName: nil, fullName: nil, namePrompted: nil)
    }
    let rest = r.upload.filter { $0.key != "megszolitas" }
    if !rest.isEmpty { try await remote.pushFields(rest) }
    return (r.state, r.changed, profile)
}

/// Egy felhős mentési kör (a kapcsoló bekapcsolva): a függő törlések, a hiányzó utak fel, a másik készülék útjai le, a szerveren töröltek helyben is. A
/// saját hőtérkép készülékenként külön sor: csak változáskor megy fel, a többi készüléké a helyi tárba kerül.
func syncBackupOnce(_ remote: AccountRemote, _ store: BackupStore, _ cloud: CloudState, deviceId: String, openTripId: String?, now: Double) async throws -> (state: CloudState, up: Int, down: Int, deleted: Int, heatChanged: Bool) {
    var state = cloud
    let trips = store.backupTrips()
    let plan = planTripSync(trips.map(\.id), try await remote.listTrips(), state, openId: openTripId)
    if !plan.pushDeletes.isEmpty {
        try await remote.markTripsDeleted(plan.pushDeletes, updatedMs: now)
        state.pendingDeletes = []
    }
    let upload = Array(plan.upload.prefix(CLOUD_TRIP_BATCH))
    for id in upload {
        guard let trip = trips.first(where: { $0.id == id }) else { continue }
        try await remote.putTrip(trip, samples: compactSamples(store.backupSamples(id)), updatedMs: now)
    }
    state.pendingRestores.removeAll { upload.contains($0) }
    let download = Array(plan.download.prefix(CLOUD_TRIP_BATCH))
    for id in download {
        if let row = try await remote.getTrip(id), let trip = row.record {
            store.saveDownloaded(trip, samples: expandSamples(id, row.samples))
        }
    }
    for id in plan.deleteLocal { store.deleteDownloaded(id) }

    var heatChanged = false
    if state.pendingHeatClear {
        try await remote.clearHeat()
        store.setRemoteHeat([])
        state.pendingHeatClear = false
        state.heatHash = ""
        heatChanged = true
    }
    let cells = store.ownHeatCells()
    let hash = heatHash(cells)
    if hash != state.heatHash {
        try await remote.putHeat(deviceId, cells: heatBlob(cells), updatedMs: now)
        state.heatHash = hash
    }
    let others = try await remote.listHeat().filter { $0.device_id != deviceId }
    store.setRemoteHeat(others.map { parseHeatBlob($0.cells) })
    if !others.isEmpty { heatChanged = true }
    return (state, upload.count, download.count, plan.deleteLocal.count, heatChanged)
}
