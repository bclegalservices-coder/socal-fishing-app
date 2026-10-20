// Log Catch (spec §8): conditions are captured automatically; the angler picks species, numbers,
// technique, bait and — most important — who gets to see where it was.
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { colors, touch, makeStyles } from '../theme';
import { formatLatLon } from '../geo';
import { BAITS, SPECIES, TECHNIQUES } from '../community/species';
import { newClientId, queueCatch, type LocationMode } from '../community/catchApi';
import { cachedGroups } from '../community/groupsApi';
import { Btn } from './ui';
import { track } from '../analytics';

type Props = { lat: number; lon: number; nearestSpot?: { id: string; name: string } | null; depthFt?: number | null; onDone: (msg: string) => void; onCancel: () => void };

const MODES: { key: LocationMode; title: string; sub: string }[] = [
  { key: 'approximate', title: 'Approximate', sub: 'Public pin moved 0.5–1.5 NM. Your exact numbers stay private.' },
  { key: 'area', title: 'Area only', sub: 'Shows a named area or spot, no coordinates.' },
  { key: 'exact', title: 'Exact', sub: 'Public pin at the true position.' },
  { key: 'private', title: 'Private', sub: 'Only in your private log. Not on the public map.' },
];

export function LogCatchSheet({ lat, lon, nearestSpot, depthFt, onDone, onCancel }: Props) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const [species, setSpecies] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [weight, setWeight] = useState('');
  const [length, setLength] = useState('');
  const [kept, setKept] = useState<boolean | null>(null);
  const [technique, setTechnique] = useState<string | null>(null);
  const [bait, setBait] = useState<string | null>(null);
  const [baitOther, setBaitOther] = useState('');
  const [fishDepth, setFishDepth] = useState('');
  const [waterDepth, setWaterDepth] = useState(depthFt ? String(Math.round(depthFt)) : '');
  const [marks, setMarks] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<{ uri: string; live: boolean }[]>([]);
  const [mode, setMode] = useState<LocationMode>('approximate');
  const [anon, setAnon] = useState(false);
  const [area, setArea] = useState(nearestSpot?.name ?? '');
  const [showPhotos, setShowPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [toGroups, setToGroups] = useState<string[]>([]);
  useEffect(() => { cachedGroups().then(setGroups).catch(() => {}); }, []);

  const addPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', camera ? 'Allow camera access to take catch photos.' : 'Allow photo access to add a picture.'); return; }
    const r = camera ? await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, exif: false, mediaTypes: ['images'] as any });
    if (!r.canceled && r.assets?.[0]) setPhotos((p) => [...p, { uri: r.assets[0].uri, live: camera }].slice(0, 4));
  };

  const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));
  const save = async () => {
    if (!species) { Alert.alert('Pick a species'); return; }
    if (mode === 'area' && !area.trim() && !nearestSpot) { Alert.alert('Name the area', 'e.g. "Catalina East End" — or pick another privacy option.'); return; }
    setBusy(true);
    try {
      const r = await queueCatch({
        client_id: newClientId(), species_code: species, caught_at: new Date().toISOString(), lat, lon,
        location_mode: mode, anonymous: anon, area_name: mode === 'area' ? (area.trim() || nearestSpot?.name || null) : (nearestSpot?.name ?? null),
        spot_id: mode === 'area' && nearestSpot && (!area.trim() || area.trim() === nearestSpot.name) ? nearestSpot.id : null,
        quantity: qty, weight_lb: num(weight), length_in: num(length), kept, technique,
        bait: bait === 'Other' ? (baitOther.trim() || 'Other') : bait,
        fishing_depth_ft: num(fishDepth), water_depth_ft: num(waterDepth), meter_marks: marks.trim() || null, notes: notes.trim() || null,
        photos, show_photos_public: showPhotos, share_groups: toGroups,
      });
      track('catch_logged', { species: species, mode, photos: photos.length, offline: !r.sent });
      if (toGroups.length) track('group_catch_shared', { groups: toGroups.length });
      onDone(r.sent ? 'Catch saved and sent.' : r.signedIn ? 'Catch saved. It will send when you\'re back in range.' : 'Catch saved on this phone. Sign in (Profile tab) to back it up and share it.');
    } catch (e: any) {
      Alert.alert('Not saved', e?.message ?? String(e));
    } finally { setBusy(false); }
  };

  const Chip = ({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color?: string }) => { const st = useSt(); return ((
    <Pressable onPress={onPress} style={[st.chip, on && { backgroundColor: color ?? colors.accent, borderColor: color ?? colors.accent }]}>
      <Text style={[st.chipT, on && { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  )); };

  return (
    <View style={[st.sheet, { top: insets.top + 56 }]}>
      <View style={st.head}>
        <Text style={st.h1}>Log catch</Text>
        <Pressable onPress={onCancel} style={st.x} accessibilityLabel="Cancel"><Text style={st.xT}>✕</Text></Pressable>
      </View>
      <Text style={st.sub}>{formatLatLon(lat, lon)} · now · water temp, chlorophyll, tide, wind, depth and moon are added automatically</Text>
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View><Text style={st.label}>Species</Text>
          <View style={st.wrap}>{SPECIES.map((s) => <Chip key={s.code} label={s.name} on={species === s.code} onPress={() => setSpecies(s.code)} color={s.color} />)}</View></View>

        <View style={st.row}>
          <View style={{ flex: 1 }}><Text style={st.label}>How many</Text>
            <View style={st.stepper}>
              <Pressable style={st.step} onPress={() => setQty(Math.max(1, qty - 1))}><Text style={st.stepT}>−</Text></Pressable>
              <Text style={st.qty}>{qty}</Text>
              <Pressable style={st.step} onPress={() => setQty(Math.min(500, qty + 1))}><Text style={st.stepT}>+</Text></Pressable>
            </View></View>
          <View style={{ flex: 1 }}><Text style={st.label}>Weight (lb)</Text><TextInput style={st.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="est." placeholderTextColor={colors.muted} /></View>
          <View style={{ flex: 1 }}><Text style={st.label}>Length (in)</Text><TextInput style={st.input} value={length} onChangeText={setLength} keyboardType="decimal-pad" placeholder="opt." placeholderTextColor={colors.muted} /></View>
        </View>
        <View style={st.wrap}><Chip label="Kept" on={kept === true} onPress={() => setKept(kept === true ? null : true)} /><Chip label="Released" on={kept === false} onPress={() => setKept(kept === false ? null : false)} /></View>

        <View><Text style={st.label}>Technique</Text><View style={st.wrap}>{TECHNIQUES.map((t) => <Chip key={t} label={t} on={technique === t} onPress={() => setTechnique(technique === t ? null : t)} />)}</View></View>
        <View><Text style={st.label}>Bait / lure</Text><View style={st.wrap}>{BAITS.map((b) => <Chip key={b} label={b} on={bait === b} onPress={() => setBait(bait === b ? null : b)} />)}</View>
          {bait === 'Other' || bait === 'Jig' || bait === 'Artificial lure' ? <TextInput style={[st.input, { marginTop: 6 }]} value={baitOther} onChangeText={setBaitOther} placeholder="Which one? (optional)" placeholderTextColor={colors.muted} /> : null}</View>

        <View style={st.row}>
          <View style={{ flex: 1 }}><Text style={st.label}>Fishing depth (ft)</Text><TextInput style={st.input} value={fishDepth} onChangeText={setFishDepth} keyboardType="number-pad" placeholderTextColor={colors.muted} placeholder="opt." /></View>
          <View style={{ flex: 1 }}><Text style={st.label}>Water depth (ft)</Text><TextInput style={st.input} value={waterDepth} onChangeText={setWaterDepth} keyboardType="number-pad" placeholderTextColor={colors.muted} placeholder="opt." /></View>
        </View>
        <View><Text style={st.label}>Meter marks</Text><TextInput style={st.input} value={marks} onChangeText={setMarks} placeholder="e.g. marks at 40–60 ft" placeholderTextColor={colors.muted} /></View>
        <View><Text style={st.label}>Notes</Text><TextInput style={[st.input, { height: 70 }]} multiline value={notes} onChangeText={setNotes} placeholderTextColor={colors.muted} placeholder="optional" /></View>

        <View><Text style={st.label}>Photos (GPS and camera data are removed before upload)</Text>
          <View style={st.wrap}>
            {photos.map((p, i) => (
              <Pressable key={i} onLongPress={() => setPhotos(photos.filter((_, j) => j !== i))}><Image source={{ uri: p.uri }} style={st.thumb} /></Pressable>
            ))}
            {photos.length < 4 ? <><Chip label="📷 Camera" on={false} onPress={() => addPhoto(true)} /><Chip label="🖼 Library" on={false} onPress={() => addPhoto(false)} /></> : null}
          </View>
          {photos.length ? <Text style={st.sub}>Long-press a photo to remove it. Camera photos taken now help your report get verified.</Text> : null}
        </View>

        <View style={st.privacy}>
          <Text style={[st.label, { color: colors.text }]}>Who sees where this was?</Text>
          {MODES.map((m) => (
            <Pressable key={m.key} onPress={() => setMode(m.key)} style={[st.mode, mode === m.key && st.modeOn]} accessibilityRole="radio" accessibilityState={{ checked: mode === m.key }}>
              <View style={[st.dot, mode === m.key && st.dotOn]} />
              <View style={{ flex: 1 }}><Text style={st.modeT}>{m.title}{m.key === 'approximate' ? '  ·  default' : ''}</Text><Text style={st.sub}>{m.sub}</Text></View>
            </Pressable>
          ))}
          {mode === 'area' ? <TextInput style={st.input} value={area} onChangeText={setArea} placeholder="Area name, e.g. Catalina East End" placeholderTextColor={colors.muted} /> : null}
          {mode !== 'private' ? (
            <>
              <View style={st.switchRow}><Text style={st.modeT}>Post anonymously</Text><Switch value={anon} onValueChange={setAnon} /></View>
              {photos.length ? <View style={st.switchRow}><Text style={st.modeT}>Show photos on the public report</Text><Switch value={showPhotos} onValueChange={setShowPhotos} /></View> : null}
            </>
          ) : null}
          <Text style={st.sub}>Your saved private spots are never attached to reports.</Text>
        </View>
        {groups.length ? (
          <View style={st.privacy}>
            <Text style={[st.label, { color: colors.text }]}>Also send to my group (exact spot)</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {groups.map((g) => {
                const on = toGroups.includes(g.id);
                return (
                  <Pressable key={g.id} onPress={() => setToGroups(on ? toGroups.filter((x) => x !== g.id) : [...toGroups, g.id])}
                    style={[st.mode, { flex: 0, paddingVertical: 8 }, on && st.modeOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                    <Text style={st.modeT}>{on ? '✓ ' : ''}{g.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={st.sub}>Only members of the groups you pick see where this was — even if the catch is Private on the public map. Sends when you have signal.</Text>
          </View>
        ) : null}
        <Btn label={busy ? 'Saving…' : 'Save catch'} kind="primary" onPress={save} disabled={busy || !species} />
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 60, backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 10, zIndex: 30 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700' },
  x: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  xT: { color: colors.text, fontSize: 18 },
  sub: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 14 },
  row: { flexDirection: 'row', gap: 10 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  step: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepT: { color: colors.text, fontSize: 22 },
  qty: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 18, fontWeight: '700' },
  thumb: { width: 72, height: 72, borderRadius: 10 },
  privacy: { gap: 8, borderWidth: 1, borderColor: colors.live, borderRadius: 14, padding: 12 },
  mode: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: touch.min, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10 },
  modeOn: { borderColor: colors.accent, backgroundColor: colors.warnBg },
  modeT: { color: colors.text, fontSize: 15, fontWeight: '600' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.muted },
  dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
}));
