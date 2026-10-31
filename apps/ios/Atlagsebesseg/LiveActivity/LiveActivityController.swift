import ActivityKit
import AtlagsebessegCore
import Foundation

// AOS14: a Live Activity tartalma (tiszta függvény, tesztelhető) és az életciklusa (ActivityKit).
// AOS15: a GPS indításától a GPS végéig állandó; figyel / navigáció / mérés / mérés + navigáció / kézi mérés.

nonisolated private func dist(_ m: Double, _ unit: SpeedUnit, _ lang: Lang?) -> String {
    let d = formatDistance(m, unit, lang: lang ?? L10n.lang)
    return "\(d.value) \(d.unit)"
}

/// AOS15: a „figyel” állapotban a következő ismert szakasz ennyi méteren belül látszik.
nonisolated let LIVE_NEXT_SECTION_M = 5000.0

/// A következő ismert szakasz légvonalbeli távolsága navigáció nélkül: a kezdő kapu előttünk (±`coneDeg`), a szakasz iránya
/// a haladásunkéval egyezik (±`sectionDirDeg`, mint a kapu-jelzésnél), és `maxM`-en belül van. Irány nélkül `nil`.
nonisolated func nextSectionAheadM(_ fix: GpsFix?, _ sections: [Section], maxM: Double = LIVE_NEXT_SECTION_M, config: ApproachConfig = ApproachConfig()) -> Double? {
    guard let fix, let h = fix.heading else { return nil }
    let dLat = maxM / 111_195
    let dLon = maxM / (111_195 * cos(fix.lat * .pi / 180))
    var best: Double?
    for s in sections where abs(s.start.lat - fix.lat) <= dLat && abs(s.start.lon - fix.lon) <= dLon {
        let d = haversineM(fix, s.start)
        guard d <= maxM, angleDiffDeg(bearingDeg(fix, s.start), h) <= config.coneDeg else { continue }
        let dir = (s.geometry?.count ?? 0) >= 2 ? bearingDeg(s.geometry![0], s.geometry![1]) : bearingDeg(s.start, s.end)
        guard angleDiffDeg(dir, h) <= config.sectionDirDeg else { continue }
        if best.map({ d < $0 }) ?? true { best = d }
    }
    return best
}

/// A Live Activity állapota. `gps`: az app használja a GPS-t – ilyenkor mindig van tartalom (mérés közben a mérés,
/// navigációban a manőver, különben „figyel”); GPS nélkül `nil` (a Live Activity lezárul). Kézi mérésnél csak az átlag
/// accent színben és az idő, limit nélkül. `nextSectionM`: a következő ismert szakasz (navigáció nélkül, `nextSectionAheadM`).
nonisolated func liveActivityState(
    _ view: SessionView, nav: NavView?, unit: SpeedUnit, gps: Bool = true, nextSectionM: Double? = nil, mapVersion: Int? = nil, lang: Lang? = nil
) -> DriveActivityAttributes.ContentState? {
    guard gps else { return nil }
    let u = unitLabel(unit)
    var measure: DriveActivityAttributes.Measure?
    switch view.phase {
    case .meres:
        if let s = view.section, let live = view.live {
            let tone: DriveActivityAttributes.Tone = switch view.status {
            case .jo: .jo
            case .lassits: .lassits
            case .tulGyors: .tulGyors
            case nil: .semleges
            }
            // a „Lassíts” sáv mondata; jó állapotban is a „Maradj X alatt” (a hátralévő úton ennyivel pontosan a határ)
            let advice: String? = switch live.required {
            case let .ok(maxKmh):
                speedIn(maxKmh, unit).map { t(view.status == .tulGyors ? .slowdownSlow : .slowdownStay, ["x": String($0)], lang: lang) }
            case .nemLehetseges: t(.slowdownCant, lang: lang)
            case .nincsKorlat: nil
            }
            measure = .init(
                title: t(.hudMeasure, lang: lang),
                avg: speedIn(live.averageKmh, unit).map(String.init) ?? "–",
                avgLabel: t(.hudAvg, ["u": u], lang: lang),
                tone: tone,
                limit: speedIn(s.speedLimitKmh, unit).map(String.init),
                nowLabel: t(.hudNow, lang: lang),
                now: speedIn(view.currentKmh, unit).map(String.init),
                nowOver: (view.currentKmh ?? 0) > s.speedLimitKmh,
                expectedLabel: t(.hudExpected, lang: lang),
                expected: speedIn(live.projectedKmh, unit).map(String.init),
                remaining: t(.iosLiveRemaining, ["x": dist(live.remainingM, unit, lang)], lang: lang),
                advice: advice
            )
        }
    case .kezi:
        measure = .init(
            title: t(.hudManual, lang: lang),
            avg: speedIn(view.manual?.averageKmh, unit).map(String.init) ?? "–",
            avgLabel: t(.hudAvg, ["u": u], lang: lang),
            tone: .kezi,
            limit: nil,
            nowLabel: t(.hudNow, lang: lang),
            now: nil,
            nowOver: false,
            expectedLabel: t(.hudExpected, lang: lang),
            expected: nil,
            remaining: nil,
            elapsed: view.manual.map { formatDuration($0.elapsedMs) }
        )
    default:
        break
    }
    let navState = nav.map { n in
        DriveActivityAttributes.Nav(
            maneuver: (n.phase == .arrived ? ManeuverIcon.arrive : n.next.icon).rawValue,
            distance: dist(n.next.distanceM, unit, lang),
            street: n.next.text,
            etaLabel: t(.navEta, lang: lang),
            eta: formatClock(n.etaMs, lang: lang),
            remaining: "\(formatTripDuration(n.remainingS, lang: lang)) · \(dist(n.remainingM, unit, lang))",
            delay: n.delayMin.map { trafficDelayLabel($0, lang: lang) }
        )
    }
    var watch: DriveActivityAttributes.Watch?
    if measure == nil, navState == nil {
        watch = .init(
            title: t(.iosLiveWatch, lang: lang),
            speed: view.lastFix == nil ? "–" : String(speedIn(view.currentKmh ?? 0, unit) ?? 0),
            unit: u,
            limit: nil,
            speedOver: false,
            nextSection: nextSectionM.map { t(.iosLiveNextSection, ["d": dist($0, unit, lang)], lang: lang) }
        )
    }
    return .init(measure: measure, nav: navState, watch: watch, mapVersion: mapVersion, attribution: mapVersion.map { _ in t(.iosLiveAttribution, lang: lang) })
}

/// A frissítés legkisebb időköze (s): „figyel” állapotban 2 s (0,5 Hz – ott csak a sebesség változik, az akku kedvéért),
/// mérés vagy navigáció közben 1 s (1 Hz). AOS15-javítás.
nonisolated func liveMinInterval(_ s: DriveActivityAttributes.ContentState) -> TimeInterval {
    s.measure == nil && s.nav == nil ? 2 : 1
}

/// Ki zárta le a Live Activity-t (AOS15-javítás). `.dismissed` aktív állapotból: a felhasználó elhúzta → a GPS következő
/// indításáig nem jön vissza; `.ended`: a rendszer zárta (8 órás korlát) → előtérben, futó GPS-szel magától újraindul.
nonisolated enum LiveEnd: Equatable { case user, system }

nonisolated func liveEndKind(_ s: ActivityState) -> LiveEnd? {
    switch s {
    case .dismissed: .user
    case .ended: .system
    default: nil
    }
}

/// A Live Activity életciklusa (AOS15): indul a GPS indításakor (előtérben – a háttérből indított szakaszmérés problémája így
/// nem áll fenn), frissül legfeljebb 1 Hz-cel és csak változáskor, lezárul, ha az app befejezi a GPS-használatot. Ha a
/// felhasználó a lezárt képernyőn elhúzza, a GPS következő indításáig nem indul újra; ha a rendszer zárta le (8 óra) vagy
/// hiányzik, az app előtérbe kerülésekor futó GPS-szel magától újraindul (`resume`).
final class LiveActivityController {
    private var activity: Activity<DriveActivityAttributes>?
    private var last: DriveActivityAttributes.ContentState?
    private var lastAt: Date = .distantPast
    /// A sikertelen indítás csak egyszer kerül a naplóba (a következő hívások újra próbálják).
    private var warned = false
    /// A felhasználó lezárta (elhúzta) – a GPS következő indításáig (`reset()`) nem indul újra.
    private(set) var userEnded = false
    private var watcher: Task<Void, Never>?
    /// A frissítések száma (a napló és a költségvetés-becslés kedvéért).
    private(set) var updates = 0

    /// Új GPS-használat kezdete: a felhasználói lezárás feledése.
    func reset() {
        userEnded = false
        warned = false
    }

    /// Állapot-változás: indítás / frissítés (≤ 1 Hz) / lezárás.
    func update(_ state: DriveActivityAttributes.ContentState?, now: Date = Date()) {
        guard let state else {
            end()
            return
        }
        guard !userEnded, state != last else { return }
        if activity == nil {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                if !warned { NSLog("LIVE-ACTIVITY: a Live Activity le van tiltva") }
                warned = true
                return
            }
            do {
                let a = try Activity.request(attributes: DriveActivityAttributes(), content: .init(state: state, staleDate: nil), pushType: nil)
                activity = a
                last = state
                lastAt = now
                watch(a.id)
                NSLog("LIVE-ACTIVITY: indult")
            } catch {
                // háttérből vagy letiltva: nincs Live Activity, a mérés megy tovább (a következő hívás újra próbálja)
                if !warned { NSLog("LIVE-ACTIVITY: nem indult: %@", String(describing: error)) }
                warned = true
            }
            return
        }
        // a térképkép új változata azonnal megy (manőver), a számok legfeljebb 1 Hz-cel („figyel”: 0,5 Hz)
        let mapChanged = state.mapVersion != last?.mapVersion
        guard mapChanged || now.timeIntervalSince(lastAt) >= liveMinInterval(state) else { return }
        last = state
        lastAt = now
        updates += 1
        guard let id = activity?.id else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        Task.detached { await Self.find(id)?.update(content) }
    }

    func end() {
        watcher?.cancel()
        watcher = nil
        guard let id = activity?.id else { return }
        activity = nil
        last = nil
        NSLog("LIVE-ACTIVITY: ended (%d updates)", updates)
        Task.detached { await Self.find(id)?.end(nil, dismissalPolicy: .immediate) }
    }

    /// Az app előtérbe került: ha a Live Activity lejárt (a rendszer zárta, 8 óra) vagy hiányzik, és a GPS fut (`state`
    /// nem `nil`), újraindul; a felhasználói elhúzás utáni tiltás marad. A kimaradt állapot-jelzést is itt pótoljuk.
    func resume(_ state: DriveActivityAttributes.ContentState?) {
        guard let state, !userEnded else { return }
        if let id = activity?.id {
            let a = Self.find(id)
            if let a, liveEndKind(a.activityState) == nil { return }
            closed(a.flatMap { liveEndKind($0.activityState) } ?? .system)
            if userEnded { return }
        }
        warned = false
        update(state)
    }

    /// A rendszer vagy a felhasználó lezárta: elhúzás (`.dismissed`) → tiltás a GPS következő indításáig; a rendszer lezárása
    /// (`.ended`, 8 órás korlát) → előtérbe kerüléskor újraindul (`resume`).
    private func watch(_ id: String) {
        watcher?.cancel()
        watcher = Task { [weak self] in
            guard let a = Self.find(id) else { return }
            for await s in a.activityStateUpdates {
                guard let kind = liveEndKind(s) else { continue }
                guard let self, self.activity?.id == id else { return }
                self.closed(kind)
                return
            }
        }
    }

    private func closed(_ kind: LiveEnd) {
        activity = nil
        last = nil
        if kind == .user { userEnded = true }
        NSLog("LIVE-ACTIVITY: %@", kind == .user ? "dismissed by user" : "ended by system")
    }

    /// Az ActivityKit-példány azonosító szerint (a háttér-feladat maga keresi ki, nem a főszálról viszi át).
    nonisolated private static func find(_ id: String) -> Activity<DriveActivityAttributes>? {
        Activity<DriveActivityAttributes>.activities.first { $0.id == id }
    }

    /// Az app indulásakor a korábbi futásból (összeomlás, kilövés) itt maradt Live Activity-k lezárása.
    static func endStale() {
        Task.detached {
            for a in Activity<DriveActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
