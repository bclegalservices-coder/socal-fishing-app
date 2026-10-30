// San Clemente Island safety zone on the map (Oct 28): the 8 sections, colored by status, a chip at the top when
// sections are closed (or close within a day), and a card when you tap a section. Rules + shapes live in ../sci.ts.
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import { FEATURES_TOP, SHADING_TOP, below } from '../layers/order';
import { ALWAYS, FACSFAC_PHONE, FACSFAC_PHONE_TEXT, SECTIONS, statusOf, summary, whenText, zonesGeoJSON, type SciClosures, type SectionId } from '../sci';
import { Btn, Note, Sheet, Title } from './ui';

export const SCI_COLORS = { closed: '#E0002A', permission: '#B3121F', scheduled: '#FF8A00', open: '#FF8A00' };

/** Map part (inside <MapView>). */
export function SciMapLayer({ data, now, onPress, labels }: { data: SciClosures | null; now: number; onPress: (id: SectionId) => void; labels: boolean }) {
  const geo = zonesGeoJSON(data, now);
  const press = (e: any) => { const f = e?.nativeEvent?.features?.[0]; if (f?.properties?.id) { e.stopPropagation?.(); onPress(f.properties.id); } };
  const st = ['get', 'status'];
  return (
    <>
    <GeoJSONSource id="sci-zones" data={geo as any} onPress={press}>
      {/* closed = strong red fill · always restricted (G, Wilson Cove) = red fill · may close (open now) = faint, dashed orange edge */}
      <Layer beforeId={below(SHADING_TOP)} type="fill" id="sci-fill" style={{
        fillColor: ['match', st, 'closed', SCI_COLORS.closed, 'permission', SCI_COLORS.permission, SCI_COLORS.open] as any,
        fillOpacity: ['match', st, 'closed', 0.32, 'permission', 0.2, 'scheduled', 0.12, 0.05] as any,
      }} />
      <Layer beforeId={below(FEATURES_TOP)} type="line" id="sci-line" style={{
        lineColor: ['match', st, 'closed', SCI_COLORS.closed, 'permission', SCI_COLORS.permission, SCI_COLORS.open] as any,
        lineWidth: ['match', st, 'closed', 2.6, 'permission', 2.2, 1.6] as any,
      }} />
      <Layer beforeId={below(FEATURES_TOP)} type="line" id="sci-line-dash" filter={['any', ['==', st, 'open'], ['==', st, 'scheduled']] as any}
        style={{ lineColor: '#FFFFFF', lineWidth: 1.6, lineDasharray: [2, 2] }} />
    </GeoJSONSource>
    {labels ? (Object.keys(SECTIONS) as SectionId[]).map((id) => {
      const status = statusOf(id, data, now);
      const r = SECTIONS[id].ring;
      // label sits on the offshore half of the section (its two outer corners), away from the island
      const lon = (r[1][0] + r[2][0]) / 2 * 0.7 + (r[0][0] + r[3][0]) / 2 * 0.3, lat = (r[1][1] + r[2][1]) / 2 * 0.7 + (r[0][1] + r[3][1]) / 2 * 0.3;
      const c = status === 'closed' ? SCI_COLORS.closed : status === 'permission' ? SCI_COLORS.permission : '#B85C00';
      return (
        <Marker key={`sci-${id}`} lngLat={[lon, lat]} anchor="center">
          <Pressable onPress={() => onPress(id)} hitSlop={6} style={[lb.tag, { borderColor: c }, status === 'closed' && { backgroundColor: c }]} accessibilityRole="button" accessibilityLabel={`San Clemente ${SECTIONS[id].name}, ${status}`}>
            <Text style={[lb.t, { color: status === 'closed' ? '#FFFFFF' : c }]}>{id === 'W' ? 'WILSON COVE' : `SCI ${id}`}</Text>
            {status === 'closed' || status === 'permission' || status === 'scheduled' ? (
              <Text style={[lb.s, { color: status === 'closed' ? '#FFFFFF' : c }]}>{status === 'closed' ? 'CLOSED' : status === 'permission' ? 'PERMISSION' : 'CLOSING SOON'}</Text>
            ) : null}
          </Pressable>
        </Marker>
      );
    }) : null}
    </>
  );
}

const lb = StyleSheet.create({
  tag: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1.5, borderRadius: 7, paddingHorizontal: 5, paddingVertical: 1 },
  t: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.3 },
  s: { fontSize: 9, fontWeight: '800' },
});

/** Chip under the top bar while sections are closed (or close within 24 h). Tap → zoom to the island. */
export function SciChip({ data, now, onPress }: { data: SciClosures | null; now: number; onPress: () => void }) {
  const st = useSt();
  const s = summary(data, now);
  if (!s) return null;
  const c = s.level === 'closed' ? SCI_COLORS.closed : SCI_COLORS.scheduled;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.chip, { borderColor: c }, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={`${s.text}. Tap to show on the map.`}>
      <View style={[st.dot, { backgroundColor: c }]}><Ionicons name="warning" size={15} color="#FFFFFF" /></View>
      <Text style={st.chipT} numberOfLines={1}>{s.text}</Text>
    </Pressable>
  );
}

/** Card when a section is tapped. */
export function SciCard({ id, data, now, onClose }: { id: SectionId; data: SciClosures | null; now: number; onClose: () => void }) {
  const st = useSt();
  const sec = SECTIONS[id];
  const status = statusOf(id, data, now);
  const s = data?.sections?.[id];
  const badge = status === 'closed' ? { t: 'CLOSED · NAVY TRAINING', c: SCI_COLORS.closed } : status === 'permission' ? { t: 'ALWAYS RESTRICTED · PERMISSION ONLY', c: SCI_COLORS.permission }
    : status === 'scheduled' ? { t: `CLOSES ${whenText(s?.from, now)?.toUpperCase()}`, c: SCI_COLORS.scheduled } : { t: 'OPEN NOW · MAY CLOSE FOR NAVY TRAINING', c: colors.ok };
  return (
    <Sheet maxHeight={560}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}><Title>San Clemente Island · {sec.name}</Title></View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close-circle" size={28} color={colors.muted} /></Pressable>
      </View>
      <Text style={[st.badge, { backgroundColor: badge.c }]}>{badge.t}</Text>
      <Text style={st.p}>{sec.where}</Text>
      {status === 'closed' ? <Text style={st.p}>{s?.until ? `Closed until ${whenText(s.until, now)}.` : 'Closed until further notice.'} Stay out of this section unless the Navy gives you permission.</Text> : null}
      {status === 'scheduled' ? <Text style={st.p}>Closes {whenText(s?.from, now)}{s?.until ? ` until ${whenText(s.until, now)}` : ''} for Navy training.</Text> : null}
      {status === 'permission' ? <Text style={st.p}>{id === 'W' ? 'Restricted from the shore out to 2 NM at all times. You may pass through between 2 and 3 NM unless the Navy says otherwise.' : 'Restricted at all times.'} Get permission from FACSFAC San Diego before going in, and tell them when you leave.</Text> : null}
      {status === 'open' ? <Text style={st.p}>Open to fishing right now. The Navy closes this section during training — the app shows it in red and sends an alert when it does (turn on San Clemente alerts in Me → Alerts).</Text> : null}
      {data?.note && (status === 'closed' || status === 'scheduled') ? <Note>{data.note}</Note> : null}
      <View style={st.box}>
        <Text style={st.boxH}>Ask before you go in</Text>
        <Text style={st.li}>• Call FACSFAC San Diego: {FACSFAC_PHONE_TEXT}</Text>
        <Text style={st.li}>• Or hail them on VHF channel 16</Text>
        <Text style={st.li}>• Navy or Coast Guard boats may tell you to leave — do what they say</Text>
      </View>
      <Btn label={`Call FACSFAC ${FACSFAC_PHONE_TEXT}`} icon="call-outline" kind="primary" onPress={() => Linking.openURL(`tel:${FACSFAC_PHONE}`).catch(() => {})} />
      <Note>{ALWAYS.includes(id) ? '' : 'Closures are entered by hand from the Navy schedule and radio notices, so they can lag. Always listen to VHF 16 near the island. '}Zone lines: 33 CFR 165.1141 (San Clemente 3 NM Safety Zone).{data?.updated_at ? ` Status updated ${new Date(data.updated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : ''}</Note>
    </Sheet>
  );
}

const useSt = makeStyles((colors) => ({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 6, marginHorizontal: 12, minHeight: 40, paddingLeft: 6, paddingRight: 12,
    borderRadius: 20, borderWidth: 2, backgroundColor: colors.panelSolid, maxWidth: '94%',
    shadowColor: colors.shadow, shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  badge: { alignSelf: 'flex-start', color: '#FFFFFF', fontSize: 12.5, fontWeight: '900', letterSpacing: 0.4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  p: { color: colors.text, fontSize: 15, lineHeight: 21 },
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4 },
  boxH: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  li: { color: colors.text, fontSize: 14.5, lineHeight: 20 },
}));
