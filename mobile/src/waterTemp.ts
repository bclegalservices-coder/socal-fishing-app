// Water temperature at a point, from the same satellite map you see on the chart (our server's /conditions).
// For the boat it re-checks after you move half a mile or every 15 minutes, and keeps the last reading for offline.
import { useEffect, useRef, useState } from 'react';
import { getJSON } from './api';
import { distanceNm } from './geo';
import type { Conditions } from './types';

export type WaterTemp = { f: number | null; label: string; cached: boolean };

export function useWaterTemp(lat: number | null | undefined, lon: number | null | undefined, opts: { boat?: boolean } = {}): WaterTemp | null {
  const [w, setW] = useState<WaterTemp | null>(null);
  const last = useRef<{ lat: number; lon: number; t: number } | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    if (lat == null || lon == null) return;
    const l = last.current;
    if (opts.boat && l && distanceNm(l.lat, l.lon, lat, lon) < 0.5 && Date.now() - l.t < 15 * 60000) return;
    if (!opts.boat && l && l.lat === lat && l.lon === lon) return;
    last.current = { lat, lon, t: Date.now() };
    if (!opts.boat) setW(null);
    getJSON<Conditions>(`/conditions?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&fields=water`, { timeoutMs: 10000, cacheKey: opts.boat ? 'water-boat' : undefined })
      .then((r) => {
        if (!alive.current) return;
        const it = r.data.water?.items?.find((m) => m.type === 'sst');
        setW({ f: typeof it?.value === 'number' ? it.value : null, label: it?.label ?? 'No water temp here', cached: r.cached });
      })
      .catch(() => { last.current = null; });   // try again on the next GPS fix
  }, [lat, lon]);
  return w;
}
