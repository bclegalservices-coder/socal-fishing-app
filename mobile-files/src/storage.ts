// On-device storage. Everything here works offline; cloud sync is added in Week 4.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Pt, TrackPoint } from './nav';
import { readJSON, remove, writeJSON } from './offline/files';

export type SavedSpot = { id: string; name: string; lat: number; lon: number; createdAt: number; folder?: string; notes?: string };
export type Route = { id: string; name: string; points: Pt[]; createdAt: number };
export type TrackMeta = { id: string; name: string; startedAt: number; endedAt: number; distanceNm: number; maxKt: number; avgMovingKt: number; points: number };
export type ActiveTrack = { id: string; startedAt: number; mode: 'background' | 'foreground'; points: TrackPoint[] };

const K = { spots: 'spots:v1', routes: 'routes:v1', tracks: 'tracks:v1', active: 'track:active', track: (id: string) => `track:${id}`, publicSpots: 'public-spots:v1' };

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try { const v = await AsyncStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
const setJSON = (key: string, v: unknown) => AsyncStorage.setItem(key, JSON.stringify(v));
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const loadSpots = () => getJSON<SavedSpot[]>(K.spots, []);
export const saveSpots = (s: SavedSpot[]) => setJSON(K.spots, s);
export const loadRoutes = () => getJSON<Route[]>(K.routes, []);
export const saveRoutes = (r: Route[]) => setJSON(K.routes, r);
export const loadTracks = () => getJSON<TrackMeta[]>(K.tracks, []);
export const saveTracks = (t: TrackMeta[]) => setJSON(K.tracks, t);
// Track points can be large, so they live in files (older installs: migrated on first read).
export async function loadTrackPoints(id: string): Promise<TrackPoint[]> {
  const f = await readJSON<TrackPoint[]>(K.track(id));
  if (f) return f;
  const old = await getJSON<TrackPoint[]>(K.track(id), []);
  if (old.length) { await writeJSON(K.track(id), old); await AsyncStorage.removeItem(K.track(id)); }
  return old;
}
export const saveTrackPoints = (id: string, p: TrackPoint[]) => writeJSON(K.track(id), p);
export const deleteTrackPoints = async (id: string) => { await remove(K.track(id)); await AsyncStorage.removeItem(K.track(id)); };
export const loadActive = () => getJSON<ActiveTrack | null>(K.active, null);
export const saveActive = (a: ActiveTrack | null) => (a ? setJSON(K.active, a) : AsyncStorage.removeItem(K.active));
// Public fishing spots cached so they still show offshore with no signal.
export const loadPublicSpots = () => getJSON<any>(K.publicSpots, null);
export const savePublicSpots = (fc: any) => setJSON(K.publicSpots, fc);
