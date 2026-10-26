import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

export interface Settings {
  /** A kijelző a határ + hatósági tűrést is mutatja (a számítás mindig a szigorú határhoz). */
  hatosagi_tures_megjelenitese: boolean;
}

const DEFAULTS: Settings = { hatosagi_tures_megjelenitese: false };
const KEY = 'settings:v1';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }))
      .catch(() => undefined);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, update };
}
