// Spotter-plane history (Oct 29): pure helpers (tested) for the "Spotter activity" layer. The server records each
// likely spotter's REAL broadcast positions (api/air/history.py); this colors them by how long ago they were flown.

export type SpotSession = {
  id: string; hex: string; reg: string | null; callsign: string | null; type: string | null; desc: string | null;
  owner: string | null; year: string | null; active: boolean; work_from: number; work_to: number; last_t: number;
  minutes: number; circles: number; alt_min: number | null; alt_max: number | null; center: [number, number] | null;
  points: [number, number, number, number | null][];          // [lon, lat, unix seconds, altitude ft]
};
export type SpotHistory = { now: number; hours: number; sessions: SpotSession[]; watching_since: number | null; credit: string };

export const HOURS = [3, 6, 12, 24] as const;
/** Age (hours) → color: hot pink now, orange ~3 h, yellow ~6 h, faded blue by 12 h. */
export const AGE_STOPS: [number, string][] = [[0, '#FF20D6'], [3, '#FF7800'], [6, '#FFD200'], [12, '#6E96C8'], [24, '#8A99AA']];

function hex2rgb(h: string) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function ageColor(hours: number): string {
  const h = Math.max(0, hours);
  for (let i = 1; i < AGE_STOPS.length; i++) {
    const [a, ca] = AGE_STOPS[i - 1], [b, cb] = AGE_STOPS[i];
    if (h <= b) {
      const t = (h - a) / (b - a), x = hex2rgb(ca), y = hex2rgb(cb);
      return '#' + x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('');
    }
  }
  return AGE_STOPS[AGE_STOPS.length - 1][1];
}

/** "now", "25 min ago", "3 h ago", "3 h 20 min ago" */
export function agoText(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60));
  if (m < 5) return 'now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60), r = m % 60;
  return r >= 10 && h < 6 ? `${h} h ${r} min ago` : `${Math.round(m / 60)} h ago`;
}

export const inWindow = (s: SpotSession, now: number, hours: number) => now - s.last_t <= hours * 3600;

/** Map lines: each session cut into short pieces, each piece knows its age (for the color) and whether the plane was
 *  working the spot ("work": bold) or flying to / from it ("travel": thin and faint). */
export function historyGeoJSON(sessions: SpotSession[], now: number, hours: number) {
  const features: any[] = [];
  for (const s of sessions) {
    if (!inWindow(s, now, hours) || s.points.length < 2) continue;
    const pts = s.points.filter((p) => now - p[2] <= hours * 3600);
    for (let i = 0; i < pts.length - 1; i += 5) {
      const chunk = pts.slice(i, Math.min(i + 6, pts.length));
      if (chunk.length < 2) continue;
      const mid = chunk[Math.floor(chunk.length / 2)][2];
      const work = mid >= s.work_from - 30 && mid <= s.work_to + 30;
      features.push({ type: 'Feature', properties: { id: s.id, age_h: Math.round(((now - mid) / 3600) * 100) / 100, work: work ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: chunk.map((p) => [p[0], p[1]]) } });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}

/** The color ramp as a MapLibre expression (same stops as ageColor). */
export const ageColorExpression = (): any => ['interpolate', ['linear'], ['get', 'age_h'], ...AGE_STOPS.flatMap(([h, c]) => [h, c])];

export function summaryText(sessions: SpotSession[], now: number, hours: number): string {
  const s = sessions.filter((x) => inWindow(x, now, hours));
  if (!s.length) return `No spotter planes circled in the last ${hours} h`;
  const planes = new Set(s.map((x) => x.reg || x.hex)).size;
  const live = s.filter((x) => x.active).length;
  return `${planes} plane${planes === 1 ? '' : 's'} · ${s.length} spot${s.length === 1 ? '' : 's'} worked${live ? ` · ${live} circling now` : ''}`;
}
