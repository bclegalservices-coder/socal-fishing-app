// Private fishing log (spec §13): every catch with its conditions, searchable and filterable.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Btn, Card, ScreenHeader, Segmented } from '../components/ui';
import { colors, makeStyles } from '../theme';
import { formatNm } from '../geo';
import { formatDuration } from '../nav';
import { deleteMyCatch, loadQueue, myCatches, privatePhotoUrl, syncQueue, type PendingCatch } from '../community/catchApi';
import { cachedGroups, shareCatch } from '../community/groupsApi';
import { SPECIES, speciesColor, speciesName } from '../community/species';
import { loadTracks, type TrackMeta } from '../storage';
import { supabase, supabaseReady } from '../supabase';
import { track } from '../analytics';
import { friendly } from '../friendly';

type Filters = { species: string | null; period: number | null; text: string; sstMin: string; sstMax: string; tide: 'any' | 'rising' | 'falling'; moon: 'any' | 'new' | 'full' };
const PERIODS = [{ label: '30 days', d: 30 }, { label: '1 year', d: 365 }, { label: 'All', d: null as number | null }];

export function MyFishingScreen({ onShowOnMap, onBack }: { onShowOnMap: (lat: number, lon: number, name: string) => void; onBack?: () => void }) {
  const st = useSt();
  const [seg, setSeg] = useState<'catches' | 'trips'>('catches');
  const [rows, setRows] = useState<any[] | null>(null);
  const [pending, setPending] = useState<PendingCatch[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Filters>({ species: null, period: 365, text: '', sstMin: '', sstMax: '', tide: 'any', moon: 'any' });
  const [open, setOpen] = useState<any | null>(null);
  const [trips, setTrips] = useState<TrackMeta[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setPending(await loadQueue());
    setTrips(await loadTracks());
    if (!supabaseReady) return;
    const { data } = await supabase.auth.getSession();
    setSignedIn(!!data.session);
    if (!data.session) { setRows([]); return; }
    try { await syncQueue(); setPending(await loadQueue()); setRows(await myCatches()); setErr(null); }
    catch (e: any) { setErr(friendly(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => {
    const s = r.env_snapshots ?? {};
    if (f.species && r.species?.code !== f.species) return false;
    if (f.period && Date.now() - new Date(r.caught_at).getTime() > f.period * 86400000) return false;
    if (f.text) {
      const hay = [r.area_name, r.notes, r.bait, r.technique, r.species?.name].join(' ').toLowerCase();
      if (!hay.includes(f.text.toLowerCase())) return false;
    }
    if (f.sstMin && !(s.sst_f >= Number(f.sstMin))) return false;
    if (f.sstMax && !(s.sst_f <= Number(f.sstMax))) return false;
    if (f.tide !== 'any' && s.tide_stage !== f.tide) return false;
    if (f.moon === 'new' && !(s.moon_phase < 0.15 || s.moon_phase > 0.85)) return false;
    if (f.moon === 'full' && !(s.moon_phase > 0.35 && s.moon_phase < 0.65)) return false;
    return true;
  }), [rows, f]);

  const stats = useMemo(() => {
    const fish = filtered.reduce((a, r) => a + (r.quantity ?? 1), 0);
    const ssts = filtered.map((r) => r.env_snapshots?.sst_f).filter((v: any) => v != null).sort((a: number, b: number) => a - b);
    const mid = ssts.length >= 4 ? `${ssts[Math.floor(ssts.length * 0.25)].toFixed(1)}–${ssts[Math.floor(ssts.length * 0.75)].toFixed(1)}°F` : null;
    const tides: Record<string, number> = {};
    filtered.forEach((r) => { const t = r.env_snapshots?.tide_stage; if (t) tides[t] = (tides[t] ?? 0) + 1; });
    const topTide = Object.entries(tides).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { n: filtered.length, fish, mid, topTide };
  }, [filtered]);

  if (open) return <CatchDetail r={open} onBack={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); }} onShowOnMap={onShowOnMap} />;

  const active = [f.species, f.period !== 365 ? 'p' : null, f.tide !== 'any' ? 't' : null, f.moon !== 'any' ? 'm' : null, f.text, f.sstMin, f.sstMax].filter(Boolean).length;
  const periodKey = f.period == null ? 'all' : String(f.period);

  return (
    <View style={st.root}>
      <ScreenHeader title="My Fishing" subtitle={seg === 'catches' ? `${stats.n} catches · ${stats.fish} fish` : `${trips.length} recorded trips`} onBack={onBack} backLabel="Me" />
      <View style={st.segWrap}>
        <Segmented value={seg} onChange={setSeg} options={[{ key: 'catches', label: 'Catch log', icon: 'fish-outline' }, { key: 'trips', label: `Trips (${trips.length})`, icon: 'analytics-outline' }]} />
      </View>
      {seg === 'trips' ? (
        <FlatList data={trips} keyExtractor={(t) => t.id} contentContainerStyle={st.list}
          ListEmptyComponent={<Text style={st.empty}>Record a trip from the map: tap ••• then Trips → Start recording.</Text>}
          renderItem={({ item }) => (
            <View style={st.rowCard}>
              <View style={[st.badge, { backgroundColor: colors.live }]}><Ionicons name="boat" size={20} color="#FFFFFF" /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.name} numberOfLines={1}>{item.name}</Text>
                <Text style={st.sub}>{new Date(item.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · {formatNm(item.distanceNm)} NM · {formatDuration((item.endedAt - item.startedAt) / 60000)} · max {item.maxKt.toFixed(1)} kt</Text>
              </View>
            </View>
          )} />
      ) : (
        <FlatList data={filtered} keyExtractor={(r) => r.id} onRefresh={load} refreshing={false} contentContainerStyle={st.list}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: 10, paddingBottom: 6 }}>
              {pending.length ? <Card tone="warn"><Text style={st.cardT}>⏳ {pending.length} catch{pending.length === 1 ? '' : 'es'} waiting to send{signedIn ? ' — they send when you have signal' : ' — sign in on the Me tab to send'}</Text></Card> : null}
              {!signedIn && supabaseReady ? <Card tone="info"><Text style={st.cardT}>Your catch log lives in your account. Sign in on the Me tab to see it here.</Text></Card> : null}
              {err ? <Card tone="alert"><Text style={st.cardT}>Offline or error: {err}</Text></Card> : null}

              <View style={st.searchRow}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput style={st.search} value={f.text} onChangeText={(t) => setF({ ...f, text: t })} placeholder="Search area, bait, notes" placeholderTextColor={colors.faint} returnKeyType="search" />
                {f.text ? <Pressable onPress={() => setF({ ...f, text: '' })} hitSlop={10} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
              </View>

              <View style={st.filterBar}>
                <Pressable onPress={() => setShowFilters(!showFilters)} style={({ pressed }) => [st.filterBtn, (showFilters || active > 0) && st.filterBtnOn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Filters">
                  <Ionicons name="options-outline" size={18} color={showFilters || active > 0 ? colors.accentInk : colors.text} />
                  <Text style={[st.filterBtnT, (showFilters || active > 0) && { color: colors.accentInk }]}>Filters{active ? ` (${active})` : ''}</Text>
                  <Ionicons name={showFilters ? 'chevron-up' : 'chevron-down'} size={16} color={showFilters || active > 0 ? colors.accentInk : colors.text} />
                </Pressable>
                {active ? <Pressable onPress={() => setF({ species: null, period: 365, text: '', sstMin: '', sstMax: '', tide: 'any', moon: 'any' })} style={({ pressed }) => [st.clearBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                  <Text style={st.clearT}>Reset</Text>
                </Pressable> : null}
              </View>

              {showFilters ? (
                <Card style={{ gap: 12 }}>
                  <Text style={st.fLabel}>Species</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <Chip label="All species" on={!f.species} onPress={() => setF({ ...f, species: null })} />
                    {SPECIES.slice(0, 14).map((sp) => <Chip key={sp.code} label={sp.name ?? sp.code} dot={sp.color} on={f.species === sp.code} onPress={() => { if (f.species !== sp.code) track('catch_filter', { species: sp.code }); setF({ ...f, species: f.species === sp.code ? null : sp.code }); }} />)}
                  </ScrollView>
                  <Text style={st.fLabel}>When</Text>
                  <Segmented value={periodKey} onChange={(k) => setF({ ...f, period: k === 'all' ? null : Number(k) })}
                    options={PERIODS.map((p) => ({ key: p.d == null ? 'all' : String(p.d), label: p.label }))} />
                  <Text style={st.fLabel}>Tide</Text>
                  <Segmented value={f.tide} onChange={(t) => setF({ ...f, tide: t })} options={[{ key: 'any', label: 'Any' }, { key: 'rising', label: 'Rising' }, { key: 'falling', label: 'Falling' }]} />
                  <Text style={st.fLabel}>Moon</Text>
                  <Segmented value={f.moon} onChange={(m) => setF({ ...f, moon: m })} options={[{ key: 'any', label: 'Any' }, { key: 'new', label: 'New moon' }, { key: 'full', label: 'Full moon' }]} />
                  <Text style={st.fLabel}>Water temp (°F)</Text>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                    <TextInput style={st.input} value={f.sstMin} onChangeText={(t) => setF({ ...f, sstMin: t })} placeholder="From" keyboardType="decimal-pad" placeholderTextColor={colors.faint} />
                    <Text style={st.sub}>to</Text>
                    <TextInput style={st.input} value={f.sstMax} onChangeText={(t) => setF({ ...f, sstMax: t })} placeholder="To" keyboardType="decimal-pad" placeholderTextColor={colors.faint} />
                  </View>
                </Card>
              ) : null}

              <View style={st.statRow}>
                <StatTile k="Catches" v={String(stats.n)} />
                <StatTile k="Fish" v={String(stats.fish)} />
                <StatTile k="Best temp" v={stats.mid ?? '—'} small />
                <StatTile k="Best tide" v={stats.topTide ? cap(stats.topTide) : '—'} small />
              </View>
            </View>
          }
          ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.live} style={{ marginTop: 30 }} /> : <Text style={st.empty}>No catches match. Log one from the map with the 🎣 button.</Text>}
          renderItem={({ item }) => (
            <Pressable style={({ pressed }) => [st.rowCard, pressed && { opacity: 0.7 }]} onPress={() => setOpen(item)} accessibilityRole="button">
              <View style={[st.badge, { backgroundColor: speciesColor(item.species?.code) }]}><Text style={st.badgeT}>{item.species?.code}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={st.name} numberOfLines={1}>{item.species?.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}{item.weight_lb ? ` · ${Math.round(item.weight_lb)} lb` : ''}</Text>
                <Text style={st.sub} numberOfLines={1}>{new Date(item.caught_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{item.area_name ? ` · ${item.area_name}` : ''}</Text>
                <Text style={st.sub} numberOfLines={1}>{[item.env_snapshots?.sst_f != null ? `${item.env_snapshots.sst_f.toFixed(1)}°F` : null, item.env_snapshots?.tide_stage ? `${item.env_snapshots.tide_stage} tide` : null, item.technique, item.bait].filter(Boolean).join(' · ')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <View style={[st.tag, item.location_mode === 'private' ? null : st.tagPub]}><Text style={st.tagT}>{item.location_mode === 'private' ? 'Private' : 'Public'}</Text></View>
                {item.verification_status === 'verified' ? <Ionicons name="checkmark-circle" size={18} color={colors.ok} /> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </Pressable>
          )} />
      )}
    </View>
  );
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
function StatTile({ k, v, small }: { k: string; v: string; small?: boolean }) {
  const st = useSt();
  return <View style={st.stat}><Text style={[st.statV, small && { fontSize: 15 }]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text><Text style={st.statK}>{k}</Text></View>;
}

function CatchDetail({ r, onBack, onDeleted, onShowOnMap }: { r: any; onBack: () => void; onDeleted: () => void; onShowOnMap: (lat: number, lon: number, n: string) => void }) {
  const st = useSt();
  const s = r.env_snapshots ?? {};
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { Promise.all((r.photo_paths ?? []).map(privatePhotoUrl)).then((u) => setUrls(u.filter(Boolean) as string[])); }, [r.id]);
  const line = (k: string, v: any) => (v == null || v === '' ? null : <View style={st.kv}><Text style={st.kvK}>{k}</Text><Text style={st.kvV}>{String(v)}</Text></View>);
  return (
    <View style={st.root}>
      <ScreenHeader title={`${speciesName(r.species?.code)}${r.quantity > 1 ? ` × ${r.quantity}` : ''}`} subtitle={`${new Date(r.caught_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${r.verification_status}`} onBack={onBack} backLabel="Catch log" />
      <ScrollView contentContainerStyle={{ gap: 8, padding: 16, paddingBottom: 40 }}>
        <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>{urls.map((u) => <Image key={u} source={{ uri: u }} style={st.photo} />)}</ScrollView>
        {line('Weight', r.weight_lb ? `${r.weight_lb} lb` : null)}{line('Length', r.length_in ? `${r.length_in} in` : null)}
        {line('Kept', r.kept == null ? null : r.kept ? 'Kept' : 'Released')}{line('Technique', r.technique)}{line('Bait/lure', r.bait)}
        {line('Fishing depth', r.fishing_depth_ft ? `${r.fishing_depth_ft} ft` : null)}{line('Water depth', r.water_depth_ft ? `${r.water_depth_ft} ft` : null)}
        {line('Meter marks', r.meter_marks)}{line('Notes', r.notes)}
        {line('Shared as', r.location_mode === 'private' ? 'Private (only you)' : `${r.location_mode}${r.anonymous ? ', anonymous' : ''}`)}
        <Text style={[st.fLabel, { marginTop: 14 }]}>Conditions when you caught it</Text>
        {line('Water temp', s.sst_f != null ? `${s.sst_f.toFixed(1)}°F (${s.sst_interpolated ? 'satellite blend' : 'satellite'}, image ${s.sst_observed_at?.slice(0, 10) ?? '?'})` : 'no satellite data')}
        {line('Temp change nearby', s.sst_gradient_f_per_nm != null ? `${s.sst_gradient_f_per_nm.toFixed(2)}°F per NM` : null)}
        {line('Chlorophyll', s.chl_mg_m3 != null ? `${s.chl_mg_m3.toFixed(2)} mg/m³` : null)}
        {line('Tide', s.tide_stage ? `${s.tide_stage}${s.tide_height_ft != null ? `, ${s.tide_height_ft} ft` : ''} (station ${s.tide_station}, ${s.tide_station_nm} NM away)` : null)}
        {line('Wind', s.wind_kt != null ? `${Math.round(s.wind_kt)} kt${s.wind_is_forecast ? ' (forecast)' : ' (measured)'}` : null)}
        {line('Swell', s.swell_ft != null ? `${s.swell_ft} ft @ ${s.swell_period_s ?? '?'} s` : null)}
        {line('Depth (seafloor model)', s.depth_ft != null ? `${Math.round(s.depth_ft)} ft` : null)}
        {line('Moon', s.moon_phase != null ? `${Math.round((1 - Math.cos(2 * Math.PI * s.moon_phase)) * 50)}% lit` : null)}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Btn icon="map-outline" label="Show on map" kind="primary" onPress={async () => {
            const { data } = await supabase.rpc('my_catch_point', { catch_id: r.id });
            if (data?.[0]) onShowOnMap(data[0].lat, data[0].lon, speciesName(r.species?.code));
          }} />
          <Btn icon="people-outline" label="Send to group" onPress={async () => {
            const gs = await cachedGroups();
            if (!gs.length) { Alert.alert('No groups yet', 'Create or join a fishing group in the Crew tab.'); return; }
            const send = (ids: string[]) => shareCatch(r.id, ids)
              .then((n) => { track('group_catch_shared', { groups: ids.length }); Alert.alert(n ? 'Sent to your group' : 'Already shared with that group'); })
              .catch((e) => Alert.alert('Not sent', friendly(e)));
            Alert.alert('Send this catch to…', 'Members see the exact spot. Nothing changes on the public map.', [
              ...gs.slice(0, 3).map((g) => ({ text: g.name, onPress: () => send([g.id]) })),
              ...(gs.length > 1 ? [{ text: 'All my groups', onPress: () => send(gs.map((g) => g.id)) }] : []),
              { text: 'Cancel', style: 'cancel' as const }]);
          }} />
        </View>
        <Btn icon="trash-outline" label="Delete catch" kind="danger" onPress={() => Alert.alert('Delete this catch?', 'It is removed from your log and from the public map.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => deleteMyCatch(r.id).then(onDeleted).catch((e) => Alert.alert('Not deleted', friendly(e))) }])} />
      </ScrollView>
    </View>
  );
}

function Chip({ label, on, onPress, dot }: { label: string; on: boolean; onPress: () => void; dot?: string }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      {dot ? <View style={[st.chipDot, { backgroundColor: dot }]} /> : null}
      <Text style={[st.chipT, on && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  segWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 8 },
  cardT: { color: colors.text, fontSize: 14, lineHeight: 19 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  search: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  filterBar: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 42, paddingHorizontal: 14, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  filterBtnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterBtnT: { color: colors.text, fontSize: 15, fontWeight: '700' },
  clearBtn: { minHeight: 42, paddingHorizontal: 14, borderRadius: 21, justifyContent: 'center', borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  clearT: { color: colors.alert, fontSize: 15, fontWeight: '700' },
  fLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 38, paddingHorizontal: 13, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset },
  chipOn: { backgroundColor: /^#[0-9a-f]{6}$/i.test(colors.accent) ? colors.accent + '22' : colors.inset, borderColor: colors.accent },
  chipDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  input: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  statRow: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8 },
  statV: { color: colors.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statK: { color: colors.muted, fontSize: 11.5, fontWeight: '700', marginTop: 2 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13 },
  tag: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.border },
  tagPub: { backgroundColor: colors.infoBg, borderColor: colors.live },
  tagT: { color: colors.text, fontSize: 11, fontWeight: '700' },
  kv: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.line },
  kvK: { width: 120, color: colors.muted, fontSize: 14, fontWeight: '600' },
  kvV: { flex: 1, color: colors.text, fontSize: 15 },
  photo: { width: 160, height: 120, borderRadius: 10 },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
}));
