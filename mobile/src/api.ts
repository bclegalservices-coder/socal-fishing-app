// Network calls with a timeout and an offline fallback: the last good answer is kept on the phone
// and returned with its saved time, so the app shows old data as old instead of showing nothing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';

export type Result<T> = { data: T; cached: boolean; savedAt: number };

export async function getJSON<T>(path: string, opts: { cacheKey?: string; timeoutMs?: number } = {}): Promise<Result<T>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  try {
    if (!API_URL) throw new Error('EXPO_PUBLIC_API_URL is not set');
    const r = await fetch(API_URL + path, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as T;
    const savedAt = Date.now();
    if (opts.cacheKey) AsyncStorage.setItem(`cache:${opts.cacheKey}`, JSON.stringify({ savedAt, data })).catch(() => {});
    return { data, cached: false, savedAt };
  } catch (e) {
    if (opts.cacheKey) {
      const raw = await AsyncStorage.getItem(`cache:${opts.cacheKey}`);
      if (raw) { const j = JSON.parse(raw); return { data: j.data as T, cached: true, savedAt: j.savedAt }; }
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function ageText(iso?: string | null, nowMs = Date.now()): string {
  if (!iso) return 'time unknown';
  const h = (nowMs - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min old`;
  if (h < 36) return `${Math.round(h)} h old`;
  return `${Math.round(h / 24)} days old`;
}
export const isStale = (iso?: string | null, hours = 36) => !!iso && (Date.now() - new Date(iso).getTime()) / 3_600_000 > hours;

/** Nov 2: is this point on the water? true / false, or null when unknown (offline, server asleep, outside the map).
 *  Catches and whale sightings can't be placed on land. */
export async function onWater(lat: number, lon: number): Promise<boolean | null> {
  try {
    const r = await getJSON<{ water: boolean | null }>(`/water?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { timeoutMs: 8000 });
    return typeof r.data.water === 'boolean' ? r.data.water : null;
  } catch { return null; }
}
