import { describe, expect, it } from 'vitest';
import { bearingDeg, haversineM, type GpsFix } from '@atlagsebesseg/core';
import { PositionSmoother } from '../src/positionSmoother';
import trace from '../src/fixtures/gps-trace-1hz.json';

const T0 = 1_800_000_000_000;
const FRAME_MS = 1000 / 60;

/** A nyomat GpsFix-ként: a sebesség és az irány a két szomszédos mintából (zajosabb, mint a CLLocation saját értékei). */
function fixes(raw: readonly (readonly number[])[]): GpsFix[] {
  return raw.map(([t, lat, lon], i) => {
    const prev = raw[i - 1];
    const a = prev ? { lat: prev[1]!, lon: prev[2]! } : null;
    const d = a ? haversineM(a, { lat: lat!, lon: lon! }) : 0;
    const dt = prev ? t! - prev[0]! : 1;
    return { lat: lat!, lon: lon!, timestamp: T0 + t! * 1000, speed: dt > 0 ? d / dt : 0, accuracy: 5, heading: a && d > 1 ? bearingDeg(a, { lat: lat!, lon: lon! }) : null };
  });
}

/** Visszajátszás 60 fps-sel: képkockánként a megjelenített helyzet. */
function replay(list: readonly GpsFix[], jitterMs = 0) {
  const s = new PositionSmoother();
  const frames: { t: number; lat: number; lon: number; v: number; bearing: number }[] = [];
  let i = 0;
  const end = list.at(-1)!.timestamp + 1000;
  for (let t = list[0]!.timestamp; t < end; t += FRAME_MS) {
    while (i < list.length && list[i]!.timestamp + (i % 2 ? jitterMs : 0) <= t) s.onFix(list[i++]!, t);
    const p = s.at(t);
    if (p) frames.push({ t, lat: p.lat, lon: p.lon, v: p.speedMps, bearing: p.bearing });
  }
  return frames;
}

const steps = (f: ReturnType<typeof replay>) => f.slice(1).map((x, i) => ({ d: haversineM(f[i]!, x), dt: x.t - f[i]!.t, v: x.v }));

describe('AW23: a jelölő egyenletes mozgása', () => {
  for (const tr of trace.traces) {
    it(`valódi 1 Hz-es nyomat (${tr.name}): egy képkockán belül nincs a várható elmozdulás kétszerését elérő ugrás`, () => {
      const list = fixes(tr.fixes);
      const st = steps(replay(list));
      for (const x of st) expect(x.d).toBeLessThanOrEqual(2 * (Math.max(x.v, 1) * x.dt) / 1000 + 1e-6);
      // a nyers fixek ugyanitt többet ugranának egy képkockán (a régi iOS-jelölő)
      const rawMax = Math.max(...list.slice(1).map((f, i) => haversineM(list[i]!, f)));
      expect(rawMax).toBeGreaterThan(5);
      expect(Math.max(...st.map((x) => x.d))).toBeLessThan(rawMax / 5);
    });

    it(`valódi 1 Hz-es nyomat (${tr.name}): ±150 ms-os érkezési ingadozásnál sincs ugrás, és a jelölő nem marad le a fixtől`, () => {
      const list = fixes(tr.fixes);
      const f = replay(list, 150);
      for (const x of steps(f)) expect(x.d).toBeLessThanOrEqual(2 * (Math.max(x.v, 1) * x.dt) / 1000 + 1e-6);
      for (const fix of list.slice(5)) {
        const at = f.find((x) => x.t >= fix.timestamp)!;
        expect(haversineM(at, fix)).toBeLessThan(40);
      }
    });
  }

  it('50 km/h, egyenes út, 1 Hz: képkockánként a várható elmozdulás körül, megállás nélkül', () => {
    const v = 50 / 3.6;
    const list: GpsFix[] = Array.from({ length: 60 }, (_, i) => ({ lat: 47.5, lon: 19 + (i * v) / (111_195 * Math.cos((47.5 * Math.PI) / 180)), timestamp: T0 + i * 1000, speed: v, accuracy: 5, heading: 90 }));
    const st = steps(replay(list)).slice(60);
    const expected = v / 60;
    for (const x of st.slice(0, -60)) {
      expect(x.d).toBeLessThan(2 * expected);
      expect(x.d).toBeGreaterThan(0.5 * expected);
    }
  });

  it('új fixnél nincs visszaugrás: fékezéskor sem megy hátra, állva a fixre áll', () => {
    const v = 50 / 3.6;
    const list: GpsFix[] = Array.from({ length: 20 }, (_, i) => {
      const stopped = i >= 10;
      return { lat: 47.5, lon: 19 + (Math.min(i, 10) * v) / (111_195 * Math.cos((47.5 * Math.PI) / 180)), timestamp: T0 + i * 1000, speed: stopped ? 0 : v, accuracy: 5, heading: 90 };
    });
    const f = replay(list);
    for (let i = 1; i < f.length; i++) {
      if (f[i]!.t > T0 + 10_000) break;
      expect(f[i]!.lon).toBeGreaterThanOrEqual(f[i - 1]!.lon);
    }
    expect(haversineM(f.at(-1)!, list.at(-1)!)).toBeLessThan(2);
  });

  it('GPS-kiesésnél legfeljebb 1,5 s-ot becsül előre, utána megáll; nagy eltérésnél (> 80 m) ugrik', () => {
    const s = new PositionSmoother();
    const a: GpsFix = { lat: 47.5, lon: 19, timestamp: T0, speed: 20, accuracy: 5, heading: 90 };
    s.onFix(a, 0);
    s.at(0);
    let p = s.at(0)!;
    for (let t = FRAME_MS; t < 10_000; t += FRAME_MS) p = s.at(t)!;
    expect(haversineM(p, a)).toBeLessThan(35);
    s.onFix({ ...a, lon: 19.01, timestamp: T0 + 11_000 }, 11_000);
    p = s.at(11_000 + FRAME_MS)!;
    expect(haversineM(p, { lat: 47.5, lon: 19.01 })).toBeLessThan(2);
  });

  it('álló GPS-zajnál (< 0,7 m/s) nincs előrebecslés, a jelölő legfeljebb 1 m/s-mal mozog', () => {
    const list: GpsFix[] = Array.from({ length: 30 }, (_, i) => ({ lat: 47.5 + (i % 2 ? 2e-5 : 0), lon: 19, timestamp: T0 + i * 1000, speed: 0, accuracy: 5, heading: null }));
    for (const x of steps(replay(list))) expect(x.d).toBeLessThanOrEqual((1 * x.dt) / 1000 + 1e-6);
  });

  it('szimulátor-óra: gyorsított lejátszásnál a fixek óráját követi, valós módban soha', () => {
    const v = 20;
    const mk = (i: number): GpsFix => ({ lat: 47.5, lon: 19 + (i * v) / (111_195 * Math.cos((47.5 * Math.PI) / 180)), timestamp: T0 + i * 1000, speed: v, accuracy: 5, heading: 90 });
    const sim = new PositionSmoother(true);
    const real = new PositionSmoother();
    let pSim = null;
    let pReal = null;
    // 12-szeres: 83 ms-onként egy fix
    for (let i = 0; i < 30; i++) {
      const now = i * 83;
      sim.onFix(mk(i), now);
      real.onFix(mk(i), now);
      for (let k = 0; k < 5; k++) {
        pSim = sim.at(now + k * 16);
        pReal = real.at(now + k * 16);
      }
    }
    expect(haversineM(pSim!, mk(29))).toBeLessThan(20);
    expect(haversineM(pReal!, mk(29))).toBeGreaterThan(50);
  });
});
