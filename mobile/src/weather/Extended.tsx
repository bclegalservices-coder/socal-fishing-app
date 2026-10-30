// Extended forecast, TV-news style (Oct 28): a weather picture for every day — sky icon on its own color, high / low,
// chance of rain, wind, seas and wave period, and the boat verdict. Opened with "Extended" on the Weather page.
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, makeStyles, useTheme } from '../theme';
import { condition, type Cond } from './Conditions';
import { dayLabel, levelColor, levelText, localDate, type Day, type Hour } from './model';

const n0 = (v?: number | null) => (v == null ? '—' : String(Math.round(v)));
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');

/** The day's picture: the worst daytime sky (rain or storms win), otherwise early afternoon. */
export function dayCondition(day: Day, hours: Hour[]): Cond {
  const daytime = hours.filter((h) => localDate(h.t) === day.date && new Date(h.t).getHours() >= 8 && new Date(h.t).getHours() <= 17);
  const pick = daytime.find((h) => /thunder/i.test(h.weather ?? '')) ?? daytime.find((h) => (h.precip_pct ?? 0) >= 50)
    ?? daytime.find((h) => new Date(h.t).getHours() === 13) ?? daytime[Math.floor(daytime.length / 2)];
  if (pick) return condition(pick, false);
  return condition({ precip_pct: day.precip_pct_max ?? 0, wind_kt: day.wind_kt_max ?? 0, sky_pct: 30 } as any, false);
}

function dayPeriod(day: Day, hours: Hour[]): number | null {
  const ps = hours.filter((h) => localDate(h.t) === day.date && h.period_s != null).map((h) => h.period_s as number);
  return ps.length ? Math.max(...ps) : null;
}

export function ExtendedForecast({ visible, place, days, hours, onClose, onPickDay }: {
  visible: boolean; place: string; days: Day[]; hours: Hour[]; onClose: () => void; onPickDay: (date: string) => void;
}) {
  const st = useSt();
  const { mode } = useTheme();
  const lows = days.map((d) => d.air_f_lo).filter((v): v is number => v != null);
  const highs = days.map((d) => d.air_f_hi).filter((v): v is number => v != null);
  const tMin = lows.length ? Math.min(...lows) : 50, tMax = highs.length ? Math.max(...highs) : 80;
  const span = Math.max(1, tMax - tMin);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={st.root} edges={['top', 'bottom']}>
        <View style={st.head}>
          <View style={{ flex: 1 }}>
            <Text style={st.h1}>{days.length}-Day Forecast</Text>
            <Text style={st.h2} numberOfLines={1}>{place}</Text>
          </View>
          <Pressable onPress={onClose} style={st.done} accessibilityRole="button"><Text style={st.doneT}>Done</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 30 }}>
          {/* The TV strip: every day side by side */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.strip}>
            {days.map((d) => {
              const c = dayCondition(d, hours);
              return (
                <Pressable key={d.date} onPress={() => { onPickDay(d.date); onClose(); }} style={[st.col, { backgroundColor: c.tint[0] }]} accessibilityRole="button"
                  accessibilityLabel={`${dayLabel(d.date)}: ${c.label}, high ${n0(d.air_f_hi)}, low ${n0(d.air_f_lo)}`}>
                  <Text style={st.colDay}>{dayLabel(d.date).split(' ')[0].replace(',', '')}</Text>
                  <MaterialCommunityIcons name={c.icon} size={40} color="#FFFFFF" style={st.shadow} />
                  <Text style={st.colHi}>{n0(d.air_f_hi)}°</Text>
                  <Text style={st.colLo}>{n0(d.air_f_lo)}°</Text>
                  {d.precip_pct_max != null && d.precip_pct_max >= 20 ? (
                    <View style={st.colRain}><MaterialCommunityIcons name="water" size={12} color="#BFE4FF" /><Text style={st.colRainT}>{n0(d.precip_pct_max)}%</Text></View>
                  ) : <View style={{ height: 16 }} />}
                  <View style={[st.colBar, { backgroundColor: levelColor(d.summary.level) }]} />
                </Pressable>
              );
            })}
          </ScrollView>

          {/* A full card per day */}
          {days.map((d) => {
            const c = dayCondition(d, hours);
            const per = dayPeriod(d, hours);
            const lo = d.air_f_lo ?? tMin, hi = d.air_f_hi ?? tMax;
            return (
              <Pressable key={d.date} onPress={() => { onPickDay(d.date); onClose(); }} style={({ pressed }) => [st.card, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <View style={[st.pic, { backgroundColor: c.tint[0] }]}>
                  <View style={[st.picGlow, { backgroundColor: c.tint[1] }]} />
                  <MaterialCommunityIcons name={c.icon} size={58} color="#FFFFFF" style={st.shadow} />
                  <Text style={st.picLabel} numberOfLines={2}>{c.label}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={st.rowBetween}>
                    <Text style={st.day}>{dayLabel(d.date)}</Text>
                    <View style={[st.verdict, { backgroundColor: levelColor(d.summary.level) }]}><Text style={st.verdictT} numberOfLines={1}>{d.summary.label}</Text></View>
                  </View>
                  <View style={st.temps}>
                    <Text style={st.hi}>{n0(d.air_f_hi)}°</Text>
                    <View style={st.track}>
                      <View style={[st.trackOn, { left: `${((lo - tMin) / span) * 100}%`, right: `${100 - ((hi - tMin) / span) * 100}%` }]} />
                    </View>
                    <Text style={st.lo}>{n0(d.air_f_lo)}°</Text>
                  </View>
                  <View style={st.stats}>
                    <Stat icon="water-outline" v={`${n0(d.precip_pct_max ?? 0)}%`} k="Rain" />
                    <Stat icon="weather-windy" v={`${n0(d.wind_kt_max)}${d.gust_kt_max ? `g${n0(d.gust_kt_max)}` : ''}`} k="Wind kt" />
                    <Stat icon="waves" v={d.seas_ft_min != null ? `${n0(d.seas_ft_min)}–${n0(d.seas_ft_max)}` : '—'} k="Seas ft" />
                    <Stat icon="timer-outline" v={per != null ? `${n0(per)} s` : '—'} k="Period" />
                  </View>
                  <Text style={[st.small, { color: levelText(d.summary.level, mode) }]} numberOfLines={1}>
                    {d.summary.window ? `Best ${new Date(d.summary.window.start).toLocaleTimeString([], { hour: 'numeric' })}–${new Date(new Date(d.summary.window.end).getTime() + 3600000).toLocaleTimeString([], { hour: 'numeric' })}` : 'No good window for your boat'}
                    <Text style={st.smallMuted}>{`  ·  ☀︎ ${clock(d.sunrise)} – ${clock(d.sunset)}`}</Text>
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={st.foot}>NWS forecast. Tap any day for the hour-by-hour. Boat ratings are planning guidance — NWS warnings and your own judgment come first.</Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ icon, v, k }: { icon: string; v: string; k: string }) {
  const st = useSt();
  return (
    <View style={st.stat}>
      <MaterialCommunityIcons name={icon as any} size={15} color={colors.muted} />
      <Text style={st.statV} numberOfLines={1}>{v}</Text>
      <Text style={st.statK}>{k}</Text>
    </View>
  );
}

/** Small "Extended" button for the Weather page. */
export function ExtendedButton({ onPress }: { onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.extBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel="Extended forecast">
      <Ionicons name="calendar-outline" size={15} color={colors.live} /><Text style={st.extT}>Extended</Text>
    </Pressable>
  );
}

/** Oct 29: big, easy-to-see button right under today's picture. */
export function ExtendedBanner({ days, onPress }: { days: number; onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.banner, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel="Open the extended forecast">
      <View style={st.bannerIcon}><Ionicons name="calendar" size={20} color={colors.accentInk} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.bannerT}>Extended forecast</Text>
        <Text style={st.bannerS} numberOfLines={1}>{days}-day outlook · a picture for every day</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.live} />
    </Pressable>
  );
}

const useSt = makeStyles((colors) => ({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14,
    backgroundColor: colors.panelSolid, borderWidth: 1.5, borderColor: colors.live },
  bannerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.live },
  bannerT: { color: colors.text, fontSize: 16.5, fontWeight: '800' },
  bannerS: { color: colors.muted, fontSize: 13, marginTop: 1 },
  root: { flex: 1, backgroundColor: colors.bg },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800' },
  h2: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  done: { backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 18, minHeight: 40, justifyContent: 'center' },
  doneT: { color: colors.accentInk, fontWeight: '800', fontSize: 16 },
  strip: { gap: 6, padding: 12 },
  col: { width: 74, borderRadius: 16, alignItems: 'center', paddingTop: 10, paddingBottom: 0, gap: 2, overflow: 'hidden' },
  colDay: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  colHi: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 2 },
  colLo: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontWeight: '700' },
  colRain: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 },
  colRainT: { color: '#BFE4FF', fontSize: 12, fontWeight: '800' },
  colBar: { alignSelf: 'stretch', height: 6, marginTop: 6 },
  shadow: { textShadowColor: 'rgba(0,0,0,0.2)', textShadowRadius: 6 },
  card: { flexDirection: 'row', gap: 12, marginHorizontal: 12, marginTop: 10, padding: 10, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid },
  pic: { width: 104, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, overflow: 'hidden', gap: 4 },
  picGlow: { position: 'absolute', right: -40, bottom: -50, width: 140, height: 140, borderRadius: 70, opacity: 0.6 },
  picLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', textAlign: 'center', paddingHorizontal: 4 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  day: { color: colors.text, fontSize: 17, fontWeight: '800', flexShrink: 1 },
  verdict: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, maxWidth: '55%' },
  verdictT: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
  temps: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hi: { color: colors.text, fontSize: 26, fontWeight: '800', width: 52 },
  lo: { color: colors.muted, fontSize: 20, fontWeight: '700', width: 42, textAlign: 'right' },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.inset },
  trackOn: { position: 'absolute', top: 0, bottom: 0, borderRadius: 3, backgroundColor: '#F2A93B' },
  stats: { flexDirection: 'row', gap: 6 },
  stat: { flex: 1, alignItems: 'center', borderRadius: 10, backgroundColor: colors.inset, paddingVertical: 5 },
  statV: { color: colors.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statK: { color: colors.muted, fontSize: 10.5, fontWeight: '700' },
  small: { fontSize: 12.5, fontWeight: '700' },
  smallMuted: { color: colors.muted, fontWeight: '600' },
  foot: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingHorizontal: 24, marginTop: 14 },
  extBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5, borderColor: colors.live },
  extT: { color: colors.live, fontSize: 13.5, fontWeight: '800' },
}));
