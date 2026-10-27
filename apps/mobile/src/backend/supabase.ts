import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSupabaseClient, ensureSignedIn as signIn, type SupabaseClient } from '@atlagsebesseg/app-logic';
import Constants from 'expo-constants';
import { AppState } from 'react-native';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };

/** `null`, ha nincs beállítva (SUPABASE_URL / SUPABASE_ANON_KEY az apps/mobile/.env-ben) – akkor offline mód. */
export const supabase: SupabaseClient | null = createSupabaseClient({
  url: extra.supabaseUrl,
  anonKey: extra.supabaseAnonKey,
  storage: AsyncStorage,
});

if (supabase) {
  // A token frissítése csak előtérben fusson (Supabase ajánlás React Native-re).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Bejelentkezés: meglévő munkamenet, különben anonim. A felhasználó azonosítóját adja. */
export const ensureSignedIn = (): Promise<string | null> => signIn(supabase);
