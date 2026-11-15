import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, touch, makeStyles } from '../theme';
import { SPOT_COLORS } from '../layers/spotColors';
import { loadPublicSpots, loadRoutes, loadSpots, loadTracks, newId, saveRoutes, saveSpots, saveTrackPoints, saveTracks, type SavedSpot } from '../storage';
import { exportAllGPX, exportSpotsGPX, pickAndParse } from '../io/transfer';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { distanceNm } from '../geo';
import { fmtDist, useUnits } from '../units';
import { findDuplicates, mergeRepeats, type Imported } from '../io/gpx';
import { trackStats } from '../nav';
import { ScreenHeader, Btn, Segmented } from '../components/ui';
import { track } from '../analytics';
import type { PickRequest } from './MapScreen';
import { friendly } from '../friendly';
import { spotSub } from '../spotText';

type Item = { key: string; kind: 'spot' | 'saved'; name: string; sub: string; lat: number; lon: number; id?: string; folder?: string; createdAt?: number; distNm?: number | null };
type SortKey = 'name' | 'folder' | 'date' | 'distance';

export function SpotsScreen({ mySpots, onPick, onImported }: { mySpots: SavedSpot[]; onPick: (p: NonNullable<PickRequest>) => void; onImported: () => void }) {
  const st = useSt();
  const u = useUnits();
  // (all state first: React needs the same hooks on every render, so nothing returns early above this line)
  const [preview, setPreview] = useState<{ fileName: string; data: Imported } | null>(null);
  const [pub, setPub] = useState<any>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'mine' | 'known'>('mine');
  const [sort, setSort] = useState<SortKey>('name');
  const [me, setMe] = useState<{ lat: number; lon: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => { loadPublicSpots().then(setPub); }, []);
  useEffect(() => { Location.getLastKnownPositionAsync().then((p) => p && setMe({ lat: p.coords.latitude, lon: p.coords.longitude })).catch(() => {}); }, []);
  useEffect(() => { setSelecting(false); setPicked(new Set()); }, [tab]);

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const dist = (lat: number, lon: number) => (me ? distanceNm(me.lat, me.lon, lat, lon) : null);
    const list: Item[] = tab === 'mine'
      ? mySpots.map((s) => ({ key: s.id, kind: 'saved', id: s.id, name: s.name, folder: s.folder, createdAt: s.createdAt, lat: s.lat, lon: s.lon, distNm: dist(s.lat, s.lon),
          sub: `${s.folder ? `${s.folder} · ` : ''}${new Date(s.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` }))
      : (pub?.features ?? []).map((f: any) => ({ key: String(f.properties.id), kind: 'spot', id: f.properties.id, name: f.properties.name, sub: spotSub(f.properties.subtitle),
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], distNm: dist(f.geometry.coordinates[1], f.geometry.coordinates[0]) }));
    const shown = list.filter((i) => !term || i.name.toLowerCase().includes(term) || (i.folder ?? '').toLowerCase().includes(term));
    const by: Record<SortKey, (a: Item, b: Item) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      folder: (a, b) => (a.folder ?? '~').localeCompare(b.folder ?? '~') || a.name.localeCompare(b.name, undefined, { numeric: true }),
      date: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      distance: (a, b) => (a.distNm ?? 1e9) - (b.distNm ?? 1e9),
    };
    return shown.sort(by[sort]);
  }, [tab, q, mySpots, pub, sort, me]);

  if (preview) return <ImportPreview p={preview} mySpots={mySpots} onDone={(msg) => { setPreview(null); onImported(); if (msg) Alert.alert('Imported', msg); }} />;

  const startImport = async () => {
    try { const r = await pickAndParse(); if (r) setPreview(r); }
    catch (e: any) { Alert.alert('Could not read file', friendly(e)); }
  };
  const doExport = async () => {
    try { await exportAllGPX(); track('export_done'); } catch (e: any) { Alert.alert('Export failed', friendly(e)); }
  };
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = items.length > 0 && items.every((i) => picked.has(i.key));
  const chosen = () => mySpots.filter((s) => picked.has(s.id));
  const shareChosen = async () => {
    const list = chosen(); if (!list.length) return;
    try { await exportSpotsGPX(list); track('spots_shared', { n: list.length }); } catch (e: any) { Alert.alert('Could not share', friendly(e)); }
  };
  const deleteChosen = () => {
    const n = picked.size; if (!n) return;
    Alert.alert(`Delete ${n} spot${n === 1 ? '' : 's'}?`, 'They will be removed from this phone. Tip: share them first to keep a copy.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await saveSpots((await loadSpots()).filter((s) => !picked.has(s.id)));
        setPicked(new Set()); setSelecting(false); onImported(); track('spots_deleted', { n });
      } },
    ]);
  };
  const distText = (nm: number | null | undefined) => (nm == null ? '' : fmtDist(nm, u));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {selecting ? (
        <ScreenHeader title={`${picked.size} selected`} subtitle={`of ${items.length} spots`}
          right={<Pressable onPress={() => { setSelecting(false); setPicked(new Set()); }} style={st.hdrBtn} accessibilityRole="button"><Text style={st.hdrBtnT}>Cancel</Text></Pressable>} />
      ) : (
        <ScreenHeader title="Spots" subtitle="Your private spots and known fishing spots"
          right={tab === 'mine' && mySpots.length ? <Pressable onPress={() => setSelecting(true)} style={st.hdrBtn} accessibilityRole="button"><Text style={st.hdrBtnT}>Select</Text></Pressable> : undefined} />
      )}
      <View style={st.root}>
      {!selecting ? (
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
          <Btn label="Import" icon="download-outline" onPress={startImport} />
          <Btn label="Export all" icon="share-outline" onPress={doExport} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
          <Btn label={allShown ? 'Deselect all' : `Select all (${items.length})`} icon={allShown ? 'square-outline' : 'checkbox-outline'}
            onPress={() => setPicked(allShown ? new Set() : new Set(items.map((i) => i.key)))} />
        </View>
      )}
      {!selecting ? (
        <View style={{ marginBottom: 10 }}>
          <Segmented value={tab} onChange={setTab} options={[{ key: 'mine', label: `My spots (${mySpots.length})`, icon: 'star' }, { key: 'known', label: 'Known spots', icon: 'location' }]} />
        </View>
      ) : null}
      <View style={st.searchRow}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search name or folder" placeholderTextColor={colors.faint} style={st.search} autoCorrect={false} />
        {q ? <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
      </View>
      <View style={st.sortRow}>
        <Text style={st.sortLbl}>Sort</Text>
        <View style={{ flex: 1 }}>
          <Segmented value={sort} onChange={setSort}
            options={((tab === 'mine' ? ['name', 'folder', 'date', 'distance'] : ['name', 'distance']) as SortKey[]).map((k) => ({ key: k, label: { name: 'Name', folder: 'Folder', date: 'Date', distance: 'Near' }[k] }))} />
        </View>
      </View>
      <View style={st.legend}>
        <View style={[st.legDot, { backgroundColor: SPOT_COLORS.mine }]} /><Text style={st.legT}>My spots</Text>
        <View style={[st.legDot, { backgroundColor: SPOT_COLORS.known, marginLeft: 14 }]} /><Text style={st.legT}>Known spots</Text>
        <Text style={[st.legT, { marginLeft: 'auto' }]}>Hide either in Layers</Text>
      </View>
      <FlatList data={items} keyExtractor={(i) => i.key} contentContainerStyle={{ paddingBottom: selecting ? 110 : 20 }}
        ListEmptyComponent={<Text style={st.empty}>{tab === 'mine' ? (q ? `No spots match "${q}".` : 'No saved spots yet. Long-press the map to drop a pin and save it, or Import your spots from Navionics or a chartplotter.') : 'Known spots appear here once licensed spot data is loaded.'}</Text>}
        renderItem={({ item }) => {
          const on = picked.has(item.key);
          return (
            <Pressable style={st.row}
              onPress={() => (selecting ? toggle(item.key) : onPick({ kind: item.kind, pt: { lat: item.lat, lon: item.lon, name: item.name, subtitle: item.sub, id: item.id } }))}
              onLongPress={() => { if (tab === 'mine') { setSelecting(true); toggle(item.key); } }}
              accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked: on } : undefined}>
              {selecting ? <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={26} color={on ? colors.accent : colors.faint} />
                : <Text style={[st.dot, { color: item.kind === 'saved' ? SPOT_COLORS.mine : SPOT_COLORS.known }]}>●</Text>}
              <View style={{ flex: 1 }}><Text style={st.name}>{item.name}</Text><Text style={st.sub}>{item.sub}</Text></View>
              {item.distNm != null ? <Text style={st.dist}>{distText(item.distNm)}</Text> : null}
              {!selecting ? <Ionicons name="chevron-forward" size={18} color={colors.faint} /> : null}
            </Pressable>
          );
        }} />
      </View>
      {selecting ? (
        <View style={st.selBar}>
          <Pressable onPress={shareChosen} disabled={!picked.size} style={[st.selBtn, !picked.size && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Share selected spots">
            <Ionicons name="share-outline" size={22} color={colors.accent} /><Text style={[st.selT, { color: colors.accent }]}>Share</Text>
          </Pressable>
          <Text style={st.selN}>{picked.size} selected</Text>
          <Pressable onPress={deleteChosen} disabled={!picked.size} style={[st.selBtn, !picked.size && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Delete selected spots">
            <Ionicons name="trash-outline" size={22} color={colors.alert} /><Text style={[st.selT, { color: colors.alert }]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ImportPreview({ p, mySpots, onDone }: { p: { fileName: string; data: Imported }; mySpots: SavedSpot[]; onDone: (msg?: string) => void }) {
  const st = useSt();
  const [folder, setFolder] = useState(p.fileName.replace(/_/g, ' '));
  const [skipDupes, setSkipDupes] = useState(true);
  const [merge, setMerge] = useState(true);
  const merged = useMemo(() => mergeRepeats(p.data.points), [p]);
  const points = merge ? merged : p.data.points;
  const repeats = p.data.points.length - merged.length;
  const dupes = useMemo(() => findDuplicates(points, mySpots), [points, mySpots]);
  const nDupes = dupes.filter(Boolean).length;
  const routes = p.data.lines.filter((l) => l.kind === 'route');
  const tracks = p.data.lines.filter((l) => l.kind === 'track');
  const go = async () => {
    const now = Date.now();
    const add = points.filter((_, i) => !(skipDupes && dupes[i]))
      .map((x) => ({ id: newId(), name: x.name, lat: x.lat, lon: x.lon, createdAt: x.time ?? now, folder: folder.trim() || undefined, notes: x.desc }));
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
    track('import_done', { spots: add.length, routes: routes.length, tracks: tracks.length, merged: merge ? repeats : 0 });
    onDone(`${add.length} spot${add.length === 1 ? '' : 's'}${routes.length ? `, ${routes.length} route${routes.length === 1 ? '' : 's'}` : ''}${tracks.length ? `, ${tracks.length} track${tracks.length === 1 ? '' : 's'}` : ''} added to "${folder}". Private to you.`);
  };
  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <Text style={st.h1}>Import preview</Text>
      <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 40 }}>
        <Text style={st.sub}>{p.data.points.length} spots · {routes.length} routes · {tracks.length} tracks{p.data.warnings.length ? ` · ${p.data.warnings.length} skipped` : ''}</Text>
        {repeats ? (
          <View style={{ gap: 6 }}>
            <Text style={[st.sub, { color: colors.accent }]}>{repeats} are repeats of the same place in this file (saved twice by a double tap). Merging keeps one per place, with its real name and original date.</Text>
            <View style={st.seg}>
              <Pressable onPress={() => setMerge(true)} style={[st.segB, merge && st.segOn]}><Text style={[st.segT, merge && { color: colors.accentInk }]}>Merge ({merged.length})</Text></Pressable>
              <Pressable onPress={() => setMerge(false)} style={[st.segB, !merge && st.segOn]}><Text style={[st.segT, !merge && { color: colors.accentInk }]}>Keep all ({p.data.points.length})</Text></Pressable>
            </View>
          </View>
        ) : null}
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
        {points.slice(0, 60).map((x, i) => (
          <View key={i} style={st.row}>
            <Text style={[st.dot, { color: dupes[i] ? colors.faint : SPOT_COLORS.mine }]}>●</Text>
            <View style={{ flex: 1 }}><Text style={st.name}>{x.name}</Text><Text style={st.sub}>{x.lat.toFixed(5)}, {x.lon.toFixed(5)}{dupes[i] ? ` · matches "${dupes[i]!.name}"` : ''}</Text></View>
          </View>
        ))}
        {points.length > 60 ? <Text style={st.sub}>…and {points.length - 60} more</Text> : null}
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
  segB: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  input: { height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, marginBottom: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid, marginBottom: 10 },
  search: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  sortLbl: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 2 },
  legDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: '#FFFFFF' },
  legT: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min + 8, borderBottomWidth: 1, borderColor: colors.line },
  dot: { fontSize: 14 },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12.5 },
  go: { color: colors.faint, fontSize: 20 },
  dist: { color: colors.muted, fontSize: 13.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sortB: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  sortT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  hdrBtn: { borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid, borderRadius: 19, paddingHorizontal: 16, minHeight: 38, justifyContent: 'center' },
  hdrBtnT: { color: colors.text, fontWeight: '700', fontSize: 15 },
  selBar: { position: 'absolute', left: 12, right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.panelSolid,
    borderWidth: 1, borderColor: colors.border, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 6, shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
  selBtn: { alignItems: 'center', justifyContent: 'center', minWidth: 80, minHeight: touch.min, gap: 2 },
  selT: { fontSize: 13, fontWeight: '700' },
  selN: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
}));
