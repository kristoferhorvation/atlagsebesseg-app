import { TRIP, type Trip, type TripSample } from '@atlagsebesseg/app-logic';

/**
 * AW19: az utak naplójának helyi tárolója – IndexedDB (`atlagsebesseg-trips`, 1. verzió; az iOS-pár a SQLite-os
 * `TripStore.swift`). Két tár: `trips` (kulcs: `id`, index: `startedAt`; a rekord a közös `Trip` alakja) és `samples`
 * (automatikus kulcs, index: `tripId`; 1 Hz GPS-minták a H3-cellával – h3-js, lustán töltve). Szerverre semmi nem megy.
 */
const DB_NAME = 'atlagsebesseg-trips';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples', { autoIncrement: true }).createIndex('tripId', 'tripId');
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
  return all.sort((a, b) => b.startedAt - a.startedAt);
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
  const tx = db.transaction(['trips', 'samples'], 'readwrite');
  tx.objectStore('trips').clear();
  tx.objectStore('samples').clear();
  await done(tx);
}
