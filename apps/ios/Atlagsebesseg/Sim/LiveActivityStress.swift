import ActivityKit
import Foundation

/// AOS18-javítás: a widget szöveg-archiválásának próbája (a crash: `ProtobufEncoder.encodeAttachedValue` → `KEY_TYPE_OF_DICTIONARY_VIOLATES_HASHABLE`). A minták: mind a 6 nyelv,
/// a szótár leghosszabb szövege, 80+ karakteres cím, hiányzó mentett hely, 0 és nagy krúzing-érték. Az AppTests a mintákat méri, a `-liveStress YES` a valódi ActivityKit-en át
/// kéri őket (a rendszer ilyenkor archiválja a widget nézeteit); a crash-naplókat a `packages/parity/scripts/live-stress.mjs` számolja.
enum LiveStress {
    private static let address = "Budapest, Bajcsy-Zsilinszky Endre út 123–125., II. emelet 14. ajtó, kapucsengő: Kovács és Társa Kft."

    static func samples() -> [(name: String, state: LiveState)] {
        Lang.allCases.flatMap { lang -> [(name: String, state: LiveState)] in
            let longest = L10nKey.allCases.map { t($0, lang: lang) }.max { $0.count < $1.count } ?? ""
            let big = CruiseView(tripId: "t", startedAt: 0, distanceM: 9_876_543, elapsedS: 359_999, movingS: 350_000, dirChanges: 99_999)
            func watch(cruise: CruiseView?, next: Double?, home: Bool, work: Bool) -> LiveState {
                liveActivityState(SessionView(), nav: nil, unit: .kmh, nextSectionM: next, cruise: cruise.map { cruiseFiguresText($0, unit: .kmh, lang: lang) }, dirChanges: cruise.map { cruiseDirChangesText($0, lang: lang) }, savedHome: home, savedWork: work, lang: lang)!
            }
            var longWatch = watch(cruise: big, next: 3200, home: true, work: true)
            longWatch.watch?.nextSection = longest
            let nav = DriveActivityAttributes.Nav(
                maneuver: ManeuverIcon.roundabout_left.rawValue, distance: "999,9 km", street: address, etaLabel: t(.navEta, lang: lang), eta: "23:59",
                remaining: "\(formatTripDuration(359_999, lang: lang)) · 9 876,5 km", delay: trafficDelayLabel(999, lang: lang)
            )
            var longNav = nav
            longNav.street = longest
            let measure = DriveActivityAttributes.Measure(
                title: t(.hudMeasure, lang: lang), avg: "888", avgLabel: t(.hudAvg, ["u": "km/h"], lang: lang), tone: .tulGyors, limit: "130", nowLabel: t(.hudNow, lang: lang), now: "888", nowOver: true,
                expectedLabel: t(.hudExpected, lang: lang), expected: "888", remaining: t(.iosLiveRemaining, ["x": "999,9 km"], lang: lang), advice: longest
            )
            let manual = DriveActivityAttributes.Measure(
                title: t(.hudManual, lang: lang), avg: "–", avgLabel: t(.hudAvg, ["u": "km/h"], lang: lang), tone: .kezi, limit: nil, nowLabel: t(.hudNow, lang: lang), now: nil, nowOver: false,
                expectedLabel: t(.hudExpected, lang: lang), expected: nil, remaining: nil, elapsed: "99:59:59"
            )
            let att = t(.iosLiveAttribution, lang: lang)
            return [
                ("\(lang.rawValue)-figyel-0-nincs-hely", watch(cruise: nil, next: nil, home: false, work: false)),
                ("\(lang.rawValue)-figyel-0-egy-hely", watch(cruise: nil, next: nil, home: true, work: false)),
                ("\(lang.rawValue)-figyel-nagy", watch(cruise: big, next: 4999, home: true, work: true)),
                ("\(lang.rawValue)-figyel-leghosszabb", longWatch),
                ("\(lang.rawValue)-nav-80-karakter", LiveState(nav: nav, mapVersion: 1, attribution: att)),
                ("\(lang.rawValue)-nav-leghosszabb", LiveState(nav: longNav)),
                ("\(lang.rawValue)-meres-nav", LiveState(measure: measure, nav: nav, mapVersion: 1, attribution: att)),
                ("\(lang.rawValue)-kezi", LiveState(measure: manual)),
            ]
        }
    }

    /// Mintánként új Live Activity (a kérés indítja a rendszer archiválását), majd egy frissítés; a korábbit lezárja.
    static func run() async {
        for a in Activity<DriveActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
        while true {
            for item in samples() {
                do {
                    let a = try Activity.request(attributes: DriveActivityAttributes(), content: .init(state: item.state, staleDate: nil))
                    NSLog("LIVE-STRESS: %@", item.name)
                    try await Task.sleep(for: .milliseconds(700))
                    await a.update(.init(state: item.state, staleDate: nil))
                    try await Task.sleep(for: .milliseconds(700))
                    await a.end(nil, dismissalPolicy: .immediate)
                } catch {
                    NSLog("LIVE-STRESS: hiba: %@", error.localizedDescription)
                    try? await Task.sleep(for: .seconds(1))
                }
            }
        }
    }
}
