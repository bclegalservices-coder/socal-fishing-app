// Pins your fishing groups shared in the last 24 h: "come to me" pings, positions, catches, spots, overdue alerts.
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import { colors, makeStyles } from '../theme';
import { shareIcon, type Pin } from '../community/groupsApi';

export function GroupPins({ pins, onPress }: { pins: Pin[]; onPress: (p: Pin) => void }) {
  const st = useSt();
  return (
    <>
      {pins.map((p) => {
        const ageH = (Date.now() - new Date(p.created_at).getTime()) / 3600000;
        return (
          <Marker key={p.id} lngLat={[p.lon, p.lat]} anchor="bottom">
            <Pressable onPress={() => onPress(p)} style={[st.pin, ageH > 6 && { opacity: 0.55 }, p.kind === 'overdue' && st.alert, p.kind === 'ping' && st.ping]}
              accessibilityLabel={`${p.who}: ${p.kind}`}>
              <Text style={st.icon}>{shareIcon(p.kind)}</Text>
              <Text style={st.who} numberOfLines={1}>{p.mine ? 'You' : p.who}</Text>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const useSt = makeStyles((colors) => ({
  pin: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.panel, borderRadius: 12, borderWidth: 1, borderColor: colors.buddy, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 140 },
  ping: { borderColor: colors.accent, borderWidth: 2 },
  alert: { borderColor: colors.alert, borderWidth: 2 },
  icon: { fontSize: 14 },
  who: { color: colors.text, fontSize: 11.5, fontWeight: '700' },
}));
