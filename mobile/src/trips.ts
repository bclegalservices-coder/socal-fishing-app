// Trip (track) math for the Trips screen and trip playback. Pure functions, all offline, unit-tested (trips.test.ts).
import { bearingTrue, distanceNm } from './geo';
import type { TrackPoint } from './nav';
import type { TrackMeta } from './storage';

export type TripAnalysis = {
  pts: TrackPoint[];
  cumNm: number[];        // distance from the start at each point
  kt: number[];           // smoothed speed at each point
  t0: number; t1: number; // first and last fix (ms)
  durationMin: number; movingMin: number; distanceNm: number; maxKt: number; avgMovingKt: number;
};

/** Speeds, distances and totals for one trip. Speed comes from the GPS when it reported one, else from the distance between fixes. */
export function analyze(pts: TrackPoint[]): TripAnalysis {
  const n = pts.length;
  const cumNm = new Array<number>(n).fill(0);
  const raw = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = distanceNm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    cumNm[i] = cumNm[i - 1] + d;
    const hrs = (pts[i].t - pts[i - 1].t) / 3_600_000;
    const seg = hrs > 0 ? d / hrs : 0;
    raw[i] = pts[i].sog != null && pts[i].sog! >= 0 ? pts[i].sog! : seg;
  }
  if (n > 1) raw[0] = raw[1];
  // light smoothing (5 points) so one bad fix doesn't spike the graph; ignore impossible jumps (> 80 kt)
  const kt = raw.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (raw[j] < 80) { s += raw[j]; c++; }
    return c ? s / c : 0;
  });
  let maxKt = 0, movingMs = 0, movingNm = 0;
  for (let i = 1; i < n; i++) {
    if (kt[i] < 80) maxKt = Math.max(maxKt, kt[i]);
    if (kt[i] > 1) { movingMs += pts[i].t - pts[i - 1].t; movingNm += cumNm[i] - cumNm[i - 1]; }
  }
  const t0 = n ? pts[0].t : 0, t1 = n ? pts[n - 1].t : 0;
  return { pts, cumNm, kt, t0, t1, durationMin: (t1 - t0) / 60000, movingMin: movingMs / 60000, distanceNm: n ? cumNm[n - 1] : 0,
    maxKt, avgMovingKt: movingMs > 0 ? movingNm / (movingMs / 3_600_000) : 0 };
}

export type TripMoment = { lat: number; lon: number; kt: number; distNm: number; elapsedMs: number; heading: number; i: number };

/** Where the boat was, how fast and how far along, `elapsedMs` after the start (between fixes it's interpolated). */
export function at(a: TripAnalysis, elapsedMs: number): TripMoment {
  const { pts } = a;
  if (!pts.length) return { lat: 0, lon: 0, kt: 0, distNm: 0, elapsedMs: 0, heading: 0, i: 0 };
  const t = Math.min(Math.max(a.t0 + elapsedMs, a.t0), a.t1);
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
  const p = pts[lo], q = pts[hi];
  const f = q.t > p.t ? (t - p.t) / (q.t - p.t) : 0;
  const heading = lo === hi ? 0 : bearingTrue(p.lat, p.lon, q.lat, q.lon);
  return { lat: p.lat + (q.lat - p.lat) * f, lon: p.lon + (q.lon - p.lon) * f, kt: a.kt[lo] + (a.kt[hi] - a.kt[lo]) * f,
    distNm: a.cumNm[lo] + (a.cumNm[hi] - a.cumNm[lo]) * f, elapsedMs: t - a.t0, heading, i: lo };
}

/** Speed over the trip in `n` equal time slices (highest speed in each slice), for the speed graph. */
export function speedBins(a: TripAnalysis, n = 48): number[] {
  const out = new Array<number>(n).fill(0);
  const span = a.t1 - a.t0;
  if (span <= 0) return out;
  a.pts.forEach((p, i) => { const b = Math.min(n - 1, Math.floor(((p.t - a.t0) / span) * n)); out[b] = Math.max(out[b], a.kt[i]); });
  return out;
}

// ---------------- speed colors for the track line (slow → fast) ----------------
export const SPEED_BANDS: { upTo: number; color: string; label: string }[] = [
  { upTo: 3, color: '#2D7FF9', label: 'Drifting / trolling' },
  { upTo: 10, color: '#14B8A6', label: 'Slow' },
  { upTo: 20, color: '#84CC16', label: 'Cruising' },
  { upTo: 30, color: '#F5B700', label: 'Fast' },
  { upTo: Infinity, color: '#F2542D', label: 'Wide open' },
];
export const speedColor = (kt: number) => (SPEED_BANDS.find((b) => kt < b.upTo) ?? SPEED_BANDS[SPEED_BANDS.length - 1]).color;

/** The track as line pieces colored by speed (neighbors in the same band are merged). Up to `uptoMs` after the start only, if given. */
export function speedLines(a: TripAnalysis, uptoMs?: number): any {
  const feats: any[] = [];
  const end = uptoMs == null ? Infinity : a.t0 + uptoMs;
  let cur: number[][] = [], col = '';
  for (let i = 1; i < a.pts.length; i++) {
    if (a.pts[i - 1].t > end) break;
    const c = speedColor(a.kt[i]);
    const p = a.pts[i - 1];
    let q: { lat: number; lon: number } = a.pts[i];
    if (a.pts[i].t > end) { const m = at(a, end - a.t0); q = { lat: m.lat, lon: m.lon }; }
    if (c !== col) {
      if (cur.length > 1) feats.push({ type: 'Feature', properties: { c: col }, geometry: { type: 'LineString', coordinates: cur } });
      cur = [[p.lon, p.lat]]; col = c;
    }
    cur.push([q.lon, q.lat]);
  }
  if (cur.length > 1) feats.push({ type: 'Feature', properties: { c: col }, geometry: { type: 'LineString', coordinates: cur } });
  return { type: 'FeatureCollection', features: feats };
}

// ---------------- the trip list ----------------
export type SortKey = 'date' | 'length' | 'speed' | 'time';
export const tripMinutes = (t: TrackMeta) => (t.endedAt - t.startedAt) / 60000;
export function sortTrips(list: TrackMeta[], by: SortKey): TrackMeta[] {
  const key = (t: TrackMeta) => (by === 'length' ? t.distanceNm : by === 'speed' ? t.avgMovingKt : by === 'time' ? tripMinutes(t) : t.startedAt);
  return [...list].sort((a, b) => key(b) - key(a));
}
export function searchTrips(list: TrackMeta[], q: string): TrackMeta[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  return list.filter((t) => t.name.toLowerCase().includes(s)
    || new Date(t.startedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase().includes(s));
}

export type TripRecords = {
  count: number;
  best: { maxKt: number; minutes: number; distanceNm: number };
  avg: { avgKt: number; minutes: number; distanceNm: number };
  total: { minutes: number; distanceNm: number };
};
/** Your best and average trip, for "this trip vs your best / your average". */
export function records(list: TrackMeta[]): TripRecords {
  const n = list.length;
  const sum = (f: (t: TrackMeta) => number) => list.reduce((s, t) => s + f(t), 0);
  const max = (f: (t: TrackMeta) => number) => list.reduce((m, t) => Math.max(m, f(t)), 0);
  return {
    count: n,
    best: { maxKt: max((t) => t.maxKt), minutes: max(tripMinutes), distanceNm: max((t) => t.distanceNm) },
    avg: { avgKt: n ? sum((t) => t.avgMovingKt) / n : 0, minutes: n ? sum(tripMinutes) / n : 0, distanceNm: n ? sum((t) => t.distanceNm) / n : 0 },
    total: { minutes: sum(tripMinutes), distanceNm: sum((t) => t.distanceNm) },
  };
}

// ---------------- names from places ("Cabrillo Marina - Avalon") ----------------
export type Place = { name: string; lat: number; lon: number };
export function nearestPlace(lat: number, lon: number, places: Place[], maxNm = 1.5): string | null {
  let best: Place | null = null, bd = maxNm;
  for (const p of places) { const d = distanceNm(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; best = p; } }
  return best?.name ?? null;
}
/** "Start - End" from the nearest named marina, ramp or harbor at each end; "Round trip from X" when it ends where it started. */
export function autoName(pts: TrackPoint[], places: Place[]): string | null {
  if (pts.length < 2) return null;
  const a = nearestPlace(pts[0].lat, pts[0].lon, places);
  const b = nearestPlace(pts[pts.length - 1].lat, pts[pts.length - 1].lon, places);
  if (a && b) return a === b ? `Round trip from ${a}` : `${a} - ${b}`;
  return a ? `From ${a}` : b ? `To ${b}` : null;
}
/** Named marinas, ramps, fuel docks and harbor offices from the harbors map file. */
export function placesFromHarbors(fc: any): Place[] {
  const out: Place[] = [];
  for (const f of fc?.features ?? []) {
    const p = f?.properties ?? {}, g = f?.geometry;
    if (!p.name || g?.type !== 'Point') continue;
    if (!['marina', 'ramp', 'fuel', 'harbor_office'].includes(p.kind)) continue;
    out.push({ name: String(p.name), lat: g.coordinates[1], lon: g.coordinates[0] });
  }
  return out;
}
