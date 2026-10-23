// Wind tab math (pure, tested in wind.test.ts): colors, Beaufort names, calm windows, prevailing direction,
// and the plain-English "what the wind is doing" notes.
export type WindHour = { t: string; wind_kt?: number | null; gust_kt?: number | null; wind_dir?: number | null };

/** Speed bands (knots) and their colors — the same feel as the wind layer on the map. */
export const WIND_BANDS: { max: number; color: string; label: string }[] = [
  { max: 5, color: '#7FC8E8', label: '0–5' },
  { max: 10, color: '#3FB37F', label: '5–10' },
  { max: 15, color: '#E9C93C', label: '10–15' },
  { max: 20, color: '#F29A2E', label: '15–20' },
  { max: 25, color: '#E4572E', label: '20–25' },
  { max: Infinity, color: '#B5338A', label: '25+' },
];
export const windColor = (kt?: number | null) => (kt == null ? '#A3B4C1' : WIND_BANDS.find((b) => kt < b.max)!.color);

export function beaufort(kt?: number | null): { force: number; name: string } {
  if (kt == null) return { force: -1, name: '—' };
  const table: [number, string][] = [[1, 'Calm'], [4, 'Light air'], [7, 'Light breeze'], [11, 'Gentle breeze'], [17, 'Moderate breeze'],
    [22, 'Fresh breeze'], [28, 'Strong breeze'], [34, 'Near gale'], [41, 'Gale'], [48, 'Strong gale'], [56, 'Storm']];
  const i = table.findIndex(([max]) => kt < max);
  return i === -1 ? { force: 11, name: 'Violent storm' } : { force: i, name: table[i][1] };
}

export const ktToMph = (kt: number) => kt * 1.150779;

/** Average direction the wind comes FROM (vector mean, so 350° and 10° average to 0°, not 180°). */
export function prevailing(hours: WindHour[]): number | null {
  let x = 0, y = 0, n = 0;
  for (const h of hours) {
    if (h.wind_dir == null || h.wind_kt == null) continue;
    const r = (h.wind_dir * Math.PI) / 180;
    x += Math.sin(r) * h.wind_kt; y += Math.cos(r) * h.wind_kt; n++;
  }
  if (!n || (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6)) return null;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

/** Longest run of daylight hours (5 AM – 7 PM) at or under `limit` kt (gusts under limit + 5). */
export function calmWindow(hours: WindHour[], limit = 10): { start: string; end: string; hours: number } | null {
  let best: { s: number; e: number } | null = null, s = -1;
  const ok = (h: WindHour) => {
    const hr = new Date(h.t).getHours();
    return hr >= 5 && hr <= 19 && h.wind_kt != null && h.wind_kt <= limit && (h.gust_kt == null || h.gust_kt <= limit + 5);
  };
  for (let i = 0; i <= hours.length; i++) {
    if (i < hours.length && ok(hours[i])) { if (s < 0) s = i; continue; }
    if (s >= 0 && (!best || i - s > best.e - best.s)) best = { s, e: i };
    s = -1;
  }
  if (!best || best.e - best.s < 2) return null;
  const end = new Date(new Date(hours[best.e - 1].t).getTime() + 3600000).toISOString();
  return { start: hours[best.s].t, end, hours: best.e - best.s };
}

/** Plain-English notes about a day's wind pattern. */
export function windNotes(hours: WindHour[]): string[] {
  const out: string[] = [];
  const at = (from: number, to: number) => hours.filter((h) => { const hr = new Date(h.t).getHours(); return hr >= from && hr < to && h.wind_kt != null; });
  const avg = (hs: WindHour[]) => (hs.length ? hs.reduce((a, h) => a + (h.wind_kt ?? 0), 0) / hs.length : null);
  const morning = avg(at(5, 10)), afternoon = avg(at(12, 17));
  if (morning != null && afternoon != null && afternoon - morning >= 5) {
    const peak = at(11, 19).reduce((m, h) => ((h.wind_kt ?? 0) > (m?.wind_kt ?? -1) ? h : m), null as WindHour | null);
    out.push(`Afternoon breeze builds to about ${Math.round(peak?.wind_kt ?? afternoon)} kt${peak ? ` by ${new Date(peak.t).toLocaleTimeString([], { hour: 'numeric' })}` : ''} — go early.`);
  }
  const offshore = hours.filter((h) => h.wind_dir != null && h.wind_dir >= 20 && h.wind_dir <= 110 && (h.wind_kt ?? 0) >= 12);
  if (offshore.length >= 2) out.push('Offshore wind (from the NE/E) — gusty near canyon mouths and passes, flat near the beach, rougher farther out.');
  const gusty = hours.filter((h) => h.gust_kt != null && h.wind_kt != null && h.gust_kt - h.wind_kt >= 10);
  if (gusty.length >= 2) out.push('Gusty: gusts run 10+ kt over the steady wind at times.');
  return out;
}
