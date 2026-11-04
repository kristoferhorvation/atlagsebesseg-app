import { CLOUD_STATE_KEY, DEVICE_KEY, parseCloudState, parseSettings, SETTINGS_KEY, type CloudState } from '@atlagsebesseg/app-logic';

/**
 * AW22: a felhős mentés helyi állapota (localStorage): a még nem továbbított törlések és visszaállítások. Csak bekapcsolt mentésnél
 * gyűlik: kikapcsolva a szerverre nem megy semmi, így törlési jelölő sem.
 */
export const readCloudState = (): CloudState => {
  try {
    return parseCloudState(localStorage.getItem(CLOUD_STATE_KEY));
  } catch {
    return parseCloudState(null);
  }
};

export const writeCloudState = (s: CloudState): void => {
  try {
    localStorage.setItem(CLOUD_STATE_KEY, JSON.stringify(s));
  } catch {
    // tárhely nélkül a következő kör újra kiszámolja
  }
};

const backupOn = (): boolean => {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY)).felho_mentes;
  } catch {
    return false;
  }
};

/** Törölt utak: a szerver tartalma törlődik, a többi készülékről is eltűnnek. `heat`: a saját hőtérkép felhős sorai is. */
export function noteDeleted(ids: readonly string[], heat = false): void {
  if (!backupOn()) return;
  const s = readCloudState();
  writeCloudState({ ...s, pendingDeletes: [...new Set([...s.pendingDeletes, ...ids])], pendingRestores: s.pendingRestores.filter((id) => !ids.includes(id)), pendingHeatClear: s.pendingHeatClear || heat });
}

/** Visszaállított utak: a szerver törlési jelölőjét felülírják. */
export function noteRestored(ids: readonly string[]): void {
  if (!backupOn()) return;
  const s = readCloudState();
  writeCloudState({ ...s, pendingRestores: [...new Set([...s.pendingRestores, ...ids])], pendingDeletes: s.pendingDeletes.filter((id) => !ids.includes(id)), heatHash: '' });
}

/** A készülék azonosítója a felhős hőtérkép-sorhoz (telepítésenként egy, nem személyes adat). */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY);
    if (have) return have;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'web';
  }
}
