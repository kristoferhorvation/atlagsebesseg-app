import ActivityKit
import AtlagsebessegCore
import Foundation

// AOS14: a Live Activity tartalma (tiszta függvény, tesztelhető) és az életciklusa (ActivityKit).

nonisolated private func dist(_ m: Double, _ unit: SpeedUnit, _ lang: Lang?) -> String {
    let d = formatDistance(m, unit, lang: lang ?? L10n.lang)
    return "\(d.value) \(d.unit)"
}

/// A Live Activity állapota a kijelzőből: mérés közben (`meres` / `kezi`) a mérés, navigáció közben a következő manőver;
/// egyik sem → `nil` (a Live Activity lezárul). Kézi mérésnél csak az átlag, accent színben, limit nélkül.
nonisolated func liveActivityState(_ view: SessionView, nav: NavView?, unit: SpeedUnit, lang: Lang? = nil) -> DriveActivityAttributes.ContentState? {
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
                remaining: t(.iosLiveRemaining, ["x": dist(live.remainingM, unit, lang)], lang: lang)
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
            remaining: nil
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
            eta: formatClock(n.etaMs, lang: lang)
        )
    }
    guard measure != nil || navState != nil else { return nil }
    return .init(measure: measure, nav: navState)
}

/// A Live Activity életciklusa: indul, ha van mit mutatni (mérés vagy navigáció indul), frissül legfeljebb 1 Hz-cel és csak
/// változáskor, lezárul a végén. A háttérbe küldés nem állítja le (a mérés és a navigáció a háttérben is fut – A9).
/// Megjegyzés: az ActivityKit csak előtérben enged új Live Activity-t indítani; háttérben induló szakaszmérésnél az indítás
/// elmarad (nincs hiba), a következő előtérbe kerüléskor indul.
final class LiveActivityController {
    private var activity: Activity<DriveActivityAttributes>?
    private var last: DriveActivityAttributes.ContentState?
    private var lastAt: Date = .distantPast
    /// A sikertelen indítás csak egyszer kerül a naplóba (a következő hívások újra próbálják).
    private var warned = false
    /// Legfeljebb ennyi időnként frissít (1 Hz).
    static let minInterval: TimeInterval = 1

    /// Állapot-változás: indítás / frissítés (≤ 1 Hz) / lezárás.
    func update(_ state: DriveActivityAttributes.ContentState?, now: Date = Date()) {
        guard let state else {
            end()
            return
        }
        guard state != last else { return }
        if activity == nil {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                if !warned { NSLog("LIVE-ACTIVITY: a Live Activity le van tiltva") }
                warned = true
                return
            }
            do {
                activity = try Activity.request(attributes: DriveActivityAttributes(), content: .init(state: state, staleDate: nil), pushType: nil)
                last = state
                lastAt = now
                NSLog("LIVE-ACTIVITY: indult")
            } catch {
                // háttérből vagy letiltva: nincs Live Activity, a mérés megy tovább (a következő hívás újra próbálja)
                if !warned { NSLog("LIVE-ACTIVITY: nem indult: %@", String(describing: error)) }
                warned = true
            }
            return
        }
        guard now.timeIntervalSince(lastAt) >= Self.minInterval else { return }
        last = state
        lastAt = now
        guard let id = activity?.id else { return }
        let content = ActivityContent(state: state, staleDate: nil)
        Task.detached { await Self.find(id)?.update(content) }
    }

    func end() {
        guard let id = activity?.id else { return }
        activity = nil
        last = nil
        Task.detached { await Self.find(id)?.end(nil, dismissalPolicy: .immediate) }
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
