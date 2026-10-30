import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/alternatives.ts portja (AOS12): az alternatív útvonal címkéje (AW11) és a
// „megéri”-szabály (AW12/AW13); a követő zoom a follow.ts `navFollowZoom`-ja.

/// A leágazás keresésének lépésköze az alternatíva mentén (m).
nonisolated private let DIVERGE_STEP_M = 25.0
/// AW17: a saját (nem közös) szakasz mintavételezése az alternatíva mentén (m).
nonisolated private let OWN_STEP_M = 100.0
/// AW17: a képernyős elhelyezéshez a teljes útvonalak legfeljebb ennyi ponttal (egyenletesen ritkítva).
nonisolated private let PATH_MAX_POINTS = 400

/// Az alternatív útvonal címkéje a térképen: kis buborék a menetidő-különbséggel a kiválasztotthoz képest.
nonisolated struct AltLabel: Identifiable, Equatable, Sendable {
    var routeId: String
    /// Az útvonal indexe a listában (a kiválasztás erre vált).
    var index: Int
    /// Méterben számolt horgony: a saját szakasz pontja, amely a kiválasztott útvonaltól a legmesszebb van. A végleges
    /// hely a képernyő-pontban számolt `placeAltLabel`; ez a tartalék, amíg nincs vetítés.
    var at: LatLon
    /// AW17: az alternatíva saját (nem közös) szakaszának pontjai, ~100 m-enként.
    var own: [LatLon]
    /// AW17: a leágazási pont (ezt a címke soha nem takarja).
    var divergence: LatLon
    /// AW17: a kiválasztott és az alternatív útvonal ritkítva (a takarás méréséhez).
    var basePath: [LatLon]
    var altPath: [LatLon]
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

/// Egyenletes ritkítás legfeljebb `max` pontra (az első és az utolsó pont mindig marad).
nonisolated private func thin(_ points: [LatLon], _ max: Int = PATH_MAX_POINTS) -> [LatLon] {
    if points.count <= max { return points }
    let step = Double(points.count - 1) / Double(max - 1)
    return (0..<max).map { points[Int(jsRound(Double($0) * step))] }
}

/// A nem kiválasztott útvonalak címkéi a menetidő (`durationsS`, az útvonalválasztó kártyájával azonos – a szakaszokon
/// a határral számolt) különbségével. AW17: a horgony nem fix 300 m a leágazás után, hanem az alternatíva saját (nem
/// közös) szakaszának a kiválasztottól legtávolabbi pontja – a képernyős helyet a `placeAltLabel` adja.
/// A kiválasztottal végig egyező alternatíva nem kap címkét.
nonisolated func altLabels(_ routes: [NavRoute], _ durationsS: [Double], _ selected: Int, lang: Lang? = nil) -> [AltLabel] {
    guard routes.indices.contains(selected), let rb = coreRoute(routes[selected]) else { return [] }
    let base = routes[selected]
    return routes.indices.compactMap { index in
        let r = routes[index]
        guard index != selected, let d = divergenceAlongM(base, r), let ra = coreRoute(r) else { return nil }
        var own: [LatLon] = []
        var at = ra.pointAt(d)
        var farM = -1.0
        var m = d
        while m <= ra.lengthM {
            let p = ra.pointAt(m)
            let cross = rb.project(p).crossM
            if cross > ROUTE_MATCH_M {
                own.append(p)
                if cross > farM {
                    farM = cross
                    at = p
                }
            }
            m += OWN_STEP_M
        }
        let deltaS = (index < durationsS.count ? durationsS[index] : r.durationS) - (selected < durationsS.count ? durationsS[selected] : base.durationS)
        return AltLabel(
            routeId: r.id, index: index, at: at, own: own, divergence: ra.pointAt(d), basePath: thin(base.points),
            altPath: thin(r.points), deltaS: deltaS, text: altDeltaText(deltaS, lang: lang)
        )
    }
}

/// Képernyő-pont (pt, a bal felső saroktól).
nonisolated struct Px: Equatable, Sendable {
    var x: Double
    var y: Double
}

/// A címke a horgonyhoz képest: fölötte, alatta, balra vagy jobbra.
nonisolated enum AltLabelSide: String, Sendable {
    case above, below, left, right
}

nonisolated struct LabelBox: Equatable, Sendable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

nonisolated struct AltLabelPlacement: Equatable, Sendable {
    /// A horgony: a saját szakasz pontja a kiválasztott útvonaltól messze.
    var anchor: Px
    var side: AltLabelSide
    /// A címke doboza (bal felső sarok + méret); a közepe a jelölő helye.
    var box: LabelBox
}

/// A címke és a horgony közti rés, a vonalak fél vastagsága (a takarás méréséhez), a leágazás védett köre és a
/// cél-jelölő mérete (pt; a jelölő alsó csúcsával áll a célon) – a webes `ALT_LABEL_PLACE`.
nonisolated enum ALT_LABEL_PLACE {
    static let gapPx = 6.0
    static let lineHalfPx = 5.0
    static let divergenceClearPx = 12.0
    static let destPinPx = 40.0
}

/// A horgony-jelöltek legfeljebb ennyien (egyenletesen ritkítva).
nonisolated private let LABEL_CANDIDATES_MAX = 80

/// Web Mercator vetítés a képernyőre (512-es csempe, mint a Mapbox), észak felfelé, dőlés nélkül; a `center` a nézet
/// közepén. A közös (TS = Swift) tesztek vetítése – az app a térkép saját vetítését használja.
nonisolated func mercatorScreen(_ p: LatLon, center: LatLon, zoom: Double, viewport: (w: Double, h: Double)) -> Px {
    let world = 512 * pow(2, zoom)
    func mx(_ lon: Double) -> Double { (lon + 180) / 360 * world }
    func my(_ lat: Double) -> Double {
        let s = sin(lat * .pi / 180)
        return (0.5 - log((1 + s) / (1 - s)) / (4 * .pi)) * world
    }
    return Px(x: viewport.w / 2 + mx(p.lon) - mx(center.lon), y: viewport.h / 2 + my(p.lat) - my(center.lat))
}

/// Az `a`–`b` szakasz `p`-hez legközelebbi pontja.
nonisolated private func segNearest(_ p: Px, _ a: Px, _ b: Px) -> Px {
    let dx = b.x - a.x
    let dy = b.y - a.y
    let len2 = dx * dx + dy * dy
    let u = len2 == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    return Px(x: a.x + u * dx, y: a.y + u * dy)
}

/// A `p` távolsága a vonallánctól, és a lánc hozzá legközelebbi pontja.
nonisolated private func polylineNearest(_ p: Px, _ line: [Px]) -> (d: Double, q: Px) {
    var best = (d: Double.infinity, q: p)
    for i in line.indices {
        let q = i + 1 < line.count ? segNearest(p, line[i], line[i + 1]) : line[i]
        let d = hypot(p.x - q.x, p.y - q.y)
        if d < best.d { best = (d, q) }
    }
    return best
}

/// Metszi-e az `a`–`b` szakasz a dobozt (Liang–Barsky vágás).
nonisolated private func segHitsBox(_ a: Px, _ b: Px, _ r: LabelBox) -> Bool {
    var t0 = 0.0
    var t1 = 1.0
    let dx = b.x - a.x
    let dy = b.y - a.y
    for (p, q) in [(-dx, a.x - r.x), (dx, r.x + r.w - a.x), (-dy, a.y - r.y), (dy, r.y + r.h - a.y)] {
        if p == 0 {
            if q < 0 { return false }
            continue
        }
        let t = q / p
        if p < 0 { t0 = max(t0, t) } else { t1 = min(t1, t) }
        if t0 > t1 { return false }
    }
    return true
}

/// Ennyi szakasza fut át a dobozon a vonalláncnak.
nonisolated private func hits(_ line: [Px], _ r: LabelBox) -> Int {
    guard line.count > 1 else { return 0 }
    return (0..<(line.count - 1)).filter { segHitsBox(line[$0], line[$0 + 1], r) }.count
}

nonisolated private let SIDES: [(side: AltLabelSide, dx: Double, dy: Double)] = [(.above, 0, -1), (.below, 0, 1), (.left, -1, 0), (.right, 1, 0)]

/// AW17: az alternatíva „+N perc” címkéjének helye az aktuális képernyő-vetítésben (pt, az aktuális zoomon) – a webes
/// `placeAltLabel` 1:1 portja. Horgony: a saját szakasz képernyőn látható pontja (ha egyik sem látszik, bármelyik), a
/// címke mellette – fölé, alá, balra vagy jobbra. Pontozás, fontossági sorrendben: 1. soha nem takarja a leágazást és a
/// célt (a cél-jelölő dobozát sem), 2. kifér a képernyőre, 3. a legkevesebb útvonal-szakaszt takarja, miközben a horgony
/// minél messzebb van a kiválasztottól (`6 · d`), 4. döntetlennél a kiválasztottól elfelé eső oldal. Ha sehol sem fér
/// ki, rálóghat.
nonisolated func placeAltLabel(own: [Px], base: [Px], alt: [Px], divergence: Px, label: (w: Double, h: Double), viewport: (w: Double, h: Double)) -> AltLabelPlacement? {
    guard !own.isEmpty else { return nil }
    func inView(_ p: Px) -> Bool { p.x >= 0 && p.y >= 0 && p.x <= viewport.w && p.y <= viewport.h }
    let visible = own.contains(where: inView) ? own.filter(inView) : own
    let stride = max(1, Int((Double(visible.count) / Double(LABEL_CANDIDATES_MAX)).rounded(.up)))
    let candidates = visible.enumerated().filter { $0.offset % stride == 0 }.map(\.element)
    let gap = ALT_LABEL_PLACE.gapPx
    let half = ALT_LABEL_PLACE.lineHalfPx
    let clear = ALT_LABEL_PLACE.divergenceClearPx
    let pin = ALT_LABEL_PLACE.destPinPx
    let dest = base.last
    var best: (placement: AltLabelPlacement, cost: Double)?
    for anchor in candidates {
        let near = polylineNearest(anchor, base)
        // elfelé: a kiválasztott útvonal legközelebbi pontjától a horgony felé
        let ax = anchor.x - near.q.x
        let ay = anchor.y - near.q.y
        let alen = hypot(ax, ay) == 0 ? 1 : hypot(ax, ay)
        for s in SIDES {
            let box = LabelBox(
                x: s.dx == 0 ? anchor.x - label.w / 2 : s.dx < 0 ? anchor.x - gap - label.w : anchor.x + gap,
                y: s.dy == 0 ? anchor.y - label.h / 2 : s.dy < 0 ? anchor.y - gap - label.h : anchor.y + gap,
                w: label.w,
                h: label.h
            )
            let grown = LabelBox(x: box.x - half, y: box.y - half, w: box.w + 2 * half, h: box.h + 2 * half)
            // a leágazás és a cél (a kiválasztott útvonal vége, a cél-jelölő) körül védett terület
            func close(_ q: Px) -> Bool { hypot(q.x - max(box.x, min(q.x, box.x + box.w)), q.y - max(box.y, min(q.y, box.y + box.h))) < clear }
            func onPin(_ q: Px) -> Bool { box.x < q.x + pin / 2 && box.x + box.w > q.x - pin / 2 && box.y < q.y && box.y + box.h > q.y - pin }
            let covers = close(divergence) || (dest.map { close($0) || onPin($0) } ?? false)
            let offscreen = box.x < 0 || box.y < 0 || box.x + box.w > viewport.w || box.y + box.h > viewport.h
            let away = (s.dx * ax + s.dy * ay) / alen
            let cost = (covers ? 100_000 : 0) + (offscreen ? 10_000 : 0) + 10 * Double(hits(base, grown) + hits(alt, grown)) - 6 * near.d - away
            if best == nil || cost < best!.cost { best = (AltLabelPlacement(anchor: anchor, side: s.side, box: box), cost) }
        }
    }
    return best?.placement
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

/// A kompakt (mérés közbeni) ajánlat két része: „Kijárat 56” / „2,1 km · −7 perc gyorsabb” (AW17: a „gyorsabb” szó
/// kötelező); név nélküli lehajtónál „Lehajtó 2,1 km-nél” / „−7 perc gyorsabb”, ismeretlen lehajtónál csak a cím.
/// `exitKm`: a lehajtóig hátralévő táv a nyelv tizedesjelével.
nonisolated func altOfferCompactLines(title: String, gainS: Double, exitAlongM: Double?, exitName: String?, exitKm: String, lang: Lang? = nil) -> (String, String?) {
    let n = String(max(1, Int(jsRound(gainS / 60))))
    if exitAlongM == nil { return (title, nil) }
    guard let name = exitName, !name.isEmpty else { return (t(.navOfferExitAt, ["km": exitKm], lang: lang), t(.navOfferCompactFaster, ["n": n], lang: lang)) }
    return (name, t(.navOfferCompactDetail, ["km": exitKm, "n": n], lang: lang))
}

/// AW17: a kompakt ajánlat egy sorban: „Kijárat 56 · 2,5 km · −7 perc gyorsabb” (a „gyorsabb” szó kötelező).
nonisolated func altOfferCompactText(title: String, gainS: Double, exitAlongM: Double?, exitName: String?, exitKm: String, lang: Lang? = nil) -> String {
    let (a, b) = altOfferCompactLines(title: title, gainS: gainS, exitAlongM: exitAlongM, exitName: exitName, exitKm: exitKm, lang: lang)
    return b.map { "\(a) · \($0)" } ?? a
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
