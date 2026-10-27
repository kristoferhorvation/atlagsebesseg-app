import { REPORT_CHOICES, type ReportInsert, type ReportType } from './reports';
import { TILE_DEG, tileBBox, tilesAround, type BBox } from './sectionCache';
import type { ReportRow } from './supabase';

/** Egy le nem járt bejelentés a térképen. */
export interface ActiveReport {
  id: string;
  type: ReportType;
  gateKind: 'kezdo' | 'zaro' | null;
  lat: number;
  lon: number;
  headingDeg: number | null;
  createdAt: number;
  expiresAt: number;
  confirmations: number;
  denials: number;
  /** A saját bejelentés (erre nem lehet szavazni – RLS). */
  own: boolean;
}

/** Frissítés ennyi időnként, akkor is, ha a nézet nem mozdult. */
export const REPORT_REFRESH_MS = 60_000;
/** A szerver alapértelmezett élettartama (`reports.expires_at`) – a saját, még le nem kért soroknál. */
export const REPORT_TTL_MS = 2 * 3600_000;
/** Ennél nagyobb (kizoomolt) nézetnél a középpont körüli 3 × 3 csempe. */
export const MAX_REPORT_TILE_SPAN = 3;

export interface ReportQuery {
  /** Csempe-rácsra kerekített téglalap kulcsa: ha nem változik, nincs új lekérés (csak 60 s-enként). */
  key: string;
  bbox: BBox;
}

function tileRange(y0: number, x0: number, y1: number, x1: number): ReportQuery {
  const a = tileBBox(`${y0}:${x0}`);
  const b = tileBBox(`${y1}:${x1}`);
  return { key: `${y0}:${x0}:${y1}:${x1}`, bbox: { south: a.south, west: a.west, north: b.north, east: b.east } };
}

/**
 * A lekérés téglalapja, a szakaszokéhoz hasonlóan csempékben: a látható terület a csempe-rácsra
 * kifelé kerekítve (kizoomolva legfeljebb 3 × 3 csempe a nézet közepén); térkép nélkül a pont
 * körüli 3 × 3 csempe.
 */
export function reportQuery(view: BBox | null, center: { lat: number; lon: number } | null): ReportQuery | null {
  const around = (lat: number, lon: number) => {
    const tiles = tilesAround(lat, lon, 1).map((k) => k.split(':').map(Number) as [number, number]);
    const [y0, x0] = tiles[0]!;
    const [y1, x1] = tiles[tiles.length - 1]!;
    return tileRange(y0, x0, y1, x1);
  };
  if (view) {
    const y0 = Math.floor(view.south / TILE_DEG);
    const y1 = Math.floor(view.north / TILE_DEG);
    const x0 = Math.floor(view.west / TILE_DEG);
    const x1 = Math.floor(view.east / TILE_DEG);
    if (y1 - y0 < MAX_REPORT_TILE_SPAN && x1 - x0 < MAX_REPORT_TILE_SPAN) return tileRange(y0, x0, y1, x1);
    return around((view.south + view.north) / 2, (view.west + view.east) / 2);
  }
  return center ? around(center.lat, center.lon) : null;
}

export function rowToActiveReport(row: ReportRow, myUserId: string | null): ActiveReport {
  return {
    id: row.id,
    type: row.type as ReportType,
    gateKind: row.gate_kind,
    lat: row.lat,
    lon: row.lon,
    headingDeg: row.heading_deg,
    createdAt: Date.parse(row.created_at),
    expiresAt: Date.parse(row.expires_at),
    confirmations: row.confirmations,
    denials: row.denials,
    own: myUserId !== null && row.user_id === myUserId,
  };
}

/** A frissen elküldött saját bejelentés, amíg a szerver-lista még nem tartalmazza. */
export function ownReport(row: ReportInsert, id: string, now: number): ActiveReport {
  return {
    id,
    type: row.type,
    gateKind: row.type === 'ideiglenes_kapu' ? row.gate_kind : null,
    lat: row.lat,
    lon: row.lon,
    headingDeg: row.heading_deg,
    createdAt: now,
    expiresAt: now + REPORT_TTL_MS,
    confirmations: 0,
    denials: 0,
    own: true,
  };
}

export interface ReportFeedOptions {
  now?: () => number;
  refreshMs?: number;
}

/**
 * A térképen látható bejelentések: a szerver legutóbbi listája + a saját, még le nem kért
 * bejelentések + a saját szavazatok. Lekérés nézetváltáskor (új csempe-téglalap) vagy 60 s-enként;
 * a késve érkező, már elavult kérés eredményét eldobja. A lejártak a lekérések között is eltűnnek.
 */
export class ReportFeed {
  private readonly now: () => number;
  private readonly refreshMs: number;
  private server: ActiveReport[] = [];
  private readonly local = new Map<string, ActiveReport>();
  private readonly votes = new Map<string, boolean>();
  private key: string | null = null;
  private fetchedAt = -Infinity;
  private seq = 0;
  private inFlight: string | null = null;

  constructor(
    private readonly fetch: (bbox: BBox) => Promise<ActiveReport[]>,
    opts: ReportFeedOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.refreshMs = opts.refreshMs ?? REPORT_REFRESH_MS;
  }

  /** Kell-e lekérni: új téglalap, vagy lejárt a frissítési idő (és nem fut már ugyanerre kérés). */
  shouldFetch(q: ReportQuery): boolean {
    if (this.inFlight === q.key) return false;
    return q.key !== this.key || this.now() - this.fetchedAt >= this.refreshMs;
  }

  /** Lekér, ha kell; igaz, ha a lista változott. Hálózati hibánál a régi lista marad. */
  async refresh(q: ReportQuery): Promise<boolean> {
    if (!this.shouldFetch(q)) return false;
    const seq = ++this.seq;
    this.inFlight = q.key;
    try {
      const rows = await this.fetch(q.bbox);
      if (seq !== this.seq) return false;
      this.server = rows;
      this.key = q.key;
      this.fetchedAt = this.now();
      for (const r of rows) this.local.delete(r.id);
      return true;
    } catch {
      if (seq === this.seq) {
        // a következő próbálkozás a frissítési idő után (nem minden kamera-mozdulatnál)
        this.key = q.key;
        this.fetchedAt = this.now();
      }
      return false;
    } finally {
      if (seq === this.seq) this.inFlight = null;
    }
  }

  /** A saját bejelentés azonnal látszik (a következő lekérésig helyben). */
  addOwn(report: ActiveReport): void {
    this.local.set(report.id, { ...report, own: true });
  }

  /** Saját szavazat (megerősítés / nincs ott) – a kártya ebből tudja, hogy már szavaztunk. */
  vote(id: string, confirm: boolean): void {
    this.votes.set(id, confirm);
  }

  myVote(id: string): boolean | null {
    return this.votes.get(id) ?? null;
  }

  /** A most látható (le nem járt) bejelentések. */
  list(): ActiveReport[] {
    const t = this.now();
    const byId = new Map<string, ActiveReport>();
    for (const r of this.server) byId.set(r.id, r);
    for (const r of this.local.values()) if (!byId.has(r.id)) byId.set(r.id, r);
    return [...byId.values()].filter((r) => r.expiresAt > t);
  }
}

/** Ikon (a webes `Icon` neve) és tónus egy bejelentés-típushoz – a bejelentés-lappal egyezően. */
export type ReportIconName = Exclude<ReportType, 'ideiglenes_kapu'> | 'ideiglenes_szakasz' | 'kapu_kezdo' | 'kapu_zaro';

export const REPORT_TONE: Record<ReportIconName, string> = {
  rendorseg: 'kezi',
  traffipax: 'hataron',
  baleset: 'tul',
  akadaly: 'hataron',
  utlezaras: 'tul',
  szakasz_hiba: 'semleges',
  ideiglenes_szakasz: 'kezi',
  kapu_kezdo: 'kezi',
  kapu_zaro: 'kezi',
};

export function reportVisual(r: Pick<ActiveReport, 'type' | 'gateKind'>): { icon: ReportIconName; tone: string; label: string } {
  if (r.type === 'ideiglenes_kapu') {
    const icon = r.gateKind === 'zaro' ? 'kapu_zaro' : 'kapu_kezdo';
    return { icon, tone: REPORT_TONE[icon], label: r.gateKind === 'zaro' ? 'Ideiglenes szakasz vége' : 'Ideiglenes szakasz kezdete' };
  }
  return { icon: r.type, tone: REPORT_TONE[r.type], label: REPORT_CHOICES.find((c) => c.id === r.type)?.label ?? 'Bejelentés' };
}
