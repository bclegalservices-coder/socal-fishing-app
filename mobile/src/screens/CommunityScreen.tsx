// Community (spec §36–40): latest catch reports, the forum with moderation tools, and fishing groups.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ageText } from '../api';
import { colors, touch, makeStyles } from '../theme';
import { latestReports, type PublicReport } from '../community/catchApi';
import * as forum from '../community/forumApi';
import { GroupsView, type GroupNav } from '../community/GroupsView';
import { SPECIES, TIME_WINDOWS } from '../community/species';
import { ReportCard } from '../components/ReportView';
import { Btn, ScreenHeader, Segmented } from '../components/ui';
import { SponsorBanner } from '../ads/Sponsor';
import { track } from '../analytics';
import { supabase } from '../supabase';

type Seg = 'reports' | 'forum' | 'groups';

export function CommunityScreen({ onShowOnMap, groupNav, openGroup }: {
  onShowOnMap: (lat: number, lon: number, name: string) => void; groupNav: GroupNav; openGroup?: { id: string | null; at: number } | null;
}) {
  const st = useSt();
  const [seg, setSeg] = useState<Seg>(openGroup ? 'groups' : 'reports');
  useEffect(() => { if (openGroup) setSeg('groups'); }, [openGroup?.at]);
  useEffect(() => { track('screen_view', { screen: `community_${seg}` }); }, [seg]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Community" subtitle="Reports, forum and your crew" />
      <View style={st.root}>
      <View style={{ marginVertical: 10 }}>
        <Segmented<Seg> value={seg} onChange={setSeg} options={[{ key: 'reports', label: 'Reports', icon: 'fish-outline' }, { key: 'forum', label: 'Forum', icon: 'chatbubbles-outline' }, { key: 'groups', label: 'My crew', icon: 'boat-outline' }]} />
      </View>
      {seg === 'reports' ? <Reports onShowOnMap={onShowOnMap} /> : seg === 'forum' ? <Forum /> : <GroupsView nav={groupNav} openGroupId={openGroup?.id ?? null} />}
      </View>
    </View>
  );
}

// ---------------- catch reports ----------------
function Reports({ onShowOnMap }: { onShowOnMap: (lat: number, lon: number, name: string) => void }) {
  const st = useSt();
  const [hours, setHours] = useState(24);
  const [species, setSpecies] = useState<string | null>(null);
  const [rows, setRows] = useState<PublicReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { setRows(null); latestReports(hours, species).then(setRows).catch((e) => { setErr(e.message); setRows([]); }); }, [hours, species]);
  useEffect(load, [load]);
  return (
    <FlatList data={rows ?? []} keyExtractor={(r) => r.id} onRefresh={load} refreshing={false} contentContainerStyle={{ gap: 10, paddingBottom: 30 }}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <View style={st.wrap}>{TIME_WINDOWS.map((w) => <Chip key={w.h} label={w.label} on={hours === w.h} onPress={() => setHours(w.h)} />)}</View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            <Chip label="All fish" on={!species} onPress={() => setSpecies(null)} />
            {SPECIES.slice(0, 14).map((s) => <Chip key={s.code} label={s.code} on={species === s.code} color={s.color} onPress={() => setSpecies(species === s.code ? null : s.code)} />)}
          </ScrollView>
          {err ? <Text style={st.sub}>Couldn't load ({err}).</Text> : null}
          <SponsorBanner placement="banner_reports" tags={species ? [species.toLowerCase()] : []} />
        </View>
      }
      ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>No public reports in this window yet. Be the first — log a catch from the map.</Text>}
      renderItem={({ item }) => <ReportCard r={item} />} />
  );
}

// ---------------- forum ----------------
function Forum() {
  const st = useSt();
  const [cats, setCats] = useState<forum.Category[] | null>(null);
  const [cat, setCat] = useState<forum.Category | null>(null);
  const [post, setPost] = useState<forum.Post | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => { forum.categories().then(setCats).catch(() => setCats([])); }, []);
  if (post) return <Thread post={post} onBack={() => setPost(null)} />;
  if (composing && cat) return <Compose cat={cat} onDone={() => setComposing(false)} />;
  if (cat) return <PostList cat={cat} onBack={() => setCat(null)} onOpen={setPost} onNew={() => setComposing(true)} />;
  return (
    <FlatList data={cats ?? []} keyExtractor={(c) => String(c.id)} ListHeaderComponent={<SponsorBanner placement="banner_community" />}
      ListEmptyComponent={cats === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>Forum unavailable offline.</Text>}
      renderItem={({ item }) => (
        <Pressable style={st.row} onPress={() => setCat(item)}>
          <View style={{ flex: 1 }}><Text style={st.name}>{item.name}</Text>{item.description ? <Text style={st.sub}>{item.description}</Text> : null}</View>
          <Text style={st.link}>›</Text>
        </Pressable>
      )} />
  );
}

function PostList({ cat, onBack, onOpen, onNew }: { cat: forum.Category; onBack: () => void; onOpen: (p: forum.Post) => void; onNew: () => void }) {
  const st = useSt();
  const [rows, setRows] = useState<forum.Post[] | null>(null);
  const [names, setNames] = useState<Record<string, any>>({});
  const load = useCallback(async () => {
    try { const p = await forum.posts(cat.id); setRows(p); setNames(await forum.names(p.map((x) => x.author_id))); } catch { setRows([]); }
  }, [cat.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <FlatList data={rows ?? []} keyExtractor={(p) => p.id} onRefresh={load} refreshing={false}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}>
          <Pressable onPress={onBack}><Text style={st.link}>‹ Categories</Text></Pressable>
          <Pressable onPress={onNew} style={st.newBtn}><Text style={st.newT}>+ New post</Text></Pressable>
        </View>
      }
      ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>No posts in {cat.name} yet.</Text>}
      renderItem={({ item }) => (
        <Pressable style={st.row} onPress={() => onOpen(item)}>
          <View style={{ flex: 1 }}>
            <Text style={st.name}>{item.title}</Text>
            <Text style={st.sub}>{names[item.author_id]?.display_name ?? 'Angler'}{names[item.author_id]?.verified_reporter ? ' ✓' : ''} · {ageText(item.last_activity_at).replace(' old', ' ago')} · 💬 {item.comment_count} · 👍 {item.like_count}</Text>
          </View>
        </Pressable>
      )} />
  );
}

function Compose({ cat, onDone }: { cat: forum.Category; onDone: () => void }) {
  const st = useSt();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const post = async () => {
    setBusy(true);
    try { await forum.createPost({ category_id: cat.id, title: title.trim(), body: body.trim() }); track('forum_post', { category: cat.slug }); onDone(); }
    catch (e: any) { Alert.alert('Not posted', e?.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onDone}><Text style={st.link}>‹ Cancel</Text></Pressable>
      <Text style={st.h2}>New post in {cat.name}</Text>
      <TextInput style={st.input} value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={colors.muted} maxLength={140} />
      <TextInput style={[st.input, { minHeight: 160, textAlignVertical: 'top', paddingTop: 10 }]} value={body} onChangeText={setBody} multiline placeholder="What's going on?" placeholderTextColor={colors.muted} />
      <Text style={st.sub}>Keep it about fishing and be decent. Don't post other people's private numbers. Posts can be reported and removed under the Community Guidelines.</Text>
      <Btn label={busy ? 'Posting…' : 'Post'} kind="primary" onPress={post} disabled={busy || title.trim().length < 3} />
    </ScrollView>
  );
}

function Thread({ post, onBack }: { post: forum.Post; onBack: () => void }) {
  const st = useSt();
  const [cs, setCs] = useState<forum.Comment[] | null>(null);
  const [names, setNames] = useState<Record<string, any>>({});
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(post.like_count);
  const [text, setText] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const load = useCallback(async () => {
    const c = await forum.comments(post.id).catch(() => []);
    setCs(c);
    setNames(await forum.names([post.author_id, ...c.map((x) => x.author_id)]));
    setLiked((await forum.myLikes([post.id])).has(post.id));
    setMe((await supabase.auth.getSession()).data.session?.user.id ?? null);
  }, [post.id]);
  useEffect(() => { load(); }, [load]);
  const moreMenu = (kind: 'post' | 'comment', id: string, author: string) => {
    const own = author === me;
    Alert.alert(own ? 'Your ' + kind : 'Options', undefined, [
      { text: 'Cancel', style: 'cancel' },
      ...(own ? [{ text: 'Delete', style: 'destructive' as const, onPress: () => forum.deleteOwn(kind === 'post' ? 'posts' : 'comments', id).then(() => (kind === 'post' ? onBack() : load())) }] : [
        { text: 'Report', onPress: () => forum.report(kind, id, 'offensive').then(() => Alert.alert('Thanks — a moderator will look.')).catch((e) => Alert.alert('Not sent', e.message)) },
        { text: 'Block this person', style: 'destructive' as const, onPress: () => forum.block(author).then(() => { Alert.alert('Blocked', 'You won\'t see their posts or comments.'); onBack(); }) },
      ]),
    ]);
  };
  const send = async () => {
    try { await forum.addComment(post.id, text.trim()); track('forum_comment'); setText(''); load(); } catch (e: any) { Alert.alert('Not sent', e?.message ?? String(e)); }
  };
  return (
    <FlatList data={cs ?? []} keyExtractor={(c) => c.id} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 30 }}
      ListHeaderComponent={
        <View style={{ gap: 8, paddingBottom: 10 }}>
          <Pressable onPress={onBack}><Text style={st.link}>‹ Back</Text></Pressable>
          <Text style={st.h2}>{post.title}</Text>
          <Text style={st.sub}>{names[post.author_id]?.display_name ?? 'Angler'}{names[post.author_id]?.verified_reporter ? ' ✓' : ''} · {new Date(post.created_at).toLocaleString()}{post.edited_at ? ' · edited' : ''}</Text>
          <Text style={st.body}>{post.body}</Text>
          <View style={{ flexDirection: 'row', gap: 18 }}>
            <Pressable onPress={async () => { try { await forum.toggleLike(post.id, liked); if (!liked) track('forum_like'); setLiked(!liked); setLikes(likes + (liked ? -1 : 1)); } catch (e: any) { Alert.alert(e.message); } }}>
              <Text style={st.link}>{liked ? '👍 Liked' : '👍 Like'} ({likes})</Text>
            </Pressable>
            <Pressable onPress={() => moreMenu('post', post.id, post.author_id)}><Text style={[st.link, { color: colors.muted }]}>•••</Text></Pressable>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable style={st.comment} onLongPress={() => moreMenu('comment', item.id, item.author_id)}>
          <Text style={st.sub}>{names[item.author_id]?.display_name ?? 'Angler'} · {ageText(item.created_at).replace(' old', ' ago')}{item.edited_at ? ' · edited' : ''}</Text>
          <Text style={st.body}>{item.body}</Text>
        </Pressable>
      )}
      ListFooterComponent={
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TextInput style={[st.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Add a comment" placeholderTextColor={colors.muted} multiline />
          <Pressable onPress={send} disabled={!text.trim()} style={[st.newBtn, !text.trim() && { opacity: 0.4 }]}><Text style={st.newT}>Send</Text></Pressable>
        </View>
      } />
  );
}

function Chip({ label, on, onPress, color }: { label: string; on: boolean; onPress: () => void; color?: string }) {
  const st = useSt();
  return (
    <Pressable onPress={onPress} style={[st.chip, on && { backgroundColor: color ?? colors.accent, borderColor: color ?? colors.accent }]}>
      <Text style={[st.chipT, on && { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginVertical: 6 },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700' },
  seg: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segB: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segT: { color: colors.text, fontWeight: '600', fontSize: 13 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 34, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1, borderColor: colors.line, justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line, minHeight: touch.min },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  link: { color: colors.live, fontSize: 15 },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.line, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  newBtn: { height: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.accent, justifyContent: 'center' },
  newT: { color: colors.accentInk, fontWeight: '700' },
  comment: { paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line, gap: 4 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.panelSolid },
  hide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
