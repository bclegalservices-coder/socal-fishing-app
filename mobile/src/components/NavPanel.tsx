import { StyleSheet, Text, View } from 'react-native';
import { colors, makeStyles } from '../theme';
import { formatNm } from '../geo';
import { formatDuration } from '../nav';
import { Btn, Note, Row, Sheet, Stat } from './ui';

type Props = {
  target: string; legLabel: string | null;
  distNm: number | null; brg: number | null; cog: number | null; sog: number | null;
  etaMin: number | null; xteNm: number | null; steer: number | null;
  onEnd: () => void; onSkip?: () => void;
};

export function NavPanel(p: Props) {
  const s = useS();
  const steerTxt = p.steer == null ? 'Start moving to see steering'
    : Math.abs(p.steer) < 3 ? 'On course'
    : `Turn ${Math.abs(Math.round(p.steer))}° ${p.steer > 0 ? 'right' : 'left'}`;
  return (
    <Sheet maxHeight={420}>
      <Row>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>Go to · bearing to waypoint{p.legLabel ? ` · ${p.legLabel}` : ''}</Text>
          <Text style={s.target} numberOfLines={1}>{p.target}</Text>
        </View>
      </Row>
      <View style={s.steer}>
        <Text style={s.arrow}>{p.steer == null || Math.abs(p.steer) < 3 ? '↑' : p.steer > 0 ? '↗' : '↖'}</Text>
        <Text style={s.steerT}>{steerTxt}</Text>
      </View>
      <Row>
        <Stat big k="Distance" v={p.distNm != null ? `${formatNm(p.distNm)}` : '—'} />
        <Stat big k="Bearing °T" v={p.brg != null ? `${Math.round(p.brg)}°` : '—'} color={colors.accent} />
        <Stat big k="SOG kt" v={p.sog != null ? p.sog.toFixed(1) : '—'} color={colors.live} />
      </Row>
      <Row>
        <Stat k="COG" v={p.cog != null ? `${Math.round(p.cog)}°T` : '—'} />
        <Stat k="ETA" v={p.etaMin != null ? formatDuration(p.etaMin) : '—'} />
        <Stat k="Off course" v={p.xteNm != null ? `${Math.abs(p.xteNm).toFixed(2)} NM ${p.xteNm >= 0 ? 'R' : 'L'}` : '—'} />
      </Row>
      <Note color="#F7DDB0">Straight line only — not a safe route. Check the chart for islands, shallows, shipping lanes and MPAs. Keep a proper lookout.</Note>
      <Row>
        {p.onSkip ? <Btn label="Next leg" onPress={p.onSkip} /> : null}
        <Btn label="End" kind="danger" onPress={p.onEnd} />
      </Row>
    </Sheet>
  );
}

const useS = makeStyles((colors) => ({
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  target: { color: colors.text, fontSize: 24, fontWeight: '700' },
  steer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  arrow: { color: colors.accent, fontSize: 30, fontWeight: '800' },
  steerT: { color: colors.text, fontSize: 18, fontWeight: '600' },
}));
