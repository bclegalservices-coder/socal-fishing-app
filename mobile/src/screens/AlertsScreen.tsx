// Opt-in alerts (plan: 'Alerts'): species, bite activity, water temperature, marine warnings.
// At most 4 per day; each alert at most every 3 hours.
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { colors, makeStyles } from '../theme';
import { SPECIES } from '../community/species';
import { supabase } from '../supabase';
import { Btn } from '../components/ui';
import { track } from '../analytics';
import { friendly } from '../friendly';

const AREAS = [
  { label: 'Catalina', center: [-118.42, 33.38] }, { label: 'San Clemente Island', center: [-118.5, 32.9] },
  { label: 'San Pedro Channel', center: [-118.15, 33.55] }, { label: 'Santa Monica Bay', center: [-118.6, 33.9] },
  { label: 'Orange County coast', center: [-117.85, 33.5] }, { label: 'Offshore San Diego', center: [-117.45, 32.7] },
  { label: 'Coronado Islands', center: [-117.25, 32.42] },
];
const KINDS = [
  { key: 'species', title: 'Catch alert', sub: 'New public reports of a species in an area' },
  { key: 'activity', title: 'Bite alert', sub: 'Reports jumped in the last 6 hours' },
  { key: 'sst', title: 'Water temp alert', sub: 'Your temperature range shows up in an area (once a day)' },
  { key: 'weather', title: 'Marine warning', sub: 'New NWS warning or advisory for an area' },
] as const;

export async function registerPush(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return null;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('alerts', { name: 'Fishing alerts', importance: Notifications.AndroidImportance.DEFAULT });
  const projectId = (Constants as any).expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  const { data } = await supabase.auth.getSession();
  if (data.session) await supabase.from('push_tokens').upsert({ token, user_id: data.session.user.id, platform: Platform.OS, updated_at: new Date().toISOString() });
  return token;
}

export function AlertsScreen({ onBack }: { onBack: () => void }) {
  const st = useSt();
  const [subs, setSubs] = useState<any[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('species');
  const [area, setArea] = useState(AREAS[0]);
  const [radius, setRadius] = useState(15);
  const [species, setSpecies] = useState<string[]>(['BFT']);
  const [verified, setVerified] = useState(true);
  const [minF, setMinF] = useState('66');
  const [maxF, setMaxF] = useState('72');
  const [pushOk, setPushOk] = useState<boolean | null>(null);
  const load = async () => { const { data } = await supabase.from('alert_subscriptions').select('*').order('created_at'); setSubs(data ?? []); };
  useEffect(() => { load(); registerPush().then((t) => setPushOk(!!t)).catch(() => setPushOk(false)); }, []);

  const add = async () => {
    const params: any = { center: area.center, radius_nm: radius, label: area.label };
    if (kind === 'species' || kind === 'activity') params.species = species;
    if (kind === 'species') params.verified_only = verified;
    if (kind === 'sst') { params.min_f = Number(minF); params.max_f = Number(maxF); }
    const { error } = await supabase.from('alert_subscriptions').insert({ kind, params });
    if (error) Alert.alert('Not added', friendly(error)); else { track('alert_created', { kind, species: (params.species ?? [])[0] ?? 'any' }); load(); }
  };
  const describe = (s: any) => {
    const p = s.params ?? {};
    const sp = (p.species ?? []).join(', ');
    return { species: `${p.verified_only ? 'Verified ' : ''}${sp || 'any fish'} reports`, activity: `${sp || 'Any'} bite picking up`,
      sst: `Water ${p.min_f}–${p.max_f}°F`, weather: 'Marine warnings' }[s.kind as string] + ` · ${p.label} (${p.radius_nm} NM)`;
  };

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Pressable onPress={onBack} style={{ paddingVertical: 10 }}><Text style={st.link}>‹ Profile</Text></Pressable>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        <Text style={st.h1}>Alerts</Text>
        <Text style={st.sub}>Off until you add one. At most 4 alerts a day, and each one at most every 3 hours.</Text>
        {pushOk === false ? <Text style={[st.sub, { color: colors.accent }]}>Notifications are off for this app. Turn them on in your phone's Settings to receive alerts.</Text> : null}
        {subs.map((s) => (
          <View key={s.id} style={st.card}>
            <Text style={st.p}>{describe(s)}</Text>
            <View style={st.rowB}>
              <Text style={st.sub}>{s.last_sent_at ? `Last sent ${new Date(s.last_sent_at).toLocaleString()}` : 'Not sent yet'}</Text>
              <Switch value={s.active} onValueChange={async (v) => { await supabase.from('alert_subscriptions').update({ active: v }).eq('id', s.id); load(); }} />
            </View>
            <Pressable onPress={async () => { await supabase.from('alert_subscriptions').delete().eq('id', s.id); load(); }}><Text style={[st.link, { color: colors.alert }]}>Remove</Text></Pressable>
          </View>
        ))}
        <View style={st.card}>
          <Text style={st.h2}>Add an alert</Text>
          {KINDS.map((k) => (
            <Pressable key={k.key} onPress={() => setKind(k.key)} style={[st.opt, kind === k.key && st.optOn]}>
              <Text style={st.p}>{k.title}</Text><Text style={st.sub}>{k.sub}</Text>
            </Pressable>
          ))}
          <Text style={st.label}>Area</Text>
          <View style={st.wrap}>{AREAS.map((a) => <Chip key={a.label} label={a.label} on={area.label === a.label} onPress={() => setArea(a)} />)}</View>
          <View style={st.wrap}>{[5, 10, 15, 25, 40].map((r) => <Chip key={r} label={`${r} NM`} on={radius === r} onPress={() => setRadius(r)} />)}</View>
          {kind === 'species' || kind === 'activity' ? (
            <>
              <Text style={st.label}>Species</Text>
              <View style={st.wrap}>{SPECIES.slice(0, 14).map((s) => <Chip key={s.code} label={s.code} on={species.includes(s.code)} color={s.color}
                onPress={() => setSpecies(species.includes(s.code) ? species.filter((x) => x !== s.code) : [...species, s.code])} />)}</View>
            </>
          ) : null}
          {kind === 'species' ? <View style={st.rowB}><Text style={st.p}>Verified reports only</Text><Switch value={verified} onValueChange={setVerified} /></View> : null}
          {kind === 'sst' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <TextInput style={st.input} value={minF} onChangeText={setMinF} keyboardType="decimal-pad" /><Text style={st.p}>to</Text>
              <TextInput style={st.input} value={maxF} onChangeText={setMaxF} keyboardType="decimal-pad" /><Text style={st.p}>°F</Text>
            </View>
          ) : null}
          <Btn label="Add alert" kind="primary" onPress={add} disabled={(kind === 'species' || kind === 'activity') && !species.length} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  const st = useSt();
  return <Pressable onPress={onPress} style={[st.chip, on && { backgroundColor: color ?? colors.accent, borderColor: color ?? colors.accent }]}><Text style={[st.chipT, on && { color: colors.accentInk }]}>{label}</Text></Pressable>;
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  p: { color: colors.text, fontSize: 15 },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 4 },
  link: { color: colors.live, fontSize: 15 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.panelSolid },
  rowB: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  opt: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 10 },
  optOn: { borderColor: colors.accent, backgroundColor: colors.warnBg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 34, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  input: { width: 70, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 10 },
}));
