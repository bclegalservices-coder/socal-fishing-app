// Weather → Moon tab: a picture of tonight's moon, phase, % lit, age, moonrise / moonset, the next 7 nights and
// the upcoming new / quarter / full moon dates. All calculated on the phone (moon.ts), so it works offline.
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors, makeStyles } from '../theme';
import { Btn, Note } from '../components/ui';
import { moonDay, nextPhases } from './moon';

const LIT = '#F2EEDF', DARK = '#26303D', CRATER = 'rgba(70,70,60,0.13)';
const DAY_MS = 86400000;

/** The moon as seen from California: lit on the right while growing (waxing), on the left while shrinking. */
export function MoonGraphic({ phase, fraction, size = 160 }: { phase: number; fraction: number; size?: number }) {
  const waxing = (((phase % 1) + 1) % 1) < 0.5;
  const k = Math.abs(1 - 2 * fraction);   // width of the shadow line's curve
  const half = size / 2;
  const craters = [[0.28, 0.3, 0.16], [0.58, 0.22, 0.1], [0.62, 0.58, 0.2], [0.3, 0.66, 0.12], [0.45, 0.45, 0.07]];
  return (
    <View style={{ width: size, height: size, borderRadius: half, backgroundColor: DARK, shadowColor: LIT, shadowOpacity: 0.25 + 0.35 * fraction, shadowRadius: size / 8, shadowOffset: { width: 0, height: 0 } }}
      accessibilityLabel={`Moon ${Math.round(fraction * 100)} percent lit`}>
      <View style={{ width: size, height: size, borderRadius: half, overflow: 'hidden', backgroundColor: DARK }}>
        <View style={{ position: 'absolute', top: 0, bottom: 0, width: half, [waxing ? 'right' : 'left']: 0, backgroundColor: LIT }} />
        <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size, borderRadius: half,
          backgroundColor: fraction < 0.5 ? DARK : LIT, transform: [{ scaleX: Math.max(0.001, k) }] }} />
        {craters.map(([x, y, r], i) => (
          <View key={i} style={{ position: 'absolute', left: x * size, top: y * size, width: r * size, height: r * size, borderRadius: (r * size) / 2, backgroundColor: CRATER }} />
        ))}
      </View>
    </View>
  );
}

const time = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
const dayLabel = (d: Date) => d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export function MoonView({ lat, lon, place }: { lat: number; lon: number; place: string }) {
  const st = useSt();
  const [offset, setOffset] = useState(0);   // days from today
  const day = useMemo(() => new Date(Date.now() + offset * DAY_MS), [offset]);
  const m = useMemo(() => moonDay(day, lat, lon), [day.toDateString(), lat, lon]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(day.getTime() + (i + 1) * DAY_MS);
    return { d, m: moonDay(d, lat, lon) };
  }), [day.toDateString(), lat, lon]);
  const upcoming = useMemo(() => nextPhases(day.getTime()), [day.toDateString()]);
  const isToday = offset === 0;

  return (
    <ScrollView contentContainerStyle={st.body}>
      <View style={st.dateRow}>
        <Btn label="Day" icon="chevron-back" onPress={() => setOffset(offset - 1)} />
        <Btn label="Today" kind={isToday ? 'primary' : 'plain'} onPress={() => setOffset(0)} />
        <Btn label="Day" icon="chevron-forward" onPress={() => setOffset(offset + 1)} />
      </View>

      <View style={st.hero}>
        <Text style={st.heroDate}>{isToday ? 'Tonight' : dayLabel(day)} · {place}</Text>
        <View style={{ alignItems: 'center', paddingVertical: 18 }}>
          <MoonGraphic phase={m.phase} fraction={m.fraction} size={170} />
        </View>
        <Text style={st.heroName}>{m.name}</Text>
        {m.event ? <Text style={st.heroEvent}>Exactly at {time(m.event.at)}</Text> : null}
        <View style={st.stats}>
          <Stat label="Lit" value={`${Math.round(m.fraction * 100)}%`} />
          <Stat label="Age" value={`${Math.round(m.age)} days`} />
          <Stat label="Moonrise" value={time(m.rise)} />
          <Stat label="Moonset" value={time(m.set)} />
        </View>
        {m.highest ? <Text style={st.heroSub}>Highest in the sky at {time(m.highest)} ({Math.round(m.highestAlt ?? 0)}° up)</Text> : null}
      </View>

      <View style={st.card}>
        <Text style={st.cardH}>Next 7 nights</Text>
        <View style={st.grid}>
          {week.map(({ d, m: w }) => (
            <View key={d.toDateString()} style={st.cell}>
              <Text style={st.cellDay}>{d.toLocaleDateString([], { weekday: 'short' })}</Text>
              <MoonGraphic phase={w.phase} fraction={w.fraction} size={34} />
              <Text style={st.cellPct}>{Math.round(w.fraction * 100)}%</Text>
              {w.event ? <Text style={st.cellEvent} numberOfLines={1}>{w.event.name.replace(' Moon', '')}</Text> : null}
            </View>
          ))}
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.cardH}>Coming up</Text>
        {upcoming.map((p) => {
          const ph = { 'New Moon': 0, 'First Quarter': 0.25, 'Full Moon': 0.5, 'Last Quarter': 0.75 }[p.name] ?? 0;
          const fr = { 'New Moon': 0, 'First Quarter': 0.5, 'Full Moon': 1, 'Last Quarter': 0.5 }[p.name] ?? 0;
          return (
            <View key={p.name} style={st.row}>
              <MoonGraphic phase={ph + 0.001} fraction={fr} size={30} />
              <Text style={st.rowName}>{p.name}</Text>
              <Text style={st.rowWhen}>{dayLabel(p.at)} · {time(p.at)}</Text>
            </View>
          );
        })}
      </View>
      <Note>Calculated on your phone for this location (works offline). Times are your phone's time zone.</Note>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const st = useSt();
  return (
    <View style={st.stat}>
      <Text style={st.statV}>{value}</Text>
      <Text style={st.statL}>{label}</Text>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  body: { padding: 12, gap: 12, paddingBottom: 40 },
  dateRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  hero: { backgroundColor: '#0E1A2B', borderRadius: 22, padding: 18, alignItems: 'center' },
  heroDate: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '700' },
  heroName: { color: '#FFFFFF', fontSize: 26, fontWeight: '800' },
  heroEvent: { color: '#F5C96B', fontSize: 14, fontWeight: '700', marginTop: 2 },
  heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, marginTop: 10 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, width: '100%' },
  stat: { width: '50%', alignItems: 'center', paddingVertical: 8 },
  statV: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statL: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '600', marginTop: 1 },
  card: { backgroundColor: colors.panelSolid, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  cardH: { color: colors.text, fontSize: 16, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  cell: { width: '25%', alignItems: 'center', gap: 4 },
  cellDay: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  cellPct: { color: colors.text, fontSize: 12, fontWeight: '600' },
  cellEvent: { color: colors.accent, fontSize: 10.5, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  rowWhen: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
}));
