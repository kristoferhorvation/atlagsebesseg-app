import AtlagsebessegCore
import Foundation
import SwiftUI
import UIKit

// AOS15: a Live Activity négyzetes térképképe. A Mapbox Static Images API rendereli (a szerveren – a háttérben futó app
// GPU-t nem használhat, a Snapshotter zárolt képernyőnél nem menne; Kristof döntése, 2026-10-30): a pozíció körüli rész az
// útvonallal és a közeli szakaszokkal, menetirány felfelé, sötét, visszafogott stílusban. A kép az App Group tárolóba kerül
// (`LiveMapStore`), a widget onnan tölti be; a pozíció-jelet a widget rajzolja a kép közepére.

/// A térképkép tartalma (tiszta adat – a kérés-URL ebből).
nonisolated struct LiveMapRequest: Equatable, Sendable {
    var center: LatLon
    /// Menetirány (fok): a kép ennyivel forgatva, hogy az irány felfelé mutasson.
    var bearing: Double
    var zoom: Double
    /// Az útvonal látható része (navigációban), különben üres.
    var route: [LatLon]
    /// A közeli szakaszok (a határaikkal együtt látszanak).
    var sections: [[LatLon]]
    /// A mért szakasz (a tónus színében), ha van.
    var active: [LatLon]?
    /// `RRGGBB` színek a tokenekből.
    var routeHex: String
    var sectionHex: String
    var activeHex: String
}

nonisolated enum LIVE_MAP {
    /// A kép mérete (pt; a kérés @2x – 240 × 240 px).
    static let sizePt = 120
    /// Visszafogott, sötét klasszikus stílus (a Static Images API-ban a Standard nem érhető el).
    static let style = "mapbox/dark-v11"
    /// Frissítés legfeljebb ennyi időnként (ms) – manővernél azonnal.
    static let minGapMs = 30_000.0
    /// …és csak, ha a pozíció ennyit mozdult (m).
    static let minMoveM = 100.0
    /// Ennél messzebb a kép középpontjától a kép elavult – nem mutatjuk (régi helyet ne lásson a sofőr). Nagyobb, mint amit
    /// 30 s alatt 180 km/h-val megtesz az autó, különben autópályán a kép az idő felében eltűnne.
    static let staleM = 1500.0
    /// Az útvonalból ennyi látszik a pozíció előtt / mögött (m).
    static let aheadM = 2500.0
    static let behindM = 300.0
    /// Ennyi méteren belüli szakaszok kerülnek a képre.
    static let sectionsNearM = 2500.0
    /// Pontok legalább ilyen távolságra (m) – az URL rövid marad (≤ 8192 karakter).
    static let minStepM = 20.0
}

/// A kép zoomja a sebességből: városban 14 (~0,8 km a kép széle), autópályán 13 (~1,6 km).
nonisolated func liveMapZoom(_ kmh: Double?) -> Double {
    let v = max(0, kmh ?? 0)
    return 14 - min(1, max(0, (v - 50) / 60))
}

/// Google-féle kódolt vonallánc (5 tizedes) – a Static Images API `path` átfedéséhez.
nonisolated func encodePolyline(_ pts: [LatLon]) -> String {
    var out = ""
    var (pLat, pLon) = (0, 0)
    func put(_ v: Int) {
        var x = v < 0 ? ~(v << 1) : v << 1
        while x >= 0x20 {
            out.unicodeScalars.append(Unicode.Scalar(UInt8((0x20 | (x & 0x1f)) + 63)))
            x >>= 5
        }
        out.unicodeScalars.append(Unicode.Scalar(UInt8(x + 63)))
    }
    for p in pts {
        let lat = Int(jsRound(p.lat * 1e5)), lon = Int(jsRound(p.lon * 1e5))
        put(lat - pLat)
        put(lon - pLon)
        (pLat, pLon) = (lat, lon)
    }
    return out
}

/// Ritkítás: legalább `minStepM`-enként egy pont (az első és az utolsó mindig marad).
nonisolated func thinPoints(_ pts: [LatLon], minStepM: Double = LIVE_MAP.minStepM) -> [LatLon] {
    guard pts.count > 2 else { return pts }
    var out = [pts[0]]
    for p in pts.dropFirst().dropLast() where haversineM(out.last!, p) >= minStepM { out.append(p) }
    out.append(pts.last!)
    return out
}

/// Az útvonal része `[fromM, toM]` között (a `segStartM` kumulált távokból).
nonisolated func routeWindow(_ r: NavRoute, alongM: Double, behindM: Double = LIVE_MAP.behindM, aheadM: Double = LIVE_MAP.aheadM) -> [LatLon] {
    guard r.points.count >= 2, r.segStartM.count == r.points.count - 1 else { return r.points }
    let from = alongM - behindM, to = alongM + aheadM
    var out: [LatLon] = []
    for i in r.points.indices {
        let m = i < r.segStartM.count ? r.segStartM[i] : r.distanceM
        let next = i + 1 < r.segStartM.count ? r.segStartM[i + 1] : r.distanceM
        if next >= from && m <= to { out.append(r.points[i]) }
    }
    return out
}

/// A Static Images API kérés-URL-je. Logó és attribúció a képen nincs (120 pt-en a kép felét takarnák) – az app térképén ott
/// vannak; lásd a CLAUDE.md nyitott kérdését.
nonisolated func liveMapURL(_ r: LiveMapRequest, token: String) -> URL? {
    func path(_ pts: [LatLon], width: Int, hex: String, opacity: Double) -> String? {
        let thin = thinPoints(pts)
        guard thin.count >= 2 else { return nil }
        let enc = encodePolyline(thin).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return "path-\(width)+\(hex)-\(String(format: "%g", opacity))(\(enc))"
    }
    var overlays: [String] = []
    for s in r.sections { if let p = path(s, width: 4, hex: r.sectionHex, opacity: 0.7) { overlays.append(p) } }
    if let p = path(r.route, width: 6, hex: r.routeHex, opacity: 1) { overlays.append(p) }
    if let a = r.active, let p = path(a, width: 6, hex: r.activeHex, opacity: 1) { overlays.append(p) }
    let cam = String(format: "%.5f,%.5f,%.2f,%.0f,0", r.center.lon, r.center.lat, r.zoom, (r.bearing.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360))
    let o = overlays.isEmpty ? "" : overlays.joined(separator: ",") + "/"
    let s = LIVE_MAP.sizePt
    let raw = "https://api.mapbox.com/styles/v1/\(LIVE_MAP.style)/static/\(o)\(cam)/\(s)x\(s)@2x?access_token=\(token)&logo=false&attribution=false"
    guard raw.count <= 8192 else { return nil }
    return URL(string: raw)
}

/// Az utolsó kép bélyege: mikor, hol, és melyik manővernél / állapotban készült.
nonisolated struct LiveMapStamp: Equatable, Sendable {
    var atMs: Double
    var pos: LatLon
    var key: String
}

/// Kell-e új kép (ActivityKit-költségvetés): manővernél / állapotváltáskor (`key`) azonnal; különben legfeljebb
/// `minGapMs`-enként, és csak, ha a pozíció `minMoveM`-nél többet mozdult.
nonisolated func liveMapDue(_ last: LiveMapStamp?, nowMs: Double, pos: LatLon, key: String) -> Bool {
    guard let last else { return true }
    if key != last.key { return true }
    return nowMs - last.atMs >= LIVE_MAP.minGapMs && haversineM(last.pos, pos) > LIVE_MAP.minMoveM
}

/// A kép csak akkor látszik, ha a középpontja `staleM`-en belül van a mostani pozíciótól.
nonisolated func liveMapShown(_ last: LiveMapStamp?, version: Int?, pos: LatLon?) -> Int? {
    guard let last, let version, let pos, haversineM(last.pos, pos) <= LIVE_MAP.staleM else { return nil }
    return version
}

/// `RRGGBB` egy token-színből.
func hexOf(_ c: Color) -> String {
    var (r, g, b, a): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
    UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
    return String(format: "%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
}

/// A térképkép letöltése és tárolása: egyszerre egy kérés; siker után a változat nő (a Live Activity ezt viszi tovább).
final class LiveMapRenderer {
    private(set) var version: Int?
    private(set) var stamp: LiveMapStamp?
    private var busy = false
    /// A mai kérések száma (a napló és a költségvetés kedvéért).
    private(set) var requests = 0
    var onImage: (() -> Void)?
    private let token: String? = {
        let v = Bundle.main.object(forInfoDictionaryKey: "MBXAccessToken") as? String
        return (v?.hasPrefix("pk.") ?? false) ? v : nil
    }()

    /// Van-e mivel képet kérni (token + App Group tároló).
    var available: Bool { token != nil && LiveMapStore.folder != nil }

    func reset() {
        version = nil
        stamp = nil
    }

    /// Új kép, ha esedékes (`liveMapDue`). A bélyeg a kérés pillanatában rögzül – hiba esetén sem kér újra azonnal.
    func refresh(_ request: @autoclosure () -> LiveMapRequest, key: String, nowMs: Double) {
        guard available, !busy, liveMapDue(stamp, nowMs: nowMs, pos: request().center, key: key) else { return }
        let r = request()
        guard let token, let url = liveMapURL(r, token: token) else {
            NSLog("LIVE-MAP: no request URL (too long?)")
            stamp = LiveMapStamp(atMs: nowMs, pos: r.center, key: key)
            return
        }
        busy = true
        requests += 1
        let next = (version ?? -1) + 1
        let at = LiveMapStamp(atMs: nowMs, pos: r.center, key: key)
        Task { [weak self] in
            defer { self?.busy = false }
            do {
                let (data, resp) = try await URLSession.shared.data(from: url)
                guard (resp as? HTTPURLResponse)?.statusCode == 200, let file = LiveMapStore.url(version: next) else {
                    NSLog("LIVE-MAP: HTTP %d", (resp as? HTTPURLResponse)?.statusCode ?? -1)
                    self?.stamp = at
                    return
                }
                try data.write(to: file, options: .atomic)
                self?.version = next
                self?.stamp = at
                NSLog("LIVE-MAP: image %d (%d bytes)", next, data.count)
                self?.onImage?()
            } catch {
                NSLog("LIVE-MAP: %@", String(describing: error))
                self?.stamp = at
            }
        }
    }
}
