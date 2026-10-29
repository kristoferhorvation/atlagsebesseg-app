/** A navigáció küszöbei – egy helyen, hogy hangolhatók legyenek (a tesztek is innen olvasnak). */
export interface NavConfig {
  /** Ennél távolabb az útvonaltól „letért” (m). */
  offRouteM: number;
  /** Ennyi ideig kell letértnek lennie az újratervezéshez (ms). */
  offRouteMs: number;
  /** Két újratervezés között legalább ennyi idő (ms). */
  rerouteMinGapMs: number;
  /** Két Directions-hívás között legalább ennyi idő (ms) – költségvédelem. */
  directionsMinGapMs: number;
  /** Alternatíva-figyelés gyakorisága (ms). */
  altCheckEveryMs: number;
  /** Egy alternatíva ajánlásához legalább ennyi nyereség (s) VAGY a hátralévő idő ekkora hányada. */
  altMinGainS: number;
  altMinGainFraction: number;
  /** Az ajánlat ennyi ideig áll nyitva, utána elvetettnek számít (ms). */
  offerTtlMs: number;
  /** Az útvonal ennyire közel lévő szakaszt / kamerát / mérést veszünk az útvonalra (m); alapból {@link ROUTE_MATCH_M}. */
  enforcementBandM: number;
  /** Ekkora távolságtól jelezzük a közeledő szakaszt a felső kártyán (m). */
  enforcementWarnM: number;
  /** Ekkora távolságtól mondjuk be a közeledő szakaszt (m). */
  enforcementVoiceM: number;
  /** A cél ennyire közel: megérkeztünk (m). */
  arriveM: number;
  /** A „Túl gyors” bemondás ismétlési tilalma (ms). */
  tooFastRepeatMs: number;
  /** Keresés: legalább ennyi karaktertől, ennyi ms késleltetéssel. */
  geocodeMinChars: number;
  geocodeDebounceMs: number;
  /** Utolsó úti célok száma. */
  recentMax: number;
}

/**
 * A navigációs útvonal-elemzés tűrése (m): ennyire közel lévő szakaszt / kamerát / tervezett mérést veszünk az
 * útvonalra (a core `entryCrossM`-mel egyező 40 m). A vonalon haladás sávjának tűrése külön: `PLANNED_MATCH_M`.
 */
export const ROUTE_MATCH_M = 40;

export const NAV_CONFIG: NavConfig = {
  offRouteM: 50,
  offRouteMs: 5_000,
  rerouteMinGapMs: 20_000,
  directionsMinGapMs: 5_000,
  altCheckEveryMs: 120_000,
  altMinGainS: 300,
  altMinGainFraction: 0.15,
  offerTtlMs: 45_000,
  enforcementBandM: ROUTE_MATCH_M,
  enforcementWarnM: 2000,
  enforcementVoiceM: 500,
  arriveM: 30,
  tooFastRepeatMs: 30_000,
  geocodeMinChars: 3,
  geocodeDebounceMs: 300,
  recentMax: 10,
};

/** Az országok, ahol keresünk és tervezünk (Geocoding `country`). */
export const NAV_COUNTRIES = ['HU', 'AT', 'SK', 'SI', 'HR', 'RO', 'IT', 'PL', 'DE', 'CZ'] as const;
