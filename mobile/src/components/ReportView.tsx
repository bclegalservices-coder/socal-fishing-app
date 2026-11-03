// One public catch report, and a cluster summary (spec §10, §38).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ageText } from '../api';
import { colors, makeStyles } from '../theme';
import { flagCatch, publicPhotoUrl, reportsIn, summarize, type PublicReport } from '../community/catchApi';
import { foundOnLabel, speciesColor, speciesName } from '../community/species';
import { formatLatLon } from '../geo';
import { agoShort, catchAge } from './CatchMap';
import type { Cluster } from './CatchMap';
import { Btn, Note, Sheet, SmallBtn, Title } from './ui';
import { friendly } from '../friendly';

export function ReportCard({ r, onGo }: { r: PublicReport; onGo?: () => void }) {
  const st = useSt();
  const loc = r.area_name ? `${r.area_name}${r.fuzz_radius_nm ? ' (approx.)' : ''}` : r.fuzz_radius_nm ? `Approximate area (±${r.fuzz_radius_nm} NM)` : 'Exact location shared';
  const flag = () => Alert.alert('Report this catch?', 'Flag reports that look fake or misleading.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Looks fake', onPress: () => flagCatch(r.id, 'fake').then(() => Alert.alert('Thanks — a moderator will look.')).catch((e) => Alert.alert('Not sent', friendly(e))) },
    { text: 'Wrong location', onPress: () => flagCatch(r.id, 'wrong_location').then(() => Alert.alert('Thanks.')).catch((e) => Alert.alert('Not sent', friendly(e))) },
  ]);
  const h = (Date.now() - new Date(r.caught_at).getTime()) / 3600000;
  const age = catchAge(h);
  const when = new Date(r.caught_at);
  const rows: [string, string | null][] = [
    ['When', `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`],
    ['Where', r.fuzz_radius_nm || r.area_name ? loc : `${formatLatLon(r.lat, r.lon)}`],
    ['How many', `${r.quantity}${r.kept === true ? ' · kept' : r.kept === false ? ' · released' : ''}`],
    ['Size', [r.weight_lb ? `${Math.round(r.weight_lb * 10) / 10} lb` : null, r.length_in ? `${Math.round(r.length_in)} in` : null].filter(Boolean).join(' · ') || null],
    ['Found on', foundOnLabel(r.found_on)],
    ['Technique', r.technique],
    ['Bait / lure', r.bait],
    ['Fishing depth', r.fishing_depth_ft ? `${Math.round(r.fishing_depth_ft)} ft` : null],
    ['Water depth', r.water_depth_ft ? `${Math.round(r.water_depth_ft)} ft` : null],
    ['Meter marks', r.meter_marks ?? null],
    ['Notes', r.notes ?? null],
  ];
  return (
    <View style={st.card}>
      <View style={st.row}>
        <View style={[st.badge, { backgroundColor: speciesColor(r.species_code) }]}><Text style={st.badgeT}>{r.species_code}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.h}>{speciesName(r.species_code)}{r.quantity > 1 ? ` × ${r.quantity}` : ''}{r.weight_lb ? ` · ${Math.round(r.weight_lb)} lb` : ''}</Text>
          <Text style={st.sub}>{r.author_name ?? 'Anonymous'}{r.verified ? '  ✓ verified' : ''}</Text>
        </View>
        <View style={[st.age, { backgroundColor: age.color }]}><Text style={[st.ageT, { color: age.ink }]}>{agoShort(h)} ago</Text></View>
      </View>
      <View style={st.table}>
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <View key={k} style={st.tr}><Text style={st.tk}>{k}</Text><Text style={st.tv}>{v}</Text></View>
        ))}
      </View>
      <Text style={st.condH}>Conditions when caught</Text>
      <Text style={st.cond}>
        {[r.sst_f != null ? `Water ${r.sst_f.toFixed(1)}°F (satellite)` : null, r.chl_mg_m3 != null ? `Chl ${r.chl_mg_m3.toFixed(2)} mg/m³` : null,
          r.tide_stage ? `Tide ${r.tide_stage}` : null, r.wind_kt != null ? `Wind ${Math.round(r.wind_kt)} kt` : null].filter(Boolean).join(' · ') || 'No conditions recorded'}
      </Text>
      {r.photo_paths?.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>
          {r.photo_paths.map((p) => <Image key={p} source={{ uri: publicPhotoUrl(p) }} style={st.photo} />)}
        </ScrollView>
      ) : null}
      <View style={st.row}>
        {onGo ? <SmallBtn tone="accent" icon="map-outline" label="Show on map" onPress={onGo} /> : null}
        <SmallBtn icon="flag-outline" label="Report" onPress={flag} />
      </View>
    </View>
  );
}

export function ClusterSheet({ c, hours, onClose }: { c: Cluster; hours: number; onClose: () => void }) {
  const st = useSt();
  const [rs, setRs] = useState<PublicReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const d = Math.max(c.cell, 0.01);
    reportsIn({ minLon: c.lon - d, minLat: c.lat - d, maxLon: c.lon + d, maxLat: c.lat + d }, hours, [c.species_code], 50)
      .then(setRs).catch((e) => setErr(friendly(e)));
  }, [c.lon, c.lat, c.species_code, hours]);
  const s = rs ? summarize(rs) : null;
  return (
    <Sheet maxHeight={600} onClose={onClose}>
      <Title>{c.n === 1 ? `${speciesName(c.species_code)} catch` : `${speciesName(c.species_code)} · ${c.n} catches`}</Title>
      <Note>{c.n} report{c.n === 1 ? '' : 's'} · {c.fish} fish · last {hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`}</Note>
      {err ? <Note>Couldn't load reports ({err}).</Note> : null}
      {!rs && !err ? <ActivityIndicator color={colors.live} /> : null}
      {s ? (
        <View style={st.summary}>
          {s.size ? <Text style={st.line}>Typical size: {s.size}</Text> : null}
          {s.top.length ? <Text style={st.line}>Working: {s.top.join(', ')}</Text> : null}
          {s.sst ? <Text style={st.line}>Water temp at catches: {s.sst}</Text> : null}
          {s.latest ? <Text style={st.line}>Latest report: {ageText(s.latest).replace(' old', ' ago')}</Text> : null}
          <Text style={st.sub}>Community reports — not a guarantee fish are still there.</Text>
        </View>
      ) : null}
      {rs?.map((r) => <ReportCard key={r.id} r={r} />)}
    </Sheet>
  );
}

const useSt = makeStyles((colors) => ({
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.panelSolid },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: colors.accentInk, fontWeight: '800', fontSize: 13 },
  h: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12 },
  line: { color: colors.text, fontSize: 14 },
  cond: { color: colors.muted, fontSize: 12.5 },
  photo: { width: 120, height: 90, borderRadius: 8 },
  link: { paddingVertical: 6, paddingRight: 14 },
  linkT: { color: colors.live, fontSize: 14 },
  summary: { gap: 4, borderLeftWidth: 3, borderColor: colors.accent, paddingLeft: 10 },
  age: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  ageT: { fontSize: 12, fontWeight: '900' },
  table: { gap: 3, marginTop: 2 },
  tr: { flexDirection: 'row', gap: 8 },
  tk: { width: 104, color: colors.muted, fontSize: 13.5, fontWeight: '700' },
  tv: { flex: 1, color: colors.text, fontSize: 14 },
  condH: { color: colors.muted, fontSize: 12, fontWeight: '800', marginTop: 4 },
}));
