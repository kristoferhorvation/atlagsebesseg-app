import { Route } from '@atlagsebesseg/core';
import { ROUTE_MATCH_M } from './config';
import { segmentAt } from './directions';
import type { EnforcementItem, NavRoute } from './types';

export type TimelineKind = 'section' | 'camera' | 'planned' | 'jam' | 'report';

/** Egy esemény a hátralévő út sávján: `aheadM` a mostani helytől, `at` a sáv mentén (0 = itt, 1 = a cél). */
export interface TimelineEvent {
  kind: TimelineKind;
  aheadM: number;
  at: number;
}

/**
 * AW23: a hátralévő út eseményei a távval arányos helyen: szakaszellenőrzés, kamera, tervezett mérés (a `enforcement`-ből), dugó (a
 * heavy / severe szakaszok eleje), bejelentés (az útvonal sávjában lévők).
 */
export function routeTimeline(route: NavRoute, alongM: number, enforcement: readonly EnforcementItem[], reports: readonly { lat: number; lon: number }[]): TimelineEvent[] {
  const rest = Math.max(1, route.distanceM - alongM);
  const out: TimelineEvent[] = [];
  const add = (kind: TimelineKind, m: number) => {
    if (m >= alongM && m <= route.distanceM) out.push({ kind, aheadM: m - alongM, at: (m - alongM) / rest });
  };
  for (const it of enforcement) add(it.kind, it.startM);
  const heavy = (i: number) => route.segCongestion[i] === 'heavy' || route.segCongestion[i] === 'severe';
  const first = segmentAt(route, alongM);
  for (let i = first; i < route.segCongestion.length; i++) {
    if (heavy(i) && (i === first || !heavy(i - 1))) add('jam', Math.max(alongM, route.segStartM[i]!));
  }
  if (reports.length > 0) {
    const core = new Route(route.points, route.distanceM);
    for (const r of reports) {
      const p = core.project(r);
      if (p.crossM <= ROUTE_MATCH_M) add('report', p.alongM);
    }
  }
  return out.sort((a, b) => a.aheadM - b.aheadM);
}
