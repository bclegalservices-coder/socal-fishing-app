// Lightweight bar charts drawn with plain Views — no chart library to install, works on every device.
import { StyleSheet, Text, View } from 'react-native';
import { colors, makeStyles } from '../theme';

type Pt = { t: string; v: number | null };

export function Bars({ data, height = 90, color = colors.live, colorFor, unit = '', overlay, label, startLabel, endLabel, zeroBased = true }: {
  data: Pt[]; height?: number; color?: string; colorFor?: (v: number, i: number) => string; unit?: string;
  overlay?: (number | null)[]; label?: string; startLabel?: string; endLabel?: string; zeroBased?: boolean;
}) {
  const st = useSt();
  const vals = [...data.map((d) => d.v), ...(overlay ?? [])].filter((v): v is number => v != null);
  if (!vals.length) return <Text style={st.empty}>{label ? `${label}: ` : ''}no data</Text>;
  const hi = Math.max(...vals), loRaw = Math.min(...vals);
  const lo = zeroBased ? Math.min(0, loRaw) : loRaw - (hi - loRaw) * 0.15;
  const span = hi - lo || 1;
  const y = (v: number) => ((v - lo) / span) * height;
  return (
    <View style={{ gap: 4 }}>
      {label ? (
        <View style={st.head}>
          <Text style={st.label}>{label}</Text>
          <Text style={st.range}>{fmt(loRaw)}–{fmt(hi)}{unit}</Text>
        </View>
      ) : null}
      <View style={[st.plot, { height }]} accessible accessibilityLabel={`${label ?? 'Chart'}: from ${fmt(loRaw)} to ${fmt(hi)} ${unit}`}>
        {data.map((d, i) => (
          <View key={i} style={st.col}>
            {d.v != null ? <View style={{ height: Math.max(1, y(d.v)), backgroundColor: colorFor ? colorFor(d.v, i) : color, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} /> : null}
            {overlay && overlay[i] != null ? <View style={[st.dot, { bottom: y(overlay[i] as number) - 2 }]} /> : null}
          </View>
        ))}
      </View>
      {startLabel || endLabel ? (
        <View style={st.head}><Text style={st.axis}>{startLabel}</Text><Text style={st.axis}>{endLabel}</Text></View>
      ) : null}
    </View>
  );
}

const fmt = (v: number) => (Math.abs(v) >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());

const useSt = makeStyles((colors) => ({
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  range: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  axis: { color: colors.muted, fontSize: 11 },
  plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, borderBottomWidth: 1, borderColor: colors.line },
  col: { flex: 1, justifyContent: 'flex-end', height: '100%' },
  dot: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
}));
