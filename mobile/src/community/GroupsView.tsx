// Crew tab (was Community → My groups). Your crews: invites (email or code), who's out and where (live / last known),
// "Come to me", shared catches, spots and routes, messages, and float plans with automatic overdue alerts.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { colors, touch, makeStyles } from '../theme';
import { bearingTrue, distanceNm, formatLatLon, formatNm } from '../geo';
import { Ionicons } from '@expo/vector-icons';
import { Btn, BackLink, Card, Note, SectionLabel, SmallBtn } from '../components/ui';
import { track } from '../analytics';
import { supabase } from '../supabase';
import { registerPush } from '../screens/AlertsScreen';
import { startShareUpdates } from '../tracking';
import * as store from '../storage';
import type { Pt } from '../nav';
import * as G from './groupsApi';
import { lastSeen } from '../components/Buddies';
import { friendly } from '../friendly';

export type GroupNav = {
  onShowOnMap: (lat: number, lon: number, name: string) => void;
  onGoTo: (lat: number, lon: number, name: string) => void;
  onShowRoute: (points: Pt[], name: string) => void;
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? timeOf(iso) : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeOf(iso)}`;
};
const fail = (e: any) => Alert.alert('Not done', friendly(e));

export function GroupsView({ nav, openGroupId }: { nav: GroupNav; openGroupId?: string | null }) {
  const st = useSt();
  const [me, setMe] = useState<string | null | undefined>(undefined);
  const [rows, setRows] = useState<G.Group[] | null>(null);
  const [invites, setInvites] = useState<G.Invite[]>([]);
  const [plan, setPlan] = useState<G.MyFloatPlan | null>(null);
  const [open, setOpen] = useState<string | null>(openGroupId ?? null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [boat, setBoat] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const s = (await supabase.auth.getSession()).data.session;
    setMe(s?.user.id ?? null);
    if (!s) { setRows([]); return; }
    registerPush().catch(() => {});
    await Promise.all([
      G.myGroups().then(setRows).catch(() => setRows((r) => r ?? [])),
      G.myInvites().then(setInvites).catch(() => {}),
      G.myFloatPlan().then(setPlan).catch(() => {}),
    ]);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (openGroupId) setOpen(openGroupId); }, [openGroupId]);

  if (me === undefined) return <ActivityIndicator color={colors.live} />;
  if (!me) return <Text style={st.empty}>Sign in on the Profile tab to create or join a fishing group.</Text>;
  if (open) return <GroupDetailView groupId={open} me={me} nav={nav} plan={plan} onPlanChanged={load} onBack={() => { setOpen(null); load(); }} />;

  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.live} />}>
      {invites.map((i) => <InviteCard key={i.id} inv={i} onDone={load} />)}
      {plan ? <FloatPlanBar plan={plan} onChanged={load} /> : null}
      <SectionLabel>Your groups</SectionLabel>
      {rows === null ? <ActivityIndicator color={colors.live} /> : null}
      {rows && !rows.length ? <Card><Text style={st.sub}>You're not in a group yet. Start one for your crew below, or join with a code a friend sent you.</Text></Card> : null}
      {rows?.map((g) => {
        const mine = g.group_members.find((m) => m.user_id === me);
        const sharing = !!mine?.sharing_until && new Date(mine.sharing_until).getTime() > Date.now() && !mine.hidden;
        const live = g.group_members.filter((m) => m.user_id !== me && m.sharing_until && new Date(m.sharing_until).getTime() > Date.now() && !m.hidden).length;
        return (
          <Pressable key={g.id} style={({ pressed }) => [st.groupRow, pressed && { opacity: 0.7 }]} onPress={() => { setOpen(g.id); track('screen_view', { screen: 'group_detail' }); }} accessibilityRole="button">
            <View style={st.groupIcon}><Ionicons name="people" size={22} color={colors.live} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.h2} numberOfLines={1}>{g.name}</Text>
              <Text style={st.sub}>{g.group_members.length} member{g.group_members.length === 1 ? '' : 's'}{live ? ` · ${live} on the water now` : ''}</Text>
              <View style={st.statusRow}>
                <View style={[st.statusDot, { backgroundColor: sharing ? colors.ok : colors.faint }]} />
                <Text style={[st.sub, sharing && { color: colors.ok, fontWeight: '700' }]}>{sharing ? `Sharing until ${timeOf(mine!.sharing_until!)}` : 'Not sharing'}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.faint} />
          </Pressable>
        );
      })}
      <SectionLabel>Start or join a group</SectionLabel>
      <View style={st.card}>
        <View style={st.cardHead}><Ionicons name="add-circle-outline" size={20} color={colors.live} /><Text style={st.h2}>Create a group</Text></View>
        <TextInput style={st.input} value={name} onChangeText={setName} placeholder="Saturday tuna crew" placeholderTextColor={colors.muted} maxLength={60} />
        <TextInput style={st.input} value={boat} onChangeText={setBoat} placeholder="Your boat name (shown to members)" placeholderTextColor={colors.muted} maxLength={40} />
        <Btn label="Create" kind="primary" disabled={!name.trim()} onPress={() => G.createGroup(name.trim(), boat.trim() || undefined)
          .then((r: any) => { setName(''); track('group_created'); load(); const id = Array.isArray(r) ? r[0]?.id : r?.id; if (id) setOpen(id); }).catch(fail)} />
      </View>
      <View style={st.card}>
        <View style={st.cardHead}><Ionicons name="key-outline" size={20} color={colors.live} /><Text style={st.h2}>Join with a code</Text></View>
        <TextInput style={st.input} value={code} onChangeText={setCode} placeholder="6-character code" autoCapitalize="characters" maxLength={6} placeholderTextColor={colors.muted} />
        <Btn label="Join" kind="primary" disabled={code.trim().length < 6} onPress={() => G.joinGroup(code, boat.trim() || undefined)
          .then(() => { setCode(''); track('group_joined', { via: 'code' }); load(); Alert.alert('Joined!'); }).catch(fail)} />
      </View>
      <Note>Groups are invite-only. Nothing about your location is shared until you turn sharing on, send a position, or start a float plan. Positions need cell signal (or Starlink); a boat out of range shows where it was last seen, with the time.</Note>
    </ScrollView>
  );
}

// ------------------------------------------------------------ invites waiting for me
function InviteCard({ inv, onDone }: { inv: G.Invite; onDone: () => void }) {
  const st = useSt();
  const [boat, setBoat] = useState('');
  return (
    <View style={[st.card, { borderColor: colors.accent }]}>
      <View style={st.cardHead}><Ionicons name="mail-unread-outline" size={20} color={colors.accent} /><Text style={st.h2}>Invite: {inv.group_name}</Text></View>
      <Text style={st.sub}>{inv.invited_by} invited you · {inv.members} member{inv.members === 1 ? '' : 's'}</Text>
      <TextInput style={st.input} value={boat} onChangeText={setBoat} placeholder="Your boat name (optional)" placeholderTextColor={colors.muted} maxLength={40} />
      <View style={st.row}>
        <Btn label="Join" kind="primary" onPress={() => G.respondInvite(inv.id, true, boat.trim() || undefined).then(() => { track('group_joined', { via: 'email' }); onDone(); }).catch(fail)} />
        <Btn label="No thanks" onPress={() => G.respondInvite(inv.id, false).then(onDone).catch(fail)} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------ my open float plan
function FloatPlanBar({ plan, onChanged }: { plan: G.MyFloatPlan; onChanged: () => void }) {
  const st = useSt();
  const late = Date.now() > new Date(plan.back_by).getTime();
  const act = (s: 'ok' | 'heading_in' | 'back', extendH?: number) => {
    const nb = extendH ? new Date(Math.max(Date.now(), new Date(plan.back_by).getTime()) + extendH * 3600000) : null;
    G.floatCheckin(s, nb).then(() => { track('float_plan_checkin', { status: extendH ? 'extended' : s }); onChanged(); }).catch(fail);
  };
  return (
    <View style={[st.card, { borderColor: late ? colors.alert : colors.live }]}>
      <View style={st.cardHead}><Ionicons name="boat-outline" size={20} color={late ? colors.alert : colors.live} /><Text style={st.h2}>You're out · back by {timeOf(plan.back_by)}</Text></View>
      {late ? <Text style={[st.body, { color: colors.alert }]}>You're past your back-by time. Check in so your group doesn't worry{plan.overdue_sent_at ? ' — they were alerted' : ''}.</Text> : null}
      {plan.note ? <Text style={st.sub}>{plan.note}</Text> : null}
      <View style={st.row}>
        <Btn label="I'm OK" icon="thumbs-up-outline" onPress={() => act('ok')} />
        <Btn label="+1 hour" icon="time-outline" onPress={() => act('ok', 1)} />
        <Btn label="Heading in" icon="return-down-back-outline" onPress={() => act('heading_in')} />
      </View>
      <Btn label="Back at the dock" icon="home-outline" kind="primary" onPress={() => act('back')} />
    </View>
  );
}

// ------------------------------------------------------------ one group
function GroupDetailView({ groupId, me, nav, plan, onPlanChanged, onBack }: {
  groupId: string; me: string; nav: GroupNav; plan: G.MyFloatPlan | null; onPlanChanged: () => void; onBack: () => void;
}) {
  const st = useSt();
  const [d, setD] = useState<G.GroupDetail | null>(null);
  const [items, setItems] = useState<G.FeedItem[]>([]);
  const [here, setHere] = useState<{ lat: number; lon: number } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'invite' | 'float' | 'spot' | 'route' | 'settings'>('none');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await Promise.all([
      G.groupDetail(groupId).then(setD).catch((e) => { Alert.alert('Group', friendly(e)); onBack(); }),
      G.feed(groupId).then(setItems).catch(() => {}),
    ]);
  }, [groupId]);
  useEffect(() => {
    load();
    const unsub = G.subscribeFeed(groupId, () => { load(); });
    const t = setInterval(load, 60000);
    Location.getLastKnownPositionAsync().then((p) => p && setHere({ lat: p.coords.latitude, lon: p.coords.longitude })).catch(() => {});
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).then((p) => setHere({ lat: p.coords.latitude, lon: p.coords.longitude })).catch(() => {});
    return () => { unsub(); clearInterval(t); };
  }, [groupId]);

  const mine = d?.members.find((m) => m.me);
  const sharing = mine?.status === 'live';
  const sendPos = async (kind: 'ping' | 'position') => {
    setBusy(true);
    try {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null);
      const at = p ? { lat: p.coords.latitude, lon: p.coords.longitude } : here;
      if (!at) throw new Error('No GPS fix yet — step outside or wait a moment.');
      await G.sendShare(groupId, kind, { lat: at.lat, lon: at.lon, body: text });
      setText(''); track(kind === 'ping' ? 'group_ping' : 'group_position_sent', { groups: 1 });
      await load();
    } catch (e: any) { Alert.alert('Not sent', `${friendly(e)}\n\nNo signal? Try again when you have service — or use VHF.`); }
    finally { setBusy(false); }
  };
  const sendMsg = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await G.sendShare(groupId, 'message', { body: text }); setText(''); track('group_message'); await load(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const share = (until: Date) => G.setSharing(groupId, until).then(async () => {
    track('group_share_start', { hours: Math.round((until.getTime() - Date.now()) / 3600000) });
    const bg = await startShareUpdates();
    if (!bg) Alert.alert('Sharing is on', 'Your boat updates while the app is open. To keep your group updated with the screen off, allow location "Always" for this app in Settings.');
    load();
  }).catch(fail);

  if (!d) return <ActivityIndicator color={colors.live} style={{ marginTop: 30 }} />;
  const others = d.members.filter((m) => !m.me);
  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.live} />}>
      <BackLink label="My groups" onPress={onBack} />
      <Text style={st.h1}>{d.name}</Text>
      <Text style={[st.sub, { marginTop: -8 }]}>{d.members.length} member{d.members.length === 1 ? '' : 's'} · invite code {d.invite_code}</Text>

      {/* --- the two buttons that matter on the water --- */}
      <SectionLabel>On the water</SectionLabel>
      <View style={st.card}>
        <TextInput style={st.input} value={text} onChangeText={setText} placeholder="Note or message (optional for positions)" placeholderTextColor={colors.muted} maxLength={500} />
        <Btn label={busy ? 'Sending…' : 'Come to me'} icon="megaphone" kind="primary" disabled={busy} onPress={() => sendPos('ping')} />
        <View style={st.row}>
          <Btn label="Send my position" icon="locate-outline" disabled={busy} onPress={() => sendPos('position')} />
          <Btn label="Send message" icon="chatbubble-outline" disabled={busy || !text.trim()} onPress={sendMsg} />
        </View>
        <Text style={st.sub}>Buddies get a notification; tapping "Come to me" starts Go To straight to you.</Text>
      </View>

      {/* --- boats --- */}
      <SectionLabel>Boats in this group</SectionLabel>
      <View style={st.card}>
        {others.length === 0 ? <Text style={st.sub}>No one else yet — invite your buddies below.</Text> : null}
        {others.map((m) => {
          const dist = here && m.position ? distanceNm(here.lat, here.lon, m.position.lat, m.position.lon) : null;
          const brg = here && m.position ? bearingTrue(here.lat, here.lon, m.position.lat, m.position.lon) : null;
          const fp = d.float_plans.find((f) => f.user_id === m.user_id);
          return (
            <View key={m.user_id} style={st.member}>
              <View style={[st.dot, { backgroundColor: m.status === 'live' ? '#3FBF7F' : m.status === 'last_known' ? colors.faint : 'transparent', borderColor: m.status === 'off' ? colors.line : 'transparent' }]} />
              <View style={{ flex: 1 }}>
                <Text style={st.name}>{m.label}{m.role === 'owner' ? ' · owner' : ''}</Text>
                <Text style={st.sub}>
                  {m.status === 'live' ? 'Sharing now' : m.status === 'last_known' ? 'Stopped sharing' : 'Not sharing'}
                  {m.position ? ` · ${lastSeen(m.position.recorded_at)}` : ''}
                  {dist != null ? ` · ${formatNm(dist)} NM @ ${Math.round(brg!)}°T` : ''}
                  {m.position?.sog_kt != null && m.status === 'live' && m.position.sog_kt > 0.5 ? ` · ${m.position.sog_kt.toFixed(0)} kt` : ''}
                </Text>
                {fp ? <Text style={[st.sub, fp.overdue && { color: colors.alert, fontWeight: '700' }]}>{fp.overdue ? 'OVERDUE · ' : 'Out · '}back by {timeOf(fp.back_by)}{fp.note ? ` · ${fp.note}` : ''}</Text> : null}
              </View>
              {m.position ? (
                <View style={{ gap: 6 }}>
                  <Pressable style={st.mini} onPress={() => nav.onGoTo(m.position!.lat, m.position!.lon, m.label)}><Text style={st.miniT}>Go to</Text></Pressable>
                  <Pressable style={st.mini} onPress={() => nav.onShowOnMap(m.position!.lat, m.position!.lon, m.label)}><Text style={st.miniT}>Map</Text></Pressable>
                </View>
              ) : null}
              {d.is_owner ? (
                <Pressable style={st.iconBtn} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Remove ${m.label}`} onPress={() => Alert.alert(`Remove ${m.label}?`, 'They lose access to the group and its feed.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => G.removeMember(groupId, m.user_id).then(load).catch(fail) }])}>
                  <Ionicons name="person-remove-outline" size={18} color={colors.alert} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {/* --- my boat --- */}
      <SectionLabel>My boat</SectionLabel>
      <View style={st.card}>
        <Text style={[st.body, sharing && { color: colors.live }]}>
          {sharing ? `Sharing until ${timeOf(mine!.sharing_until!)}` : mine?.status === 'last_known' ? 'Not sharing — your last position is still visible (gray)' : 'Not sharing'}
        </Text>
        {sharing ? (
          <View style={st.row}>
            <Btn label="Stop sharing" onPress={() => G.stopSharing(groupId).then(load).catch(fail)} />
            <Btn label="Stop + hide my spot" kind="danger" onPress={() => G.stopSharing(groupId, true).then(load).catch(fail)} />
          </View>
        ) : (
          <View style={st.row}>
            <Btn label="4 h" kind="primary" onPress={() => share(new Date(Date.now() + 4 * 3600000))} />
            <Btn label="12 h" onPress={() => share(new Date(Date.now() + 12 * 3600000))} />
            <Btn label="Till midnight" onPress={() => { const t = new Date(); t.setHours(23, 59, 0, 0); share(t); }} />
          </View>
        )}
        {mine?.status === 'last_known' ? <Btn label="Remove my last position" onPress={() => G.stopSharing(groupId, true).then(load).catch(fail)} /> : null}
        <SmallBtn icon={panel === 'settings' ? 'chevron-up' : 'settings-outline'} label={panel === 'settings' ? 'Hide group settings' : 'Settings for this group'} onPress={() => setPanel(panel === 'settings' ? 'none' : 'settings')} />
        {panel === 'settings' ? (
          <View style={{ gap: 8 }}>
            <View style={st.switchRow}><Text style={st.body}>Notifications from this group</Text>
              <Switch value={mine?.notify !== false} onValueChange={(v) => G.setPrefs(groupId, { notify: v }).then(load).catch(fail)} /></View>
            <View style={st.switchRow}><View style={{ flex: 1 }}><Text style={st.body}>Show my last known position</Text><Text style={st.sub}>For 24 h after you stop sharing — helps if you lose signal.</Text></View>
              <Switch value={mine?.show_last_known !== false} onValueChange={(v) => G.setPrefs(groupId, { lastKnown: v }).then(load).catch(fail)} /></View>
            <View style={st.switchRow}><Text style={st.body}>Hide me (pause sharing)</Text>
              <Switch value={!!mine?.hidden} onValueChange={(v) => G.setHidden(groupId, v).then(load).catch(fail)} /></View>
            <BoatName current={mine?.boat_name ?? ''} onSave={(b) => G.setPrefs(groupId, { boat: b }).then(load).catch(fail)} />
          </View>
        ) : null}
      </View>

      {/* --- float plan --- */}
      <SectionLabel>Safety</SectionLabel>
      {plan ? <FloatPlanBar plan={plan} onChanged={() => { onPlanChanged(); load(); }} /> : (
        <View style={st.card}>
          <Pressable onPress={() => setPanel(panel === 'float' ? 'none' : 'float')} accessibilityRole="button">
            <View style={st.cardHead}><Ionicons name="boat-outline" size={20} color={colors.live} /><Text style={[st.h2, { flex: 1 }]}>Heading out? Leave a float plan</Text><Ionicons name={panel === 'float' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /></View>
            <Text style={st.sub}>Tell the group when you'll be back. If you don't check in by 30 min after that, they get an alert with your last position.</Text>
          </Pressable>
          {panel === 'float' ? <FloatPlanForm groupId={groupId} onStarted={() => { setPanel('none'); onPlanChanged(); load(); }} /> : null}
        </View>
      )}

      {/* --- share spots / routes --- */}
      <SectionLabel>Share with the group</SectionLabel>
      <View style={st.row}>
        <Btn label="Share a spot" icon="bookmark-outline" onPress={() => setPanel(panel === 'spot' ? 'none' : 'spot')} />
        <Btn label="Share a route" icon="git-commit-outline" onPress={() => setPanel(panel === 'route' ? 'none' : 'route')} />
      </View>
      {panel === 'spot' || panel === 'route' ? <SharePicker kind={panel} groupId={groupId} onDone={() => { setPanel('none'); load(); }} /> : null}

      {/* --- feed --- */}
      <SectionLabel>Group feed</SectionLabel>
      {items.length === 0 ? <Card><Text style={st.sub}>Nothing yet. Pings, positions, catches, spots and messages show up here.</Text></Card> : null}
      {items.map((i) => <FeedRow key={i.id} i={i} nav={nav} here={here} onDelete={() => G.deleteShare(i.id).then(load).catch(fail)} canDelete={i.mine || d.is_owner} />)}
      {items.length >= 60 ? <Btn label="Older" onPress={() => G.feed(groupId, items[items.length - 1].created_at).then((more) => setItems([...items, ...more])).catch(fail)} /> : null}

      {/* --- invite --- */}
      <SectionLabel>Invite buddies</SectionLabel>
      <View style={st.card}>
        <Pressable onPress={() => setPanel(panel === 'invite' ? 'none' : 'invite')} accessibilityRole="button">
          <View style={st.cardHead}><Ionicons name="person-add-outline" size={20} color={colors.live} /><Text style={[st.h2, { flex: 1 }]}>Invite by email</Text><Ionicons name={panel === 'invite' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} /></View>
        </Pressable>
        <View style={st.codeBox}><Text style={st.sub}>Invite code</Text><Text style={st.codeT} selectable>{d.invite_code}</Text></View>
        {panel === 'invite' ? <InviteForm d={d} myLabel={mine?.label ?? null} onDone={load} /> : null}
        {!panel || panel !== 'invite' ? (
          <Btn label="Share the code" onPress={() => Share.share({ message: G.inviteMessage(d.name, d.invite_code, mine?.label ?? null) }).catch(() => {})} />
        ) : null}
        {d.invites.length ? (
          <View style={{ gap: 4 }}>
            <Text style={st.sub}>Waiting to join:</Text>
            {d.invites.map((iv) => (
              <View key={iv.id} style={st.rowBetween}>
                <Text style={st.body}>{iv.email}</Text>
                {iv.mine || d.is_owner ? <SmallBtn label="Withdraw" tone="danger" onPress={() => G.revokeInvite(iv.id).then(load).catch(fail)} /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={{ height: 8 }} />
      <Btn kind="danger" icon={d.is_owner ? 'trash-outline' : 'exit-outline'} label={d.is_owner ? 'Delete group' : 'Leave group'} onPress={() => Alert.alert(d.is_owner ? `Delete ${d.name}?` : `Leave ${d.name}?`, d.is_owner ? 'Removes the group, its feed and invites for everyone.' : undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: d.is_owner ? 'Delete group' : 'Leave', style: 'destructive', onPress: () => (d.is_owner ? G.deleteGroup(groupId) : G.leaveGroup(groupId)).then(onBack).catch(fail) }])} />
    </ScrollView>
  );
}

function BoatName({ current, onSave }: { current: string; onSave: (b: string) => void }) {
  const st = useSt();
  const [v, setV] = useState(current);
  return (
    <View style={st.row}>
      <TextInput style={[st.input, { flex: 2 }]} value={v} onChangeText={setV} placeholder="Boat name in this group" placeholderTextColor={colors.muted} maxLength={40} />
      <Btn label="Save" disabled={!v.trim() || v.trim() === current} onPress={() => onSave(v.trim())} />
    </View>
  );
}

function FloatPlanForm({ groupId, onStarted }: { groupId: string; onStarted: () => void }) {
  const st = useSt();
  const presets = useMemo(() => G.backByPresets(), []);
  const [at, setAt] = useState<Date | null>(presets[2].at);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [all, setAll] = useState(false);
  const typedAt = typed.trim() ? G.parseClock(typed) : null;
  const backBy = typed.trim() ? typedAt : at;
  const start = async () => {
    if (!backBy) return;
    try {
      const groups = all ? (await G.cachedGroups()).map((g) => g.id) : [groupId];
      await G.startFloatPlan(groups.length ? groups : [groupId], backBy, note.trim() || undefined);
      track('float_plan_start', { hours: Math.round((backBy.getTime() - Date.now()) / 3600000), groups: groups.length });
      startShareUpdates().catch(() => {});
      onStarted();
    } catch (e) { fail(e); }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={st.body}>Back by</Text>
      <View style={st.wrap}>
        {presets.map((p) => (
          <Pressable key={p.label} onPress={() => { setAt(p.at); setTyped(''); }} style={[st.chip, !typed && at?.getTime() === p.at.getTime() && st.chipOn]}>
            <Text style={[st.chipT, !typed && at?.getTime() === p.at.getTime() && { color: colors.accentInk }]}>{p.label} · {timeOf(p.at.toISOString())}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput style={st.input} value={typed} onChangeText={setTyped} placeholder="…or type a time, e.g. 5:30pm" placeholderTextColor={colors.muted} autoCorrect={false} />
      {typed.trim() && !typedAt ? <Text style={[st.sub, { color: colors.alert }]}>Try a time like 5:30pm or 17:30</Text> : null}
      <TextInput style={st.input} value={note} onChangeText={setNote} placeholder="Where you're going, who's aboard (optional)" placeholderTextColor={colors.muted} maxLength={300} />
      <View style={st.switchRow}><Text style={st.body}>Tell all my groups</Text><Switch value={all} onValueChange={setAll} /></View>
      <Btn label={backBy ? `Start — back by ${timeOf(backBy.toISOString())}` : 'Start'} kind="primary" disabled={!backBy} onPress={start} />
      <Text style={st.sub}>While the plan is open your boat is shared with those groups. Check in, extend, or tap "Back at the dock" when you're in. This does not replace telling someone ashore, VHF 16 or the Coast Guard.</Text>
    </View>
  );
}

function SharePicker({ kind, groupId, onDone }: { kind: 'spot' | 'route'; groupId: string; onDone: () => void }) {
  const st = useSt();
  const [spots, setSpots] = useState<store.SavedSpot[]>([]);
  const [routes, setRoutes] = useState<store.Route[]>([]);
  useEffect(() => { store.loadSpots().then(setSpots); store.loadRoutes().then(setRoutes); }, []);
  const send = async (k: 'spot' | 'route', d: Parameters<typeof G.sendShare>[2]) => {
    try { await G.sendShare(groupId, k, d); track(k === 'spot' ? 'group_spot_shared' : 'group_route_shared', { groups: 1 }); onDone(); } catch (e) { fail(e); }
  };
  const list = kind === 'spot' ? spots : routes;
  return (
    <View style={st.card}>
      <Text style={st.sub}>{kind === 'spot' ? 'Pick one of your saved spots' : 'Pick one of your saved routes'} — only this group gets it.</Text>
      {list.length === 0 ? <Text style={st.sub}>{kind === 'spot' ? 'No saved spots yet (long-press the map to save one).' : 'No saved routes yet.'}</Text> : null}
      {kind === 'spot' ? spots.map((s) => (
        <Pressable key={s.id} style={st.pick} onPress={() => send('spot', { lat: s.lat, lon: s.lon, body: s.notes ?? null, payload: { name: s.name } })}>
          <Ionicons name="star" size={18} color="#FF8A00" /><View style={{ flex: 1 }}><Text style={st.name}>{s.name}</Text><Text style={st.sub}>{formatLatLon(s.lat, s.lon)}</Text></View><Ionicons name="send-outline" size={18} color={colors.live} />
        </Pressable>
      )) : routes.map((r) => (
        <Pressable key={r.id} style={st.pick} onPress={() => send('route', { payload: { name: r.name, points: r.points.slice(0, 100).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name ?? null })) } })}>
          <Ionicons name="git-commit-outline" size={18} color={colors.live} /><View style={{ flex: 1 }}><Text style={st.name}>{r.name}</Text><Text style={st.sub}>{r.points.length} points</Text></View><Ionicons name="send-outline" size={18} color={colors.live} />
        </Pressable>
      ))}
    </View>
  );
}

function FeedRow({ i, nav, here, onDelete, canDelete }: { i: G.FeedItem; nav: GroupNav; here: { lat: number; lon: number } | null; onDelete: () => void; canDelete: boolean }) {
  const st = useSt();
  const p = i.payload ?? {};
  const hasPt = i.lat != null && i.lon != null;
  const dist = here && hasPt ? distanceNm(here.lat, here.lon, i.lat!, i.lon!) : null;
  const label = i.kind === 'spot' ? p.name ?? 'Shared spot' : i.kind === 'catch' ? `${p.species ?? 'Catch'} (${i.who})` : i.mine ? 'My position' : i.who;
  const saveSpot = async () => {
    const mine = await store.loadSpots();
    await store.saveSpots([...mine, { id: store.newId(), name: `${p.name ?? 'Spot'} (from ${i.who})`, lat: i.lat!, lon: i.lon!, createdAt: Date.now(), folder: 'From my groups' }]);
    Alert.alert('Saved to My spots');
  };
  const saveRoute = async () => {
    const pts: Pt[] = (p.points ?? []).map((x: any) => ({ lat: x.lat, lon: x.lon, name: x.name ?? undefined }));
    const mine = await store.loadRoutes();
    await store.saveRoutes([{ id: store.newId(), name: `${p.name ?? 'Route'} (from ${i.who})`, points: pts, createdAt: Date.now() }, ...mine]);
    Alert.alert('Saved to My routes');
  };
  return (
    <Pressable onLongPress={canDelete ? () => Alert.alert('Delete this post?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: onDelete }]) : undefined}
      style={[st.feed, i.kind === 'overdue' && { borderColor: colors.alert }, i.kind === 'ping' && { borderColor: colors.accent }]}>
      <View style={st.rowBetween}>
        <Text style={[st.name, { flex: 1 }]}>{G.shareIcon(i.kind, p.status)} {G.shareTitle(i)}</Text>
        <Text style={st.sub}>{when(i.created_at)}</Text>
      </View>
      {i.body ? <Text style={st.body}>{i.body}</Text> : null}
      {i.kind === 'catch' ? (
        <Text style={st.sub}>{[p.weight_lb ? `${p.weight_lb} lb` : null, p.length_in ? `${p.length_in} in` : null, p.kept === false ? 'released' : p.kept ? 'kept' : null,
          p.bait, p.technique, p.fishing_depth_ft ? `${p.fishing_depth_ft} ft deep` : null].filter(Boolean).join(' · ')}</Text>
      ) : null}
      {i.kind === 'checkin' && p.back_by ? <Text style={st.sub}>Back by {timeOf(p.back_by)}</Text> : null}
      {hasPt ? <Text style={st.sub}>{formatLatLon(i.lat!, i.lon!)}{dist != null ? ` · ${formatNm(dist)} NM from you` : ''}</Text> : null}
      {hasPt || i.kind === 'route' ? (
        <View style={[st.row, { flexWrap: 'wrap', gap: 8 }]}>
          {hasPt ? <Pressable style={st.mini} onPress={() => nav.onGoTo(i.lat!, i.lon!, label)}><Text style={st.miniT}>Go to</Text></Pressable> : null}
          {hasPt ? <Pressable style={st.mini} onPress={() => nav.onShowOnMap(i.lat!, i.lon!, label)}><Text style={st.miniT}>Map</Text></Pressable> : null}
          {(i.kind === 'spot' || i.kind === 'catch' || i.kind === 'ping') && hasPt && !i.mine ? <Pressable style={st.mini} onPress={saveSpot}><Text style={st.miniT}>Save spot</Text></Pressable> : null}
          {i.kind === 'route' ? <Pressable style={st.mini} onPress={() => nav.onShowRoute((p.points ?? []).map((x: any) => ({ lat: x.lat, lon: x.lon, name: x.name ?? undefined })), p.name ?? 'Route')}><Text style={st.miniT}>Show route</Text></Pressable> : null}
          {i.kind === 'route' && !i.mine ? <Pressable style={st.mini} onPress={saveRoute}><Text style={st.miniT}>Save route</Text></Pressable> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function InviteForm({ d, myLabel, onDone }: { d: G.GroupDetail; myLabel: string | null; onDone: () => void }) {
  const st = useSt();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const emails = G.parseEmails(text);
  const send = async () => {
    setBusy(true);
    try {
      const res = await G.inviteEmails(d.id, emails);
      const ok = res.filter((r) => r.result === 'invited').map((r) => r.address);
      const bad = res.filter((r) => r.result === 'invalid').map((r) => r.address);
      const already = res.filter((r) => r.result === 'already_member').map((r) => r.address);
      track('group_invite_sent', { count: ok.length });
      setText(''); onDone();
      const lines = [ok.length ? `Invited: ${ok.join(', ')}` : null, already.length ? `Already in the group: ${already.join(', ')}` : null, bad.length ? `Not an email: ${bad.join(', ')}` : null].filter(Boolean).join('\n');
      if (ok.length) {
        Alert.alert('Invites saved', `${lines}\n\nIf they already have the app they'll get a notification. Send them a message too, so they know to download it and sign in with that email.`, [
          { text: 'Later' },
          { text: 'Send message', onPress: () => Share.share({ message: G.inviteMessage(d.name, d.invite_code, myLabel) }).catch(() => {}) }]);
      } else Alert.alert('No invites sent', lines);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 8 }}>
      <TextInput style={[st.input, { minHeight: 70 }]} value={text} onChangeText={setText} multiline autoCapitalize="none" keyboardType="email-address" autoCorrect={false}
        placeholder="Buddies' emails — separate with commas or new lines" placeholderTextColor={colors.muted} />
      <Btn label={busy ? 'Inviting…' : `Invite ${emails.length || ''}`.trim()} kind="primary" disabled={busy || !emails.length || emails.length > 25} onPress={send} />
      <Text style={st.sub}>They'll see the invite when they sign in to the app with that email. Up to 25 at a time.</Text>
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  h1: { color: colors.text, fontSize: 24, fontWeight: '800' },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  name: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  link: { color: colors.live, fontSize: 15, fontWeight: '600' },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.panelSolid },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chev: { color: colors.muted, fontSize: 24 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid },
  groupIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  codeBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12, backgroundColor: colors.inset, borderWidth: 1, borderColor: colors.border },
  codeT: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  back: { paddingVertical: 6 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  member: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  mini: { borderWidth: 1.5, borderColor: colors.live, backgroundColor: colors.panelSolid, borderRadius: 18, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', alignItems: 'center' },
  miniT: { color: colors.live, fontWeight: '700', fontSize: 14 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: touch.min - 8 },
  chip: { borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 10, minHeight: 40, justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.line },
  feed: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 6, backgroundColor: colors.panelSolid },
}));
