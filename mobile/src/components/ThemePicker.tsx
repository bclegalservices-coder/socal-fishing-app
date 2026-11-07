// Me → Appearance: a page of its own (like iPhone Settings), reached from one row near the bottom of Me.
//   • Mode: Auto / Day / Night
//   • Day theme and Night theme: grouped lists, each row with a small preview in that theme's own colors
//     (background, a panel, the button color and the route line), the name, one line about it, and a checkmark.
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DAY_THEMES, NIGHT_THEMES, boatColor, colors, findTheme, makeStyles, routeColor, useTheme, type ThemeInfo, type ThemeSetting } from '../theme';
import { Card, Note, ScreenHeader, SectionLabel, Segmented } from './ui';
import { track } from '../analytics';

/** One line for the Appearance row on the Me page, e.g. "Auto · Harbor Blue / Red Light". */
export function appearanceSummary(setting: ThemeSetting, dayTheme: string, nightTheme: string): string {
  const mode = setting === 'auto' ? 'Auto' : setting === 'day' ? 'Day' : 'Night';
  return `${mode} · ${findTheme(DAY_THEMES, dayTheme).name} / ${findTheme(NIGHT_THEMES, nightTheme).name}`;
}

/** Nov 6: a little map in the theme's own colors — water, land with its coastline, a depth line, the info panel,
 *  your boat and the + button — so you can see the look before picking it. */
function MapPreview({ t }: { t: ThemeInfo }) {
  const p = t.palette;
  const night = t.mode === 'night';
  const land = p.land ?? '#F3E6C3';
  const coast = p.coast ?? '#8C7B55';
  const water = p.water;
  return (
    <View style={[pv.box, { backgroundColor: water }]}>
      <View style={[pv.mainland, { backgroundColor: land, borderColor: coast }]} />
      <View style={[pv.island, { backgroundColor: land, borderColor: coast }]} />
      <View style={[pv.depth, { borderColor: night ? coast : '#7FA9CC' }]} />
      <View style={[pv.panel, { backgroundColor: p.panelSolid, borderColor: p.border }]}>
        <View style={[pv.bar, { backgroundColor: p.muted, width: 16 }]} />
        <View style={[pv.bar, { backgroundColor: p.text, width: 22, height: 4 }]} />
        <View style={[pv.bar, { backgroundColor: p.live, width: 12, height: 4 }]} />
      </View>
      <View style={[pv.boat, { backgroundColor: boatColor(p, t.mode) }]} />
      <View style={[pv.route, { backgroundColor: routeColor(p, t.mode) }]} />
      <View style={[pv.fab, { backgroundColor: p.accent }]}><Text style={{ color: p.accentInk, fontSize: 13, fontWeight: '800', lineHeight: 15 }}>+</Text></View>
      {p.wash ? <View pointerEvents="none" style={[pv.fill, { backgroundColor: p.wash }]} /> : null}
    </View>
  );
}

function ThemeGrid({ list, value, onPick }: { list: ThemeInfo[]; value: string; onPick: (id: string) => void }) {
  const st = useSt();
  const rows: ThemeInfo[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: 10 }}>
          {row.map((t) => {
            const on = t.id === value;
            return (
              <Pressable key={t.id} onPress={() => onPick(t.id)} style={({ pressed }) => [st.card, on && st.cardOn, pressed && { opacity: 0.7 }]}
                accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t.name}: ${t.note}`}>
                <MapPreview t={t} />
                <View style={st.cardTxt}>
                  <View style={{ flex: 1 }}>
                    <Text style={st.name} numberOfLines={1}>{t.name}</Text>
                    <Text style={st.note} numberOfLines={2}>{t.note}</Text>
                  </View>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? colors.accent : colors.faint} />
                </View>
              </Pressable>
            );
          })}
          {row.length < 2 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
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
        <ThemeGrid list={DAY_THEMES} value={theme.dayTheme} onPick={(id) => { theme.setDayTheme(id); track('theme_picked', { day: id }); }} />

        <SectionLabel>Night theme</SectionLabel>
        <ThemeGrid list={NIGHT_THEMES} value={theme.nightTheme} onPick={(id) => { theme.setNightTheme(id); track('theme_picked', { night: id }); }} />
        <Note>Night Navy is a normal dark mode. Red Light and Amber keep everything dim and warm to protect your night vision at the helm. Dusk is a softer dark blue for evenings and at the dock. The chart is dimmed at night in every theme.</Note>
      </ScrollView>
    </View>
  );
}

const pv = {
  box: { height: 92, borderRadius: 10, overflow: 'hidden' as const },
  fill: { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 },
  mainland: { position: 'absolute' as const, right: -30, top: -40, width: 120, height: 92, borderRadius: 46, borderWidth: 1.5, transform: [{ rotate: '-18deg' }] },
  island: { position: 'absolute' as const, left: 14, bottom: 10, width: 44, height: 16, borderRadius: 10, borderWidth: 1.2, transform: [{ rotate: '12deg' }] },
  depth: { position: 'absolute' as const, left: -20, top: 52, width: 150, height: 60, borderRadius: 60, borderWidth: 1, borderStyle: 'dashed' as const },
  panel: { position: 'absolute' as const, left: 6, top: 6, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: 6, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
  bar: { height: 3, borderRadius: 2 },
  boat: { position: 'absolute' as const, left: 74, top: 50, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: '#FFFFFF' },
  route: { position: 'absolute' as const, left: 83, top: 54, width: 34, height: 2, borderRadius: 1, transform: [{ rotate: '-20deg' }] },
  fab: { position: 'absolute' as const, right: 6, bottom: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
};

const useSt = makeStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  card: { flex: 1, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid, padding: 6, gap: 6 },
  cardOn: { borderColor: colors.accent, borderWidth: 2.5, padding: 5 },
  cardTxt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4, paddingBottom: 4 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  note: { color: colors.muted, fontSize: 12, marginTop: 1 },
}));
