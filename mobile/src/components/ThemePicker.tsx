// Me → Appearance: a page of its own (like iPhone Settings), reached from one row near the bottom of Me.
//   • Mode: Auto / Day / Night
//   • Day theme and Night theme: grouped lists, each row with a small preview in that theme's own colors
//     (background, a panel, the button color and the route line), the name, one line about it, and a checkmark.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DAY_THEMES, NIGHT_THEMES, colors, findTheme, makeStyles, routeColor, touch, useTheme, type ThemeInfo, type ThemeSetting } from '../theme';
import { Card, ListGroup, Note, ScreenHeader, SectionLabel, Segmented } from './ui';
import { track } from '../analytics';

/** One line for the Appearance row on the Me page, e.g. "Auto · Harbor Blue / Red Light". */
export function appearanceSummary(setting: ThemeSetting, dayTheme: string, nightTheme: string): string {
  const mode = setting === 'auto' ? 'Auto' : setting === 'day' ? 'Day' : 'Night';
  return `${mode} · ${findTheme(DAY_THEMES, dayTheme).name} / ${findTheme(NIGHT_THEMES, nightTheme).name}`;
}

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

function ThemeList({ list, value, onPick }: { list: ThemeInfo[]; value: string; onPick: (id: string) => void }) {
  const st = useSt();
  return (
    <ListGroup>
      {list.map((t, i) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onPick(t.id)} style={({ pressed }) => pressed && { opacity: 0.6 }}
            accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t.name}: ${t.note}`}>
            <View style={[st.row, i < list.length - 1 && st.rowLine]}>
              <Swatch t={t} />
              <View style={st.txt}>
                <Text style={st.name}>{t.name}</Text>
                <Text style={st.note} numberOfLines={1}>{t.note}</Text>
              </View>
              {on ? <Ionicons name="checkmark" size={22} color={colors.accent} /> : <View style={st.checkSpace} />}
            </View>
          </Pressable>
        );
      })}
    </ListGroup>
  );
}

export function AppearanceScreen({ onBack }: { onBack: () => void }) {
  const st = useSt();
  const theme = useTheme();
  const modeNote = theme.setting === 'auto'
    ? `Switches to your night theme 20 minutes after sunset and back before sunrise. Now: ${theme.mode === 'night' ? 'Night' : 'Day'}.`
    : theme.setting === 'night' ? 'Always uses your night theme.' : 'Always uses your day theme.';
  return (
    <View style={st.page}>
      <ScreenHeader title="Appearance" onBack={onBack} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body}>
        <SectionLabel>Mode</SectionLabel>
        <Card>
          <Segmented<ThemeSetting> value={theme.setting} onChange={(v) => { theme.setSetting(v); track('theme_changed', { setting: v }); }}
            options={[{ key: 'auto', label: 'Auto', icon: 'contrast-outline' }, { key: 'day', label: 'Day', icon: 'sunny-outline' }, { key: 'night', label: 'Night', icon: 'moon-outline' }]} />
          <Note>{modeNote} The sun/moon button on the map switches instantly.</Note>
        </Card>

        <SectionLabel>Day theme</SectionLabel>
        <ThemeList list={DAY_THEMES} value={theme.dayTheme} onPick={(id) => { theme.setDayTheme(id); track('theme_picked', { day: id }); }} />

        <SectionLabel>Night theme</SectionLabel>
        <ThemeList list={NIGHT_THEMES} value={theme.nightTheme} onPick={(id) => { theme.setNightTheme(id); track('theme_picked', { night: id }); }} />
        <Note>Red Light and Amber keep the screen dim and warm to protect your night vision at the helm. Your route, boat and safety colors stay easy to spot in every theme.</Note>
      </ScrollView>
    </View>
  );
}

const sw = {
  box: { width: 46, height: 34, borderRadius: 8, borderWidth: 1, padding: 4, justifyContent: 'space-between' as const },
  panel: { height: 11, borderRadius: 3, borderWidth: 0.5, flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 3, gap: 3 },
  textBar: { flex: 1, height: 2.5, borderRadius: 2 },
  liveDot: { width: 4, height: 4, borderRadius: 2 },
  bottom: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  pill: { width: 14, height: 7, borderRadius: 4 },
  route: { flex: 1, height: 2.5, borderRadius: 2 },
};

const useSt = makeStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min, paddingHorizontal: 14, paddingVertical: 10 },
  rowLine: { borderBottomWidth: 1, borderColor: colors.line },
  txt: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  note: { color: colors.muted, fontSize: 13, marginTop: 1 },
  checkSpace: { width: 22 },
}));
