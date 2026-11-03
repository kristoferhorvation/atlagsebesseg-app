import Foundation

// AOS16: a packages/app-logic/src/follow.ts `followReducer`-ének párja (azonos nevű tesztek: LogicTests).

/// Mérés közben ennyi tétlenség után a kamera magától visszaáll a követésre.
nonisolated let FOLLOW_RESUME_MS = 5000.0

/// AOS17: a webes `MapboxWebAdapter` követő kamerája navigáción kívül: dőlés, a pozíció alapértelmezett képernyő-helye és a zoom a
/// sebességből (40 km/h-ig 17,3, felette távolodik, legfeljebb 15,5-ig).
nonisolated let idleFollowPitch = 60.0
nonisolated let idleFocusDefault = 0.38
nonisolated func idleFollowZoom(_ kmh: Double) -> Double {
    min(17.3, max(15.5, 17.3 - max(0, kmh - 40) * 0.017))
}

/// A követő kamera állapota: követ, vagy a felhasználó elmozgatta a térképet.
nonisolated struct FollowState: Equatable {
    var following: Bool
    /// Az utolsó felhasználói térkép-mozdulat ideje (ms).
    var lastGestureAt: Double
}

nonisolated enum FollowEvent {
    /// Húzás, csípés, forgatás.
    case gesture(at: Double)
    /// „Vissza a helyemre” gomb.
    case recenter
    /// Óra: `measuring` igaz, ha mérés fut (szakasz vagy kézi).
    case tick(at: Double, measuring: Bool)
}

/// Követés ki/be: a felhasználói mozdulat kikapcsolja; a gomb visszakapcsolja; mérés közben 5 s tétlenség után magától is
/// visszaáll, mérésen kívül csak a gombra.
nonisolated func followReducer(_ s: FollowState, _ e: FollowEvent, resumeMs: Double = FOLLOW_RESUME_MS) -> FollowState {
    switch e {
    case let .gesture(at):
        return FollowState(following: false, lastGestureAt: at)
    case .recenter:
        return s.following ? s : FollowState(following: true, lastGestureAt: s.lastGestureAt)
    case let .tick(at, measuring):
        return !s.following && measuring && at - s.lastGestureAt >= resumeMs ? FollowState(following: true, lastGestureAt: s.lastGestureAt) : s
    }
}
