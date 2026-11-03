// Live air traffic (Oct 27): small planes over the water, with CIRCLING planes highlighted — a plane working circles
// low and slow over the ocean is usually a fish-spotter plane sitting on a school. Data: the server's GET /air
// (ADS-B, shared by hobbyist receivers), refreshed every 10 s while the layer is on and the app is open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, Easing, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { getJSON } from '../api';
import { colors, makeStyles, touch } from '../theme';
import { distanceNm, bearingTrue, cardinal } from '../geo';

export type Plane = {
  hex: string; callsign: string | null; reg: string | null; type: string | null; lat: number; lon: number;
  desc?: string | null; owner?: string | null; year?: string | null;
  alt_ft: number | null; gs_kt: number | null; track: number | null; age_s: number; kind: 'small' | 'heli' | 'jet' | 'high';
  water: boolean; low: boolean; slow: boolean; circling: boolean; circles: number; loiter_min: number; spotter: boolean;
};
export type AirData = { updated: number; age_s: number | null; source: string | null; credit: string; error: string | null;
  count: number; circling: number; spotters: number; planes: Plane[]; trails: Record<string, [number, number][]> };
export type Watch = { hex: string; reg: string | null; name: string };

export const AIR_COLORS = { spotter: '#FF5A00', circling: '#FFB300', watched: '#D53CF5', plane: '#1F2F3F', heli: '#5B6573' };
const WATCH_KEY = 'air-watch:v1';

/** Polls /air every 10 s while `on` and the app is in front. */
export function useAirTraffic(on: boolean) {
  const [data, setData] = useState<AirData | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const s = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => s.remove(); }, []);
  useEffect(() => {
    if (!on || !active) return;
    let alive = true;
    const load = () => getJSON<AirData>('/air', { timeoutMs: 20000 }).then((r) => { if (alive) setData(r.data); }).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [on, active]);
  useEffect(() => { if (!on) setData(null); }, [on]);
  return data;
}

export function useWatchList() {
  const [list, setList] = useState<Watch[]>([]);
  useEffect(() => { AsyncStorage.getItem(WATCH_KEY).then((v) => v && setList(JSON.parse(v))).catch(() => {}); }, []);
  const save = (next: Watch[]) => { setList(next); AsyncStorage.setItem(WATCH_KEY, JSON.stringify(next)).catch(() => {}); };
  return {
    list,
    find: (p: Plane) => list.find((w) => w.hex === p.hex || (!!p.reg && w.reg === p.reg)),
    add: (p: Plane, name: string) => save([...list.filter((w) => w.hex !== p.hex), { hex: p.hex, reg: p.reg, name }]),
    remove: (p: Plane) => save(list.filter((w) => w.hex !== p.hex && !(p.reg && w.reg === p.reg))),
  };
}

export const planeTitle = (p: Plane, w?: Watch) => w?.name || p.callsign || p.reg || p.type || 'Aircraft';

/** Common planes over SoCal waters (spotters, patrol, sightseeing), for when the network sends only the type code. */
const TYPE_NAMES: Record<string, string> = {
  C150: 'Cessna 150', C152: 'Cessna 152', C170: 'Cessna 170', C172: 'Cessna 172 Skyhawk', C177: 'Cessna 177 Cardinal', C180: 'Cessna 180 Skywagon',
  C182: 'Cessna 182 Skylane', C185: 'Cessna 185 Skywagon', C206: 'Cessna 206 Stationair', C207: 'Cessna 207', C208: 'Cessna 208 Caravan',
  C210: 'Cessna 210 Centurion', C310: 'Cessna 310', C337: 'Cessna 337 Skymaster', C340: 'Cessna 340', C414: 'Cessna 414', C421: 'Cessna 421',
  P28A: 'Piper Cherokee / Archer', P28B: 'Piper Cherokee 235', P28R: 'Piper Arrow', P32R: 'Piper Saratoga', PA32: 'Piper Cherokee Six',
  PA18: 'Piper Super Cub', PA22: 'Piper Tri-Pacer', PA24: 'Piper Comanche', PA31: 'Piper Navajo', PA34: 'Piper Seneca', PA44: 'Piper Seminole',
  PA46: 'Piper Malibu', BE35: 'Beechcraft Bonanza (V-tail)', BE36: 'Beechcraft Bonanza', BE55: 'Beechcraft Baron', BE58: 'Beechcraft Baron 58',
  BE9L: 'Beechcraft King Air 90', BE20: 'Beechcraft King Air 200', SR20: 'Cirrus SR20', SR22: 'Cirrus SR22', S22T: 'Cirrus SR22T',
  M20P: 'Mooney M20', DA40: 'Diamond DA40', DA42: 'Diamond DA42', CH7A: 'Champion Citabria', CH7B: 'Bellanca Decathlon', AA5: 'Grumman Tiger',
  GA8: 'GippsAero Airvan', DHC2: 'de Havilland Beaver', DHC6: 'de Havilland Twin Otter', PC12: 'Pilatus PC-12', KODI: 'Kodiak 100',
  AC50: 'Aero Commander 500', P68: 'Partenavia P68 Observer', LA4: 'Lake Buccaneer (amphibian)', SEAW: 'Seawind (amphibian)',
  R22: 'Robinson R22 (helicopter)', R44: 'Robinson R44 (helicopter)', R66: 'Robinson R66 (helicopter)', B06: 'Bell 206 JetRanger (helicopter)',
  B407: 'Bell 407 (helicopter)', AS50: 'Airbus AS350 (helicopter)', EC30: 'Airbus H130 (helicopter)', EC35: 'Airbus H135 (helicopter)',
  EC45: 'Airbus H145 (helicopter)', H60: 'Black Hawk / Jayhawk (helicopter)', A139: 'Leonardo AW139 (helicopter)', HDJT: 'HondaJet',
  C130: 'C-130 Hercules', P8: 'P-8 Poseidon (Navy patrol)', C27J: 'C-27J Spartan (Coast Guard)', HU25: 'Falcon / HU-25 Guardian',
};
const KEEP_CAPS = new Set(['LLC', 'INC', 'LP', 'LLP', 'USA', 'US', 'II', 'III', 'IV', 'FAA', 'CHP', 'LA', 'SD', 'USCG']);
const titleCase = (s: string) => s.split(/(\s+)/).map((w) => (/\d/.test(w) || KEEP_CAPS.has(w.toUpperCase().replace(/[.,]/g, '')) ? w.toUpperCase()
  : w.toLowerCase().replace(/(^|[-/])([a-z])/g, (_m, a, b) => a + b.toUpperCase()))).join('');
/** "Cessna 182 Skylane" — the network's description when it has one, otherwise our table, otherwise the code. */
export function planeModel(p: Plane): string | null {
  if (p.desc) return titleCase(p.desc);
  if (p.type && TYPE_NAMES[p.type.toUpperCase()]) return TYPE_NAMES[p.type.toUpperCase()];
  return p.type ?? null;
}
/** FAA registry page for US tail numbers (N…): owner, model, year — all public. */
export const faaLink = (reg: string | null) => (reg && /^N[0-9A-Z]{1,5}$/i.test(reg) ? `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(reg.slice(1))}` : null);
const altText = (ft: number | null) => (ft == null ? '—' : `${Math.round(ft / 50) * 50 >= 1000 ? (Math.round(ft / 50) * 50).toLocaleString() : Math.round(ft / 50) * 50} ft`);

/** One shared pulse for every circling plane (a soft ring growing and fading). */
function usePulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

/** Map part (goes inside <MapView>): recent loops of circling planes, and a plane icon for each aircraft in view. */
export function AirMapLayer({ data: raw, view, mapHeading, watched: watchedIn, onPick, locked }: {
  data: AirData | null; view: { minLon: number; minLat: number; maxLon: number; maxLat: number; zoom: number } | null;
  mapHeading: number; watched: (p: Plane) => Watch | undefined; onPick: (p: Plane) => void; locked?: boolean;
}) {
  const pulse = usePulse();
  // Pro switched on and this person isn't Pro: plain air traffic only (no circling / spotter highlights or loops)
  const data = useMemo(() => (raw && locked ? lockData(raw) : raw), [raw, locked]);
  const watched = locked ? noWatch : watchedIn;
  const trails = useMemo(() => {
    const feats: any[] = [];
    if (!data) return { type: 'FeatureCollection', features: feats };
    const byHex: Record<string, Plane> = {};
    data.planes.forEach((p) => { byHex[p.hex] = p; });
    for (const [hx, coords] of Object.entries(data.trails)) {
      const p = byHex[hx];
      if (!p || coords.length < 2) continue;
      const c = watched(p) ? AIR_COLORS.watched : p.spotter ? AIR_COLORS.spotter : p.circling ? AIR_COLORS.circling : '#6B7C8F';
      feats.push({ type: 'Feature', properties: { c, w: p.circling ? 3 : 1.6 }, geometry: { type: 'LineString', coordinates: coords } });
    }
    return { type: 'FeatureCollection', features: feats };
  }, [data, watched]);
  const shown = useMemo(() => {
    if (!data || !view) return [];
    const padLon = (view.maxLon - view.minLon) * 0.1, padLat = (view.maxLat - view.minLat) * 0.1;
    return data.planes.filter((p) => p.lon >= view.minLon - padLon && p.lon <= view.maxLon + padLon && p.lat >= view.minLat - padLat && p.lat <= view.maxLat + padLat
      && (p.circling || p.spotter || !!watched(p) || p.kind !== 'jet' || view.zoom >= 9)).slice(0, 70);
  }, [data, view, watched]);
  if (!data) return null;
  return (
    <>
      <GeoJSONSource id="air-trails" data={trails as any}>
        <Layer type="line" id="air-trails-casing" style={{ lineColor: '#FFFFFF', lineWidth: ['+', ['get', 'w'], 2.5] as any, lineOpacity: 0.7, lineCap: 'round', lineJoin: 'round' }} />
        <Layer type="line" id="air-trails-line" style={{ lineColor: ['get', 'c'] as any, lineWidth: ['get', 'w'] as any, lineOpacity: 0.95, lineCap: 'round', lineJoin: 'round' }} />
      </GeoJSONSource>
      {shown.map((p) => {
        const w = watched(p);
        const hot = p.spotter || p.circling || !!w;
        const c = w ? AIR_COLORS.watched : p.spotter ? AIR_COLORS.spotter : p.circling ? AIR_COLORS.circling : p.kind === 'heli' ? AIR_COLORS.heli : AIR_COLORS.plane;
        const rot = (p.track ?? 0) - mapHeading;
        return (
          <Marker key={`air-${p.hex}`} lngLat={[p.lon, p.lat]} anchor="center">
            <Pressable onPress={() => onPick(p)} hitSlop={10} style={s.wrap} accessibilityRole="button"
              accessibilityLabel={`${planeTitle(p, w)}${p.circling ? ', circling' : ''}${p.spotter ? ', likely spotter plane' : ''}`}>
              {hot ? (
                <Animated.View pointerEvents="none" style={[s.pulse, { borderColor: c, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }] }]} />
              ) : null}
              <View style={[s.disc, hot ? { backgroundColor: c, borderColor: '#FFFFFF', width: 34, height: 34, borderRadius: 17 } : null]}>
                <MaterialCommunityIcons name={p.kind === 'heli' ? 'helicopter' : 'airplane'} size={hot ? 22 : 17}
                  color={hot ? '#FFFFFF' : c} style={p.kind === 'heli' ? undefined : { transform: [{ rotate: `${rot}deg` }] }} />
              </View>
              {hot ? (
                <View pointerEvents="none" style={[s.tag, { backgroundColor: c }]}>
                  <Text style={s.tagT} numberOfLines={1}>{w ? w.name : p.spotter ? 'Likely spotter' : 'Circling'} · {altText(p.alt_ft)}</Text>
                </View>
              ) : null}
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const noWatch = () => undefined;
/** Spotter planes are the Pro feature: strip what they add (circling, spotter, loops) for people without Pro. */
export function lockData(d: AirData): AirData {
  return { ...d, circling: 0, spotters: 0, trails: {}, planes: d.planes.map((p) => ({ ...p, circling: false, spotter: false, circles: 0 })) };
}

/** Banner under the top bar: "2 planes circling now" — tap to jump to them one by one. */
/** Nov 1: tap → a list of every plane nearby (what it is, how high, how far), tap one to fly the map to it. */
export function AirChip({ data, onList, locked, gated, onUpsell }: { data: AirData | null; onList: () => void; locked?: boolean; gated?: boolean; onUpsell?: () => void }) {
  const st = useSt();
  const hot = (data?.planes ?? []).filter((p) => p.circling);
  if (!data) return null;
  if (locked) {
    return (
      <Pressable onPress={onUpsell} style={({ pressed }) => [st.chip, { borderColor: AIR_COLORS.spotter }, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel="Spotter planes are a Pro feature">
        <View style={[st.chipDot, { backgroundColor: AIR_COLORS.spotter }]}><Ionicons name="lock-closed" size={14} color="#FFFFFF" /></View>
        <Text style={st.chipT} numberOfLines={1}>{hot.length ? `${hot.length} plane${hot.length === 1 ? '' : 's'} circling now` : 'See circling spotter planes'}</Text>
        <View style={st.pro}><Text style={st.proT}>PRO</Text></View>
      </Pressable>
    );
  }
  const spot = hot.filter((p) => p.spotter).length;
  const stale = data.age_s != null && data.age_s > 120;
  return (
    <Pressable disabled={!data.planes.length} onPress={onList}
      style={({ pressed }) => [st.chip, hot.length ? { borderColor: spot ? AIR_COLORS.spotter : AIR_COLORS.circling } : null, pressed && { opacity: 0.75 }]}
      accessibilityRole="button" accessibilityLabel={`${data.planes.length} planes nearby${hot.length ? `, ${hot.length} circling` : ''}. Tap for the list.`}>
      <View style={[st.chipDot, { backgroundColor: hot.length ? (spot ? AIR_COLORS.spotter : AIR_COLORS.circling) : colors.faint }]}>
        <MaterialCommunityIcons name="airplane" size={14} color="#FFFFFF" />
      </View>
      <Text style={st.chipT} numberOfLines={1}>
        {hot.length ? `${hot.length} plane${hot.length === 1 ? '' : 's'} circling${spot ? ` · ${spot} likely spotter${spot === 1 ? '' : 's'}` : ''}`
          : `${data.count} planes · none circling`}
        {stale ? ` · ${Math.round((data.age_s ?? 0) / 60)} min old` : ''}
      </Text>
      {!gated ? <View style={st.pro}><Text style={st.proT}>PRO · FREE NOW</Text></View> : null}
      {data.planes.length ? <Text style={st.chipGo}>List</Text> : null}
    </Pressable>
  );
}

/** Nov 1: every plane the app knows about right now — spotters & circling first, then watched, then nearest. */
export function AirListSheet({ data, visible, boat, watched, onPick, onClose }: {
  data: AirData | null; visible: boolean; boat: { lat: number; lon: number } | null; watched: (p: Plane) => Watch | undefined;
  onPick: (p: Plane) => void; onClose: () => void;
}) {
  const st = useSt();
  const rows = useMemo(() => (data?.planes ?? []).map((p) => {
    const w = watched(p);
    const nm = boat ? distanceNm(boat.lat, boat.lon, p.lat, p.lon) : null;
    const brg = boat ? bearingTrue(boat.lat, boat.lon, p.lat, p.lon) : null;
    const rank = p.spotter ? 0 : p.circling ? 1 : w ? 2 : 3;
    return { p, w, nm, brg, rank };
  }).sort((a, b) => a.rank - b.rank || (a.nm ?? 1e9) - (b.nm ?? 1e9)), [data, boat, watched]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.dim} onPress={onClose} />
      <View style={st.sheet}>
        <View style={st.sheetHead}>
          <MaterialCommunityIcons name="airplane" size={20} color={colors.live} />
          <Text style={st.sheetT}>Planes nearby · {rows.length}</Text>
          <Pressable onPress={onClose} hitSlop={10} style={st.sheetX} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={20} color={colors.text} /></Pressable>
        </View>
        <Text style={st.sheetS}>Over the water, from live ADS-B. Tap one to show it on the map.</Text>
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ paddingBottom: 8 }}>
          {rows.map(({ p, w, nm, brg }) => {
            const c = w ? AIR_COLORS.watched : p.spotter ? AIR_COLORS.spotter : p.circling ? AIR_COLORS.circling : p.kind === 'heli' ? AIR_COLORS.heli : colors.muted;
            const model = planeModel(p);
            const tag = p.spotter ? 'Likely spotter' : p.circling ? 'Circling' : w ? 'Watching' : null;
            return (
              <Pressable key={p.hex} onPress={() => onPick(p)} style={({ pressed }) => [st.lRow, pressed && { opacity: 0.6 }]} accessibilityRole="button"
                accessibilityLabel={`${planeTitle(p, w)}, ${model ?? ''}, ${altText(p.alt_ft)}${nm != null ? `, ${nm.toFixed(1)} nautical miles` : ''}`}>
                <View style={[st.lIcon, { backgroundColor: c }]}>
                  <MaterialCommunityIcons name={p.kind === 'heli' ? 'helicopter' : 'airplane'} size={18} color="#FFFFFF" style={{ transform: [{ rotate: `${(p.track ?? 0) - 45}deg` }] }} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={st.lTitle} numberOfLines={1}>{planeTitle(p, w)}</Text>
                    {tag ? <View style={[st.lTag, { backgroundColor: c }]}><Text style={st.lTagT}>{tag}</Text></View> : null}
                  </View>
                  <Text style={st.lSub} numberOfLines={1}>{[model, p.reg && p.reg !== planeTitle(p, w) ? p.reg : null].filter(Boolean).join(' · ') || 'Aircraft'}</Text>
                  <Text style={st.lSub} numberOfLines={1}>{altText(p.alt_ft)} · {p.gs_kt != null ? `${Math.round(p.gs_kt)} kt` : '— kt'}{nm != null && brg != null ? ` · ${nm.toFixed(1)} NM ${cardinal(brg)}` : ''}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </Pressable>
            );
          })}
          {!rows.length ? <Text style={st.lSub}>No planes over the water right now.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Nov 1: where each WATCHED plane has flown (up to 6 h, from the server), refreshed every 20 s while the air layer is
 *  on. Asking also tells the server to keep remembering those planes' full paths. */
export type WatchedPaths = { now: number; paths: Record<string, [number, number, number, number | null][]> };
export function useWatchedPaths(on: boolean, hexes: string[]) {
  const [data, setData] = useState<WatchedPaths | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => { const s = AppState.addEventListener('change', (st) => setActive(st === 'active')); return () => s.remove(); }, []);
  const key = hexes.slice().sort().join(',');
  useEffect(() => {
    if (!on || !active || !key) { if (!key) setData(null); return; }
    let alive = true;
    const load = () => getJSON<WatchedPaths>(`/air/paths?hex=${encodeURIComponent(key)}`, { timeoutMs: 20000 }).then((r) => { if (alive) setData(r.data); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [on, active, key]);
  return data;
}

/** Map lines for watched planes' recorded paths: bright where it is now, fading the older it gets. */
export function watchedPathsGeoJSON(d: WatchedPaths | null) {
  const features: any[] = [];
  if (!d) return { type: 'FeatureCollection' as const, features };
  for (const [hex, all] of Object.entries(d.paths)) {
    // Nov 2: the server leaves out points over land; break the line there so it never cuts across the land
    const runs: typeof all[] = [];
    for (const q of all) {
      const run = runs[runs.length - 1];
      if (run && q[2] - run[run.length - 1][2] <= 90) run.push(q); else runs.push([q]);
    }
    for (const pts of runs)
    for (let i = 0; i < pts.length - 1; i += 6) {
      const chunk = pts.slice(i, Math.min(i + 7, pts.length));
      if (chunk.length < 2) continue;
      const mid = chunk[Math.floor(chunk.length / 2)][2];
      features.push({ type: 'Feature', properties: { hex, age_min: Math.round((d.now - mid) / 60) }, geometry: { type: 'LineString', coordinates: chunk.map((q) => [q[0], q[1]]) } });
    }
  }
  return { type: 'FeatureCollection' as const, features };
}

export function WatchedPathLayer({ data }: { data: WatchedPaths | null }) {
  const geo = useMemo(() => watchedPathsGeoJSON(data), [data]);
  return (
    <GeoJSONSource id="air-watched-paths" data={geo as any}>
      <Layer type="line" id="air-watched-casing" style={{ lineColor: '#FFFFFF', lineWidth: 5, lineOpacity: ['interpolate', ['linear'], ['get', 'age_min'], 0, 0.7, 360, 0.15] as any, lineCap: 'round', lineJoin: 'round' }} />
      <Layer type="line" id="air-watched-line" style={{ lineColor: AIR_COLORS.watched, lineWidth: 2.6, lineOpacity: ['interpolate', ['linear'], ['get', 'age_min'], 0, 1, 60, 0.75, 360, 0.3] as any, lineCap: 'round', lineJoin: 'round' }} />
    </GeoJSONSource>
  );
}

/** Card when a plane is tapped. */
export function AirCard({ p, watch, boat, credit, onWatch, onUnwatch, onCenter, onClose, locked, onUpsell }: {
  p: Plane; watch?: Watch; boat: { lat: number; lon: number } | null; credit: string;
  onWatch: (name: string) => void; onUnwatch: () => void; onCenter: () => void; onClose: () => void; locked?: boolean; onUpsell?: () => void;
}) {
  const st = useSt();
  const status = p.spotter ? 'Circling low and slow over the water — flying like a fish-spotter plane'
    : p.circling ? `Circling${p.water ? ' over the water' : ' over land'}`
    : p.low && p.slow && p.water ? 'Low and slow over the water' : p.kind === 'heli' ? 'Helicopter' : 'Passing through';
  const c = watch ? AIR_COLORS.watched : p.spotter ? AIR_COLORS.spotter : p.circling ? AIR_COLORS.circling : colors.live;
  const away = boat ? `${distanceNm(boat.lat, boat.lon, p.lat, p.lon).toFixed(1)} NM ${cardinal(bearingTrue(boat.lat, boat.lon, p.lat, p.lon))} of you` : null;
  return (
    <View style={st.card}>
      <View style={st.head}>
        <View style={[st.icon, { backgroundColor: c }]}><MaterialCommunityIcons name={p.kind === 'heli' ? 'helicopter' : 'airplane'} size={22} color="#FFFFFF" /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{planeTitle(p, watch)}</Text>
          <Text style={st.model} numberOfLines={1}>{planeModel(p) ?? 'Aircraft type not shared'}</Text>
          <Text style={st.sub} numberOfLines={1}>{[p.reg ?? 'No tail number shared', p.year ? `built ${p.year}` : null, p.callsign && p.callsign !== p.reg ? p.callsign : null].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={st.x} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></Pressable>
      </View>
      <View style={[st.status, { borderColor: c }]}><Text style={st.statusT}>{status}</Text></View>
      <View style={st.grid}>
        <Stat k="Altitude" v={altText(p.alt_ft)} />
        <Stat k="Speed" v={p.gs_kt == null ? '—' : `${p.gs_kt} kt`} />
        <Stat k={p.circling ? 'Circles' : 'Heading'} v={p.circling ? `${p.circles} in ${Math.round(p.loiter_min)} min` : p.track == null ? '—' : `${p.track}°`} />
      </View>
      {p.owner ? <Text style={st.sub} numberOfLines={1}>Registered to {titleCase(p.owner)}</Text> : null}
      <Text style={st.sub}>{[away, p.age_s > 30 ? `position ${Math.round(p.age_s)} s old` : null].filter(Boolean).join(' · ')}</Text>
      {faaLink(p.reg) ? (
        <Pressable onPress={() => Linking.openURL(faaLink(p.reg)!).catch(() => {})} accessibilityRole="link" style={({ pressed }) => [st.faa, pressed && { opacity: 0.6 }]}>
          <Ionicons name="document-text-outline" size={16} color={colors.live} /><Text style={st.faaT}>Full FAA record for {p.reg} (owner, model, year)</Text>
        </Pressable>
      ) : null}
      {locked ? (
        <Pressable onPress={onUpsell} style={({ pressed }) => [st.lockRow, pressed && { opacity: 0.8 }]} accessibilityRole="button">
          <Ionicons name="lock-closed" size={16} color={AIR_COLORS.spotter} />
          <Text style={st.lockT}>See if it's circling (a likely spotter on fish), its loops and alerts — with Pro</Text>
        </Pressable>
      ) : null}
      <View style={st.row}>
        <Pressable onPress={onCenter} style={({ pressed }) => [st.btn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Ionicons name="locate" size={18} color={colors.text} /><Text style={st.btnT}>Center</Text>
        </Pressable>
        {locked ? null : watch ? (
          <Pressable onPress={onUnwatch} style={({ pressed }) => [st.btn, pressed && { opacity: 0.7 }]} accessibilityRole="button">
            <Ionicons name="star" size={18} color={AIR_COLORS.watched} /><Text style={st.btnT}>Watching</Text>
          </Pressable>
        ) : (
          <Pressable style={({ pressed }) => [st.btn, st.btnOn, pressed && { opacity: 0.8 }]} accessibilityRole="button"
            onPress={() => {
              const base = p.reg || p.callsign || p.hex.toUpperCase();
              if (Alert.prompt) Alert.prompt('Watch this plane', 'Give it a name you\'ll recognize. It will be highlighted on the map, with its flight path drawn in purple (up to the last 6 hours).', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Watch', onPress: (t?: string) => onWatch((t || '').trim() || base) }], 'plain-text', base);
              else onWatch(base);
            }}>
            <Ionicons name="star-outline" size={18} color={colors.accentInk} /><Text style={[st.btnT, { color: colors.accentInk }]}>Watch</Text>
          </Pressable>
        )}
      </View>
      <Text style={st.credit}>{credit}. Planes show only when their ADS-B is on and a receiver hears them.</Text>
    </View>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={st.stat}><Text style={st.statV} numberOfLines={1} adjustsFontSizeToFit>{v}</Text><Text style={st.statK}>{k}</Text></View>;
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
  pulse: { position: 'absolute', width: 46, height: 46, borderRadius: 23, borderWidth: 3 },
  disc: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.25)' },
  tag: { position: 'absolute', top: 42, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1.5, borderColor: '#FFFFFF', maxWidth: 170 },
  tagT: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
});

const useSt = makeStyles((colors) => ({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 6, marginHorizontal: 12, minHeight: 40, paddingLeft: 6, paddingRight: 12,
    borderRadius: 20, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelSolid, maxWidth: '94%',
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  chipDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  chipGo: { color: colors.live, fontSize: 14, fontWeight: '800' },
  pro: { backgroundColor: '#FF5A00', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proT: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4 },
  card: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderBottomWidth: 0, borderColor: colors.border, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 19, fontWeight: '800' },
  model: { color: colors.text, fontSize: 15, fontWeight: '700' },
  faa: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  faaT: { color: colors.live, fontSize: 14, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 13.5 },
  x: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  status: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 4 },
  statusT: { color: colors.text, fontSize: 15, fontWeight: '700' },
  grid: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inset, paddingVertical: 8, alignItems: 'center' },
  statV: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statK: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 2 },
  row: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: touch.min, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.panelSolid },
  btnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnT: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  credit: { color: colors.faint, fontSize: 11.5 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#FF5A00' },
  lockT: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 14, paddingBottom: 30, gap: 6 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetT: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '900' },
  sheetX: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  sheetS: { color: colors.muted, fontSize: 13 },
  lRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  lIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  lTitle: { color: colors.text, fontSize: 15.5, fontWeight: '800', flexShrink: 1 },
  lTag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  lTagT: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  lSub: { color: colors.muted, fontSize: 12.5 },
}));
