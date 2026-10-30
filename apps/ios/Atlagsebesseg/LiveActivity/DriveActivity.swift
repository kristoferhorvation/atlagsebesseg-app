import ActivityKit
import Foundation

// AOS14: a Live Activity (lezárt képernyő + Dynamic Island) adatai. Az app és a widget-kiterjesztés is fordítja
// (project.yml). Az app számol és fordít (a választott nyelven – a widget a `lang:v1`-et nem látja), a widget csak kirajzol.

nonisolated struct DriveActivityAttributes: ActivityAttributes {
    nonisolated struct ContentState: Codable, Hashable, Sendable {
        /// Mérés közben (szakasz vagy kézi) – ilyenkor ez dominál, a navigáció egy kompakt sorban.
        var measure: Measure?
        /// Navigáció közben: a következő manőver és az érkezés.
        var nav: Nav?
    }

    /// A tónus (a webes `data-tone`): a nagy szám színe.
    nonisolated enum Tone: String, Codable, Hashable, Sendable {
        case jo, lassits, tulGyors, kezi, semleges
    }

    nonisolated struct Measure: Codable, Hashable, Sendable {
        /// „Mérés” / „Kézi átlagmérés”.
        var title: String
        /// Az átlag a választott egységben („–”, ha még nincs).
        var avg: String
        /// „km/h átlag”.
        var avgLabel: String
        var tone: Tone
        /// A tábla-limit (kézi mérésnél `nil`: nincs referencia).
        var limit: String?
        var nowLabel: String
        var now: String?
        /// A pillanatnyi sebesség a limit fölött (a szám pirosan).
        var nowOver: Bool
        var expectedLabel: String
        var expected: String?
        /// „3,2 km hátra” (kézi mérésnél `nil`).
        var remaining: String?
    }

    nonisolated struct Nav: Codable, Hashable, Sendable {
        /// A `ManeuverIcon` nyers értéke.
        var maneuver: String
        /// „350 m”.
        var distance: String
        /// Utcanév / a manőver szövege.
        var street: String
        var etaLabel: String
        /// „14:32”.
        var eta: String
    }
}
