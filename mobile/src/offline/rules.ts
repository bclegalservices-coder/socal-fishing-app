// Rules & hazards data (MPAs, closures, wrecks, buoys, lanes): downloaded with the Home waters pack
// and kept on the phone, so the MPA alert works anywhere.
import { getJSON } from '../api';
import { readJSON, writeJSON } from './files';
import { indexPolygons, type Indexed } from './pip';

export type RulesLayer = { key: string; label: string; kind: string; source: string; checked_at?: string; available?: boolean; url?: string; count?: number; stale?: boolean; error?: string };
export type RulesData = { checked_at: string | null; layers: RulesLayer[]; features: Record<string, any>; savedAt: number };

export async function downloadRules(): Promise<RulesData> {
  const m = (await getJSON<any>('/layers', { cacheKey: 'layers' })).data.layers.find((l: any) => l.key === 'rules');
  if (!m) throw new Error('Rules layers are not processed yet (run the ocean job "rules").');
  const features: Record<string, any> = {};
  for (const l of m.layers as RulesLayer[]) {
    if (!l.available || !l.url) continue;
    const r = await fetch(l.url);
    if (r.ok) features[l.key] = await r.json();
  }
  const data: RulesData = { checked_at: m.checked_at, layers: m.layers, features, savedAt: Date.now() };
  await writeJSON('rules.json', data);
  return data;
}
export const loadRules = () => readJSON<RulesData>('rules.json');

/** Polygons the alert checks against: MPAs (CA + Mexico) and federal closures. */
export function protectedIndex(d: RulesData | null): Indexed[] {
  if (!d) return [];
  return indexPolygons(['mpa', 'mpa_mx', 'closures'].flatMap((k) => d.features[k]?.features ?? []));
}

export const rulesAgeDays = (d: RulesData | null) => (d?.checked_at ? (Date.now() - new Date(d.checked_at).getTime()) / 86400000 : null);

// ---------------------------------------------------------------------------------------------------------------
// Straight-from-CDFW fallback: until (or whenever) our server's rules job isn't reachable, the app downloads the
// official California MPA boundaries itself from CDFW's public "California Marine Protected Areas [ds582]" service.
// ---------------------------------------------------------------------------------------------------------------
export const CDFW_MPA_SERVICE = 'https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds582_fpu/FeatureServer/0';
export const CDFW_MPA_PAGE = 'https://wildlife.ca.gov/Conservation/Marine/MPAs';
const SOCAL_BBOX = '-121.2,32.4,-116.9,34.7';

/** SMR / SMCA (No-Take) = no take. SMCA = limited take. Mirrors api/rules/layers.py classify_mpa. */
export function classifyMpa(name?: string | null, type?: string | null): { take: 'no_take' | 'limited' | 'unknown'; rule: string } {
  const t = `${type ?? ''} ${name ?? ''}`.toUpperCase();
  if (t.includes('NO-TAKE') || t.includes('NO TAKE') || /\bSMR\b/.test(t) || t.includes('MARINE RESERVE')) return { take: 'no_take', rule: 'No take: no fishing or collecting of any kind.' };
  if (/\bSMCA\b/.test(t) || t.includes('CONSERVATION AREA')) return { take: 'limited', rule: 'Limited take: only the species and methods listed below are allowed.' };
  if (/\bSMP\b|\bSMRMA\b|MARINE PARK|RECREATIONAL MANAGEMENT/.test(t)) return { take: 'limited', rule: 'Special rules apply. Check the regulations.' };
  return { take: 'unknown', rule: 'Protected area: check the regulations before fishing.' };
}

/**
 * What IS allowed inside each South Coast SMCA (limited-take area), from CDFW's official MPA regulation summary
 * language (CCR Title 14 §632(b)). Keyed by a word-match on the MPA name. Shown with its source and a link to the
 * official rules, because the Fish and Game Commission can change MPA rules: review this table before each season.
 */
export const MPA_ALLOWED_SUMMARY_CHECKED = '2026-10-20';
const ALLOWED: { match: RegExp; allowed: string[] }[] = [
  { match: /kashtayit/i, allowed: ['Recreational take of giant kelp by hand, invertebrates except rock scallops and mussels, and finfish.'] },
  { match: /naples/i, allowed: ['Recreational take of white seabass and pelagic finfish by spearfishing.', 'Commercial take of giant kelp.'] },
  { match: /point dume/i, allowed: ['Recreational take of white seabass and pelagic finfish by spearfishing.', 'Commercial take of coastal pelagic species by round haul net, brail gear and light boat; swordfish by harpoon.'] },
  { match: /abalone cove/i, allowed: ['Recreational take of market squid by hand-held dip net, and white seabass and pelagic finfish by spearfishing.', 'Commercial take of coastal pelagic species by round haul net, brail gear and light boat; swordfish by harpoon.'] },
  { match: /bolsa bay/i, allowed: ['Recreational take of finfish by hook-and-line from shore in designated areas only.', 'Closed 8 p.m. to 6 a.m. Boating, swimming, wading and diving prohibited.'] },
  { match: /upper newport/i, allowed: ['Recreational take of finfish by hook-and-line from shore only.', 'Restrictions exist for boating and swimming.'] },
  { match: /crystal cove/i, allowed: ['Recreational take of finfish by hook-and-line or spearfishing; spiny lobster and sea urchin.', 'Commercial take of sea urchin, spiny lobster by trap, and coastal pelagic species by round haul net, brail gear and light boat.', 'No take from tidepools.'] },
  { match: /dana point/i, allowed: ['Recreational take of finfish by hook-and-line or spearfishing, and lobster and urchin.', 'Commercial take of lobster by trap, sea urchin, and coastal pelagic species by round haul net, brail gear and light boat.', 'No take from tidepools.'] },
  { match: /swami/i, allowed: ['Recreational take of pelagic finfish and white seabass by spearfishing.'] },
  { match: /san dieguito/i, allowed: ['Recreational take of finfish by hook-and-line from shore.', 'Closed 8 p.m. to 5 a.m. Boating, swimming, wading and diving prohibited.'] },
  { match: /scripps/i, allowed: ['Recreational take of coastal pelagic species (except market squid) by hook-and-line only.'] },
  { match: /south la jolla/i, allowed: ['Recreational take of pelagic finfish by hook-and-line only.'] },
  { match: /tijuana/i, allowed: ['Recreational take of coastal pelagic species (except market squid) by hand-held dip net only.', 'Commercial take of coastal pelagic species (except market squid) by round haul net.'] },
  { match: /painted cave/i, allowed: ['Recreational take of lobster and pelagic finfish.'] },
  { match: /anacapa/i, allowed: ['Recreational take of lobster and pelagic finfish.', 'Commercial take of lobster.'] },
  { match: /arrow p(oin)?t/i, allowed: ['Recreational take of marine plants and finfish.', 'Take of invertebrates is prohibited.'] },
  { match: /blue cavern offshore/i, allowed: ['Recreational take of market squid by hand-held dip net; pelagic finfish by hook-and-line or spearfishing; white seabass by spearfishing.', 'Commercial take of pelagic finfish by hook-and-line, and swordfish by harpoon.'] },
  { match: /lover/i, allowed: ['Recreational hook-and-line fishing from the Cabrillo Mole only.', 'Feeding fish for marine-life viewing is allowed.'] },
  { match: /farnsworth onshore/i, allowed: ['Recreational take of market squid by hand-held dip net; white seabass and pelagic finfish by spearfishing; marlin, tuna and dorado by trolling.', 'Commercial take of coastal pelagic species by round haul net, brail gear and light boat; swordfish by harpoon.'] },
  { match: /farnsworth offshore/i, allowed: ['Recreational take of market squid by hand-held dip net; white seabass by spearfishing; pelagic finfish by hook-and-line or spearfishing; marlin, tuna and dorado by trolling.', 'Commercial take of coastal pelagic species by round haul net, brail gear and light boat; swordfish by harpoon.'] },
  { match: /cat harbor/i, allowed: ['Recreational take of lobster and sea urchin, squid by hook-and-line, and finfish by hook-and-line or spearfishing.', 'Commercial take of lobster and sea urchin, and sea cucumber by diving only.'] },
];
const NO_TAKE_EXTRA: { match: RegExp; note: string }[] = [
  { match: /blue cavern onshore/i, note: 'No anchoring or mooring inside the former Catalina Marine Science Center Marine Life Refuge.' },
  { match: /casino p(oin)?t/i, note: 'Feeding fish for marine-life viewing is allowed.' },
];

export function mpaDetails(name: string | null | undefined, take: string): { allowed: string[]; notes: string[] } {
  const n = name ?? '';
  if (take === 'no_take') return { allowed: [], notes: NO_TAKE_EXTRA.filter((x) => x.match.test(n)).map((x) => x.note) };
  const hit = ALLOWED.find((x) => x.match.test(n));
  return { allowed: hit?.allowed ?? [], notes: [] };
}

/** A handful of boundary corner points (simplified from CDFW's polygon) for the info card. */
export function boundaryPoints(geom: any, max = 6): [number, number][] {
  const ring: number[][] = geom?.type === 'Polygon' ? geom.coordinates[0] : geom?.type === 'MultiPolygon' ? geom.coordinates[0][0] : [];
  if (ring.length < 4) return [];
  // keep the points farthest from the polygon's center, spread around it
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const sectors = new Map<number, number[]>();
  for (const p of ring) {
    const s = Math.floor(((Math.atan2(p[1] - cy, p[0] - cx) + Math.PI) / (2 * Math.PI)) * max) % max;
    const best = sectors.get(s);
    if (!best || Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(best[0] - cx, best[1] - cy)) sectors.set(s, p);
  }
  return [...sectors.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => [p[1], p[0]]); // [lat, lon]
}

function normalizeCdfw(f: any) {
  const p = f.properties ?? {};
  const name = p.FULLNAME || p.NAME || p.SHORTNAME || 'Marine protected area';
  const cls = classifyMpa(p.NAME ?? name, p.Type);
  return { ...f, properties: { layer: 'mpa', kind: 'mpa', name, short: p.NAME, type: p.Type, ccr: p.CCR, acres: p.Acres, ...cls,
    source: 'California Department of Fish and Wildlife', regs: CDFW_MPA_PAGE } };
}

export async function downloadMpasFromCdfw(): Promise<RulesData> {
  const q = `${CDFW_MPA_SERVICE}/query?where=1%3D1&geometry=${SOCAL_BBOX}&geometryType=esriGeometryEnvelope&inSR=4326`
    + '&spatialRel=esriSpatialRelIntersects&outFields=NAME,FULLNAME,SHORTNAME,Type,CCR,Acres&outSR=4326&maxAllowableOffset=0.00003&f=geojson';
  const r = await fetch(q);
  if (!r.ok) throw new Error(`CDFW MPA service: HTTP ${r.status}`);
  const gj = await r.json();
  const mpa = { type: 'FeatureCollection', features: (gj.features ?? []).filter((f: any) => f.geometry).map(normalizeCdfw) };
  const now = new Date().toISOString();
  const data: RulesData = { checked_at: now, savedAt: Date.now(), features: { mpa },
    layers: [{ key: 'mpa', label: 'Marine protected areas (California)', kind: 'mpa', source: 'California Department of Fish and Wildlife', checked_at: now, available: true, count: mpa.features.length }] };
  await writeJSON('rules.json', data);
  return data;
}

/** Our server first (it adds closures, Mexico and hazards); CDFW directly if the server isn't there. */
export async function refreshRules(): Promise<RulesData> {
  try { return await downloadRules(); } catch { return downloadMpasFromCdfw(); }
}
