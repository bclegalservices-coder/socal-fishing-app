// Offline maps (plan: 'Offline architecture'). Home waters is automatic; this screen shows what's on
// the phone and lets you update now or add extra detail for an area.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import { autoRefresh, deletePack, getSettings, getStatus, HOME, listPacks, setSettings, type OfflineSettings, type OfflineStatus } from '../offline/packs';
import { Btn } from '../components/ui';
import { track } from '../analytics';
import { friendly } from '../friendly';

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
const when = (t?: number) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');

export function OfflineScreen({ onBack }: { onBack: () => void }) {
  const st = useSt();
  const [s, setS] = useState<OfflineStatus>({});
  const [set, setSet] = useState<OfflineSettings>({ wifiOnly: true, auto: true });
  const [packs, setPacks] = useState<{ name: string; bytes: number; percent: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => { setS(await getStatus()); setSet(await getSettings()); setPacks(await listPacks().catch(() => [])); };
  useEffect(() => { load(); }, []);
  const updateNow = async () => {
    setBusy(true);
    try {
      const cat = (await getJSON<any>('/layers', { cacheKey: 'layers' })).data;
      await autoRefresh(cat, true, (x) => setS(x));
      track('offline_update', { manual: true });
    } catch (e: any) { Alert.alert('Update stopped', friendly(e)); }
    finally { setBusy(false); load(); }
  };
  const total = packs.reduce((a, p) => a + p.bytes, 0);
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Pressable onPress={onBack} style={{ paddingVertical: 10 }}><Text style={st.link}>‹ Profile</Text></Pressable>
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }}>
        <Text style={st.h1}>Offline maps</Text>
        <Text style={st.p}>Home waters ({HOME.label}) stays on this phone and updates itself whenever you have signal. Offshore, the app shows the last data with its age.</Text>
        <View style={st.card}>
          <Row k="Chart + seafloor" v={s.chart?.done ? `Ready · ${mb(s.chart.bytes)} · ${when(s.chart.at)}` : s.chart?.error ? `Not ready: ${s.chart.error}` : s.chart ? `Downloading ${s.chart.percent}%` : 'Not downloaded yet'} />
          <Row k="Water temp & chlorophyll" v={s.ocean?.done ? `Image ${s.ocean.date} · saved ${when(s.ocean.at)}` : s.ocean ? `Downloading ${s.ocean.percent}%` : 'Not downloaded yet'} />
          <Row k="MPAs, closures, wrecks, lanes" v={s.rules ? `Saved ${when(s.rules.at)} · boundaries checked ${s.rules.checked_at ? new Date(s.rules.checked_at).toLocaleDateString() : '?'}` : 'Not downloaded yet'} />
          <Row k="Tides" v={s.tides ? `Predictions through ${s.tides.through}` : 'Not downloaded yet'} />
          <Row k="Fishing spots" v={s.spots ? `${s.spots.count} spots · ${when(s.spots.at)}` : 'Not downloaded yet'} />
          <Row k="Your spots, routes, tracks, catches" v="Always on this phone" />
          <Text style={st.sub}>Map downloads on this phone: {mb(total)}</Text>
          <Btn label={busy ? 'Updating…' : 'Update now'} kind="primary" onPress={updateNow} disabled={busy} />
        </View>
        <View style={st.card}>
          <View style={st.rowB}><Text style={st.p}>Update automatically</Text><Switch value={set.auto} onValueChange={async (v) => { const n = { ...set, auto: v }; setSet(n); await setSettings(n); }} /></View>
          <View style={st.rowB}><Text style={st.p}>Big chart download on Wi-Fi only</Text><Switch value={set.wifiOnly} onValueChange={async (v) => { const n = { ...set, wifiOnly: v }; setSet(n); await setSettings(n); }} /></View>
          <Text style={st.sub}>Daily water and weather updates are small and use cell data when needed.</Text>
        </View>
        {packs.filter((p) => p.name.startsWith('area-')).map((p) => (
          <View key={p.name} style={st.card}>
            <Text style={st.p}>Extra detail: {p.name.slice(5)}</Text>
            <Text style={st.sub}>{mb(p.bytes)} · {p.percent}%</Text>
            <Pressable onPress={async () => { await deletePack(p.name); load(); }}><Text style={[st.link, { color: colors.alert }]}>Delete</Text></Pressable>
          </View>
        ))}
        <Text style={st.sub}>Fishing farther out? On the map, zoom to the area and use Layers → "Save this area offline" for extra chart detail.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={{ gap: 2 }}><Text style={st.k}>{k}</Text><Text style={st.p}>{v}</Text></View>;
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700' },
  p: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  k: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  link: { color: colors.live, fontSize: 15 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, gap: 10, backgroundColor: colors.panelSolid },
  rowB: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
