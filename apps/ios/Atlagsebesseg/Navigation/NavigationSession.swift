import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/session.ts portja (A11; AOS12: az AW12/AW13-szabályok) – ugyanaz az állapotgép,
// ugyanazokkal a küszöbökkel.

nonisolated enum VoiceKind: String, Sendable {
    case instruction, section, tooFast, reroute, faster
}

/// Egy bemondandó mondat; a hang-réteg (AVSpeechSynthesizer) olvassa fel.
nonisolated struct VoiceEvent: Equatable, Sendable {
    var id: String
    var kind: VoiceKind
    var text: String
}

nonisolated struct ManeuverView: Equatable, Sendable {
    var icon: ManeuverIcon
    /// A szalag szövege (út / irány), pl. „M1”.
    var text: String
    /// A teljes mondat a Directions-től (az app nyelvén).
    var instruction: String
    /// A manőverig hátralévő távolság (m).
    var distanceM: Double
}

/// Kamera-közeledés: ennyi méteren belül (de legalább 250 m) borostyán sáv: `max(minM, leadS × sebesség)`.
nonisolated func cameraAlertM(_ speedMps: Double?) -> Double {
    max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS * max(0, speedMps ?? 0))
}

/// Az „Utána” sor szövege: a Directions szalagja, ha az nem a teljes utasítás-mondat (név nélküli manővernél az), különben
/// az utcanév / kijárat / rövid manőver-szó.
nonisolated func thenText(_ step: NavStep, _ after: NavStep?, _ icon: ManeuverIcon, lang: Lang? = nil) -> String {
    let banner = step.banners.last
    var instr = step.endManeuver.instruction.trimmingCharacters(in: .whitespacesAndNewlines)
    if instr.hasSuffix(".") || instr.hasSuffix("!") { instr.removeLast() }
    let text = banner?.primary.text.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let firstWord = { (s: String) in s.split(separator: " ", omittingEmptySubsequences: false).first.map(String.init) ?? "" }
    // név nélküli manővernél a Directions a szalagra is a mondatot teszi (esetleg kissé átfogalmazva)
    let sentence = text.isEmpty || (!instr.isEmpty && (instr.hasPrefix(text) || (text.contains(",") && firstWord(instr) == firstWord(text))))
    if icon != .arrive {
        if !sentence { return text }
        if let name = after?.name.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty { return name }
        if let exit = banner?.primary.exit, !exit.isEmpty { return exit }
    }
    return L10nKey(rawValue: "nav.man.\(icon.rawValue)").map { t($0, lang: lang) } ?? ""
}

nonisolated struct AlternativeOffer: Equatable, Sendable {
    var id: String
    var route: NavRoute
    /// Nyereség a jelenlegi útvonalhoz képest (s).
    var gainS: Double
    /// Többlet-táv a jelenlegi útvonal hátralévő részéhez képest (m; negatív = rövidebb).
    var extraM: Double
    /// Megéri / lehet / nem éri meg (a „megéri”-szabály, `ALT_OFFER`); lejáratkor csak a „megéri” fogadódik el.
    var verdict: AltVerdict
    /// A kártya címe („Megéri · −7 perc, +4 km”).
    var title: String
    var expiresAt: Double
    /// A lehajtó (az alternatíva első új manővere) helye az aktuális útvonal mentén (m); `nil`, ha nem állapítható meg.
    var exitAlongM: Double?
    /// A lehajtó manőver neve (pl. a kijárat), ha van.
    var exitName: String?
    /// A leágazásig hátralévő távolság (m) – a nézetben élőben számolva.
    var exitInM: Double
    /// Ugyanez km-ben, a nyelv tizedesjelével (a feliratokhoz).
    var exitKm: String
    /// Mérés közben megjelenő, kompakt forma.
    var compact: Bool
    /// A lejáratig hátralévő idő aránya (1 → 0) – a kiemelt gomb alatti fogyó csík (AW13).
    var timeLeft: Double
}

/// Az ajánlat jelöltje: az alternatíva és a lehajtója.
nonisolated private struct Candidate {
    var route: NavRoute
    var gainS: Double
    var extraM: Double
    var worth: AltWorth
    var exitAlongM: Double?
    var exitName: String?
}

nonisolated enum NavPhase: String, Sendable {
    case navigating, arrived
}

nonisolated struct NavUpcoming: Equatable, Sendable {
    var item: EnforcementItem
    var distanceM: Double
}

nonisolated struct NavView: Sendable {
    var phase: NavPhase
    /// Nő, ha új útvonal vette át a helyet (a térkép újrarajzolja).
    var routeVersion: Int
    var route: NavRoute
    var destination: NavDestination
    var alongM: Double
    var crossM: Double
    var remainingM: Double
    /// Hátralévő idő (s) a szakaszokon a határral számolva.
    var remainingS: Double
    var etaMs: Double
    var next: ManeuverView
    var then: ManeuverView?
    /// Az útvonal sebességhatára (maxspeed-annotáció); `nil`: nincs adat.
    var limitKmh: Double?
    /// A legközelebbi, még nem érintett szakasz / kamera / mérés az előre jelzési távolságon belül.
    var upcoming: NavUpcoming?
    /// A kamera a `cameraAlertM` távolságon belül (a felső sáv borostyán); elhaladás után `nil`.
    var cameraNear: NavUpcoming?
    var enforcement: [EnforcementItem]
    var offRoute: Bool
    var rerouting: Bool
    var offer: AlternativeOffer?
    /// Az utolsó újratervezés sikertelen volt (a következő kísérletig).
    var rerouteFailed: Bool
}

/// Egy útvonal ujjlenyomata (az elvetett ajánlat újbóli felbukkanásának megakadályozásához).
nonisolated func routeSignature(_ r: NavRoute) -> String {
    let mid = r.points[r.points.count / 2]
    return "\(Int(jsRound(r.distanceM / 200))):\(String(format: "%.3f", mid.lat)),\(String(format: "%.3f", mid.lon))"
}

/// A navigáció állapotgépe (platformfüggetlen): pozíció-illesztés az útvonalra, lépés- és
/// manőver-követés, letérés → újratervezés, alternatíva-figyelés, szakaszellenőrzés-tudatos ETA,
/// bemondandó mondatok. Az UI csak kirajzol (`view()`), és a `drainVoice()`-t olvassa fel.
final class NavigationSession {
    let destination: NavDestination
    private let cfg: NavConfig
    private let fetchRoutes: RouteFetcher
    private let clock: () -> Double
    private var unit: SpeedUnit
    private var voiceOn: Bool
    /// A feliratok nyelve (`nil`: a rendszeré; a tesztek magyarul).
    private let lang: Lang?

    private var route: NavRoute
    private var core: Route?
    private var items: [EnforcementItem] = []
    private var cum: [Double] = [0]
    private var data = EnforcementData.none
    private var routeVersion = 0

    private var along = 0.0
    private var cross = 0.0
    private var lastFix: GpsFix?
    private var arrived = false

    private var offSince: Double?
    /// Az „Újratervezés” ennél a letérésnél már elhangzott (a letérés kezdetén, a kiírással együtt).
    private var rerouteSaid = false
    private var rerouting = false
    private var rerouteFailed = false
    private var lastRerouteAt: Double?
    private var lastCallAt: Double?
    private var lastAltAt: Double
    private var altPending = false
    private var offer: AlternativeOffer?
    /// Mérés közben visszatartott ajánlat: a mérés végén jelenik meg, friss lejárati idővel.
    private var held: Candidate?
    /// Az az ajánlat, amelynél a 500 m-es második bemondás már elhangzott (vagy fölösleges).
    private var exit500For: String?
    private var measuring = false
    private var declined = Set<String>()

    private var spoken = Set<String>()
    private var voiceQueue: [VoiceEvent] = []
    private var voiceSeq = 0
    private var measureStatus: SpeedStatus?
    private var lastTooFastAt: Double?
    private var disposed = false
    private var cached: NavView?
    /// A futó Directions-kérések (a `settle()` várja be őket).
    private var pending: [Task<Void, Never>] = []

    /// Minden változás után (a nézet frissül, a hang-réteg kiolvassa a sort).
    var onChange: (() -> Void)?

    init(route: NavRoute, destination: NavDestination, fetchRoutes: @escaping RouteFetcher, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 },
         config: NavConfig = NAV_CONFIG, unit: SpeedUnit = .kmh, voice: Bool = true, lang: Lang? = nil) {
        self.destination = destination
        cfg = config
        self.fetchRoutes = fetchRoutes
        clock = now
        self.unit = unit
        voiceOn = voice
        self.lang = lang
        self.route = route
        lastAltAt = now()
        install(route)
    }

    // MARK: beállítások, bemenetek

    func setUnit(_ unit: SpeedUnit) {
        self.unit = unit
    }

    /// Hangos utasítások ki / be; kikapcsolva a bemondandók eldobódnak (nem halmozódnak).
    func setVoice(_ on: Bool) {
        voiceOn = on
        if !on { voiceQueue = [] }
    }

    /// A környék szakaszai, kamerái, tervezett mérései (az adat később is érkezhet, újraszámol).
    func setData(_ data: EnforcementData) {
        self.data = data
        recomputeEnforcement()
        changed()
    }

    /// A mérés állapota: „Túl gyors”-ra váltáskor bemondja (legfeljebb 30 mp-enként).
    func setMeasureStatus(_ status: SpeedStatus?) {
        let was = measureStatus
        measureStatus = status
        if status != .tulGyors || was == .tulGyors { return }
        let t0 = clock()
        if let last = lastTooFastAt, t0 - last < cfg.tooFastRepeatMs { return }
        lastTooFastAt = t0
        say(.tooFast, t(.navVoiceTooFast, lang: lang))
    }

    /// Aktív mérés (szakasz vagy kézi): a végkaputól 1 km-nél távolabbi lehajtójú ajánlat a mérés végéig vár (a TTL
    /// akkor indul); a közelebbi azonnal, kompakt formában jelenik meg (AW13).
    func setMeasuring(_ measuring: Bool) {
        if measuring == self.measuring { return }
        self.measuring = measuring
        if measuring, let o = offer, !exitNearSectionEnd(o.exitAlongM) {
            held = Candidate(route: o.route, gainS: o.gainS, extraM: o.extraM, worth: altWorth(o.gainS, o.extraM, routeAvgKmh(o.route)), exitAlongM: o.exitAlongM, exitName: o.exitName)
            offer = nil
        } else if !measuring, let h = held {
            held = nil
            present(h)
        }
        changed()
    }

    func dispose() {
        disposed = true
        onChange = nil
    }

    // MARK: fix és óra

    @discardableResult
    func onFix(_ fix: GpsFix) -> NavView {
        let first = lastFix == nil
        lastFix = fix
        if !arrived { project(fix, useHint: !first) }
        advance(clock(), accuracy: fix.accuracy)
        changed()
        return view()
    }

    /// Fix nélküli frissítés (másodpercenként): időzítők, ajánlat lejárata.
    @discardableResult
    func tick() -> NavView {
        advance(clock(), accuracy: nil)
        changed()
        return view()
    }

    private func project(_ fix: GpsFix, useHint: Bool) {
        guard let core else { return }
        let hint = useHint ? ProjectionHint(fromM: along - 300, toM: along + 3000) : nil
        var p = core.project(fix, hint: hint)
        // a tipp-tartományon kívüli útvonalrészre (lerövidítés) is visszatalálunk
        if hint != nil, p.crossM > cfg.offRouteM {
            let full = core.project(fix)
            if full.crossM < p.crossM { p = full }
        }
        along = min(route.distanceM, max(0, p.alongM))
        cross = p.crossM
    }

    private func advance(_ t0: Double, accuracy: Double?) {
        if arrived { return }
        if lastFix != nil, route.distanceM - along <= cfg.arriveM {
            arrived = true
            offer = nil
            offSince = nil
            collectVoice()
            return
        }
        collectVoice()

        // letérés: 50 m-nél távolabb, 5 mp-ig (nagyon pontatlan fixnél nem ítélünk)
        if accuracy == nil || accuracy! <= 80 {
            if cross <= cfg.offRouteM {
                offSince = nil
                rerouteSaid = false
            } else if offSince == nil {
                offSince = t0
                // a hang a sárga „Újratervezés” kiírással együtt szól, nem az új útvonal megérkezésekor
                if !rerouting && !rerouteSaid {
                    rerouteSaid = true
                    say(.reroute, t(.navVoiceRerouting, lang: lang))
                }
            }
        }
        if let since = offSince, t0 - since >= cfg.offRouteMs, !rerouting, let fix = lastFix, canRoute(t0, lastRerouteAt, cfg.rerouteMinGapMs) {
            startReroute(fix, t0)
        }

        // lejárat: a „megéri” magától elfogadódik, a „lehet” / „nem éri meg” esetén marad a régi
        if let o = offer, t0 >= o.expiresAt {
            if o.verdict == .worth { acceptOffer() } else { declineOffer() }
        }
        // a leágazást elhagytuk: az ajánlat érvénytelen
        if let x = offer?.exitAlongM, along > x + 50 { offer = nil }
        if let x = held?.exitAlongM, along > x + 50 { held = nil }
        // Waze-minta: a lehajtó előtt 500 m-nél még egyszer
        if let o = offer, o.verdict != .not, let x = o.exitAlongM, exit500For != o.id, x - along <= 500 {
            exit500For = o.id
            say(.faster, t(.navVoiceFasterExit500, lang: lang))
        }

        // alternatíva-figyelés: 2 percenként, ha minden rendben
        if let fix = lastFix, !rerouting, !altPending, offSince == nil, offer == nil, held == nil || measuring,
           t0 - lastAltAt >= cfg.altCheckEveryMs, canRoute(t0, lastCallAt, cfg.directionsMinGapMs) {
            startAltCheck(fix, t0)
        }
    }

    /// Új kérés indulhat: a saját korlát (`gap`) és az általános Directions-korlát is eltelt.
    private func canRoute(_ t0: Double, _ last: Double?, _ gap: Double) -> Bool {
        (last == nil || t0 - last! >= gap) && (lastCallAt == nil || t0 - lastCallAt! >= cfg.directionsMinGapMs)
    }

    // MARK: újratervezés és alternatívák

    private func startReroute(_ fix: GpsFix, _ t0: Double) {
        rerouting = true
        rerouteFailed = false
        lastRerouteAt = t0
        lastCallAt = t0
        offer = nil
        held = nil
        if !rerouteSaid {
            rerouteSaid = true
            say(.reroute, t(.navVoiceRerouting, lang: lang))
        }
        let req = fetchRoutes(LatLon(lat: fix.lat, lon: fix.lon), destination.routeTarget, RouteRequestContext(heading: fix.heading, reason: .reroute))
        track { [weak self] in
            let result = await req.result
            guard let self, !self.disposed else { return }
            self.rerouting = false
            if case .success(let routes) = result, let r = routes.first {
                self.install(r)
                self.offSince = nil
                self.rerouteSaid = false
                self.lastAltAt = self.clock()
            } else {
                self.rerouteFailed = true
            }
            self.changed()
        }
        changed()
    }

    private func startAltCheck(_ fix: GpsFix, _ t0: Double) {
        altPending = true
        lastAltAt = t0
        lastCallAt = t0
        let version = routeVersion
        let req = fetchRoutes(LatLon(lat: fix.lat, lon: fix.lon), destination.routeTarget, RouteRequestContext(heading: fix.heading, reason: .alternatives))
        track { [weak self] in
            let result = await req.result
            guard let self, !self.disposed else { return }
            self.altPending = false
            guard case .success(let routes) = result else { return }
            if version == self.routeVersion && !self.rerouting { self.evaluateAlternatives(routes) }
            self.changed()
        }
    }

    private func track(_ body: @escaping () async -> Void) {
        pending.append(Task { await body() })
    }

    /// A függő Directions-válaszok feldolgozásának bevárása (teszthez; a webes `flush()` megfelelője).
    func settle() async {
        while !pending.isEmpty {
            let p = pending
            pending = []
            for task in p { await task.value }
        }
    }

    /// ETA-jellegű idő (s) egy útvonalra: a szakaszokon a határral.
    private func durationOf(_ route: NavRoute) -> Double {
        let items = routeEnforcement(route, data, now: clock(), bandM: cfg.enforcementBandM)
        return cumulative(adjustedDurations(route, items)).last!
    }

    private func evaluateAlternatives(_ routes: [NavRoute]) {
        // a jelenlegi útvonal friss (forgalmas) idejét a vele egyező útvonal adja; ha nincs ilyen, a saját becslésünk
        let sameIndex = routes.firstIndex { routeOverlap(route, $0) >= 0.9 }
        let baseline = sameIndex.map { durationOf(routes[$0]) } ?? remainingS()
        let baseM = sameIndex.map { routes[$0].distanceM } ?? route.distanceM - along
        // legalább 2 perc nyereség; a jelöltek közül a „megéri”-szabály szerint legjobb (legnagyobb nettó nyereség)
        var best: (route: NavRoute, gainS: Double, extraM: Double, worth: AltWorth)?
        for (i, r) in routes.enumerated() {
            if i == sameIndex || declined.contains(routeSignature(r)) { continue }
            let gainS = baseline - durationOf(r)
            if gainS < ALT_OFFER.minGainS { continue }
            let extraM = r.distanceM - baseM
            let worth = altWorth(gainS, extraM, routeAvgKmh(r))
            if best == nil || worth.net > best!.worth.net { best = (r, gainS, extraM, worth) }
        }
        guard let best else { return }
        let exit = firstNewManeuver(route, best.route)
        present(Candidate(route: best.route, gainS: best.gainS, extraM: best.extraM, worth: best.worth, exitAlongM: exit.map { along + $0.distanceM }, exitName: exit?.name))
    }

    /// A mérés alatt álló szakasz (a pozíció a kapui között); kézi mérésnél nincs.
    private func measuredSection() -> EnforcementItem? {
        items.first { $0.kind == .section && $0.startM <= along && along <= $0.endM }
    }

    /// A leágazás a mérés alatt álló szakasz végkapuja előtt vagy utána legfeljebb `exitAfterGateM`-rel van-e (AW13):
    /// ilyenkor mérés közben is azonnal ajánlunk. Kézi mérésnél nincs végkapu → nem.
    private func exitNearSectionEnd(_ exitAlongM: Double?) -> Bool {
        guard let x = exitAlongM, let sec = measuredSection() else { return false }
        return x <= sec.endM + ALT_OFFER.exitAfterGateM
    }

    /// Az ajánlat megjelenítése (és bemondása); mérés közben a végkaputól 1 km-nél távolabbi lehajtót visszatartjuk.
    private func present(_ best: Candidate) {
        if measuring && !exitNearSectionEnd(best.exitAlongM) {
            held = best
            return
        }
        voiceSeq += 1
        let w = best.worth
        let o = AlternativeOffer(
            id: "offer-\(voiceSeq)", route: best.route, gainS: best.gainS, extraM: best.extraM, verdict: w.verdict, title: altOfferTitle(w, lang: lang),
            expiresAt: clock() + cfg.offerTtlMs, exitAlongM: best.exitAlongM, exitName: best.exitName, exitInM: 0, exitKm: "", compact: false, timeLeft: 1
        )
        offer = o
        // a második (500 m-es) bemondás fölösleges, ha az első is 600 m-en belül hangzik el
        exit500For = best.exitAlongM.map { $0 - along <= 600 } == true ? o.id : nil
        say(.faster, altOfferVoice(w, exitKm: best.exitAlongM.map { exitKm($0 - along) }, lang: lang))
    }

    private func offerView(_ o: AlternativeOffer) -> AlternativeOffer {
        var v = o
        v.exitInM = o.exitAlongM.map { max(0, $0 - along) } ?? 0
        v.exitKm = exitKm(v.exitInM)
        v.compact = measuring
        v.timeLeft = min(1, max(0, (o.expiresAt - clock()) / cfg.offerTtlMs))
        return v
    }

    private func exitKm(_ m: Double) -> String {
        decimal1(max(0, m) / 1000, lang: lang ?? L10n.lang)
    }

    func acceptOffer() {
        guard let o = offer else { return }
        offer = nil
        install(o.route)
        offSince = nil
        changed()
    }

    func declineOffer() {
        if let o = offer { declined.insert(routeSignature(o.route)) }
        offer = nil
        changed()
    }

    // MARK: útvonal beállítása

    private func install(_ route: NavRoute) {
        self.route = route
        core = coreRoute(route)
        routeVersion += 1
        spoken = []
        along = 0
        cross = 0
        recomputeEnforcement()
        // az új útvonal a jelenlegi pozícióról indul: újra illesztünk
        if let fix = lastFix { project(fix, useHint: false) }
    }

    private func recomputeEnforcement() {
        items = routeEnforcement(route, data, now: clock(), bandM: cfg.enforcementBandM)
        cum = cumulative(adjustedDurations(route, items))
    }

    private func remainingS() -> Double {
        remainingSeconds(route, cum, along)
    }

    // MARK: hang

    private func say(_ kind: VoiceKind, _ text: String) {
        guard voiceOn, !text.isEmpty else { return }
        voiceSeq += 1
        voiceQueue.append(VoiceEvent(id: "v\(voiceSeq)", kind: kind, text: text))
    }

    /// A bemondandók kiolvasása (a sor kiürül).
    func drainVoice() -> [VoiceEvent] {
        let q = voiceQueue
        voiceQueue = []
        return q
    }

    private func stepIndex() -> Int {
        let s = route.steps
        var lo = 0
        var hi = s.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) >> 1
            if s[mid].startM <= along { lo = mid } else { hi = mid - 1 }
        }
        return max(0, lo)
    }

    /// A fordulók hangutasításai (Directions) és a szakaszellenőrzés-közeledés.
    private func collectVoice() {
        if !route.steps.isEmpty {
            let step = route.steps[stepIndex()]
            let left = step.startM + step.distanceM - along
            let due = sortedDesc(step.voice, by: \.distanceAlongM).filter { !spoken.contains("\(step.index):\($0.distanceAlongM)") && left <= $0.distanceAlongM }
            for v in due { spoken.insert("\(step.index):\(v.distanceAlongM)") }
            // ha egyszerre több esedékes (gyors haladás), csak a legközelebbit mondjuk
            if let latest = due.last { say(.instruction, latest.text) }
        }
        for it in items where it.kind == .section && !spoken.contains("enf:\(it.id)") {
            let d = it.startM - along
            if d > 0 && d <= cfg.enforcementVoiceM {
                spoken.insert("enf:\(it.id)")
                say(.section, t(.navVoiceSectionAhead, ["x": speedIn(it.limitKmh, unit).map(String.init) ?? ""], lang: lang))
            }
        }
    }

    // MARK: nézet

    private func changed() {
        cached = nil
        onChange?()
    }

    private func maneuverOf(_ step: NavStep, _ distanceM: Double, _ remainingInStep: Double) -> ManeuverView {
        let m = step.endManeuver
        // a szalag: a legkisebb küszöb, ami még ≥ a lépésből hátralévő távolság
        let banner = step.banners.reversed().first { $0.distanceAlongM >= remainingInStep } ?? step.banners.first
        let type = banner?.primary.type ?? m.type
        let modifier = banner != nil ? banner!.primary.modifier : m.modifier
        let text = [banner?.primary.text ?? "", step.name, m.instruction].first { !$0.isEmpty } ?? ""
        return ManeuverView(icon: maneuverIcon(type, modifier), text: text, instruction: m.instruction, distanceM: distanceM)
    }

    func view() -> NavView {
        if let cached { return cached }
        let steps = route.steps
        let idx = stepIndex()
        var next = ManeuverView(icon: .straight, text: destination.name, instruction: "", distanceM: max(0, route.distanceM - along))
        var then: ManeuverView?
        if idx < steps.count {
            let step = steps[idx]
            let left = max(0, step.startM + step.distanceM - along)
            next = maneuverOf(step, left, left)
            if idx + 1 < steps.count, step.endManeuver.type != "arrive" {
                var m = maneuverOf(steps[idx + 1], steps[idx + 1].distanceM, 0)
                m.text = thenText(steps[idx + 1], idx + 2 < steps.count ? steps[idx + 2] : nil, m.icon, lang: lang)
                then = m
            }
        }
        let up = items.first { $0.startM > along && $0.startM - along <= cfg.enforcementWarnM }
        let camM = cameraAlertM(lastFix?.speed)
        let cam = arrived ? nil : items.first { $0.kind == .camera && $0.startM > along && $0.startM - along <= camM }
        let remainingS = arrived ? 0 : remainingS()
        let v = NavView(
            phase: arrived ? .arrived : .navigating,
            routeVersion: routeVersion,
            route: route,
            destination: destination,
            alongM: along,
            crossM: cross,
            remainingM: max(0, route.distanceM - along),
            remainingS: remainingS,
            etaMs: clock() + remainingS * 1000,
            next: next,
            then: then,
            limitKmh: limitAt(route, along),
            upcoming: up.map { NavUpcoming(item: $0, distanceM: $0.startM - along) },
            cameraNear: cam.map { NavUpcoming(item: $0, distanceM: $0.startM - along) },
            enforcement: items,
            offRoute: offSince != nil && cross > cfg.offRouteM,
            rerouting: rerouting,
            offer: offer.map(offerView),
            rerouteFailed: rerouteFailed
        )
        cached = v
        return v
    }
}
