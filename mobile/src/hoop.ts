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
export type Pot = { no: number; lat: number; lon: number; droppedAt: number; state: PotState; drops: number; pulledAt?: number };
export type HoopSet = { id: string; startedAt: number; crew: number; pots: Pot[]; endedAt?: number };

export const CHECK_MS = 2 * 3600 * 1000;          // CA: raise and check every net at least every 2 hours
export const SOON_MS = CHECK_MS - 15 * 60 * 1000; // warn 15 minutes before
export const AT_NET_FT = 90;                      // "you're at it" when the boat is this close (GPS is ± a few yards)

export const limitFor = (crew: number) => (crew <= 1 ? 5 : 10);
export const newSet = (crew: number, now: number): HoopSet => ({ id: `hoop-${now}`, startedAt: now, crew: Math.max(1, Math.round(crew)), pots: [] });

export const down = (s: HoopSet) => s.pots.filter((p) => p.state === 'down');
export const aboard = (s: HoopSet) => s.pots.filter((p) => p.state === 'aboard');
/** Nets in the water, longest soak first — the order to pull them. */
export const pullOrder = (s: HoopSet) => down(s).slice().sort((a, b) => a.droppedAt - b.droppedAt || a.no - b.no);
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
  return { ...s, pots: [...s.pots, { no, lat: at.lat, lon: at.lon, droppedAt: now, state: 'down', drops: 1 }] };
}

/** Put a net back in (same number, new spot, soak clock restarts → back of the pull order). */
export function redrop(s: HoopSet, no: number, at: { lat: number; lon: number }, now: number): HoopSet {
  return { ...s, pots: s.pots.map((p) => (p.no === no && p.state === 'aboard' ? { ...p, lat: at.lat, lon: at.lon, droppedAt: now, state: 'down', drops: p.drops + 1, pulledAt: undefined } : p)) };
}

export function pull(s: HoopSet, no: number, now: number): HoopSet {
  return { ...s, pots: s.pots.map((p) => (p.no === no && p.state === 'down' ? { ...p, state: 'aboard', pulledAt: now } : p)) };
}

/** Done with this net for the night (stays aboard, no longer counts as in use). */
export function finish(s: HoopSet, no: number): HoopSet {
  return { ...s, pots: s.pots.map((p) => (p.no === no ? { ...p, state: 'done' } : p)) };
}

/** Move a pin (dropped it a bit off from where the boat was). */
export function movePot(s: HoopSet, no: number, at: { lat: number; lon: number }): HoopSet {
  return { ...s, pots: s.pots.map((p) => (p.no === no ? { ...p, lat: at.lat, lon: at.lon } : p)) };
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
