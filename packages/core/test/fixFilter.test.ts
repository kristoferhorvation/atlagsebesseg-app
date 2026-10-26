import { describe, expect, it } from 'vitest';
import { FixFilter } from '../src/fixFilter';
import type { GpsFix } from '../src/types';

const fix = (t: number, latOffsetM: number, accuracy: number | null = 5): GpsFix => ({
  lat: 45 + latOffsetM / 111_195,
  lon: 10,
  timestamp: t * 1000,
  speed: 30,
  accuracy,
  heading: 0,
});

describe('FixFilter', () => {
  it('elfogadja a folyamatos mozgást', () => {
    const f = new FixFilter();
    for (let i = 0; i < 10; i++) expect(f.check(fix(i, i * 30)).ok).toBe(true);
  });

  it('eldobja a pontatlan fixet', () => {
    const f = new FixFilter();
    expect(f.check(fix(0, 0, 80))).toEqual({ ok: false, reason: 'pontatlan' });
    expect(f.check(fix(0, 0, null)).ok).toBe(true);
  });

  it('eldobja az időrendben hibásat', () => {
    const f = new FixFilter();
    f.check(fix(5, 0));
    expect(f.check(fix(5, 30))).toEqual({ ok: false, reason: 'idorend' });
    expect(f.check(fix(4, 30))).toEqual({ ok: false, reason: 'idorend' });
  });

  it('eldobja az ugrást, de utána a valódi pályát folytatja', () => {
    const f = new FixFilter();
    f.check(fix(0, 0));
    f.check(fix(1, 30));
    expect(f.check(fix(2, 800))).toEqual({ ok: false, reason: 'ugras' });
    expect(f.check(fix(3, 90)).ok).toBe(true);
  });

  it('hosszú kiesés után a nagy elmozdulás nem ugrás', () => {
    const f = new FixFilter();
    f.check(fix(0, 0));
    expect(f.check(fix(60, 2000)).ok).toBe(true);
  });

  it('ha a kiinduló fix volt hibás, három konzisztens fix után átáll', () => {
    const f = new FixFilter();
    f.check(fix(0, 5000)); // hibás kezdés
    expect(f.check(fix(1, 0)).ok).toBe(false);
    expect(f.check(fix(2, 30)).ok).toBe(false);
    expect(f.check(fix(3, 60)).ok).toBe(true);
    expect(f.check(fix(4, 90)).ok).toBe(true);
  });

  it('érvénytelen koordináta', () => {
    expect(new FixFilter().check({ ...fix(0, 0), lat: NaN })).toEqual({ ok: false, reason: 'ervenytelen' });
  });
});
