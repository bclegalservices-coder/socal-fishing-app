// Navigation math beyond basic distance/bearing. All offline, all unit-tested.
import { bearingTrue, distanceNm, msToKnots } from './geo';

const R_NM = 3440.065;
const rad = (d: number) => (d * Math.PI) / 180;

export type Pt = { lat: number; lon: number; name?: string };
export type TrackPoint = { lat: number; lon: number; t: number; sog: number | null };

/** Cross-track error in NM from the leg a→b. Positive = boat is RIGHT of the course line. */
export function crossTrackNm(a: Pt, b: Pt, p: Pt): number {
  const d13 = distanceNm(a.lat, a.lon, p.lat, p.lon) / R_NM;
  const t13 = rad(bearingTrue(a.lat, a.lon, p.lat, p.lon));
  const t12 = rad(bearingTrue(a.lat, a.lon, b.lat, b.lon));
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * R_NM;
}

/** Degrees to turn from current course to the bearing. Positive = turn right. */
export function steerDelta(cog: number, brg: number): number {
  return ((brg - cog + 540) % 360) - 180;
}

/** Minutes to arrive at current speed, or null when basically stopped. */
export function etaMinutes(distNm: number, sogKt: number | null): number | null {
  return sogKt != null && sogKt > 0.5 ? (distNm / sogKt) * 60 : null;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(Math.round(min % 60)).padStart(2, '0')} min`;
}

export type RawFix = { lat: number; lon: number; time: number; speed: number | null; heading: number | null; accuracy: number | null };

/**
 * Speed over ground (knots) and course over ground (°T) from GPS.
 * Uses the GPS chip's own speed when it reports one; otherwise calculates it from
 * distance travelled between fixes. Smoothed so the number doesn't jump around,
 * and forced to 0 when drifting at a standstill (GPS jitter).
 */
export class SpeedEstimator {
  private last: RawFix | null = null;
  private sog: number | null = null;
  private cog: number | null = null;

  update(f: RawFix): { sogKt: number | null; cogT: number | null } {
    let raw: number | null = null;
    if (f.speed != null && f.speed >= 0) {
      raw = msToKnots(f.speed);
    } else if (this.last) {
      const dt = (f.time - this.last.time) / 1000;
      if (dt >= 1) {
        const d = distanceNm(this.last.lat, this.last.lon, f.lat, f.lon);
        const noiseM = Math.max(3, (f.accuracy ?? 10) * 0.5);
        raw = d * 1852 > noiseM ? d / (dt / 3600) : 0;
      }
    }
    if (raw != null && raw < 80) this.sog = this.sog == null ? raw : this.sog + 0.4 * (raw - this.sog);

    const moving = (this.sog ?? 0) > 1;
    if (moving && f.heading != null && f.heading >= 0) this.cog = f.heading;
    else if (moving && this.last) this.cog = bearingTrue(this.last.lat, this.last.lon, f.lat, f.lon);
    else if (!moving) this.cog = null; // course is meaningless when stopped

    if (!this.last || f.time - this.last.time >= 1000) this.last = f;
    const sogKt = this.sog == null ? null : this.sog < 0.3 ? 0 : this.sog;
    return { sogKt, cogT: this.cog };
  }
}

export type TrackStats = { distanceNm: number; durationMin: number; maxKt: number; avgMovingKt: number };

export function trackStats(pts: TrackPoint[]): TrackStats {
  let dist = 0, moving = 0, maxKt = 0, movingMin = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = distanceNm(a.lat, a.lon, b.lat, b.lon);
    const hrs = (b.t - a.t) / 3_600_000;
    dist += d;
    const segKt = hrs > 0 ? d / hrs : 0;
    const kt = b.sog ?? segKt;
    if (kt < 80) maxKt = Math.max(maxKt, kt);
    if (kt > 1) { moving += d; movingMin += hrs * 60; }
  }
  const durationMin = pts.length > 1 ? (pts[pts.length - 1].t - pts[0].t) / 60_000 : 0;
  return { distanceNm: dist, durationMin, maxKt, avgMovingKt: movingMin > 0 ? moving / (movingMin / 60) : 0 };
}

export function routeLegs(points: Pt[]) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const d = distanceNm(a.lat, a.lon, b.lat, b.lon);
    total += d;
    legs.push({ from: a, to: b, distanceNm: d, bearing: bearingTrue(a.lat, a.lon, b.lat, b.lon) });
  }
  return { legs, totalNm: total };
}
