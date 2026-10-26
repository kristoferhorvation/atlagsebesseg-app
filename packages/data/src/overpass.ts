/** Az Overpass API JSON-válaszának a számunkra fontos része. */
export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  /** `out geom` esetén a `nodes`-szal párhuzamos koordináták. */
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members: OsmRelationMember[];
  tags?: Record<string, string>;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OverpassResponse {
  elements: OsmElement[];
}

export const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Az adott ország összes `enforcement=average_speed` relációja a tag-nodokkal együtt. */
export function relationsQuery(countryIso: string): string {
  return `[out:json][timeout:300];
area["ISO3166-1"="${countryIso}"][admin_level=2]->.c;
relation["type"="enforcement"]["enforcement"="average_speed"](area.c)->.r;
.r out body;
node(r.r);
out body;`;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** A szakasz körüli autópálya/főút-hálózat geometriával (a pályatest kiválasztásához). */
export function roadsQuery(b: BBox): string {
  const bbox = [b.south, b.west, b.north, b.east].map((x) => x.toFixed(6)).join(',');
  return `[out:json][timeout:120];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link)$"](${bbox});
out body geom;`;
}

export interface FetchOptions {
  endpoint?: string;
  retries?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Az első újrapróbálás előtti várakozás (ms), utána duplázódik. */
  backoffMs?: number;
}

/** Overpass-lekérdezés újrapróbálással (429/504 esetén exponenciális várakozás). */
export async function runOverpass(query: string, opts: FetchOptions = {}): Promise<OverpassResponse> {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const retries = opts.retries ?? 4;
  const doFetch = opts.fetchImpl ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': opts.userAgent ?? 'atlagsebesseg-app-import/0.1 (+https://github.com/)',
        },
        body: new URLSearchParams({ data: query }).toString(),
      });
      if (res.ok) return (await res.json()) as OverpassResponse;
      lastError = new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = e;
    }
    if (attempt < retries) await sleep((opts.backoffMs ?? 2000) * 2 ** attempt);
  }
  throw lastError;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
