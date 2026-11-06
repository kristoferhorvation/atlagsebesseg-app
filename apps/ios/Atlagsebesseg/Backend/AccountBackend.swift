import AuthenticationServices
import CryptoKit
import Foundation
import Supabase

// AW22: a fiók Supabase-oldala (a webes `supabaseRemote` és a bejelentkezési hívások párja). Minden hívás RLS-sel, a bejelentkezett fiók saját soraira.

nonisolated struct SupabaseAccountRemote: AccountRemote {
    let client: SupabaseClient

    private func uid() async throws -> String { try await client.auth.session.user.id.uuidString }

    func pullFields() async throws -> [FieldRow] {
        try await client.from("account_fields").select("key,value,updated_ms").execute().value
    }

    func pushFields(_ rows: [FieldRow]) async throws {
        try await client.from("account_fields").upsert(rows, onConflict: "user_id,key").execute()
    }

    func pullProfile() async throws -> Profile? {
        let rows: [Profile] = try await client.from("profiles").select("megszolitas,megszolitas_ms,given_name,full_name,name_prompted,avatar").limit(1).execute().value
        return rows.first
    }

    private struct ProfilePatch: Encodable, Sendable {
        var user_id: String
        var megszolitas: String?
        var megszolitas_ms: Double?
        var given_name: String?
        var full_name: String?
        var name_prompted: Bool?

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(user_id, forKey: .user_id)
            // csak a megadott mezők: a többi a szerveren marad
            try c.encodeIfPresent(megszolitas, forKey: .megszolitas)
            try c.encodeIfPresent(megszolitas_ms, forKey: .megszolitas_ms)
            try c.encodeIfPresent(given_name, forKey: .given_name)
            try c.encodeIfPresent(full_name, forKey: .full_name)
            try c.encodeIfPresent(name_prompted, forKey: .name_prompted)
        }

        enum CodingKeys: String, CodingKey { case user_id, megszolitas, megszolitas_ms, given_name, full_name, name_prompted }
    }

    func pushProfile(megszolitas: String?, megszolitasMs: Double?, givenName: String?, fullName: String?, namePrompted: Bool?) async throws {
        let patch = ProfilePatch(user_id: try await uid(), megszolitas: megszolitas, megszolitas_ms: megszolitasMs, given_name: givenName, full_name: fullName, name_prompted: namePrompted)
        try await client.from("profiles").upsert(patch, onConflict: "user_id").execute()
    }

    func listTrips() async throws -> [CloudTripListRow] {
        try await client.from("cloud_trips").select("id,deleted,updated_ms").execute().value
    }

    private struct TripRow: Decodable, Sendable {
        var record: Trip?
        var samples: [[Double?]]?
    }

    func getTrip(_ id: String) async throws -> (record: Trip?, samples: [[Double?]])? {
        let rows: [TripRow] = try await client.from("cloud_trips").select("record,samples").eq("id", value: id).limit(1).execute().value
        return rows.first.map { ($0.record, $0.samples ?? []) }
    }

    private struct TripPut: Encodable, Sendable {
        var id: String
        var record: Trip
        var samples: [[Double?]]
        var deleted = false
        var updated_ms: Double
    }

    func putTrip(_ trip: Trip, samples: [[Double?]], updatedMs: Double) async throws {
        try await client.from("cloud_trips").upsert(TripPut(id: trip.id, record: trip, samples: samples, updated_ms: updatedMs), onConflict: "user_id,id").execute()
    }

    private struct TripTombstone: Encodable, Sendable {
        var id: String
        var deleted = true
        var updated_ms: Double

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(id, forKey: .id)
            try c.encode(deleted, forKey: .deleted)
            try c.encode(updated_ms, forKey: .updated_ms)
            // a törölt út csak jelölő: a tartalom a szerverről is törlődik
            try c.encodeNil(forKey: .record)
            try c.encodeNil(forKey: .samples)
        }

        enum CodingKeys: String, CodingKey { case id, deleted, updated_ms, record, samples }
    }

    func markTripsDeleted(_ ids: [String], updatedMs: Double) async throws {
        try await client.from("cloud_trips").upsert(ids.map { TripTombstone(id: $0, updated_ms: updatedMs) }, onConflict: "user_id,id").execute()
    }

    func listHeat() async throws -> [CloudHeatRow] {
        try await client.from("cloud_heat").select("device_id,cells,updated_ms").execute().value
    }

    func putHeat(_ deviceId: String, cells: [FieldValue], updatedMs: Double) async throws {
        try await client.from("cloud_heat").upsert(CloudHeatRow(device_id: deviceId, cells: cells, updated_ms: updatedMs), onConflict: "user_id,device_id").execute()
    }

    func clearHeat() async throws {
        try await client.from("cloud_heat").delete().not("device_id", operator: .is, value: "null").execute()
    }

    private struct TrackIdRow: Decodable, Sendable { var trip_id: String }
    private struct TrackRow: Decodable, Sendable { var track: TripTrack }
    private struct TrackPut: Encodable, Sendable {
        var trip_id: String
        var track: TripTrack
        var matcher: String?
        var updated_ms: Double
    }
    private struct AvatarPut: Encodable, Sendable {
        var user_id: String
        var avatar: String
    }

    func listTrackIds() async throws -> [String] {
        let rows: [TrackIdRow] = try await client.from("cloud_tracks").select("trip_id").execute().value
        return rows.map(\.trip_id)
    }

    func getTrack(_ tripId: String) async throws -> TripTrack? {
        let rows: [TrackRow] = try await client.from("cloud_tracks").select("track").eq("trip_id", value: tripId).limit(1).execute().value
        return rows.first?.track
    }

    func putTrack(_ track: TripTrack, updatedMs: Double) async throws {
        try await client.from("cloud_tracks").upsert(TrackPut(trip_id: track.tripId, track: track, matcher: track.matcher, updated_ms: updatedMs), onConflict: "user_id,trip_id").execute()
    }

    func clearTracks() async throws {
        try await client.from("cloud_tracks").delete().not("trip_id", operator: .is, value: "null").execute()
    }

    /// AW24: a választott profilkép feltöltése.
    func pushAvatar(_ dataUrl: String) async throws {
        try await client.from("profiles").upsert(AvatarPut(user_id: try await uid(), avatar: dataUrl), onConflict: "user_id").execute()
    }
}

/// A Sign in with Apple natív folyamata: egyszeri nonce (a szerver a hash-t ellenőrzi), az eredmény az azonosító-token és – csak az első engedélyezéskor – a név.
final class AppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    struct Result: Sendable {
        let idToken: String
        let nonce: String
        let givenName: String?
        let fullName: String?
    }

    private var continuation: CheckedContinuation<Result, Error>?
    private var nonce = ""

    func start() async throws -> Result {
        nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        return try await withCheckedThrowingContinuation { c in
            continuation = c
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential, let data = cred.identityToken, let token = String(data: data, encoding: .utf8) else {
            continuation?.resume(throwing: URLError(.badServerResponse))
            continuation = nil
            return
        }
        let parts = cred.fullName
        let full = [parts?.givenName, parts?.familyName].compactMap { $0 }.joined(separator: " ")
        continuation?.resume(returning: Result(idToken: token, nonce: nonce, givenName: parts?.givenName, fullName: full.isEmpty ? nil : full))
        continuation = nil
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

/// A Google (és bármely OAuth) bejelentkezés a rendszer lapján; a visszatérő URL-t adja.
final class WebAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { c in
            let s = ASWebAuthenticationSession(url: url, callbackURLScheme: "atlagsebesseg") { result, error in
                if let result { c.resume(returning: result) } else { c.resume(throwing: error ?? URLError(.cancelled)) }
            }
            s.presentationContextProvider = self
            session = s
            s.start()
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}

nonisolated private struct AuthSettingsRow: Decodable, Sendable { let external: [String: Bool]? }
nonisolated private struct MergeResult: Decodable, Sendable { let merged: Bool }
nonisolated private struct ClaimParams: Encodable, Sendable { let p_token: String }

extension Backend {
    var accountRemote: SupabaseAccountRemote? { client.map(SupabaseAccountRemote.init) }

    /// Az auth-szolgáltatók (nyilvános végpont): a be nem állított gomb tisztán jelzi, nem hibázik. Hálózat nélkül `nil`.
    func authProviders(bundle: Bundle = .main) async -> (apple: Bool, google: Bool)? {
        guard let base = bundle.object(forInfoDictionaryKey: "AtlSupabaseURL") as? String, let key = bundle.object(forInfoDictionaryKey: "AtlSupabaseAnonKey") as? String, let url = URL(string: "\(base)/auth/v1/settings") else { return nil }
        var req = URLRequest(url: url)
        req.setValue(key, forHTTPHeaderField: "apikey")
        guard let (data, resp) = try? await URLSession.shared.data(for: req), (resp as? HTTPURLResponse)?.statusCode == 200, let s = try? JSONDecoder().decode(AuthSettingsRow.self, from: data) else { return nil }
        return (s.external?["apple"] == true, s.external?["google"] == true)
    }

    /// Az összefésülési igazolás a névtelen munkamenetből; bejelentkezés után ezzel olvad be a névtelen felhasználó.
    func prepareMerge() async throws -> String {
        guard let client else { throw BackendError.nincsBeallitas }
        let token: String = try await client.rpc("account_merge_prepare").execute().value
        return token
    }

    @discardableResult
    func claimMerge(_ token: String) async throws -> Bool {
        guard let client else { throw BackendError.nincsBeallitas }
        let r: MergeResult = try await client.rpc("account_merge_claim", params: ClaimParams(p_token: token)).execute().value
        return r.merged
    }

    /// Fiók törlése az edge function-nel: az auth-felhasználó és minden hozzá tartozó sor eltűnik.
    func deleteAccount() async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        try await client.functions.invoke("account-delete", options: FunctionInvokeOptions(method: .post))
    }

    /// Kijelentkezés / fiók törlése után: a készülék új névtelen felhasználóval folytat, a helyi adatok maradnak.
    func continueAnonymously() async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        try? await client.auth.signOut(scope: .local)
        _ = try await client.auth.signInAnonymously(captchaToken: await captchaToken())
    }
}
