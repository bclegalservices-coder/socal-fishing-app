// Trips: every recorded trip with search and sorting (date, length, speed, time); a trip page with the numbers,
// a speed graph colored like the track, "this trip vs your best / your average", and Play / Map / Share / Delete.
// Full screen over the map. Trips are saved on this phone and work offline.
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, makeStyles, touch } from '../theme';
import { loadTrackPoints, type ActiveTrack, type TrackMeta } from '../storage';
import type { TrackPoint } from '../nav';
import { analyze, records, searchTrips, sortTrips, SPEED_BANDS, speedBins, speedColor, tripMinutes, type SortKey, type TripAnalysis } from '../trips';
import { fmtDist, fmtDur, fmtSpeed, useUnits, type Units } from '../units';
import { Note, ScreenHeader, Segmented } from './ui';

type Props = {
  tracks: TrackMeta[]; active: ActiveTrack | null; activePts: TrackPoint[];
  onStartStop: () => void; onPlay: (t: TrackMeta) => void; onShowOnMap: (t: TrackMeta) => void;
  onRename: (t: TrackMeta, name: string) => void; onShare: (t: TrackMeta) => void; onDelete: (t: TrackMeta) => void; onClose: () => void;
};

const dateLong = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function TripsScreen(p: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = p.tracks.find((t) => t.id === openId) ?? null;
  return open ? <TripPage {...p} trip={open} onBack={() => setOpenId(null)} /> : <TripList {...p} onOpen={(t) => setOpenId(t.id)} />;
}

// ---------------- the list ----------------
function TripList({ tracks, active, activePts, onStartStop, onClose, onOpen }: Props & { onOpen: (t: TrackMeta) => void }) {
  const st = useSt();
  const u = useUnits();
  const [sort, setSort] = useState<SortKey>('date');
  const [q, setQ] = useState('');
  const list = useMemo(() => sortTrips(searchTrips(tracks, q), sort), [tracks, q, sort]);
  const rec = useMemo(() => records(tracks), [tracks]);
  const live = useMemo(() => (active && activePts.length > 1 ? analyze(activePts) : null), [active, activePts]);
  return (
    <View style={st.full}>
      <ScreenHeader title="Trips" onBack={onClose} backLabel="Map"
        subtitle={tracks.length ? `${tracks.length} trips · ${fmtDist(rec.total.distanceNm, u)} · ${fmtDur(rec.total.minutes)} on the water` : 'Record your trips and play them back'} />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        {active ? (
          <View style={[st.card, st.recCard]}>
            <View style={st.recHead}><View style={st.recDot} /><Text style={st.recT}>Recording{active.mode === 'background' ? '' : ' (only while the app is open)'}</Text></View>
            <View style={st.stats3}>
              <Stat3 k="Distance" v={fmtDist(live?.distanceNm ?? 0, u)} />
              <Stat3 k="Time" v={fmtDur(live?.durationMin ?? (Date.now() - active.startedAt) / 60000)} />
              <Stat3 k="Top speed" v={fmtSpeed(live?.maxKt ?? 0, u)} />
            </View>
            <Pressable style={[st.bigBtn, { backgroundColor: colors.alert }]} onPress={onStartStop} accessibilityRole="button">
              <Ionicons name="stop" size={18} color="#FFFFFF" /><Text style={st.bigBtnT}>Stop and save</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={[st.bigBtn, { backgroundColor: colors.accent }]} onPress={onStartStop} accessibilityRole="button" accessibilityLabel="Record a trip">
            <Ionicons name="radio-button-on" size={18} color={colors.accentInk} /><Text style={[st.bigBtnT, { color: colors.accentInk }]}>Record a trip</Text>
          </Pressable>
        )}

        {tracks.length ? (
          <>
            <View style={st.search}>
              <Ionicons name="search" size={18} color={colors.muted} />
              <TextInput value={q} onChangeText={setQ} placeholder="Search trips" placeholderTextColor={colors.faint} style={st.searchIn}
                autoCorrect={false} returnKeyType="search" accessibilityLabel="Search trips" />
              {q ? <Pressable onPress={() => setQ('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={18} color={colors.faint} /></Pressable> : null}
            </View>
            <Segmented<SortKey> value={sort} onChange={setSort}
              options={[{ key: 'date', label: 'Date' }, { key: 'length', label: 'Length' }, { key: 'speed', label: 'Speed' }, { key: 'time', label: 'Time' }]} />
            <View style={[st.card, { padding: 0 }]}>
              {list.map((t, i) => (
                <Pressable key={t.id} onPress={() => onOpen(t)} style={({ pressed }) => [st.trip, i < list.length - 1 && st.tripLine, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button" accessibilityLabel={`${t.name}, ${dateLong(t.startedAt)}`}>
                  <View style={st.tripHead}>
                    {t.kind === 'hoop' ? <Text style={{ fontSize: 20 }}>🦞</Text> : <Ionicons name="analytics" size={22} color={speedColor(t.avgMovingKt)} />}
                    <View style={{ flex: 1 }}>
                      <Text style={st.tripName} numberOfLines={2}>{t.name}</Text>
                      <Text style={st.tripDate}>{dateLong(t.startedAt)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.faint} />
                  </View>
                  {t.kind === 'hoop' && t.hoop ? (
                    <View style={st.stats3}>
                      <Stat3 k="Nets" v={String(t.hoop.nets)} />
                      <Stat3 k="Pulls" v={String(t.hoop.pulls.length)} />
                      <Stat3 k="Time" v={fmtDur(tripMinutes(t))} />
                    </View>
                  ) : (
                    <View style={st.stats3}>
                      <Stat3 k="Length" v={fmtDist(t.distanceNm, u)} />
                      <Stat3 k="Time" v={fmtDur(tripMinutes(t))} />
                      <Stat3 k="Avg speed" v={fmtSpeed(t.avgMovingKt, u)} />
                    </View>
                  )}
                </Pressable>
              ))}
              {!list.length ? <Text style={[st.tripDate, { padding: 16 }]}>No trips match "{q}".</Text> : null}
            </View>
          </>
        ) : (
          <Note>No trips yet. Tap Record a trip before you leave the dock. With location set to "Always", it keeps recording with the screen off.</Note>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------- hoop trip details (Nov 8) ----------------
function HoopCard({ h }: { h: NonNullable<TrackMeta['hoop']> }) {
  const st = useSt();
  const soak = (m: number | null) => (m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const pulls = h.pulls.slice().sort((a, b) => a.at - b.at);
  return (
    <View style={st.card}>
      <Text style={st.k}>Hoop set · {h.crew <= 1 ? 'solo (5 nets max)' : '2+ aboard (10 nets max)'}</Text>
      <View style={st.stats3}>
        <Stat3 k="Nets" v={String(h.nets)} />
        <Stat3 k="Drops" v={String(h.drops.length)} />
        <Stat3 k="Pulls" v={String(h.pulls.length)} />
      </View>
      <View style={st.stats3}>
        <Stat3 k="Avg soak" v={soak(h.avgSoakMin)} />
        <Stat3 k="Longest soak" v={soak(h.longestSoakMin)} />
        <Stat3 k="" v="" />
      </View>
      {pulls.length ? (
        <View style={{ gap: 4, marginTop: 6 }}>
          <Text style={st.k}>Every pull</Text>
          {pulls.map((p, i) => (
            <Text key={i} style={st.tripDate}>No. {p.no} · {clock(p.at)} · soaked {soak(p.soakMin)}</Text>
          ))}
        </View>
      ) : null}
      <Text style={[st.tripDate, { marginTop: 6 }]}>Tap Map to see your path and every drop spot, numbered.</Text>
    </View>
  );
}

// ---------------- one trip ----------------
function TripPage({ trip, tracks, onBack, onPlay, onShowOnMap, onRename, onShare, onDelete }: Props & { trip: TrackMeta; onBack: () => void }) {
  const st = useSt();
  const u = useUnits();
  const [a, setA] = useState<TripAnalysis | null>(null);
  const [name, setName] = useState(trip.name);
  useEffect(() => { let on = true; setA(null); loadTrackPoints(trip.id).then((pts) => on && setA(analyze(pts))).catch(() => {}); return () => { on = false; }; }, [trip.id]);
  useEffect(() => setName(trip.name), [trip.name]);
  const rec = useMemo(() => records(tracks), [tracks]);
  const bins = useMemo(() => (a ? speedBins(a, 40) : []), [a]);
  const top = Math.max(1, ...bins);
  const confirmDelete = () => Alert.alert('Delete this trip?', `"${trip.name}" will be removed from this phone.`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { onDelete(trip); onBack(); } }]);
  return (
    <View style={st.full}>
      <ScreenHeader title={trip.name} subtitle={dateLong(trip.startedAt)} onBack={onBack} backLabel="Trips" />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        <View style={st.card}>
          <Text style={st.k}>Trip name</Text>
          <TextInput value={name} onChangeText={setName} onEndEditing={() => { const n = name.trim(); if (n && n !== trip.name) onRename(trip, n); else setName(trip.name); }}
            style={st.nameIn} returnKeyType="done" maxLength={60} accessibilityLabel="Trip name" />
          <View style={st.times}>
            <View><Text style={st.k}>Start</Text><Text style={st.v}>{clock(trip.startedAt)}</Text></View>
            <View style={st.vline} />
            <View><Text style={st.k}>End</Text><Text style={st.v}>{clock(trip.endedAt)}</Text></View>
          </View>
        </View>

        <View style={st.actions}>
          <Action icon="play" label="Play" tint={colors.accent} filled onPress={() => onPlay(trip)} />
          <Action icon="map-outline" label="Map" tint={colors.accent} onPress={() => onShowOnMap(trip)} />
          <Action icon="share-outline" label="Share" tint={colors.accent} onPress={() => onShare(trip)} />
          <Action icon="trash-outline" label="Delete" tint={colors.alert} onPress={confirmDelete} />
        </View>

        {trip.kind === 'hoop' && trip.hoop ? <HoopCard h={trip.hoop} /> : null}
        <View style={st.grid}>
          <Big k="Distance" v={fmtDist(a?.distanceNm ?? trip.distanceNm, u)} />
          <Big k="Total time" v={fmtDur(tripMinutes(trip))} />
          <Big k="Top speed" v={fmtSpeed(a?.maxKt ?? trip.maxKt, u)} />
          <Big k="Avg speed (moving)" v={fmtSpeed(a?.avgMovingKt ?? trip.avgMovingKt, u)} />
          <Big k="Moving time" v={a ? fmtDur(a.movingMin) : '…'} />
          <Big k="Stopped / fishing" v={a ? fmtDur(Math.max(0, a.durationMin - a.movingMin)) : '…'} />
        </View>

        <View style={st.card}>
          <Text style={st.h}>Speed</Text>
          <View style={st.graph} accessibilityLabel={`Speed graph, top speed ${fmtSpeed(a?.maxKt ?? trip.maxKt, u)}`}>
            {bins.map((b, i) => <View key={i} style={[st.bar, { height: `${Math.max(3, (b / top) * 100)}%` as `${number}%`, backgroundColor: speedColor(b) }]} />)}
          </View>
          <View style={st.axis}><Text style={st.tripDate}>{clock(trip.startedAt)}</Text><Text style={st.tripDate}>{clock(trip.endedAt)}</Text></View>
          <View style={st.legend}>{SPEED_BANDS.map((s) => <View key={s.color} style={st.legItem}><View style={[st.legDot, { backgroundColor: s.color }]} /><Text style={st.legT}>{s.label}</Text></View>)}</View>
        </View>

        {rec.count > 1 ? (
          <>
            <Text style={st.sec}>This trip vs your best</Text>
            <View style={st.card}>
              <Compare k="Top speed" v={trip.maxKt} ref_={rec.best.maxKt} refLabel="Record" fmt={(x) => fmtSpeed(x, u)} color={colors.accent} />
              <Compare k="Distance" v={trip.distanceNm} ref_={rec.best.distanceNm} refLabel="Record" fmt={(x) => fmtDist(x, u)} color={colors.accent} />
              <Compare k="Time" v={tripMinutes(trip)} ref_={rec.best.minutes} refLabel="Record" fmt={fmtDur} color={colors.accent} last />
            </View>
            <Text style={st.sec}>This trip vs your average</Text>
            <View style={st.card}>
              <Compare k="Avg speed" v={trip.avgMovingKt} ref_={rec.avg.avgKt} refLabel="Average" fmt={(x) => fmtSpeed(x, u)} color="#F2542D" />
              <Compare k="Distance" v={trip.distanceNm} ref_={rec.avg.distanceNm} refLabel="Average" fmt={(x) => fmtDist(x, u)} color="#F2542D" />
              <Compare k="Time" v={tripMinutes(trip)} ref_={rec.avg.minutes} refLabel="Average" fmt={fmtDur} color="#F2542D" last />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ---------------- small pieces ----------------
function Stat3({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={{ flex: 1 }}><Text style={st.k}>{k}</Text><Text style={st.v} numberOfLines={1} adjustsFontSizeToFit>{v}</Text></View>;
}
function Big({ k, v }: { k: string; v: string }) {
  const st = useSt();
  return <View style={st.bigStat}><Text style={st.k}>{k}</Text><Text style={st.bigV} numberOfLines={1} adjustsFontSizeToFit>{v}</Text></View>;
}
function Action({ icon, label, tint, filled, onPress }: { icon: string; label: string; tint: string; filled?: boolean; onPress: () => void }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.action, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[st.actionC, { borderColor: tint }, filled && { backgroundColor: tint }]}><Ionicons name={icon as any} size={24} color={filled ? '#FFFFFF' : tint} /></View>
      <Text style={[st.actionT, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}
function Compare({ k, v, ref_, refLabel, fmt, color, last }: { k: string; v: number; ref_: number; refLabel: string; fmt: (x: number) => string; color: string; last?: boolean }) {
  const st = useSt();
  const pct = ref_ > 0 ? Math.min(1, v / ref_) : 0;
  const isRecord = refLabel === 'Record' && ref_ > 0 && v >= ref_;
  return (
    <View style={[st.cmp, !last && st.tripLine]}>
      <View style={st.cmpTop}>
        <Text style={st.cmpK}>{k}</Text>
        <Text style={st.cmpR}>{isRecord ? 'Your record' : `${refLabel} ${fmt(ref_)}`}</Text>
      </View>
      <Text style={st.cmpV}>{fmt(v)}</Text>
      <View style={st.track}><View style={[st.fill, { width: `${Math.max(2, pct * 100)}%` as `${number}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  full: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, zIndex: 50 },
  body: { padding: 14, gap: 12, paddingBottom: 48 },
  card: { backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 },
  recCard: { borderColor: colors.alert, gap: 12 },
  recHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.alert },
  recT: { color: colors.alert, fontWeight: '800', fontSize: 15 },
  bigBtn: { minHeight: touch.min, borderRadius: 14, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  bigBtnT: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, minHeight: 46 },
  searchIn: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 },
  trip: { padding: 14, gap: 10 },
  tripLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  tripHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tripName: { color: colors.text, fontSize: 18, fontWeight: '800' },
  tripDate: { color: colors.muted, fontSize: 13.5 },
  stats3: { flexDirection: 'row', gap: 8 },
  k: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  v: { color: colors.text, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  nameIn: { color: colors.text, fontSize: 18, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 6, marginBottom: 10 },
  times: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: colors.line },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },
  action: { alignItems: 'center', gap: 6, minWidth: 70 },
  actionC: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  actionT: { fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bigStat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 2 },
  bigV: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  h: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  graph: { height: 110, flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: { flex: 1, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legDot: { width: 10, height: 10, borderRadius: 5 },
  legT: { color: colors.muted, fontSize: 12 },
  sec: { color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6, marginLeft: 4 },
  cmp: { paddingVertical: 10, gap: 4 },
  cmpTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cmpK: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cmpR: { color: colors.muted, fontSize: 13.5, fontWeight: '600' },
  cmpV: { color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.inset, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
}));
