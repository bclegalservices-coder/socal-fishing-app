// Settings the admin console controls for every phone (ads on/off, sponsor intro, maintenance message, forced update).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase, supabaseReady } from './supabase';

export type AppConfig = { ads_enabled: boolean; intro_enabled: boolean; maintenance_message: string | null; min_app_version: string; analytics_enabled: boolean;
  /** Remote off-switches (Admin → Settings → Emergency off-switches): map layers ('wind', 'radar', 'sst', 'fuel'…),
   *  'relief', 'satellite' and 'chart_helper' (falls back to the plain NOAA chart). */
  features_off: string[];
  /** Admin → Settings: true = spotter planes (circling highlights + spotter alerts) need Pro. False = free for everyone. */
  spotter_premium: boolean;
  /** Admin → San Clemente: which San Clemente Island sections the Navy has closed (see sci.ts). */
  sci_closures: any;
  /** Map Studio → Send to app (Oct 30): { style: { water, land, dlw, daw, … } } — chart look for every phone. */
  map_style: any;
  /** Admin → Settings (Nov 1): download link put in group invite messages (TestFlight public link, later the App Store). */
  invite_link: string | null };
const DEFAULTS: AppConfig = { ads_enabled: true, intro_enabled: true, maintenance_message: null, min_app_version: '0.0.0', analytics_enabled: true, features_off: [], spotter_premium: false, sci_closures: null, map_style: null, invite_link: null };
const listeners = new Set<(c: AppConfig) => void>();
/** Runs whenever new settings arrive (start-up and when the app comes back to the foreground). */
export function onConfig(fn: (c: AppConfig) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const featureOff = (k: string) => Array.isArray(current.features_off) && current.features_off.includes(k);
/** Nov 12 (fix-140): the new maps (sharp satellite, new smooth HD bottom, vector contour lines; Relief map style and
 *  "Relief & structure" retired). Admin → Settings → Emergency off-switches → "new_maps" brings the old ones back
 *  on every phone without an app update. */
export const newMapsOn = (off: string[] = current.features_off ?? []) => !off.includes('new_maps');
/** Retired by the new maps (hidden while they're on). Nov 12 (fix-141): none — Relief and Relief & structure are back by request. */
export const RETIRED_BY_NEW_MAPS: string[] = [];
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

/** The chart look sent from Map Studio (only the parts the app uses, checked). */
export type MapLook = { water?: string; land?: string; dlw?: number; daw?: number };
export function mapLook(c: AppConfig = current): MapLook {
  const st = c.map_style?.style ?? c.map_style;
  if (!st || typeof st !== 'object') return {};
  const hex = (v: any) => (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : undefined);
  const num = (v: any) => (typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e7 ? Math.round(v) : undefined);
  return { water: hex(st.water), land: hex(st.land), dlw: num(st.dlw), daw: num(st.daw) };
}
