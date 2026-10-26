import { describe, expect, it } from 'vitest';
import { sunPhase, sunPosition, sunTimes } from '../src/sun';

const utc = (s: string) => Date.parse(s);
const minutesApart = (a: number | null, b: number) => Math.abs((a ?? NaN) - b) / 60_000;

// Referencia: csillagászati táblázatok (timeanddate.com), percre kerekítve, UTC-ben.
describe('sunTimes', () => {
  it('Budapest, nyári napforduló: napkelte 02:46, napnyugta 18:45 UTC', () => {
    const t = sunTimes(utc('2026-06-21T10:00:00Z'), 47.4979, 19.0402);
    expect(minutesApart(t.sunrise, utc('2026-06-21T02:46:00Z'))).toBeLessThan(3);
    expect(minutesApart(t.sunset, utc('2026-06-21T18:45:00Z'))).toBeLessThan(3);
    expect(t.civilDawn!).toBeLessThan(t.sunrise!);
    expect(t.civilDusk!).toBeGreaterThan(t.sunset!);
  });

  it('Róma, téli napforduló: napkelte 06:34, napnyugta 15:42 UTC', () => {
    const t = sunTimes(utc('2026-12-21T12:00:00Z'), 41.9028, 12.4964);
    expect(minutesApart(t.sunrise, utc('2026-12-21T06:34:00Z'))).toBeLessThan(3);
    expect(minutesApart(t.sunset, utc('2026-12-21T15:42:00Z'))).toBeLessThan(3);
  });

  it('sarki nappal (Tromsø, június): nincs napkelte/napnyugta', () => {
    const t = sunTimes(utc('2026-06-21T12:00:00Z'), 69.6492, 18.9553);
    expect(t.sunrise).toBeNull();
    expect(t.sunset).toBeNull();
  });
});

describe('sunPosition / sunPhase', () => {
  const bp = { lat: 47.4979, lon: 19.0402 };

  it('napkeltekor a magasság ≈ −0,83°', () => {
    const t = sunTimes(utc('2026-03-20T10:00:00Z'), bp.lat, bp.lon);
    expect(sunPosition(t.sunrise!, bp.lat, bp.lon).altitudeDeg).toBeCloseTo(-0.833, 0);
  });

  it('napszakok Budapesten egy nyári napon', () => {
    const at = (iso: string) => sunPhase(utc(iso), bp.lat, bp.lon);
    expect(at('2026-06-21T10:00:00Z')).toBe('nappal');
    expect(at('2026-06-21T23:30:00Z')).toBe('ejszaka');
    expect(at('2026-06-21T02:40:00Z')).toBe('hajnal');
    expect(at('2026-06-21T18:55:00Z')).toBe('alkony');
  });

  it('éjféli nap (Tromsø): a nap fent van, nem éjszaka (alacsony nap → hajnal/alkony)', () => {
    const t = utc('2026-06-21T23:00:00Z');
    expect(sunPosition(t, 69.6492, 18.9553).altitudeDeg).toBeGreaterThan(0);
    expect(sunPhase(t, 69.6492, 18.9553)).not.toBe('ejszaka');
    expect(sunPhase(utc('2026-06-21T10:00:00Z'), 69.6492, 18.9553)).toBe('nappal');
  });
});
