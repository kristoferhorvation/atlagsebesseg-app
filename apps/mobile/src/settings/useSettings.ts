import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_KEY, type Settings } from '@atlagsebesseg/app-logic';
import { useCallback, useEffect, useState } from 'react';

export type { Settings };

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => raw && setSettings(parseSettings(raw)))
      .catch(() => undefined);
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => undefined);
      return next;
    });
  }, []);

  return { settings, update };
}
