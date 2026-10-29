import { describe, expect, it } from 'vitest';
import { DICTIONARIES, LANGUAGES } from '../src/i18n';
import { deniedHelpSteps, detectBrowser, gpsPillAction, pillRequestError, retryOnGesture, type BrowserKind, type GeoPermission, type GeoStatus } from '../src/location';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:143.0) Gecko/20100101 Firefox/143.0',
};

describe('helyhozzáférés (AW13)', () => {
  it('böngésző-felismerés: iOS Safari (iPadOS asztali UA-val is) / Mac Safari / Chrome / Android Chrome / egyéb', () => {
    expect(detectBrowser(UA.iphone, 5)).toBe('iosSafari');
    expect(detectBrowser(UA.ipad, 5)).toBe('iosSafari');
    expect(detectBrowser(UA.ipad, 0)).toBe('macSafari');
    expect(detectBrowser(UA.macSafari)).toBe('macSafari');
    expect(detectBrowser(UA.macChrome)).toBe('chrome');
    expect(detectBrowser(UA.androidChrome, 5)).toBe('androidChrome');
    for (const ua of [UA.iosChrome, UA.samsung]) expect(detectBrowser(ua, 5), ua).toBe('other');
    for (const ua of [UA.winEdge, UA.firefox, '']) expect(detectBrowser(ua), ua).toBe('other');
  });

  it('GPS-pill pozíció nélkül: „prompt” → kérés, „denied” → tiltott-lap, „granted” → semmi', () => {
    for (const s of ['kereses', 'elutasitva', 'hiba'] as GeoStatus[]) {
      expect(gpsPillAction('prompt', s), s).toBe('request');
      expect(gpsPillAction('denied', s), s).toBe('deniedHelp');
      expect(gpsPillAction('granted', s), s).toBe('none');
    }
  });

  it('GPS-pill: a helyzet-állapot nyer – van pozíció → semmi, akármit mond a Permissions API (AW14)', () => {
    for (const p of ['prompt', 'denied', 'granted', 'unknown'] as GeoPermission[]) expect(gpsPillAction(p, 'aktiv'), p).toBe('none');
  });

  it('GPS-pill iOS Safari (nincs Permissions API): van pozíció → semmi, nincs pozíció → kérés, sosem tiltott-lap (AW14)', () => {
    expect(gpsPillAction('unknown', 'aktiv')).toBe('none');
    for (const s of ['kereses', 'elutasitva', 'hiba'] as GeoStatus[]) expect(gpsPillAction('unknown', s), s).toBe('request');
  });

  it('GPS-pill Chrome (API „denied”, nincs pozíció) → tiltott-lap (AW14)', () => {
    expect(gpsPillAction('denied', 'elutasitva')).toBe('deniedHelp');
    expect(gpsPillAction('denied', 'kereses')).toBe('deniedHelp');
  });

  it('GPS-pill: HTTPS nélkül és kikapcsolva nincs teendő', () => {
    for (const p of ['prompt', 'denied', 'granted', 'unknown'] as GeoPermission[]) {
      expect(gpsPillAction(p, 'nem_elerheto'), p).toBe('none');
      expect(gpsPillAction(p, 'ki'), p).toBe('none');
    }
  });

  it('első gesztus: újrakérés, ha nincs pozíció és az engedély nincs eldöntve (Mac Safari gesztus nélkül nem kérdez)', () => {
    expect(retryOnGesture('prompt', 'kereses')).toBe(true);
    expect(retryOnGesture('prompt', 'elutasitva')).toBe(true);
    expect(retryOnGesture('unknown', 'hiba')).toBe(true);
    expect(retryOnGesture('prompt', 'aktiv')).toBe(false);
    expect(retryOnGesture('granted', 'kereses')).toBe(false);
    expect(retryOnGesture('denied', 'elutasitva')).toBe(false);
    expect(retryOnGesture('unknown', 'nem_elerheto')).toBe(false);
  });

  it('a tiltott-lap lépései minden böngészőre, mind a 6 nyelven', () => {
    const kinds: BrowserKind[] = ['iosSafari', 'macSafari', 'chrome', 'androidChrome', 'other'];
    for (const k of kinds) {
      const steps = deniedHelpSteps(k);
      expect(steps.length, k).toBeGreaterThan(0);
      for (const lang of LANGUAGES)
        for (const key of [...steps, 'geo.blocked.title', 'geo.blocked.intro', 'geo.blocked.retry'] as const)
          expect(DICTIONARIES[lang][key], `${lang} ${key}`).toBeTruthy();
    }
    expect(deniedHelpSteps('macSafari')[0]).toBe('geo.help.macSafari.1');
  });

  it('AW15: a pill újrakérésére jött PERMISSION_DENIED (1) a tiltott-lapot nyitja – Permissions API nélkül is', () => {
    expect(pillRequestError(1, true)).toBe('deniedHelp');
    // más hiba (nincs jel, időtúllépés) nem tiltás
    expect(pillRequestError(2, true)).toBe('none');
    expect(pillRequestError(3, true)).toBe('none');
    // az automatikus / első-gesztusos kérés elutasítása nem nyit lapot magától
    expect(pillRequestError(1, false)).toBe('none');
  });
});
