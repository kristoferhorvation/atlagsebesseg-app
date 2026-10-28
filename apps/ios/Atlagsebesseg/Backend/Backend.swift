import AtlagsebessegCore
import Foundation
import Supabase

/// A Supabase-kapcsolat (packages/app-logic/src/supabase.ts megfelelője): ugyanazok az RPC-k, mint a weben.
/// Beállítás nélkül (`nil` kliens) az app offline, a beépített adattal fut.
final class Backend {
    let client: SupabaseClient?

    private struct BBoxParams: Encodable, Sendable {
        let p_south: Double
        let p_west: Double
        let p_north: Double
        let p_east: Double

        init(_ b: BBox) {
            p_south = b.south
            p_west = b.west
            p_north = b.north
            p_east = b.east
        }
    }

    enum BackendError: Error {
        case nincsBeallitas
    }

    init(bundle: Bundle = .main) {
        let url = (bundle.object(forInfoDictionaryKey: "AtlSupabaseURL") as? String) ?? ""
        let key = (bundle.object(forInfoDictionaryKey: "AtlSupabaseAnonKey") as? String) ?? ""
        if let u = URL(string: url), u.scheme == "https", !key.isEmpty {
            client = SupabaseClient(
                supabaseURL: u,
                supabaseKey: key,
                options: SupabaseClientOptions(auth: .init(emitLocalSessionAsInitialSession: true))
            )
        } else {
            client = nil
        }
    }

    var configured: Bool { client != nil }

    /// Bejelentkezés: meglévő munkamenet, különben anonim. A felhasználó azonosítóját adja.
    func ensureSignedIn() async throws -> String? {
        guard let client else { return nil }
        if let session = try? await client.auth.session { return session.user.id.uuidString }
        return try await client.auth.signInAnonymously().user.id.uuidString
    }

    /// A téglalap szakaszai (`sections_in_bbox`).
    func sections(in b: BBox) async throws -> [Section] {
        guard let client else { throw BackendError.nincsBeallitas }
        let rows: [SectionRow] = try await client.rpc("sections_in_bbox", params: BBoxParams(b)).execute().value
        return rows.map(\.section)
    }

    /// A téglalap fix kamerái (`cameras_in_bbox`).
    func cameras(in b: BBox) async throws -> [FixedCamera] {
        guard let client else { throw BackendError.nincsBeallitas }
        let rows: [CameraRow] = try await client.rpc("cameras_in_bbox", params: BBoxParams(b)).execute().value
        return rows.map(\.camera)
    }
}
