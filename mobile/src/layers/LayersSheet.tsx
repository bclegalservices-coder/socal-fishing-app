// Map options — laid out like iOS Settings: grouped cards, a colored icon per row, native switches,
// one short line under each title, and the long chart-detail list folded away until you need it.
import { Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ageText } from '../api';
import { colors, makeStyles, useTheme } from '../theme';
import { CHART_SETTINGS_AVAILABLE } from '../config';
import type { Catalog } from '../types';
import { external, grid, harborsOf, wind } from './catalog';
import { DEFAULT_LAYERS, PRESETS, type LayerKey, type LayerState, type MapOverlay } from './state';
import { track } from '../analytics';

type Props = { catalog: Catalog | null; cached: boolean; s: LayerState; set: (fn: (s: LayerState) => LayerState) => void;
  radarPlaying: boolean; setRadarPlaying: (b: boolean) => void; onClose: () => void; rulesChecked?: string | null; onSaveArea?: () => void };
type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

const OPACITIES = [0.15, 0.3, 0.5, 0.75, 1];
const STYLES: { key: MapOverlay; label: string; img: any }[] = [
  { key: 'none', label: 'Chart', img: require('../../assets/map-options/chart.png') },
  { key: 'relief', label: 'Relief', img: require('../../assets/map-options/relief.png') },
  { key: 'satellite', label: 'Satellite', img: require('../../assets/map-options/satellite.png') },
];
const STYLE_CARDS = STYLES.filter((x) => x.key !== 'relief' || CHART_SETTINGS_AVAILABLE);

const PRESET_LOOK: Record<string, { icon: Icon; tint: string; sub: string }> = {
  tuna: { icon: 'fish', tint: '#FF9500', sub: 'Water temp, breaks and color edges' },
  bottom: { icon: 'image-filter-hdr', tint: '#A2845E', sub: 'Seafloor relief and depth contours' },
  color: { icon: 'leaf', tint: '#34C759', sub: 'Chlorophyll and green-to-blue edges' },
  weather: { icon: 'weather-windy', tint: '#0A84FF', sub: 'Radar, wind and buoys' },
  chart: { icon: 'compass-outline', tint: '#8E8E93', sub: 'Just the NOAA chart' },
};
// iOS system colors for the little icon tiles
const C = { blue: '#0A84FF', teal: '#30B0C7', green: '#34C759', mint: '#00C7BE', orange: '#FF9500', red: '#FF3B30',
  purple: '#AF52DE', indigo: '#5856D6', gray: '#8E8E93', brown: '#A2845E', pink: '#FF2D55', yellow: '#FFCC00' };

export function LayersSheet({ catalog, cached, s, set, radarPlaying, setRadarPlaying, onClose, rulesChecked, onSaveArea }: Props) {
  const st = useSt();
  const { mode } = useTheme();
  const insets = useSafeAreaInsets();
  const setOverlay = (o: MapOverlay) => { set((p) => ({ ...p, overlay: o })); track('map_style', { style: o }); };
  const toggle = (k: LayerKey) => set((p) => ({ ...p, on: { ...p.on, [k]: !p.on[k] } }));
  const opacity = (k: keyof LayerState['opacity'], v: number) => set((p) => ({ ...p, opacity: { ...p.opacity, [k]: v } }));
  const hc: Record<string, number> | undefined = harborsOf(catalog)?.counts;
  const sst = grid(catalog, 'sst'), chl = grid(catalog, 'chl'), bathy = grid(catalog, 'bathy'), w = wind(catalog), radar = external(catalog, 'radar');
  const latest = (l?: { dates?: { observed_at?: string | null }[]; available?: boolean }) =>
    !l || l.available === false || !l.dates?.length ? 'Not available yet' : `Satellite · ${ageText(l.dates[0].observed_at ?? null)}`;
  const track_on = mode === 'night' ? '#30D158' : C.green;

  const Tile = ({ icon, tint }: { icon: Icon; tint: string }) => (
    <View style={[st.tile, { backgroundColor: tint }]}><MaterialCommunityIcons name={icon} size={18} color="#FFFFFF" /></View>
  );
  const Toggle = ({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) => (
    <Switch value={on} onValueChange={onChange} disabled={disabled} trackColor={{ true: track_on, false: undefined }} accessibilityLabel={label} />
  );
  const Row = ({ k, icon, tint, title, sub, disabled, last }: { k: LayerKey; icon: Icon; tint: string; title: string; sub?: string; disabled?: boolean; last?: boolean }) => (
    <Pressable onPress={() => !disabled && toggle(k)} style={[st.row, disabled && { opacity: 0.4 }]}>
      <Tile icon={icon} tint={tint} />
      <View style={[st.rowBody, !last && st.sep]}>
        <View style={{ flex: 1 }}>
          <Text style={st.rowT}>{title}</Text>
          {sub ? <Text style={st.rowS} numberOfLines={2}>{sub}</Text> : null}
        </View>
        <Toggle on={!!s.on[k]} onChange={() => toggle(k)} label={title} disabled={disabled} />
      </View>
    </Pressable>
  );
  /** iOS-style segmented control for strength. */
  const Strength = ({ value, onPick, label = 'Strength' }: { value: number; onPick: (v: number) => void; label?: string }) => (
    <View style={st.strength}>
      <Text style={st.strengthL}>{label}</Text>
      <View style={st.seg}>
        {OPACITIES.map((v) => {
          const on = Math.abs(value - v) < 0.01;
          return (
            <Pressable key={v} onPress={() => onPick(v)} style={[st.segI, on && st.segOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[st.segT, on && st.segTOn]}>{Math.round(v * 100)}%</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
  const Section = ({ title, foot, children }: { title?: string; foot?: string; children: any }) => (
    <View style={st.section}>
      {title ? <Text style={st.caption}>{title}</Text> : null}
      <View style={st.card}>{children}</View>
      {foot ? <Text style={st.foot}>{foot}</Text> : null}
    </View>
  );

  const chartRows = ([
    ['navaids', 'lighthouse', C.pink, 'Buoys, lights & radio towers'],
    ...(CHART_SETTINGS_AVAILABLE ? [['lightCircles', 'circle-double', C.yellow, 'Lighthouse circles']] as const : []),
    ['lanes', 'ferry', C.indigo, 'Shipping lanes'],
    ['areas', 'cancel', C.red, 'Restricted & special areas'],
    ['seabed', 'cable-data', C.brown, 'Cables, pipelines, wrecks & rocks'],
    ['services', 'storefront-outline', C.teal, 'Chart marina symbols'],
    ...(CHART_SETTINGS_AVAILABLE ? [['simpleSymbols', 'shape-outline', C.gray, 'Simpler symbols']] as const : []),
  ] as const);

  return (
    <View style={[st.sheet, { top: insets.top + 56 }]}>
      <View style={st.head}>
        <Text style={st.h1}>Map</Text>
        <Pressable onPress={onClose} style={st.close} hitSlop={8} accessibilityLabel="Close map options">
          <MaterialCommunityIcons name="close" size={18} color={colors.muted} />
        </Pressable>
      </View>
      {cached ? <Text style={st.offline}>Offline · showing the layer list saved earlier</Text> : null}

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        {/* Map style */}
        <View style={st.styles}>
          {STYLE_CARDS.map((m) => {
            const on = (s.overlay ?? 'none') === m.key;
            return (
              <Pressable key={m.key} onPress={() => setOverlay(m.key)} style={st.styleCard} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={m.label}>
                <View style={[st.thumbWrap, on && st.thumbOn]}><Image source={m.img} style={st.thumb} /></View>
                <Text style={[st.styleT, on && st.styleTOn]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Section>
          {s.overlay && s.overlay !== 'none' ? <Strength value={s.opacity.overlay ?? 0.75} onPick={(v) => opacity('overlay', v)} /> : null}
          <Pressable onPress={() => set((p) => ({ ...p, tilt: !p.tilt }))} style={st.row}>
            <Tile icon="rotate-3d-variant" tint={C.indigo} />
            <View style={st.rowBody}>
              <View style={{ flex: 1 }}><Text style={st.rowT}>3D view</Text><Text style={st.rowS}>Tilt the map so banks and canyons stand out</Text></View>
              <Toggle on={!!s.tilt} onChange={() => set((p) => ({ ...p, tilt: !p.tilt }))} label="3D view" />
            </View>
          </Pressable>
        </Section>

        {/* Quick setups: one tap turns on the layers for a kind of trip */}
        <Text style={st.caption}>Quick setups</Text>
        <View style={st.presets}>
          {PRESETS.map((p) => {
            const meta = PRESET_LOOK[p.key] ?? { icon: 'tune' as Icon, tint: C.gray, sub: '' };
            const active = Object.entries(p.on).every(([k, v]) => !!s.on[k as LayerKey] === !!v);
            return (
              <Pressable key={p.key} style={[st.preset, active && st.presetOn]} accessibilityRole="button" accessibilityState={{ selected: active }}
                onPress={() => { set((x) => ({ ...x, on: { ...x.on, ...p.on } as any })); track('preset_used', { preset: p.key }); }}>
                <View style={st.presetTop}>
                  <Tile icon={meta.icon} tint={meta.tint} />
                  {active ? <MaterialCommunityIcons name="check-circle" size={20} color={colors.accent} /> : null}
                </View>
                <Text style={st.presetT}>{p.label}</Text>
                <Text style={st.presetS} numberOfLines={2}>{meta.sub}</Text>
              </Pressable>
            );
          })}
        </View>

        <Section title="Ocean" foot="Water temp and chlorophyll update every morning from satellites.">
          <Row k="sst" icon="thermometer-water" tint={C.orange} title="Water temperature" sub={latest(sst)} disabled={!sst?.dates?.length} />
          {s.on.sst ? <Strength value={s.opacity.sst} onPick={(v) => opacity('sst', v)} /> : null}
          <Row k="breaks" icon="chart-line-variant" tint={C.red} title="Temperature breaks" sub="Thicker line = stronger break" disabled={!sst?.dates?.length} />
          <Row k="chl" icon="leaf" tint={C.green} title="Chlorophyll" sub={latest(chl)} disabled={!chl?.dates?.length} />
          {s.on.chl ? <Strength value={s.opacity.chl} onPick={(v) => opacity('chl', v)} /> : null}
          <Row k="chlEdges" icon="vector-polyline" tint={C.mint} title="Green-to-blue edges" sub="Where bait-rich and clean water meet" disabled={!chl?.dates?.length} last />
        </Section>

        <Section title="Weather" foot="Wind and forecast radar are model forecasts. Buoys are real measurements.">
          <Row k="radar" icon="weather-pouring" tint={C.blue} title="Radar" sub={radar ? 'Live rain radar, plus the next 3 hours' : 'Not available'} disabled={!radar} />
          {s.on.radar ? (
            <>
              <Pressable onPress={() => setRadarPlaying(!radarPlaying)} style={st.play}>
                <MaterialCommunityIcons name={radarPlaying ? 'pause' : 'play'} size={18} color={colors.accent} />
                <Text style={st.playT}>{radarPlaying ? 'Pause' : 'Play past hour + next 3 hours'}</Text>
              </Pressable>
              <Strength value={s.opacity.radar} onPick={(v) => opacity('radar', v)} />
            </>
          ) : null}
          <Row k="wind" icon="weather-windy" tint={C.teal} title="Wind" sub={w?.run ? `Speed colors and moving streaks · ${ageText(w.run)}` : 'Not available yet'} disabled={!w?.hours?.length} />
          {s.on.wind ? <Strength value={s.opacity.wind ?? 0.3} onPick={(v) => opacity('wind', v)} /> : null}
          {s.on.wind && w?.hours?.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.hours}>
              {w.hours.map((h, i) => {
                const on = s.windIndex === i;
                const hd = (h as any).model?.startsWith('HRRR');
                return (
                  <Pressable key={h.fh} onPress={() => set((p) => ({ ...p, windIndex: i }))} style={[st.hour, on && st.hourOn]}>
                    <Text style={[st.hourD, on && st.hourTOn]}>{new Date(h.valid).toLocaleDateString([], { weekday: 'short' })}</Text>
                    <Text style={[st.hourT, on && st.hourTOn]}>{new Date(h.valid).toLocaleTimeString([], { hour: 'numeric' })}</Text>
                    {hd ? <Text style={[st.hd, on && st.hourTOn]}>HD</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          <Row k="buoys" icon="lifebuoy" tint={C.orange} title="Buoys" sub="Tap one for measured wind, waves and water temp" last />
        </Section>

        <Section title="Fishing">
          <Row k="spots" icon="map-marker-star" tint={C.orange} title="Known fishing spots" sub="430 banks, high spots, reefs and kelp" />
          <Row k="catches" icon="fish" tint={C.blue} title="Catch reports" sub="What the community is catching" />
          <Row k="buddies" icon="account-group" tint={C.purple} title="My groups" sub="Buddy boats, pings and shared spots" last />
        </Section>

        <Section title="Harbors & marinas" foot="© OpenStreetMap contributors and California State Parks. Confirm hours and fuel with the marina.">
          <Row k="marinas" icon="anchor" tint={C.indigo} title="Marinas" sub={hc ? `${hc.marina ?? 0} marinas · tap for slips, VHF and hours` : undefined} />
          <Row k="docks" icon="pier" tint={C.gray} title="Docks & piers" sub="Shown when you zoom into a harbor" />
          <Row k="fuel" icon="gas-station" tint={C.red} title="Fuel docks" sub={hc ? `${hc.fuel ?? 0} fuel docks` : undefined} />
          <Row k="bait" icon="hook" tint={C.teal} title="Bait" sub={hc ? `${(hc.bait ?? 0) + (hc.tackle ?? 0)} receivers and shops` : undefined} />
          <Row k="pumpout" icon="water-pump" tint={C.purple} title="Pump-outs" sub={hc ? `${hc.pumpout ?? 0} stations` : undefined} />
          <Row k="ramps" icon="sail-boat" tint={C.green} title="Launch ramps" sub={hc ? `${hc.ramp ?? 0} ramps and hoists` : undefined} last />
        </Section>

        <Section title="Seafloor" foot="For fishing, not navigation.">
          <Row k="bathy" icon="image-filter-hdr" tint={C.brown} title="Relief & structure" sub="Drop-offs and canyon walls" disabled={!bathy?.dates?.length} />
          {s.on.bathy ? <Strength value={s.opacity.bathy} onPick={(v) => opacity('bathy', v)} /> : null}
          <Row k="contours" icon="chart-bell-curve" tint={C.blue} title="Depth contours" sub="60 to 4,800 ft" disabled={!bathy?.dates?.[0]?.contours} last />
        </Section>

        <Section title="Safety" foot={rulesChecked ? `CDFW boundaries checked ${new Date(rulesChecked).toLocaleDateString()}. You're alerted when entering an MPA, even offline.` : "You're alerted when entering an MPA, even offline."}>
          <Row k="rules" icon="shield-alert-outline" tint={C.red} title="Marine protected areas" sub="Solid = no take · dashed = limited take" last={!s.on.hazards} />
          {s.on.hazards ? <Row k="hazards" icon="alert-outline" tint={C.orange} title="Extra hazard markers" sub="Wreck and buoy dots" last /> : null}
        </Section>

        <Section title="NOAA chart details" foot="These are drawn on the official chart. Turn off what you don't need.">
          {chartRows.map(([k, icon, tint, title], i) => {
            const on = s.chart?.[k] ?? DEFAULT_LAYERS.chart[k];
            const flip = () => set((p) => ({ ...p, chart: { ...p.chart, [k]: !on } }));
            return (
              <Pressable key={k} onPress={flip} style={st.row}>
                <Tile icon={icon as Icon} tint={tint} />
                <View style={[st.rowBody, i < chartRows.length - 1 && st.sep]}>
                  <Text style={[st.rowT, { flex: 1 }]}>{title}</Text>
                  <Toggle on={on} onChange={flip} label={title} />
                </View>
              </Pressable>
            );
          })}
        </Section>

        {onSaveArea ? (
          <Pressable onPress={onSaveArea} style={st.save}>
            <MaterialCommunityIcons name="download-circle-outline" size={20} color={colors.accent} />
            <Text style={st.saveT}>Save this area for offline use</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: -2 } },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  h1: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.4 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  offline: { color: colors.warn, fontSize: 13, marginBottom: 6 },

  styles: { flexDirection: 'row', gap: 12, marginTop: 4, marginBottom: 14 },
  styleCard: { flex: 1, alignItems: 'center', gap: 6 },
  thumbWrap: { width: '100%', aspectRatio: 1.15, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', padding: 2 },
  thumbOn: { borderColor: colors.accent },
  thumb: { width: '100%', height: '100%', borderRadius: 11 },
  styleT: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  styleTOn: { color: colors.text, fontWeight: '700' },

  section: { marginBottom: 18 },
  caption: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginLeft: 14 },
  card: { backgroundColor: colors.panelSolid, borderRadius: 12, overflow: 'hidden' },
  foot: { color: colors.muted, fontSize: 12.5, marginTop: 6, marginHorizontal: 14, lineHeight: 17 },

  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, minHeight: 52 },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingRight: 14, marginLeft: 12 },
  sep: { borderBottomWidth: 0.5, borderColor: colors.line },
  tile: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  rowT: { color: colors.text, fontSize: 16.5 },
  rowS: { color: colors.muted, fontSize: 12.5, marginTop: 1 },

  strength: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 56, paddingRight: 14, paddingVertical: 8, borderBottomWidth: 0.5, borderColor: colors.line },
  strengthL: { color: colors.muted, fontSize: 12.5, width: 58 },
  seg: { flex: 1, flexDirection: 'row', backgroundColor: colors.inset, borderRadius: 9, padding: 2 },
  segI: { flex: 1, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.panelSolid, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
  segT: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  segTOn: { color: colors.text, fontWeight: '700' },

  play: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 56, paddingVertical: 11, borderBottomWidth: 0.5, borderColor: colors.line },
  playT: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  hours: { gap: 6, paddingLeft: 56, paddingRight: 14, paddingVertical: 8 },
  hour: { minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.inset, alignItems: 'center' },
  hourOn: { backgroundColor: colors.accent },
  hourD: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  hourT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hd: { color: colors.accent, fontSize: 9, fontWeight: '800', marginTop: 1 },
  hourTOn: { color: colors.accentInk },

  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  preset: { width: '48%', flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: colors.panelSolid, borderWidth: 2, borderColor: 'transparent', gap: 4 },
  presetOn: { borderColor: colors.accent },
  presetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  presetT: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  presetS: { color: colors.muted, fontSize: 12.5, lineHeight: 16 },

  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 48, borderRadius: 12, backgroundColor: colors.panelSolid },
  saveT: { color: colors.accent, fontSize: 16, fontWeight: '600' },
}));
