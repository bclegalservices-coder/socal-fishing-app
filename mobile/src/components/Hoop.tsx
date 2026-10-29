// Hoop netting screens (Oct 28): numbered net pins + the set line on the map, a "Next up" banner that guides you
// back, and a big-button panel for dropping, pulling and re-dropping. The rules live in ../hoop.ts.
import { useEffect, useMemo, useRef } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles, touch } from '../theme';
import { cardinal } from '../geo';
import { aboard, atNet, dropSuggestion, fmtFt, guide, inUse, limitFor, nextUp, pullOrder, setLine, soakState, soakText, type HoopSet, type Pot } from '../hoop';

// Oct 28: nets in the water are YELLOW, the next one up flashes NEON PINK (and the guide line to it is pink).
const C = { down: '#FFD400', soon: '#FF8A00', due: '#E0002A', aboard: '#7A8794', next: '#FF2BD6', line: '#FFFFFF', guide: '#FF2BD6', ok: '#1CA05A' };
const inkOn = (fill: string) => (fill === C.down ? '#10263A' : '#FFFFFF');

function useFlash(period = 1400) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: period / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, period]);
  return v;
}

/** Map part (inside <MapView>): set line, line from the boat to the next net, and a numbered pin per net. */
export function HoopMapLayer({ set, boat, now, onPotPress }: { set: HoopSet; boat: { lat: number; lon: number } | null; now: number; onPotPress: (p: Pot) => void }) {
  const flash = useFlash();
  const nu = nextUp(set);
  const line = useMemo(() => ({ type: 'FeatureCollection', features: setLine(set).length > 1
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: setLine(set).map((p) => [p.lon, p.lat]) } }] : [] }), [set]);
  const toNext = useMemo(() => ({ type: 'FeatureCollection', features: boat && nu
    ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[boat.lon, boat.lat], [nu.lon, nu.lat]] } }] : [] }), [boat, nu]);
  return (
    <>
      <GeoJSONSource id="hoop-line" data={line as any}>
        <Layer type="line" id="hoop-line-casing" style={{ lineColor: '#0B2235', lineWidth: 6, lineOpacity: 0.55, lineCap: 'round', lineJoin: 'round' }} />
        <Layer type="line" id="hoop-line-dash" style={{ lineColor: C.line, lineWidth: 3, lineDasharray: [2, 1.6], lineCap: 'round', lineJoin: 'round' }} />
      </GeoJSONSource>
      <GeoJSONSource id="hoop-guide" data={toNext as any}>
        <Layer type="line" id="hoop-guide-line" style={{ lineColor: C.guide, lineWidth: 3.5, lineOpacity: 0.95, lineCap: 'round' }} />
      </GeoJSONSource>
      {set.pots.filter((p) => p.state !== 'done').map((p) => {
        const isNext = nu?.no === p.no;
        const soak = soakState(p, now);
        const fill = p.state === 'aboard' ? C.aboard : isNext ? C.next : soak === 'due' ? C.due : soak === 'soon' ? C.soon : C.down;
        return (
          <Marker key={`hoop-${p.no}`} lngLat={[p.lon, p.lat]} anchor="center">
            <Pressable onPress={() => onPotPress(p)} hitSlop={8} style={s.wrap} accessibilityRole="button"
              accessibilityLabel={`Net number ${p.no}, ${p.state === 'aboard' ? 'aboard' : `soaked ${soakText(now - p.droppedAt)}`}${isNext ? ', next up' : ''}`}>
              {isNext ? (
                <>
                  <Animated.View pointerEvents="none" style={[s.glow, { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.55] }),
                    transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] }) }] }]} />
                  <Animated.View pointerEvents="none" style={[s.ring, { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                    transform: [{ scale: flash.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] }) }] }]} />
                </>
              ) : null}
              <Animated.View style={[s.pin, { backgroundColor: fill }, isNext && s.pinNext,
                isNext ? { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) } : null]}>
                <Text style={[s.pinT, { color: inkOn(fill) }]}>{p.no}</Text>
              </Animated.View>
              <View style={s.tag} pointerEvents="none">
                <Text style={[s.tagT, soak === 'due' && { color: C.due }]}>{p.state === 'aboard' ? 'aboard' : soakText(now - p.droppedAt)}</Text>
              </View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

/** Top banner (slim, Oct 28 v2): next net, how far / which way, soak time, boat speed. Replaces the GPS card while hooping
 *  so the map stays visible. */
export function HoopBanner({ set, boat, heading, now, sogKt }: { set: HoopSet; boat: { lat: number; lon: number } | null; heading: number | null; now: number; sogKt?: number | null }) {
  const st = useSt();
  const nu = nextUp(set);
  const g = guide(boat, nu);
  const here = atNet(set, boat);
  const due = pullOrder(set).filter((p) => soakState(p, now) === 'due');
  const soon = pullOrder(set).filter((p) => soakState(p, now) === 'soon');
  const rel = g && heading != null ? g.brg - heading : g?.brg ?? 0;
  const warn = due.length ? { c: C.due, t: `${due.map((p) => `No. ${p.no}`).join(', ')} past 2-hr check` }
    : soon.length ? { c: C.soon, t: `${soon.map((p) => `No. ${p.no}`).join(', ')} 2-hr check soon` } : null;
  return (
    <View style={st.banner} accessibilityLiveRegion="polite">
      <View style={st.arrowWrap}>
        {nu && g ? <Ionicons name="navigate" size={22} color={C.next} style={{ transform: [{ rotate: `${rel - 45}deg` }] }} />
          : <Ionicons name="ellipse-outline" size={20} color={C.next} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.next} numberOfLines={1}>{nu ? (here?.no === nu.no ? `At No. ${nu.no}` : `Next: No. ${nu.no}`) : set.pots.length ? 'All nets up' : 'Drop your first net'}</Text>
        <Text style={st.sub} numberOfLines={1}>
          {nu ? `${g ? `${fmtFt(g.ft)} · ${cardinal(g.brg)} ${String(Math.round(g.brg)).padStart(3, '0')}°` : 'Waiting for GPS'} · ${soakText(now - nu.droppedAt)}` : set.pots.length ? 'Re-drop or end the set' : 'Tap Drop as the net goes in'}
        </Text>
      </View>
      <View style={st.side}>
        <Text style={st.sideBig}>{sogKt != null ? sogKt.toFixed(1) : '–'}<Text style={st.sideU}> kt</Text></Text>
        <Text style={st.sideS}>{inUse(set)}/{limitFor(set.crew)} nets</Text>
      </View>
      {warn ? <View style={[st.warn, { backgroundColor: warn.c }]}><Text style={st.warnT} numberOfLines={1}>{warn.t}</Text></View> : null}
    </View>
  );
}

/** Bottom bar (slim, Oct 28 v2): PULLED + DROP side by side, then one row of small net chips with Undo and "more". */
export function HoopPanel({ set, boat, now, canUndo, onPull, onDrop, onUndo, onCrew, onEnd, onPotPress }: {
  set: HoopSet; boat: { lat: number; lon: number } | null; now: number; canUndo: boolean;
  onPull: (no: number) => void; onDrop: () => void; onUndo: () => void; onCrew: () => void; onEnd: () => void; onPotPress: (p: Pot) => void;
}) {
  const st = useSt();
  const nu = nextUp(set);
  const g = guide(boat, nu);
  const here = atNet(set, boat);
  const sug = dropSuggestion(set);
  const order = pullOrder(set);
  const up = aboard(set).sort((a, b) => a.no - b.no);
  const atNext = !!(nu && here && here.no === nu.no);
  const more = () => Alert.alert('Hoop set', `${set.crew <= 1 ? 'Solo · 5 nets max' : '2+ aboard · 10 nets per boat'}. Tap a net's number (on the map or below) to move it, re-drop it, or get guided to it.`, [
    { text: set.crew <= 1 ? 'Change to 2+ aboard (10 nets)' : 'Change to solo (5 nets)', onPress: onCrew },
    { text: 'End set', style: 'destructive', onPress: onEnd },
    { text: 'Close', style: 'cancel' },
  ]);
  return (
    <View style={st.panel}>
      <View style={st.row}>
        {nu ? (
          <Pressable onPress={() => onPull(nu.no)} style={({ pressed }) => [st.pull, !atNext && st.pullFar, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Mark net ${nu.no} pulled`}>
            <Text style={st.pullT}>PULLED {nu.no}</Text>
            <Text style={st.pullS} numberOfLines={1}>{atNext ? "You're at it" : g ? `${fmtFt(g.ft)} away` : 'Tap when up'}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onDrop} disabled={sug.kind === 'full'} style={({ pressed }) => [st.drop, sug.kind === 'redrop' && { borderColor: colors.live }, sug.kind === 'full' && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
          accessibilityRole="button" accessibilityLabel={sug.kind === 'redrop' ? `Re-drop net ${sug.no}` : sug.kind === 'new' ? `Drop net ${sug.no}` : 'Net limit reached'}>
          <Text style={[st.dropT, sug.kind === 'redrop' && { color: colors.live }]} numberOfLines={1}>
            {sug.kind === 'redrop' ? `RE-DROP ${sug.no}` : sug.kind === 'new' ? `DROP ${sug.no}` : `LIMIT ${limitFor(set.crew)}`}
          </Text>
          <Text style={st.dropS} numberOfLines={1}>{sug.kind === 'redrop' ? 'Back of the line' : sug.kind === 'new' ? (boat ? 'Net at the boat' : 'Waiting for GPS') : 'Net limit reached'}</Text>
        </Pressable>
      </View>
      <View style={st.row2}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
          {order.map((p, i) => {
            const soak = soakState(p, now);
            const c = i === 0 ? C.next : soak === 'due' ? C.due : soak === 'soon' ? C.soon : '#C9A800';
            return (
              <Pressable key={p.no} onPress={() => onPotPress(p)} style={[st.chip, { borderColor: c }, i === 0 && { backgroundColor: c }]} accessibilityRole="button" accessibilityLabel={`Net ${p.no}, soaked ${soakText(now - p.droppedAt)}`}>
                <Text style={[st.chipN, { color: i === 0 ? '#FFFFFF' : c }]}>{p.no}</Text>
                <Text style={[st.chipS, i === 0 && { color: '#FFFFFF' }]}>{soakText(now - p.droppedAt)}</Text>
              </Pressable>
            );
          })}
          {up.map((p) => (
            <Pressable key={p.no} onPress={() => onPotPress(p)} style={[st.chip, { borderColor: C.aboard }]} accessibilityRole="button" accessibilityLabel={`Net ${p.no}, aboard`}>
              <Text style={[st.chipN, { color: C.aboard }]}>{p.no}</Text>
              <Text style={st.chipS}>up</Text>
            </Pressable>
          ))}
          {!order.length && !up.length ? <Text style={st.empty}>Pull order shows here</Text> : null}
        </ScrollView>
        <Pressable onPress={onUndo} disabled={!canUndo} style={[st.iconBtn, !canUndo && { opacity: 0.35 }]} accessibilityRole="button" accessibilityLabel="Undo"><Ionicons name="arrow-undo" size={20} color={colors.text} /></Pressable>
        <Pressable onPress={more} style={st.iconBtn} accessibilityRole="button" accessibilityLabel="More: crew size, end set"><Ionicons name="ellipsis-horizontal" size={20} color={colors.text} /></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
  ring: { position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 4, borderColor: C.next },
  glow: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: C.next },
  pin: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  pinNext: { width: 34, height: 34, borderRadius: 17, borderColor: '#FFFFFF', shadowColor: C.next, shadowOpacity: 0.9, shadowRadius: 10 },
  pinT: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  tag: { position: 'absolute', top: 40, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  tagT: { color: '#10263A', fontSize: 10.5, fontWeight: '800' },
});

const useSt = makeStyles((colors) => ({
  banner: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginHorizontal: 10, marginTop: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 16, backgroundColor: 'rgba(14,38,64,0.94)' },
  arrowWrap: { width: 40, height: 40, borderRadius: 20, borderWidth: 2.5, borderColor: '#FF2BD6', alignItems: 'center', justifyContent: 'center' },
  next: { color: '#FFFFFF', fontSize: 19, fontWeight: '900' },
  sub: { color: '#FF7BE6', fontSize: 13.5, fontWeight: '800', marginTop: 1 },
  side: { alignItems: 'flex-end' },
  sideBig: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  sideU: { color: '#AFC8E6', fontSize: 11, fontWeight: '700' },
  sideS: { color: '#AFC8E6', fontSize: 11.5, fontWeight: '800' },
  warn: { width: '100%', borderRadius: 7, paddingHorizontal: 8, paddingVertical: 2 },
  warnT: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  panel: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  pull: { flex: 1, backgroundColor: C.ok, borderRadius: 14, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  pullFar: { backgroundColor: '#2E7D5A' },
  pullT: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', letterSpacing: 0.3 },
  pullS: { color: '#E1FFEC', fontSize: 12, fontWeight: '600' },
  drop: { flex: 1, minHeight: 56, borderRadius: 14, borderWidth: 2.5, borderColor: C.down, backgroundColor: colors.panelSolid, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  dropT: { color: C.down, fontSize: 19, fontWeight: '900' },
  dropS: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  row2: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { minWidth: 50, height: 44, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: colors.panelSolid },
  chipN: { fontSize: 16, fontWeight: '900', lineHeight: 18 },
  chipS: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 13 },
  iconBtn: { width: 44, height: 44, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
}));
