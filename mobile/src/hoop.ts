// Hoop netting (lobster / crab), Oct 28. Pure rules — no screens — so they're tested.
//
// How a set works: drop a net, move a few yards, drop the next — each gets the next number (No. 1, No. 2 …) and a
// pin where the boat was. Nets come up in SOAK ORDER: the one that has been down longest is "next up". Re-dropping
// a net keeps its number but sends it to the back of the line (its soak clock restarts), so you never pull a net you
// just dropped before the older ones.
// California (south of Point Arguello): up to 5 nets for a solo operator, never more than 10 per boat; nets must be
// raised and checked at least every 2 hours.
import { bearingTrue, distanceNm } from './geo';

export type PotState = 'down' | 'aboard' | 'done';
/** rank (Nov 1): set when you change the pull order by hand; a (re-)dropped net has none and goes to the back. */
export type Pot = { no: number; lat: number; lon: number; droppedAt: number; state: PotState; drops: number; pulledAt?: number; rank?: number };
/** Every drop of the set, kept so you can see where nets already went (this night and past nights). */
export type Drop = { no: number; lat: number; lon: number; at: number };
export type Pull = { no: number; at: number; lat: number; lon: number; soakMin: number };
export type TrailPt = { lat: number; lon: number; t: number; sog: number | null };
export type HoopSet = { id: string; startedAt: number; crew: number; pots: Pot[]; endedAt?: number; log?: Drop[]; pulls?: Pull[]; trail?: TrailPt[] };

export const CHECK_MS = 2 * 3600 * 1000;          // CA: raise and check every net at least every 2 hours
export const SOON_MS = CHECK_MS - 15 * 60 * 1000; // warn 15 minutes before
export const AT_NET_FT = 90;                      // "you're at it" when the boat is this close (GPS is ± a few yards)

export const limitFor = (crew: number) => (crew <= 1 ? 5 : 10);
export const newSet = (crew: number, now: number): HoopSet => ({ id: `hoop-${now}`, startedAt: now, crew: Math.max(1, Math.round(crew)), pots: [] });

export const down = (s: HoopSet) => s.pots.filter((p) => p.state === 'down');
export const aboard = (s: HoopSet) => s.pots.filter((p) => p.state === 'aboard');
/** Order key: a hand-set rank (small numbers) always comes before soak order (drop time in ms). */
const key = (p: Pot) => p.rank ?? p.droppedAt;
/** Nets in the water in the order to pull them: longest soak first, unless you changed the order by hand. */
export const pullOrder = (s: HoopSet) => down(s).slice().sort((a, b) => key(a) - key(b) || a.droppedAt - b.droppedAt || a.no - b.no);

/** Move a net up (-1) or down (+1) in the pull order (Nov 1: nets get pulled / set out of order on the water). */
export function moveInLine(s: HoopSet, no: number, dir: -1 | 1): HoopSet {
  const order = pullOrder(s).map((p) => p.no);
  const i = order.indexOf(no), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return s;
  [order[i], order[j]] = [order[j], order[i]];
  return { ...s, pots: s.pots.map((p) => (order.includes(p.no) ? { ...p, rank: order.indexOf(p.no) + 1 } : p)) };
}
/** Make a net the next one up. */
export function makeNext(s: HoopSet, no: number): HoopSet {
  const order = pullOrder(s).map((p) => p.no).filter((n) => n !== no);
  if (!down(s).some((p) => p.no === no)) return s;
  const full = [no, ...order];
  return { ...s, pots: s.pots.map((p) => (full.includes(p.no) ? { ...p, rank: full.indexOf(p.no) + 1 } : p)) };
}
export const nextUp = (s: HoopSet): Pot | null => pullOrder(s)[0] ?? null;
/** Nets the boat is still using (in the water or aboard waiting to go back in) — what counts toward the limit. */
export const inUse = (s: HoopSet) => s.pots.filter((p) => p.state !== 'done').length;
export const canDropNew = (s: HoopSet) => inUse(s) < limitFor(s.crew);

/** What the big "drop" button should do: re-drop the lowest-numbered net that's aboard, else a new net (if allowed). */
export function dropSuggestion(s: HoopSet): { kind: 'redrop'; no: number } | { kind: 'new'; no: number } | { kind: 'full' } {
  const a = aboard(s).sort((x, y) => x.no - y.no)[0];
  if (a) return { kind: 'redrop', no: a.no };
  if (canDropNew(s)) return { kind: 'new', no: s.pots.reduce((m, p) => Math.max(m, p.no), 0) + 1 };
  return { kind: 'full' };
}

export function dropNew(s: HoopSet, at: { lat: number; lon: number }, now: number): HoopSet {
  if (!canDropNew(s)) return s;
  const no = s.pots.reduce((m, p) => Math.max(m, p.no), 0) + 1;
  return { ...s, pots: [...s.pots, { no, lat: at.lat, lon: at.lon, droppedAt: now, state: 'down', drops: 1 }], log: [...(s.log ?? []), { no, lat: at.lat, lon: at.lon, at: now }] };
}

/** Put a net back in (same number, new spot, soak clock restarts → back of the pull order). */
export function redrop(s: HoopSet, no: number, at: { lat: number; lon: number }, now: number): HoopSet {
  if (!s.pots.some((p) => p.no === no && p.state === 'aboard')) return s;
  return { ...s, pots: s.pots.map((p) => (p.no === no && p.state === 'aboard' ? { ...p, lat: at.lat, lon: at.lon, droppedAt: now, state: 'down', drops: p.drops + 1, pulledAt: undefined, rank: undefined } : p)),
    log: [...(s.log ?? []), { no, lat: at.lat, lon: at.lon, at: now }] };
}

export function pull(s: HoopSet, no: number, now: number): HoopSet {
  const p = s.pots.find((x) => x.no === no && x.state === 'down');
  if (!p) return s;
  const rec: Pull = { no, at: now, lat: p.lat, lon: p.lon, soakMin: Math.round((now - p.droppedAt) / 60000) };
  return { ...s, pots: s.pots.map((x) => (x === p ? { ...x, state: 'aboard', pulledAt: now } : x)), pulls: [...(s.pulls ?? []), rec] };
}

// ---- The whole trip (Nov 8): the boat's path while hoop netting, so "Save & end" keeps it like a boating trip.
const TRAIL_MIN_FT = 60;
const TRAIL_MIN_MS = 30000;
/** Add the boat's position to the set's path (every ~60 ft or 30 s, whichever comes first). Same object if skipped. */
export function addTrail(s: HoopSet, pt: TrailPt): HoopSet {
  const tr = s.trail ?? [];
  const last = tr[tr.length - 1];
  if (last) {
    const ft = distanceNm(last.lat, last.lon, pt.lat, pt.lon) * 6076.12;
    if (ft < TRAIL_MIN_FT && pt.t - last.t < TRAIL_MIN_MS) return s;
    if (ft < 8 && pt.t - last.t < 5 * 60000) return s;      // sitting still: one point every 5 min is plenty
  }
  return { ...s, trail: [...tr, pt].slice(-6000) };
}

export type HoopSummary = { crew: number; nets: number; drops: number; pulls: number; avgSoakMin: number | null; longestSoakMin: number | null };
export function summary(s: HoopSet): HoopSummary {
  const soaks = (s.pulls ?? []).map((p) => p.soakMin);
  return { crew: s.crew, nets: s.pots.length, drops: (s.log ?? []).length || s.pots.length, pulls: (s.pulls ?? []).length,
    avgSoakMin: soaks.length ? Math.round(soaks.reduce((a, b) => a + b, 0) / soaks.length) : null, longestSoakMin: soaks.length ? Math.max(...soaks) : null };
}

/** The trip to save: the boat's path (or, if GPS didn't record a path, the drop spots in order). */
export function tripPoints(s: HoopSet): TrailPt[] {
  if ((s.trail ?? []).length >= 2) return s.trail!;
  const drops = (s.log ?? []).map((d) => ({ lat: d.lat, lon: d.lon, t: d.at, sog: null }));
  const pulls = (s.pulls ?? []).map((p) => ({ lat: p.lat, lon: p.lon, t: p.at, sog: null }));
  return [...drops, ...pulls].sort((a, b) => a.t - b.t);
}

/** Done with this net for the night (stays aboard, no longer counts as in use). */
export function finish(s: HoopSet, no: number): HoopSet {
  return { ...s, pots: s.pots.map((p) => (p.no === no ? { ...p, state: 'done' } : p)) };
}

/** Move a pin (dropped it a bit off from where the boat was). The latest drop in the log moves with it. */
export function movePot(s: HoopSet, no: number, at: { lat: number; lon: number }): HoopSet {
  const log = (s.log ?? []).slice();
  for (let i = log.length - 1; i >= 0; i--) if (log[i].no === no) { log[i] = { ...log[i], lat: at.lat, lon: at.lon }; break; }
  return { ...s, pots: s.pots.map((p) => (p.no === no ? { ...p, lat: at.lat, lon: at.lon } : p)), log };
}

// ---- Saved sets (Nov 1): every set is kept when it ends, so you can see where you already dropped and spread out.
export const KEEP_DAYS = 45;
export type SavedSet = { id: string; startedAt: number; endedAt: number; drops: Drop[] };
/** Add an ended set to the saved list (newest first), dropping ones older than KEEP_DAYS. */
export function saveSet(history: SavedSet[], s: HoopSet, now: number): SavedSet[] {
  const drops = s.log?.length ? s.log : s.pots.map((p) => ({ no: p.no, lat: p.lat, lon: p.lon, at: p.droppedAt }));
  const keep = history.filter((h) => h.id !== s.id && now - h.endedAt < KEEP_DAYS * 86400000);
  return drops.length ? [{ id: s.id, startedAt: s.startedAt, endedAt: now, drops }, ...keep].slice(0, 60) : keep;
}
/** Map dots for earlier drops: past sets, plus this set's earlier spots (where a net was before it got re-dropped).
 *  age_d = days ago (for the color), tonight = 1 for this set. */
export function pastDropsGeoJSON(history: SavedSet[], current: HoopSet | null, now: number, days = KEEP_DAYS) {
  const features: any[] = [];
  for (const h of history) {
    if (now - h.endedAt > days * 86400000) continue;
    for (const d of h.drops) features.push({ type: 'Feature', properties: { no: d.no, age_d: Math.round(((now - d.at) / 86400000) * 10) / 10, tonight: 0 },
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] } });
  }
  if (current?.log) {
    const live = new Set(current.pots.filter((p) => p.state !== 'done').map((p) => `${p.no}|${p.lat}|${p.lon}`));
    for (const d of current.log) {
      if (live.has(`${d.no}|${d.lat}|${d.lon}`)) continue;
      features.push({ type: 'Feature', properties: { no: d.no, age_d: 0, tonight: 1 }, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}
/** How far (ft) the boat is from the closest earlier drop (null = none within 45 days). */
export function nearestPastFt(history: SavedSet[], current: HoopSet | null, from: { lat: number; lon: number } | null, now: number): number | null {
  if (!from) return null;
  let best: number | null = null;
  for (const f of pastDropsGeoJSON(history, current, now).features) {
    const [lon, lat] = f.geometry.coordinates;
    const ft = distanceNm(from.lat, from.lon, lat, lon) * 6076.12;
    if (best == null || ft < best) best = ft;
  }
  return best;
}

export type Soak = 'ok' | 'soon' | 'due';
export function soakState(p: Pot, now: number): Soak {
  if (p.state !== 'down') return 'ok';
  const t = now - p.droppedAt;
  return t >= CHECK_MS ? 'due' : t >= SOON_MS ? 'soon' : 'ok';
}

/** "1h 52m" / "38m" */
export function soakText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** Distance (ft) and true bearing from the boat to a net. */
export function guide(from: { lat: number; lon: number } | null, p: Pot | null): { ft: number; brg: number } | null {
  if (!from || !p) return null;
  return { ft: distanceNm(from.lat, from.lon, p.lat, p.lon) * 6076.12, brg: bearingTrue(from.lat, from.lon, p.lat, p.lon) };
}

/** The net the boat is sitting on (within AT_NET_FT), preferring the next-up one. */
export function atNet(s: HoopSet, from: { lat: number; lon: number } | null): Pot | null {
  if (!from) return null;
  const near = down(s).map((p) => ({ p, ft: guide(from, p)!.ft })).filter((x) => x.ft <= AT_NET_FT).sort((a, b) => a.ft - b.ft);
  const nu = nextUp(s);
  return near.find((x) => x.p.no === nu?.no)?.p ?? near[0]?.p ?? null;
}

/** The set line: every net still in use, in number order. */
export const setLine = (s: HoopSet) => s.pots.filter((p) => p.state !== 'done').sort((a, b) => a.no - b.no);

export const fmtFt = (ft: number) => (ft >= 1000 ? `${(ft / 6076.12).toFixed(2)} NM` : `${Math.round(ft / 10) * 10} ft`);
