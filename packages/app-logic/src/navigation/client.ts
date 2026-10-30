import type { LatLon } from '@atlagsebesseg/core';
import type { Lang } from '../i18n';
import { NAV_CONFIG } from './config';
import { directionsUrl, DirectionsError, parseDirections } from './directions';
import { TRAFFIC } from './traffic';
import type { NavRoute } from './types';

/** Szinkron kulcs-érték tár (a webes localStorage-burok; a natív app más implementációt ad). */
export interface SyncStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const REQUEST_COUNT_KEY = 'nav:requests:v1';

/** Helyi nap kulcsa: „2026-10-28”. */
export const dayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Napi útvonal-kérés számláló (Beállítások → Állapot); éjfélkor nullázódik. */
export class RequestCounter {
  private day = '';
  private n = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: SyncStore,
    private readonly now: () => number = Date.now,
  ) {
    this.load();
  }

  private load(): void {
    const day = dayKey(this.now());
    try {
      const p = JSON.parse(this.store.getItem(REQUEST_COUNT_KEY) ?? 'null') as { day?: string; n?: number } | null;
      this.day = day;
      this.n = p?.day === day && typeof p.n === 'number' ? p.n : 0;
    } catch {
      this.day = day;
      this.n = 0;
    }
  }

  /** A mai kérések száma. */
  get count(): number {
    if (this.day !== dayKey(this.now())) {
      this.day = dayKey(this.now());
      this.n = 0;
    }
    return this.n;
  }

  increment(): void {
    this.n = this.count + 1;
    try {
      this.store.setItem(REQUEST_COUNT_KEY, JSON.stringify({ day: this.day, n: this.n }));
    } catch {
      // tárhely nélkül csak erre a munkamenetre számol
    }
    for (const l of [...this.listeners]) l();
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RouteRequestContext {
  heading: number | null;
  /**
   * Mi miatt kérünk: az első tervezés, újratervezés, alternatíva-figyelés (AW18 óta egyben a 2 perces forgalom-frissítés),
   * vagy forgalom-frissítés a jelenlegi útvonalon (`traffic`, a `via` köztes ponttal), ha az alternatívák között nem volt meg.
   */
  reason: 'plan' | 'reroute' | 'alternatives' | 'traffic';
  /** AW18: néma köztes pont (a következő manőver), hogy a lekérés a jelenlegi útvonalon maradjon. */
  via?: LatLon | null;
}

/** Az útvonal-kérés függvénye – a `NavigationSession` ezt kapja (élesben a `DirectionsClient`, a szimulátorban a fixtúra). */
export type RouteFetcher = (from: LatLon, to: LatLon, ctx: RouteRequestContext) => Promise<NavRoute[]>;

/**
 * A Mapbox Directions-kliens költségvédelemmel: két hívás között legalább `directionsMinGapMs`
 * (különben `RateLimited`), és minden elküldött kérés beleszámít a napi számlálóba.
 */
export class DirectionsClient {
  private lastCallAt = -Infinity;

  constructor(
    private readonly opts: { token: string; lang: () => Lang; fetch: FetchLike; counter: RequestCounter; now?: () => number; minGapMs?: number; timeoutMs?: number },
  ) {}

  routes: RouteFetcher = async (from, to, ctx) => {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.lastCallAt < (this.opts.minGapMs ?? NAV_CONFIG.directionsMinGapMs)) throw new DirectionsError('RateLimited');
    this.lastCallAt = now;
    this.opts.counter.increment();
    // AW18: időtúllépés (a naplóban „timeout”, a hálózati hiba „network”, a HTTP-hiba „http_<státusz>”)
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DirectionsError('timeout')), this.opts.timeoutMs ?? TRAFFIC.directionsTimeoutMs);
    });
    const res = await Promise.race([this.opts.fetch(directionsUrl(from, to, this.opts.lang(), this.opts.token, { heading: ctx.heading, via: ctx.via ?? null })), timeout]).finally(() =>
      clearTimeout(timer),
    );
    // a Directions hibakódja (pl. NoRoute) 200-nál is, 4xx-nél is a törzsben jön
    const json = await res.json().catch(() => null);
    if (!res.ok && !(json && typeof json === 'object' && 'code' in json)) throw new DirectionsError(`http_${res.status}`);
    return parseDirections(json, `r${Math.round(now / 1000)}-`);
  };
}
