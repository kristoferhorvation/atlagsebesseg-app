import { describe, expect, it } from 'vitest';
import { Route } from '../src/route';
import { loadRoute, loadSections } from './helpers/fixtures';
import { proj } from './helpers/trace';

describe('Route', () => {
  const { course: section } = loadSections();
  const fx = loadRoute();
  const route = new Route(section.geometry!, section.lengthM);

  it('a geometriai hossz egyezik a névlegessel (≈ 10 km)', () => {
    expect(route.lengthM).toBeCloseTo(10_000, -1);
    expect(route.geometricLengthM).toBeCloseTo(route.lengthM, 6);
  });

  it('a kezdőpont 0, a végpont a hossz', () => {
    expect(route.project(section.start).alongM).toBeCloseTo(0, 3);
    expect(route.project(section.end).alongM).toBeCloseTo(route.lengthM, 0);
  });

  it('a kezdőpont előtt negatív, a végpont után nagyobb a hossznál', () => {
    const before = route.project(proj.fromXY({ x: 0, y: -500 }));
    expect(before.alongM).toBeCloseTo(-500, 0);
    expect(before.crossM).toBeLessThan(1);
    const after = proj.toXY(section.end);
    expect(route.project(proj.fromXY({ x: after.x + 300, y: after.y })).alongM).toBeCloseTo(route.lengthM + 300, 0);
  });

  it('merőleges távolság a párhuzamos vonalon', () => {
    for (const p of fx.parallel120) {
      expect(route.project(p).crossM).toBeGreaterThan(115);
      expect(route.project(p).crossM).toBeLessThan(125);
    }
  });

  it('pointAt és project inverzek', () => {
    for (const s of [0, 1234, 5000, 7777, 9999]) {
      expect(route.project(route.pointAt(s)).alongM).toBeCloseTo(s, 0);
    }
  });

  it('névleges hosszra skáláz', () => {
    const pts = fx.line1000;
    const r = new Route(pts, 1100);
    expect(r.project(pts[pts.length - 1]!).alongM).toBeCloseTo(1100, 1);
    expect(r.project(proj.fromXY({ x: 0, y: 500 })).alongM).toBeCloseTo(550, 1);
  });

  it('a hint tartomány szűkíti a keresést (visszaforduló útnál a közelebbi ágat választja)', () => {
    // hajtűkanyar: fel 1000 m, majd vissza le 30 m-rel arrébb
    const r = new Route(fx.hairpin);
    const p = proj.fromXY({ x: 20, y: 500 }); // a visszatérő ághoz van közelebb
    expect(r.project(p).alongM).toBeGreaterThan(1000);
    expect(r.project(p, { fromM: 0, toM: 900 }).alongM).toBeCloseTo(500, 0);
  });

  it('legalább két különböző pont kell', () => {
    expect(() => new Route([section.start, section.start])).toThrow();
  });
});
