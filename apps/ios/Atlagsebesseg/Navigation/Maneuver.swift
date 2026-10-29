import Foundation

// A packages/app-logic/src/navigation/maneuver.ts portja (A11). A rajzok: Generated/ManeuverIcons.swift (a webes ManeuverIcon.tsx-ből).

/// A manőver-ikon családja (a platform saját rajzot társít hozzá).
nonisolated enum ManeuverIcon: String, CaseIterable, Sendable {
    case straight, slight_left, left, sharp_left, slight_right, right, sharp_right, uturn
    case roundabout_left, roundabout_right, merge, fork_left, fork_right, arrive, depart
}

/// A Directions `type` + `modifier` párosa → ikon. Ismeretlen kombináció: egyenesen.
nonisolated func maneuverIcon(_ type: String, _ modifier: String?) -> ManeuverIcon {
    let m = modifier ?? "straight"
    let left = m.contains("left")
    if type == "arrive" { return .arrive }
    if type == "depart" { return .depart }
    if type == "roundabout" || type == "rotary" || type == "roundabout turn" { return left ? .roundabout_left : .roundabout_right }
    if m == "uturn" { return .uturn }
    if type == "merge" { return .merge }
    if type == "fork" { return left ? .fork_left : m.contains("right") ? .fork_right : .straight }
    switch m {
    case "sharp left": return .sharp_left
    case "sharp right": return .sharp_right
    case "slight left": return .slight_left
    case "slight right": return .slight_right
    case "left": return .left
    case "right": return .right
    default: return .straight
    }
}

/// Idő a Directions másodperceiből: „12 perc” / „1 ó 25 perc” (legalább 1 perc).
nonisolated func formatTripDuration(_ seconds: Double, lang: Lang? = nil) -> String {
    let min = max(1, Int(jsRound(seconds / 60)))
    return min < 60 ? t(.navDurMin, ["n": "\(min)"], lang: lang) : t(.navDurHm, ["h": "\(min / 60)", "m": "\(min % 60)"], lang: lang)
}

/// Napszak a nyelv szerint („14:32”), a készülék időzónájában.
nonisolated func formatClock(_ ms: Double, lang: Lang? = nil) -> String {
    let f = DateFormatter()
    f.locale = (lang ?? L10n.lang).locale
    f.setLocalizedDateFormatFromTemplate("HHmm")
    return f.string(from: Date(timeIntervalSince1970: ms / 1000))
}

/// Egész percek (a „−7 perc” felirathoz).
nonisolated func wholeMinutes(_ seconds: Double) -> Int { max(1, Int(jsRound(seconds / 60))) }
