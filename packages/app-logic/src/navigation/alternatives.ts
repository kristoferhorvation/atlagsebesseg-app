import { Route, type LatLon } from '@atlagsebesseg/core';
import { t } from '../i18n';
import { ROUTE_MATCH_M } from './config';
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
