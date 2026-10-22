// The instrument banner at the top of the map.
//  • Normal: position + GPS accuracy, then SPEED (knots + mph), HEADING (°T + compass point) and WATER temp (°F).
//  • Navigating (Go To / route), Garmin-style: three big boxes — distance to the next point, speed, arrival —
//    then the next instruction in plain words ("Turn right to 155° in 0.30 NM"), and a strip with bearing, heading,
//    water temp and how far off the line you are. Tap a big box to switch its units (NM ↔ miles, kt ↔ mph,
//    arrival time ↔ time to go); the choice is remembered. Turns red with a Re-route button when you're off course.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { cardStyle, colors, makeStyles } from '../theme';
import { cardinal, formatLatLon, knotsToMph } from '../geo';
import { formatDuration } from '../nav';

export type Fix = { lat: number; lon: number; speed: number | null; heading: number | null; accuracy: number | null; time: number };

export type HudNav = {
  target: string; legLabel: string | null;
  distNm: number | null; brg: number | null; etaMin: number | null; xteNm: number | null; steer: number | null;
  turnText?: string | null; offCourse?: boolean;
  onEnd: () => void; onSkip?: () => void; onReroute?: () => void;
};

type Props = { fix: Fix | null; status: string; sogKt: number | null; cogT: number | null; compass?: number | null; recording: boolean; nav?: HudNav | null;
  waterF?: number | null; waterCached?: boolean };

type Units = { dist: 'nm' | 'mi'; speed: 'kt' | 'mph'; eta: 'clock' | 'togo' };
const UNITS_KEY = 'hud-units:v1';
let savedUnits: Units = { dist: 'nm', speed: 'kt', eta: 'clock' };
AsyncStorage.getItem(UNITS_KEY).then((v) => { if (v) savedUnits = { ...savedUnits, ...JSON.parse(v) }; }).catch(() => {});

const deg3 = (d: number) => `${String(Math.round(((d % 360) + 360) % 360) % 360).padStart(3, '0')}°`;
const NM_TO_MI = 1.150779;

export function Hud({ fix, status, sogKt, cogT, compass, recording, nav, waterF, waterCached }: Props) {
  const s = useS();
  const [u, setU] = useState<Units>(savedUnits);
  useEffect(() => { setU(savedUnits); }, [!!nav]);
  const flip = (k: keyof Units) => {
    const next: Units = { ...u, [k]: k === 'dist' ? (u.dist === 'nm' ? 'mi' : 'nm') : k === 'speed' ? (u.speed === 'kt' ? 'mph' : 'kt') : (u.eta === 'clock' ? 'togo' : 'clock') } as Units;
    savedUnits = next; setU(next); AsyncStorage.setItem(UNITS_KEY, JSON.stringify(next)).catch(() => {});
  };

  // Heading: course over ground when moving (what the boat is actually doing), the phone compass when stopped.
  const moving = sogKt != null && sogKt >= 1;
  const hdg = moving && cogT != null ? cogT : compass ?? cogT;
  const hdgSrc = moving && cogT != null ? 'COG' : compass != null ? 'COMPASS' : 'COG';
  const kt = sogKt != null ? sogKt.toFixed(1) : '—';
  const mph = sogKt != null ? knotsToMph(sogKt).toFixed(1) : '—';
  const waterTxt = waterF != null ? `${waterF.toFixed(1)}°F` : '—';

  if (nav) {
    const off = !!nav.offCourse;
    const dist = nav.distNm == null ? '—' : u.dist === 'mi' ? (nav.distNm * NM_TO_MI).toFixed(nav.distNm < 10 ? 1 : 0) : nav.distNm.toFixed(nav.distNm < 10 ? 1 : 0);
    const spd = u.speed === 'kt' ? kt : mph;
    const eta = nav.etaMin == null ? '--:--'
      : u.eta === 'togo' ? formatDuration(nav.etaMin)
      : new Date(Date.now() + nav.etaMin * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const st = nav.steer;
    const steerIcon = off ? 'warning' : st == null || Math.abs(st) < 3 ? 'arrow-up' : st > 0 ? 'arrow-redo' : 'arrow-undo';
    const instruction = off
      ? `Off course ${nav.xteNm != null ? Math.abs(nav.xteNm).toFixed(2) : ''} NM ${nav.xteNm != null && nav.xteNm >= 0 ? 'right' : 'left'} · steer ${nav.brg != null ? deg3(nav.brg) : ''}`
      : nav.turnText ?? (st == null ? 'Start moving to steer' : Math.abs(st) < 3 ? 'On course' : `Turn ${Math.abs(Math.round(st))}° ${st > 0 ? 'right' : 'left'}`);
    return (
      <View style={[s.navBox, off && s.navOff]} accessibilityLabel={`Going to ${nav.target}. ${instruction}`}>
        {/* Three big boxes, like a plotter */}
        <View style={s.bar}>
          <Pressable style={s.box3} onPress={() => flip('dist')} accessibilityRole="button" accessibilityLabel="Distance, tap to switch units">
            <View style={s.box3Head}><Ionicons name="navigate" size={13} color={colors.accent} /><Ionicons name="arrow-forward" size={11} color="#9AA6B2" /><View style={s.wpDot} /></View>
            <Text style={s.huge} numberOfLines={1} adjustsFontSizeToFit>{dist}<Text style={s.hugeU}> {u.dist === 'nm' ? 'NM' : 'mi'}</Text></Text>
          </Pressable>
          <View style={s.div} />
          <Pressable style={s.box3} onPress={() => flip('speed')} accessibilityRole="button" accessibilityLabel="Speed, tap to switch units">
            <Text style={s.boxK}>{u.speed === 'kt' ? 'knots' : 'mph'}</Text>
            <Text style={s.huge} numberOfLines={1} adjustsFontSizeToFit>{spd}</Text>
          </Pressable>
          <View style={s.div} />
          <Pressable style={s.box3} onPress={() => flip('eta')} accessibilityRole="button" accessibilityLabel="Arrival, tap to switch">
            <Text style={s.boxK}>{u.eta === 'clock' ? 'arrive' : 'time to go'}</Text>
            <Text style={s.huge} numberOfLines={1} adjustsFontSizeToFit>{eta}</Text>
          </Pressable>
        </View>

        {/* Next instruction */}
        <View style={[s.turn, off && s.turnOff]}>
          <Ionicons name={steerIcon as any} size={20} color={off ? '#FFFFFF' : colors.accentInk} />
          <Text style={s.turnT} numberOfLines={2}>{instruction}</Text>
          {off && nav.onReroute ? (
            <Pressable onPress={nav.onReroute} style={s.reroute} hitSlop={6} accessibilityRole="button" accessibilityLabel="Re-route from here">
              <Text style={s.rerouteT}>Re-route</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Details strip + controls */}
        <View style={s.strip}>
          <Text style={s.stripT} numberOfLines={1}>
            <Text style={s.stripB}>{nav.target}</Text>{nav.legLabel ? ` · ${nav.legLabel}` : ''}
          </Text>
          {nav.onSkip ? (
            <Pressable onPress={nav.onSkip} style={s.navBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Next leg"><Text style={s.navBtnT}>Next</Text></Pressable>
          ) : null}
          <Pressable onPress={nav.onEnd} style={[s.navBtn, s.navEnd]} hitSlop={6} accessibilityRole="button" accessibilityLabel="End navigation">
            <Text style={[s.navBtnT, { color: '#FF6B5E' }]}>End</Text>
          </Pressable>
        </View>
        <Text style={s.stripS} numberOfLines={1}>
          BRG {nav.brg != null ? `${deg3(nav.brg)} ${cardinal(nav.brg)}` : '—'}  ·  HDG {hdg != null ? `${deg3(hdg)} ${cardinal(hdg)}` : '—'}  ·  {u.speed === 'kt' ? `${mph} mph` : `${kt} kt`}  ·  Water {waterTxt}  ·  Off line {nav.xteNm != null ? `${Math.abs(nav.xteNm).toFixed(2)} NM` : '—'}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.box} pointerEvents="none">
      <View style={s.top}>
        <Text style={s.pos} numberOfLines={1}>{fix ? formatLatLon(fix.lat, fix.lon) : status}</Text>
        {recording ? <Text style={s.rec}>● REC</Text> : <Text style={s.gps}>{fix?.accuracy != null ? `GPS ±${Math.round(fix.accuracy * 3.28084)} ft` : ''}</Text>}
      </View>
      <View style={s.row}>
        <View style={s.cell}>
          <Text style={s.k}>SPEED</Text>
          <Text style={s.big}>{kt}<Text style={s.unit}> kt</Text></Text>
          <Text style={s.sub}>{sogKt != null ? Math.round(knotsToMph(sogKt)) : '—'} mph</Text>
        </View>
        <View style={s.cell}>
          <Text style={s.k}>HEADING</Text>
          <Text style={s.big}>{hdg != null ? deg3(hdg) : '—'}<Text style={s.unit}>{hdg != null ? 'T' : ''}</Text></Text>
          <Text style={s.sub}>{hdg != null ? `${cardinal(hdg)} · ${hdgSrc}` : 'start moving'}</Text>
        </View>
        <View style={s.cell}>
          <Text style={s.k}>WATER</Text>
          <Text style={[s.big, { color: colors.live }]}>{waterF != null ? `${waterF.toFixed(1)}°` : '—'}<Text style={s.unit}>{waterF != null ? 'F' : ''}</Text></Text>
          <Text style={s.sub}>{waterF == null ? 'no reading yet' : waterCached ? 'saved reading' : 'satellite'}</Text>
        </View>
      </View>
    </View>
  );
}

// The nav bar is dark in day and night (like a plotter): big white numbers read in full sun and don't glare at night.
const useS = makeStyles((colors, mode) => ({
  box: { ...cardStyle(colors), backgroundColor: colors.panel, paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  pos: { color: colors.text, fontSize: 14.5, fontWeight: '600', fontVariant: ['tabular-nums'], flexShrink: 1 },
  gps: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },
  rec: { color: colors.alert, fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1 },
  k: { color: colors.muted, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8 },
  big: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  unit: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },

  navBox: { backgroundColor: mode === 'night' ? '#0D0706' : '#1F2329', borderRadius: 16, overflow: 'hidden',
    borderWidth: 1.5, borderColor: mode === 'night' ? colors.border : '#1F2329',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  navOff: { borderColor: '#FF3B30' },
  bar: { flexDirection: 'row', alignItems: 'stretch', paddingVertical: 6 },
  box3: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  box3Head: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 16 },
  wpDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#E43BE4', borderWidth: 1.5, borderColor: '#FFFFFF' },
  boxK: { color: mode === 'night' ? colors.muted : '#AEB8C2', fontSize: 12, fontWeight: '800', height: 16 },
  huge: { color: mode === 'night' ? colors.text : '#FFFFFF', fontSize: 38, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  hugeU: { fontSize: 15, fontWeight: '700', color: mode === 'night' ? colors.muted : '#C9D1D9' },
  div: { width: 1, backgroundColor: mode === 'night' ? colors.line : '#3A414A', marginVertical: 4 },
  turn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.accent },
  turnOff: { backgroundColor: '#D7261E' },
  turnT: { flex: 1, color: colors.accentInk, fontSize: 16.5, fontWeight: '800' },
  reroute: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 12, height: 30, justifyContent: 'center' },
  rerouteT: { color: '#D7261E', fontSize: 14, fontWeight: '800' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 7 },
  stripT: { flex: 1, color: mode === 'night' ? colors.muted : '#C9D1D9', fontSize: 13 },
  stripB: { color: mode === 'night' ? colors.text : '#FFFFFF', fontWeight: '800' },
  stripS: { color: mode === 'night' ? colors.faint : '#9AA6B2', fontSize: 11.5, fontWeight: '600', paddingHorizontal: 12, paddingTop: 3, paddingBottom: 8, fontVariant: ['tabular-nums'] },
  navBtn: { height: 28, paddingHorizontal: 12, borderRadius: 14, backgroundColor: mode === 'night' ? colors.inset : '#353C45', justifyContent: 'center' },
  navEnd: { backgroundColor: mode === 'night' ? colors.alertBg : '#4A2420' },
  navBtnT: { color: mode === 'night' ? colors.text : '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
}));
