import AtlagsebessegCore
import Foundation

// A navigációs szimulátor (A11) – a webes apps/web/src/sim/navSim.ts portja. A szimulátor feliratai a CLAUDE.md
// szerint kivételek a szótár-szabály alól.

/// Budapest → Győr az M1-en: a Directions-válasz a közös fixtúrából jön (élő hívás nélkül); a keresés a helyi lista;
/// a letérés, az újratervezés és az alternatíva-figyelés válasza a fixtúra útvonalából számolt, hogy a bejátszás
/// determinisztikus legyen.
enum NavSim {
    /// A közös fixtúra (packages/app-logic/src/navigation/fixtures, a project.yml-ben erőforrásként).
    static func directionsJSON(bundle: Bundle = .main) throws -> Any {
        guard let url = bundle.url(forResource: "budapest-gyor.directions", withExtension: "json") else { throw CocoaError(.fileNoSuchFile) }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url))
    }

    static func mainRoutes() throws -> [NavRoute] { try parseDirections(try directionsJSON(), idPrefix: "sim") }

    /// AW18: a fixtúra két útvonala úgy, hogy a 2. `fasterS`-sel gyorsabb a 0.-nál (a webes `simMainRoutes(fasterAlt)`;
    /// élesben a Mapbox 0. útvonala 42 perc volt, az alternatíva 41).
    static func mainRoutes(fasterAltS: Double?) throws -> [NavRoute] {
        let routes = try mainRoutes()
        guard let f = fasterAltS, routes.count >= 2 else { return routes }
        var out = routes
        out[1] = scaleRouteDuration(routes[1], routes[0].durationS - f)
        return out
    }

    /// Az útvonal idejét `totalS`-re skálázza (a szakaszidőkkel és a lépésekkel együtt; a webes `scaleRouteDuration`).
    static func scaleRouteDuration(_ r: NavRoute, _ totalS: Double) -> NavRoute {
        let k = totalS / r.durationS
        var out = r
        out.durationS = totalS
        out.typicalDurationS = r.typicalDurationS.map { $0 * k }
        out.segDurationS = r.segDurationS.map { $0 * k }
        out.steps = r.steps.map { s in
            var x = s
            x.durationS = s.durationS * k
            return x
        }
        return out
    }

    /// AW18: a fő útvonal a dugóval: a `jam` szakasz ideje `extraS`-sel több (a webes `jammedRoute`).
    static func jammedRoute(_ main: NavRoute, _ jam: SimFixture.Nav.Jam) -> NavRoute {
        let idx = Set(main.segStartM.indices.filter { main.segStartM[$0] >= jam.fromM && main.segStartM[$0] < jam.toM })
        let base = idx.reduce(0.0) { $0 + main.segDurationS[$1] }
        guard base > 0 else { return main }
        let k = (base + jam.extraS) / base
        var out = main
        out.segDurationS = main.segDurationS.enumerated().map { idx.contains($0.offset) ? $0.element * k : $0.element }
        out.durationS = main.durationS + jam.extraS
        out.segCongestion = main.segCongestion.enumerated().map { idx.contains($0.offset) ? .severe : $0.element }
        return out
    }

    /// Helyi „keresés” (nincs hálózati hívás): ékezet- és kisbetű-független részegyezés.
    static func search(_ query: String, in places: [Place]) -> [Place] {
        let plain = { (s: String) in s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil) }
        let q = plain(query.trimmingCharacters(in: .whitespacesAndNewlines))
        return places.filter { plain($0.name).contains(q) || plain($0.address).contains(q) }
    }

    /// A szimulált alternatíva fajtája (`-alt worth|maybe|not|aftergate`, a webes `?navsim&alt=…`): a „megéri”-szabály
    /// három kategóriája, illetve egy, a mérés végkapuja után 500 m-rel lehajtó (megéri-kategóriájú) alternatíva – erre
    /// mérés közben is azonnal, kompakt kártyával és bemondással kell ajánlani (AW13).
    enum AltMode: String, CaseIterable, Sendable {
        case worth, maybe, not, aftergate
    }

    /// A szimulátor Directions-szolgáltatója: tervezés a fixtúrából, újratervezés / alternatíva a fixtúra útvonalából.
    /// `alt == nil` (`-alt off`, csak a képernyőképekhez): nincs szimulált alternatíva.
    /// AW18: `traffic` – a friss lekérések (alternatíva-figyelés, forgalom, újratervezés) a dugós fő útvonalból, alternatíva
    /// nélkül; `fasterAlt` – a tervezésnél a 2. útvonal gyorsabb; `rerouteFail` – az újratervezés HTTP 503-mal bukik.
    static func fetcher(main: NavRoute, nav: SimFixture.Nav, alt: AltMode? = .worth, traffic: Bool = false, fasterAlt: Bool = false, rerouteFail: Bool = false) -> RouteFetcher {
        var n = 0
        let core = coreRoute(main)
        let jammed = traffic ? nav.jam.map { jammedRoute(main, $0) } : nil
        let fasterAltS = fasterAlt ? (nav.fasterAltS ?? 60) : nil
        return { from, _, ctx in
            if ctx.reason != .plan { n += 1 }
            let k = n
            return Task {
                try await Task.sleep(nanoseconds: 120_000_000)
                if ctx.reason == .plan { return try mainRoutes(fasterAltS: fasterAltS) }
                if rerouteFail && ctx.reason == .reroute { throw DirectionsError(code: "http_503") }
                if let jammed { return [routeFrom(jammed, nav.detour, from, id: "sim-\(ctx.reason.rawValue)-\(k)")] }
                let here = routeFrom(main, nav.detour, from, id: "sim-\(ctx.reason.rawValue)-\(k)")
                guard ctx.reason == .alternatives, let alt else { return [here] }
                // alternatíva-figyelés: a jelenlegi útvonal frissített változata + egy gyorsabb, a kért kategóriával
                let a = nav.alts[alt.rawValue] ?? SimFixture.Nav.Alt(gainS: 420, extraM: 4000)
                let id = "sim-fast-\(alt.rawValue)-\(k)"
                if alt != .aftergate { return [here, fasterAlternative(here, id: id, gainS: a.gainS, extraM: a.extraM)] }
                // a kapu utáni lehajtó helyhez kötött: ha már elhagytuk, nincs ilyen alternatíva
                let exitM = nav.sectionEndM + nav.exitAfterGateM - (core?.project(from).alongM ?? 0)
                return exitM > 100 ? [here, fasterAlternative(here, id: id, gainS: a.gainS, extraM: a.extraM, exitM: exitM)] : [here]
            }
        }
    }

    // MARK: útvonal-műveletek

    private static let detourSpeedKmh = 50.0

    private static func lengths(_ points: [LatLon]) -> [Double] {
        points.count < 2 ? [] : (1..<points.count).map { haversineM(points[$0 - 1], points[$0]) }
    }

    /// Új útvonal: `head` pontjai (az utolsó a csatlakozási pont a fő útvonalon, `joinAlongM`-nél), majd a fő
    /// útvonal hátralévő része. A hátralévő lépések megmaradnak (az első csonkolva), elé egy szimulált lépés kerül.
    static func splice(_ main: NavRoute, _ head: [LatLon], _ joinAlongM: Double, id: String) -> NavRoute {
        let tailStart = main.segStartM.firstIndex { $0 > joinAlongM + 1 } ?? main.points.count - 1
        let headPts = head.enumerated().filter { $0.offset == 0 || haversineM(head[$0.offset - 1], $0.element) > 0.5 }.map(\.element)
        let tail = main.points[tailStart...].enumerated().filter { $0.offset > 0 || haversineM(headPts.last!, $0.element) > 0.5 }.map(\.element)
        let points = headPts + tail
        let lens = lengths(points)
        // a fej szakaszai (a csatlakozási pontig és az összekötő), majd a fő útvonal saját szakaszai
        let headSegs = points.count - tail.count
        var segStartM: [Double] = []
        var cum = 0.0
        for l in lens {
            segStartM.append(cum)
            cum += l
        }
        let tailFrom = main.segLimitKmh.count - (lens.count - headSegs)
        let segLimitKmh: [Double?] = Array(repeating: detourSpeedKmh, count: headSegs) + Array(main.segLimitKmh[tailFrom...])
        let segCongestion = Array(repeating: Congestion.low, count: headSegs) + Array(main.segCongestion[tailFrom...])
        let segDurationS = lens.prefix(headSegs).map { $0 / (detourSpeedKmh / 3.6) } + Array(main.segDurationS[tailFrom...])
        let headLen = lens.prefix(headSegs).reduce(0, +)

        // lépések: a csonkolt fő-lépések elé egy szimulált „haladjon tovább” lépés
        var rest: [NavStep] = []
        for s in main.steps {
            let end = s.startM + s.distanceM
            if end <= joinAlongM + 1 { continue }
            let cut = max(0, joinAlongM - s.startM)
            var c = s
            c.startM = headLen + max(0, s.startM - joinAlongM)
            c.distanceM = s.distanceM - cut
            c.durationS = s.durationS * ((s.distanceM - cut) / (s.distanceM != 0 ? s.distanceM : 1))
            rest.append(c)
        }
        let firstName = rest.first?.name ?? ""
        let headStep = NavStep(
            index: 0,
            distanceM: headLen,
            durationS: headLen / (detourSpeedKmh / 3.6),
            startM: 0,
            name: "",
            endManeuver: NavManeuver(type: "merge", modifier: "slight right", instruction: "Hajtson vissza az M1-re", location: points[min(headSegs, points.count - 1)]),
            banners: [NavBanner(distanceAlongM: headLen, primary: BannerText(text: firstName.isEmpty ? "M1" : firstName, type: "merge", modifier: "slight right"))],
            voice: [NavVoice(distanceAlongM: headLen, text: "Hajtson vissza az M1-re")]
        )
        let steps = ([headStep] + rest).enumerated().map { i, s in
            var c = s
            c.index = i
            return c
        }
        let durationS = segDurationS.reduce(0, +)
        return NavRoute(
            id: id, points: points, distanceM: cum, durationS: durationS, typicalDurationS: durationS, steps: steps,
            segStartM: segStartM, segLimitKmh: segLimitKmh, segCongestion: segCongestion, segDurationS: segDurationS
        )
    }

    /// Az útvonal a megadott pozícióból: a mellékúton a mellékút maradéka, különben a fő útvonal hátralévő része.
    static func routeFrom(_ main: NavRoute, _ detour: SimFixture.Nav.Detour, _ from: LatLon, id: String) -> NavRoute {
        let route = coreRoute(main)!
        let onMain = route.project(from)
        if onMain.crossM > 60, let dRoute = try? Route(detour.points) {
            let onDetour = dRoute.project(from)
            let rest = detour.points.enumerated().filter { $0.offset > 0 && dRoute.project($0.element).alongM > onDetour.alongM + 5 }.map(\.element)
            return splice(main, [from] + rest, detour.rejoinAlongM, id: id)
        }
        let join = min(main.distanceM - 5, onMain.alongM + 20)
        return splice(main, [from, route.pointAt(join)], join, id: id)
    }

    /// A szimulált lehajtó távolsága az alternatíva elejétől (m): a mérés közbeni ajánlatnál a szakaszon belül van.
    /// AW17: 400 → 800 m (a webes `SIM_EXIT_M`), mert a „Megéri” ajánlat 500 m-en belül magától elfogad.
    static let defaultExitM = 800.0

    /// Az első lépést a lehajtó helyén kettévágja: a lehajtó-manőver az, ami a jelenlegi útvonalon nincs meg.
    private static func withExit(_ steps: [NavStep], _ route: Route, _ exitM: Double) -> [NavStep] {
        guard let at = steps.firstIndex(where: { $0.startM < exitM && $0.startM + $0.distanceM > exitM + 50 }) else { return steps }
        let target = steps[at]
        let cut = exitM - target.startM
        var exit = target
        exit.distanceM = cut
        exit.durationS = target.durationS * (cut / target.distanceM)
        exit.endManeuver = NavManeuver(type: "off ramp", modifier: "right", instruction: "Hajtson le a lehajtón", location: route.pointAt(exitM))
        exit.banners = [NavBanner(distanceAlongM: cut, primary: BannerText(text: "Kijárat 56", type: "off ramp", modifier: "right", exit: "Kijárat 56"))]
        exit.voice = [NavVoice(distanceAlongM: cut, text: "Hajtson le a lehajtón")]
        var rest = target
        rest.startM = exitM
        rest.distanceM = target.distanceM - cut
        rest.durationS = target.durationS * (1 - cut / target.distanceM)
        return (Array(steps[..<at]) + [exit, rest] + Array(steps[(at + 1)...])).enumerated().map { k, s in
            var c = s
            c.index = k
            return c
        }
    }

    /// Gyorsabb (de más vonalú) alternatíva: a fő útvonal ívesen eltolva, a hátralévő időnél `gainS`-sel rövidebb,
    /// `extraM`-rel hosszabb; a lehajtó az elejétől `exitM` méterre.
    static func fasterAlternative(_ base: NavRoute, id: String, gainS: Double = 420, extraM: Double = 0, exitM: Double = defaultExitM) -> NavRoute {
        let n = base.points.count
        let points = base.points.enumerated().map { i, p in LatLon(lat: p.lat + 0.0042 * sin(Double.pi * Double(i) / Double(n - 1)), lon: p.lon) }
        let lens = lengths(points)
        let geom = lens.reduce(0, +)
        // a névleges hossz (mint a Directions `distance`): a fő útvonal + a kerülő; a geometriát erre skálázzuk
        let cum = base.distanceM + extraM
        var acc = 0.0
        let segStartM = lens.map { l -> Double in
            let s = acc
            acc += l * cum / geom
            return s
        }
        let total = base.segDurationS.reduce(0, +)
        let k = max(0.2, (total - gainS) / total)
        // a szimulált „visszahajtás” fejlépése csak a szimulátor műterméke (igazi, friss Directions-hívásban nincs): az
        // alternatíva nélküle indul. AW17-javítás: hossztól függetlenül (egy 200 m-es fejlépés lett a „lehajtó”, és a
        // „Megéri” ajánlat az 500 m-es szabály szerint azonnal átváltott)
        var baseSteps = base.steps
        if let head = base.steps.first, head.endManeuver.type == "merge", base.steps.count > 1 {
            baseSteps = Array(base.steps.dropFirst())
            baseSteps[0].startM = 0
            baseSteps[0].distanceM += head.distanceM
        }
        let ratio = cum / base.distanceM
        let shifted = baseSteps.map { s -> NavStep in
            // az első 0,8 km-en az alternatíva ugyanazt a vonalat követi; utána tér le (az ottani manőver a lehajtó)
            let eased = s.startM + s.distanceM > 800
            let f = min(1, (s.startM + s.distanceM) / base.distanceM)
            var c = s
            c.startM = s.startM * ratio
            c.distanceM = s.distanceM * ratio
            if eased { c.endManeuver.location.lat += 0.0042 * max(0.2, sin(Double.pi * f)) }
            return c
        }
        var r = base
        r.id = id
        r.points = points
        r.distanceM = cum
        r.durationS = total * k
        r.typicalDurationS = total * k
        r.segStartM = segStartM
        r.segDurationS = base.segDurationS.map { $0 * k }
        r.steps = withExit(shifted, try! Route(points, nominalLengthM: cum), exitM)
        return r
    }
}
