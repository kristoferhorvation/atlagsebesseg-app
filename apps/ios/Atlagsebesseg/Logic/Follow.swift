import Foundation

// AOS16: a packages/app-logic/src/follow.ts `followReducer`-ének párja (azonos nevű tesztek: LogicTests).

/// Mérés közben ennyi tétlenség után a kamera magától visszaáll a követésre.
nonisolated let FOLLOW_RESUME_MS = 5000.0

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
