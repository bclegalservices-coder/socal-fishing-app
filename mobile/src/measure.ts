// Measure tool math: distance and bearing for each leg between tapped points, and the total. Pure, offline, tested.
import { bearingTrue, distanceNm } from './geo';

export type MPt = { lat: number; lon: number };
export type Leg = { from: MPt; to: MPt; nm: number; brg: number; mid: MPt };

export function legs(pts: MPt[]): Leg[] {
  const out: Leg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    out.push({ from: a, to: b, nm: distanceNm(a.lat, a.lon, b.lat, b.lon), brg: bearingTrue(a.lat, a.lon, b.lat, b.lon),
      mid: { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 } });
  }
  return out;
}
/** Nov 2: press-and-hold a point, then drag it — puts point i at its new spot (others stay put). */
export function movePoint(pts: MPt[], i: number, to: MPt): MPt[] {
  if (i < 0 || i >= pts.length || !isFinite(to.lat) || !isFinite(to.lon)) return pts;
  return pts.map((p, j) => (j === i ? { lat: to.lat, lon: to.lon } : p));
}
export const totalNm = (pts: MPt[]) => legs(pts).reduce((s, l) => s + l.nm, 0);
/** 263° for labels; always three digits like a chart (005°). */
export const deg3 = (d: number) => `${String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
/** The line and the points as map data. */
export function measureFC(pts: MPt[]): any {
  const feats: any[] = pts.map((p, i) => ({ type: 'Feature', properties: { i, end: i === 0 || i === pts.length - 1 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
  if (pts.length > 1) feats.unshift({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } });
  return { type: 'FeatureCollection', features: feats };
}
