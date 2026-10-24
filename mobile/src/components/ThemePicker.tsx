// Me → Display: pick a day theme and a night theme. Each row shows a tiny preview in that theme's own colors
// (background, a panel, the accent button and the live-reading color) so you can see it before choosing.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DAY_THEMES, NIGHT_THEMES, colors, makeStyles, routeColor, touch, useTheme, type ThemeInfo } from '../theme';
import { track } from '../analytics';

function Swatch({ t }: { t: ThemeInfo }) {
  const p = t.palette;
  return (
    <View style={[sw.box, { backgroundColor: p.bg, borderColor: p.border }]}>
      <View style={[sw.panel, { backgroundColor: p.panelSolid, borderColor: p.border }]}>
        <View style={[sw.textBar, { backgroundColor: p.text }]} />
        <View style={[sw.liveDot, { backgroundColor: p.live }]} />
      </View>
      <View style={sw.bottom}>
        <View style={[sw.pill, { backgroundColor: p.accent }]} />
        <View style={[sw.route, { backgroundColor: routeColor(p, t.mode) }]} />
      </View>
    </View>
  );
}

function Group({ title, list, value, onPick }: { title: string; list: ThemeInfo[]; value: string; onPick: (id: string) => void }) {
  const st = useSt();
  return (
    <View style={st.group}>
      <Text style={st.head}>{title}</Text>
      {list.map((t, i) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onPick(t.id)} style={({ pressed }) => [st.row, i < list.length - 1 && st.rowLine, pressed && { opacity: 0.7 }]}
            accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t.name}: ${t.note}`}>
            <Swatch t={t} />
            <View style={st.txt}>
              <Text style={[st.name, on && st.nameOn]}>{t.name}</Text>
              <Text style={st.note} numberOfLines={1}>{t.note}</Text>
            </View>
            <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={on ? colors.accent : colors.faint} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function ThemePicker() {
  const theme = useTheme();
  return (
    <View>
      <Group title="Day theme" list={DAY_THEMES} value={theme.dayTheme}
        onPick={(id) => { theme.setDayTheme(id); track('theme_picked', { day: id }); }} />
      <Group title="Night theme" list={NIGHT_THEMES} value={theme.nightTheme}
        onPick={(id) => { theme.setNightTheme(id); track('theme_picked', { night: id }); }} />
    </View>
  );
}

const sw = {
  box: { width: 52, height: 40, borderRadius: 8, borderWidth: 1, padding: 4, justifyContent: 'space-between' as const },
  panel: { height: 14, borderRadius: 4, borderWidth: 0.5, flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 3, gap: 3 },
  textBar: { flex: 1, height: 3, borderRadius: 2 },
  liveDot: { width: 5, height: 5, borderRadius: 3 },
  bottom: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  pill: { width: 18, height: 8, borderRadius: 4 },
  route: { flex: 1, height: 3, borderRadius: 2 },
};

const useSt = makeStyles((colors) => ({
  group: { marginTop: 14 },
  head: { color: colors.muted, fontSize: 13, fontWeight: '800', marginBottom: 4 },
  row: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  txt: { flex: 1 },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  nameOn: { color: colors.accent },
  note: { color: colors.muted, fontSize: 12.5, marginTop: 1 },
}));
