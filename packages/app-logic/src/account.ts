import type { TripTrack } from './track';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLanguage, t, type TKey } from './i18n';
import { addRecent, parseRecents, parseSaved, type SavedPlaces } from './navigation/places';
import type { Place } from './navigation/types';
import { normalizeName, parseSettings, type Settings } from './settings';
import { mergeHeatCells, normalizeTrip, type Trip, type TripSample } from './trips';
import { ZONE_RADII, type HeatCell } from './heat';

/**
 * AW22: a valódi, nem kötelező fiók közös logikája (az iOS-pár: `Logic/Account.swift`, a tesztek azonos névvel). A névtelen felhasználó
 * alakul át (identity linking), ha a fiók már létezik, a névtelen sorai beleolvadnak (`account_merge_*`). Szinkron: mezőnként a
 * legutóbb módosított nyer; a napló + saját hőtérkép felhős mentése külön kapcsoló.
 */

export type AccountProvider = 'apple' | 'google' | 'email';

export interface AccountUser {
  id: string;
  email: string | null;
  isAnonymous: boolean;
  provider: AccountProvider | null;
  givenName: string | null;
  fullName: string | null;
  /** AW24: a szolgáltató képe (Google: `picture`, Apple nem ad), a profilkép előtöltése. */
  avatarUrl: string | null;
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'error';

/** A bejelentkezés-ajánlat ennyi időnként jöhet újra (legfeljebb egyszer). */
export const NUDGE_INTERVAL_MS = 30 * 24 * 3600_000;
export const NUDGE_KEY = 'account:nudge:v1';
export const FIELDS_KEY = 'account:fields:v1';
export const CLOUD_STATE_KEY = 'account:cloud:v1';
export const DEVICE_KEY = 'account:device:v1';
export const AUTH_REDIRECT_IOS = 'atlagsebesseg://auth-callback';
/** A felhőbe mentett minták sűrűsége: a színezett útvonalhoz ennyi elég, a tárhely ötödére esik (a készüléken 1 Hz marad). */
export const CLOUD_SAMPLE_STEP_S = 5;
/** Egy feltöltési kör legfeljebb ennyi utat visz: a többi a következő körben (mobilnet, időkorlát). */
export const CLOUD_TRIP_BATCH = 20;

/** Egy befejezett út után, névtelenül, legfeljebb 30 naponta egyszer. */
export const signinNudgeDue = (lastShownMs: number | null, now: number, isAnonymous: boolean): boolean =>
  isAnonymous && (lastShownMs === null || now - lastShownMs >= NUDGE_INTERVAL_MS);

// ---------------------------------------------------------------------------
// felhasználó és név
// ---------------------------------------------------------------------------

type Meta = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** A szolgáltatótól kapott keresztnév: `given_name`, különben a teljes név első szava (átírható lépésben kínáljuk fel). */
export function firstNameFromMeta(meta: Meta | null | undefined): string | null {
  const claims = (meta?.custom_claims ?? null) as Meta | null;
  const given = str(meta?.given_name) ?? str(claims?.given_name);
  if (given) return given;
  const full = str(meta?.full_name) ?? str(meta?.name);
  return full ? (full.split(/\s+/)[0] ?? null) : null;
}

/** A Supabase-felhasználó az app alakjában. A név csak a szolgáltató adatából jön, e-mailes belépésnél nincs. */
export function accountUser(u: { id: string; email?: string | null; is_anonymous?: boolean; app_metadata?: Meta; user_metadata?: Meta; identities?: { provider: string }[] | null } | null | undefined): AccountUser | null {
  if (!u) return null;
  const ids = (u.identities ?? []).map((i) => i.provider);
  const provider = (['apple', 'google', 'email'] as const).find((p) => ids.includes(p)) ?? (str(u.email) ? 'email' : null);
  const social = provider === 'apple' || provider === 'google';
  return {
    id: u.id,
    email: str(u.email),
    isAnonymous: u.is_anonymous === true,
    provider,
    givenName: social ? firstNameFromMeta(u.user_metadata) : null,
    fullName: social ? (str(u.user_metadata?.full_name) ?? str(u.user_metadata?.name)) : null,
    avatarUrl: social ? (str(u.user_metadata?.avatar_url) ?? str(u.user_metadata?.picture)) : null,
  };
}

export interface Profile {
  megszolitas: string;
  megszolitas_ms: number;
  given_name: string | null;
  full_name: string | null;
  name_prompted: boolean;
  /** AW24: a fotótárból választott profilkép (kicsinyített JPEG data URL). */
  avatar?: string | null;
}

/** A profilkép monogramja: a névből két betű, különben az e-mail első betűje; ha egyik sincs, üres. */
export function avatarInitials(name: string | null | undefined, email: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) return words.slice(0, 2).map((w) => [...w][0]!.toLocaleUpperCase()).join('');
  const c = [...(email ?? '').trim()][0];
  return c ? c.toLocaleUpperCase() : '';
}

/** A Megszólítás alatti magyarázat, a megadott névvel élőben: „Így köszönt az app induláskor: »Szia, Kristóf, indulhatunk!«”. */
export function greetingPreview(name: string): string {
  const n = normalizeName(name);
  return t('settings.nameHintLive', { greeting: n ? t('settings.greetPreview', { name: n }) : t('nav.voice.greet') });
}

/** Az „Így szólítsunk?” lépés: csak ha még nincs Megszólítás (se helyben, se a profilban), és nem hagyták ki korábban. */
export const nameStepNeeded = (localName: string, profile: Profile | null): boolean =>
  normalizeName(localName) === '' && normalizeName(profile?.megszolitas ?? '') === '' && profile?.name_prompted !== true;

/** A lépés kitöltött értéke: az Apple/Google keresztneve; e-mailnél üres. */
export const nameStepPrefill = (user: AccountUser | null, profile: Profile | null): string => normalizeName(profile?.given_name ?? user?.givenName ?? '');

/** A kártya első sora: név, különben e-mail. */
export const accountTitle = (user: AccountUser, name: string): string => normalizeName(name) || user.fullName || user.email || t('account.title');

/** A szinkron állapotsora. */
export function syncStatusText(status: SyncStatus, lastSyncMs: number | null, formatTime: (ms: number) => string): string {
  if (status === 'syncing') return t('account.sync.syncing');
  if (status === 'error') return t('account.sync.error');
  return lastSyncMs === null ? t('account.sync.waiting') : t('account.sync.at', { time: formatTime(lastSyncMs) });
}

/** A bejelentkezési hiba felirata: a beépített levelező korlátja és a hibás cím külön üzenet, más hiba általános. */
export function accountErrorKey(e: unknown): TKey {
  const err = e as { code?: string; message?: string; status?: number } | null;
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err?.status === 429) return 'account.err.rate';
  if (code === 'email_address_not_authorized' || msg.includes('not authorized')) return 'account.err.notAllowed';
  if (code === 'email_address_invalid' || code === 'validation_failed' || msg.includes('invalid')) return 'account.err.email';
  return 'account.err.generic';
}

/** Elfogadható e-mail-cím (a részletes ellenőrzés a szerveré). */
export const validEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// ---------------------------------------------------------------------------
// mezőnkénti szinkron: minden mezőnek érték + módosítási idő; a legutóbb módosított nyer
// ---------------------------------------------------------------------------

export type FieldValue = null | boolean | number | string | FieldValue[] | { [k: string]: FieldValue };
export type FieldValues = Record<string, FieldValue>;
export type FieldTimes = Record<string, number>;
export interface FieldRow {
  key: string;
  value: FieldValue;
  updated_ms: number;
}
export interface FieldState {
  values: FieldValues;
  times: FieldTimes;
}

export const NO_FIELDS: FieldState = { values: {}, times: {} };

const canonical = (v: FieldValue | undefined): string => {
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};
export const sameField = (a: FieldValue | undefined, b: FieldValue | undefined): boolean => canonical(a) === canonical(b);

/** A mentett hely / zóna törölhető mező: eltűnéskor törlési jelölő (`null`) megy tovább, különben a másik készülék visszahozná. */
const isDynamicKey = (k: string) => k.startsWith('place.other.') || k.startsWith('zone.');
const PLATFORM_SETTINGS = ['hatosagi_tures_megjelenitese', 'egyseg', 'terkep', 'tervezett_meresek', 'hangos_utasitasok', 'hoterkep', 'hoterkep_nezet', 'adatmegosztas', 'felho_mentes'] as const;

export interface AccountData {
  settings: Settings;
  /** `auto` vagy a választott nyelv kódja. */
  lang: string;
  saved: SavedPlaces;
  recents: readonly Place[];
}

/** Az app adata mezőkre bontva. A Megszólítás külön mező (a szerveren a `profiles` sorban él). */
export function accountFieldsOf(d: AccountData): FieldValues {
  const out: FieldValues = { lang: d.lang, megszolitas: normalizeName(d.settings.megszolitas), recents: d.recents as unknown as FieldValue, 'place.home': d.saved.home as unknown as FieldValue, 'place.work': d.saved.work as unknown as FieldValue };
  for (const k of PLATFORM_SETTINGS) out[`settings.${k}`] = d.settings[k];
  for (const p of d.saved.others) out[`place.other.${p.id}`] = p as unknown as FieldValue;
  for (const [id, m] of Object.entries(d.settings.zona_m)) out[`zone.${id}`] = m;
  return out;
}

/**
 * Helyi változás: ami eltér a legutóbb ismert értéktől, `now` időt kap. Más platform mezőit (pl. az iOS jelzés-módja a weben) nem
 * bántja; a törölt helyből / zónából törlési jelölő lesz. A további helyek sorrendje az időből jön, ezért az első felvételkor sorban kapnak időt.
 */
export function noteLocalFields(prev: FieldState, current: FieldValues, now: number): FieldState {
  const values: FieldValues = { ...prev.values };
  const times: FieldTimes = { ...prev.times };
  let order = 0;
  for (const [k, v] of Object.entries(current)) {
    const known = k in prev.values;
    if (!known) times[k] = k.startsWith('place.other.') && Object.keys(prev.values).length === 0 ? ++order : Object.keys(prev.values).length === 0 ? 0 : now;
    else if (!sameField(prev.values[k], v)) times[k] = now;
    values[k] = v;
  }
  for (const k of Object.keys(prev.values)) {
    if (!(k in current) && isDynamicKey(k) && prev.values[k] !== null) {
      values[k] = null;
      times[k] = now;
    }
  }
  return { values, times };
}

/** Két úti cél-lista egyesítése (az újabb lista elöl, duplikátum és a 10 fölötti rész nélkül): a legutóbbi célokból semmi nem vész el összefésüléskor. */
export function mergeRecents(newer: readonly Place[], older: readonly Place[]): Place[] {
  let out: Place[] = [];
  for (const p of [...older].reverse()) out = addRecent(out, p);
  for (const p of [...newer].reverse()) out = addRecent(out, p);
  return out;
}

/**
 * Összefésülés a szerver soraival: mezőnként a nagyobb idő nyer, azonos időnél a szerveré (így minden készülék ugyanarra jut). A
 * `recents` lista egyesül. Az `upload` azok a mezők, amikben a szerver lemaradt.
 */
export function mergeFields(local: FieldState, remote: readonly FieldRow[]): { state: FieldState; upload: FieldRow[]; changed: string[] } {
  const values: FieldValues = { ...local.values };
  const times: FieldTimes = { ...local.times };
  const changed: string[] = [];
  const upload: FieldRow[] = [];
  const seen = new Set<string>();
  for (const r of remote) {
    seen.add(r.key);
    const lt = local.times[r.key] ?? -1;
    if (r.key === 'recents' && r.key in local.values) {
      const remoteNewer = r.updated_ms >= lt;
      const a = parseRecents(JSON.stringify(remoteNewer ? r.value : local.values[r.key]));
      const b = parseRecents(JSON.stringify(remoteNewer ? local.values[r.key] : r.value));
      const merged = mergeRecents(a, b) as unknown as FieldValue;
      times[r.key] = Math.max(lt, r.updated_ms);
      if (!sameField(merged, local.values[r.key])) changed.push(r.key);
      values[r.key] = merged;
      if (!sameField(merged, r.value)) {
        times[r.key] = times[r.key]! + 1;
        upload.push({ key: r.key, value: merged, updated_ms: times[r.key]! });
      }
      continue;
    }
    if (r.updated_ms >= lt) {
      if (!sameField(values[r.key], r.value)) changed.push(r.key);
      values[r.key] = r.value;
      times[r.key] = r.updated_ms;
    } else {
      upload.push({ key: r.key, value: values[r.key] ?? null, updated_ms: lt });
    }
  }
  for (const k of Object.keys(values)) if (!seen.has(k)) upload.push({ key: k, value: values[k]!, updated_ms: times[k] ?? 0 });
  return { state: { values, times }, upload, changed };
}

/** A mezőkből vissza az app adata; az ismeretlen vagy hibás érték az eddigit hagyja. A további helyek a felvétel sorrendjében. */
export function applyFields(state: FieldState, base: AccountData): AccountData {
  const v = state.values;
  const merged = { ...base.settings } as unknown as Record<string, unknown>;
  for (const k of PLATFORM_SETTINGS) if (`settings.${k}` in v) merged[k] = v[`settings.${k}`];
  if (typeof v.megszolitas === 'string') merged.megszolitas = v.megszolitas;
  const zones: Record<string, number> = {};
  for (const [k, m] of Object.entries(v)) if (k.startsWith('zone.') && typeof m === 'number' && (ZONE_RADII as readonly number[]).includes(m)) zones[k.slice(5)] = m;
  merged.zona_m = zones;
  merged.adatmegosztas_v2 = true;
  merged.felho_mentes_v2 = true;
  const settings = parseSettings(JSON.stringify(merged));
  const others = Object.keys(v)
    .filter((k) => k.startsWith('place.other.') && v[k] !== null)
    .sort((a, b) => (state.times[a] ?? 0) - (state.times[b] ?? 0) || a.localeCompare(b))
    .map((k) => v[k]);
  const saved = parseSaved(JSON.stringify({ home: 'place.home' in v ? v['place.home'] : base.saved.home, work: 'place.work' in v ? v['place.work'] : base.saved.work, others }));
  const recents = 'recents' in v ? parseRecents(JSON.stringify(v.recents)) : [...base.recents];
  return { settings, lang: typeof v.lang === 'string' ? v.lang : base.lang, saved, recents };
}

export const parseFieldState = (raw: string | null | undefined): FieldState => {
  try {
    const p = JSON.parse(raw ?? 'null') as FieldState | null;
    return p && typeof p.values === 'object' && typeof p.times === 'object' ? { values: p.values, times: p.times } : NO_FIELDS;
  } catch {
    return NO_FIELDS;
  }
};

// ---------------------------------------------------------------------------
// napló + saját hőtérkép felhős mentése
// ---------------------------------------------------------------------------

export interface CloudTripListRow {
  id: string;
  deleted: boolean;
  updated_ms: number;
}

export interface CloudState {
  /** Törölt utak, amik még nem jutottak el a szerverre (hálózat nélkül is megmarad). */
  pendingDeletes: string[];
  /** Visszaállított utak: a szerver törlési jelölőjét felülírják. */
  pendingRestores: string[];
  /** A hőtérkép törlése a többi készülék cellájára is vonatkozik. */
  pendingHeatClear: boolean;
  /** A legutóbb feltöltött saját hőtérkép ujjlenyomata (csak változáskor megy újra). */
  heatHash: string;
}

export const NO_CLOUD_STATE: CloudState = { pendingDeletes: [], pendingRestores: [], pendingHeatClear: false, heatHash: '' };

export const parseCloudState = (raw: string | null | undefined): CloudState => {
  try {
    return { ...NO_CLOUD_STATE, ...(JSON.parse(raw ?? 'null') as Partial<CloudState> | null) };
  } catch {
    return NO_CLOUD_STATE;
  }
};

/** Mit kell tenni az utakkal. Lezárt út csak egyszer megy fel; a futó (`openId`) még nem. A helyi törlés megelőzi a szerver példányát. */
export function planTripSync(localIds: readonly string[], remote: readonly CloudTripListRow[], state: CloudState, openId: string | null): { upload: string[]; download: string[]; deleteLocal: string[]; pushDeletes: string[] } {
  const local = new Set(localIds);
  const byId = new Map(remote.map((r) => [r.id, r]));
  const restores = new Set(state.pendingRestores);
  const pending = new Set(state.pendingDeletes);
  const upload = localIds.filter((id) => id !== openId && !pending.has(id) && (!byId.has(id) || (byId.get(id)!.deleted && restores.has(id))));
  const download = remote.filter((r) => !r.deleted && !local.has(r.id) && !pending.has(r.id)).map((r) => r.id);
  const deleteLocal = remote.filter((r) => r.deleted && local.has(r.id) && !restores.has(r.id) && !pending.has(r.id)).map((r) => r.id);
  return { upload, download, deleteLocal, pushDeletes: [...pending] };
}

/** Cloud-minta: `[t, lat, lon, km/h, irány, pontosság, limit]`, `CLOUD_SAMPLE_STEP_S` másodpercenként. */
export type CloudSample = [number, number, number, number | null, number | null, number | null, number | null];

export function compactSamples(samples: readonly TripSample[], stepS = CLOUD_SAMPLE_STEP_S): CloudSample[] {
  const out: CloudSample[] = [];
  let last = -Infinity;
  samples.forEach((s, i) => {
    if (s.t - last < stepS * 1000 && i !== samples.length - 1) return;
    last = s.t;
    out.push([s.t, s.lat, s.lon, s.speedKmh, s.heading, s.accuracy, s.limitKmh ?? null]);
  });
  return out;
}

/** Vissza a napló alakjára. A letöltött út a hőtérképbe nem olvad be újra (a cellái a másik készülék sorában jönnek), a H3 ezért üres. */
export const expandSamples = (tripId: string, rows: readonly CloudSample[]): TripSample[] =>
  rows.map(([t, lat, lon, speedKmh, heading, accuracy, limitKmh]) => ({ tripId, t, lat, lon, speedKmh, heading, accuracy, h3: null, limitKmh }));

/** Cloud-cella: `[h3, darab, átlag, utolsó idő]`. */
export type CloudCell = [string, number, number, number];
export const heatBlob = (cells: readonly HeatCell[]): CloudCell[] => cells.map((c) => [c.h3, c.count, c.avgKmh, c.lastT]);
export const parseHeatBlob = (rows: readonly CloudCell[]): HeatCell[] => rows.map(([h3, count, avgKmh, lastT]) => ({ h3, count, avgKmh, lastT }));

/** A saját hőtérkép ujjlenyomata: új áthaladás mindig változtat rajta. */
export const heatHash = (cells: readonly HeatCell[]): string => {
  let sum = 0;
  let last = 0;
  for (const c of cells) {
    sum += c.count;
    last = Math.max(last, c.lastT);
  }
  return `${cells.length}:${sum}:${last}`;
};

/** A saját és a többi készülék cellái együtt: minden készülék a saját számlálóját írja, ezért az összeg nem duplázódik. */
export function mergeRemoteHeat(own: readonly HeatCell[], remote: readonly (readonly HeatCell[])[]): HeatCell[] {
  const map = new Map(own.map((c) => [c.h3, c]));
  for (const list of remote) for (const c of list) map.set(c.h3, mergeHeatCells(c, map.get(c.h3)));
  return [...map.values()];
}

export interface CloudHeatRow {
  device_id: string;
  cells: CloudCell[];
  updated_ms: number;
}

/** A felhő-szinkron távoli oldala (a Supabase vagy a teszt hamis szervere). */
export interface AccountRemote {
  pullFields(): Promise<FieldRow[]>;
  pushFields(rows: readonly FieldRow[]): Promise<void>;
  pullProfile(): Promise<Profile | null>;
  pushProfile(p: Partial<Profile>): Promise<void>;
  listTrips(): Promise<CloudTripListRow[]>;
  getTrip(id: string): Promise<{ record: unknown; samples: CloudSample[] | null } | null>;
  putTrip(id: string, record: unknown, samples: CloudSample[], updatedMs: number): Promise<void>;
  markTripsDeleted(ids: readonly string[], updatedMs: number): Promise<void>;
  listHeat(): Promise<CloudHeatRow[]>;
  putHeat(deviceId: string, cells: CloudCell[], updatedMs: number): Promise<void>;
  clearHeat(): Promise<void>;
  /** AW24: a saját utak vonalai (`cloud_tracks`). */
  listTrackIds(): Promise<string[]>;
  getTrack(tripId: string): Promise<TripTrack | null>;
  putTrack(track: TripTrack, updatedMs: number): Promise<void>;
  clearTracks(): Promise<void>;
}

/** A felhő-szinkron helyi oldala (web: IndexedDB, iOS: SQLite). */
export interface BackupStore {
  listTrips(): Promise<Trip[]>;
  samples(tripId: string): Promise<TripSample[]>;
  /** A letöltött út a naplóba, a hőtérkép beolvasztása nélkül. */
  saveDownloaded(trip: Trip, samples: readonly TripSample[]): Promise<void>;
  deleteTrip(id: string): Promise<void>;
  heatCells(): Promise<HeatCell[]>;
  setRemoteHeat(lists: readonly (readonly HeatCell[])[]): Promise<void>;
  /** AW24: az utak vonalai; a letöltött vonal nem illesztődik és nem megy közösségbe újra. */
  listTracks(): Promise<TripTrack[]>;
  saveTrack(track: TripTrack): Promise<void>;
}

/** Egy mező-szinkron kör: letöltés, összefésülés, feltöltés. Az új állapotot adja, és mely mezők változtak a másik készülék miatt. */
export async function syncFieldsOnce(remote: AccountRemote, local: FieldState): Promise<{ state: FieldState; changed: string[]; profile: Profile | null }> {
  const profile = await remote.pullProfile();
  const rows = await remote.pullFields();
  // a Megszólítás a profilban él: mezőként fésüljük, de oda írjuk vissza; soha be nem állított profil-név nem számít
  const all = profile && (profile.megszolitas !== '' || profile.megszolitas_ms > 0) ? [...rows, { key: 'megszolitas', value: profile.megszolitas, updated_ms: profile.megszolitas_ms }] : rows;
  const { state, upload, changed } = mergeFields(local, all);
  const name = upload.find((r) => r.key === 'megszolitas');
  if (name) await remote.pushProfile({ megszolitas: String(name.value ?? ''), megszolitas_ms: name.updated_ms });
  const rest = upload.filter((r) => r.key !== 'megszolitas');
  if (rest.length) await remote.pushFields(rest);
  return { state, changed, profile };
}

/**
 * Egy felhős mentési kör (a kapcsoló bekapcsolva): a függő törlések, a hiányzó utak fel, a másik készülék útjai le, a szerveren töröltek
 * helyben is. A saját hőtérkép készülékenként külön sor: csak változáskor megy fel, a többi készüléké a helyi tárba kerül.
 */
export async function syncBackupOnce(remote: AccountRemote, store: BackupStore, cloud: CloudState, deviceId: string, openTripId: string | null, now: number): Promise<{ state: CloudState; trips: { up: number; down: number; deleted: number }; heatChanged: boolean }> {
  let state: CloudState = { ...cloud };
  const trips = await store.listTrips();
  const plan = planTripSync(trips.map((x) => x.id), await remote.listTrips(), state, openTripId);
  if (plan.pushDeletes.length) {
    await remote.markTripsDeleted(plan.pushDeletes, now);
    state = { ...state, pendingDeletes: [] };
  }
  const upload = plan.upload.slice(0, CLOUD_TRIP_BATCH);
  for (const id of upload) {
    const trip = trips.find((x) => x.id === id)!;
    await remote.putTrip(id, trip, compactSamples(await store.samples(id)), now);
  }
  state = { ...state, pendingRestores: state.pendingRestores.filter((id) => !upload.includes(id)) };
  const download = plan.download.slice(0, CLOUD_TRIP_BATCH);
  for (const id of download) {
    const row = await remote.getTrip(id);
    if (row?.record) await store.saveDownloaded(normalizeTrip(row.record as Trip), expandSamples(id, row.samples ?? []));
  }
  for (const id of plan.deleteLocal) await store.deleteTrip(id);

  let heatChanged = false;
  if (state.pendingHeatClear) {
    await remote.clearHeat();
    await store.setRemoteHeat([]);
    await remote.clearTracks();
    state = { ...state, pendingHeatClear: false, heatHash: '' };
    heatChanged = true;
  }
  const cells = await store.heatCells();
  const hash = heatHash(cells);
  if (hash !== state.heatHash) {
    await remote.putHeat(deviceId, heatBlob(cells), now);
    state = { ...state, heatHash: hash };
  }
  const others = (await remote.listHeat()).filter((r) => r.device_id !== deviceId);
  await store.setRemoteHeat(others.map((r) => parseHeatBlob(r.cells)));
  if (others.length) heatChanged = true;

  // AW24: a kész vonalak egyszer mennek fel; a másik készülék vonala letöltődik, a hőtérképhez hozzáadódik
  const local = await store.listTracks();
  const remoteIds = new Set(await remote.listTrackIds());
  const localIds = new Set(local.map((t) => t.tripId));
  for (const t of local.filter((x) => x.status === 'done' && !remoteIds.has(x.tripId)).slice(0, CLOUD_TRIP_BATCH)) await remote.putTrack(t, now);
  for (const id of [...remoteIds].filter((x) => !localIds.has(x)).slice(0, CLOUD_TRIP_BATCH)) {
    const t = await remote.getTrack(id);
    if (t) {
      await store.saveTrack({ ...t, share: false });
      heatChanged = true;
    }
  }
  return { state, trips: { up: upload.length, down: download.length, deleted: plan.deleteLocal.length }, heatChanged };
}

// ---------------------------------------------------------------------------
// Supabase-oldal
// ---------------------------------------------------------------------------

/** Az auth-szolgáltatók (nyilvános végpont): a be nem állított gomb tisztán jelzi, nem hibázik. Hálózat nélkül `null`. */
export async function fetchAuthProviders(url: string, anonKey: string, fetchFn: typeof fetch = fetch): Promise<{ apple: boolean; google: boolean; email: boolean } | null> {
  try {
    const r = await fetchFn(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
    if (!r.ok) return null;
    const j = (await r.json()) as { external?: Record<string, boolean> };
    return { apple: j.external?.apple === true, google: j.external?.google === true, email: j.external?.email === true };
  } catch {
    return null;
  }
}

/** A `AccountRemote` a Supabase-en: minden hívás RLS-sel, a bejelentkezett fiók saját soraira. */
export function supabaseRemote(client: SupabaseClient): AccountRemote {
  const must = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  const uid = async () => {
    const { data } = await client.auth.getSession();
    return data.session?.user.id ?? null;
  };
  return {
    pullFields: async () => must(await client.from('account_fields').select('key,value,updated_ms')) as FieldRow[],
    pushFields: async (rows) => {
      must(await client.from('account_fields').upsert([...rows], { onConflict: 'user_id,key' }));
    },
    pullProfile: async () => must(await client.from('profiles').select('megszolitas,megszolitas_ms,given_name,full_name,name_prompted,avatar').maybeSingle()) as Profile | null,
    pushProfile: async (p) => {
      must(await client.from('profiles').upsert({ user_id: await uid(), ...p }, { onConflict: 'user_id' }));
    },
    listTrips: async () => must(await client.from('cloud_trips').select('id,deleted,updated_ms')) as CloudTripListRow[],
    getTrip: async (id) => must(await client.from('cloud_trips').select('record,samples').eq('id', id).maybeSingle()) as { record: unknown; samples: CloudSample[] | null } | null,
    putTrip: async (id, record, samples, updated_ms) => {
      must(await client.from('cloud_trips').upsert({ id, record, samples, deleted: false, updated_ms }, { onConflict: 'user_id,id' }));
    },
    markTripsDeleted: async (ids, updated_ms) => {
      must(await client.from('cloud_trips').upsert(ids.map((id) => ({ id, record: null, samples: null, deleted: true, updated_ms })), { onConflict: 'user_id,id' }));
    },
    listHeat: async () => must(await client.from('cloud_heat').select('device_id,cells,updated_ms')) as CloudHeatRow[],
    putHeat: async (device_id, cells, updated_ms) => {
      must(await client.from('cloud_heat').upsert({ device_id, cells, updated_ms }, { onConflict: 'user_id,device_id' }));
    },
    clearHeat: async () => {
      must(await client.from('cloud_heat').delete().not('device_id', 'is', null));
    },
    listTrackIds: async () => (must(await client.from('cloud_tracks').select('trip_id')) as { trip_id: string }[]).map((r) => r.trip_id),
    getTrack: async (tripId) => (must(await client.from('cloud_tracks').select('track').eq('trip_id', tripId).maybeSingle()) as { track: TripTrack } | null)?.track ?? null,
    putTrack: async (track, updated_ms) => {
      must(await client.from('cloud_tracks').upsert({ trip_id: track.tripId, track, matcher: track.matcher, updated_ms }, { onConflict: 'user_id,trip_id' }));
    },
    clearTracks: async () => {
      must(await client.from('cloud_tracks').delete().not('trip_id', 'is', null));
    },
  };
}

/** Az összefésülési igazolás a névtelen munkamenetből; bejelentkezés után ezzel olvad be a névtelen felhasználó. */
export async function prepareMerge(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.rpc('account_merge_prepare');
  if (error) throw error;
  return data as string;
}

export async function claimMerge(client: SupabaseClient, token: string): Promise<{ merged: boolean }> {
  const { data, error } = await client.rpc('account_merge_claim', { p_token: token });
  if (error) throw error;
  return data as { merged: boolean };
}

/** Már létező fiók jele linkeléskor. */
export const isIdentityTaken = (e: unknown): boolean => {
  const err = e as { code?: string; error_code?: string; message?: string } | null;
  return err?.code === 'identity_already_exists' || err?.code === 'email_exists' || err?.error_code === 'identity_already_exists' || /already (been )?(linked|registered)/i.test(err?.message ?? '');
};

export interface PendingMergeStore {
  setPendingMerge(token: string | null): void;
}

/**
 * E-mailes belépés (bejelentkező link, jelszó nélkül). Névtelen munkamenetnél a meglévő felhasználó kapja meg a címet, így minden adata marad;
 * ha a címhez már tartozik fiók, előbb igazolás készül, és a linkkel az a fiók lép be, amelybe a névtelen beleolvad.
 */
export async function startEmailSignIn(client: SupabaseClient, email: string, redirectTo: string, store: PendingMergeStore): Promise<void> {
  const addr = email.trim();
  const { data } = await client.auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { error } = await client.auth.updateUser({ email: addr, data: { lang: getLanguage() } }, { emailRedirectTo: redirectTo });
    if (!error) return;
    if (!isIdentityTaken(error)) throw error;
    store.setPendingMerge(await prepareMerge(client));
  }
  // AW23: a levél nyelve az app nyelve (a sablon a `lang` metaadatból választ)
  const { error } = await client.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: redirectTo, data: { lang: getLanguage() } } });
  if (error) throw error;
}

/** Fiók törlése az edge function-nel: az auth-felhasználó és minden hozzá tartozó sor eltűnik. */
export async function deleteAccount(client: SupabaseClient): Promise<void> {
  const { error } = await client.functions.invoke('account-delete', { method: 'POST' });
  if (error) throw error;
}

/** Kijelentkezés / fiók törlése után: a készülék új névtelen felhasználóval folytat, a helyi adatok maradnak. */
export async function continueAnonymously(client: SupabaseClient): Promise<void> {
  await client.auth.signOut({ scope: 'local' });
  const { error } = await client.auth.signInAnonymously();
  if (error) throw error;
}
