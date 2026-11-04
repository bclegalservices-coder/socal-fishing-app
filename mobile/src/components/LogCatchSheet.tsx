// Log Catch (spec §8): conditions are captured automatically; the angler picks species, numbers,
// technique, bait and — most important — who gets to see where it was.
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, makeStyles } from '../theme';
import { formatLatLon } from '../geo';
import { BAITS, FOUND_ON, PICKABLE_SPECIES, TECHNIQUES } from '../community/species';
import { newClientId, queueCatch, type LocationMode } from '../community/catchApi';
import { cachedGroups } from '../community/groupsApi';
import { Ionicons } from '@expo/vector-icons';
import { ChipSet, Disclosure, Field, FormCard, FormSheet, InfoLine, SaveBar, Segment, Stepper, TileGrid, ToggleRow } from './form';
import { track } from '../analytics';
import { friendly } from '../friendly';

type Props = { lat: number; lon: number; nearestSpot?: { id: string; name: string } | null; depthFt?: number | null; onDone: (msg: string) => void; onCancel: () => void };


export function LogCatchSheet({ lat, lon, nearestSpot, depthFt, onDone, onCancel }: Props) {
  const st = useSt();
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
  const [mode, setMode] = useState<LocationMode>('exact');
  const [foundOn, setFoundOn] = useState<string | null>(null);
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
        fishing_depth_ft: num(fishDepth), water_depth_ft: num(waterDepth), meter_marks: marks.trim() || null, notes: notes.trim() || null, found_on: foundOn,
        photos, show_photos_public: showPhotos, share_groups: toGroups,
      });
      track('catch_logged', { species: species, mode, photos: photos.length, offline: !r.sent });
      if (toGroups.length) track('group_catch_shared', { groups: toGroups.length });
      onDone(r.sent ? 'Catch saved and sent.' : r.signedIn ? 'Catch saved. It will send when you\'re back in range.' : 'Catch saved on this phone. Sign in (Profile tab) to back it up and share it.');
    } catch (e: any) {
      Alert.alert('Not saved', friendly(e));
    } finally { setBusy(false); }
  };

  // Nov 4: rebuilt with the shared form look (components/form.tsx): cards, a species grid, pinned Save.
  const [allOpen, setAllOpen] = useState(false);
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const top = TOP_SPECIES.map((c) => PICKABLE_SPECIES.find((s) => s.code === c)).filter(Boolean) as typeof PICKABLE_SPECIES;
  const picked = species ? PICKABLE_SPECIES.find((s) => s.code === species) : null;
  const shown = picked && !top.some((s) => s.code === picked.code) ? [picked, ...top.slice(0, 8)] : top;
  const tiles = shown.map((s) => ({ key: s.code, label: SHORT[s.code] ?? s.name, dot: s.color }));
  const list = PICKABLE_SPECIES.filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const modes = [
    { key: 'exact' as LocationMode, label: 'Exact', note: 'Everyone sees the exact spot on the catch map.' },
    { key: 'area' as LocationMode, label: 'Area', note: 'Shows a named area or spot, no coordinates.' },
    { key: 'private' as LocationMode, label: 'Only me', note: 'Saved to your log only. Not on the public map.' },
  ];
  const missing = !species ? 'Pick a species to save' : mode === 'area' && !area.trim() && !nearestSpot ? 'Name the area to save' : null;

  return (
    <FormSheet title="Log a catch" where={`${formatLatLon(lat, lon)} · Now`} hint="Water temp, tide, wind, depth and moon added for you" onClose={onCancel}
      footer={<SaveBar label="Save catch" missing={missing} busy={busy} onPress={save} />}>
      <FormCard label="Species" tag="Required">
        <TileGrid items={tiles} value={species} onChange={(k) => setSpecies(species === k ? null : k)} />
        <Pressable onPress={() => setAllOpen(!allOpen)} style={st.allBtn} accessibilityRole="button" accessibilityState={{ expanded: allOpen }}>
          <Ionicons name={allOpen ? 'chevron-up' : 'search'} size={15} color={colors.accent} />
          <Text style={st.allT}>{allOpen ? 'Hide the full list' : `All ${PICKABLE_SPECIES.length} species`}</Text>
        </Pressable>
        {allOpen ? (
          <View style={{ gap: 2 }}>
            <Field value={q} onChangeText={setQ} placeholder="Search species" />
            {list.map((s, i) => (
              <Pressable key={s.code} onPress={() => { setSpecies(s.code); setAllOpen(false); setQ(''); }} style={[st.listRow, i > 0 && st.listLine]} accessibilityRole="radio" accessibilityState={{ checked: species === s.code }}>
                <View style={[st.dot, { backgroundColor: s.color }]} />
                <Text style={st.listT}>{s.name}</Text>
                {species === s.code ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
      </FormCard>

      <FormCard label="Size" tag="Weight and length optional">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}><Text style={st.fieldL}>How many</Text><Stepper value={qty} onChange={setQty} max={500} wide /></View>
          <Field label="Weight" value={weight} onChangeText={setWeight} unit="lb" keyboardType="decimal-pad" />
          <Field label="Length" value={length} onChangeText={setLength} unit="in" keyboardType="decimal-pad" />
        </View>
        <ChipSet items={[{ key: 'kept', label: 'Kept' }, { key: 'released', label: 'Released' }]} value={kept === true ? 'kept' : kept === false ? 'released' : null}
          onChange={(k) => setKept(k === 'kept' ? (kept === true ? null : true) : (kept === false ? null : false))} />
      </FormCard>

      <FormCard label="Found on" tag="Optional">
        <ChipSet items={FOUND_ON} value={foundOn} onChange={(k) => setFoundOn(foundOn === k ? null : k)} />
      </FormCard>

      <FormCard label="Who sees the spot">
        <Segment options={modes} value={mode} onChange={setMode} />
        {mode === 'area' ? <Field value={area} onChangeText={setArea} placeholder="Area name, e.g. Catalina East End" /> : null}
        {mode !== 'private' ? <ToggleRow title="Post anonymously" value={anon} onChange={setAnon} last={!photos.length} /> : null}
        {mode !== 'private' && photos.length ? <ToggleRow title="Show photos on the public report" value={showPhotos} onChange={setShowPhotos} last /> : null}
      </FormCard>

      {groups.length ? (
        <FormCard label="Also send to my group" tag="Exact spot">
          <ChipSet items={groups.map((g) => ({ key: g.id, label: g.name, icon: toGroups.includes(g.id) ? 'checkbox' : 'square-outline' }))} value={toGroups}
            onChange={(id) => setToGroups(toGroups.includes(id) ? toGroups.filter((x) => x !== id) : [...toGroups, id])} />
          <Text style={st.sub}>Only members of the groups you pick see where this was, even if it's Only me on the public map.</Text>
        </FormCard>
      ) : null}

      <Disclosure title="More details" sub="Bait, technique, depth, notes, photos" open={more} onPress={() => setMore(!more)} />
      {more ? (
        <>
          <FormCard label="How you caught it" tag="Optional">
            <Text style={st.fieldL}>Technique</Text>
            <ChipSet items={TECHNIQUES.map((t) => ({ key: t, label: t }))} value={technique} onChange={(k) => setTechnique(technique === k ? null : k)} />
            <Text style={st.fieldL}>Bait or lure</Text>
            <ChipSet items={BAITS.map((b) => ({ key: b, label: b }))} value={bait} onChange={(k) => setBait(bait === k ? null : k)} />
            {bait === 'Other' || bait === 'Jig' || bait === 'Artificial lure' ? <Field value={baitOther} onChangeText={setBaitOther} placeholder="Which one? (optional)" /> : null}
          </FormCard>
          <FormCard label="Depth" tag="Optional">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field label="Fishing depth" value={fishDepth} onChangeText={setFishDepth} unit="ft" keyboardType="number-pad" />
              <Field label="Water depth" value={waterDepth} onChangeText={setWaterDepth} unit="ft" keyboardType="number-pad" />
            </View>
            <Field label="Meter marks" value={marks} onChangeText={setMarks} placeholder="Marks at 40–60 ft" />
          </FormCard>
          <FormCard label="Notes and photos" tag="Optional">
            <Field value={notes} onChangeText={setNotes} placeholder="Anything worth remembering" multiline />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {photos.map((p, i) => (
                <Pressable key={i} onLongPress={() => setPhotos(photos.filter((_, j) => j !== i))}><Image source={{ uri: p.uri }} style={st.thumb} /></Pressable>
              ))}
            </View>
            {photos.length < 4 ? <ChipSet items={[{ key: 'cam', label: 'Camera', icon: 'camera-outline' }, { key: 'lib', label: 'Library', icon: 'images-outline' }]} value={null} onChange={(k) => addPhoto(k === 'cam')} /> : null}
            <Text style={st.sub}>GPS and camera data are removed from photos before upload.{photos.length ? ' Long-press a photo to remove it.' : ''}</Text>
          </FormCard>
        </>
      ) : null}
      <InfoLine icon="lock-closed-outline" text="Your saved private spots are never attached to reports." />
    </FormSheet>
  );
}

/** The fish most people log, shown as tiles; the rest are under "All species". */
const TOP_SPECIES = ['YT', 'BFT', 'YFT', 'CAL', 'HAL', 'DOR', 'WSB', 'SAN', 'BAR'];
const SHORT: Record<string, string> = { HAL: 'Halibut', BFT: 'Bluefin', YFT: 'Yellowfin', WSB: 'White seabass', MAR: 'Marlin', LOB: 'Lobster' };

const useSt = makeStyles((colors) => ({
  allBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 36 },
  allT: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  listLine: { borderTopWidth: 1, borderColor: colors.line },
  listT: { flex: 1, color: colors.text, fontSize: 15 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  fieldL: { color: colors.muted, fontSize: 12, fontWeight: '600', marginBottom: 5 },
  sub: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  thumb: { width: 72, height: 72, borderRadius: 10 },
}));
