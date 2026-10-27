// Settings the admin console controls for every phone (ads on/off, sponsor intro, maintenance message, forced update).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase, supabaseReady } from './supabase';

export type AppConfig = { ads_enabled: boolean; intro_enabled: boolean; maintenance_message: string | null; min_app_version: string; analytics_enabled: boolean;
  /** Remote off-switches (Admin → Settings → Emergency off-switches): map layers ('wind', 'radar', 'sst', 'fuel'…),
   *  'relief', 'satellite' and 'chart_helper' (falls back to the plain NOAA chart). */
  features_off: string[];
  /** Admin → Settings: true = spotter planes (circling highlights + spotter alerts) need Pro. False = free for everyone. */
  spotter_premium: boolean };
const DEFAULTS: AppConfig = { ads_enabled: true, intro_enabled: true, maintenance_message: null, min_app_version: '0.0.0', analytics_enabled: true, features_off: [], spotter_premium: false };
const listeners = new Set<(c: AppConfig) => void>();
/** Runs whenever new settings arrive (start-up and when the app comes back to the foreground). */
export function onConfig(fn: (c: AppConfig) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const featureOff = (k: string) => Array.isArray(current.features_off) && current.features_off.includes(k);
let current: AppConfig = DEFAULTS;

export async function loadConfig(): Promise<AppConfig> {
  try { current = { ...DEFAULTS, ...JSON.parse((await AsyncStorage.getItem('app-config')) ?? '{}') }; } catch {}
  if (!supabaseReady) return current;
  try {
    const { data, error } = await supabase.from('app_config').select('key, value');
    if (!error && data) {
      current = { ...DEFAULTS, ...Object.fromEntries(data.map((r: any) => [r.key, r.value])) };
      if (!Array.isArray(current.features_off)) current.features_off = [];
      AsyncStorage.setItem('app-config', JSON.stringify(current)).catch(() => {});
    }
  } catch { /* offline: keep saved copy */ }
  lastLoad = Date.now();
  listeners.forEach((f) => { try { f(current); } catch { /* a listener must never break config */ } });
  return current;
}
let lastLoad = 0;
/** Re-check settings when the app comes back to the screen (at most every 10 minutes). */
export function refreshConfigIfStale() { if (Date.now() - lastLoad > 10 * 60000) loadConfig(); }
export const config = () => current;

export function needsUpdate(cfg: AppConfig): boolean {
  const mine = String((Constants as any).expoConfig?.version ?? '0.0.0').split('.').map(Number);
  const min = String(cfg.min_app_version ?? '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((mine[i] ?? 0) !== (min[i] ?? 0)) return (mine[i] ?? 0) < (min[i] ?? 0); }
  return false;
}

/** The settings as they are right now (saved copy until the server answers). */
export const currentConfig = () => current;
