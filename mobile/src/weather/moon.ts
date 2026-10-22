// Moon math for the Weather → Moon tab. Runs on the phone, works offline, no account.
// Phase dates: Jean Meeus, "Astronomical Algorithms" ch. 49 (to within a few minutes).
// Moon position (rise / set / how high): Meeus ch. 47, main terms (rise/set within a few minutes).
const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const SYNODIC = 29.530588853;
const sin = (deg: number) => Math.sin(deg * RAD), cos = (deg: number) => Math.cos(deg * RAD);
const norm = (deg: number) => ((deg % 360) + 360) % 360;
const jdOf = (ms: number) => ms / DAY_MS + 2440587.5;
const msOf = (jd: number) => (jd - 2440587.5) * DAY_MS;

/** Geocentric moon + sun position (degrees) at a time. */
function bodies(ms: number) {
  const T = (jdOf(ms) - 2451545.0) / 36525;
  const Lp = norm(218.3164477 + 481267.88123421 * T);
  const D = norm(297.8501921 + 445267.1114034 * T);
  const M = norm(357.5291092 + 35999.0502909 * T);
  const Mp = norm(134.9633964 + 477198.8675055 * T);
  const F = norm(93.272095 + 483202.0175233 * T);
  const lon = Lp + 6.288774 * sin(Mp) + 1.274027 * sin(2 * D - Mp) + 0.658314 * sin(2 * D) + 0.213618 * sin(2 * Mp)
    - 0.185116 * sin(M) - 0.114332 * sin(2 * F) + 0.058793 * sin(2 * D - 2 * Mp) + 0.057066 * sin(2 * D - M - Mp)
    + 0.053322 * sin(2 * D + Mp) + 0.045758 * sin(2 * D - M) - 0.040923 * sin(M - Mp) - 0.03472 * sin(D) - 0.030383 * sin(M + Mp);
  const lat = 5.128122 * sin(F) + 0.280602 * sin(Mp + F) + 0.277693 * sin(Mp - F) + 0.173237 * sin(2 * D - F)
    + 0.055413 * sin(2 * D - Mp + F) + 0.046271 * sin(2 * D - Mp - F);
  const dist = 385000.56 - 20905.355 * cos(Mp) - 3699.111 * cos(2 * D - Mp) - 2955.968 * cos(2 * D) - 569.925 * cos(2 * Mp);
  // Sun (good to ~0.01°)
  const L0 = 280.46646 + 36000.76983 * T;
  const Ms = 357.52911 + 35999.05029 * T;
  const C = (1.914602 - 0.004817 * T) * sin(Ms) + 0.019993 * sin(2 * Ms) + 0.000289 * sin(3 * Ms);
  const sunLon = norm(L0 + C);
  const eps = 23.439291 - 0.0130042 * T;
  return { lon: norm(lon), lat, dist, sunLon, eps, T };
}

function equatorial(lon: number, lat: number, eps: number) {
  const ra = Math.atan2(sin(lon) * cos(eps) - Math.tan(lat * RAD) * sin(eps), cos(lon)) / RAD;
  const dec = Math.asin(sin(lat) * cos(eps) + cos(lat) * sin(eps) * sin(lon)) / RAD;
  return { ra, dec };
}

/** Height of the moon's center above the horizon in degrees (seen from the Earth's center). */
export function moonAltitude(ms: number, lat: number, lon: number): number {
  const b = bodies(ms);
  const { ra, dec } = equatorial(b.lon, b.lat, b.eps);
  const d = jdOf(ms) - 2451545.0;
  const gmst = norm(280.46061837 + 360.98564736629 * d);
  const H = gmst + lon - ra;
  return Math.asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H)) / RAD;
}

/** Fraction lit (0–1) and phase (0 new · 0.25 first quarter · 0.5 full · 0.75 last quarter). */
export function moonIllumination(ms: number): { fraction: number; phase: number } {
  const b = bodies(ms);
  const elong = norm(b.lon - b.sunLon);                           // 0 new … 180 full
  const psi = Math.acos(cos(b.lat) * cos(b.lon - b.sunLon)) / RAD;  // true angle moon–sun
  const i = Math.atan2(149598000 * sin(psi), b.dist - 149598000 * cos(psi)) / RAD;
  return { fraction: (1 + cos(i)) / 2, phase: elong / 360 };
}

export const moonAge = (phase: number) => (((phase % 1) + 1) % 1) * SYNODIC;

/** Exact time of one principal phase. q: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
function phaseTime(k: number, q: number): number {
  k = Math.floor(k) + q;
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4;
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3;
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4;
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4;
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3;
  if (q === 0 || q === 0.5) {
    const n = q === 0;
    jde += (n ? -0.4072 : -0.40614) * sin(Mp) + (n ? 0.17241 : 0.17302) * E * sin(M) + (n ? 0.01608 : 0.01614) * sin(2 * Mp)
      + (n ? 0.01039 : 0.01043) * sin(2 * F) + (n ? 0.00739 : 0.00734) * E * sin(Mp - M) - (n ? 0.00514 : 0.00515) * E * sin(Mp + M)
      + (n ? 0.00208 : 0.00209) * E * E * sin(2 * M) - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F)
      + 0.00056 * E * sin(2 * Mp + M) - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
      - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(Om) - 0.00007 * sin(Mp + 2 * M) + 0.00004 * sin(2 * Mp - 2 * F)
      + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F) + 0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F)
      + 0.00003 * sin(Mp - M + 2 * F) - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp);
  } else {
    jde += -0.62801 * sin(Mp) + 0.17172 * E * sin(M) - 0.01183 * E * sin(Mp + M) + 0.00862 * sin(2 * Mp) + 0.00804 * sin(2 * F)
      + 0.00454 * E * sin(Mp - M) + 0.00204 * E * E * sin(2 * M) - 0.0018 * sin(Mp - 2 * F) - 0.0007 * sin(Mp + 2 * F)
      - 0.0004 * sin(3 * Mp) - 0.00034 * E * sin(2 * Mp - M) + 0.00032 * E * sin(M + 2 * F) + 0.00032 * E * sin(M - 2 * F)
      - 0.00028 * E * E * sin(Mp + 2 * M) + 0.00027 * E * sin(2 * Mp + M) - 0.00017 * sin(Om) - 0.00005 * sin(Mp - M - 2 * F)
      + 0.00004 * sin(2 * Mp + 2 * F) - 0.00004 * sin(Mp + M + 2 * F) + 0.00004 * sin(Mp - 2 * M) + 0.00003 * sin(Mp + M - 2 * F)
      + 0.00003 * sin(3 * M) + 0.00002 * sin(2 * Mp - 2 * F) + 0.00002 * sin(Mp - M + 2 * F) - 0.00002 * sin(3 * Mp + M);
    const W = 0.00306 - 0.00038 * E * cos(M) + 0.00026 * cos(Mp) - 0.00002 * cos(Mp - M) + 0.00002 * cos(Mp + M) + 0.00002 * cos(2 * F);
    jde += q === 0.25 ? W : -W;
  }
  return msOf(jde) - 69000;   // Terrestrial Time → clock time (ΔT ≈ 69 s)
}

const PHASES = [{ q: 0, name: 'New Moon' }, { q: 0.25, name: 'First Quarter' }, { q: 0.5, name: 'Full Moon' }, { q: 0.75, name: 'Last Quarter' }];

/** All principal phases between two times, in order. */
export function phasesBetween(fromMs: number, toMs: number): { name: string; at: Date }[] {
  const k0 = Math.floor((new Date(fromMs).getUTCFullYear() + new Date(fromMs).getUTCMonth() / 12 - 2000) * 12.3685) - 2;
  const out: { name: string; at: Date }[] = [];
  for (let k = k0; k < k0 + 3 + Math.ceil((toMs - fromMs) / (SYNODIC * DAY_MS)) + 2; k++) {
    for (const p of PHASES) {
      const t = phaseTime(k, p.q);
      if (t >= fromMs && t < toMs) out.push({ name: p.name, at: new Date(t) });
    }
  }
  return out.sort((a, b) => +a.at - +b.at);
}

/** The next new moon, first quarter, full moon and last quarter. */
export const nextPhases = (fromMs: number) => phasesBetween(fromMs, fromMs + 30 * DAY_MS).slice(0, 4);

export type MoonDay = {
  rise: Date | null; set: Date | null; highest: Date | null; highestAlt: number | null;
  fraction: number; phase: number; name: string; age: number; event: { name: string; at: Date } | null;
};

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Name for a local day. A principal phase (Full Moon etc.) gets its name only on the day it happens. */
function dayName(phase: number, event: { name: string } | null): string {
  if (event) return event.name;
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.25) return 'Waxing Crescent';
  if (p < 0.5) return 'Waxing Gibbous';
  if (p < 0.75) return 'Waning Gibbous';
  return 'Waning Crescent';
}

/** Everything for one local calendar day (midnight to midnight on this phone) at a place. */
export function moonDay(day: Date, lat: number, lon: number): MoonDay {
  const t0 = midnight(day);
  const STEP = 10 * 60000, H0 = 0.125;   // moon's upper edge on the horizon (parallax + refraction)
  const alt: number[] = [];
  for (let i = 0; i <= 144; i++) alt.push(moonAltitude(t0 + i * STEP, lat, lon));
  let rise: Date | null = null, set: Date | null = null, hi = -1;
  for (let i = 1; i <= 144; i++) {
    const a = alt[i - 1] - H0, b = alt[i] - H0;
    const at = () => new Date(t0 + (i - 1 + a / (a - b)) * STEP);
    if (a < 0 && b >= 0 && !rise) rise = at();
    if (a >= 0 && b < 0 && !set) set = at();
    if (i < 144 && alt[i] > alt[i - 1] && alt[i] >= alt[i + 1] && alt[i] > 0 && (hi < 0 || alt[i] > alt[hi])) hi = i;
  }
  let highest: Date | null = null;
  if (hi > 0) {
    const y0 = alt[hi - 1], y1 = alt[hi], y2 = alt[hi + 1], den = y0 - 2 * y1 + y2;
    const off = den === 0 ? 0 : Math.max(-1, Math.min(1, (0.5 * (y0 - y2)) / den));
    highest = new Date(t0 + (hi + off) * STEP);
  }
  const ill = moonIllumination(t0 + DAY_MS / 2);
  const event = phasesBetween(t0, t0 + DAY_MS)[0] ?? null;
  // Age = days since the last new moon (at noon), counted like the almanacs do.
  const lastNew = phasesBetween(t0 - 31 * DAY_MS, t0 + DAY_MS / 2).filter((x) => x.name === 'New Moon').pop();
  const age = lastNew ? (t0 + DAY_MS / 2 - +lastNew.at) / DAY_MS : moonAge(ill.phase);
  return { rise, set, highest, highestAlt: hi > 0 ? alt[hi] : null, fraction: ill.fraction, phase: ill.phase,
    name: dayName(ill.phase, event), age, event };
}
