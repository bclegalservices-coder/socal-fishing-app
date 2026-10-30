// Map options. Clean, app-style layout (think Instagram / Facebook settings): bold section titles, white cards,
// a colored icon per row, big custom switches in the brand color, and an "On now" strip at the top so you can see
// and turn off what's showing in one tap.
//
// Reliability (Oct 22): every row component lives at the top of this file. Before, rows were created inside the
// sheet, so React rebuilt every switch each time the GPS updated (once a second) and taps sometimes landed on a
// switch that was being replaced — the "toggle didn't work, close and reopen" bug. The whole row is now the one
// tap target, and the switch is just a picture of the state, so a tap can never count twice.
import { memo, useEffect, useRef } from 'react';
import { Animated, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ageText } from '../api';
import { colors, makeStyles, useTheme } from '../theme';
import { CHART_SETTINGS_AVAILABLE } from '../config';
import type { Catalog } from '../types';
import { external, grid, harborsOf, hdBottom, wind } from './catalog';
import { SPOT_COLORS } from './spotColors';
import { CHART_LOOKS, DEFAULT_LAYERS, PRESETS, type ChartLook, type LayerKey, type LayerState, type MapOverlay } from './state';
import { track } from '../analytics';
import { PresentedBy } from '../ads/Sponsor';

type Props = { catalog: Catalog | null; cached: boolean; savedAt?: number | null; onRetry?: () => void; s: LayerState; set: (fn: (s: LayerState) => LayerState) => void;
  radarPlaying: boolean; setRadarPlaying: (b: boolean) => void; onClose: () => void; rulesChecked?: string | null; onSaveArea?: () => void; killed?: string[] };
type Icon = keyof typeof MaterialCommunityIcons.glyphMap;

const OPACITIES = [0.15, 0.3, 0.5, 0.75, 1];
const STYLES: { key: MapOverlay; label: string; img: any }[] = [
  { key: 'none', label: 'Chart', img: require('../../assets/map-options/chart.png') },
  { key: 'relief', label: 'Relief', img: require('../../assets/map-options/relief.png') },
  { key: 'satellite', label: 'Satellite', img: require('../../assets/map-options/satellite.png') },
];
const STYLE_CARDS = STYLES.filter((x) => x.key !== 'relief' || CHART_SETTINGS_AVAILABLE);

const LOOKS: { key: ChartLook; label: string; icon: Icon; tint: string; sub: string }[] = [
  { key: 'clean', label: 'Clean', icon: 'map-outline', tint: '#8E8E93', sub: 'Coastline and depth shading. Calm and easy to read.' },
  { key: 'standard', label: 'Standard', icon: 'map-marker-radius-outline', tint: '#007AFF', sub: '+ buoys, lights, lanes, wrecks and restricted areas.' },
  { key: 'full', label: 'Full detail', icon: 'map-search-outline', tint: '#FF9500', sub: 'Every depth number and contour, even zoomed out.' },
];

const PRESET_LOOK: Record<string, { icon: Icon; tint: string; sub: string }> = {
  tuna: { icon: 'fish', tint: '#FF9500', sub: 'Water temp, breaks and color edges' },
  bottom: { icon: 'image-filter-hdr', tint: '#A2845E', sub: 'Seafloor relief and depth contours' },
  color: { icon: 'leaf', tint: '#34C759', sub: 'Chlorophyll and green-to-blue edges' },
  weather: { icon: 'weather-windy', tint: '#0A84FF', sub: 'Radar, wind and buoys' },
  chart: { icon: 'compass-outline', tint: '#8E8E93', sub: 'Just the NOAA chart' },
};
const C = { blue: '#0A84FF', teal: '#30B0C7', green: '#34C759', mint: '#00C7BE', orange: '#FF9500', red: '#FF3B30',
  purple: '#AF52DE', indigo: '#5856D6', gray: '#8E8E93', brown: '#A2845E', pink: '#FF2D55', yellow: '#FFCC00' };

/** Short names for the "On now" chips. */
const LABELS: Record<LayerKey, string> = {
  sst: 'Water temp', breaks: 'Temp breaks', chl: 'Chlorophyll', chlEdges: 'Color edges', radar: 'Radar', wind: 'Wind', buoys: 'Buoys',
  spots: 'Known spots', mySpots: 'My spots', air: 'Air traffic', catches: 'Catch reports', buddies: 'My groups', marinas: 'Marinas', docks: 'Docks', fuel: 'Fuel', bait: 'Bait',
  pumpout: 'Pump-outs', ramps: 'Ramps', bathy: 'Relief', bathyHd: 'HD bottom', contours: 'Contours', rules: 'MPAs', hazards: 'Hazards', sci: 'San Clemente', spotHist: 'Spotter activity',
};
const CHIP_ORDER: LayerKey[] = ['sst', 'breaks', 'chl', 'chlEdges', 'bathyHd', 'bathy', 'contours', 'radar', 'wind', 'buoys', 'mySpots', 'spots', 'air', 'spotHist', 'catches', 'buddies',
  'marinas', 'docks', 'fuel', 'bait', 'pumpout', 'ramps', 'rules', 'sci', 'hazards'];

// ---------------------------------------------------------------- building blocks (top level = stable)

function Tile({ icon, tint }: { icon: Icon; tint: string }) {
  const st = useSt();
  return <View style={[st.tile, { backgroundColor: tint }]}><MaterialCommunityIcons name={icon} size={18} color="#FFFFFF" /></View>;
}

/** Big, crisp switch in the brand color. Only a picture: the row around it takes the tap. */
function Toggle({ on }: { on: boolean }) {
  const st = useSt();
  const { mode } = useTheme();
  const a = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => { Animated.spring(a, { toValue: on ? 1 : 0, useNativeDriver: true, speed: 30, bounciness: 5 }).start(); }, [on]);
  const x = a.interpolate({ inputRange: [0, 1], outputRange: [0, 20] });
  return (
    <View style={st.tgl} pointerEvents="none">
      <Animated.View style={[st.tglOn, { opacity: a }]} />
      <Animated.View style={[st.knob, mode === 'night' && { backgroundColor: colors.text }, { transform: [{ translateX: x }] }]} />
    </View>
  );
}

function LayerRow({ icon, tint, title, sub, on, disabled, last, onPress }:
  { icon: Icon; tint: string; title: string; sub?: string; on: boolean; disabled?: boolean; last?: boolean; onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={disabled ? undefined : onPress} disabled={disabled} hitSlop={2}
      style={({ pressed }) => [st.row, on && st.rowOn, pressed && !disabled && st.rowPressed, disabled && { opacity: 0.4 }]}
      accessibilityRole="switch" accessibilityState={{ checked: on, disabled: !!disabled }} accessibilityLabel={title}>
      <Tile icon={icon} tint={tint} />
      <View style={[st.rowBody, !last && st.sep]}>
        <View style={{ flex: 1 }}>
          <Text style={[st.rowT, on && st.rowTOn]}>{title}</Text>
          {sub ? <Text style={st.rowS} numberOfLines={2}>{sub}</Text> : null}
        </View>
        <Toggle on={on} />
      </View>
    </Pressable>
  );
}

/** Segmented strength control (how see-through a layer is). */
function Strength({ value, onPick, label = 'Strength' }: { value: number; onPick: (v: number) => void; label?: string }) {
  const st = useSt();
  return (
    <View style={st.strength}>
      <Text style={st.strengthL}>{label}</Text>
      <View style={st.seg}>
        {OPACITIES.map((v) => {
          const on = Math.abs(value - v) < 0.01;
          return (
            <Pressable key={v} onPress={() => onPick(v)} style={[st.segI, on && st.segOn]} hitSlop={4} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[st.segT, on && st.segTOn]}>{Math.round(v * 100)}%</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Section({ title, foot, children }: { title?: string; foot?: string; children: any }) {
  const st = useSt();
  return (
    <View style={st.section}>
      {title ? <Text style={st.caption}>{title}</Text> : null}
      <View style={st.card}>{children}</View>
      {foot ? <Text style={st.foot}>{foot}</Text> : null}
    </View>
  );
}

function PickCard({ icon, tint, title, sub, active, onPress, narrow, role = 'button' }:
  { icon: Icon; tint: string; title: string; sub: string; active: boolean; onPress: () => void; narrow?: boolean; role?: 'button' | 'radio' }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.preset, narrow && st.look, active && st.presetOn, pressed && { transform: [{ scale: 0.97 }] }]}
      accessibilityRole={role} accessibilityState={{ selected: active }} accessibilityLabel={title}>
      <View style={st.presetTop}>
        <Tile icon={icon} tint={tint} />
        {active ? <MaterialCommunityIcons name="check-circle" size={22} color={colors.accent} /> : null}
      </View>
      <Text style={[st.presetT, active && { color: colors.accent }]}>{title}</Text>
      <Text style={st.presetS} numberOfLines={3}>{sub}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- the sheet

function LayersSheetInner({ catalog, cached, savedAt, onRetry, s, set, radarPlaying, setRadarPlaying, onClose, rulesChecked, onSaveArea, killed = [] }: Props) {
  const st = useSt();
  const insets = useSafeAreaInsets();
  const setOverlay = (o: MapOverlay) => { if (o !== 'none' && killed.includes(o)) return; set((p) => ({ ...p, overlay: o })); track('map_style', { style: o }); };
  // Water temp and chlorophyll each color the whole sea, and chlorophyll draws on top — with both on, water temp looked
  // like it wasn't working. Turning one on now turns the other off (their break / edge lines can stay on together).
  const toggle = (k: LayerKey) => set((p) => {
    const on = { ...p.on, [k]: !p.on[k] };
    if (on[k] && k === 'sst') on.chl = false;
    if (on[k] && k === 'chl') on.sst = false;
    return { ...p, on };
  });
  const opacity = (k: keyof LayerState['opacity'], v: number) => set((p) => ({ ...p, opacity: { ...p.opacity, [k]: v } }));
  const hc: Record<string, number> | undefined = harborsOf(catalog)?.counts;
  const sst = grid(catalog, 'sst'), chl = grid(catalog, 'chl'), bathy = grid(catalog, 'bathy'), w = wind(catalog), radar = external(catalog, 'radar');
  const hd = hdBottom(catalog);
  const latest = (l?: { dates?: { observed_at?: string | null }[]; available?: boolean }) =>
    !l || l.available === false || !l.dates?.length ? 'Not available yet' : `Satellite · ${ageText(l.dates[0].observed_at ?? null)}`;

  /** One layer row wired to the layer switches (and the admin's emergency off-switches). */
  // Called as a function (not <Row/>) so React keeps each LayerRow and its switch between redraws.
  const Row = ({ k, icon, tint, title, sub, disabled, last }: { k: LayerKey; icon: Icon; tint: string; title: string; sub?: string; disabled?: boolean; last?: boolean }) => {
    const off = killed.includes(k);
    return <LayerRow key={k} icon={icon} tint={tint} title={title} sub={off ? 'Temporarily off while we fix it — back soon' : sub}
      on={!!s.on[k]} disabled={disabled || off} last={last} onPress={() => toggle(k)} />;
  };

  const chartRows = ([
    ['navaids', 'lighthouse', C.pink, 'Buoys, lights & radio towers'],
    ...(CHART_SETTINGS_AVAILABLE ? [['lightCircles', 'circle-double', C.yellow, 'Lighthouse circles']] as const : []),
    ['lanes', 'ferry', C.indigo, 'Shipping lanes'],
    ['areas', 'cancel', C.red, 'Restricted & special areas'],
    ['seabed', 'cable-data', C.brown, 'Cables, pipelines, wrecks & rocks'],
    ['services', 'storefront-outline', C.teal, 'Chart marina symbols'],
    ...(CHART_SETTINGS_AVAILABLE ? [['simpleSymbols', 'shape-outline', C.gray, 'Simpler symbols']] as const : []),
  ] as const);

  const onNow = CHIP_ORDER.filter((k) => s.on[k]);
  const overlayOn = s.overlay && s.overlay !== 'none';

  return (
    <View style={[st.sheet, { top: insets.top + 64 }]}>
      <View style={st.grab} />
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <Text style={st.h1}>Map layers</Text>
          <Text style={st.count}>{onNow.length + (overlayOn ? 1 : 0)} on</Text>
        </View>
        <Pressable onPress={onClose} style={st.done} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close map options">
          <Text style={st.doneT}>Done</Text>
        </Pressable>
      </View>
      {cached ? (
        <Pressable onPress={onRetry} style={({ pressed }) => [st.offlineBox, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Try again">
          <MaterialCommunityIcons name="cloud-off-outline" size={18} color={colors.warn} />
          <Text style={[st.offline, { flex: 1, marginBottom: 0 }]}>Can't reach the server right now. Showing layers saved {savedAt ? new Date(savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'earlier'}. Retrying on its own.</Text>
          <Text style={st.retryT}>Try again</Text>
        </Pressable>
      ) : null}

      {/* On now: what's showing, tap a chip to turn it off */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips} style={st.chipStrip}>
        {overlayOn ? (
          <Pressable style={st.chip} onPress={() => setOverlay('none')} accessibilityRole="button" accessibilityLabel={`Turn off ${s.overlay}`}>
            <Text style={st.chipT}>{s.overlay === 'relief' ? 'Relief map' : 'Satellite'}</Text>
            <MaterialCommunityIcons name="close" size={14} color={colors.accentInk} />
          </Pressable>
        ) : null}
        {onNow.map((k) => (
          <Pressable key={k} style={st.chip} onPress={() => toggle(k)} accessibilityRole="button" accessibilityLabel={`Turn off ${LABELS[k]}`}>
            <Text style={st.chipT}>{LABELS[k]}</Text>
            <MaterialCommunityIcons name="close" size={14} color={colors.accentInk} />
          </Pressable>
        ))}
        {!onNow.length && !overlayOn ? <Text style={st.chipNone}>Nothing on — just the chart. Pick a quick setup below.</Text> : null}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ paddingBottom: 8 }}><PresentedBy section="Map Layers" /></View>

        {/* Quick setups first: the fastest way to the right map */}
        <Text style={st.caption}>Quick setups</Text>
        <View style={st.presets}>
          {PRESETS.map((p) => {
            const meta = PRESET_LOOK[p.key] ?? { icon: 'tune' as Icon, tint: C.gray, sub: '' };
            const active = Object.entries(p.on).every(([k, v]) => !!s.on[k as LayerKey] === !!v);
            return <PickCard key={p.key} icon={meta.icon} tint={meta.tint} title={p.label} sub={meta.sub} active={active}
              onPress={() => { set((x) => ({ ...x, on: { ...x.on, ...p.on } as any })); track('preset_used', { preset: p.key }); }} />;
          })}
        </View>

        {/* Map style */}
        <Text style={st.caption}>Base map</Text>
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
          {overlayOn ? <Strength value={s.opacity.overlay ?? 0.75} onPick={(v) => opacity('overlay', v)} /> : null}
          <LayerRow icon="rotate-3d-variant" tint={C.indigo} title="3D view" sub="Tilt the map so banks and canyons stand out" on={!!s.tilt} last
            onPress={() => set((p) => ({ ...p, tilt: !p.tilt }))} />
        </Section>

        {/* Chart style: how busy the NOAA chart itself is */}
        <Text style={st.caption}>Chart detail</Text>
        <View style={st.presets}>
          {LOOKS.map((l) => (
            <PickCard key={l.key} narrow role="radio" icon={l.icon} tint={l.tint} title={l.label} sub={l.sub} active={(s.chart?.look ?? 'standard') === l.key}
              onPress={() => { set((x) => ({ ...x, chart: { ...x.chart, look: l.key, ...CHART_LOOKS[l.key] } })); track('chart_look', { look: l.key }); }} />
          ))}
        </View>

        <Section title="Ocean" foot="Water temp and chlorophyll update every morning from satellites. They take turns: turning one on turns the other off, since both color the whole sea.">
          {Row({ k: "sst", icon: "thermometer-water", tint: C.orange, title: "Water temperature", sub: latest(sst), disabled: !sst?.dates?.length })}
          {s.on.sst ? <Strength value={s.opacity.sst} onPick={(v) => opacity('sst', v)} /> : null}
          {Row({ k: "breaks", icon: "chart-line-variant", tint: C.red, title: "Temperature breaks", sub: "Thicker line = stronger break", disabled: !sst?.dates?.length })}
          {Row({ k: "chl", icon: "leaf", tint: C.green, title: "Chlorophyll", sub: latest(chl), disabled: !chl?.dates?.length })}
          {s.on.chl ? <Strength value={s.opacity.chl} onPick={(v) => opacity('chl', v)} /> : null}
          {Row({ k: "chlEdges", icon: "vector-polyline", tint: C.mint, title: "Green-to-blue edges", sub: "Where bait-rich and clean water meet", disabled: !chl?.dates?.length, last: true })}
        </Section>

        <Section title="Seafloor" foot="For fishing, not navigation.">
          {Row({ k: "bathyHd", icon: "terrain", tint: '#0E7C86', title: "HD bottom", sub: hd ? `Sharp rocks, ledges and dense contours · ${hd.complete === false ? 'still being drawn · ' : ''}Catalina, Palos Verdes, LA–Long Beach for now` : 'Coming soon — being built', disabled: !hd })}
          {s.on.bathyHd ? <Strength value={s.opacity.bathyHd ?? 0.95} onPick={(v) => opacity('bathyHd', v)} /> : null}
          {Row({ k: "bathy", icon: "image-filter-hdr", tint: C.brown, title: "Relief & structure", sub: "Drop-offs and canyon walls", disabled: !bathy?.dates?.length })}
          {s.on.bathy ? <Strength value={s.opacity.bathy} onPick={(v) => opacity('bathy', v)} /> : null}
          {Row({ k: "contours", icon: "chart-bell-curve", tint: C.blue, title: "Depth contours", sub: bathy?.dates?.[0]?.contour_tiles ? 'Depth lines in feet, labeled every 100 ft' : 'Depth lines in feet', disabled: !bathy?.dates?.[0]?.contours, last: !(s.on.contours && bathy?.dates?.[0]?.contour_tiles) })}
          {s.on.contours && bathy?.dates?.[0]?.contour_tiles ? (
            <View style={st.strength}>
              <Text style={st.strengthL}>Detail</Text>
              <View style={st.seg}>
                {([['std', 'Standard'], ['max', 'Max · lots of lines']] as const).map(([k, label]) => {
                  const on = (s.contourDetail ?? 'std') === k;
                  return (
                    <Pressable key={k} onPress={() => { set((p) => ({ ...p, contourDetail: k })); track('contour_detail', { detail: k }); }} style={[st.segI, on && st.segOn]} hitSlop={4}
                      accessibilityRole="button" accessibilityState={{ selected: on }}>
                      <Text style={[st.segT, on && st.segTOn]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}
        </Section>

        <Section title="Weather" foot="Wind and forecast radar are model forecasts. Buoys are real measurements.">
          {Row({ k: "radar", icon: "weather-pouring", tint: C.blue, title: "Radar", sub: radar ? 'Live rain radar, plus the next 3 hours' : 'Not available', disabled: !radar })}
          {s.on.radar ? (
            <>
              <Pressable onPress={() => setRadarPlaying(!radarPlaying)} style={st.play} accessibilityRole="button">
                <MaterialCommunityIcons name={radarPlaying ? 'pause-circle' : 'play-circle'} size={22} color={colors.accent} />
                <Text style={st.playT}>{radarPlaying ? 'Pause radar loop' : 'Play past hour + next 3 hours'}</Text>
              </Pressable>
              <Strength value={s.opacity.radar} onPick={(v) => opacity('radar', v)} />
            </>
          ) : null}
          {Row({ k: "wind", icon: "weather-windy", tint: C.teal, title: "Wind", sub: w?.run ? `Speed colors and moving streaks · ${ageText(w.run)}` : 'Not available yet', disabled: !w?.hours?.length })}
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
          {Row({ k: "buoys", icon: "lifebuoy", tint: C.orange, title: "Buoys", sub: "Tap one for measured wind, waves and water temp", last: true })}
        </Section>

        <Section title="Fishing">
          {Row({ k: "mySpots", icon: "star", tint: SPOT_COLORS.mine, title: "My spots", sub: "Your saved spots · orange stars, only you see them" })}
          {Row({ k: "spots", icon: "map-marker", tint: SPOT_COLORS.known, title: "Known fishing spots", sub: "430 banks, high spots, reefs and kelp · blue dots" })}
          {Row({ k: "catches", icon: "fish", tint: C.blue, title: "Catch reports", sub: "What the community is catching" })}
          {Row({ k: "air", icon: "airplane", tint: "#FF5A00", title: "Air traffic · spotter planes", sub: "Planes and helicopters over the water, out past San Clemente. Circling ones flash orange — often a spotter on fish. Pro, free for now" })}
          {Row({ k: "spotHist", icon: "airplane-marker", tint: "#FF20D6", title: "Spotter activity · last 12 h", sub: "Where spotter planes circled today — their real flight paths, pink = now → blue = 12 h ago. Pro, free for now" })}
          {Row({ k: "buddies", icon: "account-group", tint: C.purple, title: "My groups", sub: "Buddy boats, pings and shared spots", last: true })}
        </Section>

        <Section title="Harbors & marinas" foot="© OpenStreetMap contributors and California State Parks. Confirm hours and fuel with the marina.">
          {Row({ k: "marinas", icon: "anchor", tint: C.indigo, title: "Marinas", sub: hc ? `${hc.marina ?? 0} marinas · tap for slips, VHF and hours` : undefined })}
          {Row({ k: "docks", icon: "pier", tint: C.gray, title: "Docks & piers", sub: "Shown when you zoom into a harbor" })}
          {Row({ k: "fuel", icon: "gas-station", tint: C.red, title: "Fuel docks", sub: hc ? `${hc.fuel ?? 0} fuel docks` : undefined })}
          {Row({ k: "bait", icon: "hook", tint: C.teal, title: "Bait", sub: hc ? `${(hc.bait ?? 0) + (hc.tackle ?? 0)} receivers and shops` : undefined })}
          {Row({ k: "pumpout", icon: "water-pump", tint: C.purple, title: "Pump-outs", sub: hc ? `${hc.pumpout ?? 0} stations` : undefined })}
          {Row({ k: "ramps", icon: "sail-boat", tint: C.green, title: "Launch ramps", sub: hc ? `${hc.ramp ?? 0} ramps and hoists` : undefined, last: true })}
        </Section>

        <Section title="Safety" foot={rulesChecked ? `CDFW boundaries checked ${new Date(rulesChecked).toLocaleDateString()}. You're alerted when entering an MPA, even offline.` : "You're alerted when entering an MPA, even offline."}>
          {Row({ k: "rules", icon: "shield-alert-outline", tint: C.red, title: "Marine protected areas", sub: "Solid = no take · dashed = limited take" })}
          {Row({ k: "sci", icon: "alert-octagon-outline", tint: C.red, title: "San Clemente Island closures", sub: "Navy safety-zone sections · red = closed now", last: !s.on.hazards })}
          {s.on.hazards ? Row({ k: "hazards", icon: "alert-outline", tint: C.orange, title: "Extra hazard markers", sub: "Wreck and buoy dots", last: true }) : null}
        </Section>

        <Section title="NOAA chart symbols" foot="These are drawn on the official chart. Turn off what you don't need.">
          {chartRows.map(([k, icon, tint, title], i) => {
            const on = s.chart?.[k] ?? DEFAULT_LAYERS.chart[k];
            return <LayerRow key={k} icon={icon as Icon} tint={tint} title={title} on={on} last={i === chartRows.length - 1}
              onPress={() => set((p) => ({ ...p, chart: { ...p.chart, [k]: !(p.chart?.[k] ?? DEFAULT_LAYERS.chart[k]) } }))} />;
          })}
        </Section>

        {onSaveArea ? (
          <Pressable onPress={onSaveArea} style={({ pressed }) => [st.save, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <MaterialCommunityIcons name="download-circle-outline" size={20} color={colors.accentInk} />
            <Text style={st.saveT}>Save this area for offline use</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Only redraws when something it shows changes (not on every GPS update). */
export const LayersSheet = memo(LayersSheetInner);

const useSt = makeStyles((colors) => ({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: -3 }, elevation: 12 },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, marginTop: 2 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  count: { color: colors.muted, fontSize: 13.5, fontWeight: '600', marginTop: 1 },
  done: { height: 36, paddingHorizontal: 18, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  doneT: { color: colors.accentInk, fontSize: 15.5, fontWeight: '800' },
  offline: { color: colors.warn, fontSize: 13, marginBottom: 6 },
  offlineBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.warn, marginBottom: 8 },
  retryT: { color: colors.live, fontWeight: '800', fontSize: 14 },

  // Oct 29: chips run edge to edge (no chip cut off at the sheet's padding), with a hairline under them
  chipStrip: { flexGrow: 0, marginHorizontal: -16, borderBottomWidth: 0.5, borderColor: colors.line, marginBottom: 14 },
  chips: { gap: 8, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 14, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingLeft: 13, paddingRight: 10, borderRadius: 16, backgroundColor: colors.accent },
  chipT: { color: colors.accentInk, fontSize: 14, fontWeight: '800' },
  chipNone: { color: colors.muted, fontSize: 13.5, fontWeight: '600', paddingVertical: 7 },

  styles: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  styleCard: { flex: 1, alignItems: 'center', gap: 6 },
  thumbWrap: { width: '100%', aspectRatio: 1.15, borderRadius: 16, borderWidth: 3, borderColor: 'transparent', padding: 2 },
  thumbOn: { borderColor: colors.accent },
  thumb: { width: '100%', height: '100%', borderRadius: 12 },
  styleT: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  styleTOn: { color: colors.accent, fontWeight: '800' },

  section: { marginBottom: 20 },
  caption: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.2, marginBottom: 8, marginLeft: 2 },
  card: { backgroundColor: colors.panelSolid, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  foot: { color: colors.muted, fontSize: 12.5, marginTop: 6, marginHorizontal: 6, lineHeight: 17 },

  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, minHeight: 60 },
  rowOn: { backgroundColor: `${colors.accent}12` },
  rowPressed: { backgroundColor: colors.inset },
  rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 14, marginLeft: 12 },
  sep: { borderBottomWidth: 0.5, borderColor: colors.line },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowT: { color: colors.text, fontSize: 16.5, fontWeight: '600' },
  rowTOn: { fontWeight: '800' },
  rowS: { color: colors.muted, fontSize: 13, marginTop: 2 },

  tgl: { width: 52, height: 32, borderRadius: 16, backgroundColor: colors.border, padding: 2, justifyContent: 'center' },
  tglOn: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 16, backgroundColor: colors.accent },
  knob: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 2 }, elevation: 3 },

  strength: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 60, paddingRight: 14, paddingVertical: 9, borderBottomWidth: 0.5, borderColor: colors.line },
  strengthL: { color: colors.muted, fontSize: 12.5, fontWeight: '600', width: 58 },
  seg: { flex: 1, flexDirection: 'row', backgroundColor: colors.inset, borderRadius: 10, padding: 2 },
  segI: { flex: 1, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segT: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  segTOn: { color: colors.accentInk, fontWeight: '800' },

  play: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 60, paddingVertical: 11, borderBottomWidth: 0.5, borderColor: colors.line },
  playT: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  hours: { gap: 6, paddingLeft: 60, paddingRight: 14, paddingVertical: 8 },
  hour: { minWidth: 52, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10, backgroundColor: colors.inset, alignItems: 'center' },
  hourOn: { backgroundColor: colors.accent },
  hourD: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  hourT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hd: { color: colors.accent, fontSize: 9, fontWeight: '800', marginTop: 1 },
  hourTOn: { color: colors.accentInk },

  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  preset: { width: '48%', flexGrow: 1, padding: 12, borderRadius: 16, backgroundColor: colors.panelSolid, borderWidth: 2, borderColor: colors.border, gap: 4 },
  presetOn: { borderColor: colors.accent, backgroundColor: `${colors.accent}12` },
  look: { width: '31%', flexGrow: 0, flexShrink: 1, padding: 10 },
  presetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  presetT: { color: colors.text, fontSize: 15.5, fontWeight: '800' },
  presetS: { color: colors.muted, fontSize: 12.5, lineHeight: 16 },

  save: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 26, backgroundColor: colors.accent },
  saveT: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
}));
