// GENERÁLT FÁJL – kézzel ne szerkeszd.
// Forrás: packages/app-logic/src/plannedChecks.ts, navigation/config.ts; újragenerálás: npm run generate -w @atlagsebesseg/ios

/// A tervezett mérés vonalának tűrése (m): ennyi méteren belül számít a pozíció a vonalon lévőnek.
nonisolated let PLANNED_MATCH_M = 100.0
/// Ennyi egymás utáni, vonalon kívüli fix után tűnik el a sáv (egy kiugró GPS-pont nem tünteti el).
nonisolated let PLANNED_OFF_FIXES = 2
/// A navigációs útvonal-elemzés tűrése (m): ennyire közel lévő szakasz / kamera / tervezett mérés kerül az útvonalra.
/// Nem azonos a tervezett mérés sávjának tűrésével (PLANNED_MATCH_M).
nonisolated let ROUTE_MATCH_M = 40.0
