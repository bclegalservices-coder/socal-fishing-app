// Apple-Weather-style pieces for the Weather page: a picture of the conditions (sun, clouds, fog, rain drops,
// lightning, wind), a "right now" card, the name of the place, and a search for any town, harbor or landmark.
// Place names and search use the phone's own map service (expo-location), free and with no account.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { colors, makeStyles } from '../theme';
import type { Day, Hour } from './model';

export type Cond = { key: string; label: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; tint: [string, string] };

/** What the sky is doing in one forecast hour. `night` = between sunset and sunrise. */
export function condition(h: Pick<Hour, 'weather' | 'sky_pct' | 'precip_pct' | 'wind_kt' | 'visibility_nm'> | undefined, night: boolean): Cond {
  const w = (h?.weather ?? '').toLowerCase();
  const sky = h?.sky_pct ?? 0, rain = h?.precip_pct ?? 0, wind = h?.wind_kt ?? 0;
  if (/thunder/.test(w)) return { key: 'storm', label: 'Thunderstorms', icon: 'weather-lightning-rainy', tint: ['#3a3f5c', '#232638'] };
  if (/rain|shower|drizzle/.test(w) || rain >= 50) {
    const heavy = rain >= 70 && /rain/.test(w) && !/slight|chance/.test(w);
    return heavy ? { key: 'pouring', label: 'Rain', icon: 'weather-pouring', tint: ['#44617f', '#2b3f57'] }
      : { key: 'rain', label: /chance|slight/.test(w) ? 'Chance of rain' : 'Showers', icon: 'weather-rainy', tint: ['#5b7896', '#3c556f'] };
  }
  if (/fog|haze|mist|smoke/.test(w) || (h?.visibility_nm != null && h.visibility_nm < 1)) {
    return { key: 'fog', label: /haze|smoke/.test(w) ? 'Hazy' : 'Fog', icon: 'weather-fog', tint: ['#8a98a6', '#66737f'] };
  }
  if (wind >= 20) return { key: 'windy', label: 'Windy', icon: 'weather-windy', tint: ['#4f8fb8', '#2f6890'] };
  if (sky < 25) return night ? { key: 'clear-night', label: 'Clear', icon: 'weather-night', tint: ['#1d2b55', '#0f1834'] }
    : { key: 'sunny', label: 'Sunny', icon: 'weather-sunny', tint: ['#3d8fd8', '#1f6fbf'] };
  if (sky < 70) return night ? { key: 'partly-night', label: 'Partly cloudy', icon: 'weather-night-partly-cloudy', tint: ['#26345e', '#151f3d'] }
    : { key: 'partly', label: 'Partly sunny', icon: 'weather-partly-cloudy', tint: ['#5b9ad0', '#3878b0'] };
  return { key: 'cloudy', label: 'Cloudy', icon: 'weather-cloudy', tint: ['#7d8fa3', '#58697c'] };
}

export const isNight = (iso: string, day?: Day | null) => {
  if (!day?.sunrise || !day?.sunset) { const h = new Date(iso).getHours(); return h < 6 || h >= 19; }
  const t = new Date(iso).getTime();
  return t < new Date(day.sunrise).getTime() || t > new Date(day.sunset).getTime();
};

/** The forecast hour closest to now. */
export function hourNow(hours: Hour[] | undefined): Hour | undefined {
  if (!hours?.length) return undefined;
  const now = Date.now();
  return hours.reduce((best, h) => (Math.abs(new Date(h.t).getTime() - now) < Math.abs(new Date(best.t).getTime() - now) ? h : best), hours[0]);
}

/** "Long Beach" / "Avalon, Catalina Island" / "Off San Pedro" for a point. */
export async function placeName(lat: number, lon: number): Promise<string | null> {
  try {
    const r = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }))[0];
    if (!r) return null;
    const town = r.city || r.subregion || r.district;
    if (r.name && town && r.name !== town && !/^\d/.test(r.name)) return `${r.name}, ${town}`;
    return town || r.name || r.region || null;
  } catch { return null; }
}

/** Big "right now" card: picture, temperature, conditions, today's high/low and wind. */
export function NowCard({ place, sub, hour, today }: { place: string; sub?: string; hour?: Hour; today?: Day | null }) {
  const st = useSt();
  const c = condition(hour, hour ? isNight(hour.t, today) : false);
  return (
    <View style={[st.now, { backgroundColor: c.tint[0] }]}>
      <View style={[st.nowGlow, { backgroundColor: c.tint[1] }]} />
      <View style={{ flex: 1 }}>
        <Text style={st.nowPlace} numberOfLines={1}>{place}</Text>
        {sub ? <Text style={st.nowSub} numberOfLines={1}>{sub}</Text> : null}
        <Text style={st.nowTemp}>{hour?.air_f != null ? `${Math.round(hour.air_f)}°` : '—'}</Text>
        <Text style={st.nowCond}>{c.label}</Text>
        <Text style={st.nowHL}>
          {today?.air_f_hi != null ? `H:${Math.round(today.air_f_hi)}°  L:${Math.round(today.air_f_lo ?? today.air_f_hi)}°` : ''}
          {hour?.wind_kt != null ? `   ·   Wind ${Math.round(hour.wind_kt)}${hour.gust_kt ? `g${Math.round(hour.gust_kt)}` : ''} kt` : ''}
        </Text>
      </View>
      <MaterialCommunityIcons name={c.icon} size={92} color="#FFFFFF" style={st.nowIcon} />
    </View>
  );
}

/** Small picture for an hour or a day card. */
export function CondIcon({ hour, day, size = 22, color }: { hour?: Hour; day?: Day | null; size?: number; color?: string }) {
  const c = condition(hour, hour ? isNight(hour.t, day) : false);
  return <MaterialCommunityIcons name={c.icon} size={size} color={color ?? colors.text} accessibilityLabel={c.label} />;
}

type Result = { label: string; sub: string; lat: number; lon: number };

/** Search any place: a town, harbor, island or landmark. Spots are searched too. */
export function PlaceSearch({ spots, onPick, onClose }: { spots: { name: string; lat: number; lon: number; sub?: string }[]; onPick: (r: Result) => void; onClose: () => void }) {
  const st = useSt();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [places, setPlaces] = useState<Result[]>([]);
  const timer = useRef<any>(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const text = q.trim();
    if (text.length < 3) { setPlaces([]); return; }
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        let hits = await Location.geocodeAsync(text).catch(() => []);
        if (!hits.length) hits = await Location.geocodeAsync(`${text}, California`).catch(() => []);
        const out: Result[] = [];
        for (const h of hits.slice(0, 5)) {
          const name = (await placeName(h.latitude, h.longitude)) ?? text;
          out.push({ label: name, sub: `${h.latitude.toFixed(3)}, ${h.longitude.toFixed(3)}`, lat: h.latitude, lon: h.longitude });
        }
        setPlaces(out);
      } finally { setBusy(false); }
    }, 450);
    return () => clearTimeout(timer.current);
  }, [q]);

  const t = q.trim().toLowerCase();
  const spotHits: Result[] = t.length < 2 ? [] : spots.filter((s) => s.name?.toLowerCase().includes(t)).slice(0, 8)
    .map((s) => ({ label: s.name, sub: s.sub ?? 'Fishing spot', lat: s.lat, lon: s.lon }));
  const rows = [...places.map((p) => ({ ...p, kind: 'place' })), ...spotHits.map((p) => ({ ...p, kind: 'spot' }))];

  return (
    <SafeAreaView style={st.sRoot} edges={['top']}>
      <View style={st.sBar}>
        <MaterialCommunityIcons name="magnify" size={22} color={colors.muted} />
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Town, harbor, island or spot" placeholderTextColor={colors.faint}
          style={st.sInput} returnKeyType="search" autoCorrect={false} />
        {busy ? <ActivityIndicator color={colors.muted} /> : null}
        <Pressable onPress={onClose} hitSlop={10}><Text style={st.sCancel}>Cancel</Text></Pressable>
      </View>
      <FlatList data={rows} keyExtractor={(r, i) => `${r.kind}-${i}-${r.lat}`} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={st.sEmpty}>{t.length < 3 ? 'Try "Avalon", "Newport Beach", "Ensenada" or a spot like "209".' : busy ? '' : 'Nothing found.'}</Text>}
        renderItem={({ item }) => (
          <Pressable style={st.sRow} onPress={() => onPick(item)}>
            <MaterialCommunityIcons name={item.kind === 'place' ? 'map-marker-outline' : 'fish'} size={20} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={st.sName} numberOfLines={1}>{item.label}</Text>
              <Text style={st.sSub} numberOfLines={1}>{item.sub}</Text>
            </View>
          </Pressable>
        )} />
    </SafeAreaView>
  );
}

const useSt = makeStyles((colors) => ({
  now: { borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', minHeight: 170 },
  nowGlow: { position: 'absolute', right: -60, bottom: -80, width: 260, height: 260, borderRadius: 130, opacity: 0.55 },
  nowPlace: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  nowSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginTop: 1 },
  nowTemp: { color: '#FFFFFF', fontSize: 64, fontWeight: '300', letterSpacing: -2, marginTop: 2 },
  nowCond: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  nowHL: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600', marginTop: 4 },
  nowIcon: { marginLeft: 8, textShadowColor: 'rgba(0,0,0,0.18)', textShadowRadius: 8 },
  sRoot: { flex: 1, backgroundColor: colors.bg },
  sBar: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.panelSolid, borderWidth: 1, borderColor: colors.border },
  sInput: { flex: 1, color: colors.text, fontSize: 17 },
  sCancel: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  sEmpty: { color: colors.muted, textAlign: 'center', marginTop: 30, paddingHorizontal: 30 },
  sRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line },
  sName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sSub: { color: colors.muted, fontSize: 12, marginTop: 1 },
}));
