// Search known spots (server), plus your private spots and cached public spots on the phone (works offline).
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getJSON } from '../api';
import { distanceNm, formatNm } from '../geo';
import type { Pt } from '../nav';
import { colors, touch, makeStyles } from '../theme';
import { track } from '../analytics';

export type SearchHit = { key: string; kind: 'spot' | 'saved'; name: string; sub: string; lat: number; lon: number; nm: number | null; id?: string };

type Props = { boat: Pt | null; mySpots: { id: string; name: string; lat: number; lon: number }[]; publicSpots: any; onPick: (h: SearchHit) => void; onClose: () => void };

export function SearchSheet({ boat, mySpots, publicSpots, onPick, onClose }: Props) {
  const st = useSt();
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<SearchHit[]>([]);
  const dist = (lat: number, lon: number) => (boat ? distanceNm(boat.lat, boat.lon, lat, lon) : null);

  useEffect(() => {
    if (!q.trim()) { setRemote([]); return; }
    const t = setTimeout(async () => {
      track('search', { length: q.trim().length });
      try {
        const near = boat ? `&lat=${boat.lat}&lon=${boat.lon}` : '';
        const r = await getJSON<any[]>(`/spots/search?q=${encodeURIComponent(q.trim())}${near}`, { timeoutMs: 8000 });
        setRemote(r.data.map((s) => ({ key: `r${s.id}`, kind: 'spot', id: s.id, name: s.canonical_name, sub: `${s.spot_type} · ${s.region ?? ''}`, lat: s.lat, lon: s.lon, nm: dist(s.lat, s.lon) })));
      } catch { setRemote([]); /* offline: local results below still work */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const local = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const mine: SearchHit[] = mySpots.filter((s) => s.name.toLowerCase().includes(term))
      .map((s) => ({ key: `m${s.id}`, kind: 'saved', id: s.id, name: s.name, sub: 'My spot · private', lat: s.lat, lon: s.lon, nm: dist(s.lat, s.lon) }));
    const cachedPublic: SearchHit[] = (publicSpots?.features ?? []).filter((f: any) => String(f.properties?.name ?? '').toLowerCase().includes(term))
      .map((f: any) => ({ key: `c${f.properties.id}`, kind: 'spot', id: f.properties.id, name: f.properties.name, sub: f.properties.subtitle ?? 'Fishing spot', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], nm: dist(f.geometry.coordinates[1], f.geometry.coordinates[0]) }));
    return [...mine, ...cachedPublic];
  }, [q, mySpots, publicSpots]);

  const seen = new Set<string>();
  const hits = [...local.filter((h) => h.kind === 'saved'), ...remote, ...local.filter((h) => h.kind === 'spot')]
    .filter((h) => { const k = `${h.name}|${h.lat.toFixed(4)}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return (
    <View style={st.sheet}>
      <View style={st.bar}>
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Spot name, number or my spots" placeholderTextColor={colors.muted}
          style={st.input} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search spots" />
        <Pressable onPress={onClose} style={st.cancel}><Text style={st.cancelT}>Cancel</Text></Pressable>
      </View>
      <FlatList data={hits} keyExtractor={(h) => h.key} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={q ? <Text style={st.empty}>No matches yet. Spots load from licensed sources.</Text> : <Text style={st.empty}>Try "14", "209", "Catalina" or one of your spots.</Text>}
        renderItem={({ item }) => (
          <Pressable style={st.row} onPress={() => onPick(item)}>
            <Text style={[st.icon, { color: item.kind === 'saved' ? colors.live : colors.accent }]}>{item.kind === 'saved' ? '🔒' : '◆'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{item.name}</Text>
              <Text style={st.sub}>{item.sub}</Text>
            </View>
            <Text style={st.nm}>{item.nm != null ? `${formatNm(item.nm)} NM` : ''}</Text>
          </Pressable>
        )} />
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, paddingTop: 54, paddingHorizontal: 14, zIndex: 20 },
  bar: { flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 8 },
  input: { flex: 1, height: touch.min, borderRadius: 14, borderWidth: 1.5, borderColor: colors.live, color: colors.text, paddingHorizontal: 14, fontSize: 17, backgroundColor: colors.panelSolid },
  cancel: { height: touch.min, justifyContent: 'center', paddingHorizontal: 4 },
  cancelT: { color: colors.live, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, borderBottomWidth: 1, borderColor: colors.line },
  icon: { fontSize: 18, width: 26, textAlign: 'center' },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 13 },
  nm: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  empty: { color: colors.muted, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
}));
