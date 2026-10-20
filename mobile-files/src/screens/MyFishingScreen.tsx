// Private fishing log (spec §13): every catch with its conditions, searchable and filterable.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, makeStyles } from '../theme';
import { formatNm } from '../geo';
import { formatDuration } from '../nav';
import { deleteMyCatch, loadQueue, myCatches, privatePhotoUrl, syncQueue, type PendingCatch } from '../community/catchApi';
import { cachedGroups, shareCatch } from '../community/groupsApi';
import { SPECIES, speciesColor, speciesName } from '../community/species';
import { loadTracks, type TrackMeta } from '../storage';
import { supabase, supabaseReady } from '../supabase';
import { track } from '../analytics';

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

  const load = useCallback(async () => {
    setPending(await loadQueue());
    setTrips(await loadTracks());
    if (!supabaseReady) return;
    const { data } = await supabase.auth.getSession();
    setSignedIn(!!data.session);
    if (!data.session) { setRows([]); return; }
    try { await syncQueue(); setPending(await loadQueue()); setRows(await myCatches()); setErr(null); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
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

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      {onBack ? <Pressable onPress={onBack} style={{ paddingTop: 8 }} accessibilityRole="button" accessibilityLabel="Back to Me"><Text style={{ color: colors.live, fontSize: 16, fontWeight: '600' }}>‹ Me</Text></Pressable> : null}
      <Text style={st.h1}>My Fishing</Text>
      <View style={st.seg}>
        {(['catches', 'trips'] as const).map((k) => (
          <Pressable key={k} onPress={() => setSeg(k)} style={[st.segB, seg === k && st.segOn]}>
            <Text style={[st.segT, seg === k && { color: colors.accentInk }]}>{k === 'catches' ? 'Catch log' : `Trips (${trips.length})`}</Text>
          </Pressable>
        ))}
      </View>
      {seg === 'trips' ? (
        <FlatList data={trips} keyExtractor={(t) => t.id}
          ListEmptyComponent={<Text style={st.empty}>Record a trip from the map (Tracks → Start recording).</Text>}
          renderItem={({ item }) => (
            <View style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{item.name}</Text>
                <Text style={st.sub}>{formatNm(item.distanceNm)} NM · {formatDuration((item.endedAt - item.startedAt) / 60000)} · max {item.maxKt.toFixed(1)} kt</Text>
              </View>
            </View>
          )} />
      ) : (
        <FlatList data={filtered} keyExtractor={(r) => r.id} onRefresh={load} refreshing={false}
          ListHeaderComponent={
            <View style={{ gap: 8, paddingBottom: 8 }}>
              {pending.length ? <Text style={st.pending}>⏳ {pending.length} catch{pending.length === 1 ? '' : 'es'} waiting to send{signedIn ? ' — they send when you have signal' : ' — sign in on the Profile tab to send'}</Text> : null}
              {!signedIn && supabaseReady ? <Text style={st.sub}>Your catch log lives in your account. Sign in on the Profile tab to see it here.</Text> : null}
              {err ? <Text style={st.sub}>Offline or error: {err}</Text> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip label="All" on={!f.species} onPress={() => setF({ ...f, species: null })} />
                {SPECIES.slice(0, 14).map((s) => <Chip key={s.code} label={s.code} on={f.species === s.code} color={s.color} onPress={() => { if (f.species !== s.code) track('catch_filter', { species: s.code }); setF({ ...f, species: f.species === s.code ? null : s.code }); }} />)}
              </ScrollView>
              <View style={st.wrap}>
                {PERIODS.map((p) => <Chip key={p.label} label={p.label} on={f.period === p.d} onPress={() => setF({ ...f, period: p.d })} />)}
                {(['any', 'rising', 'falling'] as const).map((t) => <Chip key={t} label={t === 'any' ? 'Any tide' : `Tide ${t}`} on={f.tide === t} onPress={() => setF({ ...f, tide: t })} />)}
                {(['any', 'new', 'full'] as const).map((m) => <Chip key={m} label={m === 'any' ? 'Any moon' : `${m} moon`} on={f.moon === m} onPress={() => setF({ ...f, moon: m })} />)}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput style={[st.input, { flex: 2 }]} value={f.text} onChangeText={(t) => setF({ ...f, text: t })} placeholder="Search area, bait, notes" placeholderTextColor={colors.muted} />
                <TextInput style={st.input} value={f.sstMin} onChangeText={(t) => setF({ ...f, sstMin: t })} placeholder="SST ≥" keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
                <TextInput style={st.input} value={f.sstMax} onChangeText={(t) => setF({ ...f, sstMax: t })} placeholder="SST ≤" keyboardType="decimal-pad" placeholderTextColor={colors.muted} />
              </View>
              <Text style={st.stats}>{stats.n} catches · {stats.fish} fish{stats.mid ? ` · middle half caught at ${stats.mid}` : ''}{stats.topTide ? ` · mostly ${stats.topTide} tide` : ''}</Text>
            </View>
          }
          ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>No catches match. Log one from the map with the 🎣 button.</Text>}
          renderItem={({ item }) => (
            <Pressable style={st.row} onPress={() => setOpen(item)}>
              <View style={[st.badge, { backgroundColor: speciesColor(item.species?.code) }]}><Text style={st.badgeT}>{item.species?.code}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{item.species?.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}{item.weight_lb ? ` · ${Math.round(item.weight_lb)} lb` : ''}</Text>
                <Text style={st.sub}>{new Date(item.caught_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{item.area_name ? ` · ${item.area_name}` : ''} · {item.location_mode === 'private' ? 'private' : `public (${item.location_mode})`}</Text>
                <Text style={st.sub}>{[item.env_snapshots?.sst_f != null ? `${item.env_snapshots.sst_f.toFixed(1)}°F` : null, item.env_snapshots?.tide_stage ? `${item.env_snapshots.tide_stage} tide` : null, item.technique, item.bait].filter(Boolean).join(' · ')}</Text>
              </View>
              {item.verification_status === 'verified' ? <Text style={st.ver}>✓</Text> : null}
            </Pressable>
          )} />
      )}
    </SafeAreaView>
  );
}

function CatchDetail({ r, onBack, onDeleted, onShowOnMap }: { r: any; onBack: () => void; onDeleted: () => void; onShowOnMap: (lat: number, lon: number, n: string) => void }) {
  const st = useSt();
  const s = r.env_snapshots ?? {};
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => { Promise.all((r.photo_paths ?? []).map(privatePhotoUrl)).then((u) => setUrls(u.filter(Boolean) as string[])); }, [r.id]);
  const line = (k: string, v: any) => (v == null || v === '' ? null : <Text style={st.line}><Text style={st.sub}>{k}  </Text>{String(v)}</Text>);
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Pressable onPress={onBack} style={{ paddingVertical: 10 }}><Text style={st.link}>‹ Catch log</Text></Pressable>
      <ScrollView contentContainerStyle={{ gap: 8, paddingBottom: 40 }}>
        <Text style={st.h1}>{speciesName(r.species?.code)}{r.quantity > 1 ? ` × ${r.quantity}` : ''}</Text>
        <Text style={st.sub}>{new Date(r.caught_at).toLocaleString()} · {r.verification_status}</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: 6 }}>{urls.map((u) => <Image key={u} source={{ uri: u }} style={st.photo} />)}</ScrollView>
        {line('Weight', r.weight_lb ? `${r.weight_lb} lb` : null)}{line('Length', r.length_in ? `${r.length_in} in` : null)}
        {line('Kept', r.kept == null ? null : r.kept ? 'Kept' : 'Released')}{line('Technique', r.technique)}{line('Bait/lure', r.bait)}
        {line('Fishing depth', r.fishing_depth_ft ? `${r.fishing_depth_ft} ft` : null)}{line('Water depth', r.water_depth_ft ? `${r.water_depth_ft} ft` : null)}
        {line('Meter marks', r.meter_marks)}{line('Notes', r.notes)}
        {line('Shared as', r.location_mode === 'private' ? 'Private (only you)' : `${r.location_mode}${r.anonymous ? ', anonymous' : ''}`)}
        <Text style={[st.h2, { marginTop: 8 }]}>Conditions when you caught it</Text>
        {line('Water temp', s.sst_f != null ? `${s.sst_f.toFixed(1)}°F (${s.sst_interpolated ? 'satellite blend' : 'satellite'}, image ${s.sst_observed_at?.slice(0, 10) ?? '?'})` : 'no satellite data')}
        {line('Temp change nearby', s.sst_gradient_f_per_nm != null ? `${s.sst_gradient_f_per_nm.toFixed(2)}°F per NM` : null)}
        {line('Chlorophyll', s.chl_mg_m3 != null ? `${s.chl_mg_m3.toFixed(2)} mg/m³` : null)}
        {line('Tide', s.tide_stage ? `${s.tide_stage}${s.tide_height_ft != null ? `, ${s.tide_height_ft} ft` : ''} (station ${s.tide_station}, ${s.tide_station_nm} NM away)` : null)}
        {line('Wind', s.wind_kt != null ? `${Math.round(s.wind_kt)} kt${s.wind_is_forecast ? ' (forecast)' : ' (measured)'}` : null)}
        {line('Swell', s.swell_ft != null ? `${s.swell_ft} ft @ ${s.swell_period_s ?? '?'} s` : null)}
        {line('Depth (seafloor model)', s.depth_ft != null ? `${Math.round(s.depth_ft)} ft` : null)}
        {line('Moon', s.moon_phase != null ? `${Math.round((1 - Math.cos(2 * Math.PI * s.moon_phase)) * 50)}% lit` : null)}
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 10 }}>
          <Pressable onPress={async () => {
            const { data } = await supabase.rpc('my_catch_point', { catch_id: r.id });
            if (data?.[0]) onShowOnMap(data[0].lat, data[0].lon, speciesName(r.species?.code));
          }}><Text style={st.link}>Show on map</Text></Pressable>
          <Pressable onPress={async () => {
            const gs = await cachedGroups();
            if (!gs.length) { Alert.alert('No groups yet', 'Create or join a fishing group in Community → My groups.'); return; }
            const send = (ids: string[]) => shareCatch(r.id, ids)
              .then((n) => { track('group_catch_shared', { groups: ids.length }); Alert.alert(n ? 'Sent to your group' : 'Already shared with that group'); })
              .catch((e) => Alert.alert('Not sent', e.message));
            Alert.alert('Send this catch to…', 'Members see the exact spot. Nothing changes on the public map.', [
              ...gs.slice(0, 3).map((g) => ({ text: g.name, onPress: () => send([g.id]) })),
              ...(gs.length > 1 ? [{ text: 'All my groups', onPress: () => send(gs.map((g) => g.id)) }] : []),
              { text: 'Cancel', style: 'cancel' as const }]);
          }}><Text style={st.link}>Send to group</Text></Pressable>
          <Pressable onPress={() => Alert.alert('Delete this catch?', 'It is removed from your log and from the public map.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => deleteMyCatch(r.id).then(onDeleted).catch((e) => Alert.alert('Not deleted', e.message)) }])}>
            <Text style={[st.link, { color: colors.alert }]}>Delete</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={[st.chip, on && { backgroundColor: color ?? colors.accent, borderColor: color ?? colors.accent }]}>
      <Text style={[st.chipT, on && { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginVertical: 6 },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  seg: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segB: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segT: { color: colors.text, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 34, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  input: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 10 },
  stats: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  pending: { color: colors.accent, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: colors.accentInk, fontWeight: '800', fontSize: 13 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12.5 },
  ver: { color: colors.live, fontSize: 18, fontWeight: '800' },
  line: { color: colors.text, fontSize: 15 },
  photo: { width: 160, height: 120, borderRadius: 10 },
  link: { color: colors.live, fontSize: 15 },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30 },
}));
