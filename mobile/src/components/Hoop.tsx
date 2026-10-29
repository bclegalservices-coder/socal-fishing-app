// Hoop netting screens (Oct 28): numbered net pins + the set line on the map, a "Next up" banner that guides you
// back, and a big-button panel for dropping, pulling and re-dropping. The rules live in ../hoop.ts.
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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

/** Top banner: next net up, how far and which way, how long it has soaked; 2-hour check warning. */
export function HoopBanner({ set, boat, heading, now }: { set: HoopSet; boat: { lat: number; lon: number } | null; heading: number | null; now: number }) {
  const st = useSt();
  const nu = nextUp(set);
  const g = guide(boat, nu);
  const here = atNet(set, boat);
  const due = pullOrder(set).filter((p) => soakState(p, now) === 'due');
  const soon = pullOrder(set).filter((p) => soakState(p, now) === 'soon');
  const rel = g && heading != null ? g.brg - heading : g?.brg ?? 0;
  return (
    <View style={st.banner} accessibilityLiveRegion="polite">
      <View style={{ flex: 1 }}>
        <Text style={st.kicker}>HOOP SET · {set.pots.filter((p) => p.state === 'down').length} DOWN · {inUse(set)} OF {limitFor(set.crew)} NETS</Text>
        <Text style={st.next} numberOfLines={1}>{nu ? (here?.no === nu.no ? `At No. ${nu.no}` : `Next up: No. ${nu.no}`) : set.pots.length ? 'All nets up' : 'Drop your first net'}</Text>
        {nu ? (
          <Text style={st.sub} numberOfLines={1}>
            {g ? `${fmtFt(g.ft)} · ${cardinal(g.brg)} ${String(Math.round(g.brg)).padStart(3, '0')}° · ` : 'Waiting for GPS · '}soaked {soakText(now - nu.droppedAt)}
          </Text>
        ) : <Text style={st.sub}>{set.pots.length ? 'Re-drop or end the set below' : 'Tap "Drop No. 1" as the net goes in'}</Text>}
        {due.length ? <View style={[st.warn, { backgroundColor: C.due }]}><Text style={st.warnT}>{due.map((p) => `No. ${p.no}`).join(', ')} past the 2-hour check</Text></View>
          : soon.length ? <View style={[st.warn, { backgroundColor: C.soon }]}><Text style={st.warnT}>{soon.map((p) => `No. ${p.no}`).join(', ')} due for the 2-hour check soon</Text></View> : null}
      </View>
      {nu && g ? (
        <View style={st.arrowWrap}>
          <Ionicons name="navigate" size={40} color={C.next} style={{ transform: [{ rotate: `${rel - 45}deg` }] }} />
        </View>
      ) : null}
    </View>
  );
}

/** Bottom panel: pull the next net, drop / re-drop, pull order, crew size, undo and end. */
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
  return (
    <View style={st.panel}>
      {nu ? (
        <Pressable onPress={() => onPull(nu.no)} style={({ pressed }) => [st.pull, !atNext && st.pullFar, pressed && { opacity: 0.85 }]} accessibilityRole="button" accessibilityLabel={`Mark net ${nu.no} pulled`}>
          <Text style={st.pullT}>PULLED No. {nu.no}</Text>
          <Text style={st.pullS}>{atNext ? "You're at it — tap when it's up" : g ? `${fmtFt(g.ft)} away · tap when it's up` : "Tap when it's up"}</Text>
        </Pressable>
      ) : null}
      <View style={st.row}>
        <Pressable onPress={onDrop} disabled={sug.kind === 'full'} style={({ pressed }) => [st.drop, sug.kind === 'redrop' && { borderColor: colors.live }, sug.kind === 'full' && { opacity: 0.45 }, pressed && { opacity: 0.7 }]}
          accessibilityRole="button" accessibilityLabel={sug.kind === 'redrop' ? `Re-drop net ${sug.no}` : sug.kind === 'new' ? `Drop net ${sug.no}` : 'Net limit reached'}>
          <Text style={[st.dropT, sug.kind === 'redrop' && { color: colors.live }]}>
            {sug.kind === 'redrop' ? `Re-drop No. ${sug.no}` : sug.kind === 'new' ? `Drop No. ${sug.no}` : `Limit: ${limitFor(set.crew)} nets`}
          </Text>
          <Text style={st.dropS}>{sug.kind === 'redrop' ? 'Same number · goes to the back of the line' : sug.kind === 'new' ? (boat ? 'New net at the boat' : 'Waiting for GPS') : set.crew <= 1 ? 'Solo: 5 nets max' : '10 nets per boat max'}</Text>
        </Pressable>
      </View>
      <Text style={st.label}>PULL ORDER · LONGEST SOAK FIRST</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {order.map((p, i) => {
          const soak = soakState(p, now);
          const c = i === 0 ? C.next : soak === 'due' ? C.due : soak === 'soon' ? C.soon : '#C9A800';
          return (
            <Pressable key={p.no} onPress={() => onPotPress(p)} style={[st.chip, { borderColor: c }, i === 0 && { backgroundColor: c }]} accessibilityRole="button">
              <Text style={[st.chipN, { color: i === 0 ? '#FFFFFF' : c }]}>No.{p.no}</Text>
              <Text style={[st.chipS, i === 0 && { color: '#FFFFFF' }]}>{soakText(now - p.droppedAt)}</Text>
            </Pressable>
          );
        })}
        {up.map((p) => (
          <Pressable key={p.no} onPress={() => onPotPress(p)} style={[st.chip, { borderColor: C.aboard }]} accessibilityRole="button">
            <Text style={[st.chipN, { color: C.aboard }]}>No.{p.no}</Text>
            <Text style={st.chipS}>aboard</Text>
          </Pressable>
        ))}
        {!order.length && !up.length ? <Text style={st.empty}>No nets yet. Drop the first one where you want to start the line.</Text> : null}
      </ScrollView>
      <View style={st.foot}>
        <Pressable onPress={onCrew} style={st.footBtn} accessibilityRole="button"><Ionicons name="people-outline" size={17} color={colors.text} /><Text style={st.footT}>{set.crew <= 1 ? 'Solo · 5 nets' : '2+ aboard · 10 nets'}</Text></Pressable>
        <Pressable onPress={onUndo} disabled={!canUndo} style={[st.footBtn, !canUndo && { opacity: 0.4 }]} accessibilityRole="button"><Ionicons name="arrow-undo" size={17} color={colors.text} /><Text style={st.footT}>Undo</Text></Pressable>
        <Pressable onPress={onEnd} style={[st.footBtn, { borderColor: colors.alert }]} accessibilityRole="button"><Ionicons name="flag-outline" size={17} color={colors.alert} /><Text style={[st.footT, { color: colors.alert }]}>End set</Text></Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minWidth: 54, minHeight: 54 },
  ring: { position: 'absolute', width: 58, height: 58, borderRadius: 29, borderWidth: 5, borderColor: C.next },
  glow: { position: 'absolute', width: 70, height: 70, borderRadius: 35, backgroundColor: C.next },
  pin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  pinNext: { width: 42, height: 42, borderRadius: 21, borderColor: '#FFFFFF', shadowColor: C.next, shadowOpacity: 0.9, shadowRadius: 10 },
  pinT: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  tag: { position: 'absolute', top: 48, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  tagT: { color: '#10263A', fontSize: 11.5, fontWeight: '800' },
});

const useSt = makeStyles((colors) => ({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 10, marginTop: 6, padding: 14, borderRadius: 18, backgroundColor: '#0E2640' },
  kicker: { color: '#AFC8E6', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  next: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', marginTop: 2 },
  sub: { color: '#FF7BE6', fontSize: 16, fontWeight: '800', marginTop: 2 },
  warn: { alignSelf: 'flex-start', marginTop: 8, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  warnT: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  arrowWrap: { width: 64, height: 64, borderRadius: 32, borderWidth: 3, borderColor: '#FF2BD6', alignItems: 'center', justifyContent: 'center' },
  panel: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 14, gap: 10 },
  pull: { backgroundColor: C.ok, borderRadius: 16, minHeight: 72, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  pullFar: { backgroundColor: '#2E7D5A' },
  pullT: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: 0.3 },
  pullS: { color: '#E1FFEC', fontSize: 14, fontWeight: '600', marginTop: 2 },
  row: { flexDirection: 'row', gap: 10 },
  drop: { flex: 1, minHeight: 66, borderRadius: 16, borderWidth: 3, borderColor: C.down, backgroundColor: colors.panelSolid, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  dropT: { color: C.down, fontSize: 21, fontWeight: '900' },
  dropS: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 2 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  chip: { minWidth: 76, minHeight: 58, borderRadius: 14, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, backgroundColor: colors.panelSolid },
  chipN: { fontSize: 18, fontWeight: '900' },
  chipS: { color: colors.muted, fontSize: 12.5, fontWeight: '700' },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: 10 },
  foot: { flexDirection: 'row', gap: 8 },
  footBtn: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', minHeight: touch.min - 4, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border },
  footT: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
}));
