// Settings the admin console controls for every phone (ads on/off, sponsor intro, maintenance message, forced update).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase, supabaseReady } from './supabase';

export type AppConfig = { ads_enabled: boolean; intro_enabled: boolean; maintenance_message: string | null; min_app_version: string; analytics_enabled: boolean };
const DEFAULTS: AppConfig = { ads_enabled: true, intro_enabled: true, maintenance_message: null, min_app_version: '0.0.0', analytics_enabled: true };
let current: AppConfig = DEFAULTS;

export async function loadConfig(): Promise<AppConfig> {
  try { current = { ...DEFAULTS, ...JSON.parse((await AsyncStorage.getItem('app-config')) ?? '{}') }; } catch {}
  if (!supabaseReady) return current;
  try {
    const { data, error } = await supabase.from('app_config').select('key, value');
    if (!error && data) {
      current = { ...DEFAULTS, ...Object.fromEntries(data.map((r: any) => [r.key, r.value])) };
      AsyncStorage.setItem('app-config', JSON.stringify(current)).catch(() => {});
    }
  } catch { /* offline: keep saved copy */ }
  return current;
}
export const config = () => current;

export function needsUpdate(cfg: AppConfig): boolean {
  const mine = String((Constants as any).expoConfig?.version ?? '0.0.0').split('.').map(Number);
  const min = String(cfg.min_app_version ?? '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((mine[i] ?? 0) !== (min[i] ?? 0)) return (mine[i] ?? 0) < (min[i] ?? 0); }
  return false;
}
