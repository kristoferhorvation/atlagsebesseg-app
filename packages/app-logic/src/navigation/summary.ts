import { trafficDelayS } from './directions';
import { adjustedDurations, cumulative, routeEnforcement, type EnforcementData } from './enforcement';
import type { NavRoute } from './types';

/** Az útvonalválasztó kártya adatai egy útvonalra. */
export interface RouteSummary {
  /** Menetidő (s) a szakaszokon a határral számolva. */
  durationS: number;
  distanceM: number;
  sections: number;
  cameras: number;
  /** Ebből az ellenőrzött forrásból valók. */
  camerasVerified: number;
  /** Dugó miatti késés (s) a tipikus időhöz képest. */
  delayS: number;
}

export function routeSummary(route: NavRoute, data: EnforcementData, now: number): RouteSummary {
  const items = routeEnforcement(route, data, now);
  return {
    durationS: cumulative(adjustedDurations(route, items)).at(-1) ?? route.durationS,
    distanceM: route.distanceM,
    sections: items.filter((i) => i.kind === 'section').length,
    cameras: items.filter((i) => i.kind === 'camera').length,
    camerasVerified: items.filter((i) => i.kind === 'camera' && i.verified).length,
    delayS: trafficDelayS(route),
  };
}
