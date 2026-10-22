// The "everything known about this spot" block (spec §7). Shows each value's plain-English line
// plus where it came from. Offline: last saved answer, clearly marked with when it was saved.
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { getJSON } from '../api';
import { colors, makeStyles } from '../theme';
import type { Conditions, Measurement, Section } from '../types';
import { loadTidePack } from '../offline/packs';
import { offlineTide } from '../offline/tideMath';
import { track } from '../analytics';
import { friendly } from '../friendly';

export function ConditionsView({ lat, lon }: { lat: number; lon: number }) {
  const st = useSt();
  const [c, setC] = useState<Conditions | null>(null);
  const [meta, setMeta] = useState<{ cached: boolean; savedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setC(null); setErr(null);
    track('conditions_view');
    getJSON<Conditions>(`/conditions?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`, { cacheKey: `cond:${lat.toFixed(2)},${lon.toFixed(2)}`, timeoutMs: 20000 })
      .then((r) => { if (alive) { setC(r.data); setMeta({ cached: r.cached, savedAt: r.savedAt }); } })
      .catch(async (e) => {
        // No signal and nothing saved for this spot: work out the tide from the downloaded 30-day pack.
        const pack = await loadTidePack().catch(() => null);
        const t = pack ? offlineTide(pack.stations, lat, lon) : null;
        if (!alive) return;
        if (t && t.covered) {
          const src = `NOAA CO-OPS ${t.station.id} ${t.station.name} (saved pack)`;
          const items: Measurement[] = [];
          if (t.height_ft != null) items.push({ type: 'tide_height', value: t.height_ft, unit: 'ft', kind: 'prediction', source: src, retrieved_at: new Date().toISOString(), label: `Tide ${t.trend} · ${t.height_ft.toFixed(1)} ft · station ${t.distance_nm} NM away` });
          if (t.next_high) items.push({ type: 'next_high', value: t.next_high.v, unit: 'ft', kind: 'prediction', source: src, retrieved_at: '', label: `Next high ${t.next_high.v.toFixed(1)} ft ${new Date(t.next_high.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` });
          if (t.next_low) items.push({ type: 'next_low', value: t.next_low.v, unit: 'ft', kind: 'prediction', source: src, retrieved_at: '', label: `Next low ${t.next_low.v.toFixed(1)} ft ${new Date(t.next_low.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` });
          setC({ lat, lon, generated_at: new Date().toISOString(), disclaimer: 'Offline: tide from the saved prediction pack. Water and weather need signal.', tide: { ok: true, items, data: {} } });
          setMeta({ cached: true, savedAt: Date.now() });
        } else setErr(friendly(e));
      });
    return () => { alive = false; };
  }, [lat, lon]);

  if (err) return <Text style={st.muted}>Conditions unavailable ({err}). They load when you're back in range.</Text>;
  if (!c) return <View style={st.loading}><ActivityIndicator color={colors.live} /><Text style={st.muted}>Loading conditions…</Text></View>;

  const alerts = c.alerts?.items ?? [];
  return (
    <View style={{ gap: 10 }}>
      {meta?.cached ? <Text style={[st.muted, { color: colors.accent }]}>Offline · saved {new Date(meta.savedAt).toLocaleString()}</Text> : null}
      {alerts.map((a, i) => <Text key={i} style={st.alert}>⚠ {a.label ?? String(a.value)}</Text>)}
      <Block title="Water" sec={c.water} />
      <Block title="Depth" sec={c.depth} />
      <Block title="Tide" sec={c.tide} extra={c.tide?.data?.curve ? <TideCurve curve={c.tide.data.curve} /> : null} />
      <Block title="Wind & weather" sec={c.weather} />
      <Block title="Waves (buoy)" sec={c.waves} />
      {c.nearby?.data?.reports_label ? <Text style={st.line}>🎣 {c.nearby.data.reports_label}</Text> : null}
      {c.moon ? <Text style={st.line}>☾ {c.moon.name} · {Math.round(c.moon.illumination * 100)}% lit</Text> : null}
      <Text style={st.disc}>{c.disclaimer}</Text>
    </View>
  );
}

function Block({ title, sec, extra }: { title: string; sec?: Section; extra?: any }) {
  const st = useSt();
  if (!sec) return null;
  return (
    <View style={{ gap: 3 }}>
      <Text style={st.h}>{title}</Text>
      {!sec.ok ? <Text style={st.muted}>{sec.error}</Text> : null}
      {sec.items.map((m, i) => <Line key={i} m={m} />)}
      {extra}
    </View>
  );
}

function Line({ m }: { m: Measurement }) {
  const st = useSt();
  const kind = { observed: 'measured', model: 'model', interpolated: 'satellite blend', prediction: 'prediction', derived: 'calculated', static: 'reference', forecast: 'forecast' }[m.kind];
  return (
    <View>
      <Text style={st.line}>{m.label ?? `${m.type}: ${m.value ?? '—'} ${m.unit ?? ''}`}</Text>
      <Text style={st.src}>{m.source} · {kind}</Text>
    </View>
  );
}

function TideCurve({ curve }: { curve: { t: string; v: number }[] }) {
  const st = useSt();
  if (curve.length < 2) return null;
  const vs = curve.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const now = Date.now();
  return (
    <View style={st.curve} accessibilityLabel="Tide curve for the next 24 hours">
      {curve.map((p, i) => {
        const past = new Date(p.t).getTime() < now;
        return <View key={i} style={{ flex: 1, height: 6 + ((p.v - lo) / Math.max(0.1, hi - lo)) * 44, backgroundColor: past ? colors.line : colors.live, marginHorizontal: 0.5, borderRadius: 1 }} />;
      })}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  loading: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  h: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  line: { color: colors.text, fontSize: 15 },
  src: { color: colors.muted, fontSize: 11 },
  muted: { color: colors.muted, fontSize: 13 },
  alert: { color: colors.alert, backgroundColor: colors.alertBg, borderColor: colors.alert, borderWidth: 1, borderRadius: 10, padding: 8, fontSize: 14, fontWeight: '700' },
  disc: { color: colors.muted, fontSize: 11, fontStyle: 'italic' },
  curve: { flexDirection: 'row', alignItems: 'flex-end', height: 52, marginTop: 4 },
}));
