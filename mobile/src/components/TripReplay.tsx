// Trip playback on the map: a banner (time into the trip, speed, distance) and a bar with play/pause,
// a scrubber you can drag, and playback speed. The map draws the track colored by speed and the boat moving along it.
import { useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles, touch } from '../theme';
import type { TripMoment } from '../trips';
import { distLabel, distVal, fmtClock, speedLabel, speedVal, useUnits } from '../units';

export const REPLAY_RATES = [10, 60, 300, 1000];
/** A playback speed that plays the whole trip in about 30–60 seconds. */
export function autoRate(durationMs: number): number {
  const want = durationMs / 40000;
  return REPLAY_RATES.reduce((best, r) => (Math.abs(r - want) < Math.abs(best - want) ? r : best), REPLAY_RATES[0]);
}

export function ReplayHud({ name, m, onClose }: { name: string; m: TripMoment; onClose: () => void }) {
  const st = useSt();
  const u = useUnits();
  const spd = speedVal(m.kt, u);
  const dist = distVal(m.distNm, u);
  return (
    <SafeAreaView edges={['top']} style={st.hudWrap} pointerEvents="box-none">
      <View style={st.hud} accessibilityLabel={`${name}: ${fmtClock(m.elapsedMs)} in, ${spd.toFixed(1)} ${speedLabel(u)}, ${dist.toFixed(1)} ${distLabel(u)}`}>
        <View style={st.titleRow}>
          <Text style={st.title} numberOfLines={1}>{name}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={st.close} accessibilityRole="button" accessibilityLabel="Close playback">
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
        </View>
        <View style={st.boxes}>
          <View style={st.box}><Text style={st.mid}>{fmtClock(m.elapsedMs)}</Text><Text style={st.k}>Time</Text></View>
          <View style={st.div} />
          <View style={st.box}><Text style={st.big}>{spd.toFixed(1)}</Text><Text style={st.k}>{speedLabel(u)}</Text></View>
          <View style={st.div} />
          <View style={st.box}><Text style={st.mid}>{dist < 10 ? dist.toFixed(1) : Math.round(dist)}<Text style={st.unit}> {distLabel(u)}</Text></Text><Text style={st.k}>Distance</Text></View>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function ReplayBar({ playing, frac, rate, follow, onToggle, onSeek, onRate, onFollow }: {
  playing: boolean; frac: number; rate: number; follow: boolean;
  onToggle: () => void; onSeek: (frac: number) => void; onRate: (r: number) => void; onFollow: () => void;
}) {
  const st = useSt();
  return (
    <View style={st.bar}>
      <View style={st.barRow}>
        <Pressable onPress={onToggle} style={st.play} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play'}>
          <Ionicons name={playing ? 'pause' : 'play'} size={26} color={colors.accentInk} />
        </Pressable>
        <Scrubber frac={frac} onSeek={onSeek} />
      </View>
      <View style={st.barRow}>
        {REPLAY_RATES.map((r) => (
          <Pressable key={r} onPress={() => onRate(r)} style={[st.rate, r === rate && st.rateOn]} accessibilityRole="button" accessibilityState={{ selected: r === rate }} accessibilityLabel={`${r} times speed`}>
            <Text style={[st.rateT, r === rate && st.rateTOn]}>{r}×</Text>
          </Pressable>
        ))}
        <Pressable onPress={onFollow} style={[st.rate, follow && st.rateOn, { marginLeft: 'auto' }]} accessibilityRole="button" accessibilityState={{ selected: follow }} accessibilityLabel="Follow the boat">
          <Ionicons name="locate" size={16} color={follow ? colors.accentInk : colors.text} />
          <Text style={[st.rateT, follow && st.rateTOn]}>Follow</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Drag or tap anywhere on the track to jump in the trip. */
function Scrubber({ frac, onSeek }: { frac: number; onSeek: (f: number) => void }) {
  const st = useSt();
  const [w, setW] = useState(1);
  const wRef = useRef(1); wRef.current = w;
  const seek = useRef(onSeek); seek.current = onSeek;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => seek.current(Math.min(1, Math.max(0, e.nativeEvent.locationX / wRef.current))),
    onPanResponderMove: (e) => seek.current(Math.min(1, Math.max(0, e.nativeEvent.locationX / wRef.current))),
  })).current;
  const pct = `${Math.min(100, Math.max(0, frac * 100))}%` as `${number}%`;
  return (
    <View style={st.scrub} onLayout={(e) => setW(Math.max(1, e.nativeEvent.layout.width))} {...pan.panHandlers}
      accessibilityRole="adjustable" accessibilityLabel="Trip position" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
      <View pointerEvents="none" style={st.rail}><View style={[st.railOn, { width: pct }]} /></View>
      <View pointerEvents="none" style={[st.knob, { left: pct }]} />
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  hudWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 },
  hud: { margin: 10, borderRadius: 16, overflow: 'hidden', backgroundColor: '#123E6E' },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, paddingTop: 6 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  boxes: { flexDirection: 'row', alignItems: 'stretch', paddingBottom: 10 },
  box: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  div: { width: 1, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: 4 },
  big: { color: '#FFFFFF', fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  mid: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 14, fontWeight: '700' },
  k: { color: '#C9DCEE', fontSize: 12, fontWeight: '700' },
  bar: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 12, gap: 10 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  play: { width: touch.min, height: touch.min, borderRadius: touch.min / 2, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  scrub: { flex: 1, height: touch.min, justifyContent: 'center' },
  rail: { height: 8, borderRadius: 4, backgroundColor: colors.inset, overflow: 'hidden' },
  railOn: { height: 8, backgroundColor: colors.accent },
  knob: { position: 'absolute', width: 28, height: 28, borderRadius: 14, marginLeft: -14, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: colors.accent,
    shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  rate: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  rateOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  rateT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  rateTOn: { color: colors.accentInk },
}));
