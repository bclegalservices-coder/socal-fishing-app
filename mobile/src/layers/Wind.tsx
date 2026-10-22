// WindAlert-style wind: the water colored by forecast wind speed, plus short white streaks that drift with the wind.
// Pure MapLibre (a raster layer + a GeoJSON line layer updated ~12 times a second), so no extra phone add-ons.
// The streaks pause when the app is in the background or the wind layer is off, to save battery.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { GeoJSONSource, Layer, RasterSource } from '@maplibre/maplibre-react-native';
import { okTile } from '../config';

type UV = { lats: number[]; lons: number[]; u: (number | null)[][]; v: (number | null)[][] };
type View4 = { minLon: number; minLat: number; maxLon: number; maxLat: number; zoom: number } | null;
type Hour = { fh: number; valid: string; url: string; tiles?: string | null; uv?: string; model?: string };

const PARTICLES = 950;
const TRAIL = 10;         // points per streak
const FRAME_MS = 70;
const EMPTY = { type: 'FeatureCollection' as const, features: [] as any[] };

/** Bilinear wind (m/s) at a point; null outside the grid. */
export function sampleUV(g: UV, lon: number, lat: number): [number, number] | null {
  const { lats, lons } = g;
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return null;
  const fi = Math.min(lats.length - 1.000001, ((lat - lats[0]) / (lats[lats.length - 1] - lats[0])) * (lats.length - 1));
  const fj = Math.min(lons.length - 1.000001, ((lon - lons[0]) / (lons[lons.length - 1] - lons[0])) * (lons.length - 1));
  const i = Math.floor(fi), j = Math.floor(fj), di = fi - i, dj = fj - j;
  const at = (a: (number | null)[][], ii: number, jj: number) => a[ii]?.[jj];
  const mix = (a: (number | null)[][]) => {
    const p = [at(a, i, j), at(a, i, j + 1), at(a, i + 1, j), at(a, i + 1, j + 1)];
    if (p.some((x) => x == null)) return null;
    const [a00, a01, a10, a11] = p as number[];
    return a00 * (1 - di) * (1 - dj) + a01 * (1 - di) * dj + a10 * di * (1 - dj) + a11 * di * dj;
  };
  const u = mix(g.u), v = mix(g.v);
  return u == null || v == null ? null : [u, v];
}

export function WindLayer({ hour, on, opacity, view }: { hour?: Hour; on: boolean; opacity: number; view: View4 }) {
  const [grid, setGrid] = useState<UV | null>(null);
  const [fc, setFc] = useState<any>(EMPTY);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const parts = useRef<{ trail: [number, number][]; age: number; life: number }[]>([]);

  useEffect(() => { const s = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => s.remove(); }, []);

  // Load the small wind grid for the chosen forecast hour.
  useEffect(() => {
    let alive = true;
    if (!on || !hour?.uv || !hour.uv.startsWith('http')) { setGrid(null); return; }
    fetch(hour.uv).then((r) => (r.ok ? r.json() : null)).then((g) => { if (alive && g?.u?.length) setGrid(g); }).catch(() => {});
    return () => { alive = false; };
  }, [on, hour?.uv]);

  const box = useMemo(() => view && { ...view }, [view?.minLon, view?.minLat, view?.maxLon, view?.maxLat, view?.zoom]);

  // Move the streaks.
  useEffect(() => {
    if (!on || !grid || !box || !active) { setFc(EMPTY); return; }
    const spawn = () => {
      const lon = box.minLon + Math.random() * (box.maxLon - box.minLon);
      const lat = box.minLat + Math.random() * (box.maxLat - box.minLat);
      return { trail: [[lon, lat]] as [number, number][], age: 0, life: 25 + Math.floor(Math.random() * 40) };
    };
    parts.current = Array.from({ length: PARTICLES }, spawn);
    // Screen-based speed: a 20-knot wind moves a streak ~2.5 screen points per frame at any zoom.
    const degPerPx = 360 / (256 * 2 ** box.zoom);
    const step = (degPerPx * 3.2) / 10.3;   // per (m/s)
    const t = setInterval(() => {
      const feats: any[] = [];
      for (let k = 0; k < parts.current.length; k++) {
        let p = parts.current[k];
        const [lon, lat] = p.trail[p.trail.length - 1];
        const w = sampleUV(grid, lon, lat);
        p.age++;
        if (!w || p.age > p.life || lon < box.minLon || lon > box.maxLon || lat < box.minLat || lat > box.maxLat) {
          p = parts.current[k] = spawn();
          continue;
        }
        const kc = 1 / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
        p.trail.push([lon + w[0] * step * kc, lat + w[1] * step]);
        if (p.trail.length > TRAIL) p.trail.shift();
        if (p.trail.length >= 2) {
          const fade = Math.min(1, p.age / 6, (p.life - p.age) / 6);
          feats.push({ type: 'Feature', properties: { o: Math.max(0, fade) }, geometry: { type: 'LineString', coordinates: p.trail.slice() } });
        }
      }
      setFc({ type: 'FeatureCollection', features: feats });
    }, FRAME_MS);
    return () => clearInterval(t);
  }, [on, grid, box, active]);

  if (!on || !hour) return null;
  return (
    <>
      {okTile(hour.tiles) ? (
        <RasterSource key={`wind-${hour.tiles}`} id="wind-speed" tiles={[hour.tiles]} tileSize={256} minzoom={5} maxzoom={8}>
          <Layer key="wind-speed-layer" type="raster" id="wind-speed-layer" style={{ rasterOpacity: opacity, rasterFadeDuration: 0, rasterResampling: 'linear' }} />
        </RasterSource>
      ) : null}
      <GeoJSONSource id="wind-streaks" data={fc}>
        <Layer key="wind-streaks-line" type="line" id="wind-streaks-line"
          style={{ lineColor: '#FFFFFF', lineWidth: 2.2, lineCap: 'round', lineOpacity: ['*', Math.min(1, Math.max(0.3, opacity * 1.7)), ['get', 'o']] as any }} />
      </GeoJSONSource>
    </>
  );
}
