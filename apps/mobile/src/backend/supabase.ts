import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };

/** `null`, ha nincs beállítva (SUPABASE_URL / SUPABASE_ANON_KEY az apps/mobile/.env-ben) – akkor offline mód. */
export const supabase: SupabaseClient | null =
  extra.supabaseUrl && extra.supabaseAnonKey
    ? createClient(extra.supabaseUrl, extra.supabaseAnonKey, {
        auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
      })
    : null;

if (supabase) {
  // A token frissítése csak előtérben fusson (Supabase ajánlás React Native-re).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Bejelentkezés: meglévő munkamenet, különben anonim. A felhasználó azonosítóját adja. */
export async function ensureSignedIn(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user.id;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return anon.user?.id ?? null;
}
