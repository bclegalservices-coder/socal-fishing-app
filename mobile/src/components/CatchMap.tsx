// Catch Map markers (Nov 2: "A + E" neon fish pins). Each catch spot is a neon map pin with a fish in it, colored by how
// old the catch is, with a tag under it saying how long ago (2h, 1d, 5d, 3w). Several catches in one spot → a count on
// the pin. Tap → every detail of the catches there (ReportView.tsx). Drawn as native views (no extra libraries).
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Marker } from '@maplibre/maplibre-react-native';
import { speciesName } from '../community/species';

export type Cluster = { lon: number; lat: number; species_code: string; n: number; fish: number; latest: string; verified_n: number; fuzzy: boolean; cell: number };

/** Neon age colors: today pink · 1–2 days orange · 3–7 days lime · older cyan (dimmed). */
export const CATCH_AGE = [
  { maxH: 24, color: '#FF1FD1', ink: '#FFFFFF', label: 'today' },
  { maxH: 72, color: '#FF6A00', ink: '#FFFFFF', label: '1–2 days' },
  { maxH: 168, color: '#C8F000', ink: '#0A1A2A', label: '3–7 days' },
  { maxH: Infinity, color: '#00D8F0', ink: '#0A1A2A', label: 'older' },
];
export const catchAge = (hours: number) => CATCH_AGE.find((a) => hours < a.maxH) ?? CATCH_AGE[CATCH_AGE.length - 1];
/** "now", "45m", "5h", "3d", "2w" */
export function agoShort(hours: number): string {
  if (hours < 1) return hours < 0.25 ? 'now' : `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  if (hours < 24 * 14) return `${Math.round(hours / 24)}d`;
  return `${Math.round(hours / 168)}w`;
}

export function CatchMarkers({ clusters, night, onPress }: { clusters: Cluster[]; windowHours?: number; night?: boolean; onPress: (c: Cluster) => void }) {
  const now = Date.now();
  return (
    <>
      {clusters.map((c, i) => {
        const h = (now - new Date(c.latest).getTime()) / 3600000;
        const a = catchAge(h);
        const old = a.maxH === Infinity;
        return (
          <Marker key={`${c.species_code}-${c.lon.toFixed(4)}-${c.lat.toFixed(4)}-${i}`} lngLat={[c.lon, c.lat]} anchor="bottom">
            <Pressable onPress={() => onPress(c)} hitSlop={6} style={[s.wrap, old && { opacity: 0.62 }]} accessibilityRole="button"
              accessibilityLabel={`${c.n > 1 ? `${c.n} catches` : 'Catch'}: ${speciesName(c.species_code)}, ${agoShort(h)} ago. Tap for details.`}>
              <View style={[s.glow, { shadowColor: a.color }]}>
                <View style={[s.pin, { backgroundColor: a.color, borderColor: night ? '#0B1B2E' : '#FFFFFF' }]}>
                  <View style={s.unrotate}>
                    <MaterialCommunityIcons name="fish" size={21} color={night ? '#0B1B2E' : '#FFFFFF'} />
                  </View>
                </View>
              </View>
              {c.n > 1 ? <View style={[s.count, { borderColor: a.color }]}><Text style={s.countT}>{c.n > 99 ? '99+' : c.n}</Text></View> : null}
              <View style={[s.tag, { backgroundColor: a.color, shadowColor: a.color }]}><Text style={[s.tagT, { color: a.ink }]}>{agoShort(h)}</Text></View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: 'center', paddingTop: 4, paddingHorizontal: 6 },
  glow: { shadowOpacity: 0.95, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  // the classic map pin: a circle with one sharp corner, turned so the corner points down
  pin: { width: 34, height: 34, borderRadius: 17, borderBottomRightRadius: 3, borderWidth: 2, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  unrotate: { transform: [{ rotate: '-45deg' }] },
  count: { position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 3, backgroundColor: '#FFFFFF', borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  countT: { color: '#0A1A2A', fontSize: 10.5, fontWeight: '900' },
  tag: { marginTop: 7, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 1, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  tagT: { fontSize: 11.5, fontWeight: '900' },
});
