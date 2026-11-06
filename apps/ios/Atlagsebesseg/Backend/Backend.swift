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
        return try await client.auth.signInAnonymously(captchaToken: await captchaToken()).user.id.uuidString
    }

    /// A bejelentkezett felhasználó (a saját bejelentés felismeréséhez); munkamenet nélkül `nil`, nem jelentkezik be.
    func currentUserId() async -> String? {
        guard let client else { return nil }
        return try? await client.auth.session.user.id.uuidString
    }

    // MARK: bejelentések (AOS14, a webes `listActiveReports` / `createReports` / `voteReport`)

    /// A téglalap le nem járt bejelentései (`active_reports` nézet), legfeljebb 500.
    func activeReports(in b: BBox) async throws -> [ActiveReport] {
        guard let client else { throw BackendError.nincsBeallitas }
        async let rows: [ReportRow] = client.from("active_reports")
            .select("id,type,lat,lon,heading_deg,gate_kind,subtype,confirmations,denials,created_at,expires_at,user_id")
            .gte("lat", value: b.south)
            .lte("lat", value: b.north)
            .gte("lon", value: b.west)
            .lte("lon", value: b.east)
            .limit(500)
            .execute()
            .value
        let uid = await currentUserId()
        return try await rows.compactMap { $0.active(myUserId: uid) }
    }

    private struct IdRow: Decodable, Sendable { let id: String }

    /// Bejelentés küldése (anonim bejelentkezéssel); az új sorok azonosítói.
    func createReports(_ rows: [ReportInsert]) async throws -> [String] {
        guard let client else { throw BackendError.nincsBeallitas }
        _ = try await ensureSignedIn()
        let ids: [IdRow] = try await client.from("reports").insert(rows).select("id").execute().value
        return ids.map(\.id)
    }

    private struct VoteRow: Encodable, Sendable {
        let report_id: String
        let confirm: Bool
    }

    /// Megerősítés (true) vagy cáfolat (false); újraszavazásnál felülírja a sajátot (`report_votes`).
    func voteReport(_ reportId: String, confirm: Bool) async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        _ = try await ensureSignedIn()
        try await client.from("report_votes").upsert(VoteRow(report_id: reportId, confirm: confirm), onConflict: "report_id,user_id").execute()
    }

    // MARK: közösségi hőtérkép (AW20, a webes `uploadHeatRows` / `fetchHeatGlobal`)

    /// Cellánkénti aggregátum feltöltése a `heat_cells` táblába – anon kulccsal, bejelentkezés és azonosító nélkül.
    func uploadHeat(_ rows: [HeatUploadRow]) async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        if rows.isEmpty { return }
        try await client.from("heat_cells").insert(rows).execute()
    }

    /// A `heat_global` (res 10) vagy `heat_global_r8` nézet a téglalapra – a legtöbb áthaladású cellák, legfeljebb `HEAT.queryLimit`.
    func heatGlobal(in b: BBox, res: Int) async throws -> [HeatGlobalRow] {
        guard let client else { throw BackendError.nincsBeallitas }
        return try await client.from(res >= Int(HEAT.res) ? "heat_global" : "heat_global_r8")
            .select("h3,lat,lon,count,avg_speed")
            .gte("lat", value: b.south)
            .lte("lat", value: b.north)
            .gte("lon", value: b.west)
            .lte("lon", value: b.east)
            .order("count", ascending: false)
            .limit(Int(HEAT.queryLimit))
            .execute()
            .value
    }

    // MARK: AW24: közösségi hőtérkép útszakaszonként

    private struct SegmentInsert: Encodable, Sendable {
        var row: SegmentUploadRow
        var matcher: String
        enum Keys: String, CodingKey { case matcher }
        func encode(to encoder: Encoder) throws {
            try row.encode(to: encoder)
            var c = encoder.container(keyedBy: Keys.self)
            try c.encode(matcher, forKey: .matcher)
        }
    }

    /// A szakaszok feltöltése a `heat_segments` táblába – anon kulccsal, azonosító nélkül; a `matcher` jelöli az illesztőt.
    func uploadSegments(_ rows: [SegmentUploadRow], matcher: String) async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        if rows.isEmpty { return }
        try await client.from("heat_segments").insert(rows.map { SegmentInsert(row: $0, matcher: matcher) }).execute()
    }

    /// A `heat_segments_global` nézet a téglalapra, a legtöbb áthaladású szakaszok előre.
    func heatSegments(in b: BBox) async throws -> [SegmentGlobalRow] {
        guard let client else { throw BackendError.nincsBeallitas }
        return try await client.from("heat_segments_global")
            .select("seg_key,lat1,lon1,lat2,lon2,count,avg_speed")
            .gte("lat1", value: b.south)
            .lte("lat1", value: b.north)
            .gte("lon1", value: b.west)
            .lte("lon1", value: b.east)
            .order("count", ascending: false)
            .limit(Int(TRACK.queryLimit))
            .execute()
            .value
    }

    // MARK: közösségi dugó-adat (AW18, a webes `listActiveJams` / `createJamSamples`)

    /// A téglalap 15 percnél frissebb dugó-mintái (`active_jams` nézet), legfeljebb 500.
    func activeJams(in b: BBox) async throws -> [CommunityJam] {
        guard let client else { throw BackendError.nincsBeallitas }
        async let rows: [JamRow] = client.from("active_jams")
            .select("id,kind,lat,lon,heading_deg,avg_kmh,length_m,user_id,created_at")
            .gte("lat", value: b.south)
            .lte("lat", value: b.north)
            .gte("lon", value: b.west)
            .lte("lon", value: b.east)
            .limit(500)
            .execute()
            .value
        let uid = await currentUserId()
        return try await rows.map { rowToCommunityJam($0, myUserId: uid) }
    }

    /// Dugó-minták feltöltése (anonim bejelentkezéssel).
    func createJamSamples(_ rows: [JamSampleInsert]) async throws {
        guard let client else { throw BackendError.nincsBeallitas }
        if rows.isEmpty { return }
        _ = try await ensureSignedIn()
        try await client.from("jam_samples").insert(rows).execute()
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

    /// A téglalapot érintő, le nem járt tervezett mérések (`planned_checks_in_bbox`).
    func plannedChecks(in b: BBox) async throws -> [PlannedCheck] {
        guard let client else { throw BackendError.nincsBeallitas }
        let rows: [PlannedCheckRow] = try await client.rpc("planned_checks_in_bbox", params: BBoxParams(b)).execute().value
        return rows.compactMap(\.check)
    }
}
