// Sign-in (Supabase). Only the PUBLIC anon key is in the app; row-level security protects every private row.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseReady = !!(url && anon);
export const supabase = createClient(url || 'https://placeholder.supabase.co', anon || 'placeholder', {
  auth: { storage: AsyncStorage as any, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
