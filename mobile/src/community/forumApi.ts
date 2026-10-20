import { supabase } from '../supabase';

export type Category = { id: number; slug: string; name: string; description: string | null };
export type Post = { id: string; author_id: string; category_id: number; title: string; body: string; species_code: string | null;
  comment_count: number; like_count: number; created_at: string; edited_at: string | null; last_activity_at: string; moderation_status: string };
export type Comment = { id: string; post_id: string; author_id: string; body: string; created_at: string; edited_at: string | null };

export async function categories(): Promise<Category[]> {
  const { data, error } = await supabase.from('forum_categories').select('id, slug, name, description').order('sort');
  if (error) throw error;
  return data ?? [];
}
export async function posts(categoryId: number): Promise<Post[]> {
  const { data, error } = await supabase.from('posts').select('*').eq('category_id', categoryId).order('last_activity_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data ?? [];
}
export async function comments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase.from('comments').select('*').eq('post_id', postId).order('created_at');
  if (error) throw error;
  return data ?? [];
}
export async function names(ids: string[]): Promise<Record<string, { display_name: string | null; verified_reporter: boolean }>> {
  if (!ids.length) return {};
  const { data } = await supabase.rpc('public_profiles', { ids: [...new Set(ids)] });
  return Object.fromEntries((data ?? []).map((p: any) => [p.id, p]));
}
export async function createPost(p: { category_id: number; title: string; body: string; species_code?: string | null }) {
  const { error } = await supabase.from('posts').insert(p);
  if (error) throw error;
}
export async function addComment(post_id: string, body: string) {
  const { error } = await supabase.from('comments').insert({ post_id, body });
  if (error) throw error;
}
export async function toggleLike(post_id: string, liked: boolean) {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid) throw new Error('Sign in first');
  const r = liked ? await supabase.from('reactions').delete().eq('post_id', post_id).eq('user_id', uid) : await supabase.from('reactions').insert({ post_id });
  if (r.error) throw r.error;
}
export async function myLikes(postIds: string[]): Promise<Set<string>> {
  const { data } = await supabase.auth.getSession();
  if (!data.session || !postIds.length) return new Set();
  const r = await supabase.from('reactions').select('post_id').in('post_id', postIds).eq('user_id', data.session.user.id);
  return new Set((r.data ?? []).map((x: any) => x.post_id));
}
export async function report(target_type: 'post' | 'comment' | 'catch' | 'user', target_id: string, reason: string) {
  const { error } = await supabase.from('moderation_reports').insert({ target_type, target_id, reason });
  if (error && !String(error.message).includes('duplicate')) throw error;
}
export async function block(userId: string) {
  const { error } = await supabase.from('user_blocks').insert({ blocked: userId });
  if (error && !String(error.message).includes('duplicate')) throw error;
}
export async function deleteOwn(table: 'posts' | 'comments', id: string) {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}
