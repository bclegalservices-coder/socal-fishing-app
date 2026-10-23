// Map wind readout (shows while the Wind layer is on): how hard it's blowing at the middle of the map, from where,
// gusts, a one-line "building / easing" report and what the nearest buoy measures. Tap → Weather → Wind.
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, makeStyles } from '../theme';
import { getJSON } from '../api';
import { compass } from '../weather/model';
import { beaufort, windColor } from '../weather/wind';
import type { Conditions } from '../types';

type W = { kt: number | null; gust: number | null; dir: number | null; next: { t: string; kt: number }[]; buoy: { kt: number; dir: number | null; name: string } | null };

export function WindCard({ lat, lon, onOpen }: { lat: number; lon: number; onOpen?: () => void }) {
  const st = useSt();
  const [w, setW] = useState<W | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;           // ~1 km: don't refetch for small pans
  const last = useRef('');
  useEffect(() => {
    if (key === last.current) return;
    const t = setTimeout(async () => {
      last.current = key; setBusy(true); setFailed(false);
      try {
        const r = await getJSON<Conditions>(`/conditions?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&fields=weather,waves`, { timeoutMs: 12000, cacheKey: `wind:${key}` });
        const wi = r.data.weather?.items?.find((m) => m.type === 'wind');
        const bo = r.data.waves?.items?.find((m) => m.type === 'wind_observed');
        setW({
          kt: typeof wi?.value === 'number' ? wi.value : null, gust: (wi?.extra?.gust_kt as number) ?? null, dir: (wi?.extra?.dir as number) ?? null,
          next: (r.data.weather?.data?.wind_48h ?? []) as { t: string; kt: number }[],
          buoy: typeof bo?.value === 'number' ? { kt: bo.value, dir: null, name: String(r.data.waves?.data?.station?.name ?? r.data.waves?.data?.station?.id ?? 'buoy') } : null,
        });
      } catch { last.current = ''; setFailed(true); } finally { setBusy(false); }
    }, 700);
    return () => clearTimeout(t);
  }, [key, retry]);
  // The free server can take a minute to wake up: try again by itself every 20 s while it fails.
  useEffect(() => { if (!failed) return; const t = setTimeout(() => setRetry((n) => n + 1), 20000); return () => clearTimeout(t); }, [failed, retry]);

  if (!w) return (
    <Pressable style={st.card} onPress={() => setRetry((n) => n + 1)} accessibilityRole="button">
      <MaterialCommunityIcons name="weather-windy" size={20} color={colors.muted} />
      <Text style={st.sub}>{busy ? 'Checking the wind here…' : failed ? 'Wind report not loaded — tap to retry' : 'Checking the wind here…'}</Text>
    </Pressable>
  );
  const bf = beaufort(w.kt);
  const c = windColor(w.kt);
  return (
    <Pressable onPress={onOpen} style={({ pressed }) => [st.card, pressed && { opacity: 0.85 }]} accessibilityRole="button"
      accessibilityLabel={`Wind ${w.kt ?? 'unknown'} knots from the ${compass(w.dir)}, gusts ${w.gust ?? 'unknown'}. ${trend(w)}. Tap for the full wind forecast.`}>
      <View style={[st.dot, { borderColor: c }]}>
        {w.dir != null ? <MaterialCommunityIcons name="navigation" size={22} color={c} style={{ transform: [{ rotate: `${(w.dir + 180) % 360}deg` }] }} /> : <Text style={st.sub}>—</Text>}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={st.main} numberOfLines={1}>
          <Text style={{ color: c }}>{w.kt ?? '—'} kt</Text> {compass(w.dir)}{w.gust ? <Text style={st.gust}>  gusts {Math.round(w.gust)}</Text> : null}
        </Text>
        <Text style={st.sub} numberOfLines={1}>{bf.name} · {trend(w)}</Text>
        {w.buoy ? <Text style={st.buoy} numberOfLines={1}>Buoy measuring {Math.round(w.buoy.kt)} kt</Text> : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** "Building to 17 kt by 2 PM" / "easing to 6 kt by 8 PM" / "steady", from the next 12 hours. */
export function trend(w: { kt: number | null; next: { t: string; kt: number }[] }): string {
  const now = Date.now();
  const n = w.next.filter((p) => { const t = new Date(p.t).getTime(); return t > now && t < now + 12 * 3600000; });
  if (w.kt == null || !n.length) return 'forecast';
  const hi = n.reduce((m, p) => (p.kt > m.kt ? p : m), n[0]);
  const lo = n.reduce((m, p) => (p.kt < m.kt ? p : m), n[0]);
  const at = (t: string) => new Date(t).toLocaleTimeString([], { hour: 'numeric' });
  if (hi.kt - w.kt >= 4) return `building to ${Math.round(hi.kt)} kt by ${at(hi.t)}`;
  if (w.kt - lo.kt >= 4) return `easing to ${Math.round(lo.kt)} kt by ${at(lo.t)}`;
  return 'steady for the next few hours';
}

const useSt = makeStyles((colors) => ({
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.panelSolid, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 10,
    borderWidth: 1, borderColor: colors.border, maxWidth: 300,
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  dot: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inset },
  main: { color: colors.text, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  gust: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  buoy: { color: colors.live, fontSize: 11.5, fontWeight: '700' },
}));
