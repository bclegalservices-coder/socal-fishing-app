// Five tabs, always in the same place: Map · Weather · Spots · Community · Me.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, makeStyles } from '../theme';

export type Tab = 'map' | 'weather' | 'spots' | 'community' | 'me';
const TABS: { key: Tab; label: string; icon: string; iconOn: string }[] = [
  { key: 'map', label: 'Map', icon: 'map-outline', iconOn: 'map' },
  { key: 'weather', label: 'Weather', icon: 'partly-sunny-outline', iconOn: 'partly-sunny' },
  { key: 'spots', label: 'Spots', icon: 'location-outline', iconOn: 'location' },
  { key: 'community', label: 'Community', icon: 'people-outline', iconOn: 'people' },
  { key: 'me', label: 'Me', icon: 'person-circle-outline', iconOn: 'person-circle' },
];

export function TabBar({ tab, setTab, badges = {} }: { tab: Tab; setTab: (t: Tab) => void; badges?: Partial<Record<Tab, boolean>> }) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, 6) }]} accessibilityRole="tablist">
      {TABS.map((t) => {
        const on = tab === t.key;
        return (
          <Pressable key={t.key} style={st.item} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: on }}>
            <View style={[st.indicator, on && { backgroundColor: colors.accent }]} />
            <View>
              <Ionicons name={(on ? t.iconOn : t.icon) as any} size={24} color={on ? colors.accent : colors.muted} />
              {badges[t.key] ? <View style={st.badge} /> : null}
            </View>
            <Text style={[st.label, on && { color: colors.accent }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  bar: { flexDirection: 'row', backgroundColor: colors.panelSolid, borderTopWidth: 1, borderColor: colors.border },
  item: { flex: 1, alignItems: 'center', gap: 2, minHeight: 54, justifyContent: 'flex-start', paddingTop: 0 },
  indicator: { width: 28, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: 'transparent', marginBottom: 5 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  badge: { position: 'absolute', right: -3, top: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.alert, borderWidth: 1.5, borderColor: colors.panelSolid },
}));
