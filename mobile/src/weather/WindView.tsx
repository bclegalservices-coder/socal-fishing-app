// Weather → Wind: how hard it's blowing and where from, now and for the next 5 days.
//  • A compass dial with the wind arrow, speed, gusts and the Beaufort name (tap to switch knots ↔ mph).
//  • A scrollable hour-by-hour timeline: bar height = wind, dot = gust, color = strength, little arrow = direction.
//    Tap any hour and the dial shows that hour.
//  • One card per day: strongest wind and gusts, prevailing direction, the calmest daylight window, short notes.
//  • What the nearest buoy is actually measuring right now.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, makeStyles } from '../theme';
import { ageText, getJSON } from '../api';
import { friendly } from '../friendly';
import { track } from '../analytics';
import { compass, dayLabel, localDate, weatherPath, type Boat, type Hour, type WeatherResponse } from './model';
import { WIND_BANDS, beaufort, calmWindow, ktToMph, prevailing, windColor, windNotes } from './wind';

type Place = { lat: number; lon: number; label: string };
const UNIT_KEY = 'wind-unit:v1';
const COL_W = 22, PLOT_H = 110;

export function WindView({ place, boat }: { place: Place; boat: Boat }) {
  const st = useSt();
  const [res, setRes] = useState<{ data: WeatherResponse; cached: boolean; savedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);                     // selected hour index (0 = now)
  const [mph, setMph] = useState(false);
  const scroller = useRef<any>(null);
  const path = weatherPath(place.lat, place.lon, boat, null);

  useEffect(() => { AsyncStorage.getItem(UNIT_KEY).then((v) => setMph(v === 'mph')).catch(() => {}); }, []);
  const flipUnit = () => { const v = !mph; setMph(v); AsyncStorage.setItem(UNIT_KEY, v ? 'mph' : 'kt').catch(() => {}); };
  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await getJSON<WeatherResponse>(path, { cacheKey: `wx:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${boat.type}:${boat.length_ft}:${boat.comfort}:null`, timeoutMs: 20000 });
      setRes(r); track('weather_section', { section: 'wind_loaded', cached: r.cached });
    } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); setSel(0); }, [path]);

  const hours: Hour[] = useMemo(() => {
    const now = Date.now() - 3600000;
    return (res?.data.forecast.hourly ?? []).filter((h) => new Date(h.t).getTime() >= now && h.wind_kt != null);
  }, [res]);
  const days = useMemo(() => {
    const by = new Map<string, Hour[]>();
    for (const h of hours) { const d = localDate(h.t); if (!by.has(d)) by.set(d, []); by.get(d)!.push(h); }
    return [...by.entries()].map(([date, hs]) => ({ date, hs }));
  }, [hours]);
  const u = (kt?: number | null) => (kt == null ? '—' : String(Math.round(mph ? ktToMph(kt) : kt)));
  const unit = mph ? 'mph' : 'kt';
  const h = hours[Math.min(sel, hours.length - 1)];
  const buoy = res?.data.buoy_now;
  const maxKt = Math.max(15, ...hours.map((x) => x.gust_kt ?? x.wind_kt ?? 0));
  const jumpTo = (date: string) => {
    const i = hours.findIndex((x) => localDate(x.t) === date && new Date(x.t).getHours() >= 6);
    const k = i >= 0 ? i : hours.findIndex((x) => localDate(x.t) === date);
    if (k >= 0) { setSel(k); scroller.current?.scrollTo({ x: Math.max(0, k * COL_W - 120), animated: true }); }
  };

  if (!res && loading) return <ActivityIndicator color={colors.live} style={{ marginTop: 40 }} />;
  if (!res) return <Text style={st.err}>{err ?? 'No wind forecast here yet.'}</Text>;
  if (!hours.length) return <Text style={st.err}>{res.data.forecast.note ?? 'No hourly wind forecast for this spot.'}</Text>;

  const bf = beaufort(h?.wind_kt);
  const selTime = h ? (sel === 0 ? 'Now' : `${new Date(h.t).toLocaleDateString([], { weekday: 'short' })} ${new Date(h.t).toLocaleTimeString([], { hour: 'numeric' })}`) : '';
  const today = days[0]?.hs ?? [];
  const notes = windNotes(today);

  return (
    <ScrollView contentContainerStyle={st.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.live} />}>
      {/* Dial */}
      <View style={st.hero}>
        <Dial dir={h?.wind_dir ?? null} kt={h?.wind_kt ?? null} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={st.when}>{selTime} · forecast</Text>
          <Pressable onPress={flipUnit} accessibilityRole="button" accessibilityLabel="Switch knots and mph">
            <Text style={[st.big, { color: windColor(h?.wind_kt) }]}>{u(h?.wind_kt)}<Text style={st.bigU}> {unit}</Text></Text>
          </Pressable>
          <Text style={st.line}>from the <Text style={st.b}>{compass(h?.wind_dir)}</Text>{h?.wind_dir != null ? ` (${Math.round(h.wind_dir)}°)` : ''}</Text>
          <Text style={st.line}>Gusts <Text style={st.b}>{u(h?.gust_kt)} {unit}</Text></Text>
          <View style={[st.bf, { backgroundColor: windColor(h?.wind_kt) }]}><Text style={st.bfT}>{bf.force >= 0 ? `Force ${bf.force} · ` : ''}{bf.name}</Text></View>
          <Text style={st.tapHint}>Tap the number for {mph ? 'knots' : 'mph'}</Text>
        </View>
      </View>

      {/* Short report */}
      <View style={st.card}>
        <Text style={st.cardH}>Wind report</Text>
        <Text style={st.report}>{report(today, u, unit)}</Text>
        {notes.map((n, i) => <Text key={i} style={st.note}>• {n}</Text>)}
        {buoy?.wind_kt != null ? (
          <Text style={st.buoy}>
            <MaterialCommunityIcons name="lifebuoy" size={13} color={colors.live} /> Measured at {buoy.station?.name ?? `buoy ${buoy.station?.id}`} ({buoy.distance_nm} NM): {u(buoy.wind_kt)}{buoy.gust_kt ? ` gusting ${u(buoy.gust_kt)}` : ''} {unit} {compass(buoy.wind_dir)} · {ageText(buoy.observed_at)}
          </Text>
        ) : null}
      </View>

      {/* Timeline */}
      <View style={st.card}>
        <View style={st.tlHead}>
          <Text style={st.cardH}>Hour by hour</Text>
          <Text style={st.tlHint}>tap an hour</Text>
        </View>
        <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false}>
          <View>
            <View style={{ flexDirection: 'row', height: PLOT_H + 18, alignItems: 'flex-end' }}>
              {hours.map((x, i) => {
                const on = i === sel;
                const bh = Math.max(3, ((x.wind_kt ?? 0) / maxKt) * PLOT_H);
                const gh = x.gust_kt != null ? ((x.gust_kt) / maxKt) * PLOT_H : null;
                const newDay = i > 0 && localDate(x.t) !== localDate(hours[i - 1].t);
                return (
                  <Pressable key={x.t} onPress={() => setSel(i)} style={[st.col, on && st.colOn, newDay && st.newDay]} accessibilityLabel={`${new Date(x.t).toLocaleString([], { weekday: 'short', hour: 'numeric' })}: ${u(x.wind_kt)} ${unit}, gusts ${u(x.gust_kt)}, from ${compass(x.wind_dir)}`}>
                    <View style={{ height: 16, alignItems: 'center', justifyContent: 'center' }}>
                      {x.wind_dir != null ? <MaterialCommunityIcons name="navigation" size={11} color={colors.muted} style={{ transform: [{ rotate: `${(x.wind_dir + 180) % 360}deg` }] }} /> : null}
                    </View>
                    <View style={{ height: PLOT_H, justifyContent: 'flex-end', alignItems: 'center' }}>
                      {gh != null ? <View style={[st.gust, { bottom: gh - 3 }]} /> : null}
                      <View style={{ width: 12, height: bh, borderRadius: 3, backgroundColor: windColor(x.wind_kt), opacity: on ? 1 : 0.85 }} />
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row' }}>
              {hours.map((x, i) => {
                const hr = new Date(x.t).getHours();
                const newDay = i === 0 || localDate(x.t) !== localDate(hours[i - 1].t);
                return (
                  <View key={x.t} style={{ width: COL_W, alignItems: 'flex-start' }}>
                    <Text style={[st.tick, newDay && st.tickDay]} numberOfLines={1}>
                      {newDay ? new Date(x.t).toLocaleDateString([], { weekday: 'short' }) : hr % 3 === 0 ? new Date(x.t).toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '').toLowerCase() : ''}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>
        <View style={st.legend}>
          {WIND_BANDS.map((b) => (
            <View key={b.label} style={st.legI}><View style={[st.legSw, { backgroundColor: b.color }]} /><Text style={st.legT}>{b.label}</Text></View>
          ))}
          <Text style={st.legT}>kt · dot = gust</Text>
        </View>
      </View>

      {/* Days */}
      {days.map(({ date, hs }) => {
        const top = hs.reduce((m, x) => ((x.wind_kt ?? 0) > (m.wind_kt ?? 0) ? x : m), hs[0]);
        const gust = Math.max(...hs.map((x) => x.gust_kt ?? 0));
        const p = prevailing(hs.filter((x) => { const hr = new Date(x.t).getHours(); return hr >= 6 && hr <= 18; }));
        const calm = calmWindow(hs);
        return (
          <Pressable key={date} onPress={() => jumpTo(date)} style={st.day} accessibilityRole="button" accessibilityLabel={`${dayLabel(date)} wind`}>
            <View style={[st.dayBar, { backgroundColor: windColor(top.wind_kt) }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.dayH}>{dayLabel(date)}</Text>
              <Text style={st.dayL}>
                Up to <Text style={st.b}>{u(top.wind_kt)} {unit}</Text> around {new Date(top.t).toLocaleTimeString([], { hour: 'numeric' })}{gust ? ` · gusts ${u(gust)}` : ''}{p != null ? ` · mostly from the ${compass(p)}` : ''}
              </Text>
              <Text style={[st.dayL, { color: calm ? colors.ok : colors.muted }]}>
                {calm ? `Calmest: ${new Date(calm.start).toLocaleTimeString([], { hour: 'numeric' })}–${new Date(calm.end).toLocaleTimeString([], { hour: 'numeric' })} (under ${u(10)} ${unit})` : `No calm stretch (under ${u(10)} ${unit}) in daylight`}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
          </Pressable>
        );
      })}
      <Text style={st.src}>Forecast: National Weather Service{res.data.forecast.updated ? ` · issued ${ageText(res.data.forecast.updated)}` : ''}{res.cached ? ' · saved copy (offline)' : ''}. Buoy: NOAA NDBC (measured).</Text>
    </ScrollView>
  );
}

/** One or two sentences: now → the day's peak → the evening. */
function report(hs: Hour[], u: (k?: number | null) => string, unit: string): string {
  if (!hs.length) return 'No forecast for the rest of today.';
  const now = hs[0];
  const top = hs.reduce((m, x) => ((x.wind_kt ?? 0) > (m.wind_kt ?? 0) ? x : m), hs[0]);
  const last = hs[hs.length - 1];
  const name = beaufort(now.wind_kt).name.toLowerCase();
  let s = `${u(now.wind_kt)} ${unit} from the ${compass(now.wind_dir)} right now (${name})`;
  if ((top.wind_kt ?? 0) - (now.wind_kt ?? 0) >= 4) s += `, building to ${u(top.wind_kt)} ${unit} around ${new Date(top.t).toLocaleTimeString([], { hour: 'numeric' })}`;
  else s += ', holding about the same';
  if (last !== top && (top.wind_kt ?? 0) - (last.wind_kt ?? 0) >= 4) s += `, easing to ${u(last.wind_kt)} ${unit} by ${new Date(last.t).toLocaleTimeString([], { hour: 'numeric' })}`;
  return `${s}.`;
}

/** Compass dial: the arrow points where the wind is GOING (it blows from the letter it starts at). */
export function Dial({ dir, kt, size = 128 }: { dir: number | null; kt: number | null; size?: number }) {
  const st = useSt();
  const rot = useRef(new Animated.Value(dir ?? 0)).current;
  const last = useRef(dir ?? 0);
  useEffect(() => {
    if (dir == null) return;
    // shortest way round (350° → 10° turns 20°, not 340°)
    let target = dir;
    const d = ((target - last.current + 540) % 360) - 180;
    target = last.current + d; last.current = target;
    Animated.spring(rot, { toValue: target, useNativeDriver: true, speed: 12, bounciness: 6 }).start();
  }, [dir]);
  const spin = rot.interpolate({ inputRange: [-3600, 3600], outputRange: ['-3420deg', '3780deg'] });   // +180: arrow shows where it's going
  const c = windColor(kt);
  return (
    <View style={[st.dial, { width: size, height: size, borderRadius: size / 2, borderColor: c }]}>
      {['N', 'E', 'S', 'W'].map((L, i) => (
        <Text key={L} style={[st.dialL, i === 0 && { top: 4, alignSelf: 'center' }, i === 1 && { right: 7, top: size / 2 - 9 }, i === 2 && { bottom: 4, alignSelf: 'center' }, i === 3 && { left: 7, top: size / 2 - 9 }]}>{L}</Text>
      ))}
      {[...Array(12)].map((_, i) => (
        <View key={i} style={[st.tickM, { transform: [{ rotate: `${i * 30}deg` }, { translateY: -size / 2 + 14 }] }]} />
      ))}
      {dir != null ? (
        <Animated.View style={{ position: 'absolute', transform: [{ rotate: spin }] }}>
          <MaterialCommunityIcons name="navigation" size={size * 0.42} color={c} />
        </Animated.View>
      ) : <Text style={st.dialNone}>—</Text>}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  body: { padding: 14, gap: 12, paddingBottom: 40 },
  err: { color: colors.muted, fontSize: 15, textAlign: 'center', marginTop: 40, paddingHorizontal: 20 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: colors.panelSolid, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.border },
  when: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  big: { fontSize: 52, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1.5, lineHeight: 58 },
  bigU: { fontSize: 18, fontWeight: '800', color: colors.muted },
  line: { color: colors.text, fontSize: 15 },
  b: { fontWeight: '800' },
  bf: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  bfT: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  tapHint: { color: colors.faint, fontSize: 11, marginTop: 2 },
  dial: { borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.inset },
  dialL: { position: 'absolute', color: colors.muted, fontSize: 12, fontWeight: '900' },
  dialNone: { color: colors.muted, fontSize: 30 },
  tickM: { position: 'absolute', width: 2, height: 6, backgroundColor: colors.border, borderRadius: 1 },
  card: { backgroundColor: colors.panelSolid, borderRadius: 16, padding: 14, gap: 6, borderWidth: 1, borderColor: colors.border },
  cardH: { color: colors.text, fontSize: 17, fontWeight: '800' },
  report: { color: colors.text, fontSize: 15.5, lineHeight: 21 },
  note: { color: colors.text, fontSize: 14, lineHeight: 19 },
  buoy: { color: colors.muted, fontSize: 13, marginTop: 4 },
  tlHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tlHint: { color: colors.faint, fontSize: 12 },
  col: { width: COL_W, alignItems: 'center', borderRadius: 6 },
  colOn: { backgroundColor: colors.inset },
  newDay: { borderLeftWidth: 1, borderLeftColor: colors.line },
  gust: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text },
  tick: { color: colors.muted, fontSize: 10, fontWeight: '600', width: COL_W * 3 },
  tickDay: { color: colors.text, fontWeight: '900' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6 },
  legI: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  legSw: { width: 12, height: 8, borderRadius: 2 },
  legT: { color: colors.muted, fontSize: 11 },
  day: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.panelSolid, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border },
  dayBar: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  dayH: { color: colors.text, fontSize: 16, fontWeight: '800' },
  dayL: { color: colors.text, fontSize: 13.5 },
  src: { color: colors.faint, fontSize: 11.5, textAlign: 'center', marginTop: 4 },
}));
