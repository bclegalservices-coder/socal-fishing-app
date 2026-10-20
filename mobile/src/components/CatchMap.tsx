// Catch Map markers ("BFT × 17"), drawn as native views on the map so no font files are needed.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import { speciesColor } from '../community/species';

export type Cluster = { lon: number; lat: number; species_code: string; n: number; fish: number; latest: string; verified_n: number; fuzzy: boolean; cell: number };

export function CatchMarkers({ clusters, windowHours, onPress }: { clusters: Cluster[]; windowHours: number; onPress: (c: Cluster) => void }) {
  const st = useSt();
  const now = Date.now();
  return (
    <>
      {clusters.map((c, i) => {
        const ageH = (now - new Date(c.latest).getTime()) / 3600000;
        const opacity = Math.max(0.35, 1 - (ageH / windowHours) * 0.65);     // older activity fades
        return (
          <Marker key={`${c.species_code}-${c.lon.toFixed(3)}-${c.lat.toFixed(3)}-${i}`} lngLat={[c.lon, c.lat]} anchor="center">
            <Pressable onPress={() => onPress(c)} style={[st.pill, { borderColor: speciesColor(c.species_code), opacity }, c.fuzzy && st.fuzzy]}
              accessibilityLabel={`${c.n} ${c.species_code} reports`}>
              <View style={[st.dot, { backgroundColor: speciesColor(c.species_code) }]} />
              <Text style={st.t}>{c.species_code}{c.n > 1 ? ` × ${c.n}` : ''}</Text>
              {c.verified_n ? <Text style={st.v}>✓</Text> : null}
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const useSt = makeStyles((colors) => ({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.panel, borderWidth: 2, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 4 },
  fuzzy: { borderStyle: 'dashed' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  t: { color: colors.text, fontSize: 13, fontWeight: '800' },
  v: { color: colors.live, fontSize: 12, fontWeight: '800' },
}));
