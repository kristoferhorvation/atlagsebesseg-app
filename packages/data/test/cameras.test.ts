import { describe, expect, it } from 'vitest';
import { mergeCameras, osmCameraRow, parseDirection, parseVedaList, undoubleHeading, VEDA_MATCH_M } from '../src/cameras';
import type { OsmNode } from '../src/overpass';

// A Zsaru Magazin 2015/48 PDF-jének szövege (unpdf), rövidítve – a valódi írásmód-sajátosságokkal
const SAMPLE = `2015/48. ZSARU RENDÔRSÉGI MAGAZIN 21
K Ö Z L E K E D É S
BBuuddaappeesstt
Budapest belterület M5 2 + 156 47.441300278 19.134219264
Budapest belterület M1–M7 6+300 47.460440417 18.998485600
BBaarraannyyaa mmeeggyyee
Szigetvár külterület 6 229+282 46.048961025 17,828867650
Pécs belterület 6 193+738 46,085555232 18.270214808
BBááccss--KKiisskkuunn mmeeggyyee
Kiskõrös belterület 53 27+154 46.623623938 19.275880999
Apostag (Dunavecse) külterület 51 74+494 46.896493768 18.984557238
FFeejjéérr mmeeggyyee
Székesfehérvár gyorsforg. M7 bal 60+090 47.172825508 18.468576330
Székesfehérvár gyorsforg. M7 jobb 60+064 47.172966148 18.468850382
TTeelleeppüüllééss TTeelleeppííttééssii ÚÚtt-- KKiilloomméétteerrsszz.. GGPPSS--kkoooorrddiinnááttaa
A Belügyminisztérium, az Országos Rendõr-fõkapitányság
FOTÓ: SZABÓ`;

const node = (id: number, lat: number, lon: number, tags: Record<string, string> = { highway: 'speed_camera' }): OsmNode => ({
  type: 'node',
  id,
  lat,
  lon,
  tags,
});

describe('VÉDA 2015-ös lista', () => {
  it('duplázott betűs megyecím', () => {
    expect(undoubleHeading('BBaarraannyyaa mmeeggyyee')).toBe('Baranya megye');
    expect(undoubleHeading('BBaarraannyyaa  mmeeggyyee')).toBe('Baranya megye');
    expect(undoubleHeading('BBááccss--KKiisskkuunn mmeeggyyee')).toBe('Bács-Kiskun megye');
    expect(undoubleHeading('Tata belterület 1 64+250')).toBeNull();
  });

  it('sorok: megye, település, út, km, koordináta (vesszős tizedes, bal/jobb pálya, õ → ő)', () => {
    const pts = parseVedaList(SAMPLE);
    expect(pts).toHaveLength(8);
    expect(pts.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pts[0]).toMatchObject({ county: 'Budapest', settlement: 'Budapest', road: 'M5', km: '2+156', side: null });
    expect(pts[1]!.road).toBe('M1–M7');
    expect(pts[2]).toMatchObject({ county: 'Baranya', settlement: 'Szigetvár', placement: 'külterület', lon: 17.82886765 });
    expect(pts[3]!.lat).toBeCloseTo(46.085555232, 9);
    expect(pts[4]).toMatchObject({ county: 'Bács-Kiskun', settlement: 'Kiskőrös' });
    expect(pts[5]!.settlement).toBe('Apostag (Dunavecse)');
    expect(pts[6]).toMatchObject({ county: 'Fejér', placement: 'gyorsforg.', road: 'M7', side: 'bal', km: '60+090' });
    expect(pts[7]!.side).toBe('jobb');
  });

  it('a fejléc és a bevezető szöveg nem lesz pont', () => {
    expect(parseVedaList('Település Telepítési Út- Kilométersz.\nA közúti halálesetek 2015 47.1 19.1')).toEqual([]);
  });
});

describe('OSM-kamera', () => {
  it('irány fokban vagy égtájjal; a „forward” nem irány', () => {
    expect(parseDirection('270')).toBe(270);
    expect(parseDirection('360')).toBe(0);
    expect(parseDirection('NE')).toBe(45);
    expect(parseDirection('forward')).toBeNull();
    expect(parseDirection(undefined)).toBeNull();
  });

  it('sima sebességmérő, nem ellenőrzött, a határ a maxspeed-ből', () => {
    const r = osmCameraRow(node(42, 47.5, 19.05, { highway: 'speed_camera', maxspeed: '50', direction: '90' }), 'HU', '2026-10-28');
    expect(r).toMatchObject({ id: 'osm-node-42', type: 'speed', verified: false, speed_limit_kmh: 50, heading: 90, source: 'OpenStreetMap' });
    expect(r.source_url).toBe('https://www.openstreetmap.org/node/42');
  });
});

describe('egyesítés (VÉDA + OSM)', () => {
  const veda = parseVedaList(SAMPLE);
  const fehervarBal = veda[6]!;
  const pecs = veda[3]!;

  it('mindkettőben (≤ 300 m) → complex, ellenőrzött, a hivatalos koordinátával; az OSM-csomópont nem kerül be külön', () => {
    const near = node(1, fehervarBal.lat + 0.0005, fehervarBal.lon, { highway: 'speed_camera', maxspeed: '130', direction: '45' }); // ~56 m
    const m = mergeCameras([fehervarBal], [near], '2026-10-28');
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({ id: 'hu-veda-2015-007', type: 'complex', verified: true, road: 'M7', speed_limit_kmh: 130, heading: 45 });
    expect(m.rows[0]!.lat).toBeCloseTo(fehervarBal.lat, 6);
    expect(m.matches[0]!.distanceM).toBeGreaterThan(40);
    expect(m.skipped).toEqual([]);
  });

  it('csak a 2015-ös listában (> 300 m) → kimarad, listázva a legközelebbi távolsággal', () => {
    const far = node(2, pecs.lat + 0.004, pecs.lon); // ~445 m
    const m = mergeCameras([pecs], [far], '2026-10-28');
    expect(m.rows.map((r) => r.id)).toEqual(['osm-node-2']);
    expect(m.skipped).toHaveLength(1);
    expect(m.skipped[0]!.reason).toContain(`${VEDA_MATCH_M} m`);
    expect(m.skipped[0]!.nearestM).toBeGreaterThan(VEDA_MATCH_M);
  });

  it('csak OSM → speed, nem ellenőrzött', () => {
    const m = mergeCameras([], [node(3, 47, 19)], '2026-10-28');
    expect(m.rows[0]).toMatchObject({ type: 'speed', verified: false });
  });

  it('két pályatestes VÉDA-pont egy OSM-csomóponthoz: mindkettő ellenőrzött, az OSM nem duplázódik', () => {
    const one = node(4, fehervarBal.lat, fehervarBal.lon);
    const m = mergeCameras([veda[6]!, veda[7]!], [one], '2026-10-28');
    expect(m.rows.map((r) => r.type)).toEqual(['complex', 'complex']);
  });
});
