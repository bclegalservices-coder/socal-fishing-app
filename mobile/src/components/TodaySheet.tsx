// "SoCal Fishing Today" (plan: 'Daily dashboard and alerts'). Community numbers come only from public
// reports; hot areas and activity need 3+ different anglers, so nobody's spot is given away.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ageText, getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import { speciesColor, speciesName } from '../community/species';
import { PresentedBy, SponsorBanner } from '../ads/Sponsor';
import { Btn } from './ui';
import { friendly } from '../friendly';

export function TodaySheet({ onClose, onOpenCatchMap }: { onClose: () => void; onOpenCatchMap: () => void }) {
  const st = useSt();
  const insets = useSafeAreaInsets();   // stay below the notch / camera on every iPhone
  const [d, setD] = useState<any | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; savedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJSON<any>('/today', { cacheKey: 'today', timeoutMs: 20000 }).then((r) => { setD(r.data); setMeta({ cached: r.cached, savedAt: r.savedAt }); }).catch((e) => setErr(friendly(e)));
  }, []);
  const total = (d?.species ?? []).reduce((a: number, s: any) => a + Number(s.fish), 0);
  return (
    <>
    {/* Tap the map area above the card to close it */}
    <Pressable style={st.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close today's report" />
    <View style={[st.sheet, { paddingBottom: insets.bottom }]}>
      <View style={st.grab} />
      <View style={st.head}>
        <View style={{ flex: 1 }}>
          <Text style={st.h1}>SoCal Fishing Today</Text>
          <PresentedBy section="Today" />
        </View>
        <Pressable onPress={onClose} style={st.x} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={colors.text} /></Pressable>
      </View>
      {meta?.cached ? <Text style={[st.sub, { color: colors.accent }]}>Offline · saved {new Date(meta.savedAt).toLocaleString()}</Text> : null}
      {err && !d ? <Text style={st.sub}>Today's summary needs signal ({err}).</Text> : null}
      {!d && !err ? <ActivityIndicator color={colors.live} /> : null}
      {d ? (
        <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          {(d.announcements ?? []).map((a: any, i: number) => (
            <Pressable key={i} style={st.announce} onPress={() => a.link && Linking.openURL(a.link)}>
              <Text style={st.h2}>{a.title}</Text>{a.body ? <Text style={st.p}>{a.body}</Text> : null}
            </Pressable>
          ))}
          {(d.warnings ?? []).map((w: any, i: number) => (
            <Text key={i} style={st.warn}>⚠ {w.event} · near {w.near}{w.ends ? ` · until ${new Date(w.ends).toLocaleString([], { weekday: 'short', hour: 'numeric' })}` : ''}</Text>
          ))}

          <View style={st.card}>
            <Text style={st.h2}>{total} fish reported in the last 24 h</Text>
            {(d.species ?? []).slice(0, 8).map((s: any) => (
              <View key={s.species_code} style={st.row}>
                <View style={[st.dot, { backgroundColor: speciesColor(s.species_code) }]} />
                <Text style={st.p}>{speciesName(s.species_code)}</Text>
                <Text style={st.num}>{s.fish}</Text>
              </View>
            ))}
            {!d.species?.length ? <Text style={st.sub}>No public reports yet today.</Text> : null}
            <Btn label="View today's Catch Map" kind="primary" onPress={onOpenCatchMap} />
          </View>

          {d.hot_areas?.length ? (
            <View style={st.card}>
              <Text style={st.h2}>Hot areas</Text>
              {d.hot_areas.map((a: any) => (
                <Text key={a.area} style={st.p}>🔥 {a.area} · {a.fish} fish · {a.species.join(', ')}</Text>
              ))}
              <Text style={st.sub}>Areas with reports from at least {d.min_anglers} different anglers.</Text>
            </View>
          ) : null}

          {(d.activity ?? []).map((a: any) => (
            <View key={a.species_code} style={st.card}>
              <Text style={st.h2}>{speciesName(a.species_code)} — last 48 h</Text>
              <Text style={st.p}>{a.n} reported catches from {a.anglers} anglers</Text>
              {a.sst25 != null ? <Text style={st.p}>Most at {a.sst25.toFixed(1)}–{a.sst75.toFixed(1)}°F water</Text> : null}
              {a.chl25 != null ? <Text style={st.p}>Chlorophyll {a.chl25.toFixed(2)}–{a.chl75.toFixed(2)} mg/m³</Text> : null}
              {a.top?.length ? <Text style={st.p}>Working: {a.top.join(', ')}</Text> : null}
              <Text style={st.sub}>Pattern from community reports — not a promise fish are there.</Text>
            </View>
          ))}

          <View style={st.card}>
            <Text style={st.h2}>Conditions</Text>
            {d.water ? (
              <>
                <Text style={st.p}>Water {d.water.min_f}–{d.water.max_f}°F across the region · {d.water.strong_break_lines} strong temperature break{d.water.strong_break_lines === 1 ? '' : 's'}</Text>
                <Text style={st.sub}>Satellite image {d.water.date} ({ageText(d.water.observed_at)}){d.water.kind === 'interpolated' ? ', cloud gaps filled' : ''}</Text>
              </>
            ) : <Text style={st.sub}>Water temperature not processed yet.</Text>}
            {(d.buoys ?? []).map((b: any) => (
              <Text key={b.station.id} style={st.p}>{b.area}: {b.wave_ft != null ? `${b.wave_ft} ft @ ${b.dominant_period_s ?? '?'} s` : 'waves —'}{b.wind_kt != null ? ` · wind ${Math.round(b.wind_kt)} kt` : ''}{b.water_f != null ? ` · ${b.water_f}°F` : ''} <Text style={st.sub}>(buoy, {ageText(b.observed_at)})</Text></Text>
            ))}
          </View>
          <SponsorBanner placement="banner_dashboard" />
        </ScrollView>
      ) : null}
    </View>
    </>
  );
}

const useSt = makeStyles((colors) => ({
  // A card from the bottom covering ~60% of the screen, so the map (and the phone's camera area) stay clear above it.
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.overlay, zIndex: 24 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%', backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 8, zIndex: 25, gap: 8 },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  p: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
  sub: { color: colors.muted, fontSize: 12 },
  num: { color: colors.text, fontSize: 15, fontWeight: '700', marginLeft: 'auto' },
  x: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  xT: { color: colors.text, fontSize: 18 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  warn: { color: colors.alert, backgroundColor: colors.alertBg, borderColor: colors.alert, borderWidth: 1, borderRadius: 10, padding: 8, fontWeight: '700' },
  announce: { borderWidth: 1, borderColor: colors.live, borderRadius: 12, padding: 10, gap: 4 },
}));
