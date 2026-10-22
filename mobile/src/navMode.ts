// Navigation mode math (pure, works offline): how far to zoom the follow camera, what the next turn is, and when
// you're far enough off the line to sound the off-course alarm.
import { bearingTrue, distanceNm } from './geo';
import type { Pt } from './nav';

export type NavLeg = { points: Pt[]; leg: number; legStart: Pt; name?: string };

export const deg3 = (d: number) => `${String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
export const fmtDist = (nm: number) => (nm < 1 ? `${nm.toFixed(2)} NM` : nm < 10 ? `${nm.toFixed(1)} NM` : `${Math.round(nm)} NM`);

/** Zoom for the follow camera: close in near a turn or the end, wider on long runs, a bit wider when running fast. */
export function autoZoom(distNm: number | null, sogKt: number | null): number {
  if (distNm == null) return 13;
  const z = distNm < 0.15 ? 15.5 : distNm < 0.4 ? 14.5 : distNm < 1 ? 13.5 : distNm < 3 ? 12.5 : distNm < 8 ? 11.5 : 10.5;
  return sogKt != null && sogKt > 18 ? z - 0.5 : z;
}

/** How far off the line (NM) before the off-course alarm: 5% of the leg, kept between 0.08 and 0.4 NM. */
export function offRouteLimit(legNm: number): number {
  return Math.min(0.4, Math.max(0.08, legNm * 0.05));
}

export type Guidance = {
  distNm: number;          // to the waypoint you're heading for
  nextBrg: number | null;  // course of the next leg (null on the last leg)
  turnDeg: number | null;  // + right / - left, at the coming waypoint
  text: string;            // "Turn right to 155° in 0.30 NM", "Arrive in 0.45 NM"
  final: boolean;
};

/** What's coming next, in plain words. */
export function guidance(nav: NavLeg, here: Pt): Guidance {
  const tgt = nav.points[nav.leg];
  const distNm = distanceNm(here.lat, here.lon, tgt.lat, tgt.lon);
  const next = nav.points[nav.leg + 1];
  if (!next) {
    const name = tgt.name ?? 'the waypoint';
    return { distNm, nextBrg: null, turnDeg: null, final: true, text: distNm < 1.5 ? `Arrive at ${name} in ${fmtDist(distNm)}` : `${fmtDist(distNm)} to ${name}` };
  }
  const legBrg = bearingTrue(nav.legStart.lat, nav.legStart.lon, tgt.lat, tgt.lon);
  const nextBrg = bearingTrue(tgt.lat, tgt.lon, next.lat, next.lon);
  const turnDeg = ((nextBrg - legBrg + 540) % 360) - 180;
  const how = Math.abs(turnDeg) < 10 ? `Continue on ${deg3(nextBrg)}` : `Turn ${turnDeg > 0 ? 'right' : 'left'} to ${deg3(nextBrg)}`;
  return { distNm, nextBrg, turnDeg, final: false, text: `${how} in ${fmtDist(distNm)}` };
}
