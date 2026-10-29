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
  /** Az ajánlat ennyi ideig áll nyitva, utána az alapértelmezés szerint dől el ({@link ALT_OFFER}) (ms). */
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

/**
 * A „Gyorsabb út” ajánlat szabálya (AW12, az első éles navi-teszt után). Ajánlat csak legalább `minGainS` nyereségnél;
 * a „megéri”-e: `net = Δperc − k · Δkm`, ahol `k` (perc/km) az alternatíva várható átlagsebességéből
 * (Directions duration/distance) jön: `slowKmh`-ig `kSlow`, `fastKmh`-tól `kFast`, között lineáris.
 * `net ≥ worthNetMin` → „Megéri” (lejáratkor elfogadja), `0 < net < worthNetMin` → „Lehet”, `net ≤ 0` → „Nem éri meg”
 * (mindkettőnél lejáratkor marad a régi).
 */
export const ALT_OFFER = {
  minGainS: 120,
  worthNetMin: 2,
  slowKmh: 40,
  fastKmh: 110,
  kSlow: 1.0,
  kFast: 0.3,
  /**
   * Mérés közben a lehajtó a végkapu előtt vagy UTÁNA ennyin belül: azonnali (kompakt) ajánlat bemondással (AW13);
   * a távolabbi lehajtó a mérés végéig vár (m).
   */
  exitAfterGateM: 1000,
} as const;

/** Kamera-közeledés a felső sávon: `max(minM, leadS × sebesség)` távolságon belül borostyán sáv + egy rezgés. */
export const CAMERA_ALERT = {
  minM: 250,
  leadS: 10,
} as const;

/**
 * Követő kamera navigáció közben: zoom a sebességgel (km/h → zoom, között lineáris, a széleken állandó), a
 * haladási irány követésének ideje (ms), és az autó helye a képernyőn (0 = fent, 1 = lent: az alsó harmadban, hogy az
 * út előre látsszon), legalább `focusGapPx`-szel az alsó kártya fölött.
 */
export const NAV_FOLLOW = {
  zoomStops: [
    [40, 17],
    [90, 15.5],
    [130, 14.5],
  ] as readonly (readonly [number, number])[],
  bearingMs: 400,
  focusY: 0.72,
  focusGapPx: 56,
} as const;

/**
 * Kézi mérés navigáció közben (AW15): a kártya `collapseAfterMs` után kis pillé zsugorodik (a jobb oldalon), és akkor is,
 * ha a navigációnak hely kell – a következő manőver `maneuverNearM`-en belül, ajánlat-kártya vagy közeli kamera.
 */
export const MANUAL_PILL = {
  collapseAfterMs: 5000,
  maneuverNearM: 500,
} as const;
