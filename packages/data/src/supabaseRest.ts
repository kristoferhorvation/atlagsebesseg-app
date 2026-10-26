/**
 * Minimális Supabase (PostgREST) kliens fetch-csel – függőség nélkül, Node-ban és Deno-ban
 * (edge function) is fut. A kulcsot a hívó adja; soha ne kerüljön a repóba.
 */
export interface RestConfig {
  url: string;
  key: string;
  fetchImpl?: typeof fetch;
}

export class SupabaseRest {
  private readonly f: typeof fetch;

  constructor(private readonly cfg: RestConfig) {
    this.f = cfg.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.cfg.key,
      Authorization: `Bearer ${this.cfg.key}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async check(res: Response, what: string): Promise<Response> {
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.f(`${this.cfg.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    const text = await (await this.check(res, `rpc ${fn}`)).text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async select<T>(table: string, query: string): Promise<T[]> {
    const res = await this.f(`${this.cfg.url}/rest/v1/${table}?${query}`, { headers: this.headers() });
    return (await (await this.check(res, `select ${table}`)).json()) as T[];
  }

  /** Upsert (insert … on conflict do update) a megadott kulcsra. */
  async upsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
    const res = await this.f(`${this.cfg.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows),
    });
    await this.check(res, `upsert ${table}`);
  }
}
