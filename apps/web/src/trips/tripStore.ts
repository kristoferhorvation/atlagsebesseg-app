import { mergePasses, normalizeTrip, tripPasses, TRIP, type HeatCell, type HeatPass, type Trip, type TripSample } from '@atlagsebesseg/app-logic';

/**
 * AW19: az utak naplójának helyi tárolója – IndexedDB (`atlagsebesseg-trips`, 1. verzió; az iOS-pár a SQLite-os
 * `TripStore.swift`). Tárak: `trips` (kulcs: `id`, index: `startedAt`; a rekord a közös `Trip` alakja) és `samples`
 * (automatikus kulcs, index: `tripId`; 1 Hz GPS-minták a H3-cellával – h3-js, lustán töltve). AW20 (2. verzió): `heat`
 * (kulcs: `h3`; a személyes hőtérkép cellánkénti összesítése: darabszám, átlagsebesség, utolsó idő) és `heatTrips` (kulcs: `id`;
 * melyik út van már beolvasztva – idempotencia). Szerverre innen semmi nem megy (a közösségi feltöltés külön, opt-in).
 */
const DB_NAME = 'atlagsebesseg-trips';
const DB_VERSION = 2;

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
  const db = await open();
  await deleteSamplesOf(db, id);
  const tx = db.transaction('trips', 'readwrite');
  tx.objectStore('trips').delete(id);
  await done(tx);
}

export async function deleteAllTrips(): Promise<void> {
  const db = await open();
  const tx = db.transaction(['trips', 'samples', 'heat', 'heatTrips'], 'readwrite');
  tx.objectStore('trips').clear();
  tx.objectStore('samples').clear();
  tx.objectStore('heat').clear();
  tx.objectStore('heatTrips').clear();
  await done(tx);
}

// ---------------------------------------------------------------------------
// AW20: személyes hőtérkép – cellánkénti összesítés, inkrementálisan
// ---------------------------------------------------------------------------

/** A teljes személyes hőtérkép (cellánként egy sor). */
export async function listHeat(): Promise<HeatCell[]> {
  const db = await open();
  return result(db.transaction('heat').objectStore('heat').getAll() as IDBRequest<HeatCell[]>);
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
