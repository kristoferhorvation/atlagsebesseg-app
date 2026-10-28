import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  budapestToUtc,
  countyFromText,
  extractStreet,
  isCandidate,
  parseArticle,
  parseKm,
  parseListing,
  parseLocationLine,
  parsePeriod,
  streetMatches,
  streetMatchesLoose,
} from '../src/planned/parse';

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures', 'police', f), 'utf8');
const FEJER = ['Székesfehérvár', 'Sárkeszi', 'Kőszárhegy', 'Tác', 'Daruszentmiklós', 'Kápolnásnyék', 'Baracs', 'Rácalmás'];

describe('police.hu hírlista (mintaoldal)', () => {
  it('cím, link, dátum, feltöltő szerv, bevezető', () => {
    const items = parseListing(fx('listing.html'));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      url: 'https://www.police.hu/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet/kozlekedesrendeszeti-hirek-bacs-138',
      title: 'Közlekedésrendészeti hírek Bács-Kiskunból',
      published: '2026-10-27 15:54',
      source: 'Bács-Kiskun Megyei Rendőr-főkapitányság',
    });
    expect(items[0]!.lead).toContain('Fokozott rendőri jelenléttel');
  });

  it('megváltozott szerkezet → üres lista (a futás erre hibát dob)', () => {
    expect(parseListing('<html><body><div class="news">…</div></body></html>')).toEqual([]);
  });

  it('jelölt: sebességmérés / Speedmarathon / helyszínek; egyéb közlekedési hír nem', () => {
    expect(isCandidate('Speedmarathon helyszínek 2026', '')).toBe(true);
    expect(isCandidate('Sebességellenőrzés a jövő héten', '')).toBe(true);
    expect(isCandidate('Közlekedésrendészeti hírek Bács-Kiskunból', 'Fokozott rendőri jelenléttel')).toBe(false);
  });
});

describe('police.hu cikk (Speedmarathon 2026 mintaoldal)', () => {
  const a = parseArticle(fx('speedmarathon-2026.html'), 'https://www.police.hu/x');

  it('cím, megjelenés, forrás, törzs, 20 PDF-melléklet', () => {
    expect(a.title).toBe('Speedmarathon helyszínek 2026');
    expect(a.published).toBe('2026-04-14 11:30');
    expect(a.source).toBe('ORFK Kommunikációs Szolgálat');
    expect(a.body.join(' ')).toContain('2026. április 15. 6 óra és április 16. 6 óra között');
    expect(a.attachments).toHaveLength(20);
    expect(a.attachments[0]).toEqual({
      url: 'https://www.police.hu/sites/default/files/Baranya%20VMRFK%20helysz%C3%ADnek.pdf',
      name: 'Baranya VMRFK helyszínek.pdf',
    });
  });

  it('időszak: pontos órák, a lejárat a hét vége (vasárnap 23:59:59, budapesti idő)', () => {
    const p = parsePeriod(a.body.join(' '), a.published)!;
    expect(p.firstDay).toBe('2026-04-15');
    expect(p.lastDay).toBe('2026-04-16');
    expect(p.validFrom.toISOString()).toBe('2026-04-15T04:00:00.000Z'); // 6:00 CEST
    expect(p.validTo.toISOString()).toBe('2026-04-19T21:59:59.000Z'); // vasárnap 23:59:59 CEST
    expect(p.timeWindow).toBe('ápr 15. 6:00 – ápr 16. 6:00');
  });
});

describe('időszak', () => {
  it('„október 27. és november 2. között” – hét, óra nélkül', () => {
    const p = parsePeriod('A rendőrség október 27. és november 2. között ellenőriz.', '2026-10-24 10:00')!;
    expect([p.firstDay, p.lastDay]).toEqual(['2026-10-27', '2026-11-02']);
    expect(p.timeWindow).toBeNull();
    expect(p.validTo.toISOString()).toBe('2026-11-08T22:59:59.000Z'); // nov. 2. hétfő → a hét vasárnapja, már CET
  });

  it('„április 13. és 19. között” – a második nap hónap nélkül', () => {
    const p = parsePeriod('április 13. és 19. között Magyarország egész területén', '2026-04-10 09:00')!;
    expect([p.firstDay, p.lastDay]).toEqual(['2026-04-13', '2026-04-19']);
  });

  it('decemberi közlemény januári akcióról → következő év', () => {
    expect(parsePeriod('január 5-én 8 órától 20 óráig', '2026-12-30 10:00')!.firstDay).toBe('2027-01-05');
  });

  it('dátum nélkül nincs időszak (a cikk kimarad, nincs találgatás)', () => {
    expect(parsePeriod('A rendőrség a jövőben is rendszeresen ellenőriz.', '2026-10-24 10:00')).toBeNull();
  });

  it('budapesti idő → UTC (téli és nyári idő)', () => {
    expect(budapestToUtc(2026, 1, 10, 6).toISOString()).toBe('2026-01-10T05:00:00.000Z');
    expect(budapestToUtc(2026, 7, 10, 6).toISOString()).toBe('2026-07-10T04:00:00.000Z');
  });
});

describe('megye', () => {
  it('mellékletnév, feltöltő szerv; Budapest ≠ Pest; ORFK → nincs', () => {
    expect(countyFromText('Fejér VMRFK helyszínek.pdf')).toBe('Fejér');
    expect(countyFromText('Budapesti Rendőr-főkapitányság helyszínek.pdf')).toBe('Budapest');
    expect(countyFromText('Pest VMRFK helyszínek.pdf')).toBe('Pest');
    expect(countyFromText('Csongrád Megyei Rendőr-főkapitányság')).toBe('Csongrád-Csanád');
    expect(countyFromText('Győr-Moson-Sopron helyszínek.pdf')).toBe('Győr-Moson-Sopron');
    expect(countyFromText('ORFK Kommunikációs Szolgálat')).toBeNull();
  });
});

describe('helyszín-sorok (Speedmarathon 2026 PDF-szövegek)', () => {
  it('település + utca + házszám → utca, lakott területen belül', () => {
    const l = parseLocationLine('Székesfehérvár Palotai út 156.', 'Fejér', FEJER);
    expect(l).toMatchObject({ kind: 'street', settlement: 'Székesfehérvár', streets: ['Palotai út'], builtUp: true });
  });

  it('rövidítések: „Kőszárhegy Fő u. 112.” → Fő utca', () => {
    expect(parseLocationLine('Kőszárhegy Fő u. 112.', 'Fejér', FEJER).streets).toEqual(['Fő utca']);
  });

  it('kereszteződés két utcával; utca és útszám', () => {
    expect(parseLocationLine('Tác Ady E. - Ifjúság u. kereszteződése', 'Fejér', FEJER)).toMatchObject({
      kind: 'junction',
      streets: ['Ady E. *', 'Ifjúság utca'],
    });
    expect(parseLocationLine('Kápolnásnyék Kazinczy F. u. - 8117-es út kereszteződése', 'Fejér', FEJER)).toMatchObject({
      kind: 'junction',
      streets: ['Kazinczy F. utca'],
      road: '8117',
    });
  });

  it('kereszteződés: a típusszó nélküli ág bármely típusú (egyértelmű) utca; szám nélküli rész nem ág', () => {
    expect(parseLocationLine('Baracs Liget - Remény sor kereszteződése', 'Fejér', FEJER)).toMatchObject({ kind: 'junction', streets: ['Liget *', 'Remény sor'] });
    expect(parseLocationLine('Rácalmás 6-os - 1234 kereszteződése', 'Fejér', FEJER).kind).toBe('unknown');
  });

  it('útszám + km település nélkül → road_km; km-írásmódok', () => {
    expect(parseLocationLine('7-es főút 89+730 km-szelvény', 'Fejér', FEJER)).toMatchObject({ kind: 'road_km', road: '7', km: [{ from: 89.73, to: 89.73 }] });
    expect(parseLocationLine('8-as főút 17-20. km-szelvény', 'Fejér', FEJER).km).toEqual([{ from: 17, to: 20 }]);
    expect(parseLocationLine('6-os főút 67. km-szelvény', 'Fejér', FEJER).km).toEqual([{ from: 67, to: 67 }]);
    expect(parseLocationLine('3. sz. főút 3. sz. főút 149,450 km', 'Borsod-Abaúj-Zemplén', []).km).toEqual([{ from: 149.45, to: 149.45 }]);
    expect(parseKm('27. sz. főút, 4 km 300 m')).toEqual([{ from: 4.3, to: 4.3 }]);
    expect(parseKm('1 km + 030 msz.')).toEqual([{ from: 1.03, to: 1.03 }]);
    expect(parseKm('10+300 km.sz., 16+932 km.sz.')).toEqual([
      { from: 10.3, to: 10.3 },
      { from: 16.932, to: 16.932 },
    ]);
  });

  it('település + útszám → az út a településen (a km nem kell)', () => {
    expect(parseLocationLine('Szekszárd 6-os számú főút 139+000 kmsz', 'Tolna', ['Szekszárd'])).toMatchObject({ kind: 'road', settlement: 'Szekszárd', road: '6' });
    expect(parseLocationLine('Budaörs, M1 autópálya', 'Pest', ['Budaörs'])).toMatchObject({ kind: 'road', road: 'M1' });
  });

  it('csak település → kimarad (settlement_only)', () => {
    const l = parseLocationLine('Ceglédbercel belterülete álló-mozgó ellenőrzés', 'Pest', ['Ceglédbercel']);
    expect(l.kind).toBe('settlement_only');
  });

  it('ismeretlen település → kimarad okkal', () => {
    const l = parseLocationLine('Dusnokpuszta Fő utca 3.', 'Borsod-Abaúj-Zemplén', ['Miskolc']);
    expect(l.kind).toBe('unknown');
    expect(l.reason).toContain('ismeretlen település');
  });

  it('Budapest: kerület; ragozott utcanév („úton … 50 méterre”)', () => {
    expect(parseLocationLine('Budapest IV. Váci út 198.', 'Budapest', ['Budapest'])).toMatchObject({ kind: 'street', district: 'IV. kerület', streets: ['Váci út'] });
    expect(parseLocationLine('Budapest XXIII. Szentlőrinci úton M5 kihajtótól 50 méterre', 'Budapest', ['Budapest'])).toMatchObject({
      district: 'XXIII. kerület',
      streets: ['Szentlőrinci út'],
    });
    expect(parseLocationLine('Budapest VIII. II. János Pál pápa tér 13.', 'Budapest', ['Budapest']).streets).toEqual(['II. János Pál pápa tér']);
  });

  it('településrész („Ajka-Bakonygyepes”) → a fő település; több település kötőjellel nem utca', () => {
    expect(parseLocationLine('Ajka-Bakonygyepes Fő út 88.', 'Veszprém', ['Ajka'])).toMatchObject({ kind: 'street', settlement: 'Ajka', streets: ['Fő út'] });
    expect(parseLocationLine('Ajka-Bakonygyepes 8-as főút 83 km.+160 m.', 'Veszprém', ['Ajka'])).toMatchObject({ kind: 'road', settlement: 'Ajka', road: '8' });
    expect(parseLocationLine('Barcs-Szulok-Homokszentgyörgy-Lad', 'Somogy', ['Barcs']).kind).toBe('settlement_only');
    // a teljes, kötőjeles településnév előnyt élvez
    expect(parseLocationLine('Szendehely-Katalinpuszta Fő u. 1.', 'Nógrád', ['Szendehely', 'Szendehely-Katalinpuszta']).settlement).toBe('Szendehely-Katalinpuszta');
  });

  it('„lakott területen belül” utótag; ismételt településnév', () => {
    expect(parseLocationLine('Nyíregyháza Nyíregyháza, Kincs köz lakott területen belül', 'Szabolcs-Szatmár-Bereg', ['Nyíregyháza'])).toMatchObject({
      kind: 'street',
      streets: ['Kincs köz'],
      builtUp: true,
    });
  });

  it('a teljes fejéri lista: minden sor besorolva, a táblázat-fejléc nem helyszín', () => {
    const lines = fx('sm2026-fejer.txt').split('\n').filter(Boolean).slice(1);
    const kinds = lines.map((l) => parseLocationLine(l, 'Fejér', FEJER).kind);
    expect(kinds.filter((k) => k === 'road_km').length).toBeGreaterThanOrEqual(15);
    expect(kinds.filter((k) => k === 'street').length).toBeGreaterThanOrEqual(5);
  });
});

describe('utcanév-egyezés (OSM)', () => {
  it('rövidített keresztnév, kötőjel, típusszó', () => {
    expect(streetMatches('Petőfi S. utca', 'Petőfi Sándor utca')).toBe(true);
    expect(streetMatches('Bajcsy Zs. út', 'Bajcsy-Zsilinszky út')).toBe(true);
    expect(streetMatches('Fő utca', 'Fő utca')).toBe(true);
    expect(streetMatches('Fő utca', 'Fő út')).toBe(false);
    expect(streetMatches('Petőfi S. utca', 'Petőfi Sándor tér')).toBe(false);
    expect(streetMatches('Palotai út', 'Palotai út szervizút')).toBe(false);
    // rövidítés pont nélkül nem rövidítés (a „Vörösmart út” elírás nem lesz Vörösmarty)
    expect(streetMatches('Vörösmart út', 'Vörösmarty út')).toBe(false);
    // típusszó nélküli kereszteződés-ág
    expect(streetMatches('Ady E. *', 'Ady Endre utca')).toBe(true);
    expect(streetMatches('Liget *', 'Liget sor')).toBe(true);
    expect(streetMatches('Liget *', 'Liget')).toBe(false);
  });

  it('lazább egyezés (második lépcső): egy elhagyott szó, azonos első szó és típus', () => {
    expect(streetMatchesLoose('Kossuth utca', 'Kossuth Lajos utca')).toBe(true);
    expect(streetMatchesLoose('Kossuth utca', 'Kossuth Lajos út')).toBe(false);
    expect(streetMatchesLoose('Kossuth utca', 'Ifjabb Kossuth utca')).toBe(false);
    expect(streetMatchesLoose('Kossuth utca', 'Kossuth Lajos Ferenc utca')).toBe(false);
  });

  it('utcanév kinyerése', () => {
    expect(extractStreet('Weiss Manfréd utca Szikratávíró utcánál')).toBe('Weiss Manfréd utca');
    expect(extractStreet('4-es huszárok útja')).toBe('4-es huszárok útja');
    expect(extractStreet('belterülete álló-mozgó ellenőrzés')).toBeNull();
  });
});
