// Community (spec §36–40): latest catch reports, the forum with moderation tools, and fishing groups.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ageText } from '../api';
import { colors, touch, makeStyles } from '../theme';
import { latestReports, type PublicReport } from '../community/catchApi';
import * as forum from '../community/forumApi';
import * as seen from '../community/forumSeen';
import { PICKABLE_SPECIES as SPECIES, TIME_WINDOWS } from '../community/species';
import { ReportCard } from '../components/ReportView';
import { Btn, ScreenHeader, Segmented, BackLink, SmallBtn, Chip } from '../components/ui';
import { SponsorBanner } from '../ads/Sponsor';
import { track } from '../analytics';
import { supabase } from '../supabase';
import { friendly } from '../friendly';

type Seg = 'reports' | 'forum';
const NEW_GREEN = '#1FD15A';

/** Nov 2: unseen forum activity, refreshed on open, every 2 minutes, and whenever a post is read. */
function useUnseen() {
  const [u, setU] = useState<{ byCategory: Record<number, number>; posts: Set<string>; total: number }>({ byCategory: {}, posts: new Set(), total: 0 });
  const load = useCallback(() => { seen.unseen().then(setU).catch(() => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 120000); const off = seen.onSeenChange(load); return () => { clearInterval(t); off(); }; }, [load]);
  return u;
}

export function CommunityScreen({ onShowOnMap }: { onShowOnMap: (lat: number, lon: number, name: string) => void }) {
  const st = useSt();
  const [seg, setSeg] = useState<Seg>('reports');
  const unseenNow = useUnseen();
  useEffect(() => { track('screen_view', { screen: `community_${seg}` }); }, [seg]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="Community" subtitle="Catch reports and the forum" />
      <View style={st.root}>
      <View style={{ marginVertical: 10 }}>
        <Segmented<Seg> value={seg} onChange={setSeg} options={[{ key: 'reports', label: 'Reports', icon: 'fish-outline' }, { key: 'forum', label: unseenNow.total ? `Forum · ${unseenNow.total} new` : 'Forum', icon: 'chatbubbles-outline' }]} />
      </View>
      {seg === 'reports' ? <Reports onShowOnMap={onShowOnMap} /> : <Forum unseen={unseenNow} />}
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
  const load = useCallback(() => { setRows(null); latestReports(hours, species).then(setRows).catch((e) => { setErr(friendly(e)); setRows([]); }); }, [hours, species]);
  useEffect(load, [load]);
  return (
    <FlatList data={rows ?? []} keyExtractor={(r) => r.id} onRefresh={load} refreshing={false} contentContainerStyle={{ gap: 10, paddingBottom: 30 }}
      ListHeaderComponent={
        <View style={{ gap: 8, paddingBottom: 4 }}>
          <Text style={st.lbl}>Reported in the last</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {TIME_WINDOWS.map((w) => <Chip key={w.h} label={w.label} icon="time-outline" on={hours === w.h} onPress={() => setHours(w.h)} />)}
          </ScrollView>
          <Text style={st.lbl}>Species</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="All fish" on={!species} onPress={() => setSpecies(null)} />
            {SPECIES.slice(0, 14).map((s) => <Chip key={s.code} label={s.name} on={species === s.code} dot={s.color} onPress={() => setSpecies(species === s.code ? null : s.code)} />)}
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
function Forum({ unseen }: { unseen: { byCategory: Record<number, number>; posts: Set<string>; total: number } }) {
  const st = useSt();
  const [cats, setCats] = useState<forum.Category[] | null>(null);
  const [cat, setCat] = useState<forum.Category | null>(null);
  const [post, setPost] = useState<forum.Post | null>(null);
  const [composing, setComposing] = useState(false);
  useEffect(() => { forum.categories().then(setCats).catch(() => setCats([])); }, []);
  if (post) return <Thread post={post} onBack={() => setPost(null)} />;
  const open = (p: forum.Post) => { seen.markSeen(p.id, p.last_activity_at); setPost(p); };
  if (composing && cat) return <Compose cat={cat} onDone={() => setComposing(false)} />;
  if (cat) return <PostList cat={cat} unseen={unseen.posts} onBack={() => setCat(null)} onOpen={open} onNew={() => setComposing(true)} />;
  return (
    <FlatList data={cats ?? []} keyExtractor={(c) => String(c.id)} contentContainerStyle={st.list}
      ListHeaderComponent={<View style={{ gap: 8 }}><SponsorBanner placement="banner_community" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={st.lbl}>Topics</Text>
          {unseen.total ? <Pressable onPress={() => seen.markAllSeen()} hitSlop={8} accessibilityRole="button"><Text style={st.markAll}>Mark all read</Text></Pressable> : null}</View></View>}
      ListEmptyComponent={cats === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>Forum unavailable offline.</Text>}
      renderItem={({ item }) => (
        <Pressable style={({ pressed }) => [st.cardRow, unseen.byCategory[item.id] ? st.newRow : null, pressed && { opacity: 0.7 }]} onPress={() => setCat(item)} accessibilityRole="button"
          accessibilityLabel={`${item.name}${unseen.byCategory[item.id] ? `, ${unseen.byCategory[item.id]} new` : ''}`}>
          <View style={[st.catIcon, unseen.byCategory[item.id] ? { backgroundColor: NEW_GREEN + '26' } : null]}><Ionicons name="chatbubbles-outline" size={20} color={unseen.byCategory[item.id] ? NEW_GREEN : colors.live} /></View>
          <View style={{ flex: 1 }}><Text style={st.name}>{item.name}</Text>{item.description ? <Text style={st.sub} numberOfLines={2}>{item.description}</Text> : null}</View>
          {unseen.byCategory[item.id] ? <View style={st.newPill}><Text style={st.newPillT}>{unseen.byCategory[item.id]} NEW</Text></View> : null}
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </Pressable>
      )} />
  );
}

function PostList({ cat, unseen, onBack, onOpen, onNew }: { cat: forum.Category; unseen: Set<string>; onBack: () => void; onOpen: (p: forum.Post) => void; onNew: () => void }) {
  const st = useSt();
  const [rows, setRows] = useState<forum.Post[] | null>(null);
  const [names, setNames] = useState<Record<string, any>>({});
  const load = useCallback(async () => {
    try { const p = await forum.posts(cat.id); setRows(p); setNames(await forum.names(p.map((x) => x.author_id))); } catch { setRows([]); }
  }, [cat.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <FlatList data={rows ?? []} keyExtractor={(p) => p.id} onRefresh={load} refreshing={false} contentContainerStyle={st.list}
      ListHeaderComponent={
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <BackLink label="Topics" onPress={onBack} />
            <Pressable onPress={onNew} style={({ pressed }) => [st.newBtn, pressed && { opacity: 0.8 }]} accessibilityRole="button">
              <Ionicons name="create-outline" size={17} color={colors.accentInk} /><Text style={st.newT}>New post</Text>
            </Pressable>
          </View>
          <Text style={st.h2}>{cat.name}</Text>
        </View>
      }
      ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>No posts in {cat.name} yet.</Text>}
      renderItem={({ item }) => (
        <Pressable style={({ pressed }) => [st.cardRow, unseen.has(item.id) ? st.newRow : null, pressed && { opacity: 0.7 }]} onPress={() => onOpen(item)} accessibilityRole="button">
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {unseen.has(item.id) ? <View style={st.newPill}><Text style={st.newPillT}>NEW</Text></View> : null}
              <Text style={[st.name, { flexShrink: 1 }]} numberOfLines={2}>{item.title}</Text>
            </View>
            <Text style={st.sub}>{names[item.author_id]?.display_name ?? 'Angler'}{names[item.author_id]?.verified_reporter ? ' ✓' : ''} · {ageText(item.last_activity_at).replace(' old', ' ago')}</Text>
            <View style={st.counts}>
              <Ionicons name="chatbubble-outline" size={14} color={colors.muted} /><Text style={st.sub}>{item.comment_count}</Text>
              <Ionicons name="thumbs-up-outline" size={14} color={colors.muted} style={{ marginLeft: 10 }} /><Text style={st.sub}>{item.like_count}</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
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
    catch (e: any) { Alert.alert('Not posted', friendly(e)); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={[st.list, { gap: 10 }]} keyboardShouldPersistTaps="handled">
      <BackLink label="Cancel" onPress={onDone} />
      <Text style={st.h2}>New post in {cat.name}</Text>
      <Text style={st.lbl}>Title</Text>
      <TextInput style={st.input} value={title} onChangeText={setTitle} placeholder="Bluefin on the 43 this morning" placeholderTextColor={colors.faint} maxLength={140} />
      <Text style={st.lbl}>Post</Text>
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
        { text: 'Report', onPress: () => forum.report(kind, id, 'offensive').then(() => Alert.alert('Thanks — a moderator will look.')).catch((e) => Alert.alert('Not sent', friendly(e))) },
        { text: 'Block this person', style: 'destructive' as const, onPress: () => forum.block(author).then(() => { Alert.alert('Blocked', 'You won\'t see their posts or comments.'); onBack(); }) },
      ]),
    ]);
  };
  const send = async () => {
    try { await forum.addComment(post.id, text.trim()); track('forum_comment'); setText(''); load(); } catch (e: any) { Alert.alert('Not sent', friendly(e)); }
  };
  return (
    <FlatList data={cs ?? []} keyExtractor={(c) => c.id} keyboardShouldPersistTaps="handled" contentContainerStyle={st.list}
      ListHeaderComponent={
        <View style={[st.card, { marginBottom: 6 }]}>
          <BackLink label="Posts" onPress={onBack} />
          <Text style={st.h2}>{post.title}</Text>
          <Text style={st.sub}>{names[post.author_id]?.display_name ?? 'Angler'}{names[post.author_id]?.verified_reporter ? ' ✓' : ''} · {new Date(post.created_at).toLocaleString()}{post.edited_at ? ' · edited' : ''}</Text>
          <Text style={st.body}>{post.body}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <SmallBtn tone={liked ? 'accent' : 'plain'} icon={liked ? 'thumbs-up' : 'thumbs-up-outline'} label={`${liked ? 'Liked' : 'Like'} (${likes})`}
              onPress={async () => { try { await forum.toggleLike(post.id, liked); if (!liked) track('forum_like'); setLiked(!liked); setLikes(likes + (liked ? -1 : 1)); } catch (e: any) { Alert.alert(friendly(e)); } }} />
            <SmallBtn icon="ellipsis-horizontal" label="More" onPress={() => moreMenu('post', post.id, post.author_id)} />
          </View>
        </View>
      }
      ListEmptyComponent={cs === null ? <ActivityIndicator color={colors.live} /> : <Text style={st.empty}>No comments yet.</Text>}
      renderItem={({ item }) => (
        <Pressable style={st.comment} onLongPress={() => moreMenu('comment', item.id, item.author_id)}>
          <Text style={st.sub}>{names[item.author_id]?.display_name ?? 'Angler'} · {ageText(item.created_at).replace(' old', ' ago')}{item.edited_at ? ' · edited' : ''}</Text>
          <Text style={st.body}>{item.body}</Text>
        </Pressable>
      )}
      ListFooterComponent={
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TextInput style={[st.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder="Add a comment" placeholderTextColor={colors.muted} multiline />
          <Pressable onPress={send} disabled={!text.trim()} style={[st.sendBtn, !text.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Send comment">
            <Ionicons name="send" size={18} color={colors.accentInk} />
          </Pressable>
        </View>
      } />
  );
}


const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16 },
  list: { gap: 8, paddingBottom: 40 },
  lbl: { color: colors.muted, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 4 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelSolid, minHeight: touch.min },
  newRow: { borderColor: NEW_GREEN, borderWidth: 2, borderLeftWidth: 6 },
  newPill: { backgroundColor: NEW_GREEN, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  newPillT: { color: '#062A12', fontSize: 11.5, fontWeight: '900' },
  markAll: { color: colors.live, fontSize: 13, fontWeight: '700' },
  catIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.inset, alignItems: 'center', justifyContent: 'center' },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  h1: { color: colors.text, fontSize: 28, fontWeight: '700', marginVertical: 6 },
  h2: { color: colors.text, fontSize: 18, fontWeight: '700' },
  seg: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  segB: { flex: 1, height: 40, borderRadius: 10, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  segT: { color: colors.text, fontWeight: '700', fontSize: 14 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 40, paddingHorizontal: 10, borderRadius: 17, borderWidth: 1.5, backgroundColor: colors.panelSolid, borderColor: colors.border, justifyContent: 'center' },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderColor: colors.line, minHeight: touch.min },
  name: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  link: { color: colors.live, fontSize: 15 },
  empty: { color: colors.muted, fontSize: 14, textAlign: 'center', paddingVertical: 30, lineHeight: 20 },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.inset, color: colors.text, paddingHorizontal: 12, fontSize: 16 },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.accent },
  newT: { color: colors.accentInk, fontWeight: '800', fontSize: 15 },
  comment: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panelSolid, gap: 4 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.panelSolid },
  hide: { flexDirection: 'row', alignItems: 'center', gap: 6 },
}));
