import AtlagsebessegCore

/// A `public.sections` tábla / `sections_in_bbox` egy sora (packages/data/src/rows.ts).
nonisolated struct SectionRow: Decodable, Sendable {
    var id: String
    var country: String
    var road: String
    var direction: String
    var start_lat: Double
    var start_lon: Double
    var end_lat: Double
    var end_lon: Double
    var length_m: Double
    var speed_limit_kmh: Double
    var source: SectionSource
    var verified: Bool
    /// GeoJSON-sorrend: [[lon, lat], …]
    var geometry: [[Double]]?
    var source_name: String?
    var source_url: String?
    var source_date: String?
    var located_by: SectionLocatedBy?
    var limit_source: SectionLimitSource?

    /// TS: `rowToSection`.
    var section: Section {
        let geom: [LatLon]? = (geometry?.count ?? 0) >= 2 ? geometry!.map { LatLon(lat: $0[1], lon: $0[0]) } : nil
        var provenance: SectionProvenance?
        if let n = source_name, let u = source_url, let d = source_date, let l = located_by {
            provenance = SectionProvenance(name: n, url: u, date: d, locatedBy: l)
        }
        return Section(
            id: id, country: country, road: road, direction: direction,
            start: LatLon(lat: start_lat, lon: start_lon), end: LatLon(lat: end_lat, lon: end_lon),
            lengthM: length_m, speedLimitKmh: speed_limit_kmh, source: source, verified: verified,
            geometry: geom, provenance: provenance, limitSource: limit_source
        )
    }
}
