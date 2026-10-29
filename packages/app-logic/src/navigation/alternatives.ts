import { Route, type LatLon } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { ALT_OFFER, ROUTE_MATCH_M } from './config';
import type { NavRoute } from './types';

/** A címke ennyivel a leágazás után kerül az alternatívára (m). */
export const ALT_LABEL_AFTER_M = 300;
/** A leágazás keresésének lépésköze az alternatíva mentén (m). */
const DIVERGE_STEP_M = 25;

/** Az alternatív útvonal címkéje a térképen: kis buborék a menetidő-különbséggel a kiválasztotthoz képest. */
export interface AltLabel {
  routeId: string;
  /** Az útvonal indexe a listában (a kiválasztás erre vált). */
  index: number;
  at: LatLon;
  /** Az alternatíva menetideje mínusz a kiválasztotté (s); pozitív = lassabb. */
  deltaS: number;
  text: string;
}

/**
 * A leágazás: az alternatíva menti első pont (m, az alternatíva elejétől), amely már nincs a `base`
 * `ROUTE_MATCH_M` sávjában. `null`, ha az alternatíva végig a `base`-en halad.
 */
export function divergenceAlongM(base: NavRoute, alt: NavRoute, bandM = ROUTE_MATCH_M): number | null {
  const rb = new Route(base.points, base.distanceM);
  const ra = new Route(alt.points, alt.distanceM);
  for (let d = 0; d <= ra.lengthM; d += DIVERGE_STEP_M) if (rb.project(ra.pointAt(d)).crossM > bandM) return d;
  return null;
}

/** Menetidő-különbség szövege: „+1 perc”, „−2 perc”, egy percen belül „≈ ugyanannyi”. */
export function altDeltaText(deltaS: number): string {
  const n = Math.round(deltaS / 60);
  if (n === 0) return t('nav.alt.same');
  return t(n > 0 ? 'nav.alt.slower' : 'nav.alt.faster', { n: Math.abs(n) });
}

/**
 * A nem kiválasztott útvonalak címkéi: a leágazás után `afterM`-rel (de legfeljebb az útvonal végén), a
 * menetidő (`durationsS`, az útvonalválasztó kártyájával azonos – a szakaszokon a határral számolt) különbségével.
 * A kiválasztottal végig egyező alternatíva nem kap címkét.
 */
export function altLabels(routes: readonly NavRoute[], durationsS: readonly number[], selected: number, afterM = ALT_LABEL_AFTER_M): AltLabel[] {
  const base = routes[selected];
  if (!base) return [];
  const out: AltLabel[] = [];
  routes.forEach((r, index) => {
    if (index === selected) return;
    const d = divergenceAlongM(base, r);
    if (d === null) return;
    const along = new Route(r.points, r.distanceM);
    const deltaS = (durationsS[index] ?? r.durationS) - (durationsS[selected] ?? base.durationS);
    out.push({ routeId: r.id, index, at: along.pointAt(Math.min(d + afterM, along.lengthM)), deltaS, text: altDeltaText(deltaS) });
  });
  return out;
}

/** Érintés egy útvonalra (vonal vagy címke): az új kiválasztott indexe; ismeretlen azonosítónál marad a régi. */
export function selectRouteById(routes: readonly NavRoute[], selected: number, id: string): number {
  const i = routes.findIndex((r) => r.id === id);
  return i < 0 ? selected : i;
}

// ---------------------------------------------------------------------------
// „Megéri”-szabály (AW12)
// ---------------------------------------------------------------------------

/** Az ajánlat kategóriája: megéri (lejáratkor elfogadja) / lehet / nem éri meg (lejáratkor marad a régi). */
export type AltVerdict = 'worth' | 'maybe' | 'not';

export interface AltWorth {
  /** Nyereség (perc, pozitív = gyorsabb). */
  gainMin: number;
  /** Többlet-táv (km, pozitív = hosszabb). */
  extraKm: number;
  /** A kerülő ára (perc/km) az alternatíva átlagsebességéből. */
  k: number;
  /** `gainMin − k · extraKm`. */
  net: number;
  verdict: AltVerdict;
}

/** A kerülő ára (perc/km): `slowKmh`-ig `kSlow`, `fastKmh`-tól `kFast`, között lineáris. */
export function detourCostPerKm(avgKmh: number): number {
  const { slowKmh, fastKmh, kSlow, kFast } = ALT_OFFER;
  if (!(avgKmh > slowKmh)) return kSlow;
  if (avgKmh >= fastKmh) return kFast;
  return kSlow + ((avgKmh - slowKmh) / (fastKmh - slowKmh)) * (kFast - kSlow);
}

/** Az útvonal várható átlagsebessége (km/h) a Directions távolságából és idejéből. */
export const routeAvgKmh = (r: NavRoute): number => (r.durationS > 0 ? (r.distanceM / r.durationS) * 3.6 : 0);

/** Megéri-e: `net = Δperc − k · Δkm`; `net ≥ worthNetMin` → megéri, `0 < net` → lehet, különben nem éri meg. */
export function altWorth(gainS: number, extraM: number, avgKmh: number): AltWorth {
  const gainMin = gainS / 60;
  const extraKm = extraM / 1000;
  const k = detourCostPerKm(avgKmh);
  const net = gainMin - k * extraKm;
  const verdict: AltVerdict = net >= ALT_OFFER.worthNetMin ? 'worth' : net > 0 ? 'maybe' : 'not';
  return { gainMin, extraKm, k, net, verdict };
}

/** Egész perc (legalább 1) és egész km a feliratokhoz; „lehet” / „nem éri meg” esetén a kerülő legalább 1 km. */
function rounded(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>) {
  const n = Math.max(1, Math.round(w.gainMin));
  const km = Math.round(w.extraKm);
  return { n, km: w.verdict === 'worth' ? km : Math.max(1, km) };
}

/** A kártya címe: „Megéri · −7 perc, +4 km”, „Lehet · −2 perc, +1 km”, „Nem éri meg · +20 km kerülő, −10 perc”. */
export function altOfferTitle(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>): string {
  const { n, km } = rounded(w);
  if (w.verdict === 'maybe') return t('nav.offer.maybe', { n, km });
  if (w.verdict === 'not') return t('nav.offer.not', { n, km });
  if (km === 0) return t('nav.offer.worthNoKm', { n });
  return t('nav.offer.worth', { n, km: km > 0 ? `+${km}` : `−${-km}` });
}

/**
 * A kompakt (mérés közbeni) ajánlat két sora: „Kijárat 56” / „2,1 km · −7 perc”; név nélküli lehajtónál „Lehajtó 2,1
 * km-nél” / „−7 perc”, ismeretlen lehajtónál csak a cím. `exitKm`: a lehajtóig hátralévő táv a nyelv tizedesjelével.
 */
export function altOfferCompactLines(o: {
  title: string;
  gainS: number;
  exitAlongM: number | null;
  exitName: string | null;
  exitKm: string;
}): [string, string | null] {
  const n = Math.max(1, Math.round(o.gainS / 60));
  if (o.exitAlongM === null) return [o.title, null];
  if (!o.exitName) return [t('nav.offer.exitAt', { km: o.exitKm }), t('nav.alt.faster', { n })];
  return [o.exitName, t('nav.offer.compactDetail', { km: o.exitKm, n })];
}

/**
 * A bemondás: „Gyorsabb út, 7 perc megtakarítás, lehajtó 5,2 kilométernél” (megéri; ismeretlen lehajtónál a lehajtó
 * nélkül) / „…, 2 perc, 1 kilométer kerülő, te döntesz” / „…, de nem éri meg, 20 kilométer kerülő”. `exitKm`: a lehajtóig
 * hátralévő táv a nyelv tizedesjelével.
 */
export function altOfferVoice(w: Pick<AltWorth, 'gainMin' | 'extraKm' | 'verdict'>, exitKm: string | null = null): string {
  const { n, km } = rounded(w);
  if (w.verdict === 'maybe') return t('nav.voice.fasterMaybe', { n, km });
  if (w.verdict === 'not') return t('nav.voice.fasterNot', { km });
  return exitKm === null ? t('nav.voice.faster', { n }) : t('nav.voice.fasterWorthExit', { n, km: exitKm });
}
