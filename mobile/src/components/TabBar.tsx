// Six tabs, always in the same place: Map · Weather · Spots · Crew · Community · Me (Crew added Oct 27).
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, makeStyles } from '../theme';

export type Tab = 'map' | 'weather' | 'spots' | 'crew' | 'community' | 'me';
const TABS: { key: Tab; label: string; icon: string; iconOn: string }[] = [
  { key: 'map', label: 'Map', icon: 'map-outline', iconOn: 'map' },
  { key: 'weather', label: 'Weather', icon: 'partly-sunny-outline', iconOn: 'partly-sunny' },
  { key: 'spots', label: 'Spots', icon: 'location-outline', iconOn: 'location' },
  { key: 'crew', label: 'Crew', icon: 'boat-outline', iconOn: 'boat' },
  { key: 'community', label: 'Community', icon: 'chatbubbles-outline', iconOn: 'chatbubbles' },
  { key: 'me', label: 'Me', icon: 'person-circle-outline', iconOn: 'person-circle' },
];

export function TabBar({ tab, setTab, badges = {}, badgeColors = {} }: { tab: Tab; setTab: (t: Tab) => void; badges?: Partial<Record<Tab, boolean>>; badgeColors?: Partial<Record<Tab, string>> }) {
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
              {badges[t.key] ? <View style={[st.badge, badgeColors[t.key] ? { backgroundColor: badgeColors[t.key], width: 11, height: 11, borderRadius: 6 } : null]} /> : null}
            </View>
            <Text style={[st.label, on && { color: colors.accent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>{t.label}</Text>
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
  label: { color: colors.muted, fontSize: 10.5, fontWeight: '700', paddingHorizontal: 1 },
  badge: { position: 'absolute', right: -3, top: -1, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.alert, borderWidth: 1.5, borderColor: colors.panelSolid },
}));
