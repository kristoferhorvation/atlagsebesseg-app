import { describe, expect, it } from 'vitest';
import { NavigationSession, type NavView, type RouteFetcher } from '@atlagsebesseg/app-logic';
import { buildNavSim, simRouteFetcher, SIM_ALTS, type NavSimData, type SimAltMode } from './navSim';

const T0 = 1_800_000_000_000;

/**
 * A navigációs szimulátor lejátszása a munkamenettel, a `from` ablaktól: mérés a szimulált szakaszon (a pozíció a
 * kapui között), az alternatíva-figyelés válaszát a szimulátor adja a kért kategóriával.
 */
async function play(data: NavSimData, alt: SimAltMode, fromWindow: number, toWindow = fromWindow + 1) {
  const inner = simRouteFetcher(data, alt);
  const pending: Promise<unknown>[] = [];
  const fetchRoutes: RouteFetcher = (from, to, ctx) => {
    const p = inner(from, to, ctx);
    pending.push(p.catch(() => undefined));
    return p;
  };
  const samples = data.samples.slice(data.windows[fromWindow], data.windows[toWindow] ?? data.samples.length);
  let t = samples[0]!.t;
  const session = new NavigationSession(data.main, { name: 'Győr', ...data.main.points.at(-1)! }, { fetchRoutes, now: () => t });
  session.setData({ sections: [data.section], cameras: [data.camera], planned: [] });
  const views: { view: NavView; measuring: boolean }[] = [];
  const voice: string[] = [];
  for (const s of samples) {
    t = s.t;
    let v = s.dropped ? session.tick() : session.onFix(s.fix);
    const sec = v.enforcement.find((i) => i.kind === 'section');
    const measuring = !!sec && v.alongM >= sec.startM && v.alongM <= sec.endM;
    session.setMeasuring(measuring);
    if (pending.length) {
      await Promise.all(pending.splice(0));
      await new Promise((r) => setTimeout(r, 0));
    }
    v = session.view();
    views.push({ view: v, measuring });
    voice.push(...session.drainVoice().filter((x) => x.kind === 'faster').map((x) => x.text));
  }
  return { views, voice };
}

describe('navigációs szimulátor: gyorsabb út kategóriánként (AW12)', () => {
  const data = buildNavSim(T0);

  it('a szimulált alternatívák kategóriái: 7 perc / +4 km megéri, 3 perc / +5 km lehet, 10 perc / +40 km nem éri meg', () => {
    expect(SIM_ALTS.worth).toEqual({ gainS: 420, extraM: 4000 });
    expect(SIM_ALTS.maybe.gainS).toBeGreaterThanOrEqual(120);
  });

  for (const [mode, verdict, title] of [
    ['worth', 'worth', /^Megéri · −7 perc, \+4 km$/],
    ['maybe', 'maybe', /^Lehet · −3 perc, \+5 km$/],
    ['not', 'not', /^Nem éri meg · \+40 km kerülő, −10 perc$/],
  ] as const) {
    it(`?alt=${mode}: az 1. ablakban (mérésen kívül) „${verdict}” ajánlat, bemondással`, async () => {
      const { views, voice } = await play(data, mode, 0);
      const offer = views.find((x) => x.view.offer)?.view.offer;
      expect(offer?.verdict).toBe(verdict);
      expect(offer?.title).toMatch(title);
      expect(voice[0]).toMatch(/^Gyorsabb út/);
    });
  }

  it('?alt=aftergate (AW13): mérés közben a végkapu után 500 m-rel lehajtó alternatíva → azonnal, kompakt ajánlat bemondással', async () => {
    const { views, voice } = await play(data, 'aftergate', 1);
    const shown = views.find((x) => x.view.offer);
    expect(shown?.measuring).toBe(true);
    expect(shown?.view.offer?.compact).toBe(true);
    expect(shown?.view.offer?.verdict).toBe('worth');
    // a lehajtó a kapu után van: a kártyán a lehajtóig hátralévő táv nagyobb, mint a kapuig
    const sec = shown!.view.enforcement.find((i) => i.kind === 'section')!;
    expect(shown!.view.offer!.exitInM).toBeGreaterThan(sec.endM - shown!.view.alongM);
    expect(voice[0]).toMatch(/^Gyorsabb út, 7 perc megtakarítás, lehajtó \d+,\d kilométernél$/);
  });

  it('?alt=worth ugyanott: mérés közben a lehajtó a szakaszon belül → kompakt ajánlat', async () => {
    const { views } = await play(data, 'worth', 1);
    const shown = views.find((x) => x.view.offer);
    expect(shown?.measuring).toBe(true);
    expect(shown?.view.offer?.compact).toBe(true);
  });

  it('kamera-közeledés a 2. ablakban: a kamera max(250 m, 10 s × sebesség)-en belül borostyán, elhaladás után eltűnik', async () => {
    const { views } = await play(data, 'worth', 1);
    const near = views.filter((x) => x.view.cameraNear);
    expect(near.length).toBeGreaterThan(3);
    // ~120 km/h: 10 s × 33 m/s ≈ 330 m (a 250 m-es alsó határ fölött)
    expect(Math.max(...near.map((x) => x.view.cameraNear!.distanceM))).toBeGreaterThan(260);
    expect(Math.max(...near.map((x) => x.view.cameraNear!.distanceM))).toBeLessThan(370);
    const last = views.length - 1 - [...views].reverse().findIndex((x) => x.view.cameraNear);
    expect(views[last + 1]?.view.cameraNear ?? null).toBeNull();
  });
});
