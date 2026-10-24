// Time window + species filter for the Catch Map (spec §11).
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, makeStyles } from '../theme';
import { SPECIES, TIME_WINDOWS } from '../community/species';
import { PresentedBy } from '../ads/Sponsor';

export function CatchBar({ hours, setHours, species, setSpecies, status }: { hours: number; setHours: (h: number) => void; species: string | null; setSpecies: (s: string | null) => void; status: string }) {
  const st = useSt();
  return (
    <View style={st.wrap}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={st.status}>{status}</Text>
        <PresentedBy section="Catch Map" tags={species ? [species.toLowerCase()] : []} />
      </View>
      <View style={st.row}>
        {TIME_WINDOWS.map((w) => (
          <Pressable key={w.h} onPress={() => setHours(w.h)} style={[st.chip, hours === w.h && st.on]}>
            <Text style={[st.t, hours === w.h && { color: colors.accentInk }]}>{w.label}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        <Pressable onPress={() => setSpecies(null)} style={[st.chip, !species && st.on]}><Text style={[st.t, !species && { color: colors.accentInk }]}>All fish</Text></Pressable>
        {SPECIES.slice(0, 12).map((s) => (
          <Pressable key={s.code} onPress={() => setSpecies(species === s.code ? null : s.code)} style={[st.chip, { flexDirection: 'row', gap: 5 }, species === s.code && st.on]}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color, borderWidth: 1, borderColor: '#FFFFFF' }} />
            <Text style={[st.t, species === s.code && { color: colors.accentInk }]}>{s.code}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  wrap: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  status: { color: colors.text, fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 6 },
  chip: { minWidth: 44, minHeight: 40, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', flexGrow: 1 },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  t: { color: colors.text, fontSize: 14, fontWeight: '700' },
}));
