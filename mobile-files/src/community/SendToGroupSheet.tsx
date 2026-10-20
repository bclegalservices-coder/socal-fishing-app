// From the map: "Come to me" / send my position, or share the spot you're looking at — to one or more groups.
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, makeStyles } from '../theme';
import { formatLatLon } from '../geo';
import { Btn, Note, Row, Sheet, Title } from '../components/ui';
import { track } from '../analytics';
import { cachedGroups, myGroups, sendToGroups } from './groupsApi';

const QUICK = ['On fish!', 'Wide open — bring bait', 'Breaking fish here', 'Kelp paddy', 'Bait boat here'];

type Props = { mode: 'me' | 'spot'; pt: { lat: number; lon: number; name?: string } | null; onClose: () => void; onDone: (msg: string) => void };

export function SendToGroupSheet({ mode, pt, onClose, onDone }: Props) {
  const st = useSt();
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cachedGroups().then((g) => { setGroups(g); setChosen(g.map((x) => x.id)); });
    myGroups().then((rows) => { const g = rows.map((r) => ({ id: r.id, name: r.name })); setGroups(g); setChosen((c) => (c.length ? c.filter((id) => g.some((x) => x.id === id)) : g.map((x) => x.id))); }).catch(() => {});
  }, []);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const send = async (kind: 'ping' | 'position' | 'spot') => {
    if (!pt) { Alert.alert('No GPS yet', 'Wait for your position to show on the map, then try again.'); return; }
    const targets = groups.filter((g) => chosen.includes(g.id));
    if (!targets.length) { Alert.alert('Pick a group'); return; }
    setBusy(true);
    const failed = await sendToGroups(targets, kind, kind === 'spot'
      ? { lat: pt.lat, lon: pt.lon, body: note, payload: { name: pt.name || 'Spot' } }
      : { lat: pt.lat, lon: pt.lon, body: note });
    setBusy(false);
    track(kind === 'ping' ? 'group_ping' : kind === 'position' ? 'group_position_sent' : 'group_spot_shared', { groups: targets.length });
    if (failed.length === targets.length) {
      Alert.alert('Not sent', `${failed[0]}\n\nNo signal? Try again when you have service — or use VHF.`);
      return;
    }
    onDone(failed.length ? `Sent, except: ${failed.join('; ')}` : kind === 'ping' ? 'Sent — your buddies can tap it to navigate to you.' : 'Sent to your group.');
  };

  if (!groups.length) {
    return (
      <Sheet>
        <Title>Send to my group</Title>
        <Note>You're not in a fishing group yet. Create one or join with a code in Community → My groups (sign in first).</Note>
        <Btn label="Close" onPress={onClose} />
      </Sheet>
    );
  }
  return (
    <Sheet maxHeight={600}>
      <Title>{mode === 'me' ? 'Send my position' : `Share "${pt?.name ?? 'this spot'}"`}</Title>
      <Text style={st.coord}>{pt ? formatLatLon(pt.lat, pt.lon) : 'Waiting for GPS…'}</Text>
      <View style={st.wrap}>
        {groups.map((g) => (
          <Pressable key={g.id} onPress={() => toggle(g.id)} style={[st.chip, chosen.includes(g.id) && st.on]} accessibilityRole="checkbox" accessibilityState={{ checked: chosen.includes(g.id) }}>
            <Text style={[st.chipT, chosen.includes(g.id) && st.onT]}>{chosen.includes(g.id) ? '✓ ' : ''}{g.name}</Text>
          </Pressable>
        ))}
      </View>
      <View style={st.wrap}>
        {QUICK.map((q) => (
          <Pressable key={q} onPress={() => setNote(q)} style={st.quick}><Text style={st.quickT}>{q}</Text></Pressable>
        ))}
      </View>
      <TextInput value={note} onChangeText={setNote} placeholder="Add a note (optional)" placeholderTextColor={colors.muted} style={st.input} maxLength={200} />
      {mode === 'me' ? (
        <>
          <Btn label={busy ? 'Sending…' : 'Come to me'} icon="megaphone" kind="primary" disabled={busy || !pt} onPress={() => send('ping')} />
          <Row>
            <Btn label="Just my position" icon="locate-outline" disabled={busy || !pt} onPress={() => send('position')} />
            <Btn label="Cancel" onPress={onClose} />
          </Row>
        </>
      ) : (
        <Row>
          <Btn label={busy ? 'Sending…' : 'Share spot'} icon="bookmark" kind="primary" disabled={busy || !pt} onPress={() => send('spot')} />
          <Btn label="Cancel" onPress={onClose} />
        </Row>
      )}
      <Note>Only members of the groups you pick see this — exact coordinates, never the public map. Emergency? Use VHF 16 or call the Coast Guard; this is not an emergency service.</Note>
    </Sheet>
  );
}

const useSt = makeStyles((colors) => ({
  coord: { color: colors.text, fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 12, minHeight: 40, justifyContent: 'center' },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { color: colors.text, fontWeight: '700' },
  onT: { color: colors.accentInk },
  quick: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 10, minHeight: 32, justifyContent: 'center' },
  quickT: { color: colors.muted, fontSize: 13 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
}));
