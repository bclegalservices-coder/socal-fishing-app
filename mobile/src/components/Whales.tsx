// Whale sightings (Nov 2): log one from the + menu (quick species picker like Log a catch), see them on the map as
// whale pins colored by age (same neon colors as catches), tap one for the details.
// Nov 3: the whale is our own humpback silhouette icon (WhaleIcon), not the 🐋 emoji.
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import { formatLatLon } from '../geo';
import { Btn, Chip, Note, Sheet, SmallBtn, Title } from './ui';
import { agoShort, catchAge } from './CatchMap';
import { WhaleIcon } from './WhaleIcon';
import { BEHAVIORS, WHALES, behaviorName, deleteWhale, logWhale, whaleName, whalesIn, type Sighting } from '../community/whaleApi';
import { friendly } from '../friendly';
import { track } from '../analytics';

/** Sightings in the visible area (last 3 days), refreshed when the map moves and every 2 minutes. */
export function useWhales(on: boolean, view: { minLon: number; minLat: number; maxLon: number; maxLat: number } | null, bump: number) {
  const [rows, setRows] = useState<Sighting[]>([]);
  const key = view ? [view.minLon, view.minLat, view.maxLon, view.maxLat].map((v) => v.toFixed(2)).join(',') : '';
  const viewRef = useRef(view); viewRef.current = view;
  useEffect(() => {
    if (!on || !viewRef.current) { if (!on) setRows([]); return; }
    let alive = true;
    const load = () => { const v = viewRef.current; if (v) whalesIn(v).then((r) => { if (alive) setRows(r); }).catch(() => {}); };
    const t0 = setTimeout(load, 400);
    const t = setInterval(load, 120000);
    return () => { alive = false; clearTimeout(t0); clearInterval(t); };
  }, [on, key, bump]);
  return rows;
}

export function WhaleMarkers({ rows, night, onPress }: { rows: Sighting[]; night?: boolean; onPress: (w: Sighting) => void }) {
  const now = Date.now();
  return (
    <>
      {rows.map((w) => {
        const h = (now - new Date(w.seen_at).getTime()) / 3600000;
        const a = catchAge(h);
        return (
          <Marker key={`whale-${w.id}`} lngLat={[w.lon, w.lat]} anchor="bottom">
            <Pressable onPress={() => onPress(w)} hitSlop={6} style={[s.wrap, a.maxH === Infinity && { opacity: 0.62 }]} accessibilityRole="button"
              accessibilityLabel={`${whaleName(w.species, w.other_name)} sighting, ${agoShort(h)} ago. Tap for details.`}>
              <View style={[s.glow, { shadowColor: a.color }]}>
                <View style={[s.bubble, { backgroundColor: a.color, borderColor: night ? '#0B1B2E' : '#FFFFFF' }]}>
                  <WhaleIcon size={24} color={night ? '#0B1B2E' : '#FFFFFF'} />
                </View>
              </View>
              {w.how_many > 1 ? <View style={[s.count, { borderColor: a.color }]}><Text style={s.countT}>{w.how_many}</Text></View> : null}
              <View style={[s.tag, { backgroundColor: a.color }]}><Text style={[s.tagT, { color: a.ink }]}>{agoShort(h)}</Text></View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

export function WhaleCard({ w, onClose, onDeleted }: { w: Sighting; onClose: () => void; onDeleted: () => void }) {
  const st = useSt();
  const h = (Date.now() - new Date(w.seen_at).getTime()) / 3600000;
  const when = new Date(w.seen_at);
  const del = () => Alert.alert('Delete this sighting?', undefined, [{ text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => deleteWhale(w.id).then(onDeleted).catch((e) => Alert.alert('Not deleted', friendly(e))) }]);
  return (
    <Sheet onClose={onClose}>
      <View style={st.headRow}>
        <WhaleIcon size={28} color={colors.accent} />
        <Title>{w.how_many > 1 ? `${w.how_many} × ` : ''}{whaleName(w.species, w.other_name)}</Title>
      </View>
      <Note>{agoShort(h)} ago · {when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Note>
      <View style={{ gap: 4 }}>
        {behaviorName(w.behavior) ? <Text style={st.line}>Behavior: {behaviorName(w.behavior)}</Text> : null}
        <Text style={st.line}>Where: {formatLatLon(w.lat, w.lon)}</Text>
        {w.notes ? <Text style={st.line}>Notes: {w.notes}</Text> : null}
        <Text style={st.sub}>Logged by {w.author_name ?? 'an angler'}. Keep at least 100 yards from whales (federal law).</Text>
      </View>
      {w.mine ? <View style={{ flexDirection: 'row' }}><SmallBtn icon="trash-outline" tone="danger" label="Delete" onPress={del} /></View> : null}
    </Sheet>
  );
}

/** The log form (opened from the + menu). The position must be on the water — checked before this opens. */
export function LogWhaleSheet({ lat, lon, onDone, onCancel }: { lat: number; lon: number; onDone: (msg: string) => void; onCancel: () => void }) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const [species, setSpecies] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [n, setN] = useState(1);
  const [behavior, setBehavior] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!species) { Alert.alert('Pick which whale'); return; }
    setBusy(true);
    try {
      await logWhale({ species, other_name: other, how_many: n, behavior, lat, lon, notes });
      track('whale_logged', { species });
      onDone('Whale sighting logged.');
    } catch (e: any) { Alert.alert('Not saved', friendly(e)); } finally { setBusy(false); }
  };
  return (
    <View style={[st.sheet, { top: insets.top + 56 }]}>
      <View style={st.headRow}>
        <Text style={[st.h1, { flex: 1 }]}>Log a whale sighting</Text>
        <Pressable onPress={onCancel} style={st.x} accessibilityRole="button" accessibilityLabel="Cancel"><Ionicons name="close" size={22} color={colors.text} /></Pressable>
      </View>
      <View style={st.where}><Ionicons name="location" size={16} color={colors.live} /><Text style={[st.sub, { flex: 1 }]}>{formatLatLon(lat, lon)} · now</Text></View>
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View><Text style={st.label}>Which whale</Text>
          <View style={st.wrap}>{WHALES.map((w) => <Chip key={w.key} label={w.name} on={species === w.key} onPress={() => setSpecies(w.key)} />)}</View>
          {species === 'other' ? <TextInput style={[st.input, { marginTop: 6 }]} value={other} onChangeText={setOther} placeholder="Which one? (optional)" placeholderTextColor={colors.muted} maxLength={40} /> : null}
        </View>
        <View><Text style={st.label}>How many</Text>
          <View style={st.stepper}>
            <Pressable style={st.step} onPress={() => setN(Math.max(1, n - 1))} accessibilityLabel="Fewer"><Text style={st.stepT}>−</Text></Pressable>
            <Text style={st.qty}>{n}</Text>
            <Pressable style={st.step} onPress={() => setN(Math.min(500, n + 1))} accessibilityLabel="More"><Text style={st.stepT}>+</Text></Pressable>
          </View></View>
        <View><Text style={st.label}>What were they doing? (optional)</Text>
          <View style={st.wrap}>{BEHAVIORS.map((b) => <Chip key={b.key} label={b.name} on={behavior === b.key} onPress={() => setBehavior(behavior === b.key ? null : b.key)} />)}</View></View>
        <View><Text style={st.label}>Notes (optional)</Text><TextInput style={[st.input, { height: 70 }]} multiline value={notes} onChangeText={setNotes} maxLength={500} placeholderTextColor={colors.muted} placeholder="e.g. heading north, lots of bait around" /></View>
        <Text style={st.sub}>Everyone can see whale sightings on the map for 3 days. Keep at least 100 yards away (federal law).</Text>
        <Btn label={busy ? 'Saving…' : 'Save sighting'} kind="primary" onPress={save} disabled={busy || !species} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4, paddingHorizontal: 6 },
  glow: { shadowOpacity: 0.95, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  bubble: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 3, backgroundColor: '#FFFFFF', borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  countT: { color: '#0A1A2A', fontSize: 10.5, fontWeight: '900' },
  tag: { marginTop: 3, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1 },
  tagT: { fontSize: 11.5, fontWeight: '900' },
});

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 10, zIndex: 30 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700' },
  x: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  where: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, marginTop: 4, marginBottom: 6, borderRadius: 10, backgroundColor: colors.inset },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 17 },
  line: { color: colors.text, fontSize: 14.5 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, maxWidth: 200 },
  step: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepT: { color: colors.text, fontSize: 22 },
  qty: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700' },
}));
