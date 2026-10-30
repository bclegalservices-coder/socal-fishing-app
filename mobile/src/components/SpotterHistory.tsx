// Spotter activity (Oct 29): where likely spotter planes circled low over the water in the last 3–24 hours — their
// REAL recorded flight paths (the server saves every broadcast position, about every 10 s; api/air/history.py),
// colored by time: hot pink = now, orange ≈ 3 h, yellow ≈ 6 h, faded blue = 12 h+. Tap a loop for the plane.
import { useEffect, useMemo, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import { FEATURES_TOP, below } from '../layers/order';
import { formatLatLon } from '../geo';
import { faaLink, planeModel, type Plane } from './AirTraffic';
import { AGE_STOPS, HOURS, ageColor, ageColorExpression, agoText, historyGeoJSON, inWindow, summaryText, type SpotHistory, type SpotSession } from '../spotterHistory';

/** Loads the last 24 h once a minute while `on` and the app is in front (the window is chosen on the phone). */
export function useSpotterHistory(on: boolean) {
  const [data, setData] = useState<SpotHistory | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const s = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => s.remove(); }, []);
  useEffect(() => {
    if (!on || !active) return;
    let alive = true;
    const load = () => getJSON<SpotHistory>('/air/history?hours=24', { timeoutMs: 20000 }).then((r) => { if (alive) setData(r.data); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [on, active]);
  return data;
}

const asPlane = (s: SpotSession) => ({ desc: s.desc, type: s.type } as unknown as Plane);
const nowS = () => Math.floor(Date.now() / 1000);

/** Map part (inside <MapView>): the loops, plus a ring at the middle of each set of loops with a label. */
export function SpotterHistoryLayer({ data, hours, labels, onPick }: { data: SpotHistory | null; hours: number; labels: boolean; onPick: (s: SpotSession) => void }) {
  const now = nowS();
  const sessions = data?.sessions ?? [];
  const geo = useMemo(() => historyGeoJSON(sessions, now, hours), [data, hours, Math.floor(now / 60)]);
  const press = (e: any) => {
    const id = e?.nativeEvent?.features?.[0]?.properties?.id;
    const s = sessions.find((x) => x.id === id);
    if (s) { e.stopPropagation?.(); onPick(s); }
  };
  if (!data) return null;
  return (
    <>
      <GeoJSONSource id="spot-hist" data={geo as any} onPress={press} hitbox={{ top: 10, right: 10, bottom: 10, left: 10 }}>
        <Layer beforeId={below(FEATURES_TOP)} type="line" id="spot-hist-casing" filter={['==', ['get', 'work'], 1] as any}
          style={{ lineColor: '#FFFFFF', lineWidth: 5.5, lineOpacity: 0.55, lineCap: 'round', lineJoin: 'round' }} />
        <Layer beforeId={below(FEATURES_TOP)} type="line" id="spot-hist-line" style={{
          lineColor: ageColorExpression(), lineCap: 'round', lineJoin: 'round',
          lineWidth: ['case', ['==', ['get', 'work'], 1], 3.2, 1.6] as any,
          lineOpacity: ['case', ['==', ['get', 'work'], 1], 0.95, 0.5] as any,
        }} />
      </GeoJSONSource>
      {sessions.filter((s) => s.center && inWindow(s, now, hours)).map((s) => {
        const c = ageColor((now - s.work_to) / 3600);
        return (
          <Marker key={`sh-${s.id}`} lngLat={s.center as [number, number]} anchor="center">
            <Pressable onPress={() => onPick(s)} hitSlop={8} style={m.wrap} accessibilityRole="button"
              accessibilityLabel={`${s.reg ?? 'Plane'} circled here ${s.active ? 'now' : agoText(now - s.work_to)}, ${s.circles} circles`}>
              <View style={[m.ring, { borderColor: c }]}>{s.active ? <View style={[m.dot, { backgroundColor: c }]} /> : null}</View>
              {labels ? (
                <View style={[m.tag, { borderColor: c }]} pointerEvents="none">
                  <Text style={m.tagT} numberOfLines={1}>{s.reg ?? s.callsign ?? s.hex.toUpperCase()} · {s.active ? 'circling now' : agoText(now - s.work_to)}</Text>
                </View>
              ) : null}
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

/** The bar under the top of the map (Oct 30: one slim row): what's on, 3 / 6 / 12 / 24 h, and a thin color key. */
export function SpotterHistoryBar({ data, hours, setHours, locked, gated, onUpsell }: {
  data: SpotHistory | null; hours: number; setHours: (h: number) => void; locked: boolean; gated: boolean; onUpsell: () => void;
}) {
  const st = useSt();
  const now = nowS();
  if (locked) {
    return (
      <Pressable onPress={onUpsell} style={st.bar} accessibilityRole="button">
        <View style={st.row}><Ionicons name="lock-closed" size={14} color="#FF20D6" /><Text style={st.title} numberOfLines={1}>Spotter activity · Pro</Text></View>
      </Pressable>
    );
  }
  const list = data?.sessions.filter((x) => inWindow(x, now, hours)) ?? [];
  const live = list.filter((x) => x.active).length;
  const text = !data ? 'Loading…' : list.length ? `${list.length} spot${list.length === 1 ? '' : 's'} worked${live ? ` · ${live} now` : ''}` : 'None yet';
  return (
    <View style={st.bar}>
      <View style={st.row}>
        <MaterialCommunityIcons name="airplane-marker" size={16} color="#FF20D6" />
        <Text style={st.title} numberOfLines={1}>{text}</Text>
        <View style={st.seg}>
          {HOURS.map((h) => {
            const on = h === hours;
            return (
              <Pressable key={h} onPress={() => setHours(h)} hitSlop={4} style={[st.segI, on && st.segOn]} accessibilityRole="button"
                accessibilityLabel={`Last ${h} hours${h === 24 && gated ? ' (Pro)' : ''}`} accessibilityState={{ selected: on }}>
                <Text style={[st.segT, on && st.segTOn]}>{h}h</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={st.ramp}>
        {Array.from({ length: 16 }, (_, i) => <View key={i} style={{ flex: 1, backgroundColor: ageColor((i + 0.5) / 16 * hours) }} />)}
      </View>
    </View>
  );
}

/** Bottom card when a loop is tapped. */
export function SpotterSessionCard({ s, onClose, onCenter, onSpot, onGo }: {
  s: SpotSession; onClose: () => void; onCenter: () => void; onSpot: () => void; onGo: () => void;
}) {
  const st = useSt();
  const now = nowS();
  const c = ageColor((now - s.work_to) / 3600);
  const t = (u: number) => new Date(u * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date(s.work_from * 1000).toDateString() === new Date().toDateString() ? 'Today' : new Date(s.work_from * 1000).toLocaleDateString([], { weekday: 'short' });
  const model = planeModel(asPlane(s));
  const alt = s.alt_min == null ? '—' : s.alt_min === s.alt_max || s.alt_max == null ? `${s.alt_min.toLocaleString()} ft` : `${s.alt_min.toLocaleString()}–${s.alt_max.toLocaleString()} ft`;
  return (
    <View style={st.card}>
      <View style={st.head}>
        <View style={[st.icon, { backgroundColor: c }]}><MaterialCommunityIcons name="airplane" size={22} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.cTitle} numberOfLines={1}>{s.reg ?? s.callsign ?? 'Tail number not shared'}</Text>
          <Text style={st.model} numberOfLines={1}>{model ?? 'Aircraft type not shared'}{s.year ? ` · built ${s.year}` : ''}</Text>
          {s.owner ? <Text style={st.sub} numberOfLines={1}>Registered to {s.owner}</Text> : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></Pressable>
      </View>
      <View style={[st.badge, { borderColor: c }]}>
        <Text style={st.badgeT}>{s.active ? 'Circling here right now' : `Circled here ${agoText(now - s.work_to)}`}</Text>
      </View>
      <View style={st.grid}>
        <Stat k="When" v={`${day} ${t(s.work_from)}–${s.active ? 'now' : t(s.work_to)}`} />
        <Stat k="Worked the spot" v={`${s.minutes} min`} />
      </View>
      <View style={st.grid}>
        <Stat k="Circles (at least)" v={`${s.circles}`} />
        <Stat k="Altitude" v={alt} />
      </View>
      {s.center ? <Text style={st.sub}>Middle of the loops: {formatLatLon(s.center[1], s.center[0])}</Text> : null}
      <View style={st.btns}>
        <Pressable onPress={onCenter} style={st.btn} accessibilityRole="button"><Ionicons name="scan-outline" size={18} color={colors.text} /><Text style={st.btnT}>Show loops</Text></Pressable>
        <Pressable onPress={onSpot} style={st.btn} accessibilityRole="button"><Ionicons name="star-outline" size={18} color={colors.text} /><Text style={st.btnT}>Save spot</Text></Pressable>
        <Pressable onPress={onGo} style={[st.btn, st.btnOn]} accessibilityRole="button"><Ionicons name="navigate" size={18} color={colors.accentInk} /><Text style={[st.btnT, { color: colors.accentInk }]}>Go to</Text></Pressable>
      </View>
      {faaLink(s.reg) ? (
        <Pressable onPress={() => Linking.openURL(faaLink(s.reg)!).catch(() => {})} accessibilityRole="link" style={st.faa}>
          <Ionicons name="document-text-outline" size={16} color={colors.live} /><Text style={st.faaT}>Full FAA record for {s.reg}</Text>
        </Pressable>
      ) : null}
      <Text style={st.credit}>The plane's own broadcast positions (ADS-B), recorded about every 10 s. A plane circling low over the water is often a spotter on fish — not always.</Text>
    </View>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={st.stat}><Text style={st.statV} numberOfLines={1} adjustsFontSizeToFit>{v}</Text><Text style={st.statK}>{k}</Text></View>;
}

export const SPOT_HIST_PINK = AGE_STOPS[0][1];

const m = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minWidth: 40, minHeight: 40 },
  ring: { width: 22, height: 22, borderRadius: 11, borderWidth: 4, backgroundColor: 'rgba(255,255,255,0.95)', alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tag: { position: 'absolute', top: 34, backgroundColor: 'rgba(255,255,255,0.95)', borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, maxWidth: 200 },
  tagT: { color: '#10263A', fontSize: 11, fontWeight: '800' },
});

const useSt = makeStyles((colors) => ({
  bar: { marginTop: 6, marginHorizontal: 12, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 6, borderRadius: 14, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, gap: 5,
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: colors.text, fontSize: 13.5, fontWeight: '800', flexShrink: 1, flex: 1 },
  sub: { color: colors.muted, fontSize: 13 },
  seg: { flexDirection: 'row', borderRadius: 9, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segI: { minWidth: 34, height: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: '#FF20D6' },
  segT: { color: colors.text, fontSize: 12, fontWeight: '800' },
  segTOn: { color: '#FFFFFF' },
  ramp: { flexDirection: 'row', height: 4, borderRadius: 2, overflow: 'hidden' },
  card: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 14, gap: 9 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  model: { color: colors.text, fontSize: 14.5, fontWeight: '700' },
  badge: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  badgeT: { color: colors.text, fontSize: 13.5, fontWeight: '800' },
  grid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 9 },
  statV: { color: colors.text, fontSize: 15.5, fontWeight: '800' },
  statK: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  btns: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, flexDirection: 'row', gap: 5, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  btnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnT: { color: colors.text, fontSize: 14, fontWeight: '800' },
  faa: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  faaT: { color: colors.live, fontSize: 13.5, fontWeight: '700' },
  credit: { color: colors.muted, fontSize: 11.5 },
}));
