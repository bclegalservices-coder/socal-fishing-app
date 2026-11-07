// Offline maps (plan: 'Offline architecture'). Home waters is automatic; this screen shows what's on
// the phone and lets you update now or add extra detail for an area.
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import { autoRefresh, deletePack, getSettings, getStatus, HOME, listPacks, setSettings, type OfflineSettings, type OfflineStatus } from '../offline/packs';
import { Btn, Card, ListGroup, ListRow, Note, ScreenHeader, SectionLabel, SmallBtn } from '../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { track } from '../analytics';
import { friendly } from '../friendly';
import { AppSwitch } from '../components/form';

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
  const chartOk = !!s.chart?.done;
  return (
    <View style={st.root}>
      <ScreenHeader title="Offline maps" subtitle={`Home waters: ${HOME.label}`} onBack={onBack} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body}>
        <Card tone={chartOk ? 'ok' : 'info'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={chartOk ? 'checkmark-circle' : 'cloud-download-outline'} size={26} color={chartOk ? colors.ok : colors.live} />
            <View style={{ flex: 1 }}>
              <Text style={st.big}>{chartOk ? 'Ready for offshore' : 'Not fully downloaded'}</Text>
              <Text style={st.sub}>{mb(total)} saved on this phone · updates itself when you have signal</Text>
            </View>
          </View>
          <Btn label={busy ? 'Updating…' : 'Update now'} icon="refresh" kind="primary" onPress={updateNow} disabled={busy} />
        </Card>

        <SectionLabel>What's saved</SectionLabel>
        <ListGroup>
          <Item icon="map-outline" k="Chart and seafloor" ok={!!s.chart?.done} v={s.chart?.done ? `${mb(s.chart.bytes)} · ${when(s.chart.at)}` : s.chart?.error ? `Not ready: ${s.chart.error}` : s.chart ? `Downloading ${s.chart.percent}%` : 'Not downloaded yet'} />
          <Item icon="thermometer-outline" k="Water temp and chlorophyll" ok={!!s.ocean?.done} v={s.ocean?.done ? `Image ${s.ocean.date} · saved ${when(s.ocean.at)}` : s.ocean ? `Downloading ${s.ocean.percent}%` : 'Not downloaded yet'} />
          <Item icon="shield-outline" k="MPAs, closures, wrecks, lanes" ok={!!s.rules} v={s.rules ? `Saved ${when(s.rules.at)}` : 'Not downloaded yet'} />
          <Item icon="water-outline" k="Tides" ok={!!s.tides} v={s.tides ? `Predictions through ${s.tides.through}` : 'Not downloaded yet'} />
          <Item icon="location-outline" k="Fishing spots" ok={!!s.spots} v={s.spots ? `${s.spots.count} spots · ${when(s.spots.at)}` : 'Not downloaded yet'} />
          <Item icon="star-outline" k="Your spots, routes, trips, catches" ok v="Always on this phone" last />
        </ListGroup>

        <SectionLabel>Settings</SectionLabel>
        <ListGroup>
          <ListRow icon="sync-outline" title="Update automatically" right={<AppSwitch value={set.auto} onValueChange={async (v) => { const n = { ...set, auto: v }; setSet(n); await setSettings(n); }} />} />
          <ListRow icon="wifi-outline" title="Big chart download on Wi-Fi only" subtitle="Daily water and weather updates are small and use cell data" last
            right={<AppSwitch value={set.wifiOnly} onValueChange={async (v) => { const n = { ...set, wifiOnly: v }; setSet(n); await setSettings(n); }} />} />
        </ListGroup>

        <SectionLabel>Extra detail areas</SectionLabel>
        {packs.filter((p) => p.name.startsWith('area-')).length ? (
          <ListGroup>
            {packs.filter((p) => p.name.startsWith('area-')).map((p, i, arr) => (
              <ListRow key={p.name} icon="layers-outline" title={p.name.slice(5)} subtitle={`${mb(p.bytes)} · ${p.percent}%`} last={i === arr.length - 1}
                right={<SmallBtn label="Delete" tone="danger" icon="trash-outline" onPress={async () => { await deletePack(p.name); load(); }} />} />
            ))}
          </ListGroup>
        ) : null}
        <Note>Fishing farther out? On the map, zoom to the area and use Layers → "Save this area offline" for extra chart detail.</Note>
      </ScrollView>
    </View>
  );
}

function Item({ icon, k, v, ok, last }: { icon: string; k: string; v: string; ok?: boolean; last?: boolean }) {
  return <ListRow icon={icon} iconColor={ok ? colors.ok : colors.muted} title={k} subtitle={v} last={last}
    right={<Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={ok ? colors.ok : colors.faint} />} />;
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingBottom: 48, gap: 10 },
  big: { color: colors.text, fontSize: 17, fontWeight: '800' },
  sub: { color: colors.muted, fontSize: 13, lineHeight: 18 },
}));
