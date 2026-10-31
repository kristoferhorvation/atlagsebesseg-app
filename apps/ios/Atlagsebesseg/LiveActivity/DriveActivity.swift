import ActivityKit
import Foundation

// AOS14: a Live Activity (lezárt képernyő + Dynamic Island) adatai. Az app és a widget-kiterjesztés is fordítja
// (project.yml). Az app számol és fordít (a választott nyelven – a widget a `lang:v1`-et nem látja), a widget csak kirajzol.
// AOS15: a GPS indításától állandó – öt állapot: figyel (GPS, cél nélkül), navigáció, szakaszmérés, mérés + navigáció, kézi
// mérés; a lezárt képernyőn bal oldalt négyzetes térképkép (az App Group tárolóból, `LiveMapStore`).

nonisolated struct DriveActivityAttributes: ActivityAttributes {
    nonisolated struct ContentState: Codable, Hashable, Sendable {
        /// Mérés közben (szakasz vagy kézi) – ilyenkor ez dominál, a navigáció egy kompakt sorban.
        var measure: Measure?
        /// Navigáció közben: a következő manőver és az érkezés.
        var nav: Nav?
        /// AOS15: GPS, cél és mérés nélkül („figyel”): pillanatnyi sebesség, tábla, a következő ismert szakasz.
        var watch: Watch?
        /// AOS15: a térképkép változata (`LiveMapStore.url(version:)`); `nil`: nincs kép, a tartalom teljes szélességű.
        var mapVersion: Int?
        /// AOS15-javítás: a térképkép attribúciója (a képen nincs logó / attribúció) – csak a lezárt képernyőn, kép mellett.
        var attribution: String?
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
        /// AOS15: „Maradj 115 alatt” / „Lassíts · max 103” / „Nem hozható” (a „Lassíts” sáv mondata; csak ha kell).
        var advice: String?
        /// AOS15: kézi mérésnél az eltelt idő („4:12”).
        var elapsed: String?
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
        /// AOS15: „18 perc · 21,4 km” (a hátralévő idő és út).
        var remaining: String = ""
        /// AOS15: „+7 perc dugó” (AW18, ha van).
        var delay: String?
    }

    nonisolated struct Watch: Codable, Hashable, Sendable {
        /// „Figyel”.
        var title: String
        /// A pillanatnyi sebesség („–”, ha még nincs).
        var speed: String
        /// „km/h”.
        var unit: String
        /// A bal alsó tábla limitje (navigáció nélkül nincs ilyen adat – `nil`).
        var limit: String?
        var speedOver: Bool
        /// „Szakasz 3,2 km múlva” – a következő ismert szakasz, ha 5 km-en belül.
        var nextSection: String?
    }
}

extension DriveActivityAttributes.ContentState {
    /// Hova nyisson a koppintás (`atlagsebesseg://live/<cél>`): a mérés, a navigáció vagy a térkép.
    nonisolated var link: URL {
        let target = measure != nil ? "measure" : nav != nil ? "nav" : "map"
        return URL(string: "atlagsebesseg://live/\(target)")!
    }
}

/// AOS15: a Live Activity térképképe az App Group tárolóban – az app írja, a widget olvassa. Két fájl váltakozik
/// (`version` paritása), így a widget soha nem félig írt képet tölt be.
nonisolated enum LiveMapStore {
    static let group = "group.hu.atlagsebesseg.app"

    static var folder: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }

    static func url(version: Int) -> URL? {
        folder?.appendingPathComponent("live-map-\(version % 2).png")
    }
}
