// Pure navigation math. Runs fully offline. Coordinates are WGS84 decimal degrees.

const R_NM = 3440.065; // mean Earth radius in nautical miles
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in nautical miles. */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial true bearing from point 1 to point 2, 0–360°. */
export function bearingTrue(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export type CoordFormat = 'dd' | 'ddm' | 'dms';

function part(v: number, pos: string, neg: string, fmt: CoordFormat, degWidth: number): string {
  const hemi = v >= 0 ? pos : neg;
  const a = Math.abs(v);
  if (fmt === 'dd') return `${a.toFixed(5)}°${hemi}`;
  let d = Math.floor(a);
  let m = (a - d) * 60;
  if (fmt === 'ddm') {
    if (Number(m.toFixed(3)) >= 60) { d += 1; m = 0; }
    return `${String(d).padStart(degWidth, '0')}°${m.toFixed(3).padStart(6, '0')}′${hemi}`;
  }
  let mi = Math.floor(m);
  let s = (m - mi) * 60;
  if (Number(s.toFixed(1)) >= 60) { s = 0; mi += 1; }
  if (mi >= 60) { mi = 0; d += 1; }
  return `${String(d).padStart(degWidth, '0')}°${String(mi).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″${hemi}`;
}

/** e.g. formatLatLon(33.40125, -117.99667, 'ddm') -> "33°24.075′N  117°59.800′W" */
let currentFormat: CoordFormat = 'ddm';
export const setCoordFormat = (f: CoordFormat) => { currentFormat = f; };
export const getCoordFormat = () => currentFormat;

export function formatLatLon(lat: number, lon: number, fmt: CoordFormat = currentFormat): string {
  return `${part(lat, 'N', 'S', fmt, 2)}  ${part(lon, 'E', 'W', fmt, 3)}`;
}

export const msToKnots = (ms: number) => ms * 1.943844;
/** Knots → statute miles per hour. */
export const knotsToMph = (kt: number) => kt * 1.150779;

const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** 0–360° → compass point, e.g. 214 → "SW". */
export function cardinal(degT: number): string {
  return POINTS16[Math.round((((degT % 360) + 360) % 360) / 22.5) % 16];
}

export function formatNm(nm: number): string {
  return nm < 10 ? nm.toFixed(1) : Math.round(nm).toString();
}
