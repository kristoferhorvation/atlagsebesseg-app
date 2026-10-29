import Foundation

// A packages/app-logic/src/navigation/layout.ts portja (AOS13): a felső lépés-kártya egysoros sávvá zsugorodik, ha
// a teljes kártya az alsó kártya-csoport alá érne (mérés közben mindig).

/// A nézet méréseiből (pont, a képernyő tetejétől): `cardBottom` a TELJES felső kártya alja (rejtve is mérve),
/// `bottomTop` az alsó csoport teteje a sáv NÉLKÜL – különben a sáv megjelenése visszakapcsolná a kártyát.
/// Még nem mért értéknél (`nil`) a teljes kártya marad.
nonisolated struct NavStepLayout: Equatable, Sendable {
    var measuring: Bool
    var cardBottom: Double?
    var bottomTop: Double?
    /// A két csoport közti legkisebb térköz.
    var gap: Double
}

/// Egysoros sáv (`true`) vagy teljes felső kártya (`false`).
nonisolated func navStepStrip(_ l: NavStepLayout) -> Bool {
    if l.measuring { return true }
    guard let cardBottom = l.cardBottom, let bottomTop = l.bottomTop else { return false }
    return cardBottom + l.gap > bottomTop
}

/// AOS13: navigáció közben a mérés eredménye (`befejezve`) egysoros, kompakt kártya – a nagy kártya a gombsorral együtt a
/// felső lépés-kártya (sávként is a pillek) alá érne. AW15: a kézi mérés eredménye (`keziEredmeny`) is.
nonisolated func navResultCompact(_ phase: SessionPhase, navigating: Bool) -> Bool {
    navigating && (phase == .befejezve || phase == .keziEredmeny)
}

/// AW15: a kézi mérés kártyája navigáció közben – pill (`collapsed`) vagy teljes kártya; az 5 s a teljes kártya
/// kinyílásától számít (`expandedAt`, ms); a `space` az előző lépés „a navigációnak hely kell” értéke (az élhez).
nonisolated struct ManualPillState: Equatable, Sendable {
    var collapsed: Bool
    var expandedAt: Double
    var space: Bool
}

/// A navigáció helyigénye: közeli manőver (`maneuverNearM`-en belül), ajánlat-kártya vagy közeli kamera.
nonisolated func navNeedsSpace(maneuverM: Double?, offer: Bool, cameraNear: Bool) -> Bool {
    offer || cameraNear || (maneuverM.map { $0 < MANUAL_PILL.maneuverNearM } ?? false)
}

/// Óra-lépés: `active` – navigáció közben fut a kézi mérés (nélküle `nil`: a nagy kártya). Induláskor teljes kártya;
/// `collapseAfterMs` után, vagy amikor a navigációnak hely kell (felfutó él), összemegy.
nonisolated func manualPillTick(_ s: ManualPillState?, active: Bool, space: Bool, now: Double) -> ManualPillState? {
    guard active else { return nil }
    let prev = s ?? ManualPillState(collapsed: false, expandedAt: now, space: false)
    let collapse = !prev.collapsed && ((space && !prev.space) || now - prev.expandedAt >= MANUAL_PILL.collapseAfterMs)
    if !collapse, let s, s.space == space { return s }
    return ManualPillState(collapsed: prev.collapsed || collapse, expandedAt: prev.expandedAt, space: space)
}

/// Bökés: a pill kinyílik (az 5 s újraindul), a teljes kártya összemegy.
nonisolated func manualPillTap(_ s: ManualPillState, now: Double) -> ManualPillState {
    var n = s
    if s.collapsed {
        n.collapsed = false
        n.expandedAt = now
    } else {
        n.collapsed = true
    }
    return n
}
