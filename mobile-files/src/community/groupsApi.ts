// Fishing groups: invite codes and email invites, per-trip sharing, buddy boats (live + last known),
// "come to me", shared catches / spots / routes, messages, and float plans with overdue alerts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

export type Member = { user_id: string; boat_name: string | null; sharing_until: string | null; hidden: boolean; role: string };
export type Group = { id: string; name: string; invite_code: string; owner_id: string; group_members: Member[] };
export type Buddy = {
  user_id: string; lat: number; lon: number; sog_kt: number | null; cog_t: number | null; recorded_at: string;
  boat_name: string | null; display_name: string | null; groups: string[]; status: 'live' | 'last_known';
};
export type MemberStatus = 'live' | 'last_known' | 'off';
export type DetailMember = {
  user_id: string; label: string; boat_name: string | null; role: string; me: boolean; status: MemberStatus;
  sharing_until?: string | null; hidden?: boolean | null; notify?: boolean | null; show_last_known?: boolean | null;
  position: { lat: number; lon: number; recorded_at: string; sog_kt: number | null } | null;
};
export type FloatPlanRow = { user_id: string; who: string; departed_at: string; back_by: string; note: string | null; overdue: boolean };
export type GroupDetail = {
  id: string; name: string; invite_code: string; owner_id: string; is_owner: boolean;
  members: DetailMember[]; invites: { id: string; email: string; mine: boolean; created_at: string }[]; float_plans: FloatPlanRow[];
};
export type ShareKind = 'ping' | 'position' | 'catch' | 'spot' | 'route' | 'message' | 'checkin' | 'overdue';
export type FeedItem = {
  id: string; kind: ShareKind; lat: number | null; lon: number | null; body: string | null; payload: any;
  created_at: string; user_id: string; who: string; mine: boolean;
};
export type Pin = { id: string; kind: ShareKind; lat: number; lon: number; body: string | null; payload: any; created_at: string; who: string; group_name: string; mine: boolean };
export type Invite = { id: string; group_id: string; group_name: string; invited_by: string; created_at: string; members: number };
export type MyFloatPlan = { group_ids: string[]; departed_at: string; back_by: string; note: string | null; overdue_sent_at: string | null };

const SHARING = 'sharing-active:v1';
const GROUPS_CACHE = 'my-groups:v1';

const uid = async () => (await supabase.auth.getSession()).data.session?.user.id ?? null;
const must = <T>(r: { data: T; error: any }): T => { if (r.error) throw new Error(r.error.message ?? String(r.error)); return r.data; };

// ---------------- groups ----------------
export async function myGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from('fishing_groups')
    .select('id, name, invite_code, owner_id, group_members(user_id, boat_name, sharing_until, hidden, role)').order('created_at');
  if (error) throw error;
  const rows = (data ?? []) as Group[];
  await refreshSharingFlag(rows);
  AsyncStorage.setItem(GROUPS_CACHE, JSON.stringify(rows.map((g) => ({ id: g.id, name: g.name })))).catch(() => {});
  return rows;
}
/** Group names saved on the phone, so the catch log and the map can offer them with no signal. */
export async function cachedGroups(): Promise<{ id: string; name: string }[]> {
  try { return JSON.parse((await AsyncStorage.getItem(GROUPS_CACHE)) ?? '[]'); } catch { return []; }
}
export async function createGroup(name: string, boat?: string) {
  return must(await supabase.rpc('create_group', { group_name: name, boat: boat ?? null }));
}
export async function joinGroup(code: string, boat?: string) {
  must(await supabase.rpc('join_group', { code: code.trim().toUpperCase(), boat: boat ?? null }));
}
export async function leaveGroup(groupId: string) {
  must(await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', (await uid()) ?? ''));
}
export async function removeMember(groupId: string, userId: string) {
  must(await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId));
}
export async function deleteGroup(groupId: string) {
  must(await supabase.from('fishing_groups').delete().eq('id', groupId));
}
export async function groupDetail(groupId: string): Promise<GroupDetail> {
  return must(await supabase.rpc('group_detail', { g: groupId })) as GroupDetail;
}
export async function setPrefs(groupId: string, p: { notify?: boolean; lastKnown?: boolean; boat?: string }) {
  must(await supabase.rpc('set_group_prefs', { g: groupId, notify_me: p.notify ?? null, last_known: p.lastKnown ?? null, boat: p.boat ?? null }));
}

// ---------------- sharing my boat ----------------
export async function setSharing(groupId: string, until: Date) {
  must(await supabase.from('group_members').update({ sharing_until: until.toISOString(), hidden: false })
    .eq('group_id', groupId).eq('user_id', (await uid()) ?? ''));
  await myGroups().catch(() => {});
}
/** Stop sharing. Your last position stays visible (gray, "last seen") for 24 h unless you remove it or turned that off. */
export async function stopSharing(groupId: string, removeLastKnown = false) {
  must(await supabase.from('group_members').update({ sharing_until: removeLastKnown ? null : new Date().toISOString() })
    .eq('group_id', groupId).eq('user_id', (await uid()) ?? ''));
  await myGroups().catch(() => {});
}
export async function setHidden(groupId: string, hidden: boolean) {
  must(await supabase.from('group_members').update({ hidden }).eq('group_id', groupId).eq('user_id', (await uid()) ?? ''));
  await myGroups().catch(() => {});
}

/** Remembers whether I'm sharing with any group right now, so the map knows whether to send my position. */
async function refreshSharingFlag(groups: Group[]) {
  const me = await uid();
  const until = groups.flatMap((g) => g.group_members.filter((m) => m.user_id === me && !m.hidden && m.sharing_until))
    .map((m) => new Date(m.sharing_until!).getTime()).reduce((a, b) => Math.max(a, b), 0);
  await AsyncStorage.setItem(SHARING, String(until));
}
export async function sharingActive(): Promise<boolean> {
  return Number((await AsyncStorage.getItem(SHARING)) ?? '0') > Date.now();
}

let lastSent = 0;
/** Sends my latest position (only while sharing). Throttled to once every 45 s. */
export async function publishPosition(p: { lat: number; lon: number; sog: number | null; cog: number | null; acc: number | null }, force = false) {
  if ((!force && Date.now() - lastSent < 45000) || !(await sharingActive())) return;
  const me = await uid();
  if (!me) return;
  lastSent = Date.now();
  await supabase.from('live_positions').upsert({
    user_id: me, geom: `SRID=4326;POINT(${p.lon} ${p.lat})`, sog_kt: p.sog, cog_t: p.cog, accuracy_m: p.acc, recorded_at: new Date().toISOString(),
  });
}
export async function buddies(): Promise<Buddy[]> {
  return (must(await supabase.rpc('buddy_positions')) ?? []) as Buddy[];
}

// ---------------- invites ----------------
export async function inviteEmails(groupId: string, emails: string[]): Promise<{ address: string; result: 'invited' | 'invalid' | 'already_member' }[]> {
  return (must(await supabase.rpc('invite_to_group', { g: groupId, emails })) ?? []) as any;
}
export async function myInvites(): Promise<Invite[]> {
  return (must(await supabase.rpc('my_invites')) ?? []) as Invite[];
}
export async function respondInvite(id: string, accept: boolean, boat?: string) {
  must(await supabase.rpc('respond_invite', { invite: id, accept, boat: boat ?? null }));
  if (accept) await myGroups().catch(() => {});
}
export async function revokeInvite(id: string) {
  must(await supabase.rpc('revoke_invite', { invite: id }));
}
/** Splits "a@x.com, b@y.com; c@z.com" (commas, semicolons, spaces, new lines). */
export function parseEmails(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)));
}
export function inviteMessage(groupName: string, code: string, inviter: string | null): string {
  return `${inviter ? `${inviter} invited you` : "You're invited"} to the fishing group "${groupName}" — we share boat positions, ` +
    `hot spots and catches on the water.\n\n1. Get the app: https://YOUR-APP-LINK\n2. Sign in with this email address — the invite will be waiting.\n` +
    `Or join with code: ${code}`;
}

// ---------------- feed: come to me, position, spots, routes, messages ----------------
export async function sendShare(groupId: string, kind: 'ping' | 'position' | 'spot' | 'route' | 'message',
  d: { lat?: number; lon?: number; body?: string | null; payload?: any }) {
  const me = await uid();
  if (!me) throw new Error('Sign in first');
  must(await supabase.from('group_shares').insert({
    group_id: groupId, user_id: me, kind, lat: d.lat ?? null, lon: d.lon ?? null, body: d.body?.trim() || null, payload: d.payload ?? {},
  }));
}
/** Sends to several groups; returns the names that failed (with the reason). */
export async function sendToGroups(groups: { id: string; name: string }[], kind: Parameters<typeof sendShare>[1], d: Parameters<typeof sendShare>[2]) {
  const failed: string[] = [];
  for (const g of groups) {
    try { await sendShare(g.id, kind, d); } catch (e: any) { failed.push(`${g.name}: ${e?.message ?? e}`); }
  }
  return failed;
}
export async function feed(groupId: string, before?: string): Promise<FeedItem[]> {
  const key = `group-feed:${groupId}`;
  try {
    const rows = (must(await supabase.rpc('group_feed', { g: groupId, lim: 60, before: before ?? null })) ?? []) as FeedItem[];
    if (!before) AsyncStorage.setItem(key, JSON.stringify(rows)).catch(() => {});   // newest page kept for offshore use
    return rows;
  } catch (e) {
    const cached = before ? null : await AsyncStorage.getItem(key).catch(() => null);
    if (cached) return JSON.parse(cached) as FeedItem[];
    throw e;
  }
}
export async function deleteShare(id: string) {
  must(await supabase.from('group_shares').delete().eq('id', id));
}
const PINS_CACHE = 'group-pins:v1';
/** Shared spots, pings and catches from my groups. Saved on the phone so you can still find and
 *  navigate to them offshore with no signal (shown with their age; dropped after 7 days). */
export async function pins(hours = 24): Promise<Pin[]> {
  try {
    const rows = (must(await supabase.rpc('group_pins', { hours })) ?? []) as Pin[];
    AsyncStorage.setItem(PINS_CACHE, JSON.stringify(rows)).catch(() => {});
    return rows;
  } catch (e) {
    const cached = await AsyncStorage.getItem(PINS_CACHE).catch(() => null);
    if (!cached) throw e;
    const week = Date.now() - 7 * 86400000;
    return (JSON.parse(cached) as Pin[]).filter((p) => new Date(p.created_at).getTime() > week);
  }
}
export async function shareCatch(catchId: string, groupIds: string[]): Promise<number> {
  return must(await supabase.rpc('share_catch', { c: catchId, groups: groupIds })) as number;
}
/** Live updates for one group's feed. Returns an unsubscribe function. */
export function subscribeFeed(groupId: string, onNew: () => void): () => void {
  const ch = supabase.channel(`group-${groupId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_shares', filter: `group_id=eq.${groupId}` }, onNew)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// ---------------- float plan ----------------
export async function myFloatPlan(): Promise<MyFloatPlan | null> {
  return (must(await supabase.rpc('my_float_plan')) ?? null) as MyFloatPlan | null;
}
export async function startFloatPlan(groupIds: string[], backBy: Date, note?: string) {
  must(await supabase.rpc('start_float_plan', { groups: groupIds, back: backBy.toISOString(), plan_note: note ?? null }));
  await myGroups().catch(() => {});
}
export async function floatCheckin(status: 'ok' | 'heading_in' | 'back', newBack?: Date | null, msg?: string) {
  must(await supabase.rpc('float_checkin', { status, new_back: newBack ? newBack.toISOString() : null, msg: msg ?? null }));
  await myGroups().catch(() => {});
}

// ---------------- small helpers (tested) ----------------
export function shareIcon(kind: ShareKind, status?: string): string {
  if (kind === 'checkin') return status === 'out' ? '🚤' : status === 'back' ? '🏠' : status === 'heading_in' ? '⚓' : status === 'extended' ? '⏱' : '👍';
  return { ping: '🎣', position: '📍', catch: '🐟', spot: '📌', route: '🧭', message: '💬', overdue: '⚠️' }[kind as Exclude<ShareKind, 'checkin'>] ?? '•';
}
export function shareTitle(i: Pick<FeedItem, 'kind' | 'who' | 'payload' | 'mine'>): string {
  const who = i.mine ? 'You' : i.who;
  const p = i.payload ?? {};
  switch (i.kind) {
    case 'ping': return `${who}: Come to me!`;
    case 'position': return `${who} sent ${i.mine ? 'your' : 'their'} position`;
    case 'catch': return `${who} caught ${p.quantity ?? 1} ${p.species ?? 'fish'}`;
    case 'spot': return `${who} shared a spot: ${p.name ?? 'Spot'}`;
    case 'route': return `${who} shared a route: ${p.name ?? 'Route'}`;
    case 'message': return who;
    case 'overdue': return `${i.mine ? 'You are' : `${i.who} is`} overdue`;
    case 'checkin':
      return p.status === 'out' ? `${who} headed out` : p.status === 'back' ? `${who} ${i.mine ? 'are' : 'is'} back at the dock`
        : p.status === 'heading_in' ? `${who} ${i.mine ? 'are' : 'is'} heading in` : p.status === 'extended' ? `${who} will be out longer` : `${who} checked in: all good`;
  }
}
/** Back-by presets for the float plan: +2/+4/+6 h and "sunset-ish" rounded to 15 minutes. */
export function backByPresets(now = new Date()): { label: string; at: Date }[] {
  const round = (d: Date) => { const x = new Date(d); x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15, 0, 0); return x; };
  return [2, 4, 6, 8].map((h) => ({ label: `+${h} h`, at: round(new Date(now.getTime() + h * 3600000)) }));
}
/** "5:30" / "17:30" / "5:30pm" → the next time that clock time comes around (no am/pm: whichever of am/pm is next). */
export function parseClock(text: string, now = new Date()): Date | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  if (m[3] && (h < 1 || h > 12)) return null;
  if (m[3]?.startsWith('p') && h < 12) h += 12;
  if (m[3]?.startsWith('a') && h === 12) h = 0;
  const hours = !m[3] && h >= 1 && h < 12 ? [h, h + 12] : [h];
  const options: Date[] = [];
  for (const day of [0, 1]) for (const hh of hours) {
    const d = new Date(now); d.setDate(d.getDate() + day); d.setHours(hh, min, 0, 0);
    if (d.getTime() > now.getTime()) options.push(d);
  }
  return options.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}
