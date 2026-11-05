import Foundation

// AOS16: a packages/app-logic/src/follow.ts `followReducer`-ének párja (azonos nevű tesztek: LogicTests).

/// Mérés közben ennyi tétlenség után a kamera magától visszaáll a követésre.
nonisolated let FOLLOW_RESUME_MS = 5000.0

/// AW23: a követő zoom a sebességből (km/h), minden állapotban: a `Tokens.Camera.zoomStops` között lineáris, a széleken állandó.
nonisolated func followZoom(_ kmh: Double, stops: [(kmh: Double, zoom: Double)] = Tokens.Camera.zoomStops) -> Double {
    let v = kmh.isFinite ? max(0, kmh) : 0
    guard let first = stops.first, let last = stops.last else { return 0 }
    if v <= first.kmh { return first.zoom }
    for i in 1..<stops.count where v <= stops[i].kmh {
        let (s0, z0) = stops[i - 1]
        let (s1, z1) = stops[i]
        return z0 + (v - s0) / (s1 - s0) * (z1 - z0)
    }
    return last.zoom
}

/// AW23: a jelölő helye a képernyőn (0 = fent, 1 = lent): a legfelső alsó kártya fölött `focusGap`-pel, a sávon belül; minden állapotban ugyanez.
nonisolated func followFocusY(_ cardTop: Double, _ screenH: Double) -> Double {
    max(Tokens.Camera.focusMinY, min(Tokens.Camera.focusMaxY, (cardTop - Tokens.Camera.focusGap) / screenH))
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
