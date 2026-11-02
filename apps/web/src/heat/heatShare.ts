import { appendHeatOutbox, parseHeatOutbox, uploadHeatRows, type HeatUploadRow, type SupabaseClient } from '@atlagsebesseg/app-logic';

/**
 * AW20: a közösségi hőtérkép feltöltési sora (opt-in). A sorok a localStorage-ban várnak (`heat:outbox:v1`), amíg a feltöltés
 * sikerül; a megosztás kikapcsolásakor a sor törlődik (a már nem kért adat nem megy fel utólag).
 */
export const HEAT_OUTBOX_KEY = 'heat:outbox:v1';

const read = (): HeatUploadRow[] => {
  try {
    return parseHeatOutbox(localStorage.getItem(HEAT_OUTBOX_KEY));
  } catch {
    return [];
  }
};
const write = (rows: readonly HeatUploadRow[]) => {
  try {
    if (rows.length === 0) localStorage.removeItem(HEAT_OUTBOX_KEY);
    else localStorage.setItem(HEAT_OUTBOX_KEY, JSON.stringify(rows));
  } catch {
    // tárhely nélkül a sor csak ebben a munkamenetben él
  }
};

export const enqueueHeatRows = (rows: readonly HeatUploadRow[]) => write(appendHeatOutbox(read(), rows));
export const clearHeatOutbox = () => write([]);
export const heatOutboxSize = () => read().length;

let flushing: Promise<void> | null = null;

/** A várakozó sorok feltöltése; siker esetén törlődnek (a közben érkezettek megmaradnak), hiba esetén a sor érintetlen. */
export function flushHeatOutbox(client: SupabaseClient | null): Promise<void> {
  if (!client) return Promise.resolve();
  flushing ??= (async () => {
    const batch = read();
    if (batch.length === 0) return;
    try {
      await uploadHeatRows(client, batch);
      write(read().slice(batch.length));
    } catch (e) {
      console.warn('[heat] upload failed', e);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
