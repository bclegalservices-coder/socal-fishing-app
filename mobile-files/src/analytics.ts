// Anonymous first-party usage stats (no third-party SDK). What's sent: a random install ID made on this phone,
// event names (e.g. "layer_on"), tiny properties (e.g. layer: "sst"), app version, platform and a COARSE area
// ("Orange County", "Offshore SoCal") — never coordinates, names, emails or notes. People can switch it off.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { API_URL } from './config';

type Ev = { name: string; props?: Record<string, string | number | boolean>; at: string; session_id: string };
const QUEUE = 'analytics-queue:v1';
const OPTOUT = 'analytics-optout';
const IID = 'analytics-install-id';

let queue: Ev[] = [];
let installId = '';
let sessionId = '';
let sessionStart = 0;
let backgroundAt = 0;
let area = 'Unknown';
export const currentArea = () => area;   // coarse, e.g. 'Orange County' — used to pick local sponsors
let signedIn = false;
let optedOut = false;
let remoteEnabled = true;
let started = false;

const rnd = () => Math.random().toString(16).slice(2, 10);
function uuid() {
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  h[12] = '4'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`;
}

// Coarse areas only. Order matters: islands before the coast around them.
const AREAS: { name: string; lat: number; lon: number; nm: number }[] = [
  { name: 'Catalina', lat: 33.38, lon: -118.42, nm: 10 }, { name: 'San Clemente Island', lat: 32.9, lon: -118.5, nm: 12 },
  { name: 'Channel Islands', lat: 33.95, lon: -119.8, nm: 30 }, { name: 'Los Angeles', lat: 33.85, lon: -118.35, nm: 18 },
  { name: 'Orange County', lat: 33.55, lon: -117.85, nm: 15 }, { name: 'San Diego', lat: 32.85, lon: -117.25, nm: 18 },
  { name: 'Santa Barbara / Ventura', lat: 34.3, lon: -119.4, nm: 30 },
];
export function areaFor(lat: number, lon: number): string {
  const d = (a: number, b: number) => Math.hypot((a - lat) * 60, (b - lon) * 60 * Math.cos((lat * Math.PI) / 180));
  const hit = AREAS.find((x) => d(x.lat, x.lon) <= x.nm);
  if (hit) return hit.name;
  if (lat < 32.53 && lat > 29.5 && lon > -118.5 && lon < -115) return 'North Baja';
  if (lat > 31 && lat < 35 && lon > -121.5 && lon < -116.5) return 'Offshore SoCal';
  return 'Other';
}

export async function initAnalytics() {
  if (started) return;
  started = true;
  optedOut = (await AsyncStorage.getItem(OPTOUT)) === '1';
  installId = (await AsyncStorage.getItem(IID)) ?? '';
  if (!installId) { installId = uuid(); await AsyncStorage.setItem(IID, installId); }
  try { queue = JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? '[]'); } catch { queue = []; }
  newSession();
  AppState.addEventListener('change', (s) => {
    if (s === 'background' || s === 'inactive') {
      if (!backgroundAt) {
        backgroundAt = Date.now();
        track('session_end', { duration_s: Math.round((Date.now() - sessionStart) / 1000) });
        flush();
      }
    } else if (s === 'active') {
      if (backgroundAt && Date.now() - backgroundAt > 30 * 60000) { newSession(); track('app_open', { resumed: true }); }
      backgroundAt = 0;
    }
  });
  setInterval(flush, 60000);
}
function newSession() { sessionId = `${Date.now().toString(36)}${rnd()}`; sessionStart = Date.now(); }

export function track(name: string, props?: Ev['props']) {
  if (optedOut || !remoteEnabled || !started) return;
  queue.push({ name, props, at: new Date().toISOString(), session_id: sessionId });
  if (queue.length > 500) queue = queue.slice(-500);
  AsyncStorage.setItem(QUEUE, JSON.stringify(queue)).catch(() => {});
}

let lastAreaAt = 0;
export function setArea(lat: number, lon: number) {
  if (Date.now() - lastAreaAt < 60000) return;
  lastAreaAt = Date.now();
  area = areaFor(lat, lon);
}
export const setSignedIn = (b: boolean) => { signedIn = b; };
export const setRemoteEnabled = (b: boolean) => { remoteEnabled = b; if (!b) { queue = []; AsyncStorage.removeItem(QUEUE); } };

let flushing = false;
export async function flush() {
  if (flushing || !queue.length || !API_URL || optedOut || !remoteEnabled) return;
  flushing = true;
  const batch = queue.slice(0, 200);
  try {
    const r = await fetch(`${API_URL}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        install_id: installId, platform: Platform.OS, app_version: (Constants as any).expoConfig?.version ?? null,
        os_version: String(Platform.Version ?? ''), area, signed_in: signedIn,
        device_class: ({ 1: 'phone', 2: 'tablet', 3: 'desktop' } as Record<number, string>)[(Device as any).deviceType] ?? 'unknown',
        events: batch,
      }),
    });
    if (r.ok || r.status === 400) { queue = queue.slice(batch.length); await AsyncStorage.setItem(QUEUE, JSON.stringify(queue)); }
  } catch { /* offline: try again later */ } finally { flushing = false; }
}

export async function getOptOut() { return (await AsyncStorage.getItem(OPTOUT)) === '1'; }
export async function setOptOut(b: boolean) {
  optedOut = b;
  await AsyncStorage.setItem(OPTOUT, b ? '1' : '0');
  if (b) { queue = []; await AsyncStorage.removeItem(QUEUE); }
}
