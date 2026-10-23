// Auto route: asks our server for the shortest water route (around land, breakwaters and docks, using NOAA charts),
// like Navionics / Garmin Auto Guidance. With no signal, or if the server can't find one, the app offers the
// straight line instead and says so.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from './config';
import type { Pt } from './nav';

export type RoutePt = Pt & { target?: boolean };
export type AutoRoute = {
  points: RoutePt[]; distance_nm: number; straight_nm: number; turns: number; safety_ft: number;
  warnings: { kind: string; text: string; lat?: number; lon?: number; min_ft?: number }[]; note: string;
  /** Set when you were on land: the route starts at this launch ramp / marina instead. */
  start_from?: { name: string; kind: string; lat: number; lon: number; distance_nm: number };
};

const SAFETY_KEY = 'route-safety-ft:v1';
export const SAFETY_CHOICES = [4, 6, 8, 10, 15, 20, 30];
let safety = 8;
AsyncStorage.getItem(SAFETY_KEY).then((v) => { const n = Number(v); if (n > 0) safety = n; }).catch(() => {});
export const getSafetyFt = () => safety;
export function setSafetyFt(ft: number) { safety = ft; AsyncStorage.setItem(SAFETY_KEY, String(ft)).catch(() => {}); }

/** points: start (your boat), any stops, destination. Throws an Error with a plain-English message. */
export async function fetchAutoRoute(points: Pt[], safetyFt = safety): Promise<AutoRoute> {
  if (!API_URL) throw new Error('Auto route needs the server address (app settings).');
  const pts = points.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(';');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);   // the free server may need a moment to wake up
  try {
    const r = await fetch(`${API_URL}/route?pts=${encodeURIComponent(pts)}&safety_ft=${safetyFt}`, { signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.detail ?? `The server couldn't make a route (error ${r.status}).`);
    if (!Array.isArray(j?.points) || j.points.length < 2) throw new Error('The server sent back an empty route.');
    return j as AutoRoute;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('No answer from the server — weak signal?');
    if (/Network request failed/i.test(String(e?.message))) throw new Error('No signal right now.');
    throw e;
  } finally { clearTimeout(timer); }
}
