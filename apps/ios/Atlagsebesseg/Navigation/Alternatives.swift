import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/alternatives.ts portja (AOS12): az alternatív útvonal címkéje (AW11) és a
// „megéri”-szabály (AW12/AW13); a követő zoom a follow.ts `navFollowZoom`-ja.

/// A címke ennyivel a leágazás után kerül az alternatívára (m).
nonisolated let ALT_LABEL_AFTER_M = 300.0
/// A leágazás keresésének lépésköze az alternatíva mentén (m).
nonisolated private let DIVERGE_STEP_M = 25.0

/// Az alternatív útvonal címkéje a térképen: kis buborék a menetidő-különbséggel a kiválasztotthoz képest.
nonisolated struct AltLabel: Identifiable, Equatable, Sendable {
    var routeId: String
    /// Az útvonal indexe a listában (a kiválasztás erre vált).
    var index: Int
    var at: LatLon
    /// Az alternatíva menetideje mínusz a kiválasztotté (s); pozitív = lassabb.
    var deltaS: Double
    var text: String

    var id: String { routeId }
}

/// A leágazás: az alternatíva menti első pont (m, az alternatíva elejétől), amely már nincs a `base`
/// `ROUTE_MATCH_M` sávjában. `nil`, ha az alternatíva végig a `base`-en halad.
nonisolated func divergenceAlongM(_ base: NavRoute, _ alt: NavRoute, bandM: Double = ROUTE_MATCH_M) -> Double? {
    guard let rb = coreRoute(base), let ra = coreRoute(alt) else { return nil }
    var d = 0.0
    while d <= ra.lengthM {
        if rb.project(ra.pointAt(d)).crossM > bandM { return d }
        d += DIVERGE_STEP_M
    }
    return nil
}

/// Menetidő-különbség szövege: „+1 perc”, „−2 perc”, egy percen belül „Ugyanannyi idő”.
nonisolated func altDeltaText(_ deltaS: Double, lang: Lang? = nil) -> String {
    let n = Int(jsRound(deltaS / 60))
    if n == 0 { return t(.navAltSame, lang: lang) }
    return t(n > 0 ? .navAltSlower : .navAltFaster, ["n": String(abs(n))], lang: lang)
}

/// A nem kiválasztott útvonalak címkéi: a leágazás után `afterM`-rel (de legfeljebb az útvonal végén), a
/// menetidő (`durationsS`, az útvonalválasztó kártyájával azonos – a szakaszokon a határral számolt) különbségével.
/// A kiválasztottal végig egyező alternatíva nem kap címkét.
nonisolated func altLabels(_ routes: [NavRoute], _ durationsS: [Double], _ selected: Int, afterM: Double = ALT_LABEL_AFTER_M, lang: Lang? = nil) -> [AltLabel] {
    guard routes.indices.contains(selected) else { return [] }
    let base = routes[selected]
    return routes.indices.compactMap { index in
        let r = routes[index]
        guard index != selected, let d = divergenceAlongM(base, r), let along = coreRoute(r) else { return nil }
        let deltaS = (index < durationsS.count ? durationsS[index] : r.durationS) - (selected < durationsS.count ? durationsS[selected] : base.durationS)
        return AltLabel(routeId: r.id, index: index, at: along.pointAt(min(d + afterM, along.lengthM)), deltaS: deltaS, text: altDeltaText(deltaS, lang: lang))
    }
}

/// Érintés egy útvonalra (vonal vagy címke): az új kiválasztott indexe; ismeretlen azonosítónál marad a régi.
nonisolated func selectRouteById(_ routes: [NavRoute], _ selected: Int, _ id: String) -> Int {
    routes.firstIndex { $0.id == id } ?? selected
}

// MARK: „Megéri”-szabály (AW12)

/// Az ajánlat kategóriája: megéri (lejáratkor elfogadja) / lehet / nem éri meg (lejáratkor marad a régi).
nonisolated enum AltVerdict: String, Sendable {
    case worth, maybe, not
}

nonisolated struct AltWorth: Equatable, Sendable {
    /// Nyereség (perc, pozitív = gyorsabb).
    var gainMin: Double
    /// Többlet-táv (km, pozitív = hosszabb).
    var extraKm: Double
    /// A kerülő ára (perc/km) az alternatíva átlagsebességéből.
    var k: Double = 0
    /// `gainMin − k · extraKm`.
    var net: Double = 0
    var verdict: AltVerdict
}

/// A kerülő ára (perc/km): `slowKmh`-ig `kSlow`, `fastKmh`-tól `kFast`, között lineáris.
nonisolated func detourCostPerKm(_ avgKmh: Double) -> Double {
    if !(avgKmh > ALT_OFFER.slowKmh) { return ALT_OFFER.kSlow }
    if avgKmh >= ALT_OFFER.fastKmh { return ALT_OFFER.kFast }
    return ALT_OFFER.kSlow + (avgKmh - ALT_OFFER.slowKmh) / (ALT_OFFER.fastKmh - ALT_OFFER.slowKmh) * (ALT_OFFER.kFast - ALT_OFFER.kSlow)
}

/// Az útvonal várható átlagsebessége (km/h) a Directions távolságából és idejéből.
nonisolated func routeAvgKmh(_ r: NavRoute) -> Double {
    r.durationS > 0 ? r.distanceM / r.durationS * 3.6 : 0
}

/// Megéri-e: `net = Δperc − k · Δkm`; `net ≥ worthNetMin` → megéri, `0 < net` → lehet, különben nem éri meg.
nonisolated func altWorth(_ gainS: Double, _ extraM: Double, _ avgKmh: Double) -> AltWorth {
    let gainMin = gainS / 60
    let extraKm = extraM / 1000
    let k = detourCostPerKm(avgKmh)
    let net = gainMin - k * extraKm
    let verdict: AltVerdict = net >= ALT_OFFER.worthNetMin ? .worth : net > 0 ? .maybe : .not
    return AltWorth(gainMin: gainMin, extraKm: extraKm, k: k, net: net, verdict: verdict)
}

/// Egész perc (legalább 1) és egész km a feliratokhoz; „lehet” / „nem éri meg” esetén a kerülő legalább 1 km.
nonisolated private func rounded(_ w: AltWorth) -> (n: Int, km: Int) {
    let n = max(1, Int(jsRound(w.gainMin)))
    let km = Int(jsRound(w.extraKm))
    return (n, w.verdict == .worth ? km : max(1, km))
}

/// A kártya címe: „Megéri · −7 perc, +4 km”, „Lehet · −2 perc, +1 km”, „Nem éri meg · +20 km kerülő, −10 perc”.
nonisolated func altOfferTitle(_ w: AltWorth, lang: Lang? = nil) -> String {
    let (n, km) = rounded(w)
    switch w.verdict {
    case .maybe: return t(.navOfferMaybe, ["n": String(n), "km": String(km)], lang: lang)
    case .not: return t(.navOfferNot, ["n": String(n), "km": String(km)], lang: lang)
    case .worth:
        if km == 0 { return t(.navOfferWorthNoKm, ["n": String(n)], lang: lang) }
        return t(.navOfferWorth, ["n": String(n), "km": km > 0 ? "+\(km)" : "−\(-km)"], lang: lang)
    }
}

/// A kompakt (mérés közbeni) ajánlat két sora: „Kijárat 56” / „2,1 km · −7 perc”; név nélküli lehajtónál „Lehajtó 2,1
/// km-nél” / „−7 perc”, ismeretlen lehajtónál csak a cím. `exitKm`: a lehajtóig hátralévő táv a nyelv tizedesjelével.
nonisolated func altOfferCompactLines(title: String, gainS: Double, exitAlongM: Double?, exitName: String?, exitKm: String, lang: Lang? = nil) -> (String, String?) {
    let n = String(max(1, Int(jsRound(gainS / 60))))
    if exitAlongM == nil { return (title, nil) }
    guard let name = exitName, !name.isEmpty else { return (t(.navOfferExitAt, ["km": exitKm], lang: lang), t(.navAltFaster, ["n": n], lang: lang)) }
    return (name, t(.navOfferCompactDetail, ["km": exitKm, "n": n], lang: lang))
}

/// A bemondás: „Gyorsabb út, 7 perc megtakarítás, lehajtó 5,2 kilométernél” (megéri; ismeretlen lehajtónál a lehajtó
/// nélkül) / „…, 2 perc, 1 kilométer kerülő, te döntesz” / „…, de nem éri meg, 20 kilométer kerülő”. `exitKm`: a
/// lehajtóig hátralévő táv a nyelv tizedesjelével.
nonisolated func altOfferVoice(_ w: AltWorth, exitKm: String? = nil, lang: Lang? = nil) -> String {
    let (n, km) = rounded(w)
    switch w.verdict {
    case .maybe: return t(.navVoiceFasterMaybe, ["n": String(n), "km": String(km)], lang: lang)
    case .not: return t(.navVoiceFasterNot, ["km": String(km)], lang: lang)
    case .worth:
        guard let exitKm else { return t(.navVoiceFaster, ["n": String(n)], lang: lang) }
        return t(.navVoiceFasterWorthExit, ["n": String(n), "km": exitKm], lang: lang)
    }
}

// MARK: követő kamera (follow.ts)

/// Navigáció közbeni követő zoom a sebességből (km/h): a `NAV_FOLLOW.zoomStops` között lineáris, a széleken állandó.
nonisolated func navFollowZoom(_ kmh: Double, stops: [(kmh: Double, zoom: Double)] = NAV_FOLLOW.zoomStops) -> Double {
    let v = kmh.isFinite ? max(0, kmh) : 0
    guard let first = stops.first, let last = stops.last else { return 0 }
    if v <= first.kmh { return first.zoom }
    for i in 1..<stops.count where v <= stops[i].kmh {
        let (s0, z0) = stops[i - 1]
        let (s1, z1) = stops[i]
        return z0 + (v - s0) / (s1 - s0) * (z1 - z0)
    }
    return last.zoom
}
