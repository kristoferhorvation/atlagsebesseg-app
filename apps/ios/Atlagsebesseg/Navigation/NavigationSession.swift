import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/session.ts portja (A11; AOS12: az AW12/AW13-szabályok) – ugyanaz az állapotgép,
// ugyanazokkal a küszöbökkel.

nonisolated enum VoiceKind: String, Sendable {
    case instruction, section, tooFast, reroute, faster, traffic
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
    /// AW18: sikertelen újratervezés után a következő automatikus próbáig hátralévő másodperc (koppintásra azonnal).
    var rerouteRetryInS: Int? = nil
    /// AW18: az indulási terv érkezési ideje (a „+N perc dugó” viszonyítási alapja).
    var plannedEtaMs: Double = 0
    /// AW18: „+N perc dugó” – a friss (Mapbox / helyi dugó) ETA legalább 3 perccel az indulási terv után; különben `nil`.
    var delayMin: Int? = nil
    /// AW18: helyi dugó-állapot (a mért tempó tartósan a várt alatt).
    var jam: Bool = false
    /// AW18: a „Dugóba kerültél? Igen / Nem” kártya látszik (dugóba lépéskor, 15 s-ig vagy válaszig).
    var jamAsk: Bool = false
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
    private let log: (String) -> Void
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
    /// AW18: egymás utáni sikertelen újratervezések; a következő próba ideje (növekvő várakozással).
    private var rerouteFailures = 0
    private var rerouteRetryAt: Double?
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

    // AW18: forgalom
    /// Az indulási terv érkezési ideje (ms).
    private var plannedEtaMs = 0.0
    /// A friss forgalmi útvonal (a jelenlegi útvonalon, `fromAlongM`-től), a szakaszokkal és a közösségi adattal számolt idővel.
    private var fresh: (route: NavRoute, cum: [Double], fromAlongM: Double, version: Int)?
    /// Volt már friss forgalmi adat (lekérés vagy újratervezés) – a „+N perc dugó” csak ettől (vagy dugóban) látszik.
    private var hasFresh = false
    /// Az alternatívák között nem volt meg a jelenlegi útvonal: forgalom-lekérés köztes ponttal esedékes.
    private var trafficViaDue = false
    private var trafficPending = false
    private var communityJams: [CommunityJam] = []
    /// A nyers (Directions) idők kumulálva – a várt tempóhoz.
    private var rawCum: [Double] = [0]
    private let jamDetector = JamDetector()
    private var jamAskUntil: Double?
    private var jamAskKey: String?
    private var jamDeclined = Set<String>()
    private var lastJamUploadAt: Double?
    private var jamUploads: [JamSampleInsert] = []
    private var delaySaid: (at: Double, min: Int)?

    /// Minden változás után (a nézet frissül, a hang-réteg kiolvassa a sort).
    var onChange: (() -> Void)?

    init(route: NavRoute, destination: NavDestination, fetchRoutes: @escaping RouteFetcher, now: @escaping () -> Double = { Date().timeIntervalSince1970 * 1000 },
         config: NavConfig = NAV_CONFIG, unit: SpeedUnit = .kmh, voice: Bool = true, lang: Lang? = nil,
         log: @escaping (String) -> Void = { print($0) }) {
        self.destination = destination
        self.log = log
        cfg = config
        self.fetchRoutes = fetchRoutes
        clock = now
        self.unit = unit
        voiceOn = voice
        self.lang = lang
        self.route = route
        lastAltAt = now()
        install(route)
        plannedEtaMs = clock() + remainingS() * 1000
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

    /// AW18: más felhasználók friss dugó-mintái (`active_jams`, a platform ~60 s-enként kéri); az érintett szakaszok ideje a
    /// mért átlaggal az ETA-ban.
    func setCommunityJams(_ jams: [CommunityJam]) {
        communityJams = jams
        recomputeEnforcement()
        if let f = fresh { fresh = (f.route, cumOf(f.route), f.fromAlongM, f.version) }
        changed()
    }

    /// AW18: „Dugóba kerültél?” válasz. Igen: a platform a „Dugó” bejelentést küldi (a meglévő folyamattal), itt a közösségi
    /// minta kerül a sorba; Nem: ebben az útban ugyanarra a szakaszra (a következő manőverig) nem kérdez újra.
    func answerJam(_ yes: Bool) {
        if let key = jamAskKey, !yes { jamDeclined.insert(key) }
        if yes { reportedJam() }
        jamAskUntil = nil
        changed()
    }

    /// AW18: kézi „Dugó” / „Beállt” bejelentés (vagy a kártya „Igen”-je): bejelentett közösségi minta a mért átlaggal.
    func reportedJam() {
        guard let f = lastFix else { return }
        jamUploads.append(jamSample(.bejelentett, lat: f.lat, lon: f.lon, heading: f.heading, avgMps: jamDetector.avgMps ?? max(0, f.speed ?? 0), lengthM: TRAFFIC.reportedLengthM))
    }

    /// AW18: a feltöltendő közösségi dugó-minták kiolvasása (a sor kiürül).
    func drainJamSamples() -> [JamSampleInsert] {
        let q = jamUploads
        jamUploads = []
        return q
    }

    /// AW18: koppintás a „nem sikerült” kártyára – azonnali újrapróba (a Directions 5 s-os korlátján belül a lehető leghamarabb).
    func retryReroute() {
        guard rerouteFailed, !rerouting else { return }
        rerouteRetryAt = max(clock(), (lastCallAt ?? -.infinity) + cfg.directionsMinGapMs)
        advance(clock(), accuracy: nil)
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
        // AW18: az indulási terv érkezési ideje az első fixnél (addigra a szakasz-adat is megvan)
        if first { plannedEtaMs = clock() + remainingS() * 1000 }
        if !arrived && cross <= cfg.offRouteM { watchJam(fix) }
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
        // AW17: a „megéri” ajánlat a lehajtó előtt 500 m-en belül magától elfogad (nem várja ki a 45 s-ot); a hang a kézi
        // elfogadáséval azonos (az új útvonal manőver-bemondása – ezért a bemondások összegyűjtése előtt), a 500 m-es
        // „Gyorsabb út” ismétlés így elmarad
        if let o = offer, o.verdict == .worth, let x = o.exitAlongM, x - along <= ALT_OFFER.autoSwitchExitM {
            acceptOffer()
        }
        collectVoice()

        // letérés: 50 m-nél távolabb, 5 mp-ig (nagyon pontatlan fixnél nem ítélünk)
        if accuracy == nil || accuracy! <= 80 {
            if cross <= cfg.offRouteM {
                offSince = nil
                rerouteSaid = false
                // visszatértünk az útvonalra: a sikertelen újratervezés már nem kell
                if rerouteFailed && !rerouting { clearRerouteFailure() }
            } else if offSince == nil {
                offSince = t0
                // a hang a sárga „Újratervezés” kiírással együtt szól, nem az új útvonal megérkezésekor
                if !rerouting && !rerouteSaid {
                    rerouteSaid = true
                    say(.reroute, t(.navVoiceRerouting, lang: lang))
                }
            }
        }
        // AW18: sikertelen próba után növekvő várakozással (5 → 10 → 20 → 30 s), egyébként legfeljebb 20 s-enként
        let rerouteDue = rerouteFailed
            ? rerouteRetryAt.map { t0 >= $0 } == true && canRoute(t0, nil, cfg.directionsMinGapMs)
            : canRoute(t0, lastRerouteAt, cfg.rerouteMinGapMs)
        if let since = offSince, t0 - since >= cfg.offRouteMs, !rerouting, let fix = lastFix, rerouteDue {
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

        // alternatíva-figyelés és forgalom-frissítés (AW18: egy hívás): 2 percenként, ha az útvonalon vagyunk – látható
        // ajánlat mellett is (az ETA miatt), de új ajánlat csak akkor jön, ha nincs másik
        if let fix = lastFix, !rerouting, !altPending, !trafficPending, offSince == nil,
           t0 - lastAltAt >= cfg.altCheckEveryMs, canRoute(t0, lastCallAt, cfg.directionsMinGapMs) {
            startAltCheck(fix, t0)
        }
        // a jelenlegi útvonal nem volt az alternatívák között: forgalom-lekérés köztes ponttal (a következő manőver)
        if trafficViaDue, let fix = lastFix, !rerouting, !altPending, !trafficPending, offSince == nil, canRoute(t0, nil, cfg.directionsMinGapMs) {
            startTrafficCheck(fix, t0)
        }

        updateTraffic(t0)
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
            switch result {
            case .success(let routes):
                if let r = routes.first {
                    // az újratervezés maga a friss driving-traffic lekérés a jelenlegi pozíciótól (AW18)
                    self.install(r)
                    self.hasFresh = true
                    self.offSince = nil
                    self.rerouteSaid = false
                    self.lastAltAt = self.clock()
                    self.clearRerouteFailure()
                } else {
                    self.rerouteFailedWith("NoRoute")
                }
            case .failure(let e):
                self.rerouteFailedWith(routeErrorKind(e))
            }
            self.changed()
        }
        changed()
    }

    /// AW18: sikertelen újratervezés – a következő próba növekvő várakozással; az ok a naplóba.
    private func rerouteFailedWith(_ kind: String) {
        rerouteFailed = true
        rerouteFailures += 1
        let wait = rerouteRetryDelayMs(rerouteFailures)
        rerouteRetryAt = clock() + wait
        log("[nav] reroute failed (\(kind)), attempt \(rerouteFailures), retry in \(Int(wait / 1000)) s")
    }

    private func clearRerouteFailure() {
        rerouteFailed = false
        rerouteFailures = 0
        rerouteRetryAt = nil
    }

    private func startAltCheck(_ fix: GpsFix, _ t0: Double) {
        altPending = true
        lastAltAt = t0
        lastCallAt = t0
        let version = routeVersion
        let fromAlongM = along
        let req = fetchRoutes(LatLon(lat: fix.lat, lon: fix.lon), destination.routeTarget, RouteRequestContext(heading: fix.heading, reason: .alternatives))
        track { [weak self] in
            let result = await req.result
            guard let self, !self.disposed else { return }
            self.altPending = false
            guard case .success(let routes) = result else { return }
            if version == self.routeVersion && !self.rerouting {
                // AW18: a jelenlegi útvonal friss (forgalmas) ideje – ha nincs a válaszban, köztes ponttal kérjük le
                if let same = routes.first(where: { routeOverlap(self.route, $0) >= 0.9 }) { self.setFresh(same, fromAlongM) } else { self.trafficViaDue = true }
                if self.offer == nil && (self.held == nil || self.measuring) { self.evaluateAlternatives(routes) }
            }
            self.changed()
        }
    }

    /// AW18: forgalom-lekérés a jelenlegi útvonalon: köztes pont a következő manőveren (a célnál nincs köztes pont).
    private func startTrafficCheck(_ fix: GpsFix, _ t0: Double) {
        trafficViaDue = false
        trafficPending = true
        lastCallAt = t0
        let version = routeVersion
        let fromAlongM = along
        let step = route.steps.isEmpty ? nil : route.steps[stepIndex()]
        let via = step.flatMap { $0.endManeuver.type != "arrive" ? $0.endManeuver.location : nil }
        let req = fetchRoutes(LatLon(lat: fix.lat, lon: fix.lon), destination.routeTarget, RouteRequestContext(heading: fix.heading, reason: .traffic, via: via))
        track { [weak self] in
            let result = await req.result
            guard let self, !self.disposed else { return }
            self.trafficPending = false
            if case .success(let routes) = result, let r = routes.first, version == self.routeVersion, !self.rerouting { self.setFresh(r, fromAlongM) }
            self.changed()
        }
    }

    private func setFresh(_ route: NavRoute, _ fromAlongM: Double) {
        fresh = (route, cumOf(route), fromAlongM, routeVersion)
        hasFresh = true
    }

    /// Egy útvonal kumulált ideje: a szakaszokon a határral, a közösségi dugó-adattal.
    private func cumOf(_ route: NavRoute) -> [Double] {
        let items = routeEnforcement(route, data, now: clock(), bandM: cfg.enforcementBandM)
        return cumulative(applyCommunityJams(route, adjustedDurations(route, items), communityJams, now: clock()))
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

    /// ETA-jellegű idő (s) egy útvonalra: a szakaszokon a határral (AW18: és a közösségi dugó-adattal).
    private func durationOf(_ route: NavRoute) -> Double {
        cumOf(route).last!
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
        hasFresh = true
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
        fresh = nil
        trafficViaDue = false
        rawCum = cumulative(route.segDurationS)
        jamDetector.rebase()
        recomputeEnforcement()
        // az új útvonal a jelenlegi pozícióról indul: újra illesztünk
        if let fix = lastFix { project(fix, useHint: false) }
    }

    private func recomputeEnforcement() {
        items = routeEnforcement(route, data, now: clock(), bandM: cfg.enforcementBandM)
        cum = cumulative(applyCommunityJams(route, adjustedDurations(route, items), communityJams, now: clock()))
    }

    /// A hátralévő idő (s) a terv szerint, AW18: a friss forgalmi útvonallal, ha van (a lekérés helyétől mérve).
    private func trafficRemainingS(_ alongM: Double) -> Double {
        if let f = fresh, f.version == routeVersion, alongM >= f.fromAlongM - 50 { return remainingSeconds(f.route, f.cum, max(0, alongM - f.fromAlongM)) }
        return remainingSeconds(route, cum, alongM)
    }

    /// A hátralévő idő (s). AW18: dugóban a helyi becslés is – a következő manőverig (legfeljebb `jamAheadMaxM`) a 2 perces
    /// mért átlaggal, onnan a tervezett idővel; a Mapbox-alapú és a helyi közül a nagyobb.
    private func remainingS() -> Double {
        let base = trafficRemainingS(along)
        guard jamDetector.active, let avg = jamDetector.avgMps else { return base }
        let step = route.steps.isEmpty ? nil : route.steps[stepIndex()]
        let toManeuver = step.map { max(0, $0.startM + $0.distanceM - along) } ?? 0
        let d = min(toManeuver, TRAFFIC.jamAheadMaxM, route.distanceM - along)
        let local = d / max(avg, TRAFFIC.jamMinKmh / 3.6) + trafficRemainingS(along + d)
        return max(base, local)
    }

    /// A várt tempó (m/s) a helyen: a Directions nyers ideje ±250 m-en.
    private func expectedMpsAt(_ alongM: Double) -> Double {
        let a = max(0, alongM - 250)
        let b = min(route.distanceM, alongM + 250)
        let dt = remainingSeconds(route, rawCum, a) - remainingSeconds(route, rawCum, b)
        return dt > 0 ? (b - a) / dt : 30
    }

    /// A szakasz kulcsa a „Nem” válaszhoz: a következő manőver helye (újratervezés után is ugyanaz).
    private func stretchKey() -> String {
        guard !route.steps.isEmpty else { return "" }
        let m = route.steps[stepIndex()].endManeuver.location
        return String(format: "%.4f,%.4f", m.lat, m.lon)
    }

    // MARK: AW18 – dugó és késés

    private func watchJam(_ fix: GpsFix) {
        let t0 = clock()
        let change = jamDetector.update(fix.timestamp, along, fix.speed, expectedMpsAt(along))
        let avg = jamDetector.avgMps ?? 0
        let windowLen = max(1, avg * TRAFFIC.jamWindowMs / 1000)
        if change == .enter {
            lastJamUploadAt = t0
            jamUploads.append(jamSample(.erzekelt, lat: fix.lat, lon: fix.lon, heading: fix.heading, avgMps: avg, lengthM: windowLen))
            let key = stretchKey()
            if !jamDeclined.contains(key) {
                jamAskKey = key
                jamAskUntil = t0 + TRAFFIC.jamPromptMs
                say(.traffic, t(.navVoiceJamAsk, lang: lang))
            }
        } else if change == .exit {
            jamAskUntil = nil
            jamUploads.append(jamSample(.oldott, lat: fix.lat, lon: fix.lon, heading: fix.heading, avgMps: jamDetector.clearedAvgMps ?? max(0, fix.speed ?? 0), lengthM: TRAFFIC.jamClearM))
        } else if jamDetector.active, let last = lastJamUploadAt, t0 - last >= TRAFFIC.jamUploadMs {
            lastJamUploadAt = t0
            jamUploads.append(jamSample(.erzekelt, lat: fix.lat, lon: fix.lon, heading: fix.heading, avgMps: avg, lengthM: windowLen))
        }
    }

    /// A késés (s) az indulási tervhez képest – csak friss adattal (forgalmi lekérés / újratervezés) vagy dugóban.
    private func delayS(_ t0: Double) -> Double? {
        if !hasFresh && !jamDetector.active { return nil }
        return (t0 + remainingS() * 1000 - plannedEtaMs) / 1000
    }

    /// A „+N perc dugó” hangja: egyszer ≥ 3 percnél, aztán legfeljebb 5 percenként, ha tovább nőtt; a kérdés lejárata.
    private func updateTraffic(_ t0: Double) {
        if let u = jamAskUntil, t0 >= u { jamAskUntil = nil }
        guard let d = delayS(t0), d >= TRAFFIC.delayShowS else { return }
        let min = Int(jsRound(d / 60))
        if delaySaid == nil || (t0 - delaySaid!.at >= TRAFFIC.delayRepeatMs && min > delaySaid!.min) {
            delaySaid = (t0, min)
            say(.traffic, t(.navVoiceDelay, ["n": String(min)], lang: lang))
        }
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
            // AW17: az „Utána” sor csak akkor, ha a következő manőver `thenWithinM`-en (5 km) belül van
            if idx + 1 < steps.count, step.endManeuver.type != "arrive", left <= cfg.thenWithinM {
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
            rerouteFailed: rerouteFailed,
            rerouteRetryInS: rerouteFailed && !rerouting ? rerouteRetryAt.map { max(0, Int(ceil(($0 - clock()) / 1000))) } : nil,
            plannedEtaMs: plannedEtaMs,
            delayMin: (arrived ? nil : delayS(clock())).flatMap { $0 >= TRAFFIC.delayShowS ? Int(jsRound($0 / 60)) : nil },
            jam: jamDetector.active,
            jamAsk: jamAskUntil != nil && !arrived
        )
        cached = v
        return v
    }
}
