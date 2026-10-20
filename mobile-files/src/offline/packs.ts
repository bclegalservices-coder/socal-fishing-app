// Home waters offline pack (plan: 'Offline architecture'): chart + seafloor tiles, today's ocean
// tiles, rules & hazards, 30-day tides, and the public spot list — refreshed automatically.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineManager } from '@maplibre/maplibre-react-native';
import { getJSON } from '../api';
import { API_URL, NOAA_CHART_TILES } from '../config';
import { savePublicSpots } from '../storage';
import { readJSON, writeJSON } from './files';
import { isOnline, onWifi } from './network';
import { refreshRules } from './rules';
import type { PackStation } from './tideMath';

export const HOME = { name: 'home-waters', label: 'Southern California & North Baja', ne: [-116.6, 35.0] as [number, number], sw: [-121.0, 31.0] as [number, number] };
const SETTINGS = 'offline-settings:v1';
const STATUS = 'offline-status:v1';

export type OfflineSettings = { wifiOnly: boolean; auto: boolean };
export type OfflineStatus = { chart?: { percent: number; bytes: number; done: boolean; at?: number; error?: string };
  ocean?: { date?: string; percent: number; done: boolean; at?: number }; rules?: { at: number; checked_at: string | null };
  tides?: { at: number; through: string }; spots?: { at: number; count: number }; lastRun?: number };

export async function getSettings(): Promise<OfflineSettings> {
  try { return { wifiOnly: true, auto: true, ...JSON.parse((await AsyncStorage.getItem(SETTINGS)) ?? '{}') }; } catch { return { wifiOnly: true, auto: true }; }
}
export const setSettings = (s: OfflineSettings) => AsyncStorage.setItem(SETTINGS, JSON.stringify(s));
export async function getStatus(): Promise<OfflineStatus> { try { return JSON.parse((await AsyncStorage.getItem(STATUS)) ?? '{}'); } catch { return {}; } }
const patch = async (p: Partial<OfflineStatus>) => { const s = { ...(await getStatus()), ...p }; await AsyncStorage.setItem(STATUS, JSON.stringify(s)); return s; };

const styleUrl = (tiles: string[]) => `${API_URL}/offline/style.json?${tiles.map((t) => `tiles=${encodeURIComponent(t)}`).join('&')}`;

function createPack(name: string, tiles: string[], ne: [number, number], sw: [number, number], minZoom: number, maxZoom: number,
  onProgress: (pct: number, bytes: number, done: boolean) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // MapLibre v11: packs get a generated id; we keep our own name in metadata. Bounds are [west, south, east, north].
    OfflineManager.createPack(
      { mapStyle: styleUrl(tiles), bounds: [sw[0], sw[1], ne[0], ne[1]], minZoom, maxZoom, metadata: { name, createdAt: Date.now() } },
      (_pack: any, st: any) => {
        const pct = Math.round(st?.percentage ?? 0), bytes = st?.completedResourceSize ?? 0, done = pct >= 100 || st?.state === 'complete';
        onProgress(pct, bytes, done);
        if (done) resolve();
      },
      (_pack: any, err: any) => reject(new Error(err?.message ?? 'Download failed')),
    ).catch(reject);
  });
}

/** Offline packs are looked up by the name we stored in their metadata. */
async function packIdsNamed(name: string): Promise<string[]> {
  const packs: any[] = (await OfflineManager.getPacks().catch(() => [])) ?? [];
  return packs.filter((p) => (p.metadata?.name ?? p.name) === name).map((p) => p.id);
}
async function deleteNamed(name: string) {
  for (const id of await packIdsNamed(name)) await OfflineManager.deletePack(id).catch(() => {});
}

async function replacePack(name: string, tiles: string[], ne: [number, number], sw: [number, number], minZoom: number, maxZoom: number,
  onProgress: (pct: number, bytes: number, done: boolean) => void) {
  await deleteNamed(name);
  return createPack(name, tiles, ne, sw, minZoom, maxZoom, onProgress);
}

/** Chart + seafloor for the whole region (zoom 5–12). Big, so normally only on Wi-Fi. */
export async function downloadChartPack(bathyTiles: string | null, onProgress?: (s: OfflineStatus) => void) {
  OfflineManager.setTileCountLimit?.(200000);
  const tiles = [NOAA_CHART_TILES, ...(bathyTiles ? [bathyTiles] : [])];
  await replacePack(HOME.name, tiles, HOME.ne, HOME.sw, 5, 12, async (percent, bytes, done) => {
    const s = await patch({ chart: { percent, bytes, done, at: done ? Date.now() : undefined } });
    onProgress?.(s);
  });
}

/** Today's water temperature + chlorophyll tiles (small: zoom 5–9). */
export async function downloadOceanPack(sstTiles: string | null, chlTiles: string | null, date: string | undefined, onProgress?: (s: OfflineStatus) => void) {
  const tiles = [sstTiles, chlTiles].filter(Boolean) as string[];
  if (!tiles.length) return;
  await replacePack('home-ocean', tiles, HOME.ne, HOME.sw, 5, 9, async (percent, _b, done) => {
    const s = await patch({ ocean: { date, percent, done, at: done ? Date.now() : undefined } });
    onProgress?.(s);
  });
}

/** Extra detail for one area you're about to fish (zoom 10–14). */
export async function downloadArea(name: string, ne: [number, number], sw: [number, number], extraTiles: string[], onProgress: (pct: number) => void) {
  await replacePack(`area-${name}`, [NOAA_CHART_TILES, ...extraTiles], ne, sw, 10, 14, (pct) => onProgress(pct));
}

export async function downloadSmallData(): Promise<OfflineStatus> {
  const rules = await refreshRules().catch(() => null);
  if (rules) await patch({ rules: { at: Date.now(), checked_at: rules.checked_at } });
  const tides = await getJSON<{ through: string; stations: PackStation[] }>('/tides/pack?region=socal&days=30', { timeoutMs: 60000 }).catch(() => null);
  if (tides) { await writeJSON('tides.json', tides.data); await patch({ tides: { at: Date.now(), through: tides.data.through } }); }
  const spots = await fetch(`${API_URL}/spots?bbox=-121,31,-116,35`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (spots) { await savePublicSpots(spots); await patch({ spots: { at: Date.now(), count: spots.features?.length ?? 0 } }); }
  return getStatus();
}
export const loadTidePack = () => readJSON<{ through: string; stations: PackStation[] }>('tides.json');

export async function listPacks(): Promise<{ name: string; bytes: number; percent: number }[]> {
  const packs: any[] = (await OfflineManager.getPacks?.()) ?? [];
  const out = [];
  for (const p of packs) {
    const st = await p.status?.().catch(() => null);
    out.push({ name: String(p.metadata?.name ?? p.name ?? p.id), bytes: st?.completedResourceSize ?? 0, percent: Math.round(st?.percentage ?? 0) });
  }
  return out;
}
export const deletePack = (name: string) => deleteNamed(name);

/**
 * Automatic refresh (app open + every few hours): small data and today's ocean tiles whenever online;
 * the big chart pack only when missing/older than 30 days and (by default) on Wi-Fi.
 */
export async function autoRefresh(catalog: any, force = false, onProgress?: (s: OfflineStatus) => void) {
  const settings = await getSettings();
  if (!(await isOnline()) || (!settings.auto && !force)) return getStatus();
  const st = await getStatus();
  if (!force && st.lastRun && Date.now() - st.lastRun < 3 * 3600000) return st;
  await patch({ lastRun: Date.now() });
  await downloadSmallData();
  const g = (k: string) => catalog?.layers?.find((l: any) => l.key === k);
  const sstD = g('sst')?.dates?.[0], chlD = g('chl')?.dates?.[0];
  if (sstD && (force || (await getStatus()).ocean?.date !== sstD.date)) {
    await downloadOceanPack(sstD.tiles, chlD?.tiles ?? null, sstD.date, onProgress).catch(() => {});
  }
  const chartOld = !st.chart?.done || !st.chart.at || Date.now() - st.chart.at > 30 * 86400000;
  if ((force || chartOld) && (!settings.wifiOnly || (await onWifi()))) {
    await downloadChartPack(g('bathy')?.dates?.[0]?.tiles ?? null, onProgress).catch(async (e) => patch({ chart: { percent: 0, bytes: 0, done: false, error: String(e?.message ?? e) } }));
  }
  return getStatus();
}
