import { Fragment, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  directionsLanguage,
  getLanguage,
  hasVoiceFor,
  LOCALES,
  parsePreference,
  resolveLanguage,
  setLanguage,
  LANG_STORAGE_KEY,
  subscribeLanguage,
  template,
  type Lang,
  type LangPreference,
  type TKey,
} from '@atlagsebesseg/app-logic';

const deviceLocales = (): string[] => (typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language].filter(Boolean));

function readPreference(): LangPreference {
  try {
    return parsePreference(localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

/** A nyelv-választás állapota (a tárolás itt, a `t()` állapota az app-logic-ban). */
let preference: LangPreference = readPreference();
const prefListeners = new Set<() => void>();
const apply = () => {
  setLanguage(resolveLanguage(preference, deviceLocales()));
  if (typeof document !== 'undefined') {
    document.documentElement.lang = getLanguage();
    document.title = template('app.name');
  }
};
apply();

export function setLanguagePreference(next: LangPreference): void {
  preference = next;
  try {
    if (next === 'auto') localStorage.removeItem(LANG_STORAGE_KEY);
    else localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // tárhely nélkül csak erre a munkamenetre szól
  }
  apply();
  for (const l of [...prefListeners]) l();
}

/**
 * Az aktuális nyelv; a nyelvváltáskor az őt használó komponens újrarenderel. A `t()` globális, ezért a
 * gyökér-komponensnek használnia kell, hogy a teljes fa frissüljön.
 */
export function useLanguage(): { lang: Lang; preference: LangPreference; setPreference: (p: LangPreference) => void } {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage);
  const pref = useSyncExternalStore(
    (cb) => (prefListeners.add(cb), () => void prefListeners.delete(cb)),
    () => preference,
  );
  return { lang, preference: pref, setPreference: setLanguagePreference };
}

/** Mint a `t()`, de a `{x}` helyére React-elem is kerülhet (pl. félkövér szám). */
export function tNode(key: TKey, params: Record<string, ReactNode>): ReactNode {
  return template(key)
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      return <Fragment key={i}>{name && name in params ? params[name] : part}</Fragment>;
    });
}

export type VoiceStatus = 'ok' | 'missing' | 'unsupported';

/**
 * Van-e a készüléken hang a nyelvhez (speechSynthesis). iOS Safarin a hangok késve, a `voiceschanged`
 * eseményre töltődnek be – addig a lista üres lehet, ezért figyeljük.
 */
export function useVoiceStatus(lang: Lang): VoiceStatus {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const check = useCallback((): VoiceStatus => (!supported ? 'unsupported' : hasVoiceFor(window.speechSynthesis.getVoices(), lang) ? 'ok' : 'missing'), [supported, lang]);
  const [status, setStatus] = useState<VoiceStatus>(check);
  useEffect(() => {
    setStatus(check());
    if (!supported) return;
    const synth = window.speechSynthesis;
    const on = () => setStatus(check());
    synth.addEventListener('voiceschanged', on);
    return () => synth.removeEventListener('voiceschanged', on);
  }, [check, supported]);
  return status;
}

/** A hangos utasítások beállításai a nyelvhez: a Directions `language` paramétere és a speechSynthesis nyelve. */
export const speechSettings = (lang: Lang) => ({ directionsLanguage: directionsLanguage(lang), speechLang: LOCALES[lang] });
