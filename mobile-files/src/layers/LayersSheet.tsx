import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ageText } from '../api';
import { colors, touch, makeStyles } from '../theme';
import type { Catalog } from '../types';
import { external, grid, wind } from './catalog';
import { PRESETS, type LayerKey, type LayerState, type MapOverlay } from './state';
import { track } from '../analytics';

type Props = { catalog: Catalog | null; cached: boolean; s: LayerState; set: (fn: (s: LayerState) => LayerState) => void;
  radarPlaying: boolean; setRadarPlaying: (b: boolean) => void; onClose: () => void; rulesChecked?: string | null; onSaveArea?: () => void };

const OPACITIES = [0.25, 0.5, 0.75, 1];
// The old 'hazards' dots only exist when our server's rules job has run; hide the switch otherwise.
const k_hazards = (s: LayerState) => s.on.hazards;

const STYLES: { key: MapOverlay; label: string; sub: string; img: any }[] = [
  { key: 'none', label: 'Chart', sub: 'NOAA nautical chart', img: require('../../assets/map-options/chart.png') },
  { key: 'relief', label: 'Relief', sub: 'Seafloor in color', img: require('../../assets/map-options/relief.png') },
  { key: 'satellite', label: 'Satellite', sub: 'Aerial photos', img: require('../../assets/map-options/satellite.png') },
];

export function LayersSheet({ catalog, cached, s, set, radarPlaying, setRadarPlaying, onClose, rulesChecked, onSaveArea }: Props) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const setOverlay = (o: MapOverlay) => { set((p) => ({ ...p, overlay: o })); track('map_style', { style: o }); };
  const ovOpacity = (v: number) => set((p) => ({ ...p, opacity: { ...p.opacity, overlay: v } }));
  const toggle = (k: LayerKey) => set((p) => ({ ...p, on: { ...p.on, [k]: !p.on[k] } }));
  const opacity = (k: keyof LayerState['opacity'], v: number) => set((p) => ({ ...p, opacity: { ...p.opacity, [k]: v } }));
  const sst = grid(catalog, 'sst'), chl = grid(catalog, 'chl'), bathy = grid(catalog, 'bathy'), w = wind(catalog), radar = external(catalog, 'radar');

  const Row = ({ k, title, sub, disabled }: { k: LayerKey; title: string; sub?: string; disabled?: boolean }) => { const st = useSt(); return ((
    <Pressable onPress={() => !disabled && toggle(k)} style={[st.row, disabled && { opacity: 0.45 }]} accessibilityRole="switch" accessibilityState={{ checked: s.on[k], disabled }}>
      <View style={{ flex: 1 }}>
        <Text style={st.rowT}>{title}</Text>
        {sub ? <Text style={st.sub}>{sub}</Text> : null}
      </View>
      <View style={[st.sw, s.on[k] && st.swOn]}><View style={[st.knob, s.on[k] && st.knobOn]} /></View>
    </Pressable>
  )); };
  const Op = ({ k }: { k: keyof LayerState['opacity'] }) => { const st = useSt(); return ((
    <View style={st.opRow}>
      <Text style={st.sub}>See-through</Text>
      {OPACITIES.map((v) => (
        <Pressable key={v} onPress={() => opacity(k, v)} style={[st.opChip, Math.abs(s.opacity[k] - v) < 0.01 && st.opOn]}>
          <Text style={[st.opT, Math.abs(s.opacity[k] - v) < 0.01 && { color: colors.accentInk }]}>{Math.round(v * 100)}%</Text>
        </Pressable>
      ))}
    </View>
  )); };
  const when = (l?: { dates?: { observed_at?: string | null; date: string }[]; available?: boolean; source?: string }) =>
    !l || l.available === false || !l.dates?.length ? 'Not available yet' : `${l.source ?? ''} · latest ${ageText(l.dates[0].observed_at ?? null)}`;

  return (
    <View style={[st.sheet, { top: insets.top + 56 }]}>
      <View style={st.head}>
        <Text style={st.h1}>Map options</Text>
        <Pressable onPress={onClose} style={st.close} accessibilityLabel="Close layers"><Text style={st.closeT}>✕</Text></Pressable>
      </View>
      {cached ? <Text style={[st.sub, { color: colors.accent }]}>Offline · showing the layer list saved earlier</Text> : null}
      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 30 }}>
        <View>
          <Text style={st.group}>Map style</Text>
          <View style={st.styles}>
            {STYLES.map((m) => {
              const on = (s.overlay ?? 'none') === m.key;
              return (
                <Pressable key={m.key} onPress={() => setOverlay(m.key)} style={st.styleCard} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${m.label}: ${m.sub}`}>
                  <View style={[st.thumbWrap, on && st.thumbOn]}><Image source={m.img} style={st.thumb} /></View>
                  <Text style={[st.styleT, on && { color: colors.accent }]}>{m.label}</Text>
                  <Text style={st.styleSub}>{m.sub}</Text>
                </Pressable>
              );
            })}
          </View>
          {s.overlay && s.overlay !== 'none' ? (
            <View style={st.opRow}>
              <Text style={st.sub}>Strength</Text>
              {OPACITIES.map((v) => {
                const on = Math.abs((s.opacity.overlay ?? 0.75) - v) < 0.01;
                return (
                  <Pressable key={v} onPress={() => ovOpacity(v)} style={[st.opChip, on && st.opOn]}>
                    <Text style={[st.opT, on && { color: colors.accentInk }]}>{Math.round(v * 100)}%</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <Pressable onPress={() => set((p) => ({ ...p, tilt: !p.tilt }))} style={st.row} accessibilityRole="switch" accessibilityState={{ checked: !!s.tilt }}>
            <View style={{ flex: 1 }}>
              <Text style={st.rowT}>3D view</Text>
              <Text style={st.sub}>Tips the map back so canyons and banks stand out · best with Relief</Text>
            </View>
            <View style={[st.sw, s.tilt && st.swOn]}><View style={[st.knob, s.tilt && st.knobOn]} /></View>
          </Pressable>
          <Text style={st.note}>{s.overlay === 'satellite' ? 'Satellite: USGS / USDA aerial photos (US coast and land).' : s.overlay === 'relief' ? 'Relief: NOAA seafloor survey data. Lower the strength to see more chart detail.' : 'Official NOAA chart: depths, buoys, lights, channels and restricted areas.'}</Text>
        </View>

        <View>
          <Text style={st.group}>One-tap presets</Text>
          <View style={st.presets}>
            {PRESETS.map((p) => (
              <Pressable key={p.key} style={st.preset} onPress={() => { set((x) => ({ ...x, on: { ...x.on, ...p.on } as any })); track('preset_used', { preset: p.key }); }}>
                <Text style={st.presetT}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Text style={st.group}>Protected areas</Text>
          <Row k="rules" title="Marine protected areas (MPAs)" sub={rulesChecked ? `Solid red = no take · dashed red = limited take · tap one for its rules · CDFW boundaries checked ${new Date(rulesChecked).toLocaleDateString()}` : 'Solid red = no take · dashed red = limited take · tap one for its rules'} />
          <Text style={st.note}>You get an alert when your boat enters an MPA, even with no signal. You can silence it from the alert.</Text>
        </View>

        <View>
          <Text style={st.group}>Chart details</Text>
          <Text style={st.note}>Turn off what you don't need. These are drawn on the NOAA chart itself.</Text>
          {([
            ['navaids', 'Buoys, beacons & lights', 'Includes the colored light-range circles around lighthouses'],
            ['lanes', 'Shipping lanes & traffic routes', 'Traffic separation lanes, fairways, recommended tracks'],
            ['areas', 'Restricted & special areas', 'Anchorages, cable areas, military and restricted zones'],
            ['seabed', 'Wrecks, rocks & obstructions', 'Hazards on the bottom, pipelines and cables'],
            ['services', 'Marinas & services', 'Fuel, launch ramps, harbor facilities'],
          ] as const).map(([k, title, sub]) => {
            const on = s.chart?.[k] ?? true;
            return (
              <Pressable key={k} onPress={() => set((p) => ({ ...p, chart: { ...p.chart, [k]: !on } }))} style={st.row} accessibilityRole="switch" accessibilityState={{ checked: on }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowT}>{title}</Text>
                  <Text style={st.sub}>{sub}</Text>
                </View>
                <View style={[st.sw, on && st.swOn]}><View style={[st.knob, on && st.knobOn]} /></View>
              </Pressable>
            );
          })}
          {k_hazards(s) ? <Row k="hazards" title="Extra hazard markers" sub="Wreck and buoy dots from the offline pack" /> : null}
        </View>

        <View>
          <Text style={st.group}>Fishing</Text>
          <Row k="catches" title="Catch reports (Catch Map)" sub="Community catches · time filter on the map" />
          <Row k="buddies" title="My groups" sub="Buddy boats (live + last known), pings, shared catches and spots" />
        </View>

        <View>
          <Text style={st.group}>Seafloor</Text>
          <Row k="bathy" title="Relief & structure" sub={`Drop-offs and canyon walls in amber · ${when(bathy)}`} disabled={!bathy?.dates?.length} />
          {s.on.bathy ? <Op k="bathy" /> : null}
          <Row k="contours" title="Depth contours" sub="60 to 4,800 ft" disabled={!bathy?.dates?.[0]?.contours} />
          <Text style={st.note}>Seafloor information for fishing — not a navigation chart.</Text>
        </View>

        <View>
          <Text style={st.group}>Ocean</Text>
          <Row k="sst" title="Water temperature (SST)" sub={when(sst)} disabled={!sst?.dates?.length} />
          {s.on.sst ? <Op k="sst" /> : null}
          <Row k="breaks" title="Temperature breaks" sub="Found automatically · thick line = strong" disabled={!sst?.dates?.length} />
          <Row k="chl" title="Chlorophyll (water color)" sub={when(chl)} disabled={!chl?.dates?.length} />
          {s.on.chl ? <Op k="chl" /> : null}
          <Row k="chlEdges" title="Green-to-blue edges" sub="Dashed green lines" disabled={!chl?.dates?.length} />
        </View>

        <View>
          <Text style={st.group}>Weather</Text>
          <Row k="radar" title="Radar (rain)" sub={radar ? `${radar.source} · updates every few minutes · needs signal` : 'Not available'} disabled={!radar} />
          {s.on.radar ? (
            <View style={st.opRow}>
              <Pressable onPress={() => setRadarPlaying(!radarPlaying)} style={[st.opChip, radarPlaying && st.opOn, { flex: 2 }]}>
                <Text style={[st.opT, radarPlaying && { color: colors.accentInk }]}>{radarPlaying ? '■ Stop loop' : '▶ Loop last hour'}</Text>
              </Pressable>
            </View>
          ) : null}
          <Row k="wind" title="Wind forecast" sub={w?.run ? `${w.source} · model run ${ageText(w.run)}` : 'Not available yet'} disabled={!w?.hours?.length} />
          {s.on.wind && w?.hours?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
              {w.hours.map((h, i) => (
                <Pressable key={h.fh} onPress={() => set((p) => ({ ...p, windIndex: i }))} style={[st.opChip, { paddingHorizontal: 10 }, s.windIndex === i && st.opOn]}>
                  <Text style={[st.opT, s.windIndex === i && { color: colors.accentInk }]}>
                    {new Date(h.valid).toLocaleString([], { weekday: 'short', hour: 'numeric' })}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <Row k="buoys" title="Buoys (measured)" sub="Tap a buoy for wind, waves and water temp" />
          <Text style={st.note}>Wind arrows are a forecast (model). Buoys are real measurements.</Text>
        </View>
        {onSaveArea ? (
          <Pressable onPress={onSaveArea} style={[st.preset, { alignSelf: 'flex-start' }]}>
            <Text style={st.presetT}>⬇ Save this area offline (extra chart detail)</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingTop: 10 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '700' },
  close: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  closeT: { color: colors.text, fontSize: 18 },
  styles: { flexDirection: 'row', gap: 10, marginTop: 6 },
  styleCard: { flex: 1, alignItems: 'center', gap: 3 },
  thumbWrap: { width: '100%', aspectRatio: 1, borderRadius: 18, borderWidth: 2, borderColor: colors.border, padding: 3, backgroundColor: colors.panelSolid },
  thumbOn: { borderColor: colors.accent, borderWidth: 3 },
  thumb: { width: '100%', height: '100%', borderRadius: 14 },
  styleT: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 4 },
  styleSub: { color: colors.muted, fontSize: 11.5, textAlign: 'center' },
  group: { color: colors.muted, fontSize: 13, fontWeight: '700', marginBottom: 2, letterSpacing: 0.4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: touch.min, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 6 },
  rowT: { color: colors.text, fontSize: 16 },
  sub: { color: colors.muted, fontSize: 12 },
  note: { color: colors.muted, fontSize: 12, marginTop: 6 },
  sw: { width: 50, height: 30, borderRadius: 15, backgroundColor: colors.line, padding: 3 },
  swOn: { backgroundColor: colors.accent },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.muted },
  knobOn: { marginLeft: 20, backgroundColor: colors.accentInk },
  opRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  opChip: { flex: 1, height: 36, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  opOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  opT: { color: colors.text, fontSize: 13, fontWeight: '600' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { height: 42, paddingHorizontal: 14, borderRadius: 21, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  presetT: { color: colors.text, fontSize: 14 },
}));
