// Nov 2: "new in the forum" — what this phone hasn't seen yet. A post is NEW when it has activity (new post or new
// comment) after you last opened it; a topic is highlighted when it has any NEW post. Your own posts never count.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';

const KEY = 'forum-seen:v1';
type Seen = { base: string; posts: Record<string, string> };
let cache: Seen | null = null;
const listeners = new Set<() => void>();
export const onSeenChange = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

async function load(): Promise<Seen> {
  if (cache) return cache;
  try { const raw = await AsyncStorage.getItem(KEY); if (raw) cache = JSON.parse(raw); } catch {}
  if (!cache) cache = { base: new Date(Date.now() - 3 * 86400000).toISOString(), posts: {} };   // first time: the last 3 days count as new
  return cache;
}
async function save() {
  if (!cache) return;
  const keep = Object.entries(cache.posts).sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 400);   // stay small
  cache.posts = Object.fromEntries(keep);
  AsyncStorage.setItem(KEY, JSON.stringify(cache)).catch(() => {});
}

export type Activity = { id: string; category_id: number; last_activity_at: string; author_id: string };
export const isNew = (seen: Seen, a: Activity, me: string | null) => a.author_id !== me && a.last_activity_at > (seen.posts[a.id] ?? seen.base);

/** Unseen posts by topic: { [category_id]: count } and the set of unseen post ids. */
export async function unseen(): Promise<{ byCategory: Record<number, number>; posts: Set<string>; total: number }> {
  const seen = await load();
  const me = (await supabase.auth.getSession()).data.session?.user.id ?? null;
  const { data, error } = await supabase.from('posts').select('id, category_id, last_activity_at, author_id')
    .gt('last_activity_at', seen.base).order('last_activity_at', { ascending: false }).limit(300);
  if (error) throw error;
  const byCategory: Record<number, number> = {}; const posts = new Set<string>();
  for (const a of (data ?? []) as Activity[]) if (isNew(seen, a, me)) { posts.add(a.id); byCategory[a.category_id] = (byCategory[a.category_id] ?? 0) + 1; }
  return { byCategory, posts, total: posts.size };
}

/** Opening a post marks it seen (up to its latest activity). */
export async function markSeen(postId: string, lastActivityAt: string) {
  const seen = await load();
  const now = new Date().toISOString();
  seen.posts[postId] = lastActivityAt > now ? lastActivityAt : now;
  await save();
  listeners.forEach((f) => f());
}
/** "Mark all read" for everything up to now. */
export async function markAllSeen() {
  const seen = await load();
  seen.base = new Date().toISOString(); seen.posts = {};
  await save();
  listeners.forEach((f) => f());
}
