// Account (email code sign-in), profile basics, and the Data Sources page (spec §34, §35, §52).
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { ageText, getJSON } from '../api';
import { supabase, supabaseReady } from '../supabase';
import { cardStyle, colors, makeStyles, touch, useTheme, type ThemeSetting } from '../theme';
import { COORD_EXAMPLES, chooseCoordFormat, useCoordFormat } from '../coordPref';
import { Btn, Card, ListGroup, ListRow, Note, ScreenHeader, SectionLabel, Segmented } from '../components/ui';
import { MyFishingScreen } from './MyFishingScreen';
import { DEMO_EMAIL, PRIVACY_URL, STUDIO_URL, SUPPORT_EMAIL, TERMS_URL } from '../config';
import { AlertsScreen } from './AlertsScreen';
import { OfflineScreen } from './OfflineScreen';
import { SavedCoupons } from '../ads/Sponsor';
import { AD_SPACES, adPreviewOn, setAdPreview } from '../ads/ads';
import { getOptOut, setOptOut, track } from '../analytics';
import { friendly } from '../friendly';
import { FeedbackForm } from '../components/Feedback';
import { FULL_TEXT } from '../legal';

export function ProfileScreen({ onShowOnMap }: { onShowOnMap: (lat: number, lon: number, name: string) => void }) {
  const st = useSt();
  const theme = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [page, setPage] = useState<'main' | 'sources' | 'alerts' | 'offline' | 'fishing' | 'account' | 'coupons' | 'feedback' | 'legal'>('main');
  useEffect(() => {
    if (!supabaseReady) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  const back = () => setPage('main');

  if (page === 'sources') return <DataSources onBack={back} />;
  if (page === 'alerts') return <AlertsScreen onBack={back} />;
  if (page === 'offline') return <OfflineScreen onBack={back} />;
  if (page === 'fishing') return <MyFishingScreen onShowOnMap={onShowOnMap} onBack={back} />;
  if (page === 'legal') return (
    <View style={st.page}><ScreenHeader title="Safety & legal" onBack={back} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body}>
        <Card tone="alert"><Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>Channel Nav is not for navigation and is not a chartplotter.</Text></Card>
        {FULL_TEXT.map((x) => (
          <View key={x.h} style={{ gap: 4 }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 16 }}>{x.h}</Text>
            <Text style={{ color: colors.muted, fontSize: 14.5, lineHeight: 21 }}>{x.p}</Text>
          </View>
        ))}
        {TERMS_URL ? <Btn label="Full Terms of Use" icon="document-text-outline" onPress={() => Linking.openURL(TERMS_URL)} /> : null}
        {PRIVACY_URL ? <Btn label="Privacy policy" icon="shield-checkmark-outline" onPress={() => Linking.openURL(PRIVACY_URL)} /> : null}
      </ScrollView></View>
  );
  if (page === 'feedback') return (
    <View style={st.page}><ScreenHeader title="Feedback" onBack={back} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled"><FeedbackForm email={session?.user.email ?? ''} onSent={back} /></ScrollView></View>
  );
  if (page === 'coupons') return (
    <View style={st.page}><ScreenHeader title="Saved coupons" onBack={back} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body}><SavedCoupons /><Note>Coupons you save from sponsors stay on this phone.</Note></ScrollView></View>
  );
  if (page === 'account' && session) return (
    <View style={st.page}><ScreenHeader title="Profile" onBack={back} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled"><Account session={session} /></ScrollView></View>
  );

  return (
    <View style={st.page}>
      <ScreenHeader title="Me" subtitle={session ? session.user.email ?? undefined : 'Not signed in — everything still works on this phone'} />
      <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
        {!supabaseReady ? <Card tone="warn"><Note>Sign-in isn't configured yet: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env.</Note></Card>
          : !session ? <SignIn /> : null}

        <SectionLabel>Display</SectionLabel>
        <Card>
          <Segmented<ThemeSetting> value={theme.setting} onChange={(v) => { theme.setSetting(v); track('theme_changed', { setting: v }); }}
            options={[{ key: 'auto', label: 'Auto', icon: 'contrast-outline' }, { key: 'day', label: 'Day', icon: 'sunny-outline' }, { key: 'night', label: 'Night', icon: 'moon-outline' }]} />
          <Note>{theme.setting === 'auto' ? `Switches to Night 20 minutes after sunset and back before sunrise. Now: ${theme.mode === 'night' ? 'Night' : 'Day'}.` : theme.setting === 'night'
            ? 'Night keeps the screen dim and red so it doesn\'t glare at the helm or ruin your night vision.' : 'Day is bright and high-contrast for sunlight.'} Tip: the sun/moon button on the map switches instantly.</Note>
        </Card>

        <SectionLabel>My fishing</SectionLabel>
        <ListGroup>
          <ListRow icon="fish-outline" iconColor={colors.accent} title="Catch log & trips" subtitle="Your private log, patterns and recorded trips" onPress={() => setPage('fishing')} />
          <ListRow icon="pricetag-outline" iconColor={colors.ok} title="Saved coupons" subtitle="Deals you saved from sponsors" onPress={() => setPage('coupons')} last />
        </ListGroup>

        <SectionLabel>On the water</SectionLabel>
        <ListGroup>
          <ListRow icon="cloud-download-outline" title="Offline maps" subtitle="Charts, seafloor, rules and tides saved for no-signal days" onPress={() => setPage('offline')} />
          <CoordFormatRow last={!session} />
          {session ? <ListRow icon="notifications-outline" title="Alerts" subtitle="Species, bite, water temperature and marine warnings" onPress={() => setPage('alerts')} last /> : null}
        </ListGroup>

        {session ? (
          <>
            <SectionLabel>Account</SectionLabel>
            <ListGroup>
              <ListRow icon="person-outline" title="Profile & boat name" subtitle="What others see on reports and in groups" onPress={() => setPage('account')} />
              <UsageStatsRow />
              <ListRow icon="log-out-outline" title="Sign out" onPress={() => supabase.auth.signOut()} chevron={false} />
              <ListRow icon="trash-outline" iconColor={colors.alert} title="Delete my account" danger chevron={false} onPress={() => confirmDelete()} last />
            </ListGroup>
          </>
        ) : <ListGroup><UsageStatsRow last /></ListGroup>}

        <SectionLabel>About</SectionLabel>
        <ListGroup>
          <ListRow icon="warning-outline" iconColor={colors.alert} title="Safety & legal" subtitle="Not for navigation — read before you go out" onPress={() => setPage('legal')} />
          <ListRow icon="server-outline" title="Data sources" subtitle="Where every number comes from and how fresh it is" onPress={() => setPage('sources')} />
          {PRIVACY_URL ? <ListRow icon="shield-checkmark-outline" title="Privacy policy" onPress={() => Linking.openURL(PRIVACY_URL)} /> : null}
          {TERMS_URL ? <ListRow icon="document-text-outline" title="Terms of use" onPress={() => Linking.openURL(TERMS_URL)} /> : null}
          {SUPPORT_EMAIL ? <ListRow icon="mail-outline" title="Contact & support" value={SUPPORT_EMAIL} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} /> : null}
          {STUDIO_URL ? <ListRow icon="megaphone-outline" title="Advertise with us" subtitle="For tackle shops, landings, marinas and brands" onPress={() => Linking.openURL(STUDIO_URL)} /> : null}
          <ListRow icon="chatbubble-ellipses-outline" iconColor={colors.accent} title="Send feedback or report a bug" subtitle="Goes straight to the developer" onPress={() => setPage('feedback')} />
          <ListRow icon="information-circle-outline" title="Version" value={String((Constants as any).expoConfig?.version ?? '')} chevron={false} last />
        </ListGroup>
        {session ? <AdminTools uid={session.user.id} /> : __DEV__ ? <AdminTools uid={null} /> : null}
        <Note>Not for navigation — Channel Nav is a fishing and planning aid, not a certified chartplotter. Charts, seafloor, satellite and weather data can be delayed, incomplete or wrong. Keep a proper lookout and use official charts and onboard equipment. See Safety & legal.</Note>
      </ScrollView>
    </View>
  );
}

function confirmDelete() {
  Alert.alert('Delete your account?', 'This permanently deletes your account, catch log, photos, spots saved to the cloud, groups you own and your posts. Spots and tracks saved only on this phone stay on this phone. This can\'t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete forever', style: 'destructive', onPress: async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user.id;
        if (!uid) return;
        for (const bucket of ['catch-photos', 'public-photos', 'ad-media']) {
          const { data: files } = await supabase.storage.from(bucket).list(uid, { limit: 1000 });
          if (files?.length) await supabase.storage.from(bucket).remove(files.map((f: any) => `${uid}/${f.name}`));
        }
        const { error } = await supabase.rpc('delete_my_account');
        if (error) throw error;
        await supabase.auth.signOut();
        Alert.alert('Account deleted', 'Thanks for fishing with us.');
      } catch (e: any) { Alert.alert('Could not delete', friendly(e)); }
    } },
  ]);
}

function SignIn() {
  const st = useSt();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const isDemo = !!DEMO_EMAIL && email.trim().toLowerCase() === DEMO_EMAIL;   // App Review can't receive email codes
  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) Alert.alert('Could not send code', friendly(error)); else setSent(true);
  };
  const verify = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) Alert.alert('Code not accepted', friendly(error)); else track('sign_in');
  };
  const demo = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) Alert.alert('Not signed in', friendly(error)); else track('sign_in');
  };
  return (
    <Card>
      <Text style={st.h2}>Sign in or create an account</Text>
      <Text style={st.p}>We email you a sign-in code — no password to remember. Your real name is never required. An account adds cloud backup, catch reports, your crew and the community.</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.faint}
        keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={st.input} editable={!sent} accessibilityLabel="Email" />
      {isDemo ? (
        <>
          <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.faint} secureTextEntry style={st.input} accessibilityLabel="Password" />
          <Btn label={busy ? 'Signing in…' : 'Sign in'} kind="primary" onPress={demo} disabled={busy || !password} />
        </>
      ) : sent ? (
        <>
          <TextInput value={code} onChangeText={setCode} placeholder="Code from the email" placeholderTextColor={colors.faint} keyboardType="number-pad" maxLength={10} style={st.input} accessibilityLabel="Code from the email" />
          <Btn label={busy ? 'Checking…' : 'Sign in'} kind="primary" onPress={verify} disabled={busy || code.length < 6} />
          <Pressable onPress={() => { setSent(false); setCode(''); }}><Text style={st.linkT}>Use a different email</Text></Pressable>
        </>
      ) : <Btn label={busy ? 'Sending…' : 'Email me a code'} icon="mail-outline" kind="primary" onPress={send} disabled={busy || !email.includes('@')} />}
    </Card>
  );
}

function UsageStatsRow({ last }: { last?: boolean }) {
  const [out, setOut] = useState(false);
  useEffect(() => { getOptOut().then(setOut); }, []);
  return <ListRow icon="analytics-outline" title="Share anonymous usage stats" subtitle="Counts only, never your location, spots or catches. Keeps the app free."
    chevron={false} last={last} right={<Switch value={!out} onValueChange={async (v) => { setOut(!v); await setOptOut(!v); }} />} />;
}

function Account({ session }: { session: Session }) {
  const st = useSt();
  const [displayName, setDisplayName] = useState('');
  const [boat, setBoat] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('profiles').select('display_name, prefs').eq('id', session.user.id).maybeSingle().then(({ data }) => {
      if (data) { setDisplayName(data.display_name ?? ''); setBoat((data.prefs as any)?.boat_name ?? ''); }
    });
  }, [session.user.id]);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.from('profiles').upsert({ id: session.user.id, display_name: displayName.trim() || null, prefs: { boat_name: boat.trim() || null } });
    setBusy(false);
    if (error) Alert.alert('Not saved', friendly(error)); else Alert.alert('Saved');
  };
  return (
    <View style={st.card}>
      <Text style={st.h2}>Signed in</Text>
      <Text style={st.p}>{session.user.email}</Text>
      <Text style={st.label}>Display name (shown on public reports unless you post anonymously)</Text>
      <TextInput value={displayName} onChangeText={setDisplayName} placeholder="e.g. SoCalTuna" placeholderTextColor={colors.muted} style={st.input} />
      <Text style={st.label}>Boat name (optional)</Text>
      <TextInput value={boat} onChangeText={setBoat} placeholder="optional" placeholderTextColor={colors.muted} style={st.input} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn label={busy ? 'Saving…' : 'Save'} kind="primary" onPress={save} disabled={busy} />
        <Btn label="Sign out" onPress={() => supabase.auth.signOut()} />
      </View>
    </View>
  );
}

function DataSources({ onBack }: { onBack: () => void }) {
  const st = useSt();
  const [sources, setSources] = useState<any[] | null>(null);
  const [layers, setLayers] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    getJSON<any[]>('/sources', { cacheKey: 'sources' }).then((r) => setSources(r.data)).catch((e) => setErr(friendly(e)));
    getJSON<any>('/layers', { cacheKey: 'layers' }).then((r) => setLayers(r.data.layers ?? [])).catch(() => {});
  }, []);
  return (
    <View style={st.page}>
      <ScreenHeader title="Data sources" onBack={onBack} backLabel="Me" />
      <ScrollView contentContainerStyle={st.body}>
        <Text style={st.note}>Where every number comes from. Government data is used under its public terms; NOAA does not endorse this app.</Text>
        {layers.filter((l) => l.dates?.length || l.run).map((l) => (
          <View key={l.key} style={st.card}>
            <Text style={st.h2}>{l.label}</Text>
            <Text style={st.p}>{l.source}</Text>
            <Text style={st.note}>{l.dates?.length ? `Latest: ${l.dates[0].date} (${ageText(l.dates[0].observed_at)})` : `Model run ${ageText(l.run)}`}{l.resolution_m ? ` · ~${Math.round(l.resolution_m)} m` : ''}</Text>
            {l.note ? <Text style={st.note}>{l.note}</Text> : null}
          </View>
        ))}
        {err ? <Text style={st.note}>Couldn't load the source list ({err}).</Text> : null}
        {!sources && !err ? <ActivityIndicator color={colors.live} /> : null}
        {sources?.map((s) => (
          <View key={s.name} style={st.card}>
            <Text style={st.h2}>{s.name}</Text>
            <Text style={st.p}>{s.provider}{s.product ? ` · ${s.product}` : ''}</Text>
            {s.update_freq ? <Text style={st.note}>Updates: {s.update_freq}</Text> : null}
            {s.attribution ? <Text style={st.note}>Attribution: {s.attribution}</Text> : null}
            {s.commercial_notes ? <Text style={st.note}>{s.commercial_notes}</Text> : null}
            <Text style={st.note}>{s.last_verified_at ? `Verified ${new Date(s.last_verified_at).toLocaleDateString()}` : 'Not yet verified'}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, gap: 8, paddingBottom: 48 },
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginTop: 8 },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700' },
  p: { color: colors.text, fontSize: 14, lineHeight: 20 },
  note: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  label: { color: colors.muted, fontSize: 12 },
  card: { ...cardStyle(colors), padding: 14, gap: 8 },
  input: { height: touch.min, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  link: { paddingVertical: 8 },
  linkT: { color: colors.live, fontSize: 15 },
}));

/** Me → On the water → Coordinate format. Applies everywhere positions are shown. */
function CoordFormatRow({ last }: { last?: boolean }) {
  const f = useCoordFormat();
  const order = ['ddm', 'dd', 'dms'] as const;
  const next = order[(order.indexOf(f) + 1) % order.length];
  return <ListRow icon="locate-outline" title="Coordinate format" subtitle={`${COORD_EXAMPLES[f]} · tap to change`} onPress={() => chooseCoordFormat(next)} chevron={false} last={last} />;
}

/** Admins only: see every ad slot in the app as a labeled gold placeholder. */
function AdminTools({ uid }: { uid: string | null }) {
  const [admin, setAdmin] = useState(__DEV__);
  const [on, setOn] = useState(adPreviewOn());
  useEffect(() => {
    if (!uid || !supabaseReady) return;
    supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle().then(({ data }: any) => { if (data?.is_admin) setAdmin(true); });
  }, [uid]);
  if (!admin) return null;
  return (
    <>
      <SectionLabel>Admin</SectionLabel>
      <ListGroup>
        <ListRow icon="megaphone-outline" iconColor="#E0A800" title="Ad spaces preview"
          subtitle={on ? `Showing all ${Object.keys(AD_SPACES).length} ad spaces as gold boxes. Tap any box for details.` : 'Show every sponsor slot in the app as a gold placeholder'}
          right={<Switch value={on} onValueChange={(v) => { setOn(v); setAdPreview(v); track('ad_preview', { on: v }); }} />} chevron={false} />
        {on ? <ListRow icon="list-outline" title="Where every ad space is" onPress={() => Alert.alert('Ad spaces', Object.values(AD_SPACES).map((a) => `• ${a.name}\n   ${a.where}`).join('\n\n'))} last /> : null}
      </ListGroup>
      <Note>Only you see this. Placeholders are never counted as views. The 5-second intro shows each time you open the app while this is on.</Note>
    </>
  );
}
