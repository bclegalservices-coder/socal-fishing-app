// Search everything from the map's search bar: fuel docks, bait (receivers / barges / shops), marinas, launch ramps,
// pump-outs, your saved spots and the known fishing spots. Category chips list the nearest of each kind with no
// typing ("Fuel" → closest fuel docks first). Harbor places come from the copy saved on the phone, so it works
// offline; fishing-spot names are also looked up on the server when there's signal.
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getJSON } from '../api';
import { distanceNm, formatNm } from '../geo';
import type { Pt } from '../nav';
import { colors, touch, makeStyles } from '../theme';
import { track } from '../analytics';
import { HARBOR_KINDS, harborCard } from '../layers/Harbors';
import type { LayerKey } from '../layers/state';

export type SearchHit = { key: string; kind: 'spot' | 'saved' | 'place'; name: string; sub: string; lat: number; lon: number; nm: number | null; id?: string;
  placeKind?: string; layer?: LayerKey; props?: any };

type Cat = 'all' | 'fuel' | 'bait' | 'marina' | 'ramp' | 'pumpout' | 'mine' | 'spots';
type Icon = keyof typeof MaterialCommunityIcons.glyphMap;
// Harbor places (fuel, bait, marinas…) are switched off for now (Oct 22): the OpenStreetMap / state lists put too
// many of them in the wrong place. Set HARBOR_SEARCH = true to bring them back once that data is cleaned up.
const HARBOR_SEARCH = false;
const ALL_CATS: { key: Cat; label: string; icon: Icon; kinds?: string[] }[] = [
  { key: 'all', label: 'All', icon: 'magnify' },
  { key: 'fuel', label: 'Fuel', icon: 'gas-station', kinds: ['fuel'] },
  { key: 'bait', label: 'Bait', icon: 'hook', kinds: ['bait', 'tackle'] },
  { key: 'marina', label: 'Marinas', icon: 'anchor', kinds: ['marina', 'harbor_office', 'service'] },
  { key: 'ramp', label: 'Ramps', icon: 'sail-boat', kinds: ['ramp'] },
  { key: 'pumpout', label: 'Pump-outs', icon: 'water-pump', kinds: ['pumpout'] },
  { key: 'mine', label: 'My spots', icon: 'bookmark' },
  { key: 'spots', label: 'Fishing spots', icon: 'map-marker-star' },
];
const CATS = ALL_CATS.filter((c) => HARBOR_SEARCH || !c.kinds);
/** Which map switch shows each harbor kind (so picking a result turns its layer on). */
const LAYER_OF: Record<string, LayerKey> = { fuel: 'fuel', bait: 'bait', tackle: 'bait', marina: 'marinas', harbor_office: 'marinas', service: 'marinas', ramp: 'ramps', pumpout: 'pumpout' };
/** Words people type → kinds. "gas" finds fuel docks, "barge" or "receiver" finds bait, and so on. */
const WORDS: [RegExp, string[]][] = [
  [/\b(fuel|gas|diesel)/, ['fuel']],
  [/\b(bait|barge|receiver|anchov|sardine|squid)/, ['bait', 'tackle']],
  [/\b(tackle|shop)/, ['tackle']],
  [/\b(marina|harbor|harbour|slip|yacht club|guest dock)/, ['marina', 'harbor_office']],
  [/\b(ramp|launch|hoist)/, ['ramp']],
  [/\b(pump|sewage)/, ['pumpout']],
  [/\b(repair|service|mechanic|haul)/, ['service']],
];
const ICON_OF: Record<string, { icon: Icon; tint: string }> = {
  fuel: { icon: 'gas-station', tint: '#E4572E' }, bait: { icon: 'hook', tint: '#0E9AA7' }, tackle: { icon: 'fishbowl-outline', tint: '#0E9AA7' },
  marina: { icon: 'anchor', tint: '#1F3A5F' }, harbor_office: { icon: 'office-building', tint: '#1F3A5F' }, service: { icon: 'wrench', tint: '#1F3A5F' },
  ramp: { icon: 'sail-boat', tint: '#2E8B57' }, pumpout: { icon: 'water-pump', tint: '#7B4FD6' },
  saved: { icon: 'bookmark', tint: '#16A34A' }, spot: { icon: 'map-marker-star', tint: '#1E6FD9' },
};

/** A single point for any harbor feature (marinas are outlines: use the middle of the outline). */
function pointOf(f: any): [number, number] | null {
  const g = f?.geometry;
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const ring = g.type === 'Polygon' ? g.coordinates?.[0] : g.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : g.type === 'LineString' ? g.coordinates : null;
  if (!ring?.length) return null;
  let x = 0, y = 0; for (const c of ring) { x += c[0]; y += c[1]; }
  return [x / ring.length, y / ring.length];
}

type Props = { boat: Pt | null; center?: Pt | null; mySpots: { id: string; name: string; lat: number; lon: number }[]; publicSpots: any; harbors?: any;
  onPick: (h: SearchHit) => void; onClose: () => void };

export function SearchSheet({ boat, center, mySpots, publicSpots, harbors, onPick, onClose }: Props) {
  const st = useSt();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Cat>('all');
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const from = boat ?? center ?? null;   // distances from the boat, or from the middle of the map without GPS
  const dist = (lat: number, lon: number) => (from ? distanceNm(from.lat, from.lon, lat, lon) : null);
  const term = q.trim().toLowerCase();

  // Fishing-spot names on the server (only when typing and the category can include spots)
  useEffect(() => {
    if (!term || !(cat === 'all' || cat === 'spots')) { setRemote([]); return; }
    const t = setTimeout(async () => {
      track('search', { length: term.length, cat });
      try {
        const near = from ? `&lat=${from.lat}&lon=${from.lon}` : '';
        const r = await getJSON<any[]>(`/spots/search?q=${encodeURIComponent(term)}${near}`, { timeoutMs: 8000 });
        setRemote(r.data.map((s) => ({ key: `r${s.id}`, kind: 'spot', id: s.id, name: s.canonical_name, sub: `${s.spot_type} · ${s.region ?? ''}`, lat: s.lat, lon: s.lon, nm: dist(s.lat, s.lon) })));
      } catch { setRemote([]); /* offline: everything below still works */ }
    }, 250);
    return () => clearTimeout(t);
  }, [term, cat]);

  // Harbor places saved on the phone
  const places = useMemo<SearchHit[]>(() => {
    const out: SearchHit[] = [];
    for (const f of HARBOR_SEARCH ? harbors?.features ?? [] : []) {
      const k = f.properties?.kind;
      if (!HARBOR_KINDS[k]) continue;
      const c = pointOf(f); if (!c) continue;
      const card = harborCard(f.properties);
      out.push({ key: `h${f.properties.id ?? `${k}${c[0]}${c[1]}`}`, kind: 'place', placeKind: k, layer: LAYER_OF[k], props: f.properties,
        name: card.name, sub: card.subtitle || HARBOR_KINDS[k].label, lat: c[1], lon: c[0], nm: null });
    }
    return out;
  }, [harbors]);

  const hits = useMemo(() => {
    const catDef = CATS.find((c) => c.key === cat)!;
    const wordKinds = term ? WORDS.filter(([re]) => re.test(term)).flatMap(([, k]) => k) : [];
    const textMatch = (s: string) => !term || s.toLowerCase().includes(term);
    const withNm = (h: SearchHit) => ({ ...h, nm: dist(h.lat, h.lon) });
    const byNm = (a: SearchHit, b: SearchHit) => (a.nm ?? 1e9) - (b.nm ?? 1e9);

    // places: by category, or by name, or by a kind word ("fuel", "barge")
    let pl: SearchHit[] = [];
    if (catDef.kinds || cat === 'all') {
      pl = places.filter((p) => (!catDef.kinds || catDef.kinds.includes(p.placeKind!))
        && (!term || textMatch(p.name) || textMatch(p.sub) || wordKinds.includes(p.placeKind!)));
      if (!term && cat === 'all') pl = [];   // "All" with no typing: shown as the quick lists below instead
    }
    const mine: SearchHit[] = cat === 'all' || cat === 'mine'
      ? mySpots.filter((s) => textMatch(s.name)).map((s) => ({ key: `m${s.id}`, kind: 'saved', id: s.id, name: s.name, sub: 'My spot · private', lat: s.lat, lon: s.lon, nm: null }))
      : [];
    const spots: SearchHit[] = (cat === 'all' && term) || cat === 'spots'
      ? (publicSpots?.features ?? []).filter((f: any) => textMatch(String(f.properties?.name ?? '')))
          .map((f: any) => ({ key: `c${f.properties.id}`, kind: 'spot', id: f.properties.id, name: f.properties.name, sub: f.properties.subtitle ?? 'Fishing spot', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nm: null }))
      : [];

    const seen = new Set<string>();
    const dedupe = (h: SearchHit) => { const k = `${h.name}|${h.lat.toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; };
    const all = [...mine.map(withNm).sort(byNm), ...pl.map(withNm).sort(byNm), ...remote, ...spots.map(withNm).sort(byNm)].filter(dedupe);
    return all.slice(0, 80);
  }, [term, cat, places, mySpots, publicSpots, remote, from?.lat, from?.lon]);

  // "All" with nothing typed: the closest few of the things people look for most
  const quick = useMemo(() => {
    if (term || cat !== 'all') return null;
    const nearest = (kinds: string[], n: number) => places.filter((p) => kinds.includes(p.placeKind!)).map((h) => ({ ...h, nm: dist(h.lat, h.lon) }))
      .sort((a, b) => (a.nm ?? 1e9) - (b.nm ?? 1e9)).slice(0, n);
    const mine = mySpots.map((s) => ({ key: `m${s.id}`, kind: 'saved' as const, id: s.id, name: s.name, sub: 'My spot · private', lat: s.lat, lon: s.lon, nm: dist(s.lat, s.lon) }))
      .sort((a, b) => (a.nm ?? 1e9) - (b.nm ?? 1e9)).slice(0, 5);
    const nearSpots: SearchHit[] = (publicSpots?.features ?? []).map((f: any) => ({ key: `c${f.properties.id}`, kind: 'spot' as const, id: f.properties.id, name: f.properties.name,
      sub: f.properties.subtitle ?? 'Fishing spot', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nm: dist(f.geometry.coordinates[1], f.geometry.coordinates[0]) }))
      .sort((a: SearchHit, b: SearchHit) => (a.nm ?? 1e9) - (b.nm ?? 1e9)).slice(0, 8);
    const sections: { title: string; items: SearchHit[] }[] = [
      { title: 'My spots', items: mine },
      { title: 'Nearby fishing spots', items: nearSpots },
      { title: 'Nearest fuel', items: nearest(['fuel'], 3) },
      { title: 'Nearest bait', items: nearest(['bait', 'tackle'], 3) },
      { title: 'Nearest marinas', items: nearest(['marina'], 3) },
      { title: 'Nearest launch ramps', items: nearest(['ramp'], 2) },
    ];
    return sections.filter((s) => s.items.length);
  }, [term, cat, places, mySpots, publicSpots, from?.lat, from?.lon]);

  const pick = (h: SearchHit) => { track('search_pick', { kind: h.placeKind ?? h.kind, cat }); onPick(h); };
  const Item = ({ item }: { item: SearchHit }) => {
    const ic = ICON_OF[item.placeKind ?? (item.kind === 'saved' ? 'saved' : 'spot')] ?? ICON_OF.spot;
    return (
      <Pressable style={({ pressed }) => [st.row, pressed && { backgroundColor: colors.inset }]} onPress={() => pick(item)} accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.sub}`}>
        <View style={[st.tile, { backgroundColor: ic.tint }]}><MaterialCommunityIcons name={ic.icon} size={18} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.name} numberOfLines={1}>{item.name}</Text>
          <Text style={st.sub} numberOfLines={1}>{item.sub}</Text>
        </View>
        <Text style={st.nm}>{item.nm != null ? `${formatNm(item.nm)} NM` : ''}</Text>
      </Pressable>
    );
  };

  const placeholder = cat === 'all' ? (HARBOR_SEARCH ? 'Fuel, bait, marinas, spots, numbers…' : 'Spot name, number or my spots') : `Search ${CATS.find((c) => c.key === cat)!.label.toLowerCase()}…`;
  return (
    <View style={st.sheet}>
      <View style={st.bar}>
        <View style={st.inputWrap}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder={placeholder} placeholderTextColor={colors.muted}
            style={st.input} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search" />
        </View>
        <Pressable onPress={onClose} style={st.cancel} hitSlop={6}><Text style={st.cancelT}>Cancel</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.chips} keyboardShouldPersistTaps="handled">
        {CATS.map((c) => {
          const on = cat === c.key;
          return (
            <Pressable key={c.key} onPress={() => setCat(c.key)} style={[st.chip, on && st.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <MaterialCommunityIcons name={c.icon} size={15} color={on ? colors.accent : colors.text} />
              <Text style={[st.chipT, on && st.chipTOn]}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {quick ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
          {quick.length ? quick.map((sec) => (
            <View key={sec.title} style={{ marginBottom: 6 }}>
              <Text style={st.secT}>{sec.title}</Text>
              {sec.items.map((h) => <Item key={h.key} item={h} />)}
            </View>
          )) : <Text style={st.empty}>Type a spot name or number, like "14", "209" or "Catalina".</Text>}
        </ScrollView>
      ) : (
        <FlatList data={hits} keyExtractor={(h: SearchHit) => h.key} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}
          ListEmptyComponent={<Text style={st.empty}>{term ? `Nothing found for "${q.trim()}".` : 'Nothing here yet.'}</Text>}
          renderItem={({ item }: { item: SearchHit }) => <Item item={item} />} />
      )}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, paddingTop: 54, paddingHorizontal: 14, zIndex: 20 },
  bar: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 10 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: touch.min, borderRadius: 14, borderWidth: 1.5, borderColor: colors.accent, backgroundColor: colors.panelSolid, paddingHorizontal: 12 },
  input: { flex: 1, height: touch.min, color: colors.text, fontSize: 17 },
  cancel: { height: touch.min, justifyContent: 'center', paddingHorizontal: 4 },
  cancelT: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  chips: { gap: 8, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 38, paddingHorizontal: 13, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset },
  chipOn: { backgroundColor: /^#[0-9a-f]{6}$/i.test(colors.accent) ? colors.accent + '22' : colors.inset, borderColor: colors.accent },
  chipT: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  chipTOn: { color: colors.accent },
  secT: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 10, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderBottomWidth: 0.5, borderColor: colors.line },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 16.5, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13 },
  nm: { color: colors.text, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
}));
