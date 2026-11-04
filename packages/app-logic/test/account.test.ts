import { describe, expect, it } from 'vitest';
import {
  accountErrorKey,
  accountFieldsOf,
  accountTitle,
  accountUser,
  applyFields,
  compactSamples,
  DEFAULT_SETTINGS,
  expandSamples,
  firstNameFromMeta,
  heatBlob,
  heatHash,
  isIdentityTaken,
  mergeFields,
  mergeRecents,
  mergeRemoteHeat,
  nameStepNeeded,
  nameStepPrefill,
  NO_CLOUD_STATE,
  NO_FIELDS,
  NO_SAVED,
  noteLocalFields,
  NUDGE_INTERVAL_MS,
  parseHeatBlob,
  planTripSync,
  sameField,
  signinNudgeDue,
  syncBackupOnce,
  syncFieldsOnce,
  validEmail,
  type AccountData,
  type AccountRemote,
  type BackupStore,
  type CloudSample,
  type FieldRow,
  type HeatCell,
  type Place,
  type Profile,
  type Trip,
  type TripSample,
} from '../src';

const place = (id: string, lat = 47.5, lon = 19): Place => ({ id, name: id, address: '', lat, lon });
const data = (patch: Partial<AccountData> = {}): AccountData => ({ settings: DEFAULT_SETTINGS, lang: 'auto', saved: NO_SAVED, recents: [], ...patch });
const trip = (id: string): Trip => ({ id, startedAt: 1000, endedAt: 2000, distanceM: 500, movingS: 60, stoppedS: 0, avgKmh: 30, maxKmh: 50, turns: { left: 0, right: 0, uTurn: 0 }, dirChanges: { left: 0, right: 0, uTurn: 0 }, reroutes: 0, jamS: 0, measurements: [], path: [], destination: null } as unknown as Trip);
const cell = (h3: string, count: number, avgKmh = 50, lastT = 10): HeatCell => ({ h3, count, avgKmh, lastT });

/** Hamis szerver: ugyanaz a mezőnkénti szabály, mint a `account_fields` triggeré; két készülék osztozik rajta. */
function fakeServer() {
  const fields = new Map<string, FieldRow>();
  const trips = new Map<string, { record: unknown; samples: CloudSample[] | null; deleted: boolean; updated_ms: number }>();
  const heat = new Map<string, { cells: [string, number, number, number][]; updated_ms: number }>();
  let profile: Profile | null = null;
  const remote: AccountRemote = {
    pullFields: async () => [...fields.values()],
    pushFields: async (rows) => {
      for (const r of rows) if (!fields.has(r.key) || r.updated_ms > fields.get(r.key)!.updated_ms) fields.set(r.key, r);
    },
    pullProfile: async () => profile,
    pushProfile: async (p) => {
      const base: Profile = profile ?? { megszolitas: '', megszolitas_ms: 0, given_name: null, full_name: null, name_prompted: false };
      profile = (p.megszolitas_ms ?? Infinity) < base.megszolitas_ms ? { ...base, ...p, megszolitas: base.megszolitas, megszolitas_ms: base.megszolitas_ms } : { ...base, ...p };
    },
    listTrips: async () => [...trips.entries()].map(([id, t]) => ({ id, deleted: t.deleted, updated_ms: t.updated_ms })),
    getTrip: async (id) => trips.get(id) ?? null,
    putTrip: async (id, record, samples, updated_ms) => void trips.set(id, { record, samples, deleted: false, updated_ms }),
    markTripsDeleted: async (ids, updated_ms) => {
      for (const id of ids) trips.set(id, { record: null, samples: null, deleted: true, updated_ms });
    },
    listHeat: async () => [...heat.entries()].map(([device_id, h]) => ({ device_id, ...h })),
    putHeat: async (device, cells, updated_ms) => void heat.set(device, { cells, updated_ms }),
    clearHeat: async () => heat.clear(),
  };
  return { remote, fields, trips, heat, getProfile: () => profile };
}

function fakeStore(initial: Trip[] = [], cells: HeatCell[] = []) {
  const trips = new Map(initial.map((t) => [t.id, t]));
  const samples = new Map<string, TripSample[]>();
  const absorbed = new Set<string>(initial.map((t) => t.id));
  const heat = { own: cells, remote: [] as (readonly HeatCell[])[] };
  const store: BackupStore = {
    listTrips: async () => [...trips.values()],
    samples: async (id) => samples.get(id) ?? [],
    saveDownloaded: async (t, s) => {
      trips.set(t.id, t);
      samples.set(t.id, [...s]);
    },
    deleteTrip: async (id) => void trips.delete(id),
    heatCells: async () => heat.own,
    setRemoteHeat: async (lists) => void (heat.remote = [...lists]),
  };
  return { store, trips, samples, absorbed, heat };
}

describe('AW22: ajánlat és név', () => {
  it('a bejelentkezés-ajánlat névtelenül, egyszer, 30 napig nem jön újra', () => {
    expect(signinNudgeDue(null, 1000, true)).toBe(true);
    expect(signinNudgeDue(null, 1000, false)).toBe(false);
    expect(signinNudgeDue(1000, 1000 + NUDGE_INTERVAL_MS - 1, true)).toBe(false);
    expect(signinNudgeDue(1000, 1000 + NUDGE_INTERVAL_MS, true)).toBe(true);
  });
  it('a keresztnév a given_name, különben a teljes név első szava', () => {
    expect(firstNameFromMeta({ given_name: ' Kristof ', full_name: 'Horváth Kristof' })).toBe('Kristof');
    expect(firstNameFromMeta({ custom_claims: { given_name: 'Anna' } })).toBe('Anna');
    expect(firstNameFromMeta({ full_name: 'Kristof Horvath' })).toBe('Kristof');
    expect(firstNameFromMeta({})).toBeNull();
    expect(firstNameFromMeta(null)).toBeNull();
  });
  it('a felhasználó: e-mailnél nincs név, a közösségi fióknál a szolgáltatóé', () => {
    expect(accountUser({ id: 'a', is_anonymous: true })).toMatchObject({ isAnonymous: true, provider: null, givenName: null });
    expect(accountUser({ id: 'e', email: 'a@b.hu', identities: [{ provider: 'email' }], user_metadata: { full_name: 'X Y' } })).toMatchObject({ provider: 'email', givenName: null, fullName: null, email: 'a@b.hu' });
    expect(accountUser({ id: 'g', email: 'a@b.hu', identities: [{ provider: 'google' }], user_metadata: { given_name: 'Anna', full_name: 'Kis Anna' } })).toMatchObject({ provider: 'google', givenName: 'Anna', fullName: 'Kis Anna' });
    expect(accountUser(null)).toBeNull();
  });
  it('az „Így szólítsunk?” lépés: kitöltött Megszólításnál és kihagyás után nincs', () => {
    const p: Profile = { megszolitas: '', megszolitas_ms: 0, given_name: 'Anna', full_name: null, name_prompted: false };
    expect(nameStepNeeded('', null)).toBe(true);
    expect(nameStepNeeded('', p)).toBe(true);
    expect(nameStepNeeded('Kristof', p)).toBe(false);
    expect(nameStepNeeded('', { ...p, megszolitas: 'Kristof' })).toBe(false);
    expect(nameStepNeeded('', { ...p, name_prompted: true })).toBe(false);
  });
  it('a lépés kitöltése: az Apple/Google keresztneve, e-mailnél üres', () => {
    const p: Profile = { megszolitas: '', megszolitas_ms: 0, given_name: 'Anna', full_name: null, name_prompted: false };
    expect(nameStepPrefill(null, p)).toBe('Anna');
    expect(nameStepPrefill(accountUser({ id: 'g', identities: [{ provider: 'google' }], user_metadata: { given_name: 'Béla' } }), null)).toBe('Béla');
    expect(nameStepPrefill(accountUser({ id: 'e', email: 'a@b.hu', identities: [{ provider: 'email' }] }), null)).toBe('');
  });
  it('a kártya címe: Megszólítás, teljes név, e-mail', () => {
    const u = accountUser({ id: 'g', email: 'a@b.hu', identities: [{ provider: 'google' }], user_metadata: { full_name: 'Kis Anna' } })!;
    expect(accountTitle(u, 'Kristof')).toBe('Kristof');
    expect(accountTitle(u, '')).toBe('Kis Anna');
    expect(accountTitle({ ...u, fullName: null }, '')).toBe('a@b.hu');
  });
  it('a hibák felirata és az e-mail-cím ellenőrzése', () => {
    expect(accountErrorKey({ code: 'over_email_send_rate_limit' })).toBe('account.err.rate');
    expect(accountErrorKey({ status: 429 })).toBe('account.err.rate');
    expect(accountErrorKey({ code: 'email_address_not_authorized' })).toBe('account.err.notAllowed');
    expect(accountErrorKey({ code: 'email_address_invalid' })).toBe('account.err.email');
    expect(accountErrorKey(new Error('x'))).toBe('account.err.generic');
    expect(validEmail(' a@b.hu ')).toBe(true);
    expect(validEmail('a@b')).toBe(false);
    expect(isIdentityTaken({ code: 'identity_already_exists' })).toBe(true);
    expect(isIdentityTaken({ code: 'email_exists' })).toBe(true);
    expect(isIdentityTaken({ code: 'x' })).toBe(false);
  });
});

describe('AW22: szinkron ütközés', () => {
  it('helyi változás: csak az eltérő mező kap új időt, a törölt hely jelölőt', () => {
    const a = noteLocalFields(NO_FIELDS, accountFieldsOf(data({ saved: { ...NO_SAVED, others: [place('x')] }, settings: { ...DEFAULT_SETTINGS, zona_m: { x: 500 } } })), 100);
    expect(a.times['settings.egyseg']).toBe(0);
    expect(a.times['place.other.x']).toBe(1);
    const b = noteLocalFields(a, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, egyseg: 'mph', zona_m: { x: 500 } }, saved: { ...NO_SAVED, others: [place('x')] } })), 200);
    expect(b.times['settings.egyseg']).toBe(200);
    expect(b.times['settings.terkep']).toBe(0);
    const c = noteLocalFields(b, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, egyseg: 'mph' } })), 300);
    expect(c.values['place.other.x']).toBeNull();
    expect(c.times['place.other.x']).toBe(300);
    expect(c.values['zone.x']).toBeNull();
  });
  it('más platform mezője nem törlődik', () => {
    const s = { values: { 'settings.jelzes_mod': 'hang' }, times: { 'settings.jelzes_mod': 5 } };
    const n = noteLocalFields(s, accountFieldsOf(data()), 100);
    expect(n.values['settings.jelzes_mod']).toBe('hang');
    expect(n.times['settings.jelzes_mod']).toBe(5);
  });
  it('mezőnként a legutóbb módosított nyer, azonos időnél a szerveré', () => {
    const local = { values: { a: 1, b: 1, c: 1, d: 1 }, times: { a: 100, b: 200, c: 150, d: 7 } };
    const r = mergeFields(local, [
      { key: 'a', value: 2, updated_ms: 200 },
      { key: 'b', value: 2, updated_ms: 100 },
      { key: 'c', value: 2, updated_ms: 150 },
      { key: 'e', value: 2, updated_ms: 1 },
    ]);
    expect(r.state.values).toEqual({ a: 2, b: 1, c: 2, d: 1, e: 2 });
    expect(r.state.times).toEqual({ a: 200, b: 200, c: 150, d: 7, e: 1 });
    expect(r.upload.map((u) => u.key).sort()).toEqual(['b', 'd']);
    expect(r.changed.sort()).toEqual(['a', 'c', 'e']);
  });
  it('két készülék ugyanarra jut, mezőnként a frissebb értékre', async () => {
    const srv = fakeServer();
    let a = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), 10);
    let b = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), 10);
    a = noteLocalFields(a, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, egyseg: 'mph' } })), 100);
    b = noteLocalFields(b, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, terkep: 'vilagos' } })), 200);
    a = (await syncFieldsOnce(srv.remote, a)).state;
    b = (await syncFieldsOnce(srv.remote, b)).state;
    a = (await syncFieldsOnce(srv.remote, a)).state;
    expect(a.values['settings.egyseg']).toBe('mph');
    expect(a.values['settings.terkep']).toBe('vilagos');
    expect(b.values['settings.egyseg']).toBe('mph');
    expect(b.values['settings.terkep']).toBe('vilagos');
  });
  it('a mentett hely és a törlése is átjut; a törölt hely nem jön vissza', async () => {
    const srv = fakeServer();
    const withPlace = data({ saved: { home: place('h'), work: null, others: [place('x')] }, settings: { ...DEFAULT_SETTINGS, zona_m: { x: 1000 } } });
    let a = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), 10);
    a = noteLocalFields(a, accountFieldsOf(withPlace), 100);
    a = (await syncFieldsOnce(srv.remote, a)).state;
    let b = noteLocalFields(NO_FIELDS, accountFieldsOf(data()), 10);
    b = (await syncFieldsOnce(srv.remote, b)).state;
    const applied = applyFields(b, data());
    expect(applied.saved.home?.id).toBe('h');
    expect(applied.saved.others.map((p) => p.id)).toEqual(['x']);
    expect(applied.settings.zona_m).toEqual({ x: 1000 });
    a = noteLocalFields(a, accountFieldsOf(data({ saved: { home: place('h'), work: null, others: [] } })), 300);
    a = (await syncFieldsOnce(srv.remote, a)).state;
    b = (await syncFieldsOnce(srv.remote, b)).state;
    const after = applyFields(b, applied);
    expect(after.saved.others).toEqual([]);
    expect(after.settings.zona_m).toEqual({});
  });
  it('a helyek sorrendje a felvétel sorrendje', () => {
    const s = noteLocalFields(NO_FIELDS, accountFieldsOf(data({ saved: { ...NO_SAVED, others: [place('z', 40), place('a', 41), place('m', 42)] } })), 100);
    expect(applyFields(s, data()).saved.others.map((p) => p.id)).toEqual(['z', 'a', 'm']);
  });
  it('a legutóbbi célok egyesülnek, semmi nem vész el a listából', () => {
    const newer = [place('b', 41), place('a', 40)];
    const older = [place('c', 42), place('a', 40)];
    expect(mergeRecents(newer, older).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    const r = mergeFields({ values: { recents: newer as never }, times: { recents: 200 } }, [{ key: 'recents', value: older as never, updated_ms: 100 }]);
    expect((r.state.values.recents as unknown as Place[]).map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(r.upload[0]?.key).toBe('recents');
  });
  it('a Megszólítás a profilba kerül; a kitöltött nem íródik felül üres profillal', async () => {
    const srv = fakeServer();
    await srv.remote.pushProfile({ given_name: 'Anna' });
    const named = data({ settings: { ...DEFAULT_SETTINGS, megszolitas: 'Kristof' } });
    let a = noteLocalFields(NO_FIELDS, accountFieldsOf(named), 10);
    a = (await syncFieldsOnce(srv.remote, a)).state;
    expect(a.values.megszolitas).toBe('Kristof');
    expect(srv.getProfile()?.megszolitas).toBe('Kristof');
    expect(srv.fields.has('megszolitas')).toBe(false);
    a = noteLocalFields(a, accountFieldsOf(data({ settings: { ...DEFAULT_SETTINGS, megszolitas: 'Kristóf' } })), 500);
    await syncFieldsOnce(srv.remote, a);
    expect(srv.getProfile()).toMatchObject({ megszolitas: 'Kristóf', megszolitas_ms: 500 });
    const b = (await syncFieldsOnce(srv.remote, noteLocalFields(NO_FIELDS, accountFieldsOf(data()), 10))).state;
    expect(applyFields(b, data()).settings.megszolitas).toBe('Kristóf');
  });
  it('az azonos tartalom eltérő kulcssorrenddel is ugyanaz', () => {
    expect(sameField({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameField({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameField(null, undefined)).toBe(false);
  });
});

describe('AW22: felhős mentés', () => {
  it('a mentés terve: fel, le, helyi törlés, függő törlés', () => {
    const plan = planTripSync(['fel', 'mindketto', 'torolt', 'fut', 'nem-ment'], [{ id: 'mindketto', deleted: false, updated_ms: 1 }, { id: 'le', deleted: false, updated_ms: 1 }, { id: 'torolt', deleted: true, updated_ms: 1 }, { id: 'volt', deleted: true, updated_ms: 1 }], { ...NO_CLOUD_STATE, pendingDeletes: ['nem-ment'] }, 'fut');
    expect(plan.upload).toEqual(['fel']);
    expect(plan.download).toEqual(['le']);
    expect(plan.deleteLocal).toEqual(['torolt']);
    expect(plan.pushDeletes).toEqual(['nem-ment']);
  });
  it('a visszaállított út felülírja a szerver törlési jelölőjét', () => {
    const plan = planTripSync(['v'], [{ id: 'v', deleted: true, updated_ms: 1 }], { ...NO_CLOUD_STATE, pendingRestores: ['v'] }, null);
    expect(plan.upload).toEqual(['v']);
    expect(plan.deleteLocal).toEqual([]);
  });
  it('a minták ritkítva, az utolsó mindig megmarad', () => {
    const samples: TripSample[] = Array.from({ length: 11 }, (_, i) => ({ tripId: 't', t: i * 1000, lat: 47, lon: 19, speedKmh: 50, heading: 90, accuracy: 5, h3: 'x', limitKmh: 90 }));
    const c = compactSamples(samples);
    expect(c.map((r) => r[0])).toEqual([0, 5000, 10000]);
    const e = expandSamples('t', c);
    expect(e[1]).toEqual({ tripId: 't', t: 5000, lat: 47, lon: 19, speedKmh: 50, heading: 90, accuracy: 5, h3: null, limitKmh: 90 });
  });
  it('a hőtérkép-blob oda-vissza, az ujjlenyomat új áthaladásra változik', () => {
    const cells = [cell('a', 2), cell('b', 3)];
    expect(parseHeatBlob(heatBlob(cells))).toEqual(cells);
    expect(heatHash(cells)).toBe('2:5:10');
    expect(heatHash([cell('a', 3), cell('b', 3)])).not.toBe(heatHash(cells));
  });
  it('a többi készülék cellái összeadódnak a sajáttal', () => {
    const m = mergeRemoteHeat([cell('a', 2, 40, 1)], [[cell('a', 2, 60, 5), cell('b', 1)]]);
    expect(m.find((c) => c.h3 === 'a')).toEqual({ h3: 'a', count: 4, avgKmh: 50, lastT: 5 });
    expect(m.find((c) => c.h3 === 'b')?.count).toBe(1);
  });
  it('két készülék naplója összefésülődik, a törlés átjut, a hőtérkép nem duplázódik', async () => {
    const srv = fakeServer();
    const a = fakeStore([trip('t-a')], [cell('x', 2)]);
    const b = fakeStore([trip('t-b')], [cell('x', 3)]);
    let ca = (await syncBackupOnce(srv.remote, a.store, NO_CLOUD_STATE, 'dev-a', null, 100)).state;
    let cb = (await syncBackupOnce(srv.remote, b.store, NO_CLOUD_STATE, 'dev-b', null, 100)).state;
    ca = (await syncBackupOnce(srv.remote, a.store, ca, 'dev-a', null, 200)).state;
    expect([...a.trips.keys()].sort()).toEqual(['t-a', 't-b']);
    expect([...b.trips.keys()].sort()).toEqual(['t-a', 't-b']);
    expect(a.heat.remote).toEqual([[cell('x', 3)]]);
    expect(b.heat.remote).toEqual([[cell('x', 2)]]);
    // többszöri kör sem duplázza
    ca = (await syncBackupOnce(srv.remote, a.store, ca, 'dev-a', null, 300)).state;
    expect(mergeRemoteHeat(a.heat.own, a.heat.remote)[0]?.count).toBe(5);
    // törlés az egyiken: a másikon is eltűnik, a szerveren csak jelölő marad
    a.trips.delete('t-a');
    ca = { ...ca, pendingDeletes: ['t-a'] };
    ca = (await syncBackupOnce(srv.remote, a.store, ca, 'dev-a', null, 400)).state;
    cb = (await syncBackupOnce(srv.remote, b.store, cb, 'dev-b', null, 500)).state;
    expect([...b.trips.keys()]).toEqual(['t-b']);
    expect(srv.trips.get('t-a')).toMatchObject({ record: null, samples: null, deleted: true });
    expect(ca.pendingDeletes).toEqual([]);
    expect(cb.pendingDeletes).toEqual([]);
  });
  it('a hőtérkép törlése minden készülék felhős sorát viszi', async () => {
    const srv = fakeServer();
    const a = fakeStore([], [cell('x', 2)]);
    const b = fakeStore([], [cell('x', 3)]);
    await syncBackupOnce(srv.remote, b.store, NO_CLOUD_STATE, 'dev-b', null, 100);
    let ca = (await syncBackupOnce(srv.remote, a.store, NO_CLOUD_STATE, 'dev-a', null, 100)).state;
    a.heat.own = [];
    ca = (await syncBackupOnce(srv.remote, a.store, { ...ca, pendingHeatClear: true }, 'dev-a', null, 200)).state;
    expect(a.heat.remote).toEqual([]);
    expect(srv.heat.has('dev-b')).toBe(false);
    expect(ca.pendingHeatClear).toBe(false);
  });
  it('a futó út nem megy fel, csak a lezárása után', async () => {
    const srv = fakeServer();
    const a = fakeStore([trip('fut')]);
    let ca = (await syncBackupOnce(srv.remote, a.store, NO_CLOUD_STATE, 'dev-a', 'fut', 100)).state;
    expect(srv.trips.has('fut')).toBe(false);
    ca = (await syncBackupOnce(srv.remote, a.store, ca, 'dev-a', null, 200)).state;
    expect(srv.trips.has('fut')).toBe(true);
    expect(ca.heatHash).toBe('0:0:0');
  });
});
