/**
 * A hivatalos importok közös környezete: gyorsítótáras letöltés (cache/, nem kerül a repóba),
 * gyorsítótáras Overpass, és az országmodulok közös eredmény-formája.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Section } from '@atlagsebesseg/core';
import type { OfficialItem, OfficialSkip } from '../../src/official';
import type { OfficialSummary } from '../../src/output';
import { DEFAULT_ENDPOINT, runOverpass, sleep, type OverpassResponse } from '../../src/overpass';

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = join(here, '..', '..', 'cache');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 atlagsebesseg-import';

export interface ImportContext {
  /** Letöltés a `cache/<cc>/<file>` gyorsítótárral; `--refresh` esetén újra letölti. */
  fetchText(url: string, file: string, init?: RequestInit & { encoding?: 'utf8' | 'latin1' }): Promise<string>;
  /** Overpass-lekérdezés gyorsítótárral (a lekérdezés hash-e szerint). */
  overpass(query: string): Promise<OverpassResponse>;
  log(msg: string): void;
}

/** Egy ország hivatalos listája, helyhez kötött tételekre bontva. */
export interface CountryLoad {
  sources: OfficialSummary['sources'];
  /** A hivatalos listán szereplő tételek (irányonként). */
  listed: number;
  items: OfficialItem[];
  /** Már a helymeghatározásnál kimaradt tételek, okkal. */
  skipped: OfficialSkip[];
  /** A kapuk legfeljebb ennyire lehetnek az úttól (km-szelvényből számolt helynél nagyobb). */
  snapRadiusM?: number;
  /** Mellékutak (secondary/tertiary) is kellenek az úthálózatba. */
  minorRoads?: boolean;
  /** Meglévő (OSM) szakaszok, amelyek a fájlban maradnak (Ausztria). */
  keep?: Section[];
  /** A hivatalos listával egyezőnek talált tételek száma, ha nem az `items`-ből jön (Ausztria). */
  included?: number;
  /** Tételenkénti megjegyzések a helymeghatározásról (a bekerültekhez a kimenetbe kerülnek). */
  notes?: { id: string; note: string }[];
}

export type CountryImporter = (ctx: ImportContext) => Promise<CountryLoad>;

export function createContext(cc: string, opts: { refresh: boolean; endpoint?: string; delayMs: number }): ImportContext {
  const dir = join(CACHE_DIR, cc.toLowerCase());
  const opDir = join(CACHE_DIR, 'overpass');
  let lastOverpass = 0;
  return {
    async fetchText(url, file, init = {}) {
      const path = join(dir, file);
      if (!opts.refresh && existsSync(path)) return readFile(path, init.encoding ?? 'utf8');
      await mkdir(dirname(path), { recursive: true });
      const { encoding, ...req } = init;
      const res = await fetch(url, { ...req, headers: { 'User-Agent': UA, ...(req.headers ?? {}) } });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(path, buf);
      return buf.toString(encoding ?? 'utf8');
    },
    async overpass(query) {
      const path = join(opDir, `${createHash('sha1').update(query).digest('hex')}.json`);
      if (existsSync(path)) return JSON.parse(await readFile(path, 'utf8')) as OverpassResponse;
      await mkdir(opDir, { recursive: true });
      const wait = lastOverpass + opts.delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      // a nyilvános Overpass terhelés alatt 502/504-et ad: több, hosszabb várakozású próbálkozás
      const res = await runOverpass(query, { endpoint: opts.endpoint ?? DEFAULT_ENDPOINT, retries: 7, backoffMs: 5000 });
      lastOverpass = Date.now();
      await writeFile(path, JSON.stringify(res));
      return res;
    },
    log: (msg) => console.log(`[${cc}] ${msg}`),
  };
}
