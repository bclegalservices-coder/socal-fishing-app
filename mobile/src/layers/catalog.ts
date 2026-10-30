import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getJSON } from '../api';
import type { Catalog, ExternalLayer, GridLayer, HdBottomLayer, LayerDate, WindLayer } from '../types';

export const DAY_OFFSETS = [0, 1, 2, 3, 7];

/** Loads the layer catalog (dates, tile URLs, sources), refreshing every 15 min; falls back to the saved copy offline.
 *  The server can take up to a minute to wake up, so the first try waits longer, a failed try is retried soon
 *  (20 s, 1 min, 2 min, then every 5 min) and again whenever the app comes back to the front. */
export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fails = 0;
    const schedule = (ms: number) => { if (timer) clearTimeout(timer); timer = setTimeout(load, ms); };
    async function load() {
      try {
        const r = await getJSON<Catalog>('/layers', { cacheKey: 'layers', timeoutMs: fails === 0 ? 45000 : 25000 });
        if (!alive) return;
        setCat(r.data); setSavedAt(r.savedAt); setCached(r.cached);
        if (r.cached) { fails += 1; schedule(RETRY[Math.min(fails - 1, RETRY.length - 1)]); }
        else { fails = 0; schedule(15 * 60 * 1000); }
      } catch {
        /* no network and nothing saved yet */
        if (alive) { fails += 1; schedule(RETRY[Math.min(fails - 1, RETRY.length - 1)]); }
      }
    }
    load();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') { fails = 0; load(); } });
    return () => { alive = false; if (timer) clearTimeout(timer); sub.remove(); };
  }, [retryKey]);
  return { catalog: cat, savedAt, cached, retry: () => setRetryKey((k) => k + 1) };
}
const RETRY = [20000, 60000, 120000, 300000];

/** A grid layer, keeping only dates that really have map tiles. A date with a blank tile address makes the map
 *  engine crash (Oct 20), so a damaged catalog — even an old saved copy — can never reach the map. */
export const grid = (c: Catalog | null, key: 'sst' | 'chl' | 'bathy'): GridLayer | undefined => {
  const l = c?.layers.find((x) => x.key === key) as GridLayer | undefined;
  if (!l) return undefined;
  const dates = (l.dates ?? []).filter((d: any) => typeof d?.tiles === 'string' && d.tiles.startsWith('http'));
  return dates.length ? { ...l, dates } : { ...l, dates: [], available: false } as GridLayer;
};
/** HD bottom, only when its tile address is a real web address (same crash guard as the grid layers). */
export const hdBottom = (c: Catalog | null): HdBottomLayer | undefined => {
  const l = c?.layers.find((x) => x.key === 'bottomhd') as HdBottomLayer | undefined;
  return l && typeof l.tiles === 'string' && l.tiles.startsWith('http') ? l : undefined;
};
/** Oct 29: HD bottom for all of SoCal (to zoom 14), drawn under the sharper pilot area. */
export const hdBottomWide = (c: Catalog | null): HdBottomLayer | undefined => {
  const l = c?.layers.find((x) => x.key === 'bottomhd_socal') as HdBottomLayer | undefined;
  return l && typeof l.tiles === 'string' && l.tiles.startsWith('http') ? l : undefined;
};
export const harborsOf = (c: Catalog | null) => (c?.layers.find((l) => l.key === 'harbors') as any) ?? undefined;
export const wind = (c: Catalog | null) => (c?.layers.find((l) => l.key === 'wind') as WindLayer | undefined) ?? undefined;
export const external = (c: Catalog | null, key: string) => (c?.layers.find((l) => l.key === key) as ExternalLayer | undefined) ?? undefined;

/** The satellite day `offset` days before the latest one (spec: Latest / 24 h / 48 h / 3 days / 7 days).
 *  Oct 27: when that exact day wasn't saved (a missed download), use the closest older day instead of showing nothing
 *  — a missing day used to make the whole layer disappear even though its switch was on. */
export function pickDate(dates: LayerDate[] | undefined, offset: number): LayerDate | undefined {
  if (!dates?.length) return undefined;
  if (offset === 0) return dates[0];
  const target = new Date(new Date(dates[0].date + 'T00:00:00Z').getTime() - offset * 86400000).toISOString().slice(0, 10);
  return dates.find((d) => d.date === target) ?? dates.find((d) => d.date < target) ?? dates[dates.length - 1];
}
