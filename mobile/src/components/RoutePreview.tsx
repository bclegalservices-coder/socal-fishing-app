// Shown after "Go to": the auto route (drawn on the map), its length vs the straight line, any warnings, the
// safety depth, and Start. If it can't be made (no signal, no water path), offers the straight line instead.
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles } from '../theme';
import { SAFETY_CHOICES, type AutoRoute } from '../autoRoute';
import { formatNm } from '../geo';

type Props = {
  name: string; status: 'loading' | 'ready' | 'failed'; route?: AutoRoute | null; error?: string | null; safetyFt: number;
  onSafety: (ft: number) => void; onStart: () => void; onStraight: () => void; onRetry: () => void; onCancel: () => void;
};

export function RoutePreview({ name, status, route, error, safetyFt, onSafety, onStart, onStraight, onRetry, onCancel }: Props) {
  const s = useS();
  return (
    <View style={s.sheet}>
      <View style={s.head}>
        <Ionicons name="git-network" size={18} color={colors.accent} />
        <Text style={s.title} numberOfLines={1}>{name}</Text>
        <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel"><Ionicons name="close-circle" size={26} color={colors.muted} /></Pressable>
      </View>

      {status === 'loading' ? (
        <View style={s.loading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={s.loadingT}>Finding a water route around land, breakwaters and docks…</Text>
        </View>
      ) : null}

      {status === 'ready' && route ? (
        <>
          <View style={s.stats}>
            <View style={s.stat}><Text style={s.statV}>{formatNm(route.distance_nm)}<Text style={s.statU}> NM</Text></Text><Text style={s.statK}>auto route</Text></View>
            <View style={s.stat}><Text style={s.statV}>{route.turns}</Text><Text style={s.statK}>{route.turns === 1 ? 'turn' : 'turns'}</Text></View>
            <View style={s.stat}><Text style={[s.statV, { color: colors.muted }]}>{formatNm(route.straight_nm)}<Text style={s.statU}> NM</Text></Text><Text style={s.statK}>straight line</Text></View>
          </View>
          {route.warnings.map((w, i) => (
            <View key={i} style={s.warn}><Ionicons name="warning" size={16} color={colors.warn} /><Text style={s.warnT}>{w.text}</Text></View>
          ))}
        </>
      ) : null}

      {status === 'failed' ? (
        <View style={s.warn}><Ionicons name="cloud-offline" size={16} color={colors.warn} /><Text style={s.warnT}>{error ?? 'No auto route right now.'} You can use a straight line instead — check the chart for land and shallows.</Text></View>
      ) : null}

      {/* Safety depth */}
      <Text style={s.label}>Stay in water deeper than</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {SAFETY_CHOICES.map((ft) => {
          const on = ft === safetyFt;
          return (
            <Pressable key={ft} onPress={() => onSafety(ft)} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[s.chipT, on && s.chipTOn]}>{ft} ft</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={s.btns}>
        {status === 'ready' ? (
          <Pressable onPress={onStart} style={[s.btn, s.start]} accessibilityRole="button" accessibilityLabel="Start navigation">
            <Ionicons name="navigate" size={18} color={colors.accentInk} /><Text style={s.startT}>Start</Text>
          </Pressable>
        ) : status === 'failed' ? (
          <Pressable onPress={onRetry} style={[s.btn, s.retry]} accessibilityRole="button"><Text style={s.retryT}>Try again</Text></Pressable>
        ) : null}
        <Pressable onPress={onStraight} style={[s.btn, s.plain]} accessibilityRole="button" accessibilityLabel="Use a straight line">
          <Text style={s.plainT}>Straight line</Text>
        </Pressable>
      </View>
      <Text style={s.note}>{route?.note ?? 'Auto route from NOAA charts — check it against the chart and keep a lookout.'}</Text>
    </View>
  );
}

const useS = makeStyles((colors) => ({
  sheet: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 26, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: -2 }, elevation: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  loadingT: { flex: 1, color: colors.muted, fontSize: 14.5 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: colors.inset, borderRadius: 12, paddingVertical: 8, alignItems: 'center' },
  statV: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statU: { fontSize: 13, color: colors.muted, fontWeight: '700' },
  statK: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  warn: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.warnBg, borderRadius: 10, padding: 10 },
  warnT: { flex: 1, color: colors.text, fontSize: 13.5 },
  label: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  chips: { gap: 6 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.inset, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  chipTOn: { color: colors.accentInk },
  btns: { flexDirection: 'row', gap: 10, marginTop: 2 },
  btn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  start: { backgroundColor: colors.accent },
  startT: { color: colors.accentInk, fontSize: 17, fontWeight: '800' },
  retry: { backgroundColor: colors.accent },
  retryT: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
  plain: { backgroundColor: colors.inset },
  plainT: { color: colors.text, fontSize: 16, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 11.5, lineHeight: 15 },
}));
