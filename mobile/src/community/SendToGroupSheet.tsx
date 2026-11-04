// From the map: "Come to me" / send my position, or share the spot you're looking at — to one or more groups.
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { formatLatLon } from '../geo';
import { Note, Sheet, Title } from '../components/ui';
import { ChipSet, Field, FormCard, FormSheet, InfoLine, SaveBar } from '../components/form';
import { track } from '../analytics';
import { cachedGroups, myGroups, sendToGroups } from './groupsApi';

const QUICK = ['On fish!', 'Wide open — bring bait', 'Breaking fish here', 'Kelp paddy', 'Bait boat here'];

type Props = { mode: 'me' | 'spot'; pt: { lat: number; lon: number; name?: string } | null; onClose: () => void; onDone: (msg: string) => void };

export function SendToGroupSheet({ mode, pt, onClose, onDone }: Props) {
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
      <Sheet onClose={onClose}>
        <Title>Send to my group</Title>
        <Note>You're not in a fishing group yet. Create one or join with a code in the Crew tab (sign in first).</Note>
      </Sheet>
    );
  }
  // Nov 4: shared form look (components/form.tsx)
  const where = pt ? formatLatLon(pt.lat, pt.lon) : 'Waiting for GPS…';
  return (
    <FormSheet title={mode === 'me' ? 'Send my position' : `Share "${pt?.name ?? 'this spot'}"`} where={where} onClose={onClose}
      footer={mode === 'me'
        ? <SaveBar label="Come to me" busy={busy} missing={!pt ? 'Waiting for GPS…' : !chosen.length ? 'Pick a group' : null} onPress={() => send('ping')}
            secondary={{ label: 'Just my position', onPress: () => send('position') }} />
        : <SaveBar label="Share spot" busy={busy} missing={!pt ? 'Waiting for GPS…' : !chosen.length ? 'Pick a group' : null} onPress={() => send('spot')} />}>
      <FormCard label="Send to" tag={`${chosen.length} of ${groups.length}`}>
        <ChipSet items={groups.map((g) => ({ key: g.id, label: g.name, icon: chosen.includes(g.id) ? 'checkbox' : 'square-outline' }))} value={chosen} onChange={toggle} />
      </FormCard>
      <FormCard label="Message" tag="Optional">
        <ChipSet items={QUICK.map((q) => ({ key: q, label: q }))} value={QUICK.includes(note) ? note : null} onChange={(q) => setNote(note === q ? '' : q)} />
        <Field value={note} onChangeText={setNote} placeholder="Add a note" />
      </FormCard>
      <InfoLine icon="lock-closed-outline" text="Only members of the groups you pick see this, with exact coordinates. Never on the public map." />
      <InfoLine icon="warning-outline" text="Emergency? Use VHF 16 or call the Coast Guard. This is not an emergency service." />
    </FormSheet>
  );
}
