// MPAs, closures, wrecks, navigation buoys, shipping lanes and anchorages on the map, plus the MPA alert banner.
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import { boundaryPoints, MPA_ALLOWED_SUMMARY_CHECKED, mpaDetails, type RulesData } from '../offline/rules';
import { formatLatLon } from '../geo';
import { Btn, Note, Sheet, SmallBtn, Title } from './ui';
import { FEATURES_TOP, SHADING_TOP, below } from '../layers/order';

const MPA_RED = '#D7262B';

export function RulesLayers({ data, showProtected, showHazards, onPress }: { data: RulesData | null; showProtected: boolean; showHazards: boolean; onPress: (props: any, geom?: any) => void }) {
  if (!data) return null;
  const f = data.features;
  const press = (e: any) => { const f = e?.nativeEvent?.features?.[0]; if (f) { e.stopPropagation?.(); onPress(f.properties, f.geometry); } };
  return (
    <>
      {showProtected ? ['mpa', 'mpa_mx', 'closures'].filter((k) => f[k]).map((k) => (
        <GeoJSONSource key={k} id={`rules-${k}`} data={f[k]} onPress={press}>
          {/* MPAs in red: no-take = stronger red fill and solid edge; limited take = lighter fill, dashed edge */}
          <Layer beforeId={below(SHADING_TOP)} type="fill" id={`rules-${k}-fill`} style={{
            fillColor: k === 'closures' ? '#b07fd1' : MPA_RED,
            fillOpacity: k === 'closures' ? 0.12 : (['match', ['get', 'take'], 'no_take', 0.3, 0.14] as any),
          }} />
          <Layer beforeId={below(FEATURES_TOP)} type="line" id={`rules-${k}-line`} style={{
            lineColor: k === 'closures' ? '#b07fd1' : MPA_RED,
            lineWidth: (['match', ['get', 'take'], 'no_take', 2.4, 1.8] as any),
          }} />
          <Layer beforeId={below(FEATURES_TOP)} type="line" id={`rules-${k}-line-dash`} filter={['!=', ['get', 'take'], 'no_take'] as any} style={{ lineColor: '#FFFFFF', lineWidth: 1.8, lineDasharray: [2, 2] }} />
        </GeoJSONSource>
      )) : null}
      {showHazards && f.lanes ? (
        <GeoJSONSource id="rules-lanes" data={f.lanes} onPress={press}>
          <Layer beforeId={below(SHADING_TOP)} type="fill" id="rules-lanes-fill" filter={['==', ['geometry-type'], 'Polygon'] as any} style={{ fillColor: '#c058c0', fillOpacity: 0.1 }} />
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="rules-lanes-line" style={{ lineColor: '#c058c0', lineWidth: 1.4, lineDasharray: [4, 2] }} />
        </GeoJSONSource>
      ) : null}
      {showHazards && f.anchorages ? (
        <GeoJSONSource id="rules-anch" data={f.anchorages} onPress={press}>
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="rules-anch-line" style={{ lineColor: '#8fb3c9', lineWidth: 1, lineDasharray: [2, 2] }} />
        </GeoJSONSource>
      ) : null}
      {showHazards && f.wrecks ? (
        <GeoJSONSource id="rules-wrecks" data={f.wrecks} onPress={press} hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}>
          <Layer beforeId={below(FEATURES_TOP)} type="circle" id="rules-wrecks-dot" filter={['==', ['geometry-type'], 'Point'] as any} style={{ circleRadius: 5, circleColor: '#2b2b2b', circleStrokeColor: '#ffffff', circleStrokeWidth: 1.5 }} />
        </GeoJSONSource>
      ) : null}
      {showHazards && f.navaids ? (
        <GeoJSONSource id="rules-navaids" data={f.navaids} onPress={press} hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}>
          <Layer beforeId={below(FEATURES_TOP)} type="circle" id="rules-navaids-dot" filter={['==', ['geometry-type'], 'Point'] as any} style={{ circleRadius: 4, circleColor: '#3fb950', circleStrokeColor: '#0a141c', circleStrokeWidth: 1 }} />
        </GeoJSONSource>
      ) : null}
    </>
  );
}

export function RuleCard({ p, checkedAt, onClose }: { p: any; checkedAt: string | null; onClose: () => void }) {
  const st = useSt();
  const ageDays = checkedAt ? (Date.now() - new Date(checkedAt).getTime()) / 86400000 : null;
  const protectedArea = p.kind === 'mpa' || p.kind === 'closure';
  return (
    <Sheet maxHeight={600} onClose={onClose}>
      <Title>{p.name ?? (p.kind === 'wreck' ? 'Wreck' : p.sub ?? 'Feature')}</Title>
      {protectedArea ? (
        <>
          {p.type ? <Text style={[st.badge, p.take === 'no_take' ? st.badgeRed : st.badgeAmber]}>{p.take === 'no_take' ? 'NO TAKE' : 'LIMITED TAKE'} · {p.type}</Text> : null}
          <Text style={[st.rule, p.take === 'no_take' && { color: colors.alert }]}>{p.rule}</Text>
          {(() => {
            const d = mpaDetails(p.short ?? p.name, p.take);
            return (
              <>
                {d.allowed.length ? (
                  <View style={st.box}>
                    <Text style={st.boxH}>Allowed here</Text>
                    {d.allowed.map((a) => <Text key={a} style={st.li}>• {a}</Text>)}
                    <Text style={st.li}>• Everything else is prohibited.</Text>
                  </View>
                ) : null}
                {d.notes.map((n) => <Note key={n}>{n}</Note>)}
                {p.take === 'limited' && !d.allowed.length ? <Note>Check the official rules below for exactly what is allowed here.</Note> : null}
              </>
            );
          })()}
          {p.geom ? (
            <View style={st.box}>
              <Text style={st.boxH}>Boundary points (from the CDFW map)</Text>
              {boundaryPoints(p.geom).map(([lat, lon], i) => <Text key={i} style={st.mono}>{formatLatLon(lat, lon)}</Text>)}
              {p.ccr ? <Text style={st.li}>Official boundary: CCR Title 14 §{String(p.ccr).replace(/^632/, '632')}</Text> : null}
            </View>
          ) : null}
        </>
      ) : null}
      {p.kind === 'wreck' ? <Note>{p.sub}{p.depth_over_ft != null ? ` · about ${p.depth_over_ft} ft of water over it (charted)` : ''}</Note> : null}
      {!protectedArea && p.kind !== 'wreck' ? <Note>{p.sub}</Note> : null}
      <Note>Source: {p.source}</Note>
      {protectedArea ? (
        <>
          <Text style={[st.check, ageDays != null && ageDays > 60 && { color: colors.accent }]}>
            Boundaries checked {checkedAt ? new Date(checkedAt).toLocaleDateString() : 'unknown'}{ageDays != null && ageDays > 60 ? ' — over 60 days ago, rules may have changed' : ''}
          </Text>
          <Note>Summary from CDFW's regulation language (reviewed {new Date(MPA_ALLOWED_SUMMARY_CHECKED).toLocaleDateString()}). Boundaries shown for reference; the official regulations govern.</Note>
          {p.regs ? <SmallBtn tone="accent" icon="open-outline" label="Official regulations" onPress={() => Linking.openURL(p.regs)} /> : null}
        </>
      ) : <Note>From NOAA charts — not for navigation.</Note>}
    </Sheet>
  );
}

/** Shown while the boat is inside a protected area. Silencing stops the buzz and shrinks it to a small red tag. */
export function MpaBanner({ areas, silenced, onSilence, onUnsilence, onRules }: { areas: any[]; silenced: boolean;
  onSilence: (how: 'leave' | 'hour' | 'today') => void; onUnsilence: () => void; onRules: () => void }) {
  const st = useSt();
  const [choose, setChoose] = useState(false);
  if (!areas.length) return null;
  const a = areas.find((x) => x.properties?.take === 'no_take') ?? areas[0];
  const noTake = a.properties?.take === 'no_take';
  if (silenced) {
    return (
      <Pressable onPress={onRules} onLongPress={onUnsilence} style={[st.tag, noTake ? st.red : st.amber]} accessibilityRole="button"
        accessibilityLabel={`Inside ${a.properties?.name ?? 'a protected area'}, alerts silenced. Tap for rules, hold to turn alerts back on.`}>
        <Text style={st.tagT}>{noTake ? '⛔ In no-take MPA' : '⚠ In MPA'} · silenced</Text>
      </Pressable>
    );
  }
  return (
    <View style={[st.banner, noTake ? st.red : st.amber]} accessibilityRole="alert">
      <Text style={st.bT}>{noTake ? '⛔' : '⚠'} You're in {a.properties?.name ?? 'a protected area'}</Text>
      <Text style={st.bS}>{a.properties?.rule}</Text>
      {choose ? (
        <View style={st.bRow}>
          <Text style={st.bS}>Silence:</Text>
          <Pressable style={st.bBtn} onPress={() => { onSilence('leave'); setChoose(false); }}><Text style={st.bBtnT}>Until I leave</Text></Pressable>
          <Pressable style={st.bBtn} onPress={() => { onSilence('hour'); setChoose(false); }}><Text style={st.bBtnT}>1 hour</Text></Pressable>
          <Pressable style={st.bBtn} onPress={() => { onSilence('today'); setChoose(false); }}><Text style={st.bBtnT}>Today</Text></Pressable>
        </View>
      ) : (
        <View style={st.bRow}>
          <Pressable style={st.bBtn} onPress={onRules}><Text style={st.bBtnT}>See the rules</Text></Pressable>
          <Pressable style={st.bBtn} onPress={() => setChoose(true)}><Text style={st.bBtnT}>Silence alerts</Text></Pressable>
        </View>
      )}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  rule: { color: colors.text, fontSize: 16, fontWeight: '700' },
  check: { color: colors.muted, fontSize: 12.5 },
  link: { color: colors.live, fontSize: 15, paddingVertical: 4 },
  banner: { borderRadius: 12, padding: 10, gap: 2, borderWidth: 1.5 },
  red: { backgroundColor: colors.alertBg, borderColor: colors.alert },
  amber: { backgroundColor: colors.warnBg, borderColor: colors.accent },
  bT: { color: colors.text, fontSize: 15, fontWeight: '800' },
  bS: { color: colors.muted, fontSize: 12.5 },
  bRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  bBtn: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid, borderRadius: 16, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  bBtnT: { color: colors.text, fontSize: 13.5, fontWeight: '700' },
  tag: { alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 5 },
  tagT: { color: colors.text, fontSize: 12.5, fontWeight: '800' },
  badge: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  badgeRed: { color: '#FFFFFF', backgroundColor: '#D7262B' },
  badgeAmber: { color: colors.text, backgroundColor: colors.warnBg },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, gap: 4 },
  boxH: { color: colors.text, fontSize: 14, fontWeight: '700' },
  li: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  mono: { color: colors.text, fontSize: 13.5, fontVariant: ['tabular-nums'] },
}));
