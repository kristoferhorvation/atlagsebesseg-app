import { noteDeleted, noteRestored } from '../account/cloudState';
import type { TripTrack } from '@atlagsebesseg/app-logic';
import { mergeHeatCells, mergePasses, mergeRemoteHeat, normalizeTrip, trashExpired, trashExpiresAt, tripPasses, TRIP, type HeatCell, type HeatPass, type Trip, type TripSample } from '@atlagsebesseg/app-logic';

/**
 * AW19: az utak naplójának helyi tárolója – IndexedDB (`atlagsebesseg-trips`, 1. verzió; az iOS-pár a SQLite-os
 * `TripStore.swift`). Tárak: `trips` (kulcs: `id`, index: `startedAt`; a rekord a közös `Trip` alakja) és `samples`
 * (automatikus kulcs, index: `tripId`; 1 Hz GPS-minták a H3-cellával – h3-js, lustán töltve). AW20 (2. verzió): `heat`
 * (kulcs: `h3`; a személyes hőtérkép cellánkénti összesítése: darabszám, átlagsebesség, utolsó idő) és `heatTrips` (kulcs: `id`;
 * melyik út van már beolvasztva – idempotencia). Szerverre innen semmi nem megy (a közösségi feltöltés külön, opt-in).
 * AOS17 (3. verzió): `trashTrips`, `trashHeat`, `trashHeatTrips` – az „Összes törlése” 30 napig visszaállítható sorai `deletedAt`-tal
 * (a minták a helyükön maradnak: a `samples` csak út-azonosítóval érhető el, a lejáratkor törlődnek).
 * AW24 (5. verzió): `tracks` (kulcs: `tripId`; az út pontsora és illesztett vonalai, a hőtérkép csíkjai ebből) és `trashTracks`.
 * AW22 (4. verzió): `remoteHeat` – a fiók többi készülékének hőtérképe (a felhős mentésből, a kijelzéshez hozzáadva, soha nem töltődik fel újra).
 */
const DB_NAME = 'atlagsebesseg-trips';
const DB_VERSION = 5;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples', { autoIncrement: true }).createIndex('tripId', 'tripId');
      if (!db.objectStoreNames.contains('heat')) db.createObjectStore('heat', { keyPath: 'h3' });
      if (!db.objectStoreNames.contains('heatTrips')) db.createObjectStore('heatTrips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('trashTrips')) db.createObjectStore('trashTrips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('trashHeat')) db.createObjectStore('trashHeat', { keyPath: 'h3' });
      if (!db.objectStoreNames.contains('trashHeatTrips')) db.createObjectStore('trashHeatTrips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('remoteHeat')) db.createObjectStore('remoteHeat', { autoIncrement: true });
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'tripId' });
      if (!db.objectStoreNames.contains('trashTracks')) db.createObjectStore('trashTracks', { keyPath: 'tripId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** A minta H3-cellája (`TRIP.h3Res`; a SwiftyH3 párja) – a h3-js első használatkor töltődik be; hibánál `null`. */
let cellOf: Promise<((lat: number, lon: number) => string | null) | null> | null = null;
export function tripCellFn() {
  cellOf ??= import('h3-js')
    .then((h3) => (lat: number, lon: number) => {
      try {
        return h3.latLngToCell(lat, lon, TRIP.h3Res);
      } catch {
        return null;
      }
    })
    .catch(() => null);
  return cellOf;
}

export async function addSamples(samples: readonly TripSample[]): Promise<void> {
  if (samples.length === 0) return;
  const cell = await tripCellFn();
  const db = await open();
  const tx = db.transaction('samples', 'readwrite');
  const store = tx.objectStore('samples');
  for (const s of samples) store.add({ ...s, h3: s.h3 ?? cell?.(s.lat, s.lon) ?? null });
  await done(tx);
}

export async function saveTrip(trip: Trip): Promise<void> {
  const db = await open();
  const tx = db.transaction('trips', 'readwrite');
  tx.objectStore('trips').put(trip);
  await done(tx);
}

/** A napló (legújabb elöl). */
export async function listTrips(): Promise<Trip[]> {
  const db = await open();
  const all = await result(db.transaction('trips').objectStore('trips').getAll() as IDBRequest<Trip[]>);
  return all.map(normalizeTrip).sort((a, b) => b.startedAt - a.startedAt);
}

/** Egy út mintái (időrendben) – a böngészős ellenőrzéshez és a következő kör hőtérképéhez. */
export async function tripSamples(tripId: string): Promise<TripSample[]> {
  const db = await open();
  const rows = await result(db.transaction('samples').objectStore('samples').index('tripId').getAll(tripId) as IDBRequest<TripSample[]>);
  return rows.sort((a, b) => a.t - b.t);
}

async function deleteSamplesOf(db: IDBDatabase, tripId: string): Promise<void> {
  const tx = db.transaction('samples', 'readwrite');
  const keys = await result(tx.objectStore('samples').index('tripId').getAllKeys(tripId));
  for (const k of keys) tx.objectStore('samples').delete(k);
  await done(tx);
}

/** Csak a minták (az eldobott, túl rövid út). */
export async function deleteSamples(tripId: string): Promise<void> {
  await deleteSamplesOf(await open(), tripId);
}

/** Egy út a mintáival. */
export async function deleteTrip(id: string): Promise<void> {
  noteDeleted([id]);
  await deleteDownloadedTrip(id);
}

/** Az út törlése a szerver felé jelzés nélkül (a másik készüléken törölt út). */
export async function deleteDownloadedTrip(id: string): Promise<void> {
  const db = await open();
  await deleteSamplesOf(db, id);
  const tx = db.transaction('trips', 'readwrite');
  tx.objectStore('trips').delete(id);
  await done(tx);
}

const TRASH_STORES = ['trashTrips', 'trashHeat', 'trashHeatTrips', 'trashTracks'] as const;
type Trashed<T> = T & { deletedAt: number };

/**
 * AOS17: „Összes törlése”. `heat`: a saját hőtérkép is törlődik (külön kérdés). `keep`: 30 napig visszaállítható (a sorok a kukába
 * kerülnek, az eddigi kuka megmarad); különben azonnal és véglegesen – a korábbi kukával együtt.
 */
export async function deleteAllTrips({ heat, keep, now = Date.now() }: { heat: boolean; keep: boolean; now?: number }): Promise<void> {
  const db = await open();
  noteDeleted((await listTrips()).map((x) => x.id), heat);
  const tx = db.transaction(['trips', 'samples', 'heat', 'heatTrips', 'remoteHeat', 'tracks', ...TRASH_STORES], 'readwrite');
  if (keep) {
    const [trips, cells, heatTrips, oldCells] = await Promise.all([
      result(tx.objectStore('trips').getAll() as IDBRequest<Trip[]>),
      heat ? result(tx.objectStore('heat').getAll() as IDBRequest<HeatCell[]>) : Promise.resolve([] as HeatCell[]),
      heat ? result(tx.objectStore('heatTrips').getAll() as IDBRequest<{ id: string }[]>) : Promise.resolve([] as { id: string }[]),
      result(tx.objectStore('trashHeat').getAll() as IDBRequest<Trashed<HeatCell>[]>),
    ]);
    const old = new Map(oldCells.map((c) => [c.h3, c]));
    for (const trip of trips) tx.objectStore('trashTrips').put({ ...trip, deletedAt: now });
    for (const c of cells) tx.objectStore('trashHeat').put({ ...mergeHeatCells(c, old.get(c.h3)), deletedAt: now });
    for (const x of heatTrips) tx.objectStore('trashHeatTrips').put({ id: x.id, deletedAt: now });
    if (heat) for (const t of await result(tx.objectStore('tracks').getAll() as IDBRequest<TripTrack[]>)) tx.objectStore('trashTracks').put({ ...t, deletedAt: now });
  } else {
    tx.objectStore('samples').clear();
    for (const s of TRASH_STORES) tx.objectStore(s).clear();
  }
  tx.objectStore('trips').clear();
  if (heat) {
    tx.objectStore('heat').clear();
    tx.objectStore('heatTrips').clear();
    tx.objectStore('remoteHeat').clear();
    tx.objectStore('tracks').clear();
  }
  await done(tx);
}

/** A kuka lejárt sorainak törlése (az út mintáival együtt); indításkor és a Beállítások megnyitásakor fut. */
export async function purgeTrash(now = Date.now()): Promise<void> {
  const db = await open();
  const [trips, cells, heatTrips, tracks] = await Promise.all([
    result(db.transaction('trashTrips').objectStore('trashTrips').getAll() as IDBRequest<Trashed<Trip>[]>),
    result(db.transaction('trashHeat').objectStore('trashHeat').getAll() as IDBRequest<Trashed<HeatCell>[]>),
    result(db.transaction('trashHeatTrips').objectStore('trashHeatTrips').getAll() as IDBRequest<Trashed<{ id: string }>[]>),
    result(db.transaction('trashTracks').objectStore('trashTracks').getAll() as IDBRequest<Trashed<TripTrack>[]>),
  ]);
  for (const trip of trips) if (trashExpired(trip.deletedAt, now)) await deleteSamplesOf(db, trip.id);
  const tx = db.transaction([...TRASH_STORES], 'readwrite');
  for (const trip of trips) if (trashExpired(trip.deletedAt, now)) tx.objectStore('trashTrips').delete(trip.id);
  for (const c of cells) if (trashExpired(c.deletedAt, now)) tx.objectStore('trashHeat').delete(c.h3);
  for (const x of heatTrips) if (trashExpired(x.deletedAt, now)) tx.objectStore('trashHeatTrips').delete(x.id);
  for (const t of tracks) if (trashExpired(t.deletedAt, now)) tx.objectStore('trashTracks').delete(t.tripId);
  await done(tx);
}

/** Meddig állítható vissza a kuka (ms); üres kukánál `null` – ilyenkor a Beállítások sora nem látszik. */
export async function trashExpiry(now = Date.now()): Promise<number | null> {
  const db = await open();
  const rows = await Promise.all(TRASH_STORES.map((s) => result(db.transaction(s).objectStore(s).getAll() as IDBRequest<{ deletedAt: number }[]>)));
  return trashExpiresAt(rows.flat().map((r) => r.deletedAt), now);
}

/** A kuka visszaállítása: az utak vissza, a hőtérkép-cellák a törlés óta keletkezettekkel összevonva, a kuka kiürül. */
export async function restoreTrash(now = Date.now()): Promise<void> {
  await purgeTrash(now);
  const db = await open();
  const tx = db.transaction(['trips', 'heat', 'heatTrips', 'tracks', ...TRASH_STORES], 'readwrite');
  const [trips, cells, heatTrips, current, tracks] = await Promise.all([
    result(tx.objectStore('trashTrips').getAll() as IDBRequest<Trashed<Trip>[]>),
    result(tx.objectStore('trashHeat').getAll() as IDBRequest<Trashed<HeatCell>[]>),
    result(tx.objectStore('trashHeatTrips').getAll() as IDBRequest<Trashed<{ id: string }>[]>),
    result(tx.objectStore('heat').getAll() as IDBRequest<HeatCell[]>),
    result(tx.objectStore('trashTracks').getAll() as IDBRequest<Trashed<TripTrack>[]>),
  ]);
  const live = new Map(current.map((c) => [c.h3, c]));
  for (const { deletedAt: _d, ...trip } of trips) tx.objectStore('trips').put(trip);
  for (const { deletedAt: _d, ...c } of cells) tx.objectStore('heat').put(mergeHeatCells(c, live.get(c.h3)));
  for (const x of heatTrips) tx.objectStore('heatTrips').put({ id: x.id });
  for (const { deletedAt: _d, ...t } of tracks) tx.objectStore('tracks').put(t);
  for (const s of TRASH_STORES) tx.objectStore(s).clear();
  await done(tx);
  noteRestored(trips.map((x) => x.id));
}

// ---------------------------------------------------------------------------
// AW24: az utak vonalai (a hőtérkép csíkjai)
// ---------------------------------------------------------------------------

export async function saveTrack(track: TripTrack): Promise<void> {
  const db = await open();
  const tx = db.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').put(track);
  await done(tx);
}

export async function listTracks(): Promise<TripTrack[]> {
  const db = await open();
  return result(db.transaction('tracks').objectStore('tracks').getAll() as IDBRequest<TripTrack[]>);
}

/** A naplóban lévő utak, amelyeknek még nincs vonala (visszamenőleges újraépítés a nyers mintákból). */
export async function tripsWithoutTrack(): Promise<Trip[]> {
  const [trips, tracks] = await Promise.all([listTrips(), listTracks()]);
  const have = new Set(tracks.map((t) => t.tripId));
  return trips.filter((t) => !have.has(t.id));
}

// ---------------------------------------------------------------------------
// AW20: személyes hőtérkép – cellánkénti összesítés, inkrementálisan
// ---------------------------------------------------------------------------

/** A készülék saját hőtérképe (cellánként egy sor): ez töltődik fel, ha be van kapcsolva a felhős mentés. */
export async function listHeatOwn(): Promise<HeatCell[]> {
  const db = await open();
  return result(db.transaction('heat').objectStore('heat').getAll() as IDBRequest<HeatCell[]>);
}

/** A kirajzolandó személyes hőtérkép: a saját + a fiók többi készülékéé (AW22). */
export async function listHeat(): Promise<HeatCell[]> {
  const db = await open();
  const [own, lists] = await Promise.all([listHeatOwn(), result(db.transaction('remoteHeat').objectStore('remoteHeat').getAll() as IDBRequest<HeatCell[][]>)]);
  return lists.length ? mergeRemoteHeat(own, lists) : own;
}

/** A fiók többi készülékének cellái: minden szinkronnál teljes csere. */
export async function setRemoteHeat(lists: readonly (readonly HeatCell[])[]): Promise<void> {
  const db = await open();
  const tx = db.transaction('remoteHeat', 'readwrite');
  const store = tx.objectStore('remoteHeat');
  store.clear();
  for (const l of lists) store.add(l);
  await done(tx);
}

/** A felhőből letöltött út: a naplóba kerül, de a hőtérképbe nem olvad be (a cellái a másik készülék sorában érkeznek). */
export async function saveDownloadedTrip(trip: Trip, samples: readonly TripSample[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(['trips', 'samples', 'heatTrips'], 'readwrite');
  tx.objectStore('trips').put(trip);
  for (const s of samples) tx.objectStore('samples').add(s);
  tx.objectStore('heatTrips').put({ id: trip.id });
  await done(tx);
}

/**
 * Egy út beolvasztása a hőtérképbe: az út mintáiból áthaladások, a cellák frissítése és az út megjelölése egy tranzakcióban.
 * Idempotens (a már beolvasztott utat nem számolja újra). Az út későbbi törlése a hőtérképből NEM von vissza: az összesítés
 * cellánkénti szám, nem út-hivatkozás (az „Összes törlése” viszont a hőtérképet is törli). Visszaadja az áthaladásokat
 * (a közösségi feltöltéshez) és a módosult cellákat, vagy `null`-t, ha az út már beolvadt.
 */
export async function absorbTrip(tripId: string): Promise<{ passes: HeatPass[]; changed: HeatCell[] } | null> {
  const db = await open();
  if (await result(db.transaction('heatTrips').objectStore('heatTrips').get(tripId))) return null;
  const passes = tripPasses(await tripSamples(tripId));
  const tx = db.transaction(['heat', 'heatTrips'], 'readwrite');
  const heat = tx.objectStore('heat');
  const existing = await Promise.all([...new Set(passes.map((p) => p.h3))].map((h3) => result(heat.get(h3) as IDBRequest<HeatCell | undefined>)));
  const cells = new Map<string, HeatCell>(existing.filter((c): c is HeatCell => !!c).map((c) => [c.h3, c]));
  const changed = mergePasses(cells, passes);
  for (const c of changed) heat.put(c);
  tx.objectStore('heatTrips').put({ id: tripId });
  await done(tx);
  return { passes, changed };
}

/** Indításkor: minden még be nem olvasztott út (pl. a háttérben leállt app pillanatképe) beolvasztása; nem tölt fel semmit. */
export async function backfillHeat(): Promise<number> {
  const trips = await listTrips();
  let n = 0;
  for (const t of trips) if (await absorbTrip(t.id)) n++;
  return n;
}
