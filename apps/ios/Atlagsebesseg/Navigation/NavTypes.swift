import AtlagsebessegCore
import Foundation

// A packages/app-logic/src/navigation/types.ts és config.ts portja (A11).

nonisolated struct Place: Identifiable, Hashable, Codable, Sendable {
    var id: String
    /// Rövid név (pl. „Győr”).
    var name: String
    /// A hely pontosabb leírása (pl. „Győr-Moson-Sopron, Magyarország”).
    var address: String
    var lat: Double
    var lon: Double

    var latLon: LatLon { LatLon(lat: lat, lon: lon) }
}

nonisolated enum Congestion: String, Sendable {
    case unknown, low, moderate, heavy, severe
}

nonisolated struct BannerText: Hashable, Sendable {
    var text: String
    /// A Directions manőver-típusa (`turn`, `roundabout`, `arrive`…).
    var type: String
    var modifier: String?
    /// A kijárat felirata a banner `exit` + `exit-number` komponenseiből („Kijárat 56”); a pajzs- és sáv-komponenseket nem tartalmazza.
    var exit: String?
}

nonisolated struct NavBanner: Hashable, Sendable {
    /// A lépés végétől ennyi méterre (vagy közelebb) jelenik meg.
    var distanceAlongM: Double
    var primary: BannerText
    var secondary: BannerText?
    var sub: BannerText?
}

nonisolated struct NavVoice: Hashable, Sendable {
    var distanceAlongM: Double
    var text: String
}

nonisolated struct NavManeuver: Hashable, Sendable {
    var type: String
    var modifier: String?
    var instruction: String
    var location: LatLon
}

nonisolated struct NavStep: Hashable, Sendable {
    var index: Int
    var distanceM: Double
    var durationS: Double
    /// A lépés eleje az útvonalon (m, az útvonal hosszára skálázva).
    var startM: Double
    var name: String
    /// A lépés VÉGÉN lévő manőver (a Directions-ben a következő lépés `maneuver`-je).
    var endManeuver: NavManeuver
    /// A lépés végén következő manőverre vonatkozó szalag-szövegek (a Directions `bannerInstructions`-e).
    var banners: [NavBanner]
    var voice: [NavVoice]
}

/// Egy útvonal a Directions-válaszból, az app számára kényelmes alakban.
nonisolated struct NavRoute: Identifiable, Hashable, Sendable {
    var id: String
    var points: [LatLon]
    var distanceM: Double
    var durationS: Double
    /// Forgalom nélküli (tipikus) idő; `nil`, ha a válasz nem tartalmazta.
    var typicalDurationS: Double?
    var steps: [NavStep]
    /// Szakaszonként (két pont között) az útvonal mentén: kumulált táv az elején (m, skálázott); hossza = points - 1.
    var segStartM: [Double]
    var segLimitKmh: [Double?]
    var segCongestion: [Congestion]
    var segDurationS: [Double]
}

nonisolated struct NavDestination: Hashable, Sendable {
    var name: String
    var lat: Double
    var lon: Double

    var latLon: LatLon { LatLon(lat: lat, lon: lon) }
}

nonisolated enum EnforcementKind: String, Sendable {
    case section, camera, planned
}

/// Az útvonal menti szakasz-ellenőrzés / kamera / tervezett mérés.
nonisolated struct EnforcementItem: Hashable, Sendable {
    var kind: EnforcementKind
    var id: String
    /// Az útvonal menti belépés (kamerára: a hely) és kilépés (m).
    var startM: Double
    var endM: Double
    var limitKmh: Double?
    var label: String
    /// Ellenőrzött forrásból való-e (kamerára, szakaszra).
    var verified: Bool?
}

/// A navigáció küszöbei – egy helyen, hogy hangolhatók legyenek (a tesztek is innen olvasnak).
nonisolated struct NavConfig: Sendable {
    /// Ennél távolabb az útvonaltól „letért” (m).
    var offRouteM: Double
    /// Ennyi ideig kell letértnek lennie az újratervezéshez (ms).
    var offRouteMs: Double
    /// Két újratervezés között legalább ennyi idő (ms).
    var rerouteMinGapMs: Double
    /// Két Directions-hívás között legalább ennyi idő (ms) – költségvédelem.
    var directionsMinGapMs: Double
    /// Alternatíva-figyelés gyakorisága (ms).
    var altCheckEveryMs: Double
    /// Egy alternatíva ajánlásához legalább ennyi nyereség (s) VAGY a hátralévő idő ekkora hányada.
    /// AW12: a weben az `ALT_OFFER` („megéri”-szabály, ≥ 2 perc) váltotta; a generált `NAV_CONFIG` már nem adja – az
    /// alapérték a régi szabály, amíg az iOS-port át nem veszi (utána törlendő).
    var altMinGainS: Double = 300
    var altMinGainFraction: Double = 0.15
    /// Az ajánlat ennyi ideig áll nyitva, utána elvetettnek számít (ms).
    var offerTtlMs: Double
    /// Az útvonal ennyire közel lévő szakaszt / kamerát / mérést veszünk az útvonalra (m); alapból `ROUTE_MATCH_M`.
    var enforcementBandM: Double
    /// Ekkora távolságtól jelezzük a közeledő szakaszt a felső kártyán (m).
    var enforcementWarnM: Double
    /// Ekkora távolságtól mondjuk be a közeledő szakaszt (m).
    var enforcementVoiceM: Double
    /// A cél ennyire közel: megérkeztünk (m).
    var arriveM: Double
    /// A „Túl gyors” bemondás ismétlési tilalma (ms).
    var tooFastRepeatMs: Double
    /// Keresés: legalább ennyi karaktertől, ennyi ms késleltetéssel.
    var geocodeMinChars: Int
    var geocodeDebounceMs: Double
    /// Utolsó úti célok száma.
    var recentMax: Int
}

// A `NAV_CONFIG` és a `NAV_COUNTRIES` a webbel közös: Generated/AppLogicConstants.swift (navigation/config.ts-ből).
