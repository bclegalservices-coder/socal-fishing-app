// Weather page: your location or any spot — 5-day hourly marine forecast rated for YOUR boat,
// the official NWS marine zone text, buoy history (up to 45 days) and tides for any date.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors, makeStyles, touch, useTheme } from '../theme';
import { ageText, getJSON } from '../api';
import { track } from '../analytics';
import { Btn, IconButton, Note } from '../components/ui';
import { SearchSheet } from '../components/SearchSheet';
import { PresentedBy, SponsorBanner } from '../ads/Sponsor';
import { MoonView } from '../weather/MoonView';
import { WindView } from '../weather/WindView';
import { loadPublicSpots, type SavedSpot } from '../storage';
import { BoatSheet } from '../weather/BoatSheet';
import { CondIcon, NowCard, PlaceSearch, hourNow, placeName } from '../weather/Conditions';
import { Bars } from '../weather/Charts';
import {
  addDays, arrow, boatLabel, clock, compass, dayLabel, downsample, hourLabel, isDate, levelColor, levelText, loadBoat, localDate,
  n0, n1, saveBoat, seasText, weatherPath, type Boat, type BuoyRow, type Hour, type WeatherResponse,
} from '../weather/model';
import { friendly } from '../friendly';

type Section = 'forecast' | 'wind' | 'history' | 'tides' | 'moon';
export type WeatherPlace = { lat: number; lon: number; label: string; source: 'gps' | 'search' | 'map' | 'harbor'; tab?: Section };

// Quick picks: points just outside each harbor entrance (on the water, so the marine forecast applies).
const HARBORS: WeatherPlace[] = [
  ['Santa Barbara', 34.395, -119.69], ['Ventura', 34.235, -119.275], ['Channel Islands Hbr', 34.145, -119.235],
  ['Marina del Rey', 33.955, -118.47], ['King Harbor', 33.84, -118.41], ['San Pedro', 33.695, -118.25],
  ['Long Beach', 33.72, -118.12], ['Newport', 33.585, -117.885], ['Dana Point', 33.45, -117.705],
  ['Oceanside', 33.195, -117.405], ['Mission Bay', 32.755, -117.27], ['San Diego Bay', 32.675, -117.245], ['Avalon', 33.35, -118.31],
].map(([label, lat, lon]) => ({ label: `Off ${label}`, lat: lat as number, lon: lon as number, source: 'harbor' as const }));
/** Rough distance in nautical miles (good enough to sort harbors). */
const nm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 60, (a.lon - b.lon) * 60 * Math.cos((a.lat * Math.PI) / 180));
const nearest = (p: { lat: number; lon: number } | null, n: number) =>
  (p ? [...HARBORS].sort((x, y) => nm(p, x) - nm(p, y)) : HARBORS).slice(0, n);
const COURSES: { label: string; deg: number | null }[] = [
  { label: 'Not set', deg: null }, { label: 'N', deg: 0 }, { label: 'NE', deg: 45 }, { label: 'E', deg: 90 }, { label: 'SE', deg: 135 },
  { label: 'S', deg: 180 }, { label: 'SW', deg: 225 }, { label: 'W', deg: 270 }, { label: 'NW', deg: 315 },
];

export function WeatherScreen({ at, mySpots }: { at: WeatherPlace | null; mySpots: SavedSpot[] }) {
  const st = useSt();
  const [place, setPlace] = useState<WeatherPlace | null>(at);
  const [boat, setBoat] = useState<Boat | null>(null);
  const [boatIsSet, setBoatIsSet] = useState(true);
  const [course, setCourse] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('forecast');
  const [editBoat, setEditBoat] = useState(false);
  const [searching, setSearching] = useState(false);
  const [publicSpots, setPublicSpots] = useState<any>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => { if (at) { setPlace(at); if (at.tab) setSection(at.tab); } }, [at]);
  useEffect(() => {
    loadBoat().then(({ boat: b, isSet }) => { setBoat(b); setBoatIsSet(isSet); });
    loadPublicSpots().then(setPublicSpots);
    if (!at) locateMe();
  }, []);

  async function locateMe() {
    setLocErr(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') throw new Error('Location permission is off');
      const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      setPlace({ ...p, label: 'My location', source: 'gps' });
      placeName(p.lat, p.lon).then((n) => { if (n) setPlace((cur) => (cur?.source === 'gps' && cur.lat === p.lat ? { ...cur, label: n } : cur)); });
    } catch (e: any) {
      setLocErr(friendly(e));
      setPlace((p) => p ?? HARBORS[7]);
    }
  }

  const go = (p: WeatherPlace) => { setPlace(p); setSearching(false); };
  if (searching) {
    const spots = [
      ...mySpots.map((s: any) => ({ name: s.name, lat: s.lat, lon: s.lon, sub: 'My spot' })),
      ...((publicSpots?.features ?? []) as any[]).map((f) => ({ name: f.properties?.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], sub: f.properties?.subtitle })),
    ];
    return <PlaceSearch spots={spots} onClose={() => setSearching(false)}
      onPick={(r) => { go({ lat: r.lat, lon: r.lon, label: r.label, source: 'search' }); track('weather_search_pick'); }} />;
  }
  if (editBoat && boat) {
    return <BoatSheet boat={boat} onClose={() => setEditBoat(false)}
      onSave={async (b) => { setBoat(b); setBoatIsSet(true); setEditBoat(false); await saveBoat(b); track('boat_set', { boat_type: b.type, length_band: lengthBand(b.length_ft), comfort: b.comfort }); }} />;
  }

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <View style={{ flex: 1 }}>
          <Text style={st.title} numberOfLines={1}>{place?.label ?? 'Weather'}</Text>
          {place ? <Text style={st.coords}>{place.lat.toFixed(3)}, {place.lon.toFixed(3)}</Text> : null}
        </View>
        <IconButton icon="navigate" label="Use my location" onPress={locateMe} />
        <IconButton icon="search" label="Search a place or spot" onPress={() => setSearching(true)} />
      </View>
      {/* Closest harbors as clear buttons, and every harbor one tap away */}
      <View style={st.nearRow}>
        {nearest(place, 3).map((h) => {
          const on = place?.label === h.label;
          return (
            <Pressable key={h.label} onPress={() => go(h)} style={[st.near, on && st.nearOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <MaterialCommunityIcons name="anchor" size={14} color={on ? colors.accentInk : colors.accent} />
              <Text style={[st.nearT, on && st.nearTOn]} numberOfLines={1}>{h.label.replace('Off ', '')}</Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setPicking(true)} style={[st.near, st.nearAll]} accessibilityRole="button">
          <MaterialCommunityIcons name="format-list-bulleted" size={15} color={colors.text} />
          <Text style={st.nearT}>All harbors</Text>
        </Pressable>
      </View>
      <Modal visible={picking} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicking(false)}>
        <View style={st.pick}>
          <View style={st.pickHead}>
            <Text style={st.pickH}>Harbors</Text>
            <Pressable onPress={() => setPicking(false)} hitSlop={10}><Text style={st.pickDone}>Done</Text></Pressable>
          </View>
          <Pressable style={st.pickRow} onPress={() => { setPicking(false); locateMe(); }}>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={colors.accent} />
            <Text style={[st.pickName, { color: colors.accent }]}>My location</Text>
          </Pressable>
          <Pressable style={st.pickRow} onPress={() => { setPicking(false); setSearching(true); }}>
            <MaterialCommunityIcons name="magnify" size={20} color={colors.accent} />
            <Text style={[st.pickName, { color: colors.accent }]}>Search any town, island or spot</Text>
          </Pressable>
          <Text style={st.pickCap}>Southern California harbors</Text>
          <ScrollView>
            {nearest(place, HARBORS.length).map((h) => (
              <Pressable key={h.label} style={st.pickRow} onPress={() => { setPicking(false); go(h); }}>
                <MaterialCommunityIcons name="anchor" size={20} color={colors.muted} />
                <Text style={st.pickName}>{h.label.replace('Off ', '')}</Text>
                {place ? <Text style={st.pickDist}>{Math.round(nm(place, h))} nm</Text> : null}
                {place?.label === h.label ? <MaterialCommunityIcons name="check" size={20} color={colors.accent} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
      {locErr ? <Text style={st.warn}>{locErr}</Text> : null}
      <View style={st.seg}>
        {(['forecast', 'wind', 'tides', 'moon', 'history'] as Section[]).map((s) => (
          <Pressable key={s} onPress={() => { setSection(s); track('weather_section', { section: s }); }} style={[st.segI, section === s && st.segOn]}
            accessibilityRole="tab" accessibilityState={{ selected: section === s }}>
            <Text style={[st.segT, section === s && st.segOnT]} numberOfLines={1}>{s === 'forecast' ? 'Forecast' : s === 'wind' ? 'Wind' : s === 'history' ? 'Past' : s === 'tides' ? 'Tides' : 'Moon'}</Text>
          </Pressable>
        ))}
      </View>
      {!place || !boat ? <ActivityIndicator color={colors.live} style={{ marginTop: 40 }} /> : section === 'forecast' ? (
        <Forecast place={place} boat={boat} boatIsSet={boatIsSet} course={course} setCourse={setCourse} onEditBoat={() => setEditBoat(true)} />
      ) : section === 'wind' ? <WindView place={place} boat={boat} /> : section === 'history' ? <History place={place} /> : section === 'tides' ? <Tides place={place} /> : <MoonView lat={place.lat} lon={place.lon} place={place.label} />}
    </SafeAreaView>
  );
}

const lengthBand = (l: number | null) => (l == null ? 'unknown' : l < 18 ? 'under_18' : l < 26 ? '18_25' : l < 36 ? '26_35' : '36_plus');

// ---------------------------------------------------------------- forecast
function Forecast({ place, boat, boatIsSet, course, setCourse, onEditBoat }: {
  place: WeatherPlace; boat: Boat; boatIsSet: boolean; course: number | null; setCourse: (c: number | null) => void; onEditBoat: () => void;
}) {
  const st = useSt();
  const { mode } = useTheme();
  const [res, setRes] = useState<{ data: WeatherResponse; cached: boolean; savedAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [openHour, setOpenHour] = useState<string | null>(null);
  const [showZone, setShowZone] = useState(false);
  const path = weatherPath(place.lat, place.lon, boat, course);

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await getJSON<WeatherResponse>(path, { cacheKey: `wx:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${boat.type}:${boat.length_ft}:${boat.comfort}:${course}`, timeoutMs: 20000 });
      setRes(r);
      track('weather_view', { source: place.source, boat_type: boat.type, cached: r.cached });
    } catch (e: any) { setErr(friendly(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); setDay(null); setOpenHour(null); }, [path]);

  const f = res?.data.forecast;
  const days = f?.daily ?? [];
  const selDay = day ?? days[0]?.date ?? null;
  const hours = useMemo(() => (f?.hourly ?? []).filter((h) => localDate(h.t) === selDay), [f, selDay]);
  const alerts = f?.alerts ?? [];

  return (
    <ScrollView contentContainerStyle={st.body} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.live} />}>
      {f?.available ? <NowCard place={place.label} sub={place.source === 'gps' ? 'My location' : f.place ?? undefined} hour={hourNow(f.hourly)} today={days[0]} /> : null}
      <Pressable onPress={onEditBoat} style={st.boat} accessibilityLabel="Change my boat">
        <Text style={st.boatK}>Rated for</Text>
        <Text style={st.boatV}>{boatLabel(boat)}{boatIsSet ? '' : ' (default — tap to set yours)'}</Text>
        <Text style={st.boatEdit}>Change ›</Text>
      </Pressable>
      <View>
        <Text style={st.smallH}>Heading toward (optional — rates beam vs. head seas)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 }}>
          {COURSES.map((c) => (
            <Pressable key={c.label} onPress={() => setCourse(c.deg)} style={[st.pill, { minWidth: 44, alignItems: 'center' }, course === c.deg && st.pillOn]}>
              <Text style={[st.pillT, course === c.deg && st.pillOnT]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {alerts.map((a, i) => (
        <View key={i} style={st.alert}>
          <Text style={st.alertT}>⚠ {a.event}</Text>
          {a.headline ? <Text style={st.alertS}>{a.headline}</Text> : null}
        </View>
      ))}
      {res?.cached ? <Text style={st.warn}>Offline — showing the forecast saved {ageText(new Date(res.savedAt).toISOString())}.</Text> : null}
      {err && !res ? <Text style={st.warn}>Couldn't load the forecast ({err}). Pull down to retry.</Text> : null}
      <PresentedBy section="Weather" />

      {f && !f.available ? <Note>{f.note}</Note> : null}
      {f?.available && !f.has_marine ? (
        <Text style={st.warn}>No sea forecast for this exact point (it's on land or inside a harbor). Wind and weather are shown; pick a harbor above for seas.</Text>
      ) : null}

      {days.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map((d) => (
            <Pressable key={d.date} onPress={() => { setDay(d.date); setOpenHour(null); track('weather_day_open', { level: d.summary.level ?? 'none' }); }}
              style={[st.dayCard, selDay === d.date && { borderColor: colors.text }]}
              accessibilityLabel={`${dayLabel(d.date)}: ${d.summary.label}`}>
              <View style={[st.dayBar, { backgroundColor: levelColor(d.summary.level) }]} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={st.dayName}>{dayLabel(d.date)}</Text>
                <CondIcon size={24} day={d} hour={(f?.hourly ?? []).find((h) => localDate(h.t) === d.date && new Date(h.t).getHours() === 12) ?? (f?.hourly ?? []).find((h) => localDate(h.t) === d.date)} />
              </View>
              <Text style={[st.dayVerdict, { color: levelText(d.summary.level, mode) }]}>{d.summary.label}</Text>
              <View style={st.dayRow}><MaterialCommunityIcons name="weather-windy" size={15} color={colors.muted} /><Text style={st.dayLine}>{n0(d.wind_kt_max)}{d.gust_kt_max ? `g${n0(d.gust_kt_max)}` : ''} kt</Text></View>
              <View style={st.dayRow}><MaterialCommunityIcons name="waves" size={15} color={colors.muted} /><Text style={st.dayLine}>{d.seas_ft_min != null ? `${n0(d.seas_ft_min)}–${n0(d.seas_ft_max)}` : '—'} ft</Text></View>
              <View style={st.dayRow}><MaterialCommunityIcons name="thermometer" size={15} color={colors.muted} /><Text style={st.dayLine}>{n0(d.air_f_lo)}–{n0(d.air_f_hi)}°</Text></View>
              {d.summary.window ? <Text style={st.dayWin}>Best {hourLabel(d.summary.window.start)}–{hourLabel(addHour(d.summary.window.end))}</Text> : <Text style={st.dayWin}>No good window</Text>}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {selDay ? (() => {
        const d = days.find((x) => x.date === selDay);
        return d ? (
          <View style={st.card}>
            <Text style={st.cardH}>{dayLabel(d.date)} — {d.summary.label}</Text>
            {d.summary.window ? <Text style={st.line}>Best window: {hourLabel(d.summary.window.start)}–{hourLabel(addHour(d.summary.window.end))} ({d.summary.window.hours} h, {d.summary.window.worst === 'bumpy' ? 'some bumps' : 'comfortable'})</Text> : null}
            {(d.summary.reasons ?? []).map((r, i) => <Text key={i} style={st.reason}>• {r}</Text>)}
            <View style={st.dayRow}><MaterialCommunityIcons name="weather-sunset-up" size={16} color={colors.muted} /><Text style={st.line}>Sunrise {clock(d.sunrise)} · Sunset {clock(d.sunset)}</Text></View>
            <View style={st.dayRow}><MaterialCommunityIcons name="moon-waning-crescent" size={16} color={colors.muted} /><Text style={st.line}>{d.moon?.name} ({Math.round((d.moon?.illumination ?? 0) * 100)}% lit)</Text></View>
          </View>
        ) : null;
      })() : null}

      {hours.length ? (
        <View style={st.card}>
          <View style={st.hRow}>
            <Text style={[st.th, { width: 40 }]}>Time</Text><Text style={[st.th, { flex: 1 }]}>Boat</Text>
            <Text style={[st.th, { width: 72 }]}>Wind kt</Text><Text style={[st.th, { width: 84 }]}>Seas</Text><Text style={[st.th, { width: 40 }]}>Air</Text>
          </View>
          {hours.map((h) => <HourRow key={h.t} h={h} open={openHour === h.t} onPress={() => setOpenHour(openHour === h.t ? null : h.t)} />)}
          <Note>Tap an hour for the why. * period estimated from local wind chop. Arrows point where wind and swell are going.</Note>
        </View>
      ) : null}

      {f?.available ? <SponsorBanner placement="banner_weather" /> : null}

      {res?.data.buoy_now ? <BuoyNow b={res.data.buoy_now} /> : null}

      {res?.data.zone ? (
        <View style={st.card}>
          <Pressable onPress={() => setShowZone(!showZone)}>
            <Text style={st.cardH}>Official NWS marine forecast {showZone ? '▾' : '▸'}</Text>
            <Text style={st.sub}>{res.data.zone.zone} · {res.data.zone.name}</Text>
          </Pressable>
          {res.data.zone.headlines.map((h, i) => <Text key={i} style={st.alertS}>⚠ {h}</Text>)}
          {(showZone ? res.data.zone.periods : res.data.zone.periods.slice(0, 2)).map((p, i) => (
            <Text key={i} style={st.line}><Text style={{ fontWeight: '700' }}>{p.name}: </Text>{p.text}</Text>
          ))}
          {res.data.zone.issued ? <Text style={st.sub}>Issued {res.data.zone.issued}</Text> : null}
        </View>
      ) : null}

      {f?.updated ? <Text style={st.sub}>NWS forecast updated {ageText(f.updated)}{f.office ? ` · office ${f.office}` : ''}</Text> : null}
      <Text style={st.disclaimer}>{res?.data.disclaimer ?? 'Boat ratings are planning guidance, not a guarantee. NWS warnings and your own judgment come first.'}</Text>
    </ScrollView>
  );
}

const addHour = (iso: string) => new Date(new Date(iso).getTime() + 3600000).toISOString();

function HourRow({ h, open, onPress }: { h: Hour; open: boolean; onPress: () => void }) {
  const st = useSt();
  const { mode } = useTheme();
  const r = h.rating;
  return (
    <Pressable onPress={onPress} style={st.hourWrap} accessibilityLabel={`${hourLabel(h.t)}: ${r.label}, wind ${n0(h.wind_kt)} knots, seas ${seasText(h)}`}>
      <View style={st.hRow}>
        <Text style={[st.td, { width: 40 }]}>{hourLabel(h.t)}</Text>
        <CondIcon hour={h} size={18} />
        <View style={[st.lvl, { flex: 1 }]}>
          <View style={[st.dot, { backgroundColor: levelColor(r.level) }]} />
          <Text style={[st.td, { color: levelText(r.level, mode), fontWeight: '700' }]}>{r.label}</Text>
        </View>
        <Text style={[st.td, { width: 72 }]}>{arrow(h.wind_dir)} {n0(h.wind_kt)}{h.gust_kt && h.gust_kt > (h.wind_kt ?? 0) + 3 ? `g${n0(h.gust_kt)}` : ''}</Text>
        <Text style={[st.td, { width: 84 }]}>{seasText(h)}</Text>
        <Text style={[st.td, { width: 40 }]}>{n0(h.air_f)}°</Text>
      </View>
      {open ? (
        <View style={st.detail}>
          {r.reasons.map((x, i) => <Text key={i} style={st.reason}>• {x}</Text>)}
          {r.rule_2x ? <Text style={[st.reason, { color: r.rule_2x.passes ? colors.text : '#F08A3C' }]}>2× rule: {r.rule_2x.text}</Text> : null}
          <Text style={st.sub}>
            Steepness: {r.steepness.replace('_', ' ')}{r.relative ? ` · seas on your ${r.relative === 'head' ? 'bow' : r.relative === 'beam' ? 'beam' : 'stern'}` : ''}
            {' '}· your limits {r.limits.seas_ft} ft / {r.limits.wind_kt} kt
          </Text>
          <Text style={st.sub}>
            Wind {compass(h.wind_dir)} {n0(h.wind_kt)} kt{h.gust_kt ? `, gusts ${n0(h.gust_kt)}` : ''}
            {h.swell_ft ? ` · Swell ${n1(h.swell_ft)} ft ${compass(h.swell_dir)}` : ''}{h.swell2_ft ? ` + ${n1(h.swell2_ft)} ft ${compass(h.swell2_dir)}` : ''}
            {h.wind_wave_ft ? ` · Wind waves ${n1(h.wind_wave_ft)} ft` : ''}
            {h.precip_pct ? ` · Rain ${n0(h.precip_pct)}%` : ''}{h.visibility_nm != null ? ` · Vis ${n1(h.visibility_nm)} NM` : ''}{h.weather ? ` · ${h.weather}` : ''}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function BuoyNow({ b }: { b: any }) {
  const st = useSt();
  return (
    <View style={st.card}>
      <Text style={st.cardH}>Measured now — {b.station?.name ?? `Buoy ${b.station?.id}`}</Text>
      <Text style={st.sub}>{b.distance_nm} NM away · {ageText(b.observed_at)} · NOAA NDBC (observed, not forecast)</Text>
      <Text style={st.line}>
        Waves {b.wave_ft != null ? `${b.wave_ft} ft @ ${b.dominant_period_s ?? '—'} s ${compass(b.wave_dir)}` : '—'} · Wind {n0(b.wind_kt)}{b.gust_kt ? `g${n0(b.gust_kt)}` : ''} kt {compass(b.wind_dir)} · Water {b.water_f ?? '—'}°F
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- past data
function History({ place }: { place: WeatherPlace }) {
  const st = useSt();
  const [days, setDays] = useState(7);
  const [station, setStation] = useState<string | null>(null);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    getJSON<any>(`/weather/history?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}&days=${days}${station ? `&station=${station}` : ''}`,
      { cacheKey: `wxh:${station ?? place.lat.toFixed(2) + ',' + place.lon.toFixed(2)}:${days}`, timeoutMs: 20000 })
      .then((r) => { setData(r.data); track('weather_history_view', { days }); })
      .catch((e) => setErr(friendly(e)));
  }, [place.lat, place.lon, days, station]);
  const rows: BuoyRow[] = data?.rows ?? [];
  const first = rows[0]?.t, last = rows[rows.length - 1]?.t;
  const span = (t?: string) => (t ? `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}` : '');
  return (
    <ScrollView contentContainerStyle={st.body}>
      <View style={st.segSmall}>
        {[1, 3, 7, 14, 30, 45].map((d) => (
          <Pressable key={d} onPress={() => setDays(d)} style={[st.pill, days === d && st.pillOn]}>
            <Text style={[st.pillT, days === d && st.pillOnT]}>{d === 1 ? '24 h' : `${d} d`}</Text>
          </Pressable>
        ))}
      </View>
      {data?.nearby ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {data.nearby.map((s: any) => (
            <Pressable key={s.id} onPress={() => setStation(s.id)} style={[st.pill, data.station.id === s.id && st.pillOn]}>
              <Text style={[st.pillT, data.station.id === s.id && st.pillOnT]}>{s.name ?? s.id} · {s.distance_nm} NM</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {err && !data ? <Text style={st.warn}>Couldn't load buoy history ({err}).</Text> : null}
      {!data && !err ? <ActivityIndicator color={colors.live} /> : null}
      {data ? (
        <View style={[st.card, { gap: 16 }]}>
          <Text style={st.sub}>Measured by NOAA buoy {data.station.id} ({data.station.name}) — observed, not forecast. NDBC keeps 45 days online.</Text>
          <Bars label="Wave height" unit=" ft" data={downsample(rows, 'wave_ft')} color="#62CBE2" startLabel={span(first)} endLabel={span(last)} />
          <Bars label="Dominant period" unit=" s" data={downsample(rows, 'period_s')} color="#8FA8FF" startLabel={span(first)} endLabel={span(last)} />
          <Bars label="Wind (gusts as dots)" unit=" kt" data={downsample(rows, 'wind_kt')} overlay={downsample(rows, 'gust_kt').map((p) => p.v)}
            colorFor={(v) => (v >= 21 ? '#E5484D' : v >= 15 ? '#F08A3C' : '#3FBF7F')} startLabel={span(first)} endLabel={span(last)} />
          <Bars label="Water temp" unit="°F" data={downsample(rows, 'water_f')} color="#16A34A" zeroBased={false} startLabel={span(first)} endLabel={span(last)} />
          <Bars label="Air temp" unit="°F" data={downsample(rows, 'air_f')} color="#C9A27A" zeroBased={false} startLabel={span(first)} endLabel={span(last)} />
          <Bars label="Pressure" unit=" mb" data={downsample(rows, 'pressure_mb')} color="#A3B4C1" zeroBased={false} startLabel={span(first)} endLabel={span(last)} />
        </View>
      ) : null}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- tides
function Tides({ place }: { place: WeatherPlace }) {
  const st = useSt();
  const today = localDate(new Date().toISOString());
  const [date, setDate] = useState(today);
  const [typed, setTyped] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setErr(null); setData(null);
    // Ask for the local day plus a margin; the server works in UTC.
    getJSON<any>(`/tides/range?lat=${place.lat.toFixed(4)}&lon=${place.lon.toFixed(4)}&begin=${addDays(date, -1)}&end=${addDays(date, 1)}`,
      { cacheKey: `tide:${place.lat.toFixed(2)},${place.lon.toFixed(2)}:${date}`, timeoutMs: 20000 })
      .then((r) => { setData(r.data); track('tide_date_view', { past: date < today, future: date > today }); })
      .catch((e) => setErr(friendly(e)));
  }, [place.lat, place.lon, date]);

  const curve = (data?.curve ?? []).filter((p: any) => localDate(p.t) === date);
  const obsBy = new Map<string, number>((data?.observed ?? []).map((p: any) => [p.t, p.v]));
  const hilo = (data?.hilo ?? []).filter((p: any) => localDate(p.t) === date);
  return (
    <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
      <View style={st.dateRow}>
        <Btn label="Week" icon="play-back-outline" onPress={() => setDate(addDays(date, -7))} />
        <Btn label="Day" icon="chevron-back" onPress={() => setDate(addDays(date, -1))} />
        <Btn label="Today" onPress={() => setDate(today)} />
        <Btn label="Day" icon="chevron-forward" onPress={() => setDate(addDays(date, 1))} />
        <Btn label="Week" icon="play-forward-outline" onPress={() => setDate(addDays(date, 7))} />
      </View>
      <View style={st.dateRow}>
        <TextInput value={typed} onChangeText={setTyped} placeholder="Any date: YYYY-MM-DD" placeholderTextColor={colors.muted}
          style={st.input} autoCorrect={false} accessibilityLabel="Tide date" />
        <Btn label="Go" kind="primary" disabled={!isDate(typed)} onPress={() => { setDate(typed); setTyped(''); }} />
      </View>
      <Text style={st.cardH}>{dayLabel(date)} · {date}</Text>
      {err ? <Text style={st.warn}>Couldn't load tides ({err}).</Text> : null}
      {!data && !err ? <ActivityIndicator color={colors.live} /> : null}
      {data ? (
        <View style={[st.card, { gap: 12 }]}>
          <Text style={st.sub}>NOAA station {data.station.name} ({data.station.id}) · {data.distance_nm} NM away · feet above MLLW</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
            {hilo.map((p: any, i: number) => (
              <Text key={i} style={st.tideHL}>{p.type === 'H' ? '▲ High' : '▼ Low'} {clock(p.t)} · {n1(p.v)} ft</Text>
            ))}
          </View>
          <Bars data={curve.map((p: any) => ({ t: p.t, v: p.v }))} overlay={curve.map((p: any) => obsBy.get(p.t) ?? null)}
            height={110} color="#3E7CA6" zeroBased={false} label="Tide height (predicted)" unit=" ft"
            startLabel="12a" endLabel="11p" />
          {data.observed?.length ? <Note>Orange marks are the MEASURED water level at the gauge — the difference from predicted is surge/weather.</Note> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const useSt = makeStyles((colors) => ({
  nearRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 10 },
  near: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border },
  nearOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  nearAll: { backgroundColor: colors.inset },
  nearT: { color: colors.text, fontSize: 14, fontWeight: '600', maxWidth: 140 },
  nearTOn: { color: colors.accentInk },
  pick: { flex: 1, backgroundColor: colors.bg, paddingTop: 8 },
  pickHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12 },
  pickH: { color: colors.text, fontSize: 24, fontWeight: '800' },
  pickDone: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  pickCap: { color: colors.muted, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: colors.panelSolid, borderBottomWidth: 0.5, borderColor: colors.line },
  pickName: { flex: 1, color: colors.text, fontSize: 16.5 },
  pickDist: { color: colors.muted, fontSize: 14, fontVariant: ['tabular-nums'] },
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.panelSolid, borderBottomWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  coords: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  hBtn: { width: touch.min, height: touch.min, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  hBtnT: { fontSize: 20 },
  harbors: { gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  pill: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillT: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  pillOnT: { color: colors.accentInk },
  seg: { flexDirection: 'row', marginHorizontal: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: 'hidden' },
  segSmall: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segI: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.panelSolid },
  segT: { color: colors.muted, fontWeight: '700', fontSize: 14 },
  segOnT: { color: colors.text },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  boat: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.panelSolid, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12 },
  boatK: { color: colors.muted, fontSize: 12 },
  boatV: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  boatEdit: { color: colors.live, fontWeight: '700' },
  smallH: { color: colors.muted, fontSize: 12 },
  alert: { backgroundColor: colors.alertBg, borderColor: colors.alert, borderWidth: 1, borderRadius: 10, padding: 10, gap: 2 },
  alertT: { color: colors.alert, fontWeight: '800', fontSize: 15 },
  alertS: { color: colors.alert, fontSize: 13 },
  warn: { color: colors.warn, fontSize: 13, paddingHorizontal: 16 },
  dayCard: { width: 128, backgroundColor: colors.panelSolid, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, padding: 10, gap: 2, overflow: 'hidden' },
  dayBar: { position: 'absolute', left: 0, right: 0, top: 0, height: 5 },
  dayName: { color: colors.text, fontWeight: '800', fontSize: 15, marginTop: 4 },
  dayVerdict: { fontWeight: '800', fontSize: 15 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dayLine: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  dayWin: { color: colors.muted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: colors.panelSolid, borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 6 },
  cardH: { color: colors.text, fontSize: 16, fontWeight: '800' },
  line: { color: colors.text, fontSize: 14, lineHeight: 20 },
  reason: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  sub: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  hRow: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  hourWrap: { borderTopWidth: 1, borderColor: colors.line },
  th: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  td: { color: colors.text, fontSize: 14, fontVariant: ['tabular-nums'] },
  lvl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  detail: { paddingBottom: 10, paddingLeft: 40, gap: 3 },
  disclaimer: { color: colors.muted, fontSize: 12, lineHeight: 17, borderTopWidth: 1, borderColor: colors.line, paddingTop: 10 },
  dateRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: { flex: 2, height: touch.min, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, color: colors.text, paddingHorizontal: 12, fontSize: 16, backgroundColor: colors.panelSolid },
  tideHL: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
}));
