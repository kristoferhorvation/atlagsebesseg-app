import { appendSegmentOutbox, parseSegmentOutbox, uploadSegmentRows, type SegmentUploadRow, type SupabaseClient } from '@atlagsebesseg/app-logic';

/**
 * AW24: a közösségi hőtérkép feltöltési sora útszakaszonként (opt-out, `adatmegosztas`). A sorok a localStorage-ban várnak (`heat:segments:outbox:v1`), amíg a feltöltés
 * sikerül; a megosztás kikapcsolásakor a sor törlődik. A régi cella-sor (`heat:outbox:v1`) nem megy fel többé, induláskor törlődik.
 */
export const SEGMENT_OUTBOX_KEY = 'heat:segments:outbox:v1';
const OLD_OUTBOX_KEY = 'heat:outbox:v1';
/** Az illesztő jelölése a közösségi sorokon; a régi sorban nincs ilyen, ma egy szolgáltató van. */
export const SEGMENT_MATCHER = 'mapbox';

const read = (): SegmentUploadRow[] => {
  try {
    return parseSegmentOutbox(localStorage.getItem(SEGMENT_OUTBOX_KEY));
  } catch {
    return [];
  }
};
const write = (rows: readonly SegmentUploadRow[]) => {
  try {
    localStorage.removeItem(OLD_OUTBOX_KEY);
    if (rows.length === 0) localStorage.removeItem(SEGMENT_OUTBOX_KEY);
    else localStorage.setItem(SEGMENT_OUTBOX_KEY, JSON.stringify(rows));
  } catch {
    // tárhely nélkül a sor csak ebben a munkamenetben él
  }
};

export const enqueueSegmentRows = (rows: readonly SegmentUploadRow[]) => write(appendSegmentOutbox(read(), rows));
export const clearSegmentOutbox = () => write([]);
export const segmentOutboxSize = () => read().length;

let flushing: Promise<void> | null = null;

/** A várakozó sorok feltöltése; siker esetén törlődnek (a közben érkezettek megmaradnak), hiba esetén a sor érintetlen. */
export function flushSegmentOutbox(client: SupabaseClient | null): Promise<void> {
  if (!client) return Promise.resolve();
  flushing ??= (async () => {
    const batch = read();
    if (batch.length === 0) return;
    try {
      await uploadSegmentRows(client, batch, SEGMENT_MATCHER);
      write(read().slice(batch.length));
    } catch (e) {
      console.warn('[heat] upload failed', e);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
