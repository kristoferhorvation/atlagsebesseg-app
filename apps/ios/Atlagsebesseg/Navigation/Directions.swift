import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/directions.ts portja (A11).

/// A Directions és a Geocoding nyelve (a webes `directionsLanguage`: az app nyelvének kódja).
nonisolated func directionsLanguage(_ lang: Lang) -> String { lang.rawValue }

/// A Directions-kérés címe: forgalmas profil, alternatívák, lépések, szalag- és hangutasítások, annotációk.
nonisolated func directionsUrl(from: LatLon, to: LatLon, lang: Lang, token: String, alternatives: Bool = true, heading: Double? = nil) -> URL {
    var q: [URLQueryItem] = [
        URLQueryItem(name: "alternatives", value: alternatives ? "true" : "false"),
        URLQueryItem(name: "steps", value: "true"),
        URLQueryItem(name: "banner_instructions", value: "true"),
        URLQueryItem(name: "voice_instructions", value: "true"),
        URLQueryItem(name: "voice_units", value: "metric"),
        URLQueryItem(name: "geometries", value: "geojson"),
        URLQueryItem(name: "overview", value: "full"),
        URLQueryItem(name: "annotations", value: "maxspeed,congestion,duration"),
        URLQueryItem(name: "language", value: directionsLanguage(lang)),
    ]
    // újratervezésnél a haladási irány: ne küldjön vissza ellenkező irányba
    if let heading, heading.isFinite { q.append(URLQueryItem(name: "bearings", value: "\(Int(jsRound(heading))),45;")) }
    q.append(URLQueryItem(name: "access_token", value: token))
    var c = URLComponents(string: "https://api.mapbox.com/directions/v5/mapbox/driving-traffic")!
    c.path += "/" + String(format: "%.6f,%.6f;%.6f,%.6f", from.lon, from.lat, to.lon, to.lat)
    c.queryItems = q
    return c.url!
}

nonisolated struct DirectionsError: Error, Equatable, Sendable {
    let code: String
    var message: String?
}

// MARK: laza JSON-olvasás (a webes `isObj` / `num` / `arr` megfelelői)

typealias JSONObj = [String: Any]

nonisolated func jsonNum(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
}

nonisolated func jsonArr(_ v: Any?) -> [Any] { (v as? [Any]) ?? [] }

nonisolated private func bannerText(_ v: Any?) -> BannerText? {
    guard let o = v as? JSONObj, let text = o["text"] as? String else { return nil }
    return BannerText(text: text, type: (o["type"] as? String) ?? "turn", modifier: o["modifier"] as? String, exit: exitOf(o["components"]))
}

/// A kijárat felirata: csak az `exit` és `exit-number` komponens („Kijárat 56”), a pajzs/sáv/egyéb nem.
nonisolated private func exitOf(_ components: Any?) -> String? {
    let parts: [String] = jsonArr(components).compactMap { c in
        guard let o = c as? JSONObj, let type = o["type"] as? String, type == "exit" || type == "exit-number",
              let text = (o["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        return text
    }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
}

nonisolated private func limitOf(_ v: Any?) -> Double? {
    guard let o = v as? JSONObj, (o["unknown"] as? Bool) != true, (o["none"] as? Bool) != true else { return nil }
    guard let s = jsonNum(o["speed"]), s > 0 else { return nil }
    return jsRound((o["unit"] as? String) == "mph" ? s * KMH_PER_MPH : s)
}

/// Stabil, csökkenő rendezés távolság szerint (a JS `sort` stabil – az azonos távolságúak sorrendje marad).
nonisolated func sortedDesc<T>(_ items: [T], by key: (T) -> Double) -> [T] {
    items.enumerated().sorted { a, b in
        let ka = key(a.element)
        let kb = key(b.element)
        return ka != kb ? ka > kb : a.offset < b.offset
    }.map(\.element)
}

/// A Directions-válasz (`routes[]`) feldolgozása. A szakasz-annotációk a geometria két pontja közötti
/// szakaszokhoz tartoznak; a távolságokat az útvonal névleges hosszára skálázzuk (mint a core `Route`).
nonisolated func parseDirections(_ json: Any?, idPrefix: String = "r") throws -> [NavRoute] {
    guard let o = json as? JSONObj else { throw DirectionsError(code: "invalid") }
    if let code = o["code"], (code as? String) != "Ok" {
        throw DirectionsError(code: (code as? String) ?? "\(code)", message: o["message"] as? String)
    }
    let routes = jsonArr(o["routes"]).compactMap { $0 as? JSONObj }
    if routes.isEmpty { throw DirectionsError(code: "NoRoute") }
    return try routes.enumerated().map { try parseRoute($0.element, id: "\(idPrefix)\($0.offset)") }
}

nonisolated func parseDirections(data: Data, idPrefix: String = "r") throws -> [NavRoute] {
    try parseDirections(try? JSONSerialization.jsonObject(with: data), idPrefix: idPrefix)
}

nonisolated private func parseRoute(_ r: JSONObj, id: String) throws -> NavRoute {
    let coords = jsonArr((r["geometry"] as? JSONObj)?["coordinates"])
    let points: [LatLon] = coords.compactMap { c in
        let a = jsonArr(c)
        guard a.count >= 2, let lon = jsonNum(a[0]), let lat = jsonNum(a[1]) else { return nil }
        return LatLon(lat: lat, lon: lon)
    }
    guard points.count >= 2 else { throw DirectionsError(code: "invalid") }
    let nSeg = points.count - 1

    // annotációk: a lábak egymás után fűzve
    var limits: [Double?] = []
    var congestion: [Congestion] = []
    var durations: [Double] = []
    var rawSteps: [JSONObj] = []
    for leg in jsonArr(r["legs"]).compactMap({ $0 as? JSONObj }) {
        let a = (leg["annotation"] as? JSONObj) ?? [:]
        limits += jsonArr(a["maxspeed"]).map(limitOf)
        congestion += jsonArr(a["congestion"]).map { (($0 as? String).flatMap(Congestion.init(rawValue:))) ?? .unknown }
        durations += jsonArr(a["duration"]).map { jsonNum($0) ?? 0 }
        rawSteps += jsonArr(leg["steps"]).compactMap { $0 as? JSONObj }
    }

    let lens = (1..<points.count).map { haversineM(points[$0 - 1], points[$0]) }
    let geom = lens.reduce(0, +)
    let nominal = jsonNum(r["distance"]) ?? geom
    let distanceM = nominal != 0 ? nominal : geom
    let scale = geom > 0 ? distanceM / geom : 1
    let durationS = jsonNum(r["duration"]) ?? 0
    var segStartM: [Double] = []
    var cum = 0.0
    for l in lens {
        segStartM.append(cum)
        cum += l * scale
    }
    // a hiányzó / rövid annotációt kitöltjük (ismeretlen határ, átlagos időarány)
    let avgDur = { (i: Int) in (durationS * (lens[i] * scale)) / (distanceM != 0 ? distanceM : 1) }
    func pad<T>(_ a: [T], _ f: (Int) -> T) -> [T] { (0..<nSeg).map { $0 < a.count ? a[$0] : f($0) } }

    var steps: [NavStep] = []
    var startM = 0.0
    for (i, s) in rawSteps.enumerated() {
        let next = i + 1 < rawSteps.count ? rawSteps[i + 1] : nil
        let man = (next?["maneuver"] as? JSONObj) ?? (s["maneuver"] as? JSONObj) ?? [:]
        let loc = jsonArr(man["location"])
        let banners: [NavBanner] = jsonArr(s["bannerInstructions"]).compactMap { b in
            guard let b = b as? JSONObj, let primary = bannerText(b["primary"]) else { return nil }
            return NavBanner(distanceAlongM: jsonNum(b["distanceAlongGeometry"]) ?? 0, primary: primary, secondary: bannerText(b["secondary"]), sub: bannerText(b["sub"]))
        }
        let voice: [NavVoice] = jsonArr(s["voiceInstructions"]).compactMap { v in
            guard let v = v as? JSONObj, let text = v["announcement"] as? String else { return nil }
            return NavVoice(distanceAlongM: jsonNum(v["distanceAlongGeometry"]) ?? 0, text: text)
        }
        let dist = jsonNum(s["distance"]) ?? 0
        steps.append(NavStep(
            index: i,
            distanceM: dist,
            durationS: jsonNum(s["duration"]) ?? 0,
            startM: startM,
            name: (s["name"] as? String) ?? "",
            endManeuver: NavManeuver(
                type: (man["type"] as? String) ?? "arrive",
                modifier: man["modifier"] as? String,
                instruction: (man["instruction"] as? String) ?? "",
                location: LatLon(lat: loc.count > 1 ? jsonNum(loc[1]) ?? 0 : 0, lon: loc.count > 0 ? jsonNum(loc[0]) ?? 0 : 0)
            ),
            banners: sortedDesc(banners, by: \.distanceAlongM),
            voice: sortedDesc(voice, by: \.distanceAlongM)
        ))
        startM += dist
    }

    return NavRoute(
        id: id,
        points: points,
        distanceM: distanceM,
        durationS: durationS,
        typicalDurationS: jsonNum(r["duration_typical"]),
        steps: steps,
        segStartM: segStartM,
        segLimitKmh: pad(limits) { _ in nil },
        segCongestion: pad(congestion) { _ in .unknown },
        segDurationS: pad(durations, avgDur)
    )
}

/// Szakaszindex az útvonal menti távolsághoz (bináris keresés).
nonisolated func segmentAt(_ route: NavRoute, _ alongM: Double) -> Int {
    let s = route.segStartM
    var lo = 0
    var hi = s.count - 1
    while lo < hi {
        let mid = (lo + hi + 1) >> 1
        if s[mid] <= alongM { lo = mid } else { hi = mid - 1 }
    }
    return lo
}

/// A sebességhatár az útvonal adott pontján (az annotációból); `nil`: nincs adat.
nonisolated func limitAt(_ route: NavRoute, _ alongM: Double) -> Double? {
    let i = segmentAt(route, alongM)
    return i < route.segLimitKmh.count ? route.segLimitKmh[i] : nil
}

nonisolated enum CongestionLevel: String, Sendable {
    case normal, moderate, heavy
}

/// Egyforma dugó-szintű, egymás melletti szakaszok csoportjai a térképi színezéshez.
nonisolated func congestionRuns(_ route: NavRoute) -> [(points: [LatLon], level: CongestionLevel)] {
    func level(_ c: Congestion) -> CongestionLevel { c == .moderate ? .moderate : c == .heavy || c == .severe ? .heavy : .normal }
    var runs: [(points: [LatLon], level: CongestionLevel)] = []
    for (i, c) in route.segCongestion.enumerated() {
        let l = level(c)
        if let last = runs.last, last.level == l {
            runs[runs.count - 1].points.append(route.points[i + 1])
        } else {
            runs.append(([route.points[i], route.points[i + 1]], l))
        }
    }
    return runs
}

/// A dugó miatti késés másodpercben (a tipikus időhöz képest), 0 alá nem megy.
nonisolated func trafficDelayS(_ route: NavRoute) -> Double {
    guard let typical = route.typicalDurationS else { return 0 }
    return max(0, jsRound(route.durationS - typical))
}
