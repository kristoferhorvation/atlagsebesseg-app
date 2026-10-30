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
import { applyCommunityJams, JamDetector, jamSample, rerouteRetryDelayMs, routeErrorKind, TRAFFIC, type CommunityJam, type JamSampleInsert } from './traffic';
import { routeTarget, type EnforcementItem, type NavDestination, type NavRoute, type NavStep } from './types';

export type VoiceKind = 'instruction' | 'section' | 'tooFast' | 'reroute' | 'faster' | 'traffic';

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
  /** A lejáratig hátralévő idő aránya (1 → 0) – a kiemelt gomb alatti fogyó csík (AW13). */
  timeLeft: number;
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
  /** AW18: sikertelen újratervezés után a következő automatikus próbáig hátralévő másodperc (koppintásra azonnal). */
  rerouteRetryInS: number | null;
  /** AW18: az indulási terv érkezési ideje (a „+N perc dugó” viszonyítási alapja). */
  plannedEtaMs: number;
  /** AW18: „+N perc dugó” – a friss (Mapbox / helyi dugó) ETA legalább 3 perccel az indulási terv után; különben `null`. */
  delayMin: number | null;
  /** AW18: helyi dugó-állapot (a mért tempó tartósan a várt alatt). */
  jam: boolean;
  /** AW18: a „Dugóba kerültél? Igen / Nem” kártya látszik (dugóba lépéskor, 15 s-ig vagy válaszig). */
  jamAsk: boolean;
}

export interface NavSessionDeps {
  fetchRoutes: RouteFetcher;
  now?: () => number;
  config?: Partial<NavConfig>;
  unit?: SpeedUnit;
  voice?: boolean;
  /** AW18: a hiba-napló (az újratervezés hibájának oka); alapból `console.warn`. */
  log?: (msg: string) => void;
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
  private readonly log: (msg: string) => void;
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
  /** AW18: egymás utáni sikertelen újratervezések; a következő próba ideje (növekvő várakozással). */
  private rerouteFailures = 0;
  private rerouteRetryAt: number | null = null;
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

  // AW18: forgalom
  /** Az indulási terv érkezési ideje (ms). */
  private plannedEtaMs = 0;
  /** A friss forgalmi útvonal (a jelenlegi útvonalon, `fromAlongM`-től), a szakaszokkal és a közösségi adattal számolt idővel. */
  private fresh: { route: NavRoute; cum: number[]; fromAlongM: number; version: number } | null = null;
  /** Volt már friss forgalmi adat (lekérés vagy újratervezés) – a „+N perc dugó” csak ettől (vagy dugóban) látszik. */
  private hasFresh = false;
  /** Az alternatívák között nem volt meg a jelenlegi útvonal: forgalom-lekérés köztes ponttal esedékes. */
  private trafficViaDue = false;
  private trafficPending = false;
  private communityJams: readonly CommunityJam[] = [];
  /** A nyers (Directions) idők kumulálva – a várt tempóhoz. */
  private rawCum: number[] = [];
  private readonly jamDetector = new JamDetector();
  private jamAskUntil: number | null = null;
  private jamAskKey: string | null = null;
  private readonly jamDeclined = new Set<string>();
  private lastJamUploadAt: number | null = null;
  private jamUploads: JamSampleInsert[] = [];
  /** A „+N perc dugó” hangja már elhangzott (AW18-javítás: csak egyszer). */
  private delaySaid = false;

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
    this.log = deps.log ?? ((m) => console.warn(m));
    this.lastAltAt = this.clock();
    this.install(route);
    this.plannedEtaMs = this.clock() + this.remainingS() * 1000;
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
    if (measuring && this.offer && !this.exitNearSectionEnd(this.offer.exitAlongM)) {
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

  /**
   * AW18: más felhasználók friss dugó-mintái (`active_jams`, a platform ~60 s-enként kéri); az érintett szakaszok ideje a
   * mért átlaggal az ETA-ban.
   */
  setCommunityJams(jams: readonly CommunityJam[]): void {
    this.communityJams = jams;
    this.recomputeEnforcement();
    if (this.fresh) this.fresh = { ...this.fresh, cum: this.cumOf(this.fresh.route) };
    this.changed();
  }

  /**
   * AW18: „Dugóba kerültél?” válasz. Igen: a platform a „Dugó” bejelentést küldi (a meglévő folyamattal), itt a közösségi
   * minta kerül a sorba; Nem: ebben az útban ugyanarra a szakaszra (a következő manőverig) nem kérdez újra.
   */
  answerJam(yes: boolean): void {
    if (this.jamAskKey !== null && !yes) this.jamDeclined.add(this.jamAskKey);
    if (yes) this.reportedJam();
    this.jamAskUntil = null;
    this.changed();
  }

  /** AW18: kézi „Dugó” / „Beállt” bejelentés (vagy a kártya „Igen”-je): bejelentett közösségi minta a mért átlaggal. */
  reportedJam(): void {
    const f = this.lastFix;
    if (!f) return;
    this.jamUploads.push(jamSample('bejelentett', f, this.jamDetector.avgMps ?? Math.max(0, f.speed ?? 0), TRAFFIC.reportedLengthM));
  }

  /** AW18: a feltöltendő közösségi dugó-minták kiolvasása (a sor kiürül). */
  drainJamSamples(): JamSampleInsert[] {
    const q = this.jamUploads;
    this.jamUploads = [];
    return q;
  }

  /**
   * AW18: koppintás a „nem sikerült” kártyára – azonnali újrapróba; ha az előző hívás 5 s-on belül volt (a Directions
   * költségkorlátja), akkor annak leteltével (a visszaszámlálás ezt mutatja).
   */
  retryReroute(): void {
    if (!this.rerouteFailed || this.rerouting) return;
    this.rerouteRetryAt = Math.max(this.clock(), (this.lastCallAt ?? -Infinity) + this.cfg.directionsMinGapMs);
    this.advance(this.clock(), null);
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
    // AW18: az indulási terv érkezési ideje az első fixnél (addigra a szakasz-adat is megvan)
    if (first) this.plannedEtaMs = this.clock() + this.remainingS() * 1000;
    if (!this.arrived && this.cross <= this.cfg.offRouteM) this.watchJam(fix);
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
    // AW17: a „megéri” ajánlat a lehajtó előtt 500 m-en belül magától elfogad (nem várja ki a 45 s-ot); a hang a kézi
    // elfogadáséval azonos (az új útvonal manőver-bemondása – ezért a bemondások összegyűjtése előtt), a 500 m-es
    // „Gyorsabb út” ismétlés így elmarad
    if (this.offer && this.offer.verdict === 'worth' && this.offer.exitAlongM !== null && this.offer.exitAlongM - this.along <= ALT_OFFER.autoSwitchExitM) {
      this.acceptOffer();
    }
    this.collectVoice();

    // letérés: 50 m-nél távolabb, 5 mp-ig (nagyon pontatlan fixnél nem ítélünk)
    if (accuracy === null || accuracy <= 80) {
      if (this.cross <= this.cfg.offRouteM) {
        this.offSince = null;
        this.rerouteSaid = false;
        // visszatértünk az útvonalra: a sikertelen újratervezés már nem kell
        if (this.rerouteFailed && !this.rerouting) this.clearRerouteFailure();
      } else if (this.offSince === null) {
        this.offSince = t0;
        // a hang a sárga „Újratervezés” kiírással együtt szól, nem az új útvonal megérkezésekor
        if (!this.rerouting && !this.rerouteSaid) {
          this.rerouteSaid = true;
          this.say('reroute', t('nav.voice.rerouting'));
        }
      }
    }
    // AW18: sikertelen próba után növekvő várakozással (5 → 10 → 20 → 30 s), egyébként legfeljebb 20 s-enként
    const rerouteDue = this.rerouteFailed
      ? this.rerouteRetryAt !== null && t0 >= this.rerouteRetryAt && this.canRoute(t0, null, this.cfg.directionsMinGapMs)
      : this.canRoute(t0, this.lastRerouteAt, this.cfg.rerouteMinGapMs);
    if (this.offSince !== null && t0 - this.offSince >= this.cfg.offRouteMs && !this.rerouting && this.lastFix && rerouteDue) {
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

    // alternatíva-figyelés és forgalom-frissítés (AW18: egy hívás): 2 percenként, ha az útvonalon vagyunk – látható
    // ajánlat mellett is (az ETA miatt), de új ajánlat csak akkor jön, ha nincs másik
    if (
      this.lastFix &&
      !this.rerouting &&
      !this.altPending &&
      !this.trafficPending &&
      this.offSince === null &&
      t0 - this.lastAltAt >= this.cfg.altCheckEveryMs &&
      this.canRoute(t0, this.lastCallAt, this.cfg.directionsMinGapMs)
    ) {
      this.startAltCheck(this.lastFix, t0);
    }
    // a jelenlegi útvonal nem volt az alternatívák között: forgalom-lekérés köztes ponttal (a következő manőver)
    if (this.trafficViaDue && this.lastFix && !this.rerouting && !this.altPending && !this.trafficPending && this.offSince === null && this.canRoute(t0, null, this.cfg.directionsMinGapMs)) {
      this.startTrafficCheck(this.lastFix, t0);
    }

    this.updateTraffic(t0);
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
          // az újratervezés maga a friss driving-traffic lekérés a jelenlegi pozíciótól (AW18)
          this.install(r);
          this.hasFresh = true;
          this.offSince = null;
          this.rerouteSaid = false;
          this.lastAltAt = this.clock();
          this.clearRerouteFailure();
        } else this.rerouteFailedWith('NoRoute');
        this.changed();
      },
      (e: unknown) => {
        if (this.disposed) return;
        this.rerouting = false;
        this.rerouteFailedWith(routeErrorKind(e));
        this.changed();
      },
    );
    this.changed();
  }

  /** AW18: sikertelen újratervezés – a következő próba növekvő várakozással; az ok a naplóba. */
  private rerouteFailedWith(kind: string): void {
    this.rerouteFailed = true;
    this.rerouteFailures++;
    const wait = rerouteRetryDelayMs(this.rerouteFailures);
    this.rerouteRetryAt = this.clock() + wait;
    // a napló technikai (ékezet nélkül, mint a platformok hibanaplója): ok, próba sorszáma, következő próba
    this.log(`[nav] reroute failed (${kind}), attempt ${this.rerouteFailures}, retry in ${wait / 1000} s`);
  }

  private clearRerouteFailure(): void {
    this.rerouteFailed = false;
    this.rerouteFailures = 0;
    this.rerouteRetryAt = null;
  }

  private startAltCheck(fix: GpsFix, t0: number): void {
    this.altPending = true;
    this.lastAltAt = t0;
    this.lastCallAt = t0;
    const version = this.routeVersion;
    const fromAlongM = this.along;
    const from: LatLon = { lat: fix.lat, lon: fix.lon };
    this.fetchRoutes(from, routeTarget(this.destination), { heading: fix.heading, reason: 'alternatives' }).then(
      (routes) => {
        if (this.disposed) return;
        this.altPending = false;
        if (version === this.routeVersion && !this.rerouting) {
          // AW18: a jelenlegi útvonal friss (forgalmas) ideje – ha nincs a válaszban, köztes ponttal kérjük le
          const same = routes.find((r) => routeOverlap(this.route, r) >= 0.9);
          if (same) this.setFresh(same, fromAlongM);
          else this.trafficViaDue = true;
          if (this.offer === null && (this.held === null || this.measuring)) this.evaluateAlternatives(routes);
        }
        this.changed();
      },
      () => {
        this.altPending = false;
      },
    );
  }

  /** AW18: forgalom-lekérés a jelenlegi útvonalon: köztes pont a következő manőveren (a célnál nincs köztes pont). */
  private startTrafficCheck(fix: GpsFix, t0: number): void {
    this.trafficViaDue = false;
    this.trafficPending = true;
    this.lastCallAt = t0;
    const version = this.routeVersion;
    const fromAlongM = this.along;
    const step = this.route.steps[this.stepIndex()];
    const via = step && step.endManeuver.type !== 'arrive' ? step.endManeuver.location : null;
    const from: LatLon = { lat: fix.lat, lon: fix.lon };
    this.fetchRoutes(from, routeTarget(this.destination), { heading: fix.heading, reason: 'traffic', via }).then(
      (routes) => {
        if (this.disposed) return;
        this.trafficPending = false;
        const r = routes[0];
        if (r && version === this.routeVersion && !this.rerouting) this.setFresh(r, fromAlongM);
        this.changed();
      },
      () => {
        this.trafficPending = false;
      },
    );
  }

  private setFresh(route: NavRoute, fromAlongM: number): void {
    this.fresh = { route, cum: this.cumOf(route), fromAlongM, version: this.routeVersion };
    this.hasFresh = true;
  }

  /** Egy útvonal kumulált ideje: a szakaszokon a határral, a közösségi dugó-adattal. */
  private cumOf(route: NavRoute): number[] {
    const items = routeEnforcement(route, this.data, this.clock(), this.cfg.enforcementBandM);
    return cumulative(applyCommunityJams(route, adjustedDurations(route, items), this.communityJams, this.clock()));
  }

  /** ETA-jellegű idő (s) egy útvonalra: a szakaszokon a határral (AW18: és a közösségi dugó-adattal). */
  private durationOf(route: NavRoute): number {
    return this.cumOf(route).at(-1)!;
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

  /**
   * A leágazás a mérés alatt álló szakasz végkapuja előtt vagy utána legfeljebb `exitAfterGateM`-rel van-e (AW13): ilyenkor
   * mérés közben is azonnal ajánlunk. Kézi mérésnél nincs végkapu → nem.
   */
  private exitNearSectionEnd(exitAlongM: number | null): boolean {
    const sec = this.measuredSection();
    return exitAlongM !== null && sec !== undefined && exitAlongM <= sec.endM + ALT_OFFER.exitAfterGateM;
  }

  /** Az ajánlat megjelenítése (és bemondása); mérés közben a végkaputól 1 km-nél távolabbi lehajtót visszatartjuk. */
  private present(best: Candidate): void {
    if (this.measuring && !this.exitNearSectionEnd(best.exitAlongM)) {
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
      timeLeft: 1,
      expiresAt: this.clock() + this.cfg.offerTtlMs,
    };
    // a második (500 m-es) bemondás fölösleges, ha az első is 600 m-en belül hangzik el
    this.exit500For = best.exitAlongM !== null && best.exitAlongM - this.along <= 600 ? this.offer.id : null;
    this.say('faster', altOfferVoice(w, best.exitAlongM === null ? null : this.exitKm(best.exitAlongM - this.along)));
  }

  private offerView(o: AlternativeOffer): AlternativeOffer {
    const exitInM = o.exitAlongM === null ? 0 : Math.max(0, o.exitAlongM - this.along);
    const timeLeft = Math.min(1, Math.max(0, (o.expiresAt - this.clock()) / this.cfg.offerTtlMs));
    return { ...o, exitInM, exitKm: this.exitKm(exitInM), compact: this.measuring, timeLeft };
  }

  private exitKm(m: number): string {
    return formatNumber(Math.max(0, m) / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });
  }

  acceptOffer(): void {
    const o = this.offer;
    if (!o) return;
    this.offer = null;
    this.install(o.route);
    this.hasFresh = true;
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
    this.fresh = null;
    this.trafficViaDue = false;
    this.rawCum = cumulative(route.segDurationS);
    this.jamDetector.rebase();
    this.recomputeEnforcement();
    // az új útvonal a jelenlegi pozícióról indul: újra illesztünk
    if (this.lastFix) this.project(this.lastFix, false);
  }

  private recomputeEnforcement(): void {
    this.items = routeEnforcement(this.route, this.data, this.clock(), this.cfg.enforcementBandM);
    this.cum = cumulative(applyCommunityJams(this.route, adjustedDurations(this.route, this.items), this.communityJams, this.clock()));
  }

  /** A hátralévő idő (s) a terv szerint, AW18: a friss forgalmi útvonallal, ha van (a lekérés helyétől mérve). */
  private trafficRemainingS(alongM: number): number {
    const f = this.fresh;
    if (f && f.version === this.routeVersion && alongM >= f.fromAlongM - 50) return remainingSeconds(f.route, f.cum, Math.max(0, alongM - f.fromAlongM));
    return remainingSeconds(this.route, this.cum, alongM);
  }

  /**
   * A hátralévő idő (s). AW18: dugóban a helyi becslés is – a következő manőverig (legfeljebb `jamAheadMaxM`) a 2 perces mért
   * átlaggal, onnan a tervezett idővel; a Mapbox-alapú és a helyi közül a nagyobb.
   */
  private remainingS(): number {
    const base = this.trafficRemainingS(this.along);
    const avg = this.jamDetector.avgMps;
    if (!this.jamDetector.active || avg === null) return base;
    const step = this.route.steps[this.stepIndex()];
    const toManeuver = step ? Math.max(0, step.startM + step.distanceM - this.along) : 0;
    const d = Math.min(toManeuver, TRAFFIC.jamAheadMaxM, this.route.distanceM - this.along);
    const local = d / Math.max(avg, TRAFFIC.jamMinKmh / 3.6) + this.trafficRemainingS(this.along + d);
    return Math.max(base, local);
  }

  /** A várt tempó (m/s) a helyen: a Directions nyers ideje ±250 m-en. */
  private expectedMpsAt(alongM: number): number {
    const a = Math.max(0, alongM - 250);
    const b = Math.min(this.route.distanceM, alongM + 250);
    const dt = remainingSeconds(this.route, this.rawCum, a) - remainingSeconds(this.route, this.rawCum, b);
    return dt > 0 ? (b - a) / dt : 30;
  }

  /** A szakasz kulcsa a „Nem” válaszhoz: a következő manőver helye (újratervezés után is ugyanaz). */
  private stretchKey(): string {
    const m = this.route.steps[this.stepIndex()]?.endManeuver.location;
    return m ? `${m.lat.toFixed(4)},${m.lon.toFixed(4)}` : '';
  }

  // ---------------------------------------------------------------------------
  // AW18: dugó és késés
  // ---------------------------------------------------------------------------

  private watchJam(fix: GpsFix): void {
    const t0 = this.clock();
    const change = this.jamDetector.update(fix.timestamp, this.along, fix.speed, this.expectedMpsAt(this.along));
    const avg = this.jamDetector.avgMps ?? 0;
    if (change === 'enter') {
      this.lastJamUploadAt = t0;
      this.jamUploads.push(jamSample('erzekelt', fix, avg, Math.max(1, (avg * TRAFFIC.jamWindowMs) / 1000)));
      const key = this.stretchKey();
      if (!this.jamDeclined.has(key)) {
        this.jamAskKey = key;
        this.jamAskUntil = t0 + TRAFFIC.jamPromptMs;
        this.say('traffic', t('nav.voice.jamAsk'));
      }
    } else if (change === 'exit') {
      this.jamAskUntil = null;
      this.jamUploads.push(jamSample('oldott', fix, this.jamDetector.clearedAvgMps ?? Math.max(0, fix.speed ?? 0), TRAFFIC.jamClearM));
    } else if (this.jamDetector.active && this.lastJamUploadAt !== null && t0 - this.lastJamUploadAt >= TRAFFIC.jamUploadMs) {
      this.lastJamUploadAt = t0;
      this.jamUploads.push(jamSample('erzekelt', fix, avg, Math.max(1, (avg * TRAFFIC.jamWindowMs) / 1000)));
    }
  }

  /** A késés (s) az indulási tervhez képest – csak friss adattal (forgalmi lekérés / újratervezés) vagy dugóban. */
  private delayS(t0: number): number | null {
    if (!this.hasFresh && !this.jamDetector.active) return null;
    return (t0 + this.remainingS() * 1000 - this.plannedEtaMs) / 1000;
  }

  /** A „+N perc dugó” hangja: csak az első alkalommal (≥ 3 perc); a további növekedésnél a sáv némán frissül. A kérdés lejárata. */
  private updateTraffic(t0: number): void {
    if (this.jamAskUntil !== null && t0 >= this.jamAskUntil) this.jamAskUntil = null;
    const d = this.delayS(t0);
    if (d === null || d < TRAFFIC.delayShowS) return;
    const min = Math.round(d / 60);
    if (!this.delaySaid) {
      this.delaySaid = true;
      this.say('traffic', t('nav.voice.delay', { n: min }));
    }
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
    // AW17: az „Utána” sor csak akkor, ha a következő manőver `thenWithinM`-en (5 km) belül van
    if (following && step.endManeuver.type !== 'arrive' && left <= this.cfg.thenWithinM) {
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
      rerouteRetryInS:
        this.rerouteFailed && !this.rerouting && this.rerouteRetryAt !== null ? Math.max(0, Math.ceil((this.rerouteRetryAt - this.clock()) / 1000)) : null,
      plannedEtaMs: this.plannedEtaMs,
      delayMin: (() => {
        const d = this.arrived ? null : this.delayS(this.clock());
        return d !== null && d >= TRAFFIC.delayShowS ? Math.round(d / 60) : null;
      })(),
      jam: this.jamDetector.active,
      jamAsk: this.jamAskUntil !== null && !this.arrived,
    };
    return this.cached;
  }
}
