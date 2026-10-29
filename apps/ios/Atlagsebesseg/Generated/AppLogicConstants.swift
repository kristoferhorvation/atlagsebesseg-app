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
