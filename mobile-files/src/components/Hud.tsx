import { StyleSheet, Text, View } from 'react-native';
import { cardStyle, colors, makeStyles } from '../theme';
import { formatLatLon } from '../geo';

export type Fix = { lat: number; lon: number; speed: number | null; heading: number | null; accuracy: number | null; time: number };

export function Hud({ fix, status, sogKt, cogT, recording }: { fix: Fix | null; status: string; sogKt: number | null; cogT: number | null; recording: boolean }) {
  const s = useS();
  return (
    <View style={s.box} pointerEvents="none">
      <View style={s.top}>
        <Text style={s.pos}>{fix ? formatLatLon(fix.lat, fix.lon) : status}</Text>
        {recording ? <Text style={s.rec}>● REC</Text> : null}
      </View>
      <View style={s.row}>
        <View><Text style={s.k}>SOG</Text><Text style={s.big}>{sogKt != null ? sogKt.toFixed(1) : '—'}<Text style={s.unit}> kt</Text></Text></View>
        <View><Text style={s.k}>COG</Text><Text style={s.big}>{cogT != null ? `${Math.round(cogT)}°` : '—'}<Text style={s.unit}>{cogT != null ? 'T' : ''}</Text></Text></View>
        <View><Text style={s.k}>GPS</Text><Text style={s.small}>{fix?.accuracy != null ? `±${Math.round(fix.accuracy)} m` : '—'}</Text></View>
      </View>
    </View>
  );
}

const useS = makeStyles((colors) => ({
  box: { ...cardStyle(colors), backgroundColor: colors.panel, paddingVertical: 8, paddingHorizontal: 12, gap: 2 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pos: { color: colors.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  rec: { color: colors.alert, fontSize: 12, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 22, alignItems: 'flex-end' },
  k: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  big: { color: colors.text, fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  unit: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  small: { color: colors.text, fontSize: 15, fontWeight: '600', paddingBottom: 4 },
}));
