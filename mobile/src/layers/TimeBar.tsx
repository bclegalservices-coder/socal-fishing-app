// Satellite day picker (Latest / 24 h / 48 h / 3 days / 7 days), play-through, hold-to-compare,
// and the data's own timestamp — old data turns amber, never looks live.
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ageText, isStale } from '../api';
import { colors, makeStyles } from '../theme';
import type { Catalog } from '../types';
import { DAY_OFFSETS, grid, pickDate } from './catalog';
import { Legend } from './Legend';
import { PresentedBy } from '../ads/Sponsor';
import { track } from '../analytics';
import { shownDate } from './MapLayers';
import { DAY_LABELS, type LayerState } from './state';

type Props = { catalog: Catalog | null; s: LayerState; setDay: (i: number) => void; compare: (offset: number | null) => void; compareOffset: number | null };

export function TimeBar({ catalog, s, setDay, compare, compareOffset }: Props) {
  const st = useSt();
  const [playing, setPlaying] = useState(false);
  const idx = useRef(s.dayIndex);
  idx.current = s.dayIndex;
  const info = shownDate(catalog, s, compareOffset);
  const key = info?.key;
  const available = DAY_OFFSETS.map((o) => !!pickDate(grid(catalog, (key ?? 'sst') as any)?.dates, o));

  useEffect(() => {
    if (!playing) return;
    // play oldest -> latest so you watch the water move forward in time
    const order = [4, 3, 2, 1, 0].filter((i) => available[i]);
    let k = 0;
    setDay(order[0]);
    const t = setInterval(() => {
      k += 1;
      if (k >= order.length) { setPlaying(false); return; }
      setDay(order[k]);
    }, 900);
    return () => clearInterval(t);
  }, [playing]);

  if (!info) return null;
  const obs = info.entry?.observed_at;
  const layerLabel = key === 'sst' ? 'Water temp' : 'Chlorophyll';
  const kind = info.layer?.kind === 'interpolated' ? 'satellite blend' : 'satellite';
  return (
    <View style={st.wrap}>
      <View style={st.row}>
        <Pressable onPress={() => { if (!playing) track('time_slider_play'); setPlaying(!playing); }} style={st.play} accessibilityLabel={playing ? 'Stop' : 'Play the last 7 days'}>
          <Text style={st.playT}>{playing ? '■' : '▶'}</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>
            {compareOffset != null ? `Comparing: ${compareOffset} days earlier` : `${layerLabel} · ${kind}`}
          </Text>
          <Text style={[st.age, isStale(obs) && { color: colors.accent }]}>
            {info.entry ? `${info.entry.date} · ${ageText(obs)}` : 'No image for this day (clouds or not processed)'}
          </Text>
        </View>
        <Pressable
          onPressIn={() => { compare(3); track('compare_hold'); }} onPressOut={() => compare(null)}
          style={[st.cmp, compareOffset != null && st.cmpOn]} accessibilityLabel="Hold to compare with 3 days earlier">
          <Text style={st.cmpT}>Hold:{'\n'}3 d ago</Text>
        </Pressable>
      </View>
      <View style={st.chips}>
        {DAY_LABELS.map((l, i) => (
          <Pressable key={l} disabled={!available[i]} onPress={() => setDay(i)}
            style={[st.chip, s.dayIndex === i && st.chipOn, !available[i] && { opacity: 0.35 }]}>
            <Text style={[st.chipT, s.dayIndex === i && { color: colors.accentInk }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {info.entry?.legend ?? info.layer?.legend ? <Legend legend={(info.entry?.legend ?? info.layer?.legend)!} title={layerLabel} /> : null}
      {key === 'sst' ? <PresentedBy section="SST Map" /> : null}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  wrap: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 10, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  play: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  playT: { color: colors.text, fontSize: 18 },
  title: { color: colors.text, fontSize: 14, fontWeight: '600' },
  age: { color: colors.muted, fontSize: 12 },
  cmp: { paddingHorizontal: 8, height: 44, borderRadius: 12, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cmpOn: { backgroundColor: colors.live, borderColor: colors.live },
  cmpT: { color: colors.text, fontSize: 11, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700' },
}));
