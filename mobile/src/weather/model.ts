// Weather page: types, the user's boat profile, and small pure helpers (tested in weather.test.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Level = 'comfortable' | 'bumpy' | 'rough' | 'stay_in';
export type Rating = {
  level: Level; label: string; score: number; steepness: string; seas_ft: number | null; relative: string | null;
  reasons: string[]; rule_2x: { ratio: number; passes: boolean; verdict: string; text: string } | null;
  sca_conditions: boolean; limits: { seas_ft: number; wind_kt: number };
};
export type Hour = {
  t: string; wind_kt?: number; gust_kt?: number; wind_dir?: number; seas_ft?: number | null; period_s?: number | null;
  period_estimated?: boolean; swell_ft?: number; swell_dir?: number; swell2_ft?: number; swell2_period_s?: number; swell2_dir?: number;
  wind_wave_ft?: number; air_f?: number; sky_pct?: number; precip_pct?: number; visibility_nm?: number; weather?: string; rating: Rating;
};
export type Day = {
  date: string; wind_kt_max: number | null; gust_kt_max: number | null; seas_ft_max: number | null; seas_ft_min: number | null;
  air_f_hi: number | null; air_f_lo: number | null; precip_pct_max: number | null; sunrise: string | null; sunset: string | null;
  moon: { name: string; illumination: number };
  summary: { level: Level | null; label: string; best_level?: Level; window: { start: string; end: string; hours: number; worst: Level } | null; reasons?: string[] };
};
export type WeatherAlert = { event: string; headline?: string; severity?: string; onset?: string; ends?: string };
export type WeatherResponse = {
  lat: number; lon: number; disclaimer: string;
  forecast: { available: boolean; note?: string; place?: string; office?: string; updated?: string; alerts?: WeatherAlert[]; hourly?: Hour[]; daily?: Day[]; has_marine?: boolean };
  zone: { zone: string; name: string; issued?: string; headlines: string[]; periods: { name: string; text: string }[] } | null;
  buoy_now: any; tide: any;
};

export type BuoyRow = {
  t: string; wind_kt: number | null; gust_kt: number | null; wind_dir: number | null; wave_ft: number | null; period_s: number | null;
  wave_dir: number | null; water_f: number | null; air_f: number | null; pressure_mb: number | null;
};

// ---------- the user's boat ----------
export type Comfort = 'easygoing' | 'normal' | 'experienced';
export type Boat = { type: string; length_ft: number | null; comfort: Comfort };
export const BOAT_TYPES: { key: string; label: string; typical: number }[] = [
  { key: 'kayak', label: 'Kayak / SUP', typical: 12 }, { key: 'skiff', label: 'Skiff / jon boat', typical: 14 },
  { key: 'bay', label: 'Bay / bass boat', typical: 19 }, { key: 'center_console', label: 'Center console', typical: 23 },
  { key: 'walkaround', label: 'Walkaround / cuddy', typical: 25 }, { key: 'sportfisher', label: 'Sportfisher', typical: 35 },
  { key: 'trawler', label: 'Trawler / cruiser', typical: 38 }, { key: 'sailboat', label: 'Sailboat', typical: 32 },
];
export const COMFORT: { key: Comfort; label: string; sub: string }[] = [
  { key: 'easygoing', label: 'Easygoing', sub: 'Family / kids / new to it — rate more cautiously' },
  { key: 'normal', label: 'Normal', sub: 'Typical weekend crew' },
  { key: 'experienced', label: 'Experienced', sub: 'You run in snot regularly — rate less cautiously' },
];
export const DEFAULT_BOAT: Boat = { type: 'center_console', length_ft: 23, comfort: 'normal' };
const BOAT_KEY = 'boat:v1';

export async function loadBoat(): Promise<{ boat: Boat; isSet: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(BOAT_KEY);
    if (raw) return { boat: { ...DEFAULT_BOAT, ...JSON.parse(raw) }, isSet: true };
  } catch { /* fall through */ }
  return { boat: DEFAULT_BOAT, isSet: false };
}
export const saveBoat = (b: Boat) => AsyncStorage.setItem(BOAT_KEY, JSON.stringify(b));

export function boatLabel(b: Boat): string {
  const t = BOAT_TYPES.find((x) => x.key === b.type)?.label ?? 'Boat';
  return `${b.length_ft ? `${b.length_ft} ft ` : ''}${t}${b.comfort !== 'normal' ? ` · ${b.comfort}` : ''}`;
}

export function weatherPath(lat: number, lon: number, b: Boat, courseDeg: number | null, days = 5): string {
  const q = [`lat=${lat.toFixed(4)}`, `lon=${lon.toFixed(4)}`, `days=${days}`, `boat_type=${b.type}`, `comfort=${b.comfort}`];
  if (b.length_ft) q.push(`boat_len=${b.length_ft}`);
  if (courseDeg != null) q.push(`course=${Math.round(courseDeg) % 360}`);
  return `/weather?${q.join('&')}`;
}

// ---------- display helpers ----------
export const LEVEL_COLOR: Record<Level, string> = { comfortable: '#3FBF7F', bumpy: '#E8C547', rough: '#F08A3C', stay_in: '#E5484D' };
export const levelColor = (l?: Level | null) => (l ? LEVEL_COLOR[l] : '#5A6B78');
/** Darker versions for TEXT on white (Day mode) — the bright ones stay for dots and bars. */
export const LEVEL_TEXT_DAY: Record<Level, string> = { comfortable: '#1E7F48', bumpy: '#8A6200', rough: '#B4531A', stay_in: '#C0362C' };
export const levelText = (l: Level | null | undefined, mode: 'day' | 'night') => (!l ? '#5A6B78' : mode === 'day' ? LEVEL_TEXT_DAY[l] : LEVEL_COLOR[l]);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function hourLabel(iso: string): string {
  const h = new Date(iso).getHours();
  return h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
}
export function clock(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`;
}
/** '2026-10-10' -> 'Today' / 'Sat 10' (dates are local calendar days from the server). */
export function dayLabel(date: string, today = new Date()): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((dt.getTime() - t0.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `${DOW[dt.getDay()]} ${d}`;
}
export const localDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function compass(deg?: number | null): string {
  if (deg == null) return '—';
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
/** Arrow pointing where the wind/swell is GOING (meteorological direction is where it comes FROM). */
export function arrow(fromDeg?: number | null): string {
  if (fromDeg == null) return '·';
  const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
  return arrows[Math.round((((fromDeg % 360) + 360) % 360) / 45) % 8];
}
export const n0 = (v?: number | null) => (v == null ? '—' : String(Math.round(v)));
export const n1 = (v?: number | null) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());

export function seasText(h: Pick<Hour, 'seas_ft' | 'period_s' | 'period_estimated'>): string {
  if (h.seas_ft == null) return '—';
  return `${n1(h.seas_ft)} ft${h.period_s ? ` @ ${Math.round(h.period_s)}s${h.period_estimated ? '*' : ''}` : ''}`;
}

/** Shrink a long series (e.g. 45 days hourly) to at most `max` buckets, keeping each bucket's max. */
export function downsample<T extends { t: string }>(rows: T[], key: keyof T, max = 96): { t: string; v: number | null }[] {
  const pts = rows.map((r) => ({ t: r.t, v: (r[key] as unknown as number | null) ?? null }));
  if (pts.length <= max) return pts;
  const size = Math.ceil(pts.length / max);
  const out: { t: string; v: number | null }[] = [];
  for (let i = 0; i < pts.length; i += size) {
    const vals = pts.slice(i, i + size).map((p) => p.v).filter((v): v is number => v != null);
    out.push({ t: pts[i].t, v: vals.length ? Math.max(...vals) : null });
  }
  return out;
}

/** 'YYYY-MM-DD' plus/minus days, in local calendar terms. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s; // rejects 2026-02-30
