// Buddy boats from your fishing groups. Live boats are purple; a boat that stopped sharing (or hasn't updated in
// 30 min) turns gray and says when it was last seen — never shown as live when it isn't.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import type { Buddy } from '../community/groupsApi';


export function lastSeen(iso: string, now = Date.now()): string {
  const min = (now - new Date(iso).getTime()) / 60000;
  if (min < 2) return 'now';
  if (min < 60) return `${Math.round(min)} min ago`;
  const d = new Date(iso);
  return `last seen ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function BuddyMarkers({ buddies, rotation, onPress }: { buddies: Buddy[]; rotation: number; onPress: (b: Buddy) => void }) {
  const st = useSt();
  return (
    <>
      {buddies.map((b) => {
        const ageMin = (Date.now() - new Date(b.recorded_at).getTime()) / 60000;
        const gray = b.status === 'last_known' || ageMin > 30;
        const c = gray ? colors.faint : colors.buddy;
        const name = b.boat_name ?? b.display_name ?? 'Buddy';
        return (
          <Marker key={b.user_id} lngLat={[b.lon, b.lat]} anchor="center">
            <Pressable onPress={() => onPress(b)} style={[st.wrap, gray && { opacity: 0.75 }]}
              accessibilityLabel={`${name}, ${gray ? 'last known position' : 'live'}, ${lastSeen(b.recorded_at)}`}>
              <Text style={[st.boat, { color: c, transform: [{ rotate: `${(b.cog_t ?? 0) - rotation}deg` }] }]}>{gray ? '◆' : '▲'}</Text>
              <View style={[st.tag, { borderColor: c }]}>
                <Text style={st.name} numberOfLines={1}>{name}</Text>
                <Text style={st.age}>{!gray && b.sog_kt != null && b.sog_kt > 0.5 ? `${b.sog_kt.toFixed(0)} kt · ` : ''}{gray && b.status === 'last_known' ? 'stopped sharing · ' : ''}{lastSeen(b.recorded_at)}</Text>
              </View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const useSt = makeStyles((colors) => ({
  wrap: { alignItems: 'center' },
  boat: { fontSize: 22, textShadowColor: '#000', textShadowRadius: 3 },
  tag: { backgroundColor: colors.panel, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, maxWidth: 160 },
  name: { color: colors.text, fontSize: 12, fontWeight: '700' },
  age: { color: colors.muted, fontSize: 10.5 },
}));
