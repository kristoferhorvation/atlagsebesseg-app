import type { GpsFix } from '@atlagsebesseg/core';
import { describe, expect, it } from 'vitest';
import { greetingText, greetingVoice } from '../src/greeting';
import { setLanguage } from '../src/i18n';
import type { ActiveReport } from '../src/reportFeed';
import { REPORT_PROMPT, ReportPromptWatch, reportPromptCandidate } from '../src/reportPrompt';
import { DEFAULT_SETTINGS, normalizeName, parseSettings } from '../src/settings';

// AOS14: „Még ott van?” közeledéskor, és a köszöntés (a Swift-pár: AtlagsebessegTests/ReportTests.swift, azonos nevekkel)

const HOME = { lat: 47.5, lon: 19.05 };
const fix = (heading: number | null, at = HOME): GpsFix => ({ ...at, timestamp: 0, speed: heading === null ? 0 : 20, accuracy: 5, heading });
const rep = (id: string, bearing: number, distM: number, extra: Partial<ActiveReport> = {}): ActiveReport => ({
  id,
  type: 'rendorseg',
  gateKind: null,
  ...destinationPoint(HOME, bearing, distM),
  headingDeg: null,
  createdAt: 0,
  expiresAt: 10_000_000,
  confirmations: 0,
  denials: 0,
  own: false,
  ...extra,
});
const never = () => false;

/** Pont a HOME-tól `bearing` irányban `distM` méterre (kis távolságon a sík közelítés elég). */
function destinationPoint(from: { lat: number; lon: number }, bearing: number, distM: number) {
  const r = (bearing * Math.PI) / 180;
  const mPerDeg = 111_195;
  return { lat: from.lat + (distM * Math.cos(r)) / mPerDeg, lon: from.lon + (distM * Math.sin(r)) / (mPerDeg * Math.cos((from.lat * Math.PI) / 180)) };
}

describe('reportPromptCandidate (közeledés)', () => {
  it('előttünk askM-en belül kérdez, azon túl nem', () => {
    expect(reportPromptCandidate(fix(0), [rep('a', 0, REPORT_PROMPT.askM - 5)], never)?.id).toBe('a');
    expect(reportPromptCandidate(fix(0), [rep('a', 0, REPORT_PROMPT.askM + 20)], never)).toBeNull();
  });

  it('mögöttünk vagy oldalt (a kúpon kívül) csak nearM-en belül', () => {
    expect(reportPromptCandidate(fix(0), [rep('a', 180, 120)], never)).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('a', 90, 120)], never)).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('a', 180, REPORT_PROMPT.nearM - 5)], never)?.id).toBe('a');
  });

  it('irány nélkül (álló autó) csak nearM-en belül', () => {
    expect(reportPromptCandidate(fix(null), [rep('a', 0, 120)], never)).toBeNull();
    expect(reportPromptCandidate(fix(null), [rep('a', 0, 30)], never)?.id).toBe('a');
  });

  it('a saját bejelentésre és a kihagyottra (kérdezett / megszavazott) nem kérdez; a legközelebbit választja', () => {
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 100, { own: true })], never)).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 100)], (id) => id === 'a')).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('far', 0, 180), rep('near', 10, 90)], never)?.id).toBe('near');
  });
});

describe('ReportPromptWatch (egyszer kérdez)', () => {
  it('bejelentésenként egyszer: bezárás után ugyanarra nem kérdez újra', () => {
    const w = new ReportPromptWatch();
    const reports = [rep('a', 0, 100)];
    expect(w.update(fix(0), reports, never, 0)).toBe('a');
    w.close();
    expect(w.update(fix(0), reports, never, 1000)).toBeNull();
  });

  it('válasz nélkül showMs után eltűnik', () => {
    const w = new ReportPromptWatch();
    const reports = [rep('a', 0, 100)];
    expect(w.update(fix(0), reports, never, 0)).toBe('a');
    expect(w.update(fix(0), reports, never, REPORT_PROMPT.showMs - 1)).toBe('a');
    expect(w.update(fix(0), reports, never, REPORT_PROMPT.showMs)).toBeNull();
    expect(w.current).toBeNull();
  });

  it('szavazat után, vagy ha a bejelentés eltűnt a listából, bezárul', () => {
    const w = new ReportPromptWatch();
    expect(w.update(fix(0), [rep('a', 0, 100)], never, 0)).toBe('a');
    expect(w.update(fix(0), [rep('a', 0, 100)], (id) => id === 'a', 500)).toBeNull();
    const w2 = new ReportPromptWatch();
    expect(w2.update(fix(0), [rep('b', 0, 100)], never, 0)).toBe('b');
    expect(w2.update(fix(0), [], never, 500)).toBeNull();
  });

  it('a kérdés alatt nem vált másik bejelentésre; utána a következőre kérdez', () => {
    const w = new ReportPromptWatch();
    const reports = [rep('a', 0, 100), rep('b', 0, 150)];
    expect(w.update(fix(0), reports, never, 0)).toBe('a');
    expect(w.update(fix(0), reports, never, 1000)).toBe('a');
    w.close();
    expect(w.update(fix(0), reports, never, 2000)).toBe('b');
  });
});

describe('köszöntés (megszólítás)', () => {
  it('kitöltve névvel, üresen név nélkül – felirat és hang', () => {
    setLanguage('hu');
    expect(greetingText('Kristof')).toBe('Szia Kristof!');
    expect(greetingText('')).toBe('Szia!');
    expect(greetingText('   ')).toBe('Szia!');
    expect(greetingVoice('Kristof')).toBe('Szia Kristof, indulhatunk!');
    expect(greetingVoice('')).toBe('Szia, indulhatunk!');
    setLanguage('de');
    expect(greetingText('Kristof')).toBe('Hallo Kristof!');
    expect(greetingVoice('')).toBe('Hallo, los geht’s!');
    setLanguage('hu');
  });

  it('a név vágva, a belső szóközök egyre, legfeljebb 24 karakter', () => {
    expect(normalizeName('  Kis   Péter ')).toBe('Kis Péter');
    expect(normalizeName('x'.repeat(40))).toHaveLength(24);
  });

  it('beállítás: a megszólítás tárolva, alapból üres; nem szöveg helyett üres', () => {
    expect(DEFAULT_SETTINGS.megszolitas).toBe('');
    expect(parseSettings(JSON.stringify({ megszolitas: ' Kristof ' })).megszolitas).toBe('Kristof');
    expect(parseSettings(JSON.stringify({ megszolitas: 42 })).megszolitas).toBe('');
  });
});
