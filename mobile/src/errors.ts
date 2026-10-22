// Free, built-in crash reporting: catches JavaScript crashes, saves them on the phone (the app may be about to close),
// and sends them to our API the next time it can. Admin console → "Feedback & crashes" shows them.
// No names, emails or locations are sent — just the error, where in the code it happened, app version and phone type.
// (Native iOS crashes still show in Xcode → Window → Organizer → Crashes once the app is on TestFlight.)
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_URL } from './config';

const KEY = 'pending-errors:v1';
export type ErrReport = { message: string; stack: string; fatal: boolean; context: string; at: string; version: string; os: string; runtime: string };

let lastScreen = 'map';
export const setErrorScreen = (s: string) => { lastScreen = s; };

const version = () => String((Constants as any).expoConfig?.version ?? '');
function make(e: any, fatal: boolean, context: string): ErrReport {
  const err = e instanceof Error ? e : new Error(String(e?.message ?? e));
  return {
    message: String(err.message || err.name || 'Unknown error').slice(0, 500),
    stack: String(err.stack ?? '').split('\n').slice(0, 25).join('\n').slice(0, 4000),
    fatal, context: `${context} · screen ${lastScreen}`.slice(0, 200), at: new Date().toISOString(),
    version: version(), os: `${Platform.OS} ${Platform.Version}`, runtime: String((Constants as any).expoConfig?.runtimeVersion ?? ''),
  };
}

async function save(r: ErrReport) {
  try {
    const list: ErrReport[] = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    // Skip exact repeats within a minute (a render loop can throw the same thing 100 times).
    if (list.some((x) => x.message === r.message && Math.abs(Date.parse(x.at) - Date.parse(r.at)) < 60000)) return;
    list.push(r);
    await AsyncStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch { /* storage full or broken: nothing else to do */ }
}

/** Send whatever is waiting. Called at startup and right after an error. */
export async function flushErrors() {
  if (!API_URL) return;
  try {
    const list: ErrReport[] = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]');
    if (!list.length) return;
    const r = await fetch(`${API_URL}/reports/errors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errors: list }) });
    if (r.ok) await AsyncStorage.removeItem(KEY);
  } catch { /* offline: try next launch */ }
}

/** For errors we catch ourselves (e.g. the "Something went wrong" screen). */
export async function reportError(e: any, context = 'caught', fatal = false) {
  await save(make(e, fatal, context));
  flushErrors();
}

let installed = false;
export function installCrashReporter() {
  if (installed) return;
  installed = true;
  const EU = (globalThis as any).ErrorUtils;
  if (!EU?.setGlobalHandler) return;
  const prev = EU.getGlobalHandler?.();
  EU.setGlobalHandler((e: any, isFatal?: boolean) => {
    save(make(e, !!isFatal, 'global')).finally(() => { flushErrors(); });
    prev?.(e, isFatal);
  });
  flushErrors();
}

/** Every download (GET) gives up after 30 seconds unless the caller set its own limit, so a slow or stuck server
 *  can never leave a screen spinning forever. Uploads (photos, posts) are left alone — they can take longer at sea. */
export function installFetchTimeout(ms = 30000) {
  const g = globalThis as any;
  if (g.__fetchTimeout) return;
  g.__fetchTimeout = true;
  const orig = g.fetch.bind(g);
  g.fetch = (input: any, init?: any) => {
    const method = String(init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET').toUpperCase();
    if (init?.signal || (method !== 'GET' && method !== 'HEAD')) return orig(input, init);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return orig(input, { ...(init ?? {}), signal: ctrl.signal }).finally(() => clearTimeout(t));
  };
}
