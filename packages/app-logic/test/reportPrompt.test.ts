import type { GpsFix } from '@atlagsebesseg/core';
import { describe, expect, it } from 'vitest';
import { greetingText, greetingVoice } from '../src/greeting';
import { setLanguage } from '../src/i18n';
import type { ActiveReport } from '../src/reportFeed';
import { REPORT_PROMPT, ReportPromptWatch, reportAlertM, reportPromptCandidate } from '../src/reportPrompt';
import { gateStartedAfter, reportMenu } from '../src/reports';
import { DEFAULT_SETTINGS, normalizeName, parseSettings } from '../src/settings';

// AOS14: bejelentés közeledéskor (figyelmeztetés → „Még ott van?”), egy kapu-tétel a menüben, és a köszöntés (a Swift-pár: AtlagsebessegTests/ReportTests.swift, azonos nevekkel)

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
  it('előttünk a kamerával azonos távolságon belül figyelmeztet, azon túl nem', () => {
    // 20 m/s → max(250, 10 × 20) = 250 m; 30 m/s → 300 m
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 240)], never)?.id).toBe('a');
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 270)], never)).toBeNull();
    expect(reportPromptCandidate({ ...fix(0), speed: 30 }, [rep('a', 0, 290)], never)?.id).toBe('a');
    expect(reportAlertM(null)).toBe(250);
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

  it('a saját bejelentésre és a kihagyottra (volt már / megszavazott) nem figyelmeztet; a legközelebbit választja', () => {
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 100, { own: true })], never)).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('a', 0, 100)], (id) => id === 'a')).toBeNull();
    expect(reportPromptCandidate(fix(0), [rep('far', 0, 180), rep('near', 10, 90)], never)?.id).toBe('near');
  });
});

describe('ReportPromptWatch (egy kártya: figyelmeztetés → kérdés)', () => {
  // a bejelentés 300 m-re északra; az autó észak felé halad, `along` méterrel a kiindulás után
  const R = [rep('a', 0, 300)];
  const at = (along: number): GpsFix => ({ ...fix(0), ...destinationPoint(HOME, 0, along) });

  it('előbb figyelmeztet, 50 m-rel a bejelentés előtt ugyanaz a kártya helyben kérdésre vált', () => {
    const w = new ReportPromptWatch();
    const a = w.update(at(60), R, never, 0)!;
    expect([a.id, a.phase, Math.round(a.distanceM)]).toEqual(['a', 'approach', 240]);
    expect(w.update(at(200), R, never, 1000)).toMatchObject({ id: 'a', phase: 'approach' });
    expect(w.update(at(255), R, never, 2000)).toMatchObject({ id: 'a', phase: 'ask' });
  });

  it('a kérdés az elhaladás után még showMs-ig látható, aztán eltűnik, és arra a bejelentésre nem tér vissza', () => {
    const w = new ReportPromptWatch();
    expect(w.update(at(260), R, never, 0)?.phase).toBe('ask');
    // elhaladás előtt nincs időkorlát
    expect(w.update(at(290), R, never, 20_000)?.phase).toBe('ask');
    // elhaladás (mögöttünk): innen számít a showMs
    expect(w.update(at(320), R, never, 21_000)?.phase).toBe('ask');
    expect(w.update(at(380), R, never, 21_000 + REPORT_PROMPT.showMs - 1)?.phase).toBe('ask');
    expect(w.update(at(400), R, never, 21_000 + REPORT_PROMPT.showMs)).toBeNull();
    expect(w.update(at(260), R, never, 40_000)).toBeNull();
  });

  it('kérdés nélküli elhaladás (a bejelentés 50 m-nél messzebb maradt): eltűnik, és nem tér vissza', () => {
    const side = [{ ...rep('s', 0, 0), ...destinationPoint(destinationPoint(HOME, 0, 300), 90, 70) }];
    const w = new ReportPromptWatch();
    expect(w.update(at(200), side, never, 0)?.phase).toBe('approach');
    expect(w.update(at(300), side, never, 1000)?.phase).toBe('approach');
    expect(w.update(at(380), side, never, 2000)).toBeNull();
    expect(w.update(at(200), side, never, 3000)).toBeNull();
  });

  it('hajtűkanyar: ha még nem voltunk a közelében, a „mögöttünk” nem elhaladás', () => {
    const w = new ReportPromptWatch();
    expect(w.update(at(60), R, never, 0)?.phase).toBe('approach');
    // 150 m-re, de az út visszafordul: a haladási irány dél, a bejelentés mögöttünk – még nem haladtunk el mellette
    expect(w.update({ ...at(150), heading: 180 }, R, never, 1000)?.id).toBe('a');
  });

  it('kanyarban (a kúpon kívül, de nem mögöttünk) a kártya megmarad; messzire kerülve eltűnik', () => {
    const w = new ReportPromptWatch();
    expect(w.update(at(60), R, never, 0)?.phase).toBe('approach');
    // az út elkanyarodik: a haladási irány 70°-ra fordul, a bejelentés még előttünk-oldalt
    expect(w.update({ ...at(80), heading: 70 }, R, never, 1000)?.id).toBe('a');
    const far = new ReportPromptWatch();
    expect(far.update(at(60), R, never, 0)).not.toBeNull();
    expect(far.update({ ...fix(90), ...destinationPoint(HOME, 90, 600) }, R, never, 1000)).toBeNull();
  });

  it('válaszra (bezárás / szavazat) azonnal eltűnik, és akkor is, ha a bejelentés eltűnt a listából', () => {
    const w = new ReportPromptWatch();
    expect(w.update(at(260), R, never, 0)?.phase).toBe('ask');
    w.close();
    expect(w.update(at(260), R, never, 500)).toBeNull();
    const w2 = new ReportPromptWatch();
    expect(w2.update(at(260), R, never, 0)).not.toBeNull();
    expect(w2.update(at(260), R, (id) => id === 'a', 500)).toBeNull();
    const w3 = new ReportPromptWatch();
    expect(w3.update(at(260), R, never, 0)).not.toBeNull();
    expect(w3.update(at(260), [], never, 500)).toBeNull();
  });

  it('álló autó (irány nélkül) 50 m-en belül rögtön kérdez', () => {
    const w = new ReportPromptWatch();
    expect(w.update(fix(null), [rep('a', 0, 30)], never, 0)).toMatchObject({ id: 'a', phase: 'ask' });
  });

  it('egyszerre egy bejelentés; a lezárása után a következőre figyelmeztet', () => {
    const w = new ReportPromptWatch();
    const both = [rep('a', 0, 100), rep('b', 0, 150)];
    expect(w.update(fix(0), both, never, 0)?.id).toBe('a');
    expect(w.update(fix(0), both, never, 1000)?.id).toBe('a');
    w.close();
    expect(w.update(fix(0), both, never, 2000)?.id).toBe('b');
  });
});

describe('Bejelentés menü – egy kapu-tétel', () => {
  it('az „Átlagmérés eleje” és „vége” egy tétel a menü végén; elküldött eleje után „vége”', () => {
    expect(reportMenu(false)).toEqual(['rendorseg', 'traffipax', 'baleset', 'akadaly', 'utlezaras', 'szakasz_hiba', 'dugo', 'beallt', 'kapu_kezdo']);
    expect(reportMenu(true).at(-1)).toBe('kapu_zaro');
    expect(reportMenu(true)).toHaveLength(9);
  });

  it('eleje → vége; a vége elküldése, illetve a mérés / navigáció vége visszaállítja; más típus nem változtat', () => {
    expect(gateStartedAfter(false, { sent: 'kapu_kezdo' })).toBe(true);
    expect(gateStartedAfter(true, { sent: 'rendorseg' })).toBe(true);
    expect(gateStartedAfter(true, { sent: 'kapu_zaro' })).toBe(false);
    expect(gateStartedAfter(true, 'activityEnded')).toBe(false);
    expect(gateStartedAfter(false, { sent: 'baleset' })).toBe(false);
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
