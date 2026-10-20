import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, touch, makeStyles } from '../theme';
import { loadPublicSpots, loadRoutes, loadSpots, loadTracks, newId, saveRoutes, saveSpots, saveTrackPoints, saveTracks, type SavedSpot } from '../storage';
import { exportAllGPX, pickAndParse } from '../io/transfer';
import { findDuplicates, type Imported } from '../io/gpx';
import { trackStats } from '../nav';
import { ScreenHeader, Btn } from '../components/ui';
import { track } from '../analytics';
import type { PickRequest } from './MapScreen';

type Item = { key: string; kind: 'spot' | 'saved'; name: string; sub: string; lat: number; lon: number; id?: string };

export function SpotsScreen({ mySpots, onPick, onImported }: { mySpots: SavedSpot[]; onPick: (p: NonNullable<PickRequest>) => void; onImported: () => void }) {
  const st = useSt();
  const [preview, setPreview] = useState<{ fileName: string; data: Imported } | null>(null);
  const startImport = async () => {
    try { const r = await pickAndParse(); if (r) setPreview(r); }
    catch (e: any) { Alert.alert('Could not read file', e?.message ?? String(e)); }
  };
  const doExport = async () => {
    try { await exportAllGPX(); track('export_done'); } catch (e: any) { Alert.alert('Export failed', e?.message ?? String(e)); }
  };
  if (preview) return <ImportPreview p={preview} mySpots={mySpots} onDone={(msg) => { setPreview(null); onImported(); if (msg) Alert.alert('Imported', msg); }} />;
  const [pub, setPub] = useState<any>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'mine' | 'known'>('mine');
  useEffect(() => { loadPublicSpots().then(setPub); }, []);
  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list: Item[] = tab === 'mine'
      ? mySpots.map((s) => ({ key: s.id, kind: 'saved', id: s.id, name: s.name, sub: `Private · saved ${new Date(s.createdAt).toLocaleDateString()}`, lat: s.lat, lon: s.lon }))
      : (pub?.features ?? []).map((f: any) => ({ key: String(f.properties.id), kind: 'spot', id: f.properties.id, name: f.properties.name, sub: f.properties.subtitle ?? '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
    return list.filter((i) => !term || i.name.toLowerCase().includes(term)).sort((a, b) => a.name.localeCompare(b.name));
  }, [tab, q, mySpots, pub]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Spots" subtitle="Your private spots and known fishing spots" />
      <View style={st.root}>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
        <Btn label="Import" icon="download-outline" onPress={startImport} />
        <Btn label="Export" icon="share-outline" onPress={doExport} />
      </View>
      <View style={st.seg}>
        {(['mine', 'known'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[st.segB, tab === k && st.segOn]}>
            <Text style={[st.segT, tab === k && { color: colors.accentInk }]}>{k === 'mine' ? `My spots (${mySpots.length})` : 'Known spots'}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="Filter by name" placeholderTextColor={colors.muted} style={st.input} />
      <FlatList data={items} keyExtractor={(i) => i.key}
        ListEmptyComponent={<Text style={st.empty}>{tab === 'mine' ? 'No saved spots yet. Long-press the map to drop a pin and save it.' : 'Known spots appear here once licensed spot data is loaded.'}</Text>}
        renderItem={({ item }) => (
          <Pressable style={st.row} onPress={() => onPick({ kind: item.kind, pt: { lat: item.lat, lon: item.lon, name: item.name, subtitle: item.sub, id: item.id } })}>
            <Text style={[st.dot, { color: item.kind === 'saved' ? colors.live : colors.accent }]}>●</Text>
            <View style={{ flex: 1 }}><Text style={st.name}>{item.name}</Text><Text style={st.sub}>{item.sub}</Text></View>
            <Text style={st.go}>Show ›</Text>
          </Pressable>
        )} />
      </View>
    </View>
  );
}

function ImportPreview({ p, mySpots, onDone }: { p: { fileName: string; data: Imported }; mySpots: SavedSpot[]; onDone: (msg?: string) => void }) {
  const st = useSt();
  const [folder, setFolder] = useState(p.fileName);
  const [skipDupes, setSkipDupes] = useState(true);
  const dupes = useMemo(() => findDuplicates(p.data.points, mySpots), [p, mySpots]);
  const nDupes = dupes.filter(Boolean).length;
  const routes = p.data.lines.filter((l) => l.kind === 'route');
  const tracks = p.data.lines.filter((l) => l.kind === 'track');
  const go = async () => {
    const now = Date.now();
    const add = p.data.points.filter((_, i) => !(skipDupes && dupes[i]))
      .map((x) => ({ id: newId(), name: x.name, lat: x.lat, lon: x.lon, createdAt: now, folder: folder.trim() || undefined, notes: x.desc }));
    await saveSpots([...(await loadSpots()), ...add]);       // never overwrites: only adds
    if (routes.length) await saveRoutes([...routes.map((r) => ({ id: newId(), name: r.name, points: r.points, createdAt: now })), ...(await loadRoutes())]);
    if (tracks.length) {
      const metas = await loadTracks();
      for (const t of tracks) {
        const id = newId();
        const pts = t.points.map((x, i) => ({ lat: x.lat, lon: x.lon, t: now + i, sog: null }));
        await saveTrackPoints(id, pts);
        const st = trackStats(pts);
        metas.unshift({ id, name: `${t.name} (imported)`, startedAt: now, endedAt: now, distanceNm: st.distanceNm, maxKt: 0, avgMovingKt: 0, points: pts.length });
      }
      await saveTracks(metas);
    }
    track('import_done', { spots: add.length, routes: routes.length, tracks: tracks.length });
    onDone(`${add.length} spot${add.length === 1 ? '' : 's'}${routes.length ? `, ${routes.length} route${routes.length === 1 ? '' : 's'}` : ''}${tracks.length ? `, ${tracks.length} track${tracks.length === 1 ? '' : 's'}` : ''} added to "${folder}". Private to you.`);
  };
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Text style={st.h1}>Import preview</Text>
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 40 }}>
        <Text style={st.sub}>{p.data.points.length} spots · {routes.length} routes · {tracks.length} tracks{p.data.warnings.length ? ` · ${p.data.warnings.length} skipped` : ''}</Text>
        <Text style={st.sub}>Folder</Text>
        <TextInput value={folder} onChangeText={setFolder} style={st.input} placeholderTextColor={colors.muted} />
        {nDupes ? (
          <View style={{ gap: 6 }}>
            <Text style={[st.sub, { color: colors.accent }]}>{nDupes} look like spots you already have (same place, or same name nearby).</Text>
            <View style={st.seg}>
              <Pressable onPress={() => setSkipDupes(true)} style={[st.segB, skipDupes && st.segOn]}><Text style={[st.segT, skipDupes && { color: colors.accentInk }]}>Skip them</Text></Pressable>
              <Pressable onPress={() => setSkipDupes(false)} style={[st.segB, !skipDupes && st.segOn]}><Text style={[st.segT, !skipDupes && { color: colors.accentInk }]}>Add as copies</Text></Pressable>
            </View>
          </View>
        ) : null}
        {p.data.points.slice(0, 60).map((x, i) => (
          <View key={i} style={st.row}>
            <Text style={[st.dot, { color: dupes[i] ? colors.accent : colors.live }]}>●</Text>
            <View style={{ flex: 1 }}><Text style={st.name}>{x.name}</Text><Text style={st.sub}>{x.lat.toFixed(5)}, {x.lon.toFixed(5)}{dupes[i] ? ` · matches "${dupes[i]!.name}"` : ''}</Text></View>
          </View>
        ))}
        {p.data.points.length > 60 ? <Text style={st.sub}>…and {p.data.points.length - 60} more</Text> : null}
        <Text style={st.sub}>Imported spots are private. Existing spots are never changed or overwritten.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label="Cancel" onPress={() => onDone()} />
          <Btn label="Import" kind="primary" onPress={go} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginVertical: 8 },
  seg: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  segB: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segT: { color: colors.text, fontWeight: '600' },
  input: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 12, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min + 8, borderBottomWidth: 1, borderColor: colors.line },
  dot: { fontSize: 14 },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12.5 },
  go: { color: colors.live, fontSize: 14 },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
}));
