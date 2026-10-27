import { useCallback, useState } from 'react';
import { parseSettings, SETTINGS_KEY, type Settings } from '@atlagsebesseg/app-logic';

function read(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return parseSettings(null);
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(read);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // tárhely nélkül csak erre a munkamenetre szól
      }
      return next;
    });
  }, []);
  return { settings, update };
}
