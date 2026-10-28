/**
 * Tervezett rendőrségi mérések (A7) – a police.hu szövegeinek feldolgozása, függőség nélkül
 * (Node és Deno is). A rendőrség 2018 óta nem közöl heti helyszínlistát; amit előre megnevez
 * (Speedmarathon, megyei akciók), az hírként jelenik meg a közlekedésrendészeti rovatban, a
 * helyszínek a cikk szövegében vagy PDF-mellékletben. Csak biztos adat: ami nem értelmezhető,
 * kimarad, és a hívó listázza.
 */

export const POLICE_BASE = 'https://www.police.hu';
/** A közlekedésrendészeti hírek listája (az egész ország, minden feltöltő szerv). */
export const POLICE_TRAFFIC_LISTING = `${POLICE_BASE}/hu/hirek-es-informaciok/legfrissebb-hireink/kozlekedesrendeszet`;

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', ndash: '–', mdash: '—' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tagek nélküli szöveg, a blokk-elemek határán sortöréssel. */
export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|div|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

export const clean = (s: string) => s.replace(/[ \s]+/g, ' ').trim();

export interface ListingItem {
  url: string;
  title: string;
  /** Megjelenés (helyi idő, ahogy az oldal adja: "2026-10-27 15:54"). */
  published: string;
  /** A feltöltő szerv, pl. „Fejér Megyei Rendőr-főkapitányság”. */
  source: string;
  lead: string;
}

/** A közlekedésrendészeti hírlista egy oldala. Üres lista = a szerkezet megváltozott (a hívó hibát jelez). */
export function parseListing(html: string): ListingItem[] {
  const out: ListingItem[] = [];
  for (const m of html.matchAll(/<article>([\s\S]*?)<\/article>/g)) {
    const a = m[1]!;
    const link = /<h1>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(a);
    const time = /<time datetime="([^"]+)"/.exec(a);
    if (!link || !time) continue;
    out.push({
      url: absUrl(link[1]!),
      title: clean(decodeEntities(link[2]!.replace(/<[^>]+>/g, ''))),
      published: time[1]!,
      source: clean(decodeEntities((/<span class="location"[^>]*>([\s\S]*?)<\/span>/.exec(a)?.[1] ?? '').replace(/<[^>]+>/g, ''))),
      lead: clean(decodeEntities((/<div class="lead-text">([\s\S]*?)<\/div>/.exec(a)?.[1] ?? '').replace(/<[^>]+>/g, ' '))),
    });
  }
  return out;
}

export interface Attachment {
  url: string;
  name: string;
}

export interface Article {
  url: string;
  title: string;
  /** "2026. 04. 14., k - 11:30" → "2026-04-14 11:30" */
  published: string | null;
  source: string;
  lead: string;
  body: string[];
  attachments: Attachment[];
}

export function parseArticle(html: string, url: string): Article {
  const art = /<article class="post"[\s\S]*?<\/article>/.exec(html)?.[0] ?? html;
  const title = clean(decodeEntities((/<h1>([\s\S]*?)<\/h1>/.exec(art)?.[1] ?? '').replace(/<[^>]+>/g, '')));
  const pub = /<div class="icon-update">\s*<span>\s*(\d{4})\. (\d{2})\. (\d{2})\.,[^-]*-\s*(\d{1,2}:\d{2})/.exec(art);
  const source = clean(decodeEntities((/<span class="location">([\s\S]*?)<\/span>/.exec(art)?.[1] ?? '').replace(/<[^>]+>/g, ' ')));
  const lead = htmlToLines(/<div class="lead-text">([\s\S]*?)<\/div>/.exec(art)?.[1] ?? '').join(' ');
  const bodyHtml = [...art.matchAll(/<div class="body-text ?">([\s\S]*?)<\/div>/g)].map((m) => m[1]!).join('\n');
  const attachments: Attachment[] = [];
  for (const m of art.matchAll(/<a href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = absUrl(m[1]!);
    if (!attachments.some((x) => x.url === u)) attachments.push({ url: u, name: clean(decodeEntities(m[2]!.replace(/<[^>]+>/g, ''))) });
  }
  return {
    url,
    title,
    published: pub ? `${pub[1]}-${pub[2]}-${pub[3]} ${pub[4]!.padStart(5, '0')}` : null,
    source,
    lead,
    body: htmlToLines(bodyHtml),
    attachments,
  };
}

const absUrl = (u: string) => (u.startsWith('http') ? u : `${POLICE_BASE}${u.startsWith('/') ? '' : '/'}${u}`);

/** Lehet-e benne előre megnevezett mérési helyszín (cím vagy bevezető alapján). */
export function isCandidate(title: string, lead: string): boolean {
  return /speedmarat|sebességmér|sebesség-?ellenőrz|sebességellenőrz|traffipax|ellenőrzési helyszín|mérési helyszín|helyszínei/i.test(`${title} ${lead}`);
}

// ---------------------------------------------------------------------------
// Megyék
// ---------------------------------------------------------------------------

/** A police.hu megyenevei (rövid alak) → az OSM admin_level=6 neve. */
export const COUNTIES: readonly { name: string; osm: string; alias?: RegExp }[] = [
  { name: 'Budapest', osm: 'Budapest', alias: /budapesti|\bbrfk\b|^budapest\b/i },
  { name: 'Bács-Kiskun', osm: 'Bács-Kiskun megye' },
  { name: 'Baranya', osm: 'Baranya megye' },
  { name: 'Békés', osm: 'Békés megye' },
  { name: 'Borsod-Abaúj-Zemplén', osm: 'Borsod-Abaúj-Zemplén megye' },
  { name: 'Csongrád-Csanád', osm: 'Csongrád-Csanád megye', alias: /csongrád/i },
  { name: 'Fejér', osm: 'Fejér megye' },
  { name: 'Győr-Moson-Sopron', osm: 'Győr-Moson-Sopron megye' },
  { name: 'Hajdú-Bihar', osm: 'Hajdú-Bihar megye' },
  { name: 'Heves', osm: 'Heves megye' },
  { name: 'Jász-Nagykun-Szolnok', osm: 'Jász-Nagykun-Szolnok megye' },
  { name: 'Komárom-Esztergom', osm: 'Komárom-Esztergom megye' },
  { name: 'Nógrád', osm: 'Nógrád megye' },
  { name: 'Pest', osm: 'Pest megye' },
  { name: 'Somogy', osm: 'Somogy megye' },
  { name: 'Szabolcs-Szatmár-Bereg', osm: 'Szabolcs-Szatmár-Bereg megye' },
  { name: 'Tolna', osm: 'Tolna megye' },
  { name: 'Vas', osm: 'Vas megye' },
  { name: 'Veszprém', osm: 'Veszprém megye' },
  { name: 'Zala', osm: 'Zala megye' },
];

/** Megye egy szövegből (feltöltő szerv, mellékletnév): „Fejér VMRFK helyszínek.pdf” → „Fejér”; ORFK → null. */
export function countyFromText(s: string): string | null {
  for (const c of COUNTIES) if (c.alias?.test(s)) return c.name;
  const sorted = [...COUNTIES].sort((a, b) => b.name.length - a.name.length);
  for (const c of sorted) {
    if (new RegExp(`(^|[^\\p{L}])${c.name}([^\\p{L}]|$)`, 'iu').test(s)) return c.name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Időszak
// ---------------------------------------------------------------------------

const MONTHS: [RegExp, number][] = [
  [/^jan/i, 1],
  [/^feb/i, 2],
  [/^márc/i, 3],
  [/^ápr/i, 4],
  [/^máj/i, 5],
  [/^jún/i, 6],
  [/^júl/i, 7],
  [/^aug/i, 8],
  [/^szep/i, 9],
  [/^okt/i, 10],
  [/^nov/i, 11],
  [/^dec/i, 12],
];
const MONTH_RE = '(január|február|március|április|május|június|július|augusztus|szeptember|október|november|december|jan\\.|febr?\\.|márc\\.|ápr\\.|máj\\.|jún\\.|júl\\.|aug\\.|szept?\\.|okt\\.|nov\\.|dec\\.)';
export const HU_MONTH_SHORT = ['jan', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];

const monthOf = (s: string) => MONTHS.find(([re]) => re.test(s))?.[1] ?? 0;

/** Budapesti helyi idő eltolása (óra) egy UTC-pillanatra: CEST március utolsó vasárnapjától október utolsó vasárnapjáig. */
export function budapestOffsetH(utc: Date): number {
  const y = utc.getUTCFullYear();
  const lastSunday = (m: number) => {
    const d = new Date(Date.UTC(y, m + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const t = utc.getTime();
  return t >= lastSunday(2) && t < lastSunday(9) ? 2 : 1;
}

/** Budapesti helyi idő → UTC. */
export function budapestToUtc(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  return new Date(guess.getTime() - budapestOffsetH(new Date(guess.getTime() - 3600_000)) * 3600_000);
}

export interface Period {
  /** Az akció kezdete (ha van óra, pontosan; különben az első nap 0:00-ja, helyi idő). */
  validFrom: Date;
  /** A közzétett hét vége: az utolsó nap hetének vasárnapja, 23:59:59 (helyi idő). */
  validTo: Date;
  /** A forrás pontos időszaka, ha órát is ad: „ápr 15. 6:00 – ápr 16. 6:00”. */
  timeWindow: string | null;
  /** Az első és az utolsó megnevezett nap (helyi dátum, "2026-04-15"). */
  firstDay: string;
  lastDay: string;
}

interface DayMention {
  y: number | null;
  m: number;
  d: number;
  hour: number | null;
  minute: number;
  at: number;
}

/**
 * Az akció időszaka a szövegből („2026. április 15. 6 óra és április 16. 6 óra között”,
 * „október 27. és november 2. között”, „április 13. és 19. között”). A lejárat a közzétett hét
 * vége. Ha nincs dátum, `null` (a cikk kimarad – találgatás nincs).
 */
export function parsePeriod(text: string, published: string | null): Period | null {
  const t = clean(text);
  const pubY = published ? Number(published.slice(0, 4)) : null;
  const pubM = published ? Number(published.slice(5, 7)) : null;
  const days: DayMention[] = [];
  const re = new RegExp(`(?:(\\d{4})\\.\\s*)?${MONTH_RE}\\s*(\\d{1,2})\\.?(?:-?[a-záéíóöőúüű]{1,6})?(?:\\s*(?:és|-|–|—)\\s*(\\d{1,2})\\.(?!\\d))?`, 'gi');
  for (const m of t.matchAll(re)) {
    const month = monthOf(m[2]!);
    if (!month) continue;
    const y = m[1] ? Number(m[1]) : null;
    days.push({ y, m: month, d: Number(m[3]), hour: hourAfter(t, m.index! + m[0].length), minute: 0, at: m.index! });
    if (m[4]) days.push({ y, m: month, d: Number(m[4]), hour: hourAfter(t, m.index! + m[0].length), minute: 0, at: m.index! + m[0].length });
  }
  const valid = days.filter((x) => x.d >= 1 && x.d <= 31);
  if (!valid.length) return null;
  const year = (x: DayMention) => {
    if (x.y) return x.y;
    if (pubY === null) return new Date().getUTCFullYear();
    // decemberi közlemény januári akcióról
    return pubM !== null && pubM - x.m > 6 ? pubY + 1 : pubY;
  };
  const first = valid[0]!;
  const last = valid[valid.length - 1]!;
  const fy = year(first);
  let ly = year(last);
  if (ly < fy || (ly === fy && (last.m < first.m || (last.m === first.m && last.d < first.d)))) ly = fy + (last.m < first.m ? 1 : 0);
  const from = budapestToUtc(fy, first.m, first.d, first.hour ?? 0, 0);
  // a hét vége: az utolsó nap hetének vasárnapja (hétfő az első nap)
  const lastLocal = new Date(Date.UTC(ly, last.m - 1, last.d));
  const toSunday = (7 - lastLocal.getUTCDay()) % 7;
  const sunday = new Date(lastLocal.getTime() + toSunday * 86400_000);
  const to = budapestToUtc(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate(), 23, 59, 59);
  const hasHours = first.hour !== null && (valid.length === 1 || last.hour !== null);
  const fmt = (x: DayMention, h: number | null) => `${HU_MONTH_SHORT[x.m - 1]} ${x.d}.${h !== null ? ` ${h}:00` : ''}`;
  const timeWindow = hasHours
    ? valid.length === 1 || (first.m === last.m && first.d === last.d)
      ? `${fmt(first, null)} ${first.hour}:00${last !== first && last.hour !== null ? `–${last.hour}:00` : ''}`
      : `${fmt(first, first.hour)} – ${fmt(last, last.hour)}`
    : null;
  const iso = (y: number, x: DayMention) => `${y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
  return { validFrom: from, validTo: to, timeWindow, firstDay: iso(fy, first), lastDay: iso(ly, last) };
}

/** „6 óra”, „reggel 6 órától”, „6:00-tól”, „22 óráig” a dátum után (legfeljebb ~20 karakteren belül). */
function hourAfter(t: string, from: number): number | null {
  const m = /^[\s,]*(?:reggel|este|délelőtt|délután|éjjel|hajnali|hajnal)?\s*(\d{1,2})(?:[.:](\d{2}))?\s*(?:óra|órától|óráig|-?tól|-?től|-?ig)/i.exec(t.slice(from, from + 24));
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 24 ? h : null;
}

// ---------------------------------------------------------------------------
// Helyszín-sorok
// ---------------------------------------------------------------------------

export type LineKind = 'street' | 'road' | 'junction' | 'road_km' | 'settlement_only' | 'unknown';

export interface KmRange {
  from: number;
  to: number;
}

export interface PlannedLine {
  /** A forrás sora szó szerint (normalizált szóközökkel). */
  raw: string;
  county: string;
  settlement: string | null;
  /** Budapesten a kerület („IV. kerület”). */
  district: string | null;
  kind: LineKind;
  /** Utcanevek kanonikus típusszóval („Petőfi S. utca”); kereszteződésnél kettő. */
  streets: string[];
  /** Útszám („6”, „M1”, „8123”). */
  road: string | null;
  km: KmRange[];
  /** „lakott területen belül/kívül” vagy házszám (→ belül); ismeretlen: null. */
  builtUp: boolean | null;
  /** Miért nem értelmezhető (ha `unknown` / `settlement_only`). */
  reason?: string;
}

/** Útszám a sorban: „6-os főút”, „8123-as út”, „11104-es számú út”, „38. sz. főút”, „M1 autópálya”, „5-ös számfú főút”. */
const ROAD_RE =
  /(?:^|[\s,(])(M\d{1,2}|\d{1,5})(?:\s*-\s*(?:as|es|ös|os|ás|s)\b|\.)?\s*(?:(?:sz\.|számú|számfú|sz)\s*)?(főútvonal|főút|autópálya|autóút|út)(?=$|[\s,.;:)])/i;

/** Utca-típusszavak (ragozott alakkal) → kanonikus alak. */
const STREET_TYPES: [RegExp, string][] = [
  [/^(utca|u\.?|utcá[nt]|utcánál|utcától|utcáig)$/i, 'utca'],
  [/^(út|úton|útnál|úttól|útig|utat)$/i, 'út'],
  [/^(útja|útján)$/i, 'útja'],
  [/^(körút|krt\.?|körúton)$/i, 'körút'],
  [/^(sugárút|sugárúton)$/i, 'sugárút'],
  [/^(tér|téren|tere|terén)$/i, 'tér'],
  [/^(köz|közben)$/i, 'köz'],
  [/^(sor|soron)$/i, 'sor'],
  [/^(fasor|fasoron)$/i, 'fasor'],
  [/^(sétány|sétányon)$/i, 'sétány'],
  [/^(rakpart|rakparton)$/i, 'rakpart'],
  [/^(lakótelep|ltp\.?)$/i, 'lakótelep'],
  [/^(dűlő|dűlőút)$/i, 'dűlő'],
  [/^(kapu)$/i, 'kapu'],
  [/^(major)$/i, 'major'],
  [/^(park)$/i, 'park'],
  [/^(lejtő)$/i, 'lejtő'],
  [/^(telep)$/i, 'telep'],
  [/^(határút)$/i, 'határút'],
];

function streetType(token: string): string | null {
  for (const [re, canon] of STREET_TYPES) if (re.test(token)) return canon;
  return null;
}

/** Az első utcanév a szövegben: a típusszóig tartó szavak + kanonikus típus; ha nincs, null. */
export function extractStreet(text: string): string | null {
  const tokens = text.replace(/,/g, ' ').split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const type = streetType(tokens[i]!);
    if (!type) continue;
    const name = tokens.slice(0, i);
    // a név nem lehet üres, és nem kezdődhet házszámmal (kivéve „4-es huszárok útja” típus)
    if (!name.length || (/^\d/.test(name[0]!) && !/^\d+-(?:as|es|ös|os|ás|s)$/.test(name[0]!))) return null;
    return [...name, type].join(' ');
  }
  return null;
}

/** Km-szelvények: „17+200”, „149,450 km”, „4 km 300 m”, „1 km + 030 msz.”, „67. km”, „17-20. km”. */
export function parseKm(text: string): KmRange[] {
  const out: KmRange[] = [];
  const t = text.replace(/(\d)\s+\+\s*(\d)/g, '$1+$2');
  for (const m of t.matchAll(/(\d{1,3})\+(\d{1,4})/g)) {
    const k = Number(m[1]) + Number(m[2]) / 1000;
    out.push({ from: k, to: k });
  }
  if (out.length) return out;
  let m = /(\d{1,3})[,.](\d{3})\s*km/.exec(t);
  if (m) return [{ from: Number(m[1]) + Number(m[2]) / 1000, to: Number(m[1]) + Number(m[2]) / 1000 }];
  m = /(\d{1,3})\s*km\s*\+?\s*(\d{1,3})\s*m/.exec(t);
  if (m) return [{ from: Number(m[1]) + Number(m[2]) / 1000, to: Number(m[1]) + Number(m[2]) / 1000 }];
  m = /(\d{1,3})\s*[-–]\s*(\d{1,3})\.?\s*km/.exec(t);
  if (m) return [{ from: Number(m[1]), to: Number(m[2]) }];
  m = /(\d{1,3})\.?\s*km/.exec(t);
  if (m) return [{ from: Number(m[1]), to: Number(m[1]) }];
  return [];
}

const ROMAN = /^(XXIII|XXII|XXI|XX|XIX|XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\.?$/;

/**
 * Egy helyszín-sor értelmezése. `settlements`: a megye településnevei (Budapesten: „Budapest”).
 * A település a sor elején álló leghosszabb ismert név; utána útszám (+ km), kereszteződés vagy utca.
 */
export function parseLocationLine(rawLine: string, county: string, settlements: readonly string[]): PlannedLine {
  let raw = clean(rawLine);
  const base: PlannedLine = { raw, county, settlement: null, district: null, kind: 'unknown', streets: [], road: null, km: [], builtUp: null };
  let rest = raw;
  if (/lakott területen (belül|kívül)\s*$/i.test(rest)) {
    base.builtUp = /belül\s*$/i.test(rest);
    rest = rest.replace(/,?\s*lakott területen (belül|kívül)\s*$/i, '');
  }
  // település (leghosszabb egyezés a sor elején)
  const lower = rest.toLowerCase();
  let settlement: string | null = null;
  let partOf = false;
  for (const s of settlements) {
    const sl = s.toLowerCase();
    const whole = lower === sl || lower.startsWith(`${sl} `) || lower.startsWith(`${sl},`);
    // „Ajka-Bakonygyepes”: a településrész a fő település része (az OSM-határon belül keresünk)
    const part = !whole && lower.startsWith(`${sl}-`) && /^\p{Lu}/u.test(rest.slice(s.length + 1));
    if ((whole || part) && (!settlement || s.length > settlement.length)) [settlement, partOf] = [s, part];
  }
  if (settlement) {
    rest = rest.slice(settlement.length);
    if (partOf) rest = rest.replace(/^-\S+/, '');
    rest = rest.replace(/^,?\s*/, '');
    // „Nyíregyháza Nyíregyháza, Kincs köz” – a településnév megismételve
    if (rest.toLowerCase().startsWith(settlement.toLowerCase())) rest = rest.slice(settlement.length).replace(/^,?\s*/, '');
    base.settlement = settlement;
    if (settlement === 'Budapest') {
      const d = ROMAN.exec(rest.split(' ')[0] ?? '');
      if (d) {
        base.district = `${d[1]}. kerület`;
        rest = rest.slice(rest.indexOf(' ') + 1).replace(/^ker(ület)?\.?\s*/i, '');
      }
    }
  }
  rest = rest.replace(/\(([^)]*)\)/g, ' ').replace(/\s+/g, ' ').trim();

  // kereszteződés: két rész kötőjellel
  if (/kereszteződés|krtsz\.?|csomópont/i.test(rest) && /\s[-–]\s/.test(rest)) {
    const parts = rest.replace(/\s*(kereszteződése|kereszteződésében|kereszteződés|krtsz\.?|csomópontja|csomópont)\b.*$/i, '').split(/\s+[-–]\s+/);
    const streets: string[] = [];
    let road: string | null = null;
    for (const p of parts.slice(0, 2)) {
      const r = ROAD_RE.exec(` ${p}`);
      if (r) road = r[1]!.toUpperCase();
      else {
        const name = p.replace(/\s+\d.*$/, '').trim();
        // „Ady E. - Ifjúság u.”: a típusszó a két ágon közös, az elsőről elmarad → bármely típus
        // (a helymeghatározás csak egyértelmű, egyetlen ilyen nevű utcát fogad el)
        const s = extractStreet(name) ?? (/^\p{Lu}[\p{L}. ]*$/u.test(name) ? `${name} *` : null);
        if (s) streets.push(s);
      }
    }
    if (streets.length + (road ? 1 : 0) === 2 && settlement) return { ...base, kind: 'junction', streets, road, builtUp: base.builtUp ?? true };
    return { ...base, kind: 'unknown', reason: 'a kereszteződés valamelyik ága nem értelmezhető (nincs utca-típusszó vagy település)' };
  }

  const road = ROAD_RE.exec(` ${rest}`);
  if (road) {
    const ref = road[1]!.toUpperCase();
    const km = parseKm(rest.slice(road.index + road[0].length));
    if (settlement) return { ...base, kind: 'road', road: ref, km };
    if (km.length) return { ...base, kind: 'road_km', road: ref, km };
    return { ...base, kind: 'unknown', road: ref, reason: 'útszám település és km-szelvény nélkül' };
  }
  if (!settlement) return { ...base, kind: 'unknown', reason: 'ismeretlen település (a megye településlistájában nincs ilyen név a sor elején)' };
  const street = extractStreet(rest);
  if (street) {
    const houseNumber = /\d/.test(rest.slice(rest.toLowerCase().indexOf(street.split(' ').pop()!.toLowerCase())));
    return { ...base, kind: 'street', streets: [street], builtUp: base.builtUp ?? (houseNumber ? true : null) };
  }
  return { ...base, kind: 'settlement_only', reason: 'csak település, útszám vagy utca nélkül' };
}

/** Fejléc- és láblécsorok a helyszín-táblázatokban (nem helyszín). */
export function isHeaderLine(line: string): boolean {
  return /^(település\b|területi rendőri szerv|speedmarathon|=== oldal|.*\bhelyszínek?\s*$|.*VMRFK\s*$|Budapesti Rendőr-főkapitányság$)/i.test(line.trim());
}

// ---------------------------------------------------------------------------
// OSM-név egyezés
// ---------------------------------------------------------------------------

const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((t) => streetType(t) ?? streetType(`${t}.`) ?? t);

/**
 * Az OSM-utcanév egyezik-e a forrás utcanevével: szavanként azonos, vagy a forrás rövidítése
 * (egy betű / „Zs.”) a teljes szó eleje; a típusszó (utca, út, tér…) is egyezzen.
 * „Petőfi S. utca” ~ „Petőfi Sándor utca”, „Bajcsy Zs. út” ~ „Bajcsy-Zsilinszky út”.
 */
export function streetMatches(query: string, osmName: string): boolean {
  const q = tokens(query);
  const o = tokens(osmName);
  // „Ady E. *”: típusszó nélküli ág – az OSM-név utolsó szava bármely utca-típus lehet
  if (q[q.length - 1] === '*') {
    if (!streetType(o[o.length - 1] ?? '')) return false;
    q[q.length - 1] = o[o.length - 1]!;
  }
  if (q.length !== o.length) return false;
  return q.every((t, i) => t === o[i] || (t.length <= 3 && /^\p{L}+$/u.test(t) && o[i]!.startsWith(t) && query.toLowerCase().includes(`${t}.`)));
}

/**
 * Lazább egyezés (második lépcső, csak ha szigorú nincs): a forrás szavai sorrendben benne vannak
 * az OSM-névben, az első szó és a típusszó azonos, legfeljebb egy szó hiányzik a forrásból
 * („Kossuth utca” ~ „Kossuth Lajos utca”). A hívó csak egyértelmű (egyetlen nevű) találatot fogad el.
 */
export function streetMatchesLoose(query: string, osmName: string): boolean {
  const q = tokens(query);
  const o = tokens(osmName);
  if (q[q.length - 1] === '*' || o.length !== q.length + 1) return false;
  if (q[0] !== o[0] || q[q.length - 1] !== o[o.length - 1]) return false;
  let j = 0;
  for (const t of o) if (j < q.length && t === q[j]) j++;
  return j === q.length;
}
