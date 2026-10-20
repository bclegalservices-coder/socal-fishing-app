// Compass + map orientation in one compact control: tap cycles North up → Heading up → Course up.
import { Pressable, Text, View } from 'react-native';
import { makeStyles, touch } from '../theme';

export type Orientation = 'north' | 'heading' | 'course';
const LABEL: Record<Orientation, string> = { north: 'North up', heading: 'Heading up', course: 'Course up' };
const SHORT: Record<Orientation, string> = { north: 'N UP', heading: 'HDG', course: 'COG' };

export function Compass({ heading, mode, onPress }: { heading: number | null; mode: Orientation; onPress: () => void }) {
  const s = useS();
  const rot = heading != null ? -heading : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${LABEL[mode]}, heading ${heading != null ? Math.round(heading) : 'unknown'} degrees. Tap to change map orientation.`} style={s.wrap}>
      <View style={[s.rose, { transform: [{ rotate: `${rot}deg` }] }]}>
        <Text style={s.n}>N</Text>
        <View style={s.needleN} />
        <View style={s.needleS} />
      </View>
      <Text style={s.mode}>{SHORT[mode]}</Text>
    </Pressable>
  );
}

const useS = makeStyles((colors) => ({
  wrap: { width: 48, minHeight: touch.min + 6, paddingVertical: 5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  rose: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  n: { position: 'absolute', top: -2, color: colors.alert, fontSize: 8, fontWeight: '900' },
  needleN: { position: 'absolute', top: 6, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderBottomWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.alert },
  needleS: { position: 'absolute', bottom: 6, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.muted },
  mode: { color: colors.text, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3 },
}));
