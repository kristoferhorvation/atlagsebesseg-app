// GENERÁLT FÁJL – kézzel ne szerkeszd.
// Forrás: packages/app-logic/src/plannedChecks.ts, navigation/config.ts; újragenerálás: npm run generate -w @atlagsebesseg/ios

/// A tervezett mérés vonalának tűrése (m): ennyi méteren belül számít a pozíció a vonalon lévőnek.
nonisolated let PLANNED_MATCH_M = 100.0
/// Ennyi egymás utáni, vonalon kívüli fix után tűnik el a sáv (egy kiugró GPS-pont nem tünteti el).
nonisolated let PLANNED_OFF_FIXES = 2
/// A navigációs útvonal-elemzés tűrése (m): ennyire közel lévő szakasz / kamera / tervezett mérés kerül az útvonalra.
/// Nem azonos a tervezett mérés sávjának tűrésével (PLANNED_MATCH_M).
nonisolated let ROUTE_MATCH_M = 40.0

/// A navigáció küszöbei (A11) – a webes `NAV_CONFIG` értékei.
nonisolated let NAV_CONFIG = NavConfig(
    offRouteM: 50.0,
    offRouteMs: 5000.0,
    rerouteMinGapMs: 20000.0,
    directionsMinGapMs: 5000.0,
    altCheckEveryMs: 120000.0,
    offerTtlMs: 45000.0,
    enforcementBandM: 40.0,
    enforcementWarnM: 2000.0,
    enforcementVoiceM: 500.0,
    arriveM: 30.0,
    tooFastRepeatMs: 30000.0,
    geocodeMinChars: 3,
    geocodeDebounceMs: 300.0,
    recentMax: 10
)
/// Az országok, ahol keresünk és tervezünk (Geocoding `country`).
nonisolated let NAV_COUNTRIES = ["HU", "AT", "SK", "SI", "HR", "RO", "IT", "PL", "DE", "CZ"]

/// A „Gyorsabb út” ajánlat szabálya (AW12/AW13) – a webes `ALT_OFFER`: legalább `minGainS` nyereség;
/// `net = Δperc − k · Δkm`, `k` az alternatíva átlagsebességéből (`slowKmh`-ig `kSlow`, `fastKmh`-tól `kFast`);
/// mérés közben a végkapu után `exitAfterGateM`-en belüli lehajtó azonnali ajánlatot kap.
nonisolated enum ALT_OFFER {
    static let minGainS = 120.0
    static let worthNetMin = 2.0
    static let slowKmh = 40.0
    static let fastKmh = 110.0
    static let kSlow = 1.0
    static let kFast = 0.3
    static let exitAfterGateM = 1000.0
}
/// Kamera-közeledés a felső sávon (AW12): `max(minM, leadS × sebesség)` távolságon belül.
nonisolated enum CAMERA_ALERT {
    static let minM = 250.0
    static let leadS = 10.0
}
/// Követő kamera navigáció közben (AW12): zoom a sebességből (km/h → zoom), irány-követés ideje (ms), a pozíció
/// helye a képernyőn (0 = fent, 1 = lent) és a távolsága az alsó kártyától (pt).
nonisolated enum NAV_FOLLOW {
    static let zoomStops: [(kmh: Double, zoom: Double)] = [(40.0, 17.0), (90.0, 15.5), (130.0, 14.5)]
    static let bearingMs = 400.0
    static let focusY = 0.72
    static let focusGapPx = 56.0
}
/// A kézi mérés pillje navigáció közben (AW15): `collapseAfterMs` után, vagy ha a következő manőver `maneuverNearM`-en
/// belül van (ajánlat, közeli kamera mellett is), a kártya pillé zsugorodik.
nonisolated enum MANUAL_PILL {
    static let collapseAfterMs = 5000.0
    static let startSpaceCollapseMs = 3000.0
    static let maneuverNearM = 500.0
}
/// „Még ott van?” (AOS14): a figyelmeztetés `nearM`-rel a bejelentés előtt (álló autónál irány nélkül `nearM`-en belül) vált
/// kérdésre, az elhaladás után `showMs`-ig látható; ±`coneDeg` az „előttünk”, bejelentésenként egyszer.
nonisolated enum REPORT_PROMPT {
    static let nearM = 50.0
    static let coneDeg = 45.0
    static let showMs = 10000.0
}
/// A megszólítás (AOS14) legfeljebb ennyi karakter.
nonisolated let MEGSZOLITAS_MAX = 24

/// A nyelvek saját nevükön és zászlajuk (AW15: a nyelvválasztó) – a webes `LANGUAGE_NAMES` / `LANGUAGE_FLAGS`.
nonisolated let LANGUAGE_NAMES: [String: String] = ["hu": "Magyar", "en": "English", "de": "Deutsch", "sk": "Slovenčina", "cs": "Čeština", "pl": "Polski"]
nonisolated let LANGUAGE_FLAGS: [String: String] = ["hu": "🇭🇺", "en": "🇬🇧", "de": "🇩🇪", "sk": "🇸🇰", "cs": "🇨🇿", "pl": "🇵🇱"]
