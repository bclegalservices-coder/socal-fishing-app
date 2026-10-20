// Tide from the downloaded 30-day pack, computed on the phone (works offshore with no signal).
export type PackStation = { id: string; name: string; lat: number; lon: number; hilo: { t: string; v: number; type: string }[]; hourly: [string, number][] };

const nmBetween = (a: number, b: number, c: number, d: number) => {
  const p1 = (a * Math.PI) / 180, p2 = (c * Math.PI) / 180;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((((d - b) * Math.PI) / 180) / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
};

export function offlineTide(stations: PackStation[], lat: number, lon: number, now = Date.now()) {
  if (!stations.length) return null;
  let st = stations[0], d = Infinity;
  for (const s of stations) { const x = nmBetween(lat, lon, s.lat, s.lon); if (x < d) { d = x; st = s; } }
  const pts = st.hourly.map(([t, v]) => [new Date(t).getTime(), v] as const);
  let height: number | null = null, trend: 'rising' | 'falling' | null = null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1][0] <= now && now <= pts[i][0]) {
      const f = (now - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      height = Math.round((pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f) * 100) / 100;
      trend = pts[i][1] >= pts[i - 1][1] ? 'rising' : 'falling';
      break;
    }
  }
  const next = st.hilo.filter((p) => new Date(p.t).getTime() > now);
  return { station: { id: st.id, name: st.name }, distance_nm: Math.round(d * 10) / 10, height_ft: height, trend,
    next_high: next.find((p) => p.type === 'H') ?? null, next_low: next.find((p) => p.type === 'L') ?? null,
    covered: pts.length ? now <= pts[pts.length - 1][0] : false };
}
