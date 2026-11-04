import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  accountErrorKey,
  accountFieldsOf,
  accountUser,
  applyFields,
  claimMerge,
  continueAnonymously,
  deleteAccount,
  FIELDS_KEY,
  fetchAuthProviders,
  isIdentityTaken,
  nameStepNeeded,
  nameStepPrefill,
  normalizeName,
  noteLocalFields,
  NUDGE_KEY,
  parseFieldState,
  prepareMerge,
  signinNudgeDue,
  startEmailSignIn,
  supabaseRemote,
  syncBackupOnce,
  syncFieldsOnce,
  t,
  type AccountData,
  type AccountUser,
  type BackupStore,
  type FieldState,
  type LangPreference,
  type Place,
  type Profile,
  type SavedPlaces,
  type Settings,
  type SyncStatus,
  type Trip,
  type TripSample,
} from '@atlagsebesseg/app-logic';
import { supabase } from '../backend';
import { deviceId, readCloudState, writeCloudState } from '../account/cloudState';
import { deleteDownloadedTrip, listHeatOwn, listTrips, saveDownloadedTrip, setRemoteHeat, tripSamples } from '../trips/tripStore';

const MERGE_KEY = 'account:merge:v1';
const OAUTH_KEY = 'account:oauth:v1';
const SEEN_KEY = 'account:seen:v1';
const q = new URLSearchParams(location.search);
/** Szimulátorban nincs hálózat: az állapotok a képernyőképekhez `?account=in|out|sent|off` (kijelentkezve az alap). */
const SIM = ['sim', 'navsim', 'cruise'].some((k) => q.has(k));
const SIM_ACCOUNT = q.get('account');
const SIM_USER: AccountUser = { id: 'sim', email: 'kristof@example.com', isAnonymous: false, provider: 'email', givenName: null, fullName: null };

const lsGet = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string | null): void => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // tárhely nélkül ebben a munkamenetben marad
  }
};

const backupStore: BackupStore = {
  listTrips,
  samples: tripSamples,
  saveDownloaded: (trip: Trip, samples: readonly TripSample[]) => saveDownloadedTrip(trip, samples),
  deleteTrip: deleteDownloadedTrip,
  heatCells: listHeatOwn,
  setRemoteHeat,
};

export interface AccountApi {
  user: AccountUser | null;
  signedIn: boolean;
  providers: { apple: boolean; google: boolean };
  status: SyncStatus;
  lastSync: number | null;
  busy: boolean;
  error: string | null;
  emailSentTo: string | null;
  signIn: (p: 'apple' | 'google') => void;
  sendEmail: (email: string) => void;
  clearEmail: () => void;
  signOut: () => void;
  remove: () => void;
  nameStep: string | null;
  saveName: (name: string) => void;
  skipName: () => void;
  nudge: boolean;
  closeNudge: () => void;
  tripSaved: () => void;
  backupNow: () => void;
}

/**
 * AW22: a fiók kötése (az iOS-pár: `AppModel+Account.swift`). Névtelenül is figyeli a helyi változásokat (időbélyeg mezőnként), de szerverre csak
 * valódi fiókkal megy adat. A visszatérő link / OAuth a `detectSessionInUrl`-lel jön; ha a fiók már létezett, itt olvad be a névtelen felhasználó.
 */
export function useAccount(opts: {
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  preference: LangPreference;
  setPreference: (p: LangPreference) => void;
  saved: SavedPlaces;
  recents: readonly Place[];
  setPlaces: (saved: SavedPlaces, recents: readonly Place[]) => void;
  openTripId: string | null;
  onData: () => void;
  toast: (text: string) => void;
}): AccountApi {
  const { settings, update, preference, setPreference, saved, recents, setPlaces, openTripId, onData, toast } = opts;
  const [user, setUser] = useState<AccountUser | null>(SIM && SIM_ACCOUNT === 'in' ? SIM_USER : null);
  const [providers, setProviders] = useState(SIM ? { apple: SIM_ACCOUNT !== 'off', google: SIM_ACCOUNT !== 'off' } : { apple: false, google: false });
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSync, setLastSync] = useState<number | null>(SIM && SIM_ACCOUNT === 'in' ? Date.parse('2026-11-03T11:58:00+01:00') : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(SIM && SIM_ACCOUNT === 'sent' ? 'kristof@example.com' : null);
  const [nameStep, setNameStep] = useState<string | null>(SIM && q.has('nameStep') ? (q.get('nameStep') ?? '') : null);
  const [nudge, setNudge] = useState(SIM && q.has('nudge'));
  const signedIn = user !== null && !user.isAnonymous;

  const dataRef = useRef<AccountData>({ settings, lang: preference, saved, recents });
  dataRef.current = { settings, lang: preference, saved, recents };
  const fields = useRef<FieldState>(parseFieldState(lsGet(FIELDS_KEY)));
  const syncing = useRef(false);
  const again = useRef(false);
  const openRef = useRef(openTripId);
  openRef.current = openTripId;
  // a hívó minden renderben új függvényt adhat: a munkamenet-figyelő és a szinkron ettől nem indulhat újra
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  const fail = useCallback((e: unknown) => {
    console.warn('[account]', e);
    setError(t(accountErrorKey(e)));
  }, []);

  /** Mező-szinkron, majd (bekapcsolva) a felhős mentés; futás közbeni kérés a kör után újra fut. */
  const syncNow = useCallback(async (): Promise<void> => {
    if (!supabase || SIM) return;
    if (syncing.current) {
      again.current = true;
      return;
    }
    syncing.current = true;
    setStatus('syncing');
    try {
      const remote = supabaseRemote(supabase);
      const { state, changed } = await syncFieldsOnce(remote, fields.current);
      fields.current = state;
      lsSet(FIELDS_KEY, JSON.stringify(state));
      if (changed.length) {
        const next = applyFields(state, dataRef.current);
        update(next.settings);
        setPlaces(next.saved, next.recents);
        if (next.lang !== dataRef.current.lang) setPreference(next.lang as LangPreference);
      }
      if ((changed.length ? applyFields(state, dataRef.current).settings : dataRef.current.settings).felho_mentes) {
        const r = await syncBackupOnce(remote, backupStore, readCloudState(), deviceId(), openRef.current, Date.now());
        writeCloudState(r.state);
        if (r.trips.down || r.trips.deleted || r.heatChanged) onDataRef.current();
      }
      setLastSync(Date.now());
      setStatus('ok');
    } catch (e) {
      console.warn('[account] sync failed', e);
      setStatus('error');
    } finally {
      syncing.current = false;
      if (again.current) {
        again.current = false;
        void syncNow();
      }
    }
  }, [update, setPlaces, setPreference]);

  /** Bejelentkezés után: az összefésülés, a szolgáltató neve (az Apple később nem adja meg újra), szinkron, „Így szólítsunk?”. */
  const afterSignIn = useCallback(
    async (u: AccountUser) => {
      if (!supabase) return;
      const remote = supabaseRemote(supabase);
      const token = lsGet(MERGE_KEY);
      if (token) {
        await claimMerge(supabase, token).catch((e: unknown) => console.warn('[account] merge failed', e));
        lsSet(MERGE_KEY, null);
      }
      if (u.givenName || u.fullName) await remote.pushProfile({ given_name: u.givenName, full_name: u.fullName }).catch((e: unknown) => console.warn('[account] profile failed', e));
      const first = lsGet(SEEN_KEY) !== u.id;
      await syncNow();
      if (!first) return;
      lsSet(SEEN_KEY, u.id);
      toastRef.current(t('account.signedIn'));
      const profile: Profile | null = await remote.pullProfile().catch(() => null);
      if (nameStepNeeded(dataRef.current.settings.megszolitas, profile)) setNameStep(nameStepPrefill(u, profile));
    },
    [syncNow],
  );

  // munkamenet: induláskor és minden változáskor; a valódi fiókra váltáskor egyszer fut az `afterSignIn`
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase || SIM) return;
    const client = supabase;
    const seen = (raw: Parameters<typeof accountUser>[0]) => {
      const u = accountUser(raw);
      setUser(u);
      if (u && !u.isAnonymous && handled.current !== u.id) {
        handled.current = u.id;
        // a Supabase auth-zárán kívül: a callbackben indított hívás különben holtpontra jut
        setTimeout(() => void afterSignIn(u), 0);
      }
    };
    void client.auth.getSession().then(({ data }) => seen(data.session?.user));
    const { data } = client.auth.onAuthStateChange((_e, session) => seen(session?.user));
    return () => data.subscription.unsubscribe();
  }, [afterSignIn]);

  useEffect(() => {
    if (!supabase || SIM) return;
    void fetchAuthProviders(import.meta.env.VITE_SUPABASE_URL ?? '', import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').then((p) => p && setProviders({ apple: p.apple, google: p.google }));
  }, []);

  // a visszatérő OAuth hibája: ha a fiók már létezik, igazolás után abba lépünk be (az adatok a beolvadásnál nem vesznek el)
  useEffect(() => {
    if (!supabase || SIM) return;
    const params = new URLSearchParams(`${location.search.slice(1)}&${location.hash.slice(1)}`);
    const code = params.get('error_code');
    if (!code) return;
    history.replaceState(null, '', location.pathname);
    const provider = lsGet(OAUTH_KEY) as 'apple' | 'google' | null;
    lsSet(OAUTH_KEY, null);
    if (code !== 'identity_already_exists' || !provider) {
      setError(t('account.err.generic'));
      return;
    }
    const client = supabase;
    void (async () => {
      lsSet(MERGE_KEY, await prepareMerge(client));
      const { error: e } = await client.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin } });
      if (e) throw e;
    })().catch(fail);
  }, [fail]);

  // helyi változás: időbélyeg mezőnként (névtelenül is), fiókkal 2,5 s múlva szinkron
  const current = useMemo(() => accountFieldsOf({ settings, lang: preference, saved, recents }), [settings, preference, saved, recents]);
  useEffect(() => {
    if (SIM) return;
    fields.current = noteLocalFields(fields.current, current, Date.now());
    lsSet(FIELDS_KEY, JSON.stringify(fields.current));
    if (!signedIn) return;
    const id = setTimeout(() => void syncNow(), 2500);
    return () => clearTimeout(id);
  }, [current, signedIn, syncNow]);

  // előtérbe kerüléskor friss adat
  useEffect(() => {
    if (!signedIn) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [signedIn, syncNow]);

  const signIn = useCallback(
    (provider: 'apple' | 'google') => {
      if (!supabase) return;
      const client = supabase;
      setError(null);
      setBusy(true);
      lsSet(OAUTH_KEY, provider);
      void (async () => {
        const { data } = await client.auth.getSession();
        const options = { redirectTo: location.origin };
        if (data.session?.user.is_anonymous) {
          const { error: e } = await client.auth.linkIdentity({ provider, options });
          if (!e) return;
          if (!isIdentityTaken(e)) throw e;
          lsSet(MERGE_KEY, await prepareMerge(client));
        }
        const { error: e } = await client.auth.signInWithOAuth({ provider, options });
        if (e) throw e;
      })()
        .catch(fail)
        .finally(() => setBusy(false));
    },
    [fail],
  );

  const sendEmail = useCallback(
    (email: string) => {
      if (!supabase) return;
      const client = supabase;
      setError(null);
      setBusy(true);
      startEmailSignIn(client, email, location.origin, { setPendingMerge: (x) => lsSet(MERGE_KEY, x) })
        .then(() => setEmailSentTo(email.trim()))
        .catch(fail)
        .finally(() => setBusy(false));
    },
    [fail],
  );

  /** Kijelentkezés és fiók törlése után: új névtelen felhasználó, a helyi adatok maradnak; a mentés kapcsolója nem kerül át a következő fiókra. */
  const leave = useCallback(
    async (message: string) => {
      if (!supabase) return;
      handled.current = null;
      await continueAnonymously(supabase);
      lsSet(SEEN_KEY, null);
      // nem felhasználói döntés (0 idő): visszalépve a fiók értéke érvényes, a többi készülék mentése nem kapcsol ki
      fields.current = { values: { ...fields.current.values, 'settings.felho_mentes': false }, times: { ...fields.current.times, 'settings.felho_mentes': 0 } };
      update({ felho_mentes: false });
      setStatus('idle');
      setLastSync(null);
      toastRef.current(message);
    },
    [update],
  );

  const signOut = useCallback(() => {
    setBusy(true);
    setError(null);
    void leave(t('account.signedOut'))
      .catch(fail)
      .finally(() => setBusy(false));
  }, [leave, fail]);

  const remove = useCallback(() => {
    if (!supabase) return;
    const client = supabase;
    setBusy(true);
    setError(null);
    void deleteAccount(client)
      .then(() => leave(t('account.deleted')))
      .catch(fail)
      .finally(() => setBusy(false));
  }, [leave, fail]);

  const saveName = useCallback(
    (name: string) => {
      const n = normalizeName(name);
      if (n) update({ megszolitas: n });
      setNameStep(null);
      if (supabase && !SIM) void supabaseRemote(supabase).pushProfile({ name_prompted: true }).catch((e: unknown) => console.warn('[account] profile failed', e));
    },
    [update],
  );
  const skipName = useCallback(() => saveName(''), [saveName]);

  // a bejelentkezés-ajánlat: befejezett út után, névtelenül, legfeljebb 30 naponta egyszer
  const tripSaved = useCallback(() => {
    if (signedIn) {
      void syncNow();
      return;
    }
    if (!supabase || SIM) return;
    const last = Number(lsGet(NUDGE_KEY) ?? NaN);
    if (signinNudgeDue(Number.isFinite(last) ? last : null, Date.now(), true)) {
      lsSet(NUDGE_KEY, String(Date.now()));
      setNudge(true);
    }
  }, [signedIn, syncNow]);
  const closeNudge = useCallback(() => setNudge(false), []);
  const clearEmail = useCallback(() => {
    setEmailSentTo(null);
    setError(null);
  }, []);
  const backupNow = useCallback(() => void syncNow(), [syncNow]);

  return { user, signedIn, providers, status, lastSync, busy, error, emailSentTo, signIn, sendEmail, clearEmail, signOut, remove, nameStep, saveName, skipName, nudge, closeNudge, tripSaved, backupNow };
}
