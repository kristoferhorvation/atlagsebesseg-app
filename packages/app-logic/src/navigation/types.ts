import type { LatLon } from '@atlagsebesseg/core';

export interface Place {
  id: string;
  /** Rövid név (pl. „Győr”). */
  name: string;
  /** A hely pontosabb leírása (pl. „Győr-Moson-Sopron, Magyarország”). */
  address: string;
  lat: number;
  lon: number;
}

export type Congestion = 'unknown' | 'low' | 'moderate' | 'heavy' | 'severe';

export interface BannerText {
  text: string;
  /** A Directions manőver-típusa (`turn`, `roundabout`, `arrive`…). */
  type: string;
  modifier: string | null;
  /** A kijárat felirata a banner `exit` + `exit-number` komponenseiből („Kijárat 56”); a pajzs- és sáv-komponenseket nem tartalmazza. */
  exit?: string | null;
}

export interface NavBanner {
  /** A lépés végétől ennyi méterre (vagy közelebb) jelenik meg. */
  distanceAlongM: number;
  primary: BannerText;
  secondary: BannerText | null;
  sub: BannerText | null;
}

export interface NavVoice {
  distanceAlongM: number;
  text: string;
}

export interface NavStep {
  index: number;
  distanceM: number;
  durationS: number;
  /** A lépés eleje az útvonalon (m, az útvonal hosszára skálázva). */
  startM: number;
  name: string;
  /** A lépés VÉGÉN lévő manőver (a Directions-ben a következő lépés `maneuver`-je). */
  endManeuver: { type: string; modifier: string | null; instruction: string; location: LatLon };
  /** A lépés végén következő manőverre vonatkozó szalag-szövegek (a Directions `bannerInstructions`-e). */
  banners: NavBanner[];
  voice: NavVoice[];
}

/** Egy útvonal a Directions-válaszból, az app számára kényelmes alakban. */
export interface NavRoute {
  id: string;
  points: LatLon[];
  distanceM: number;
  durationS: number;
  /** Forgalom nélküli (tipikus) idő; `null`, ha a válasz nem tartalmazta. */
  typicalDurationS: number | null;
  steps: NavStep[];
  /** Szakaszonként (két pont között) az útvonal mentén: kumulált táv az elején (m, skálázott); hossza = points - 1. */
  segStartM: number[];
  segLimitKmh: (number | null)[];
  segCongestion: Congestion[];
  segDurationS: number[];
}

export interface NavDestination {
  name: string;
  lat: number;
  lon: number;
}

export type EnforcementKind = 'section' | 'camera' | 'planned';

/** Az útvonal menti szakasz-ellenőrzés / kamera / tervezett mérés. */
export interface EnforcementItem {
  kind: EnforcementKind;
  id: string;
  /** Az útvonal menti belépés (kamerára: a hely) és kilépés (m). */
  startM: number;
  endM: number;
  limitKmh: number | null;
  label: string;
  /** Ellenőrzött forrásból való-e (kamerára, szakaszra). */
  verified?: boolean;
}
