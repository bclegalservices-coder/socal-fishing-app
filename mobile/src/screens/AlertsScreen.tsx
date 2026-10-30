// Opt-in alerts (plan: 'Alerts'): species, bite activity, water temperature, marine warnings.
// At most 4 per day; each alert at most every 3 hours.
import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { colors, makeStyles } from '../theme';
import { SPECIES } from '../community/species';
import { supabase } from '../supabase';
import { Btn, Card, Chip, ListGroup, ScreenHeader, SectionLabel, Segmented } from '../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { track } from '../analytics';
import { usePro } from '../pro';
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
  { key: 'spotter', title: 'Spotter plane', sub: 'A plane starts circling low over the water in your area (usually a spotter on fish)' },
  { key: 'sci', title: 'San Clemente closures', sub: 'The Navy closes or reopens sections of San Clemente Island, plus a heads-up the day before' },
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
  const [here, setHere] = useState<{ label: string; center: number[] } | null>(null);
  useEffect(() => {
    Location.getLastKnownPositionAsync().then((p) => {
      if (p) setHere({ label: 'Near me', center: [Math.round(p.coords.longitude * 100) / 100, Math.round(p.coords.latitude * 100) / 100] });
    }).catch(() => {});
  }, []);
  const [radius, setRadius] = useState(15);
  const [species, setSpecies] = useState<string[]>(['BFT']);
  const [verified, setVerified] = useState(true);
  const [minF, setMinF] = useState('66');
  const [maxF, setMaxF] = useState('72');
  const [pushOk, setPushOk] = useState<boolean | null>(null);
  const pro = usePro();
  const load = async () => { const { data } = await supabase.from('alert_subscriptions').select('*').order('created_at'); setSubs(data ?? []); };
  useEffect(() => { load(); registerPush().then((t) => setPushOk(!!t)).catch(() => setPushOk(false)); }, []);

  const add = async () => {
    const params: any = kind === 'sci' ? { center: [-118.5, 32.9], radius_nm: 3, label: 'San Clemente Island' } : { center: area.center, radius_nm: radius, label: area.label };
    if (kind === 'sci' && subs.some((s) => s.kind === 'sci')) { Alert.alert('Already on', 'You already have San Clemente closure alerts.'); return; }
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
      sst: `Water ${p.min_f}–${p.max_f}°F`, weather: 'Marine warnings', spotter: 'Spotter planes circling', sci: 'San Clemente Island closures' }[s.kind as string] + (s.kind === 'sci' ? '' : ` · ${p.label} (${p.radius_nm} NM)`);
  };

  const needSpecies = kind === 'species' || kind === 'activity';
  return (
    <View style={st.root}>
      <ScreenHeader title="Alerts" subtitle="At most 4 a day, each at most every 3 hours" onBack={onBack} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        {pushOk === false ? <Card tone="warn"><Text style={st.p}>Notifications are off for this app. Turn them on in your phone's Settings to get alerts.</Text></Card> : null}

        <SectionLabel>Your alerts</SectionLabel>
        {subs.length ? (
          <ListGroup>
            {subs.map((s, i) => (
              <View key={s.id} style={[st.subRow, i < subs.length - 1 && st.subLine]}>
                <View style={st.subIcon}><Ionicons name={(KIND_ICON as any)[s.kind] ?? 'notifications-outline'} size={18} color={colors.live} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.p} numberOfLines={2}>{describe(s)}</Text>
                  <Text style={st.sub}>{s.last_sent_at ? `Last sent ${new Date(s.last_sent_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Not sent yet'}</Text>
                </View>
                <Switch value={s.active} onValueChange={async (v) => { await supabase.from('alert_subscriptions').update({ active: v }).eq('id', s.id); load(); }} />
                <Pressable onPress={() => Alert.alert('Remove this alert?', describe(s), [{ text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: async () => { await supabase.from('alert_subscriptions').delete().eq('id', s.id); load(); } }])}
                  hitSlop={8} style={st.trash} accessibilityRole="button" accessibilityLabel="Remove alert">
                  <Ionicons name="trash-outline" size={19} color={colors.alert} />
                </Pressable>
              </View>
            ))}
          </ListGroup>
        ) : <Card><Text style={st.sub}>No alerts yet. Alerts stay off until you add one below.</Text></Card>}

        <SectionLabel>Add an alert</SectionLabel>
        <Card style={{ gap: 14 }}>
          <Text style={st.step}>1 · What to watch for</Text>
          <View style={{ gap: 8 }}>
            {KINDS.map((k) => {
              const on = kind === k.key;
              return (
                <Pressable key={k.key} onPress={() => setKind(k.key)} style={[st.opt, on && st.optOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                  <Ionicons name={KIND_ICON[k.key] as any} size={20} color={on ? colors.accent : colors.muted} />
                  <View style={{ flex: 1 }}><Text style={st.optT}>{k.title}</Text><Text style={st.sub}>{k.sub}</Text></View>
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.accent : colors.faint} />
                </Pressable>
              );
            })}
          </View>

          {kind === 'sci' ? <Text style={st.sub}>Sent when the Navy closes or reopens any section around San Clemente Island, and the day before a scheduled closure. Free for everyone.</Text> : <>
          <Text style={st.step}>2 · Where</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[...(here ? [here] : []), ...AREAS].map((a) => <Chip key={a.label} label={a.label} icon={a.label === 'Near me' ? 'navigate-outline' : 'location-outline'} on={area.label === a.label} onPress={() => setArea(a)} />)}
          </ScrollView>
          <Text style={st.lbl}>Within</Text>
          <Segmented value={String(radius)} onChange={(v) => setRadius(Number(v))} options={[5, 10, 15, 25, 40].map((r) => ({ key: String(r), label: `${r} NM` }))} />
          </>}

          {needSpecies ? (
            <>
              <Text style={st.step}>3 · Which fish</Text>
              <View style={st.wrap}>{SPECIES.slice(0, 14).map((sp) => <Chip key={sp.code} label={sp.name} on={species.includes(sp.code)} dot={sp.color}
                onPress={() => setSpecies(species.includes(sp.code) ? species.filter((x) => x !== sp.code) : [...species, sp.code])} />)}</View>
              {kind === 'species' ? <View style={st.rowB}><Text style={st.p}>Verified reports only</Text><Switch value={verified} onValueChange={setVerified} /></View> : null}
            </>
          ) : null}
          {kind === 'sst' ? (
            <>
              <Text style={st.step}>3 · Water temperature</Text>
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <TextInput style={st.input} value={minF} onChangeText={setMinF} keyboardType="decimal-pad" /><Text style={st.p}>to</Text>
                <TextInput style={st.input} value={maxF} onChangeText={setMaxF} keyboardType="decimal-pad" /><Text style={st.p}>°F</Text>
              </View>
            </>
          ) : null}
          {kind === 'spotter' ? (
            <Text style={st.sub}>{pro.locked ? 'Spotter plane alerts are part of Pro.' : `Sent within a couple of minutes of a plane circling low over the water inside your area — at most 6 a day, and each plane once.${pro.gated ? '' : ' Pro feature, free for now.'}`}</Text>
          ) : null}
          <Btn label="Add alert" icon="add-circle-outline" kind="primary" onPress={add} disabled={(needSpecies && !species.length) || (kind === 'spotter' && pro.locked)} />
        </Card>
      </ScrollView>
    </View>
  );
}

const KIND_ICON: Record<string, string> = { species: 'fish-outline', activity: 'trending-up', sst: 'thermometer-outline', weather: 'warning-outline', spotter: 'airplane-outline', sci: 'boat-outline' };

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 48, gap: 10 },
  p: { color: colors.text, fontSize: 15 },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  step: { color: colors.text, fontSize: 16, fontWeight: '800' },
  lbl: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: -6 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  subLine: { borderBottomWidth: 1, borderColor: colors.line },
  subIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  trash: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  rowB: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, borderRadius: 12, padding: 12 },
  optOn: { borderColor: colors.accent, borderWidth: 2 },
  optT: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { width: 80, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16, textAlign: 'center' },
}));
