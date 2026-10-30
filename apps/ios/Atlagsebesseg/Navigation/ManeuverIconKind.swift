import Foundation

// AOS14: külön fájlban, mert a Live Activity widget-kiterjesztése is fordítja (project.yml) – a rajz a
// Generated/ManeuverIcons.swift-ben, a Directions-leképezés a Maneuver.swift-ben.

/// A manőver-ikon családja (a platform saját rajzot társít hozzá).
nonisolated enum ManeuverIcon: String, CaseIterable, Codable, Sendable {
    case straight, slight_left, left, sharp_left, slight_right, right, sharp_right, uturn
    case roundabout_left, roundabout_right, merge, fork_left, fork_right, arrive, depart
}
