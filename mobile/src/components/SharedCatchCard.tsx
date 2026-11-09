// Nov 8: tap a catch someone in your group shared → every detail they logged pops up (species, how many, size, bait,
// technique, depths, when, exact spot), with Go to and Save spot.
import { Text, View } from 'react-native';
import { makeStyles } from '../theme';
import { formatLatLon } from '../geo';
import { speciesColor, speciesName } from '../community/species';
import type { Pin } from '../community/groupsApi';
import { agoShort, catchAge } from './CatchMap';
import { Sheet, SmallBtn } from './ui';

export function SharedCatchCard({ p, onGo, onSave, onClose }: { p: Pin; onGo: () => void; onSave?: () => void; onClose: () => void }) {
  const st = useSt();
  const d = p.payload ?? {};
  const caught = d.caught_at ? new Date(d.caught_at) : new Date(p.created_at);
  const h = (Date.now() - caught.getTime()) / 3600000;
  const age = catchAge(h);
  const code: string | undefined = d.species_code;
  const name = d.species ?? (code ? speciesName(code) : 'Catch');
  const qty = Number(d.quantity ?? 1);
  const rows: [string, string | null][] = [
    ['When', `${caught.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${caught.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`],
    ['Where', formatLatLon(p.lat, p.lon)],
    ['How many', `${qty}${d.kept === true ? ' · kept' : d.kept === false ? ' · released' : ''}`],
    ['Size', [d.weight_lb ? `${Math.round(Number(d.weight_lb) * 10) / 10} lb` : null, d.length_in ? `${Math.round(Number(d.length_in))} in` : null].filter(Boolean).join(' · ') || null],
    ['Technique', d.technique ?? null],
    ['Bait / lure', d.bait ?? null],
    ['Fishing depth', d.fishing_depth_ft ? `${Math.round(Number(d.fishing_depth_ft))} ft` : null],
    ['Water depth', d.water_depth_ft ? `${Math.round(Number(d.water_depth_ft))} ft` : null],
    ['Note', p.body ?? null],
  ];
  return (
    <Sheet onClose={onClose}>
      <View style={st.row}>
        <View style={[st.badge, { backgroundColor: code ? speciesColor(code) : age.color }]}><Text style={st.badgeT}>{code ?? '🐟'}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.h}>{name}{qty > 1 ? ` × ${qty}` : ''}{d.weight_lb ? ` · ${Math.round(Number(d.weight_lb))} lb` : ''}</Text>
          <Text style={st.sub}>{p.mine ? 'You' : p.who} · shared with {p.group_name}</Text>
        </View>
        <View style={[st.age, { backgroundColor: age.color }]}><Text style={[st.ageT, { color: age.ink }]}>{agoShort(h)} ago</Text></View>
      </View>
      <View style={st.table}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <View key={k} style={st.tr}><Text style={st.tk}>{k}</Text><Text style={st.tv}>{v}</Text></View>
        ))}
      </View>
      <Text style={st.sub}>Exact spot · only your group can see it.</Text>
      <View style={[st.row, { flexWrap: 'wrap' }]}>
        <SmallBtn tone="accent" icon="navigate" label="Go to" onPress={onGo} />
        {onSave ? <SmallBtn icon="bookmark-outline" label="Save spot" onPress={onSave} /> : null}
      </View>
    </Sheet>
  );
}

const useSt = makeStyles((colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: colors.accentInk, fontWeight: '800', fontSize: 13 },
  h: { color: colors.text, fontSize: 17, fontWeight: '800', paddingRight: 40 },
  sub: { color: colors.muted, fontSize: 12.5 },
  age: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  ageT: { fontSize: 12, fontWeight: '900' },
  table: { gap: 4, marginVertical: 4 },
  tr: { flexDirection: 'row', gap: 8 },
  tk: { width: 104, color: colors.muted, fontSize: 13.5, fontWeight: '700' },
  tv: { flex: 1, color: colors.text, fontSize: 14 },
}));
