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
    thenWithinM: 5000.0,
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
    static let autoSwitchExitM = 500.0
}
/// Kamera-közeledés a felső sávon (AW12): `max(minM, leadS × sebesség)` távolságon belül.
nonisolated enum CAMERA_ALERT {
    static let minM = 250.0
    static let leadS = 10.0
}
/// Követő kamera navigáció közben (AW12): zoom a sebességből (km/h → zoom), irány-követés ideje (ms), a pozíció
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
/// AOS15: a kamera-kártya irány-sora – a haladási iránytól legfeljebb `sameDirDeg`-re eső mérési irány „a te irányod”.
nonisolated enum CAMERA_CARD {
    static let sameDirDeg = 90.0
}
/// AW18: élő forgalom (2 perces friss lekérés), „+N perc dugó” (≥ `delayShowS`, hang csak először),
/// helyi dugó-érzékelés (`jamWindowMs` ablak a megengedett sebesség `jamSlowFraction`-ja alatt; vége a `jamClearFraction` fölött),
/// a „Dugóba kerültél?” kártya `jamPromptMs`-ig, közösségi dugó-adat `communityMaxAgeMs`-ig, újratervezés-backoff (s).
nonisolated enum TRAFFIC {
    static let refreshMs = 120000.0
    static let delayShowS = 180.0
    static let delayMaxFraction = 0.5
    static let jamWindowMs = 180000.0
    static let jamSlowFraction = 0.4
    static let jamStartMovedM = 100.0
    static let jamStoppedMps = 1.4
    static let lightNearM = 60.0
    static let lightPatienceMs = 120000.0
    static let jamClearFraction = 0.7
    static let jamClearCityM = 1000.0
    static let jamClearCityMs = 120000.0
    static let jamClearHighwayM = 3000.0
    static let jamClearHighwayMs = 180000.0
    static let jamDeclineMuteMs = 600000.0
    static let jamPromptMs = 15000.0
    static let jamAheadMaxM = 2000.0
    static let jamNoDataMaxM = 1000.0
    static let jamMinKmh = 5.0
    static let jamUploadMs = 120000.0
    static let communityMaxAgeMs = 900000.0
    static let communityHeadingDeg = 45.0
    static let reportedLengthM = 300.0
    static let rerouteBackoffS: [Double] = [5.0, 10.0, 20.0, 30.0]
    static let directionsTimeoutMs = 10000.0
}
/// AW19: krúzing mód / utak naplója – indulás (`startKmh` × `startHoldS`), állás (`idleKmh`, zárás `stopIdleS` után),
/// pontosság és ugrás-szűrés, kanyar-felismerés (`turnDeg` / `turnWindowS`, vége `turnSettleS` / `turnSettleDeg`),
/// Douglas–Peucker (`simplifyM`), H3-felbontás, 1 Hz-es mintavétel, a legrövidebb mentett út.
nonisolated enum TRIP {
    static let startKmh = 15.0
    static let startHoldS = 30.0
    static let idleKmh = 5.0
    static let stopIdleS = 300.0
    static let maxAccuracyM = 30.0
    static let cruiseGapS = 30.0
    static let maxJumpKmh = 250.0
    static let turnDeg = 60.0
    static let turnWindowS = 5.0
    static let turnSettleS = 3.0
    static let turnSettleDeg = 15.0
    static let turnMinNetDeg = 45.0
    static let uTurnDeg = 150.0
    static let turnMinKmh = 10.0
    static let turnMaxS = 60.0
    static let simplifyM = 10.0
    static let h3Res = 10.0
    static let sampleMinMs = 900.0
    static let minTripM = 200.0
    static let resumeNewTripM = 500.0
    static let checkpointS = 60.0
    static let maneuverPassM = 80.0
}
/// AW20: hőtérkép – cella-felbontások, zoom-küszöb, pontplafon, lakóhely-védelem (az út első / utolsó `shareEndsM` méterének
/// cellái sosem mennek fel), súly-skálák, a közösségi lekérés gyorsítótára és a feltöltés-várólista.
nonisolated enum HEAT {
    static let res = 10.0
    static let coarseRes = 8.0
    static let coarseBelowZoom = 12.5
    static let maxFeatures = 4000.0
    static let viewPad = 0.25
    static let minPassKmh = 5.0
    static let passGapMs = 120000.0
    static let shareEndsM = 300.0
    static let freqCap = 20.0
    static let speedMaxKmh = 130.0
    static let cacheMs = 600000.0
    static let querySnapDeg = 0.05
    static let queryLimit = 5000.0
    static let outboxMax = 2000.0
    static let zoneDefaultM = 200.0
    static let zoneMarginM = 70.0
    static let zoneMarginCoarseM = 470.0
    static let serverMinRows = 3.0
}
/// AW20: az út színezése a mért sebesség szerint (a limithez képest `rel*`, limit nélkül abszolút `abs*`, `steps` fokozat).
nonisolated enum SPEED_TONE {
    static let relGreen = 0.9
    static let relYellow = 1.0
    static let relRed = 1.15
    static let absGreen = 50.0
    static let absYellow = 90.0
    static let absRed = 130.0
    static let steps = 12.0
}
/// A megszólítás (AOS14) legfeljebb ennyi karakter.
nonisolated let MEGSZOLITAS_MAX = 24

/// A nyelvek saját nevükön és zászlajuk (AW15: a nyelvválasztó) – a webes `LANGUAGE_NAMES` / `LANGUAGE_FLAGS`.
nonisolated let LANGUAGE_NAMES: [String: String] = ["hu": "Magyar", "en": "English", "de": "Deutsch", "sk": "Slovenčina", "cs": "Čeština", "pl": "Polski"]
nonisolated let LANGUAGE_FLAGS: [String: String] = ["hu": "🇭🇺", "en": "🇬🇧", "de": "🇩🇪", "sk": "🇸🇰", "cs": "🇨🇿", "pl": "🇵🇱"]
