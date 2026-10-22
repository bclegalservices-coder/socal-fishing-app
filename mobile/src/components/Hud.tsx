// The instrument banner at the top of the map.
//  • Normal: position + GPS accuracy, then SPEED (knots + mph), HEADING (°T + compass point) and WATER temp (°F).
//  • Navigating (Go To / route): the same banner turns into the nav display — where you're going, distance in
//    nautical miles, bearing, which way to turn, speed in knots + mph, your heading, ETA and how far off the line
//    you are. No big panel at the bottom, so the map stays visible.
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { cardStyle, colors, makeStyles } from '../theme';
import { cardinal, formatLatLon, formatNm, knotsToMph } from '../geo';
import { formatDuration } from '../nav';

export type Fix = { lat: number; lon: number; speed: number | null; heading: number | null; accuracy: number | null; time: number };

export type HudNav = {
  target: string; legLabel: string | null;
  distNm: number | null; brg: number | null; etaMin: number | null; xteNm: number | null; steer: number | null;
  onEnd: () => void; onSkip?: () => void;
};

type Props = { fix: Fix | null; status: string; sogKt: number | null; cogT: number | null; compass?: number | null; recording: boolean; nav?: HudNav | null;
  waterF?: number | null; waterCached?: boolean };

const deg3 = (d: number) => `${String(Math.round(d) % 360).padStart(3, '0')}°`;

export function Hud({ fix, status, sogKt, cogT, compass, recording, nav, waterF, waterCached }: Props) {
  const s = useS();
  // Heading: course over ground when moving (what the boat is actually doing), the phone compass when stopped.
  const moving = sogKt != null && sogKt >= 1;
  const hdg = moving && cogT != null ? cogT : compass ?? cogT;
  const hdgSrc = moving && cogT != null ? 'COG' : compass != null ? 'COMPASS' : 'COG';
  const kt = sogKt != null ? sogKt.toFixed(1) : '—';
  const mph = sogKt != null ? Math.round(knotsToMph(sogKt)).toString() : '—';

  const Speed = (
    <View style={s.cell}>
      <Text style={s.k}>SPEED</Text>
      <Text style={s.big}>{kt}<Text style={s.unit}> kt</Text></Text>
      <Text style={s.sub}>{mph} mph</Text>
    </View>
  );
  const Heading = (
    <View style={s.cell}>
      <Text style={s.k}>HEADING</Text>
      <Text style={s.big}>{hdg != null ? deg3(hdg) : '—'}<Text style={s.unit}>{hdg != null ? 'T' : ''}</Text></Text>
      <Text style={s.sub}>{hdg != null ? `${cardinal(hdg)} · ${hdgSrc}` : 'start moving'}</Text>
    </View>
  );

  const waterTxt = waterF != null ? `${waterF.toFixed(1)}°` : '—';
  const Water = (
    <View style={s.cell}>
      <Text style={s.k}>WATER</Text>
      <Text style={[s.big, { color: colors.live }]}>{waterTxt}<Text style={s.unit}>{waterF != null ? 'F' : ''}</Text></Text>
      <Text style={s.sub}>{waterF == null ? 'no reading yet' : waterCached ? 'saved reading' : 'satellite'}</Text>
    </View>
  );

  if (nav) {
    const st = nav.steer;
    const steerTxt = st == null ? 'Start moving to steer' : Math.abs(st) < 3 ? 'On course' : `Turn ${Math.abs(Math.round(st))}° ${st > 0 ? 'right' : 'left'}`;
    const steerIcon = st == null || Math.abs(st) < 3 ? 'arrow-up' : st > 0 ? 'arrow-redo' : 'arrow-undo';
    const onCourse = st != null && Math.abs(st) < 3;
    return (
      <View style={[s.box, s.navBox]} accessibilityLabel={`Going to ${nav.target}`}>
        <View style={s.navHead}>
          <Ionicons name="flag" size={15} color={colors.accent} />
          <Text style={s.navTarget} numberOfLines={1}>{nav.target}{nav.legLabel ? <Text style={s.navLeg}>  ·  {nav.legLabel}</Text> : null}</Text>
          {nav.onSkip ? (
            <Pressable onPress={nav.onSkip} style={s.navBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Next leg">
              <Text style={s.navBtnT}>Next</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={nav.onEnd} style={[s.navBtn, s.navEnd]} hitSlop={6} accessibilityRole="button" accessibilityLabel="End Go To">
            <Ionicons name="close" size={16} color={colors.alert} /><Text style={[s.navBtnT, { color: colors.alert }]}>End</Text>
          </Pressable>
        </View>
        <View style={s.row}>
          <View style={s.cell}>
            <Text style={s.k}>DISTANCE</Text>
            <Text style={s.big}>{nav.distNm != null ? formatNm(nav.distNm) : '—'}<Text style={s.unit}> NM</Text></Text>
            <Text style={s.sub}>{nav.etaMin != null ? `ETA ${formatDuration(nav.etaMin)}` : 'ETA —'}</Text>
          </View>
          <View style={s.cell}>
            <Text style={s.k}>BEARING</Text>
            <Text style={[s.big, { color: colors.accent }]}>{nav.brg != null ? deg3(nav.brg) : '—'}<Text style={s.unit}>{nav.brg != null ? 'T' : ''}</Text></Text>
            <Text style={s.sub}>{nav.brg != null ? `to waypoint · ${cardinal(nav.brg)}` : '—'}</Text>
          </View>
          {Speed}
        </View>
        <View style={s.navFoot}>
          <View style={[s.steer, onCourse && s.steerOk]}>
            <Ionicons name={steerIcon as any} size={15} color={onCourse ? colors.ok : colors.accent} />
            <Text style={[s.steerT, onCourse && { color: colors.ok }]}>{steerTxt}</Text>
          </View>
          <Text style={s.footT} numberOfLines={1}>
            HDG {hdg != null ? `${deg3(hdg)} ${cardinal(hdg)}` : '—'}  ·  Water {waterF != null ? `${waterF.toFixed(1)}°F` : '—'}  ·  Off line {nav.xteNm != null ? `${Math.abs(nav.xteNm).toFixed(2)} NM ${nav.xteNm >= 0 ? 'R' : 'L'}` : '—'}
          </Text>
        </View>
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
        {Speed}
        {Heading}
        {Water}
      </View>
    </View>
  );
}

const useS = makeStyles((colors) => ({
  box: { ...cardStyle(colors), backgroundColor: colors.panel, paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
  navBox: { borderColor: colors.accent, borderWidth: 1.5 },
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
  navHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navTarget: { flex: 1, color: colors.text, fontSize: 15.5, fontWeight: '800' },
  navLeg: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: colors.inset },
  navEnd: { backgroundColor: colors.alertBg },
  navBtnT: { color: colors.text, fontSize: 13.5, fontWeight: '800' },
  navFoot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  steer: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.warnBg },
  steerOk: { backgroundColor: colors.okBg },
  steerT: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  footT: { flex: 1, color: colors.muted, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
}));
