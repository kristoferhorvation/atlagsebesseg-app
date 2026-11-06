/**
 * Többnyelvűség: minden felhasználónak szóló szöveg a `<nyelv>.json` szótárakban van (kulcs → szöveg,
 * `{x}` paraméterrel). A `hu` a forrás; a többi nyelvben minden kulcsnak meg kell lennie (teszt).
 * Új felirat csak a szótárba kerül, mind a 6 nyelven – kódban magyar/idegen nyelvű felirat nincs.
 */
import cs from './cs.json';
import de from './de.json';
import en from './en.json';
import hu from './hu.json';
import pl from './pl.json';
import sk from './sk.json';

export const LANGUAGES = ['hu', 'en', 'de', 'sk', 'cs', 'pl'] as const;
export type Lang = (typeof LANGUAGES)[number];
/** A felhasználó választása: egy nyelv, vagy `auto` (a készülék nyelve, ha támogatott, különben `en`). */
export type LangPreference = Lang | 'auto';

/** A szótár kulcsai (a magyar forrásból). */
export type TKey = keyof typeof hu;
export type Dictionary = Record<TKey, string>;
export type Params = Record<string, string | number>;

export const DICTIONARIES: Record<Lang, Dictionary> = { hu, en, de, sk, cs, pl } as Record<Lang, Dictionary>;

/** A nyelvek saját nevükön (választólista) – ezek nem fordítandók. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  hu: 'Magyar',
  en: 'English',
  de: 'Deutsch',
  sk: 'Slovenčina',
  cs: 'Čeština',
  pl: 'Polski',
};

/** A nyelv zászlaja a választólistában (AW15). */
export const LANGUAGE_FLAGS: Record<Lang, string> = { hu: '🇭🇺', en: '🇬🇧', de: '🇩🇪', sk: '🇸🇰', cs: '🇨🇿', pl: '🇵🇱' };

/**
 * A nyelvválasztó sorai (AW15): „🇭🇺 Magyar” – zászló + a saját nyelvén írt név, a név szerint ábécérendben (ékezet nélkül
 * összevetve: Čeština a C-nél). Az „Automatikus” sor nem része, az mindig legfelül áll.
 */
export function languageMenu(): { lang: Lang; label: string }[] {
  const key = (l: Lang) => LANGUAGE_NAMES[l].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return [...LANGUAGES]
    .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
    .map((lang) => ({ lang, label: `${LANGUAGE_FLAGS[lang]} ${LANGUAGE_NAMES[lang]}` }));
}

/** BCP 47 nyelvi címke a számformázáshoz és a beszédszintézishez. */
export const LOCALES: Record<Lang, string> = { hu: 'hu-HU', en: 'en-GB', de: 'de-DE', sk: 'sk-SK', cs: 'cs-CZ', pl: 'pl-PL' };

/** Az útvonaltervező (Directions API) `language` paramétere: ISO 639-1, a hangos utasítások nyelve. */
export const directionsLanguage = (lang: Lang): string => lang;

export const LANG_STORAGE_KEY = 'lang:v1';

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);

/** `'sk-SK'`, `'cs_CZ'`, `'PL'` → támogatott nyelv, vagy `null`. */
export function langOfTag(tag: string): Lang | null {
  const base = tag.toLowerCase().split(/[-_]/)[0] ?? '';
  return isLang(base) ? base : null;
}

/** A tárolt érték beolvasása; ismeretlen / sérült érték helyett `auto`. */
export const parsePreference = (raw: string | null | undefined): LangPreference => (isLang(raw) ? raw : 'auto');

/**
 * A használt nyelv: a választott; `auto`-nál a készülék nyelvei közül az első támogatott
 * (`navigator.languages` sorrendjében), különben `en`.
 */
export function resolveLanguage(pref: LangPreference, deviceLocales: readonly string[]): Lang {
  if (pref !== 'auto') return pref;
  for (const tag of deviceLocales) {
    const l = langOfTag(tag);
    if (l) return l;
  }
  return 'en';
}

// ---------------------------------------------------------------------------
// Aktuális nyelv
// ---------------------------------------------------------------------------

let current: Lang = 'hu';
const listeners = new Set<() => void>();

export const getLanguage = (): Lang => current;

export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const l of [...listeners]) l();
}

/** Változásfigyelő (React `useSyncExternalStore`-hoz); a visszaadott függvény leiratkozik. */
export function subscribeLanguage(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Fordítás
// ---------------------------------------------------------------------------

/** A kulcs sablonja az aktuális nyelven; hiányzó kulcsnál a magyar, végül maga a kulcs. */
export function template(key: TKey, lang: Lang = current): string {
  return DICTIONARIES[lang][key] ?? DICTIONARIES.hu[key] ?? key;
}

/** Fordítás paraméterekkel: `t('slowdown.stay', { x: 90 })` → „Maradj 90 alatt”. */
export function t(key: TKey, params?: Params, lang: Lang = current): string {
  return fill(template(key, lang), params, lang);
}

/**
 * AW25: CLDR többesszám-kategória (a mi 6 nyelvünkre, a Swift `pluralCategory` párja – nem az `Intl.PluralRules`, hogy a két platform
 * bitre azonos legyen). hu / en / de: one (pontosan 1) / other; sk / cs: one (1), few (2–4), many (tört), other; pl: one (1),
 * few (…2–4, de nem 12–14), many (a többi egész), other (tört).
 */
export type PluralCategory = 'one' | 'few' | 'many' | 'other';
export function pluralCategory(n: number, lang: Lang): PluralCategory {
  if (Number.isNaN(n)) return 'other';
  const a = Math.abs(n);
  const int = Number.isInteger(a);
  if (lang === 'sk' || lang === 'cs') return !int ? 'many' : a === 1 ? 'one' : a >= 2 && a <= 4 ? 'few' : 'other';
  if (lang === 'pl') {
    if (!int) return 'other';
    if (a === 1) return 'one';
    const m10 = a % 10;
    const m100 = a % 100;
    return m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 'few' : 'many';
  }
  return int && a === 1 ? 'one' : 'other';
}

/** A paraméter számértéke (a kiírt „2,1” is szám); nem szám → `NaN` (az `other` ág). */
const numeric = (v: string | number): number => (typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.')));

/**
 * Kitöltés: `{x}` → érték; ICU-többesszám: `{n, plural, one {# perc} few {…} many {…} other {…}}` – a `#` a paraméter kiírt értéke,
 * az ágban más `{y}` is állhat. Hiányzó ág → `other`; hiányzó paraméter a helyén marad.
 */
export function fill(s: string, params: Params | undefined, lang: Lang = current): string {
  if (!params) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const m = /^\{(\w+), plural,/.exec(s.slice(i));
    if (!m) {
      out += s[i++];
      continue;
    }
    // az ICU-blokk vége: a kapcsos zárójelek egyensúlya
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) break;
    }
    const name = m[1]!;
    const body = s.slice(i + m[0].length, j);
    const branches = new Map<string, string>();
    for (let k = 0; k < body.length; ) {
      const b = /^\s*(\w+)\s*\{/.exec(body.slice(k));
      if (!b) break;
      let d = 1;
      let e = k + b[0].length;
      for (; e < body.length && d > 0; e++) {
        if (body[e] === '{') d++;
        else if (body[e] === '}') d--;
      }
      branches.set(b[1]!, body.slice(k + b[0].length, e - 1));
      k = e;
    }
    if (!(name in params)) out += s.slice(i, j + 1);
    else {
      const v = params[name]!;
      const branch = branches.get(pluralCategory(numeric(v), lang)) ?? branches.get('other') ?? '';
      out += branch.replaceAll('#', String(v));
    }
    i = j + 1;
  }
  return out.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Szám a nyelv szerint (tizedesjel, ezres tagolás). */
export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}, lang: Lang = current): string {
  return new Intl.NumberFormat(LOCALES[lang], opts).format(n);
}

// ---------------------------------------------------------------------------
// Hang
// ---------------------------------------------------------------------------

/** Van-e a hangok között a nyelvhez tartozó (`hu-HU`, `hu_HU`, `hu`). */
export function hasVoiceFor(voices: readonly { lang: string }[], lang: Lang): boolean {
  return voices.some((v) => langOfTag(v.lang) === lang);
}
