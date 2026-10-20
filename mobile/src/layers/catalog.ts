import { useEffect, useState } from 'react';
import { getJSON } from '../api';
import type { Catalog, ExternalLayer, GridLayer, LayerDate, WindLayer } from '../types';

export const DAY_OFFSETS = [0, 1, 2, 3, 7];

/** Loads the layer catalog (dates, tile URLs, sources), refreshing every 15 min; falls back to the saved copy offline. */
export function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await getJSON<Catalog>('/layers', { cacheKey: 'layers' });
        if (alive) { setCat(r.data); setSavedAt(r.savedAt); setCached(r.cached); }
      } catch { /* no network and nothing saved yet */ }
    };
    load();
    const t = setInterval(load, 15 * 60 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { catalog: cat, savedAt, cached };
}

export const grid = (c: Catalog | null, key: 'sst' | 'chl' | 'bathy') =>
  (c?.layers.find((l) => l.key === key) as GridLayer | undefined) ?? undefined;
export const wind = (c: Catalog | null) => (c?.layers.find((l) => l.key === 'wind') as WindLayer | undefined) ?? undefined;
export const external = (c: Catalog | null, key: string) => (c?.layers.find((l) => l.key === key) as ExternalLayer | undefined) ?? undefined;

/** The satellite day `offset` days before the latest one (spec: Latest / 24 h / 48 h / 3 days / 7 days). */
export function pickDate(dates: LayerDate[] | undefined, offset: number): LayerDate | undefined {
  if (!dates?.length) return undefined;
  if (offset === 0) return dates[0];
  const target = new Date(new Date(dates[0].date + 'T00:00:00Z').getTime() - offset * 86400000).toISOString().slice(0, 10);
  return dates.find((d) => d.date === target);
}
