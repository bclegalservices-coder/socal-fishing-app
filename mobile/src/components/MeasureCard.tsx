// Measure tool card: tap the map to drop points; shows each leg's distance and bearing and the total.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cardinal } from '../geo';
import { deg3, legs, totalNm, type MPt } from '../measure';
import { colors, makeStyles, touch } from '../theme';
import { fmtDist, useUnits } from '../units';

export function MeasureCard({ pts, canUseBoat, onFromBoat, onUndo, onClear, onDone }: {
  pts: MPt[]; canUseBoat: boolean; onFromBoat: () => void; onUndo: () => void; onClear: () => void; onDone: () => void;
}) {
  const st = useSt();
  const u = useUnits();
  const ls = legs(pts);
  const last = ls[ls.length - 1];
  return (
    <View style={st.card}>
      <View style={st.head}>
        <Ionicons name="resize" size={20} color={colors.accent} />
        <Text style={st.title}>Measure</Text>
        <Pressable onPress={onDone} style={st.done} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done measuring"><Text style={st.doneT}>Done</Text></Pressable>
      </View>
      {pts.length < 2 ? (
        <Text style={st.hint}>{pts.length ? 'Now tap where you want to measure to.' : 'Tap the map to drop the first point, or start from your boat.'}</Text>
      ) : (
        <View style={st.nums}>
          <View style={{ flex: 1 }}><Text style={st.k}>{ls.length > 1 ? 'Total' : 'Distance'}</Text><Text style={st.big}>{fmtDist(totalNm(pts), u)}</Text></View>
          <View style={st.vline} />
          <View style={{ flex: 1 }}><Text style={st.k}>{ls.length > 1 ? 'Last leg bearing' : 'Bearing'}</Text><Text style={st.big}>{deg3(last.brg)}<Text style={st.small}> {cardinal(last.brg)}</Text></Text></View>
        </View>
      )}
      {ls.length > 1 ? <Text style={st.hint}>{ls.length} legs. Each leg's distance and bearing is on the map. Tap to add more points.</Text> : null}
      {pts.length >= 2 ? <Text style={st.hint}>To move a point: press and hold it, then drag it. The line stretches, shrinks or swings with it.</Text> : null}
      <View style={st.row}>
        {canUseBoat && !pts.length ? <Btn icon="navigate" label="From my boat" onPress={onFromBoat} /> : null}
        {pts.length ? <Btn icon="arrow-undo" label="Undo" onPress={onUndo} /> : null}
        {pts.length ? <Btn icon="trash-outline" label="Clear" onPress={onClear} /> : null}
      </View>
    </View>
  );
}

function Btn({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.btn, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon as any} size={17} color={colors.text} /><Text style={st.btnT}>{label}</Text>
    </Pressable>
  );
}

const useSt = makeStyles((colors) => ({
  card: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '800' },
  done: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center' },
  doneT: { color: colors.accentInk, fontWeight: '800', fontSize: 15 },
  hint: { color: colors.muted, fontSize: 14 },
  nums: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: colors.line },
  k: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  big: { color: colors.text, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  small: { fontSize: 16, fontWeight: '700', color: colors.muted },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: touch.min - 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  btnT: { color: colors.text, fontWeight: '700', fontSize: 15 },
}));
