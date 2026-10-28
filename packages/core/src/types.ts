/** WGS84 koordináta, fokban. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Az adat eredete: OSM-import, hivatalos lista vagy közösségi bejelentés. */
export type SectionSource = 'osm' | 'hivatalos' | 'kozosseg';

/** Hogyan állapítottuk meg a kapuk helyét a forrásból. */
export type SectionLocatedBy = 'koordinata' | 'km_szelveny' | 'telepules';

/** Egy szakasz forrása: ki adta ki, hol, mikor, és hogyan lett belőle hely. */
export interface SectionProvenance {
  /** A forrás (hivatalos szerv) neve, pl. "Polizia di Stato"; OSM-nél "OpenStreetMap". */
  name: string;
  url: string;
  /** A forrás dátuma: "2026-08" vagy "2026-08-14". */
  date: string;
  locatedBy: SectionLocatedBy;
}

/**
 * Egy irányú átlagsebesség-mérő szakasz.
 * Egy útszakasz két irányát két külön `Section` írja le.
 */
export interface Section {
  id: string;
  /** ISO 3166-1 alpha-2 országkód, pl. "IT", "AT", "HU". */
  country: string;
  /** Útszám, pl. "A1". */
  road: string;
  /** Emberi olvasásra szánt irány, pl. "Bologna → Firenze". */
  direction: string;
  /** Kezdőpont (a belépő kapu). */
  start: LatLon;
  /** Végpont (a kilépő kapu). */
  end: LatLon;
  /** A szakasz hossza méterben (lehetőleg a hivatalos érték). */
  lengthM: number;
  /** Sebességhatár km/h-ban. */
  speedLimitKmh: number;
  source: SectionSource;
  /** Ember által ellenőrzött adat-e. */
  verified: boolean;
  /**
   * Az út vonala a haladási irányban, `start`-tól `end`-ig.
   * Opcionális: ha hiányzik, a felismerés a start→end egyenest használja,
   * ami kanyargós szakaszon pontatlan (és letérés-észlelésre alkalmatlan).
   */
  geometry?: LatLon[];
  /** A forrás (hivatalos importnál mindig kitöltve). */
  provenance?: SectionProvenance;
}

/** Egy GPS-mérés. Az ismeretlen értékek `null`-ok. */
export interface GpsFix {
  lat: number;
  lon: number;
  /** Unix-idő ezredmásodpercben. */
  timestamp: number;
  /** Sebesség m/s-ban. */
  speed: number | null;
  /** Vízszintes pontosság méterben (68%-os sugár). */
  accuracy: number | null;
  /** Haladási irány fokban (0 = észak, óramutató szerint). */
  heading: number | null;
}
