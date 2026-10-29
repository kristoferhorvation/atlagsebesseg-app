import { Route, type GpsFix, type LatLon } from '@atlagsebesseg/core';
import { speedIn, type SpeedStatus } from '../display';
import { formatNumber, t } from '../i18n';
import type { SpeedUnit } from '../settings';
import type { RouteFetcher } from './client';
import { altOfferTitle, altOfferVoice, altWorth, routeAvgKmh, type AltVerdict, type AltWorth } from './alternatives';
import { ALT_OFFER, CAMERA_ALERT, NAV_CONFIG, type NavConfig } from './config';
import { limitAt } from './directions';
import { adjustedDurations, cumulative, firstNewManeuver, NO_ENFORCEMENT_DATA, remainingSeconds, routeEnforcement, routeOverlap, type EnforcementData } from './enforcement';
import { maneuverIcon, type ManeuverIcon } from './maneuver';
import { routeTarget, type EnforcementItem, type NavDestination, type NavRoute, type NavStep } from './types';

export type VoiceKind = 'instruction' | 'section' | 'tooFast' | 'reroute' | 'faster';

/** Egy bemondandó mondat; a platform (pl. speechSynthesis) olvassa fel. */
export interface VoiceEvent {
  id: string;
  kind: VoiceKind;
  text: string;
}

export interface ManeuverView {
  icon: ManeuverIcon;
  /** A szalag szövege (út / irány), pl. „M1”. */
  text: string;
  /** A teljes mondat a Directions-től (az app nyelvén). */
  instruction: string;
  /** A manőverig hátralévő távolság (m). */
  distanceM: number;
}

/** Kamera-közeledés: ennyi méteren belül (de legalább 250 m) borostyán sáv: `max(minM, leadS × sebesség)`. */
export const cameraAlertM = (speedMps: number | null): number => Math.max(CAMERA_ALERT.minM, CAMERA_ALERT.leadS * Math.max(0, speedMps ?? 0));

/** Az „Utána” sor szövege: a Directions szalagja, ha az nem a teljes utasítás-mondat (név nélküli manővernél az), különben az utcanév / kijárat / rövid manőver-szó. */
export function thenText(step: NavStep, after: NavStep | undefined, icon: ManeuverIcon): string {
  const banner = step.banners.at(-1);
  const instr = step.endManeuver.instruction.trim().replace(/[.!]$/, '');
  const text = banner?.primary.text.trim() ?? '';
  // név nélküli manővernél a Directions a szalagra is a mondatot teszi (esetleg kissé átfogalmazva)
  const sentence = !text || (instr !== '' && (instr.startsWith(text) || (text.includes(',') && instr.split(' ')[0] === text.split(' ')[0])));
  if (icon !== 'arrive') {
    if (!sentence) return text;
    if (after?.name.trim()) return after.name.trim();
    if (banner?.primary.exit) return banner.primary.exit;
  }
  return t(`nav.man.${icon}`);
}

export interface AlternativeOffer {
  id: string;
  route: NavRoute;
  /** Nyereség a jelenlegi útvonalhoz képest (s). */
  gainS: number;
  /** Többlet-táv a jelenlegi útvonal hátralévő részéhez képest (m; negatív = rövidebb). */
  extraM: number;
  /** Megéri / lehet / nem éri meg (a „megéri”-szabály, {@link ALT_OFFER}); lejáratkor csak a „megéri” fogadódik el. */
  verdict: AltVerdict;
  /** A kártya címe („Megéri · −7 perc, +4 km”). */
  title: string;
  expiresAt: number;
  /** A lehajtó (az alternatíva első új manővere) helye az aktuális útvonal mentén (m); `null`, ha nem állapítható meg. */
  exitAlongM: number | null;
  /** A lehajtó manőver neve (pl. a kijárat), ha van. */
  exitName: string | null;
  /** A leágazásig hátralévő távolság (m) – a nézetben élőben számolva. */
  exitInM: number;
  /** Ugyanez km-ben, a nyelv tizedesjelével (a feliratokhoz). */
  exitKm: string;
  /** Mérés közben megjelenő, kompakt forma. */
  compact: boolean;
}

/** Az ajánlat jelöltje: az alternatíva és a lehajtója. */
interface Candidate {
  route: NavRoute;
  gainS: number;
  extraM: number;
  worth: AltWorth;
  exitAlongM: number | null;
  exitName: string | null;
}

export interface NavView {
  phase: 'navigating' | 'arrived';
  /** Nő, ha új útvonal vette át a helyet (a térkép újrarajzolja). */
  routeVersion: number;
  route: NavRoute;
  destination: NavDestination;
  alongM: number;
  crossM: number;
  remainingM: number;
  /** Hátralévő idő (s) a szakaszokon a határral számolva. */
  remainingS: number;
  etaMs: number;
  next: ManeuverView;
  then: ManeuverView | null;
  /** Az útvonal sebességhatára (maxspeed-annotáció); `null`: nincs adat. */
  limitKmh: number | null;
  /** A legközelebbi, még nem érintett szakasz / kamera / mérés az előre jelzési távolságon belül. */
  upcoming: { item: EnforcementItem; distanceM: number } | null;
  /** A kamera a {@link cameraAlertM} távolságon belül (a felső sáv borostyán); elhaladás után `null`. */
  cameraNear: { item: EnforcementItem; distanceM: number } | null;
  enforcement: readonly EnforcementItem[];
  offRoute: boolean;
  rerouting: boolean;
  offer: AlternativeOffer | null;
  /** Az utolsó újratervezés sikertelen volt (a következő kísérletig). */
  rerouteFailed: boolean;
}

export interface NavSessionDeps {
  fetchRoutes: RouteFetcher;
  now?: () => number;
  config?: Partial<NavConfig>;
  unit?: SpeedUnit;
  voice?: boolean;
}

const sortDesc = <T extends { distanceAlongM: number }>(a: readonly T[]) => [...a].sort((x, y) => y.distanceAlongM - x.distanceAlongM);

/** Egy útvonal ujjlenyomata (az elvetett ajánlat újbóli felbukkanásának megakadályozásához). */
export function routeSignature(r: NavRoute): string {
  const mid = r.points[Math.floor(r.points.length / 2)]!;
  return `${Math.round(r.distanceM / 200)}:${mid.lat.toFixed(3)},${mid.lon.toFixed(3)}`;
}

/**
 * A navigáció állapotgépe (platformfüggetlen): pozíció-illesztés az útvonalra, lépés- és
 * manőver-követés, letérés → újratervezés, alternatíva-figyelés, szakaszellenőrzés-tudatos ETA,
 * bemondandó mondatok. Az UI csak kirajzol (`view()`), és a `drainVoice()`-t olvassa fel.
 */
export class NavigationSession {
  private readonly cfg: NavConfig;
  private readonly fetchRoutes: RouteFetcher;
  private readonly clock: () => number;
  private unit: SpeedUnit;
  private voiceOn: boolean;

  private route!: NavRoute;
  private core!: Route;
  private items: EnforcementItem[] = [];
  private cum: number[] = [];
  private data: EnforcementData = NO_ENFORCEMENT_DATA;
  private routeVersion = 0;

  private along = 0;
  private cross = 0;
  private lastFix: GpsFix | null = null;
  private arrived = false;

  private offSince: number | null = null;
  /** Az „Újratervezés” ennél a letérésnél már elhangzott (a letérés kezdetén, a kiírással együtt). */
  private rerouteSaid = false;
  private rerouting = false;
  private rerouteFailed = false;
  private lastRerouteAt: number | null = null;
  private lastCallAt: number | null = null;
  private lastAltAt: number;
  private altPending = false;
  private offer: AlternativeOffer | null = null;
  /** Mérés közben visszatartott ajánlat: a mérés végén jelenik meg, friss lejárati idővel. */
  private held: Candidate | null = null;
  /** Az az ajánlat, amelynél a 500 m-es második bemondás már elhangzott (vagy fölösleges). */
  private exit500For: string | null = null;
  private measuring = false;
  private readonly declined = new Set<string>();

  private spoken = new Set<string>();
  private voiceQueue: VoiceEvent[] = [];
  private voiceSeq = 0;
  private measureStatus: SpeedStatus | null = null;
  private lastTooFastAt: number | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private cached: NavView | null = null;

  constructor(
    route: NavRoute,
    readonly destination: NavDestination,
    deps: NavSessionDeps,
  ) {
    this.cfg = { ...NAV_CONFIG, ...deps.config };
    this.fetchRoutes = deps.fetchRoutes;
    this.clock = deps.now ?? Date.now;
    this.unit = deps.unit ?? 'kmh';
    this.voiceOn = deps.voice ?? true;
    this.lastAltAt = this.clock();
    this.install(route);
  }

  // ---------------------------------------------------------------------------
  // Beállítások, bemenetek
  // ---------------------------------------------------------------------------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  setUnit(unit: SpeedUnit): void {
    this.unit = unit;
  }

  /** Hangos utasítások ki / be; kikapcsolva a bemondandók eldobódnak (nem halmozódnak). */
  setVoice(on: boolean): void {
    this.voiceOn = on;
    if (!on) this.voiceQueue = [];
  }

  /** A környék szakaszai, kamerái, tervezett mérései (az adat később is érkezhet, újraszámol). */
  setData(data: EnforcementData): void {
    this.data = data;
    this.recomputeEnforcement();
    this.changed();
  }

  /** A mérés állapota: „Túl gyors”-ra váltáskor bemondja (legfeljebb 30 mp-enként). */
  setMeasureStatus(status: SpeedStatus | null): void {
    const was = this.measureStatus;
    this.measureStatus = status;
    if (status !== 'tul_gyors' || was === 'tul_gyors') return;
    const t0 = this.clock();
    if (this.lastTooFastAt !== null && t0 - this.lastTooFastAt < this.cfg.tooFastRepeatMs) return;
    this.lastTooFastAt = t0;
    this.say('tooFast', t('nav.voice.tooFast'));
  }

  /** Aktív mérés (szakasz vagy kézi): az ajánlat addig nem jelenik meg, a mérés végén indul a TTL. */
  setMeasuring(measuring: boolean): void {
    if (measuring === this.measuring) return;
    this.measuring = measuring;
    if (measuring && this.offer && this.exitJustAfterGate(this.offer.exitAlongM)) {
      this.declined.add(routeSignature(this.offer.route));
      this.offer = null;
    } else if (measuring && this.offer && !this.exitBeforeSectionEnd(this.offer.exitAlongM)) {
      const o = this.offer;
      this.held = { route: o.route, gainS: o.gainS, extraM: o.extraM, worth: altWorth(o.gainS, o.extraM, routeAvgKmh(o.route)), exitAlongM: o.exitAlongM, exitName: o.exitName };
      this.offer = null;
    } else if (!measuring && this.held) {
      const h = this.held;
      this.held = null;
      this.present(h);
    }
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Fix és óra
  // ---------------------------------------------------------------------------

  onFix(fix: GpsFix): NavView {
    const first = this.lastFix === null;
    this.lastFix = fix;
    if (!this.arrived) this.project(fix, !first);
    this.advance(this.clock(), fix.accuracy);
    this.changed();
    return this.view();
  }

  /** Fix nélküli frissítés (másodpercenként): időzítők, ajánlat lejárata. */
  tick(): NavView {
    this.advance(this.clock(), null);
    this.changed();
    return this.view();
  }

  private project(fix: GpsFix, useHint: boolean): void {
    const hint = useHint ? { fromM: this.along - 300, toM: this.along + 3000 } : undefined;
    let p = this.core.project(fix, hint);
    // a tipp-tartományon kívüli útvonalrészre (lerövidítés) is visszatalálunk
    if (hint && p.crossM > this.cfg.offRouteM) {
      const full = this.core.project(fix);
      if (full.crossM < p.crossM) p = full;
    }
    this.along = Math.min(this.route.distanceM, Math.max(0, p.alongM));
    this.cross = p.crossM;
  }

  private advance(t0: number, accuracy: number | null): void {
    if (this.arrived) return;
    if (this.lastFix && this.route.distanceM - this.along <= this.cfg.arriveM) {
      this.arrived = true;
      this.offer = null;
      this.offSince = null;
      this.collectVoice();
      return;
    }
    this.collectVoice();

    // letérés: 50 m-nél távolabb, 5 mp-ig (nagyon pontatlan fixnél nem ítélünk)
    if (accuracy === null || accuracy <= 80) {
      if (this.cross <= this.cfg.offRouteM) {
        this.offSince = null;
        this.rerouteSaid = false;
      } else if (this.offSince === null) {
        this.offSince = t0;
        // a hang a sárga „Újratervezés” kiírással együtt szól, nem az új útvonal megérkezésekor
        if (!this.rerouting && !this.rerouteSaid) {
          this.rerouteSaid = true;
          this.say('reroute', t('nav.voice.rerouting'));
        }
      }
    }
    if (this.offSince !== null && t0 - this.offSince >= this.cfg.offRouteMs && !this.rerouting && this.lastFix && this.canRoute(t0, this.lastRerouteAt, this.cfg.rerouteMinGapMs)) {
      this.startReroute(this.lastFix, t0);
    }

    // lejárat: a „megéri” magától elfogadódik, a „lehet” / „nem éri meg” esetén marad a régi
    if (this.offer && t0 >= this.offer.expiresAt) {
      if (this.offer.verdict === 'worth') this.acceptOffer();
      else this.declineOffer();
    }
    // a leágazást elhagytuk: az ajánlat érvénytelen
    if (this.offer && this.offer.exitAlongM !== null && this.along > this.offer.exitAlongM + 50) this.offer = null;
    if (this.held && this.held.exitAlongM !== null && this.along > this.held.exitAlongM + 50) this.held = null;
    // Waze-minta: a lehajtó előtt 500 m-nél még egyszer
    const o = this.offer;
    if (o && o.verdict !== 'not' && o.exitAlongM !== null && this.exit500For !== o.id && o.exitAlongM - this.along <= 500) {
      this.exit500For = o.id;
      this.say('faster', t('nav.voice.fasterExit500'));
    }

    // alternatíva-figyelés: 2 percenként, ha minden rendben
    if (
      this.lastFix &&
      !this.rerouting &&
      !this.altPending &&
      this.offSince === null &&
      this.offer === null &&
      (this.held === null || this.measuring) &&
      t0 - this.lastAltAt >= this.cfg.altCheckEveryMs &&
      this.canRoute(t0, this.lastCallAt, this.cfg.directionsMinGapMs)
    ) {
      this.startAltCheck(this.lastFix, t0);
    }
  }

  /** Új kérés indulhat: a saját korlát (`gap`) és az általános Directions-korlát is eltelt. */
  private canRoute(t0: number, last: number | null, gap: number): boolean {
    return (last === null || t0 - last >= gap) && (this.lastCallAt === null || t0 - this.lastCallAt >= this.cfg.directionsMinGapMs);
  }

  // ---------------------------------------------------------------------------
  // Újratervezés és alternatívák
  // ---------------------------------------------------------------------------

  private startReroute(fix: GpsFix, t0: number): void {
    this.rerouting = true;
    this.rerouteFailed = false;
    this.lastRerouteAt = t0;
    this.lastCallAt = t0;
    this.offer = null;
    this.held = null;
    if (!this.rerouteSaid) {
      this.rerouteSaid = true;
      this.say('reroute', t('nav.voice.rerouting'));
    }
    const from: LatLon = { lat: fix.lat, lon: fix.lon };
    this.fetchRoutes(from, routeTarget(this.destination), { heading: fix.heading, reason: 'reroute' }).then(
      (routes) => {
        if (this.disposed) return;
        this.rerouting = false;
        const r = routes[0];
        if (r) {
          this.install(r);
          this.offSince = null;
          this.rerouteSaid = false;
          this.lastAltAt = this.clock();
        } else this.rerouteFailed = true;
        this.changed();
      },
      () => {
        if (this.disposed) return;
        this.rerouting = false;
        this.rerouteFailed = true;
        this.changed();
      },
    );
    this.changed();
  }

  private startAltCheck(fix: GpsFix, t0: number): void {
    this.altPending = true;
    this.lastAltAt = t0;
    this.lastCallAt = t0;
    const version = this.routeVersion;
    const from: LatLon = { lat: fix.lat, lon: fix.lon };
    this.fetchRoutes(from, routeTarget(this.destination), { heading: fix.heading, reason: 'alternatives' }).then(
      (routes) => {
        if (this.disposed) return;
        this.altPending = false;
        if (version === this.routeVersion && !this.rerouting) this.evaluateAlternatives(routes);
        this.changed();
      },
      () => {
        this.altPending = false;
      },
    );
  }

  /** ETA-jellegű idő (s) egy útvonalra: a szakaszokon a határral. */
  private durationOf(route: NavRoute): number {
    const items = routeEnforcement(route, this.data, this.clock(), this.cfg.enforcementBandM);
    return cumulative(adjustedDurations(route, items)).at(-1)!;
  }

  private evaluateAlternatives(routes: readonly NavRoute[]): void {
    // a jelenlegi útvonal friss (forgalmas) idejét a vele egyező útvonal adja; ha nincs ilyen, a saját becslésünk
    const same = routes.find((r) => routeOverlap(this.route, r) >= 0.9);
    const baseline = same ? this.durationOf(same) : this.remainingS();
    const baseM = same ? same.distanceM : this.route.distanceM - this.along;
    // legalább 2 perc nyereség; a jelöltek közül a „megéri”-szabály szerint legjobb (legnagyobb nettó nyereség)
    let best: { route: NavRoute; gainS: number; extraM: number; worth: AltWorth } | null = null;
    for (const r of routes) {
      if (r === same || this.declined.has(routeSignature(r))) continue;
      const gainS = baseline - this.durationOf(r);
      if (gainS < ALT_OFFER.minGainS) continue;
      const extraM = r.distanceM - baseM;
      const worth = altWorth(gainS, extraM, routeAvgKmh(r));
      if (!best || worth.net > best.worth.net) best = { route: r, gainS, extraM, worth };
    }
    if (!best) return;
    const exit = firstNewManeuver(this.route, best.route);
    this.present({ ...best, exitAlongM: exit ? this.along + exit.distanceM : null, exitName: exit?.name ?? null });
  }

  /** A mérés alatt álló szakasz (a pozíció a kapui között); kézi mérésnél nincs. */
  private measuredSection(): EnforcementItem | undefined {
    return this.items.find((i) => i.kind === 'section' && i.startM <= this.along && this.along <= i.endM);
  }

  /** A mérés alatt álló szakasz végkapuja előtt van-e a leágazás (kézi mérésnél nincs végkapu → nem). */
  private exitBeforeSectionEnd(exitAlongM: number | null): boolean {
    const sec = this.measuredSection();
    return exitAlongM !== null && sec !== undefined && exitAlongM < sec.endM;
  }

  /** Mérés közben a lehajtó a végkapu után, de `exitAfterGateM`-en belül: erre nem ajánlunk (se közben, se a mérés végén). */
  private exitJustAfterGate(exitAlongM: number | null): boolean {
    const sec = this.measuredSection();
    return exitAlongM !== null && sec !== undefined && exitAlongM >= sec.endM && exitAlongM - sec.endM <= ALT_OFFER.exitAfterGateM;
  }

  /** Az ajánlat megjelenítése (és bemondása); mérés közben visszatartjuk, a kapu utáni közeli lehajtót elvetjük. */
  private present(best: Candidate): void {
    if (this.measuring && this.exitJustAfterGate(best.exitAlongM)) {
      this.declined.add(routeSignature(best.route));
      return;
    }
    if (this.measuring && !this.exitBeforeSectionEnd(best.exitAlongM)) {
      this.held = best;
      return;
    }
    const w = best.worth;
    this.offer = {
      id: `offer-${++this.voiceSeq}`,
      route: best.route,
      gainS: best.gainS,
      extraM: best.extraM,
      verdict: w.verdict,
      title: altOfferTitle(w),
      exitAlongM: best.exitAlongM,
      exitName: best.exitName,
      exitInM: 0,
      exitKm: '',
      compact: false,
      expiresAt: this.clock() + this.cfg.offerTtlMs,
    };
    // a második (500 m-es) bemondás fölösleges, ha az első is 600 m-en belül hangzik el
    this.exit500For = best.exitAlongM !== null && best.exitAlongM - this.along <= 600 ? this.offer.id : null;
    this.say('faster', altOfferVoice(w));
  }

  private offerView(o: AlternativeOffer): AlternativeOffer {
    const exitInM = o.exitAlongM === null ? 0 : Math.max(0, o.exitAlongM - this.along);
    return { ...o, exitInM, exitKm: this.exitKm(exitInM), compact: this.measuring };
  }

  private exitKm(m: number): string {
    return formatNumber(Math.max(0, m) / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  }

  acceptOffer(): void {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    this.install(o.route);
    this.offSince = null;
    this.changed();
  }

  declineOffer(): void {
    if (this.offer) this.declined.add(routeSignature(this.offer.route));
    this.offer = null;
    this.changed();
  }

  // ---------------------------------------------------------------------------
  // Útvonal beállítása
  // ---------------------------------------------------------------------------

  private install(route: NavRoute): void {
    this.route = route;
    this.core = new Route(route.points, route.distanceM);
    this.routeVersion++;
    this.spoken = new Set();
    this.along = 0;
    this.cross = 0;
    this.recomputeEnforcement();
    // az új útvonal a jelenlegi pozícióról indul: újra illesztünk
    if (this.lastFix) this.project(this.lastFix, false);
  }

  private recomputeEnforcement(): void {
    this.items = routeEnforcement(this.route, this.data, this.clock(), this.cfg.enforcementBandM);
    this.cum = cumulative(adjustedDurations(this.route, this.items));
  }

  private remainingS(): number {
    return remainingSeconds(this.route, this.cum, this.along);
  }

  // ---------------------------------------------------------------------------
  // Hang
  // ---------------------------------------------------------------------------

  private say(kind: VoiceKind, text: string): void {
    if (!this.voiceOn || !text) return;
    this.voiceQueue.push({ id: `v${++this.voiceSeq}`, kind, text });
  }

  /** A bemondandók kiolvasása (a sor kiürül). */
  drainVoice(): VoiceEvent[] {
    const q = this.voiceQueue;
    this.voiceQueue = [];
    return q;
  }

  private stepIndex(): number {
    const s = this.route.steps;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid]!.startM <= this.along) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** A fordulók hangutasításai (Directions) és a szakaszellenőrzés-közeledés. */
  private collectVoice(): void {
    const step = this.route.steps[this.stepIndex()];
    if (step) {
      const left = step.startM + step.distanceM - this.along;
      const due = sortDesc(step.voice).filter((v) => !this.spoken.has(`${step.index}:${v.distanceAlongM}`) && left <= v.distanceAlongM);
      for (const v of due) this.spoken.add(`${step.index}:${v.distanceAlongM}`);
      // ha egyszerre több esedékes (gyors haladás), csak a legközelebbit mondjuk
      const latest = due.at(-1);
      if (latest) this.say('instruction', latest.text);
    }
    for (const it of this.items) {
      if (it.kind !== 'section' || this.spoken.has(`enf:${it.id}`)) continue;
      const d = it.startM - this.along;
      if (d > 0 && d <= this.cfg.enforcementVoiceM) {
        this.spoken.add(`enf:${it.id}`);
        this.say('section', t('nav.voice.sectionAhead', { x: speedIn(it.limitKmh, this.unit) ?? '' }));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Nézet
  // ---------------------------------------------------------------------------

  private changed(): void {
    this.cached = null;
    for (const l of [...this.listeners]) l();
  }

  private maneuverOf(step: NavStep, distanceM: number, remainingInStep: number): ManeuverView {
    const m = step.endManeuver;
    // a szalag: a legkisebb küszöb, ami még ≥ a lépésből hátralévő távolság
    const banner = [...step.banners].reverse().find((b) => b.distanceAlongM >= remainingInStep) ?? step.banners[0];
    const type = banner?.primary.type ?? m.type;
    const modifier = banner ? banner.primary.modifier : m.modifier;
    return {
      icon: maneuverIcon(type, modifier),
      text: banner?.primary.text || step.name || m.instruction,
      instruction: m.instruction,
      distanceM,
    };
  }

  view(): NavView {
    if (this.cached) return this.cached;
    const steps = this.route.steps;
    const idx = this.stepIndex();
    const step = steps[idx]!;
    const left = Math.max(0, step.startM + step.distanceM - this.along);
    const next = this.maneuverOf(step, left, left);
    const following = steps[idx + 1];
    let then: ManeuverView | null = null;
    if (following && step.endManeuver.type !== 'arrive') {
      const m = this.maneuverOf(following, following.distanceM, 0);
      then = { ...m, text: thenText(following, steps[idx + 2], m.icon) };
    }
    const up = this.items.find((it) => it.startM > this.along && it.startM - this.along <= this.cfg.enforcementWarnM) ?? null;
    const camM = cameraAlertM(this.lastFix?.speed ?? null);
    const cam = this.arrived ? null : (this.items.find((it) => it.kind === 'camera' && it.startM > this.along && it.startM - this.along <= camM) ?? null);
    const remainingS = this.arrived ? 0 : this.remainingS();
    this.cached = {
      phase: this.arrived ? 'arrived' : 'navigating',
      routeVersion: this.routeVersion,
      route: this.route,
      destination: this.destination,
      alongM: this.along,
      crossM: this.cross,
      remainingM: Math.max(0, this.route.distanceM - this.along),
      remainingS,
      etaMs: this.clock() + remainingS * 1000,
      next,
      then,
      limitKmh: limitAt(this.route, this.along),
      upcoming: up ? { item: up, distanceM: up.startM - this.along } : null,
      cameraNear: cam ? { item: cam, distanceM: cam.startM - this.along } : null,
      enforcement: this.items,
      offRoute: this.offSince !== null && this.cross > this.cfg.offRouteM,
      rerouting: this.rerouting,
      offer: this.offer ? this.offerView(this.offer) : null,
      rerouteFailed: this.rerouteFailed,
    };
    return this.cached;
  }
}
