// Catch logging with an offline queue. A catch is saved on the phone first, then sent when there's
// signal and you're signed in. Re-sending is safe (client_id makes it idempotent).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { getJSON } from '../api';
import { supabase } from '../supabase';

export type LocationMode = 'exact' | 'approximate' | 'area' | 'private';
export type PendingCatch = {
  client_id: string; species_code: string; caught_at: string; lat: number; lon: number;
  location_mode: LocationMode; anonymous: boolean; area_name?: string | null; spot_id?: string | null;
  quantity: number; weight_lb?: number | null; length_in?: number | null; kept?: boolean | null;
  technique?: string | null; bait?: string | null; fishing_depth_ft?: number | null; water_depth_ft?: number | null;
  meter_marks?: string | null; notes?: string | null;
  found_on?: string | null;           // Nov 2: paddy | meter_marks | school | birds | porpoise | other
  photos: { uri: string; live: boolean }[]; show_photos_public: boolean;
  share_groups?: string[];            // also send the exact spot to these fishing groups (members only)
  error?: string | null; tries?: number;
};
export type PublicReport = {
  id: string; species_code: string; caught_at: string; lon: number; lat: number; area_name: string | null; fuzz_radius_nm: number | null;
  quantity: number; weight_lb: number | null; technique: string | null; bait: string | null; author_name: string | null; verified: boolean;
  sst_f: number | null; chl_mg_m3: number | null; tide_stage: string | null; wind_kt: number | null; photo_paths: string[];
  // Nov 2 (db 017): the rest of what the angler shared
  found_on?: string | null; length_in?: number | null; kept?: boolean | null; fishing_depth_ft?: number | null; water_depth_ft?: number | null;
  meter_marks?: string | null; notes?: string | null;
};

const QUEUE = 'catch-queue:v1';
const SPECIES_IDS = 'species-ids:v1';

export const newClientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export async function loadQueue(): Promise<PendingCatch[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE)) ?? '[]'); } catch { return []; }
}
const saveQueue = (q: PendingCatch[]) => AsyncStorage.setItem(QUEUE, JSON.stringify(q));

export async function queueCatch(c: PendingCatch) {
  await saveQueue([...(await loadQueue()), c]);
  return syncQueue();
}

async function speciesIds(): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase.from('species').select('id, code');
    if (error || !data) throw error;
    const map = Object.fromEntries(data.map((s: any) => [s.code, s.id]));
    AsyncStorage.setItem(SPECIES_IDS, JSON.stringify(map)).catch(() => {});
    return map;
  } catch {
    return JSON.parse((await AsyncStorage.getItem(SPECIES_IDS)) ?? '{}');
  }
}

/** Re-encode = strip GPS/EXIF, and shrink for upload. */
async function cleanPhoto(uri: string): Promise<ArrayBuffer> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
  const r = await fetch(out.uri);
  return await r.arrayBuffer();
}

async function sendOne(c: PendingCatch, uid: string, ids: Record<string, number>) {
  const species_id = ids[c.species_code];
  if (!species_id) throw Object.assign(new Error(`Unknown species ${c.species_code}`), { permanent: true });

  // conditions at the catch time (server computes from that day's satellite image, tide predictions, moon)
  const snap = (await getJSON<any>(`/snapshot?lat=${c.lat}&lon=${c.lon}&at=${encodeURIComponent(c.caught_at)}`, { timeoutMs: 25000 })).data;
  const { data: s, error: se } = await supabase.from('env_snapshots').insert({ ...snap, user_id: uid }).select('id').single();
  if (se) throw se;

  const privatePaths: string[] = [];
  const publicPaths: string[] = [];
  for (let i = 0; i < c.photos.length; i++) {
    const body = await cleanPhoto(c.photos[i].uri);
    const path = `${uid}/${c.client_id}-${i}.jpg`;
    const up = await supabase.storage.from('catch-photos').upload(path, body, { contentType: 'image/jpeg', upsert: true });
    if (up.error) throw up.error;
    privatePaths.push(path);
    if (c.show_photos_public && c.location_mode !== 'private') {
      const pub = await supabase.storage.from('public-photos').upload(path, body, { contentType: 'image/jpeg', upsert: true });
      if (pub.error) throw pub.error;
      publicPaths.push(path);
    }
  }

  const row = {
    client_id: c.client_id, user_id: uid, species_id, caught_at: c.caught_at,
    true_geom: `SRID=4326;POINT(${c.lon} ${c.lat})`, location_mode: c.location_mode, anonymous: c.anonymous,
    area_name: c.area_name ?? null, spot_id: c.spot_id ?? null, quantity: c.quantity, weight_lb: c.weight_lb ?? null,
    length_in: c.length_in ?? null, kept: c.kept ?? null, technique: c.technique ?? null, bait: c.bait ?? null,
    fishing_depth_ft: c.fishing_depth_ft ?? null, water_depth_ft: c.water_depth_ft ?? null, meter_marks: c.meter_marks ?? null,
    notes: c.notes ?? null, photo_paths: privatePaths, public_photo_paths: publicPaths,
    live_photo: c.photos.some((p) => p.live), snapshot_id: s.id,
  };
  const withFound: Record<string, unknown> = c.found_on ? { ...row, found_on: c.found_on } : row;
  let { data: saved, error } = await supabase.from('catch_reports').upsert(withFound as any, { onConflict: 'client_id' }).select('id').single();
  if (error && c.found_on && /found_on/.test(String(error.message))) {
    // database not updated yet (db/migrations/017): save the catch without it rather than getting stuck
    ({ data: saved, error } = await supabase.from('catch_reports').upsert(row, { onConflict: 'client_id' }).select('id').single());
  }
  if (error) throw error;
  if (c.share_groups?.length && saved?.id) {
    // Safe to repeat: the server skips groups that already have this catch.
    const sh = await supabase.rpc('share_catch', { c: saved.id, groups: c.share_groups });
    if (sh.error) console.warn('share to group failed', sh.error.message);
  }
}

let syncing = false;
/** Sends whatever is waiting. Returns how many were sent and how many are still waiting. */
export async function syncQueue(): Promise<{ sent: number; waiting: number; signedIn: boolean }> {
  const q = await loadQueue();
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id;
  if (!uid || !q.length || syncing) return { sent: 0, waiting: q.length, signedIn: !!uid };
  syncing = true;
  let sent = 0;
  const keep: PendingCatch[] = [];
  try {
    const ids = await speciesIds();
    for (const c of q) {
      try { await sendOne(c, uid, ids); sent++; }
      catch (e: any) {
        keep.push({ ...c, error: e?.message ?? String(e), tries: (c.tries ?? 0) + 1 });
        if (!e?.permanent && /network|abort|fetch|timeout|HTTP 5/i.test(String(e?.message ?? e))) {
          keep.push(...q.slice(q.indexOf(c) + 1)); // offline: stop and keep the rest in order
          break;
        }
      }
    }
  } finally {
    await saveQueue(keep);
    syncing = false;
  }
  return { sent, waiting: keep.length, signedIn: true };
}

// ---------- reading ----------
export async function myCatches(): Promise<any[]> {
  const { data, error } = await supabase.from('catch_reports')
    .select('id, caught_at, quantity, weight_lb, length_in, kept, technique, bait, fishing_depth_ft, water_depth_ft, meter_marks, notes, location_mode, anonymous, area_name, verification_status, photo_paths, species(code, name), env_snapshots(*)')
    .order('caught_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data ?? [];
}
export async function deleteMyCatch(id: string) {
  const { error } = await supabase.from('catch_reports').delete().eq('id', id);
  if (error) throw error;
}

const since = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString();

export async function catchMap(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }, zoom: number, hours: number, species: string[] | null) {
  const { data, error } = await supabase.rpc('catch_map', {
    min_lon: b.minLon, min_lat: b.minLat, max_lon: b.maxLon, max_lat: b.maxLat, zoom: Math.round(zoom),
    since: since(hours), species_codes: species && species.length ? species : null,
  });
  if (error) throw error;
  return (data ?? []) as { lon: number; lat: number; species_code: string; n: number; fish: number; latest: string; verified_n: number; fuzzy: boolean; cell: number }[];
}

export async function reportsIn(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }, hours: number, species: string[] | null, lim = 50) {
  const { data, error } = await supabase.rpc('catch_reports_in', {
    min_lon: b.minLon, min_lat: b.minLat, max_lon: b.maxLon, max_lat: b.maxLat,
    since: since(hours), species_codes: species && species.length ? species : null, lim,
  });
  if (error) throw error;
  return (data ?? []) as PublicReport[];
}

export async function latestReports(hours: number, species: string | null, lim = 60) {
  let q = supabase.from('public_catches').select('id, species_code, caught_at, area_name, quantity, weight_lb, technique, bait, author_name, verified, sst_f, chl_mg_m3, tide_stage, wind_kt, photo_paths, fuzz_radius_nm')
    .gte('caught_at', since(hours)).order('caught_at', { ascending: false }).limit(lim);
  if (species) q = q.eq('species_code', species);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PublicReport[];
}

export const publicPhotoUrl = (path: string) => supabase.storage.from('public-photos').getPublicUrl(path).data.publicUrl;
export async function privatePhotoUrl(path: string) {
  const { data } = await supabase.storage.from('catch-photos').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function flagCatch(id: string, reason: 'fake' | 'wrong_location' | 'offensive' | 'spam' | 'other') {
  const { error } = await supabase.from('report_flags').insert({ catch_id: id, reason });
  if (error && !String(error.message).includes('duplicate')) throw error;
}

/** Cluster summary the way the spec shows it: count, typical size, top techniques, latest. */
export function summarize(rs: PublicReport[]) {
  const ws = rs.map((r) => r.weight_lb).filter((w): w is number => w != null).sort((a, b) => a - b);
  const q = (p: number) => ws[Math.min(ws.length - 1, Math.floor(p * (ws.length - 1)))];
  const counts: Record<string, number> = {};
  rs.forEach((r) => { if (r.technique) counts[r.technique] = (counts[r.technique] ?? 0) + 1; if (r.bait) counts[r.bait] = (counts[r.bait] ?? 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const ssts = rs.map((r) => r.sst_f).filter((v): v is number => v != null).sort((a, b) => a - b);
  return {
    reports: rs.length, fish: rs.reduce((a, r) => a + (r.quantity ?? 1), 0),
    size: ws.length >= 2 ? `${Math.round(q(0.25))}–${Math.round(q(0.75))} lb` : ws.length === 1 ? `${Math.round(ws[0])} lb` : null,
    top, latest: rs[0]?.caught_at ?? null,
    sst: ssts.length >= 3 ? `${ssts[Math.floor(ssts.length * 0.25)].toFixed(1)}–${ssts[Math.floor(ssts.length * 0.75)].toFixed(1)}°F` : null,
  };
}
