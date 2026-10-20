import { StyleSheet, Text, View } from 'react-native';
import { colors, makeStyles } from '../theme';
import type { Legend as L } from '../types';

export function Legend({ legend, title }: { legend: L; title: string }) {
  const s = useS();
  return (
    <View style={s.wrap} accessibilityLabel={`${title} legend`}>
      <Text style={s.title}>{title}</Text>
      <View style={s.bar}>{legend.stops.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}</View>
      <View style={s.ticks}>
        {[legend.ticks[0], legend.ticks[Math.floor(legend.ticks.length / 2)], legend.ticks[legend.ticks.length - 1]].map((t, i) => (
          <Text key={i} style={s.tick}>{t}{i === 2 ? ` ${legend.unit}` : ''}</Text>
        ))}
      </View>
    </View>
  );
}

const useS = makeStyles((colors) => ({
  wrap: { gap: 2 },
  title: { color: colors.muted, fontSize: 11 },
  bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
}));
