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
/// felső lépés-kártya (sávként is a pillek) alá érne. A kézi mérés eredménye nagy marad (kapu-küldés, „Újra” gomb).
nonisolated func navResultCompact(_ phase: SessionPhase, navigating: Bool) -> Bool {
    navigating && phase == .befejezve
}
