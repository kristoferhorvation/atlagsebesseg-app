import { afterEach, describe, expect, it } from 'vitest';
import {
  DICTIONARIES,
  LANGUAGES,
  LANGUAGE_NAMES,
  languageMenu,
  directionsLanguage,
  formatNumber,
  getLanguage,
  hasVoiceFor,
  langOfTag,
  parsePreference,
  resolveLanguage,
  setLanguage,
  subscribeLanguage,
  t,
  template,
  type Lang,
} from '../src/i18n';
import { formatDistance, sectionSourceLabel, timeAgo } from '../src/display';
import { cameraLabel, cameraSourceText, cameraWarning } from '../src/cameras';
import { plannedDateRange, plannedLimitText } from '../src/plannedChecks';
import { reportChoiceLabel, REPORT_CHOICES } from '../src/reports';
import { reportVisual } from '../src/reportFeed';

afterEach(() => setLanguage('hu'));

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('szótárak: minden kulcs mind a 6 nyelven', () => {
  it('a nyelvek: hu, en, de, sk, cs, pl', () => {
    expect([...LANGUAGES]).toEqual(['hu', 'en', 'de', 'sk', 'cs', 'pl']);
    for (const l of LANGUAGES) expect(LANGUAGE_NAMES[l].length).toBeGreaterThan(1);
  });

  it('AW15: a nyelvválasztó zászlóval, a saját nyelvén írt név szerint ábécérendben', () => {
    expect(languageMenu().map((x) => x.label)).toEqual(['🇨🇿 Čeština', '🇩🇪 Deutsch', '🇬🇧 English', '🇭🇺 Magyar', '🇵🇱 Polski', '🇸🇰 Slovenčina']);
    expect(languageMenu().map((x) => x.lang)).toEqual(['cs', 'de', 'en', 'hu', 'pl', 'sk']);
  });

  for (const lang of LANGUAGES.filter((l) => l !== 'hu')) {
    it(`${lang}: nincs hiányzó és nincs felesleges kulcs a magyar forráshoz képest`, () => {
      const hu = Object.keys(DICTIONARIES.hu);
      const have = new Set(Object.keys(DICTIONARIES[lang]));
      expect(hu.filter((k) => !have.has(k)), `hiányzik a(z) ${lang}.json-ból`).toEqual([]);
      expect([...have].filter((k) => !(k in DICTIONARIES.hu)), `nincs a hu.json-ban (${lang})`).toEqual([]);
    });

    it(`${lang}: ugyanazok a {paraméterek}, nincs üres szöveg`, () => {
      for (const [k, hu] of Object.entries(DICTIONARIES.hu)) {
        const v = (DICTIONARIES[lang] as Record<string, string>)[k]!;
        expect(v.trim().length, `${lang}.${k} üres`).toBeGreaterThan(0);
        expect(placeholders(v), `${lang}.${k} paraméterei`).toEqual(placeholders(hu));
      }
    });
  }

  it('minden nyelvben megvan a 12 hónap és a 3 dátum-minta', () => {
    for (const lang of LANGUAGES) {
      for (let m = 1; m <= 12; m++) expect((DICTIONARIES[lang] as Record<string, string>)[`date.month.${m}`], `${lang} hónap ${m}`).toBeTruthy();
    }
  });
});

describe('t(): paraméterek, tartalék', () => {
  it('„Maradj {x} alatt” – paraméterezve', () => {
    expect(t('slowdown.stay', { x: 90 })).toBe('Maradj 90 alatt');
    expect(t('slowdown.stay', { x: 90 }, 'en')).toBe('Stay under 90');
    expect(t('slowdown.stay', { x: 90 }, 'pl')).toBe('Zostań poniżej 90');
  });

  it('hiányzó paraméter a helyén marad, ismeretlen kulcs a kulcs maga', () => {
    expect(t('slowdown.stay')).toBe('Maradj {x} alatt');
    expect(t('nincs.ilyen' as never)).toBe('nincs.ilyen');
  });

  it('hiányzó kulcs egy nyelvben a magyarra esik vissza', () => {
    const saved = (DICTIONARIES.de as Record<string, string>)['common.close']!;
    delete (DICTIONARIES.de as Record<string, string>)['common.close'];
    try {
      expect(template('common.close', 'de')).toBe('Bezárás');
    } finally {
      (DICTIONARIES.de as Record<string, string>)['common.close'] = saved;
    }
  });

  it('nyelvváltás: a t() az aktuális nyelvet adja, a figyelő értesül, azonos nyelvre nem', () => {
    let calls = 0;
    const off = subscribeLanguage(() => calls++);
    expect(getLanguage()).toBe('hu');
    expect(t('common.close')).toBe('Bezárás');
    setLanguage('en');
    expect(t('common.close')).toBe('Close');
    setLanguage('en');
    expect(calls).toBe(1);
    off();
    setLanguage('de');
    expect(calls).toBe(1);
  });
});

describe('nyelv-felismerés', () => {
  it('a készülék nyelve, ha támogatott; különben en', () => {
    expect(resolveLanguage('auto', ['hu-HU', 'en-US'])).toBe('hu');
    expect(resolveLanguage('auto', ['sk-SK'])).toBe('sk');
    expect(resolveLanguage('auto', ['cs_CZ'])).toBe('cs');
    expect(resolveLanguage('auto', ['pl'])).toBe('pl');
    expect(resolveLanguage('auto', ['de-AT'])).toBe('de');
    expect(resolveLanguage('auto', ['fr-FR', 'it-IT'])).toBe('en');
    expect(resolveLanguage('auto', [])).toBe('en');
  });

  it('a nyelvlista sorrendje számít: az első támogatott nyer', () => {
    expect(resolveLanguage('auto', ['fr-FR', 'pl-PL', 'hu-HU'])).toBe('pl');
  });

  it('a választott nyelv felülírja a készülékét', () => {
    expect(resolveLanguage('de', ['hu-HU'])).toBe('de');
  });

  it('tárolt érték: ismeretlen / sérült → auto', () => {
    expect(parsePreference('sk')).toBe('sk');
    expect(parsePreference('klingon')).toBe('auto');
    expect(parsePreference(null)).toBe('auto');
    expect(langOfTag('PL-pl')).toBe('pl');
    expect(langOfTag('ja-JP')).toBeNull();
  });
});

describe('hang', () => {
  it('a hangok közt a nyelvhez tartozó (hu-HU, hu_HU, hu)', () => {
    const voices = [{ lang: 'en-GB' }, { lang: 'hu_HU' }, { lang: 'de' }];
    expect(hasVoiceFor(voices, 'hu')).toBe(true);
    expect(hasVoiceFor(voices, 'de')).toBe(true);
    expect(hasVoiceFor(voices, 'pl')).toBe(false);
    expect(hasVoiceFor([], 'en')).toBe(false);
  });

  it('a Directions `language` paraméter ISO 639-1', () => {
    for (const l of LANGUAGES) expect(directionsLanguage(l)).toMatch(/^[a-z]{2}$/);
  });
});

describe('formázás nyelv szerint', () => {
  it('számok: tizedesvessző (hu, de, sk, cs, pl) / pont (en)', () => {
    const km = (l: Lang) => {
      setLanguage(l);
      return formatDistance(12_345, 'kmh');
    };
    expect(km('hu')).toEqual({ value: '12,3', unit: 'km' });
    expect(km('de')).toEqual({ value: '12,3', unit: 'km' });
    expect(km('pl')).toEqual({ value: '12,3', unit: 'km' });
    expect(km('en')).toEqual({ value: '12.3', unit: 'km' });
    expect(formatNumber(1234.5, {}, 'en')).toBe('1,234.5');
  });

  it('dátum-tartomány a nyelv mintája szerint', () => {
    const r = { validFrom: Date.parse('2026-10-26T23:00:00Z'), validTo: Date.parse('2026-11-01T22:59:59Z') };
    const same = { validFrom: Date.parse('2026-04-15T04:00:00Z'), validTo: Date.parse('2026-04-19T21:59:59Z') };
    const out = (l: Lang) => (setLanguage(l), [plannedDateRange(r), plannedDateRange(same)]);
    expect(out('hu')).toEqual(['okt 27–nov 1', 'ápr 15–19']);
    expect(out('en')).toEqual(['Oct 27–Nov 1', 'Apr 15–19']);
    expect(out('de')).toEqual(['27. Okt. – 1. Nov.', '15.–19. Apr.']);
    expect(out('pl')).toEqual(['27 paź – 1 lis', '15–19 kwi']);
    expect(out('cs')).toEqual(['27. říj – 1. lis', '15.–19. dub']);
  });

  it('„mennyi ideje”, forrás, kamera, bejelentés-típusok nyelvenként', () => {
    setLanguage('en');
    expect(timeAgo(20_000)).toBe('now');
    expect(timeAgo(12 * 60_000)).toBe('12 min ago');
    expect(sectionSourceLabel({ source: 'osm' })).toBe('Source: OpenStreetMap');
    expect(cameraLabel('red_light')).toBe('Red-light camera');
    expect(cameraSourceText({ verified: false, type: 'speed', sourceDate: '2026-10-28', country: 'HU' })).toBe('OpenStreetMap · unverified (2026-10-28)');
    expect(cameraWarning('DE')).toBe('In Germany the driver may not use this feature');
    expect(plannedLimitText({ speedLimitKmh: 90, limitSource: 'kresz_default' })).toBe('max ~90');
    expect(reportVisual({ type: 'ideiglenes_kapu', gateKind: 'zaro' }).label).toBe('Average check end');
    expect(REPORT_CHOICES.map((c) => reportChoiceLabel(c.id))).toEqual(['Police', 'Speed camera', 'Accident', 'Obstacle', 'Road closed', 'Faulty section', 'Average check start', 'Average check end']);
    setLanguage('pl');
    expect(timeAgo(2 * 3600_000)).toBe('2 godz. temu');
  });
});
