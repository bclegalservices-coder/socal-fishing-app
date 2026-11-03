// Whale sightings (Nov 2): anyone signed in can log one; everyone sees them on the map (db/migrations/017).
import { supabase } from '../supabase';

export const WHALES: { key: string; name: string }[] = [
  { key: 'orca', name: 'Orca' }, { key: 'blue', name: 'Blue whale' }, { key: 'gray', name: 'Gray whale' },
  { key: 'humpback', name: 'Humpback' }, { key: 'fin', name: 'Fin whale' }, { key: 'other', name: 'Other' },
];
export const BEHAVIORS: { key: string; name: string }[] = [
  { key: 'traveling', name: 'Traveling' }, { key: 'feeding', name: 'Feeding' }, { key: 'breaching', name: 'Breaching' },
  { key: 'resting', name: 'Resting' }, { key: 'with_calf', name: 'With a calf' },
];
export const whaleName = (key: string, other?: string | null) => (key === 'other' && other ? other : WHALES.find((w) => w.key === key)?.name ?? 'Whale');
export const behaviorName = (key?: string | null) => BEHAVIORS.find((b) => b.key === key)?.name ?? null;

export type Sighting = { id: string; species: string; other_name: string | null; how_many: number; behavior: string | null; seen_at: string;
  lon: number; lat: number; notes: string | null; author_name: string | null; mine: boolean };

export async function logWhale(w: { species: string; other_name?: string | null; how_many: number; behavior?: string | null; lat: number; lon: number; notes?: string | null }) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in first (Me tab) to log a sighting.');
  const { error } = await supabase.from('whale_sightings').insert({
    species: w.species, other_name: w.species === 'other' ? (w.other_name?.trim() || null) : null, how_many: w.how_many,
    behavior: w.behavior ?? null, geom: `SRID=4326;POINT(${w.lon} ${w.lat})`, notes: w.notes?.trim() || null,
  });
  if (error) throw error;
}

export async function whalesIn(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }, hours = 72): Promise<Sighting[]> {
  const { data, error } = await supabase.rpc('whales_in', {
    min_lon: b.minLon, min_lat: b.minLat, max_lon: b.maxLon, max_lat: b.maxLat, since: new Date(Date.now() - hours * 3600000).toISOString(),
  });
  if (error) throw error;
  return (data ?? []) as Sighting[];
}

export async function deleteWhale(id: string) {
  const { error } = await supabase.from('whale_sightings').delete().eq('id', id);
  if (error) throw error;
}
