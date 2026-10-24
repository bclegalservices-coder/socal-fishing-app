// Me → Send feedback or report a bug. Goes to our API → admin console "Feedback & crashes".
import { useState } from 'react';
import { Alert, Linking, Platform, Switch, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { API_URL, SUPPORT_EMAIL } from '../config';
import { colors, makeStyles } from '../theme';
import { currentArea, track } from '../analytics';
import { Btn, Card, Note, Segmented } from './ui';

type Kind = 'bug' | 'idea' | 'data' | 'other';

export function FeedbackForm({ email: start, onSent }: { email: string; onSent: () => void }) {
  const st = useSt();
  const [kind, setKind] = useState<Kind>('bug');
  const [text, setText] = useState('');
  const [email, setEmail] = useState(start);
  const [withInfo, setWithInfo] = useState(true);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const body = {
      kind, message: text.trim(), email: email.trim() || null,
      app_version: String((Constants as any).expoConfig?.version ?? ''),
      device: withInfo ? `${Platform.OS} ${Platform.Version}` : null, area: withInfo ? currentArea() : null,
    };
    try {
      const r = await fetch(`${API_URL}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      track('feedback_sent', { kind });
      Alert.alert('Thanks!', 'Got it. Every message is read.');
      onSent();
    } catch {
      Alert.alert("Couldn't send right now", SUPPORT_EMAIL ? 'Check your signal and try again, or send it by email instead.' : 'Check your signal and try again.', [
        { text: 'OK', style: 'cancel' },
        ...(SUPPORT_EMAIL ? [{ text: 'Email it', onPress: () => Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Channel Nav ${kind}`)}&body=${encodeURIComponent(text)}`) }] : []),
      ]);
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <Segmented<Kind> value={kind} onChange={setKind}
        options={[{ key: 'bug', label: 'Bug', icon: 'bug-outline' }, { key: 'idea', label: 'Idea', icon: 'bulb-outline' }, { key: 'data', label: 'Wrong info', icon: 'map-outline' }, { key: 'other', label: 'Other' }]} />
      <Text style={st.h}>{kind === 'bug' ? 'What happened? What were you doing right before?' : kind === 'idea' ? 'What would make the app better?' : kind === 'data' ? 'What is wrong, and where? (e.g. "Fuel dock at Cabrillo is closed")' : 'Your message'}</Text>
      <TextInput value={text} onChangeText={setText} multiline placeholder="Type here…" placeholderTextColor={colors.faint} style={st.box} maxLength={4000} />
      <Text style={st.h}>Your email (optional — only if you want a reply)</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.faint} style={st.input}
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <View style={st.row}>
        <Text style={[st.h, { flex: 1, marginTop: 0 }]}>Include app version, phone type and general area</Text>
        <Switch value={withInfo} onValueChange={setWithInfo} />
      </View>
      <Btn label={busy ? 'Sending…' : 'Send'} kind="primary" icon="paper-plane-outline" onPress={send} disabled={busy || text.trim().length < 3 || !API_URL} />
      <Note>Never includes your exact location, spots or catches.</Note>
    </Card>
  );
}

const useSt = makeStyles((colors) => ({
  h: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  box: { minHeight: 130, textAlignVertical: 'top', color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.bg },
  input: { color: colors.text, fontSize: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
}));
