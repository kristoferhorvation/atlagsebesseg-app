import Foundation
import Testing
@testable import Atlagsebesseg

// AW22: a packages/app-logic/test/account.test.ts párja (azonos nevekkel).

private func place(_ id: String, _ lat: Double = 47.5, _ lon: Double = 19) -> Place { Place(id: id, name: id, address: "", lat: lat, lon: lon) }
private func data(settings: Settings = Settings(), saved: SavedPlaces = .none, recents: [Place] = []) -> AccountData {
    AccountData(settings: settings, lang: "auto", saved: saved, recents: recents)
}
private func fields(_ d: AccountData) -> [String: FieldValue] { accountFieldsOf(d) }
private func cell(_ h3: String, _ count: Int, _ avg: Double = 50, _ last: Double = 10) -> HeatCell { HeatCell(h3: h3, count: count, avgKmh: avg, lastT: last) }
private func trip(_ id: String) -> Trip {
    Trip(id: id, startedAt: 1000, endedAt: 2000, distanceM: 500, movingS: 60, idleS: 0, maxKmh: 50, turns: TripTurns(), dirChanges: TripTurns(), reroutes: 0, measurements: [], jamS: 0, destination: nil, path: [], samples: 0)
}

/// Hamis szerver: ugyanaz a mezőnkénti szabály, mint a `account_fields` triggeré; két készülék osztozik rajta.
private final class FakeServer: AccountRemote, @unchecked Sendable {
    var fields: [String: FieldRow] = [:]
    var trips: [String: (record: Trip?, samples: [[Double?]], deleted: Bool, updated: Double)] = [:]
    var heat: [String: CloudHeatRow] = [:]
    var tracks: [String: TripTrack] = [:]
    var profile: Profile?

    func pullFields() async throws -> [FieldRow] { Array(fields.values) }
    func pushFields(_ rows: [FieldRow]) async throws {
        for r in rows where fields[r.key] == nil || r.updated_ms > fields[r.key]!.updated_ms { fields[r.key] = r }
    }
    func pullProfile() async throws -> Profile? { profile }
    func pushProfile(megszolitas: String?, megszolitasMs: Double?, givenName: String?, fullName: String?, namePrompted: Bool?) async throws {
        var p = profile ?? Profile()
        if let megszolitas, (megszolitasMs ?? .infinity) >= p.megszolitas_ms {
            p.megszolitas = megszolitas
            p.megszolitas_ms = megszolitasMs ?? p.megszolitas_ms
        }
        p.given_name = givenName ?? p.given_name
        p.full_name = fullName ?? p.full_name
        p.name_prompted = namePrompted ?? p.name_prompted
        profile = p
    }
    func listTrips() async throws -> [CloudTripListRow] { trips.map { CloudTripListRow(id: $0.key, deleted: $0.value.deleted, updated_ms: $0.value.updated) } }
    func getTrip(_ id: String) async throws -> (record: Trip?, samples: [[Double?]])? { trips[id].map { ($0.record, $0.samples) } }
    func putTrip(_ trip: Trip, samples: [[Double?]], updatedMs: Double) async throws { trips[trip.id] = (trip, samples, false, updatedMs) }
    func markTripsDeleted(_ ids: [String], updatedMs: Double) async throws { for id in ids { trips[id] = (nil, [], true, updatedMs) } }
    func listHeat() async throws -> [CloudHeatRow] { Array(heat.values) }
    func putHeat(_ deviceId: String, cells: [FieldValue], updatedMs: Double) async throws { heat[deviceId] = CloudHeatRow(device_id: deviceId, cells: cells, updated_ms: updatedMs) }
    func clearHeat() async throws { heat = [:] }
    func listTrackIds() async throws -> [String] { Array(tracks.keys) }
    func getTrack(_ tripId: String) async throws -> TripTrack? { tracks[tripId] }
    func putTrack(_ track: TripTrack, updatedMs: Double) async throws { tracks[track.tripId] = track }
    func clearTracks() async throws { tracks = [:] }
}

private final class FakeStore: BackupStore {
    var trips: [String: Trip]
    var samples: [String: [TripSample]] = [:]
    var own: [HeatCell]
    var remote: [[HeatCell]] = []

    init(_ trips: [Trip] = [], _ cells: [HeatCell] = []) {
        self.trips = Dictionary(uniqueKeysWithValues: trips.map { ($0.id, $0) })
        own = cells
    }
    func backupTrips() -> [Trip] { Array(trips.values) }
    func backupSamples(_ tripId: String) -> [TripSample] { samples[tripId] ?? [] }
    func saveDownloaded(_ trip: Trip, samples s: [TripSample]) {
        trips[trip.id] = trip
        samples[trip.id] = s
    }
    func deleteDownloaded(_ id: String) { trips[id] = nil }
    func ownHeatCells() -> [HeatCell] { own }
    func setRemoteHeat(_ lists: [[HeatCell]]) { remote = lists }
    var tracks: [String: TripTrack] = [:]
    func backupTracks() -> [TripTrack] { Array(tracks.values) }
    func saveTrack(_ track: TripTrack) { tracks[track.tripId] = track }
}

private func googleUser(given: String? = nil, full: String? = nil) -> AccountUser {
    accountUser(id: "g", email: "a@b.hu", isAnonymous: false, identities: ["google"], givenName: given, claimsGivenName: nil, fullName: full, name: nil)
}

@Suite("AW22: ajánlat és név")
struct AccountNameTests {
    @Test("a bejelentkezés-ajánlat névtelenül, egyszer, 30 napig nem jön újra")
    func nudge() {
        #expect(signinNudgeDue(nil, now: 1000, isAnonymous: true))
        #expect(!signinNudgeDue(nil, now: 1000, isAnonymous: false))
        #expect(!signinNudgeDue(1000, now: 1000 + NUDGE_INTERVAL_MS - 1, isAnonymous: true))
        #expect(signinNudgeDue(1000, now: 1000 + NUDGE_INTERVAL_MS, isAnonymous: true))
    }

    @Test("a keresztnév a given_name, különben a teljes név első szava")
    func firstName() {
        #expect(firstNameFromMeta(givenName: " Kristof ", claimsGivenName: nil, fullName: "Horváth Kristof", name: nil) == "Kristof")
        #expect(firstNameFromMeta(givenName: nil, claimsGivenName: "Anna", fullName: nil, name: nil) == "Anna")
        #expect(firstNameFromMeta(givenName: nil, claimsGivenName: nil, fullName: "Kristof Horvath", name: nil) == "Kristof")
        #expect(firstNameFromMeta(givenName: nil, claimsGivenName: nil, fullName: nil, name: nil) == nil)
    }

    @Test("a felhasználó: e-mailnél nincs név, a közösségi fióknál a szolgáltatóé")
    func user() {
        let a = accountUser(id: "a", email: nil, isAnonymous: true, identities: [], givenName: nil, claimsGivenName: nil, fullName: nil, name: nil)
        #expect(a.isAnonymous && a.provider == nil && a.givenName == nil)
        let e = accountUser(id: "e", email: "a@b.hu", isAnonymous: false, identities: ["email"], givenName: nil, claimsGivenName: nil, fullName: "X Y", name: nil)
        #expect(e.provider == .email && e.givenName == nil && e.fullName == nil && e.email == "a@b.hu")
        let g = googleUser(given: "Anna", full: "Kis Anna")
        #expect(g.provider == .google && g.givenName == "Anna" && g.fullName == "Kis Anna")
    }

    @Test("az „Így szólítsunk?” lépés: kitöltött Megszólításnál és kihagyás után nincs")
    func nameStep() {
        var p = Profile()
        p.given_name = "Anna"
        #expect(nameStepNeeded("", nil))
        #expect(nameStepNeeded("", p))
        #expect(!nameStepNeeded("Kristof", p))
        var named = p
        named.megszolitas = "Kristof"
        #expect(!nameStepNeeded("", named))
        var skipped = p
        skipped.name_prompted = true
        #expect(!nameStepNeeded("", skipped))
    }

    @Test("a lépés kitöltése: az Apple/Google keresztneve, e-mailnél üres")
    func prefill() {
        var p = Profile()
        p.given_name = "Anna"
        #expect(nameStepPrefill(nil, p) == "Anna")
        #expect(nameStepPrefill(googleUser(given: "Béla"), nil) == "Béla")
        let e = accountUser(id: "e", email: "a@b.hu", isAnonymous: false, identities: ["email"], givenName: nil, claimsGivenName: nil, fullName: nil, name: nil)
        #expect(nameStepPrefill(e, nil) == "")
    }

    @Test("a kártya címe: Megszólítás, teljes név, e-mail")
    func title() {
        var u = googleUser(full: "Kis Anna")
        #expect(accountTitle(u, name: "Kristof") == "Kristof")
        #expect(accountTitle(u, name: "") == "Kis Anna")
        u.fullName = nil
        #expect(accountTitle(u, name: "") == "a@b.hu")
    }

    @Test("a hibák felirata és az e-mail-cím ellenőrzése")
    func errors() {
        #expect(accountErrorKey(code: "over_email_send_rate_limit", message: nil, status: nil) == .accountErrRate)
        #expect(accountErrorKey(code: nil, message: nil, status: 429) == .accountErrRate)
        #expect(accountErrorKey(code: "email_address_not_authorized", message: nil, status: nil) == .accountErrNotAllowed)
        #expect(accountErrorKey(code: "email_address_invalid", message: nil, status: nil) == .accountErrEmail)
        #expect(accountErrorKey(code: nil, message: "x", status: nil) == .accountErrGeneric)
        #expect(validEmail(" a@b.hu "))
        #expect(!validEmail("a@b"))
        #expect(isIdentityTaken(code: "identity_already_exists", message: nil))
        #expect(isIdentityTaken(code: "email_exists", message: nil))
        #expect(!isIdentityTaken(code: "x", message: nil))
    }
}

@Suite("AW22: szinkron ütközés")
struct AccountSyncTests {
    @Test("helyi változás: csak az eltérő mező kap új időt, a törölt hely jelölőt")
    func note() {
        var s = Settings()
        s.zonaM = ["x": 500]
        let withX = SavedPlaces(home: nil, work: nil, others: [place("x")])
        let a = noteLocalFields(FieldState(), fields(data(settings: s, saved: withX)), order: otherPlaceKeys(withX), now: 100)
        #expect(a.times["settings.egyseg"] == 0)
        #expect(a.times["place.other.x"] == 1)
        s.egyseg = .mph
        let b = noteLocalFields(a, fields(data(settings: s, saved: withX)), now: 200)
        #expect(b.times["settings.egyseg"] == 200)
        #expect(b.times["settings.terkep"] == 0)
        s.zonaM = [:]
        let c = noteLocalFields(b, fields(data(settings: s)), now: 300)
        #expect(c.values["place.other.x"] == .null)
        #expect(c.times["place.other.x"] == 300)
        #expect(c.values["zone.x"] == .null)
    }

    @Test("más platform mezője nem törlődik")
    func otherPlatform() {
        let s = FieldState(values: ["settings.web_only": .string("x")], times: ["settings.web_only": 5])
        let n = noteLocalFields(s, fields(data()), now: 100)
        #expect(n.values["settings.web_only"] == .string("x"))
        #expect(n.times["settings.web_only"] == 5)
    }

    @Test("mezőnként a legutóbb módosított nyer, azonos időnél a szerveré")
    func lww() {
        let local = FieldState(values: ["a": .number(1), "b": .number(1), "c": .number(1), "d": .number(1)], times: ["a": 100, "b": 200, "c": 150, "d": 7])
        let r = mergeFields(local, [
            FieldRow(key: "a", value: .number(2), updated_ms: 200),
            FieldRow(key: "b", value: .number(2), updated_ms: 100),
            FieldRow(key: "c", value: .number(2), updated_ms: 150),
            FieldRow(key: "e", value: .number(2), updated_ms: 1),
        ])
        #expect(r.state.values == ["a": .number(2), "b": .number(1), "c": .number(2), "d": .number(1), "e": .number(2)])
        #expect(r.state.times == ["a": 200, "b": 200, "c": 150, "d": 7, "e": 1])
        #expect(r.upload.map(\.key).sorted() == ["b", "d"])
        #expect(r.changed.sorted() == ["a", "c", "e"])
    }

    @Test("két készülék ugyanarra jut, mezőnként a frissebb értékre")
    func twoDevices() async throws {
        let srv = FakeServer()
        var a = noteLocalFields(FieldState(), fields(data()), now: 10)
        var b = noteLocalFields(FieldState(), fields(data()), now: 10)
        var sa = Settings()
        sa.egyseg = .mph
        var sb = Settings()
        sb.terkep = .vilagos
        a = noteLocalFields(a, fields(data(settings: sa)), now: 100)
        b = noteLocalFields(b, fields(data(settings: sb)), now: 200)
        a = try await syncFieldsOnce(srv, a).state
        b = try await syncFieldsOnce(srv, b).state
        a = try await syncFieldsOnce(srv, a).state
        #expect(a.values["settings.egyseg"] == .string("mph"))
        #expect(a.values["settings.terkep"] == .string("vilagos"))
        #expect(b.values["settings.egyseg"] == .string("mph"))
        #expect(b.values["settings.terkep"] == .string("vilagos"))
    }

    @Test("a mentett hely és a törlése is átjut; a törölt hely nem jön vissza")
    func places() async throws {
        let srv = FakeServer()
        var zoned = Settings()
        zoned.zonaM = ["x": 1000]
        let withPlace = data(settings: zoned, saved: SavedPlaces(home: place("h"), work: nil, others: [place("x")]))
        var a = noteLocalFields(FieldState(), fields(data()), now: 10)
        a = noteLocalFields(a, fields(withPlace), now: 100)
        a = try await syncFieldsOnce(srv, a).state
        var b = noteLocalFields(FieldState(), fields(data()), now: 10)
        b = try await syncFieldsOnce(srv, b).state
        let applied = applyFields(b, base: data())
        #expect(applied.saved.home?.id == "h")
        #expect(applied.saved.others.map(\.id) == ["x"])
        #expect(applied.settings.zonaM == ["x": 1000])
        a = noteLocalFields(a, fields(data(saved: SavedPlaces(home: place("h"), work: nil, others: []))), now: 300)
        a = try await syncFieldsOnce(srv, a).state
        b = try await syncFieldsOnce(srv, b).state
        let after = applyFields(b, base: applied)
        #expect(after.saved.others.isEmpty)
        #expect(after.settings.zonaM.isEmpty)
    }

    @Test("a helyek sorrendje a felvétel sorrendje")
    func order() {
        let saved = SavedPlaces(home: nil, work: nil, others: [place("z", 40), place("a", 41), place("m", 42)])
        let s = noteLocalFields(FieldState(), fields(data(saved: saved)), order: otherPlaceKeys(saved), now: 100)
        #expect(applyFields(s, base: data()).saved.others.map(\.id) == ["z", "a", "m"])
    }

    @Test("a legutóbbi célok egyesülnek, semmi nem vész el a listából")
    func recentsUnion() {
        let newer = [place("b", 41), place("a", 40)]
        let older = [place("c", 42), place("a", 40)]
        #expect(mergeRecents(newer, older).map(\.id) == ["b", "a", "c"])
        let l = accountFieldsOf(data(recents: newer))["recents"]!
        let o = accountFieldsOf(data(recents: older))["recents"]!
        let r = mergeFields(FieldState(values: ["recents": l], times: ["recents": 200]), [FieldRow(key: "recents", value: o, updated_ms: 100)])
        #expect(parseRecents(r.state.values["recents"]!.json).map(\.id) == ["b", "a", "c"])
        #expect(r.upload.first?.key == "recents")
    }

    @Test("a Megszólítás a profilba kerül; a kitöltött nem íródik felül üres profillal")
    func megszolitas() async throws {
        let srv = FakeServer()
        try await srv.pushProfile(megszolitas: nil, megszolitasMs: nil, givenName: "Anna", fullName: nil, namePrompted: nil)
        var named = Settings()
        named.megszolitas = "Kristof"
        var a = noteLocalFields(FieldState(), fields(data(settings: named)), now: 10)
        a = try await syncFieldsOnce(srv, a).state
        #expect(a.values["megszolitas"] == .string("Kristof"))
        #expect(srv.profile?.megszolitas == "Kristof")
        #expect(srv.fields["megszolitas"] == nil)
        named.megszolitas = "Kristóf"
        a = noteLocalFields(a, fields(data(settings: named)), now: 500)
        _ = try await syncFieldsOnce(srv, a)
        #expect(srv.profile?.megszolitas == "Kristóf" && srv.profile?.megszolitas_ms == 500)
        let b = try await syncFieldsOnce(srv, noteLocalFields(FieldState(), fields(data()), now: 10)).state
        #expect(applyFields(b, base: data()).settings.megszolitas == "Kristóf")
    }

    @Test("a szinkron időbélyege egész ezredmásodperc, a JSON-ban tizedes nélkül")
    func wholeMs() throws {
        let t = accountNowMs(Date(timeIntervalSince1970: 1_793_819_465.123456))
        #expect(t == t.rounded())
        let json = String(decoding: try JSONEncoder().encode(FieldRow(key: "a", value: .null, updated_ms: t)), as: UTF8.self)
        #expect(json.contains("\"updated_ms\":1793819465123"))
        #expect(!json.contains("1793819465123."))
    }

    @Test("az azonos tartalom eltérő kulcssorrenddel is ugyanaz")
    func sameContent() {
        let a = FieldValue.object(["a": .number(1), "b": .array([.number(1), .object(["c": .number(2)])])])
        let b = FieldValue.object(["b": .array([.number(1), .object(["c": .number(2)])]), "a": .number(1)])
        #expect(a == b)
        #expect(FieldValue.object(["a": .number(1)]) != .object(["a": .number(2)]))
        #expect(FieldValue.null != .number(0))
    }
}

@Suite("AW22: felhős mentés")
struct AccountBackupTests {
    @Test("a mentés terve: fel, le, helyi törlés, függő törlés")
    func plan() {
        var state = CloudState()
        state.pendingDeletes = ["nem-ment"]
        let p = planTripSync(["fel", "mindketto", "torolt", "fut", "nem-ment"], [
            CloudTripListRow(id: "mindketto", deleted: false, updated_ms: 1),
            CloudTripListRow(id: "le", deleted: false, updated_ms: 1),
            CloudTripListRow(id: "torolt", deleted: true, updated_ms: 1),
            CloudTripListRow(id: "volt", deleted: true, updated_ms: 1),
        ], state, openId: "fut")
        #expect(p.upload == ["fel"])
        #expect(p.download == ["le"])
        #expect(p.deleteLocal == ["torolt"])
        #expect(p.pushDeletes == ["nem-ment"])
    }

    @Test("a visszaállított út felülírja a szerver törlési jelölőjét")
    func restore() {
        var state = CloudState()
        state.pendingRestores = ["v"]
        let p = planTripSync(["v"], [CloudTripListRow(id: "v", deleted: true, updated_ms: 1)], state, openId: nil)
        #expect(p.upload == ["v"])
        #expect(p.deleteLocal.isEmpty)
    }

    @Test("a minták ritkítva, az utolsó mindig megmarad")
    func samples() {
        let list = (0...10).map { TripSample(tripId: "t", t: Double($0) * 1000, lat: 47, lon: 19, speedKmh: 50, heading: 90, accuracy: 5, h3: "x", limitKmh: 90) }
        let c = compactSamples(list)
        #expect(c.map { $0[0] } == [0, 5000, 10000])
        let e = expandSamples("t", c)
        #expect(e[1] == TripSample(tripId: "t", t: 5000, lat: 47, lon: 19, speedKmh: 50, heading: 90, accuracy: 5, h3: nil, limitKmh: 90))
    }

    @Test("a hőtérkép-blob oda-vissza, az ujjlenyomat új áthaladásra változik")
    func blob() {
        let cells = [cell("a", 2), cell("b", 3)]
        #expect(parseHeatBlob(heatBlob(cells)) == cells)
        #expect(heatHash(cells) == "2:5:10")
        #expect(heatHash([cell("a", 3), cell("b", 3)]) != heatHash(cells))
    }

    @Test("a többi készülék cellái összeadódnak a sajáttal")
    func remoteHeat() {
        let m = mergeRemoteHeat([cell("a", 2, 40, 1)], [[cell("a", 2, 60, 5), cell("b", 1)]])
        #expect(m.first { $0.h3 == "a" } == HeatCell(h3: "a", count: 4, avgKmh: 50, lastT: 5))
        #expect(m.first { $0.h3 == "b" }?.count == 1)
    }

    @Test("két készülék naplója összefésülődik, a törlés átjut, a hőtérkép nem duplázódik")
    func twoDevices() async throws {
        let srv = FakeServer()
        let a = FakeStore([trip("t-a")], [cell("x", 2)])
        let b = FakeStore([trip("t-b")], [cell("x", 3)])
        var ca = try await syncBackupOnce(srv, a, CloudState(), deviceId: "dev-a", openTripId: nil, now: 100).state
        var cb = try await syncBackupOnce(srv, b, CloudState(), deviceId: "dev-b", openTripId: nil, now: 100).state
        ca = try await syncBackupOnce(srv, a, ca, deviceId: "dev-a", openTripId: nil, now: 200).state
        #expect(a.trips.keys.sorted() == ["t-a", "t-b"])
        #expect(b.trips.keys.sorted() == ["t-a", "t-b"])
        #expect(a.remote == [[cell("x", 3)]])
        #expect(b.remote == [[cell("x", 2)]])
        // többszöri kör sem duplázza
        ca = try await syncBackupOnce(srv, a, ca, deviceId: "dev-a", openTripId: nil, now: 300).state
        #expect(mergeRemoteHeat(a.own, a.remote).first?.count == 5)
        // törlés az egyiken: a másikon is eltűnik, a szerveren csak jelölő marad
        a.trips["t-a"] = nil
        ca.pendingDeletes = ["t-a"]
        ca = try await syncBackupOnce(srv, a, ca, deviceId: "dev-a", openTripId: nil, now: 400).state
        cb = try await syncBackupOnce(srv, b, cb, deviceId: "dev-b", openTripId: nil, now: 500).state
        #expect(Array(b.trips.keys) == ["t-b"])
        #expect(srv.trips["t-a"]?.record == nil && srv.trips["t-a"]?.deleted == true && srv.trips["t-a"]?.samples.isEmpty == true)
        #expect(ca.pendingDeletes.isEmpty)
        #expect(cb.pendingDeletes.isEmpty)
    }

    @Test("a hőtérkép törlése minden készülék felhős sorát viszi")
    func heatClear() async throws {
        let srv = FakeServer()
        let a = FakeStore([], [cell("x", 2)])
        let b = FakeStore([], [cell("x", 3)])
        _ = try await syncBackupOnce(srv, b, CloudState(), deviceId: "dev-b", openTripId: nil, now: 100)
        var ca = try await syncBackupOnce(srv, a, CloudState(), deviceId: "dev-a", openTripId: nil, now: 100).state
        a.own = []
        ca.pendingHeatClear = true
        ca = try await syncBackupOnce(srv, a, ca, deviceId: "dev-a", openTripId: nil, now: 200).state
        #expect(a.remote.isEmpty)
        #expect(srv.heat["dev-b"] == nil)
        #expect(!ca.pendingHeatClear)
    }

    @Test("a futó út nem megy fel, csak a lezárása után")
    func open() async throws {
        let srv = FakeServer()
        let a = FakeStore([trip("fut")])
        var ca = try await syncBackupOnce(srv, a, CloudState(), deviceId: "dev-a", openTripId: "fut", now: 100).state
        #expect(srv.trips["fut"] == nil)
        ca = try await syncBackupOnce(srv, a, ca, deviceId: "dev-a", openTripId: nil, now: 200).state
        #expect(srv.trips["fut"] != nil)
        #expect(ca.heatHash == "0:0:0")
    }
}

/// A TS `mergeFields` és a Swift ugyanarra az adatra ugyanazt a mezőalakot adja: a két platform így nem írja felül egymást végtelenül (`noteLocalFields` nem jelez változást).
@Suite("AW22: a szerverről jött alak stabil")
struct AccountStableTests {
    @Test("a webes hely-érték alkalmazás után változatlan mező marad")
    func webShape() throws {
        // AW25 (INV-25): a tárolt alak név és cím nélküli; a régi, névvel tárolt értéket az app egyszer tisztán visszaírja
        let json = #"{"id":"h","name":"","address":"","lat":47.5,"lon":19}"#
        let v = try JSONDecoder().decode(FieldValue.self, from: Data(json.utf8))
        var state = noteLocalFields(FieldState(), fields(data()), now: 10)
        state = mergeFields(state, [FieldRow(key: "place.home", value: v, updated_ms: 50)]).state
        let applied = applyFields(state, base: data())
        let again = noteLocalFields(state, fields(applied), order: otherPlaceKeys(applied.saved), now: 999)
        #expect(again.times["place.home"] == 50)
        #expect(again.values["place.home"] == v)
    }
}

@Suite("AW22: a felhős út két platform közt")
struct CloudTripShapeTests {
    @Test("a webes út-rekord iOS-en beolvasható, és ugyanazt a JSON-alakot adja vissza")
    func webRecord() throws {
        let web = #"{"id":"w1","startedAt":1000,"endedAt":2000,"distanceM":500,"movingS":60,"idleS":5,"maxKmh":50,"turns":{"left":1,"right":0,"uTurn":0},"dirChanges":{"left":0,"right":2,"uTurn":0},"reroutes":0,"measurements":[],"jamS":0,"destination":null,"path":[[[47.5,19.0]]],"samples":3}"#
        let t = try JSONDecoder().decode(Trip.self, from: Data(web.utf8))
        #expect(t.id == "w1" && t.turns.left == 1 && t.dirChanges.right == 2 && t.path == [[[47.5, 19.0]]])
        let back = try JSONSerialization.jsonObject(with: JSONEncoder().encode(t)) as? [String: Any]
        #expect(Set(back.map { Array($0.keys) } ?? []).isSuperset(of: ["id", "startedAt", "endedAt", "distanceM", "movingS", "idleS", "maxKmh", "turns", "dirChanges", "reroutes", "measurements", "jamS", "path", "samples"]))
    }
}

@Suite("AW22: térkép nyelve")
struct MapLanguageTests {
    @Test("a vektor-csempe és a TileJSON az app nyelvén, más kérés változatlan")
    func url() {
        #expect(mapLanguageURL("https://api.mapbox.com/v4/mapbox.mapbox-streets-v8-lite/5/17/11.vector.pbf?access_token=x", lang: "de") == "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8-lite/5/17/11.vector.pbf?access_token=x&language=de")
        #expect(mapLanguageURL("https://api.mapbox.com/styles/v1/mapbox/standard?access_token=x", lang: "de") == nil)
        #expect(mapLanguageURL("https://api.mapbox.com/v4/a.json?language=hu", lang: "de") == nil)
    }
}

@Suite("AW24: Fiók-kártya")
struct AccountCardAW24Tests {
    @Test("a monogram a névből két betű, különben az e-mail első betűje")
    func monogram() {
        #expect(avatarInitials("Horváth Kristóf", "a@b.hu") == "HK")
        #expect(avatarInitials("Kristóf", nil) == "K")
        #expect(avatarInitials(" ", "anna@b.hu") == "A")
        #expect(avatarInitials(nil, nil) == "")
    }

    @Test("a Megszólítás magyarázata a megadott névvel, élőben")
    func magyarazat() {
        #expect(greetingPreview("Kristóf", lang: .hu) == "Így köszönt az app induláskor: »Szia, Kristóf, indulhatunk!«")
        #expect(greetingPreview("", lang: .hu) == "Így köszönt az app induláskor: »Szia, indulhatunk!«")
    }

    @Test("a felhős mentés alapból BE: a jelölő nélküli régi érték egyszer átáll, utána a választás marad")
    func alapBe() {
        #expect(Settings().felhoMentes)
        #expect(Settings.parse(#"{"felho_mentes":false}"#).felhoMentes)
        #expect(!Settings.parse(#"{"felho_mentes":false,"felho_mentes_v2":true}"#).felhoMentes)
    }

    @Test("a kész vonal egyszer megy fel, a másik készülék vonala letöltődik és nem megy közösségbe")
    func vonalak() async throws {
        let server = FakeServer()
        let a = FakeStore()
        let b = FakeStore()
        let track = TripTrack(tripId: "t1", startedAt: 1, status: "done", share: true, parts: [], lines: [], matcher: "mapbox")
        a.saveTrack(track)
        var pending = track
        pending.tripId = "p1"
        pending.status = "pending"
        a.saveTrack(pending)
        _ = try await syncBackupOnce(server, a, CloudState(), deviceId: "A", openTripId: nil, now: 5)
        #expect(Array(server.tracks.keys) == ["t1"])
        let r = try await syncBackupOnce(server, b, CloudState(), deviceId: "B", openTripId: nil, now: 6)
        #expect(r.heatChanged)
        #expect(b.tracks["t1"]?.share == false)
    }
}
