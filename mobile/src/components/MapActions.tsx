// The one "+" button on the map opens this: every action in one tidy grid instead of a column of buttons.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles } from '../theme';
import { Sheet } from './ui';

export type MapAction = { key: string; label: string; sub?: string; icon: string; tint?: string; onPress: () => void; hidden?: boolean; active?: boolean };

export function MapActions({ actions, onClose }: { actions: MapAction[]; onClose: () => void }) {
  const st = useSt();
  const shown = actions.filter((a) => !a.hidden);
  return (
    <Sheet maxHeight={560}>
      <View style={st.head}>
        <Text style={st.title}>Tools</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close-circle" size={28} color={colors.faint} /></Pressable>
      </View>
      <View style={st.grid}>
        {shown.map((a) => (
          <Pressable key={a.key} onPress={() => { onClose(); a.onPress(); }} style={({ pressed }) => [st.tile, a.active && st.tileOn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button" accessibilityLabel={a.label}>
            <View style={[st.icon, { backgroundColor: (a.tint ?? colors.live) + '1F' }]}><Ionicons name={a.icon as any} size={24} color={a.tint ?? colors.live} /></View>
            <Text style={st.label} numberOfLines={1}>{a.label}</Text>
            {a.sub ? <Text style={st.sub} numberOfLines={2}>{a.sub}</Text> : null}
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

const useSt = makeStyles((colors) => ({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, minHeight: 92, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid, padding: 12, gap: 6 },
  tileOn: { borderColor: colors.alert, backgroundColor: colors.alertBg },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 16 },
}));
