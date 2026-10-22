// Sponsors (plan: 'Ads, sponsorships'). Contextual only: what's on screen + the COARSE area (e.g. "Orange County").
// Frequency caps are kept on the phone; events carry a device hash that changes every day (no identity, no location).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';
import { API_URL } from '../config';
import { config } from '../appConfig';
import { currentArea, track } from '../analytics';

export type AdKind = 'image' | 'gif' | 'video' | 'html5' | 'native' | 'pdf';
export type ActionType = 'website' | 'call' | 'directions' | 'coupon' | 'none';
export type Creative = {
  kind: AdKind; media_url?: string; poster_url?: string; html_url?: string; pdf_url?: string; width?: number; height?: number; duration_s?: number;
  headline?: string; body?: string; cta_label?: string; logo_url?: string; advertiser_logo?: string; action_type?: ActionType; action_value?: string;
};
export type Ad = {
  id: number; placement: string; presented_by_section: string | null; creative_url: string | null; click_url: string | null;
  headline: string | null; advertiser: string | null; max_per_user_per_day: number; creative: Creative;
};
export type AdEvent = 'impression' | 'click' | 'call' | 'directions' | 'coupon_open' | 'coupon_save' | 'video_start' | 'video_complete';

const today = () => new Date().toISOString().slice(0, 10);
async function installId() {
  let id = await AsyncStorage.getItem('install-id');
  if (!id) { id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; await AsyncStorage.setItem('install-id', id); }
  return id;
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
const dayHash = async () => hash(`${await installId()}|${today()}`);

async function shownToday(id: number) { return Number((await AsyncStorage.getItem(`ad:${today()}:${id}`)) ?? '0'); }
async function bump(id: number) { await AsyncStorage.setItem(`ad:${today()}:${id}`, String((await shownToday(id)) + 1)); }

/** Older ads (before the Ad Studio) only had an image + link; treat them as an image ad. */
export function normalize(ad: Ad): Ad {
  if (ad.creative?.kind) return ad;
  return { ...ad, creative: { kind: 'image', media_url: ad.creative_url ?? undefined, action_type: ad.click_url ? 'website' : 'none', action_value: ad.click_url ?? undefined } };
}

// ---------------- ad spaces preview (admins: Me → Ad spaces preview) ----------------
// Fills every sponsor slot in the app with a labeled placeholder so you can see exactly where ads go.
// Nothing is sent to the server for placeholders (their id is negative).
let preview = false;
const previewListeners = new Set<(on: boolean) => void>();
export const adPreviewOn = () => preview;
export async function loadAdPreview() { try { preview = (await AsyncStorage.getItem('ad-preview')) === '1'; } catch { preview = false; } previewListeners.forEach((f) => f(preview)); return preview; }
export async function setAdPreview(on: boolean) {
  preview = on; previewListeners.forEach((f) => f(on));
  try { await AsyncStorage.setItem('ad-preview', on ? '1' : '0'); } catch { /* fine */ }
}
export function onAdPreview(fn: (on: boolean) => void) { previewListeners.add(fn); return () => { previewListeners.delete(fn); }; }

/** Every sponsor slot in the app: where it is, why it doesn't get in the way, and what it sells. */
export const AD_SPACES: Record<string, { name: string; where: string; rule: string }> = {
  'presented_by:Weather': { name: 'Weather — "Marine forecast presented by"', where: 'Top of the Weather tab, under the conditions card', rule: 'One sponsor per week. One small line with a logo.' },
  'presented_by:Today': { name: 'Today — "Fishing report presented by"', where: 'Top of the Today sheet on the map', rule: 'One sponsor per week.' },
  'presented_by:Catch Map': { name: 'Catch Map — "Presented by"', where: 'Catch Map bar on the map', rule: 'One sponsor per week; matched to the species shown.' },
  'presented_by:SST Map': { name: 'Water temp — "Presented by"', where: 'Time bar when Water temperature is on', rule: 'One sponsor per week.' },
  'presented_by:Wind': { name: 'Wind — "Presented by"', where: 'Time bar when Wind is on', rule: 'One sponsor per week.' },
  'presented_by:Radar': { name: 'Radar — "Presented by"', where: 'Radar time pill on the map', rule: 'One sponsor per week.' },
  'presented_by:Map Layers': { name: 'Map layers — "Presented by"', where: 'Top of the Map options sheet', rule: 'One sponsor per week. Only while the sheet is open.' },
  'presented_by:Harbors': { name: 'Harbor info — "Presented by"', where: 'Bottom of every harbor / fuel / bait info card', rule: 'One sponsor per week.' },
  banner_weather: { name: 'Weather banner', where: 'Middle of the Weather tab, after the hourly forecast', rule: 'Max 1 per screen, scrolls with the page.' },
  banner_dashboard: { name: 'Today banner', where: 'Bottom of the Today sheet', rule: 'Max 1 per screen.' },
  banner_reports: { name: 'Catch reports banner', where: 'Inside the catch reports feed', rule: 'Matched to the species filter.' },
  banner_community: { name: 'Community banner', where: 'Top of the forum list', rule: 'Max 1 per screen.' },
  featured_listing: { name: 'Featured business pin', where: 'Gold pin on the map when Fuel, Bait or Marinas is switched on', rule: 'Only shows with the matching layer. Up to 4 per area.' },
  sponsor_intro: { name: '5-second intro', where: 'Full screen at app open', rule: 'Only when the boat is stopped, not recording, at most once every 4 hours. Skippable.' },
};

function demoAd(placement: string, section?: string): Ad {
  const key = section ? `${placement}:${section}` : placement;
  const s = AD_SPACES[key] ?? { name: key, where: '', rule: '' };
  return {
    id: -1, placement, presented_by_section: section ?? null, creative_url: null, click_url: null, headline: `AD SPACE · ${s.name}`,
    advertiser: 'Your business here', max_per_user_per_day: 99,
    creative: { kind: 'native', headline: section ? `Your logo · ${section}` : `Ad space: ${s.name}`, body: s.rule, action_type: 'none' },
  };
}
export const isDemo = (ad: Ad | null | undefined) => !!ad && ad.id < 0;

export async function getAd(placement: string, section?: string, tags: string[] = []): Promise<Ad | null> {
  if (preview) return demoAd(placement, section);
  if (!API_URL || !config().ads_enabled) return null;
  try {
    const q = new URLSearchParams({ placement, tags: tags.join(',') });
    if (section) q.set('section', section);
    const area = currentArea();
    if (area && area !== 'Unknown' && area !== 'Other') q.set('area', area);
    const r = await fetch(`${API_URL}/ads?${q.toString()}`);
    if (r.status !== 200) return null;
    const ad = normalize((await r.json()) as Ad);
    if ((await shownToday(ad.id)) >= (ad.max_per_user_per_day || 3)) return null;   // frequency cap
    return ad;
  } catch { return null; }
}

/** Featured business pins (fuel docks, bait, marinas that pay to stand out). Only ads with a map position
 *  (a "Directions" action: "lat,lon") can be pins. In preview, one placeholder per kind; the map places it. */
export type Featured = Ad & { lat: number | null; lon: number | null; kind: string };
export async function getFeatured(kinds: string[]): Promise<Featured[]> {
  if (!kinds.length) return [];
  if (preview) return kinds.map((k) => ({ ...demoAd('featured_listing'), id: -1, lat: null, lon: null, kind: k, advertiser: `Featured ${k} business` }));
  if (!API_URL || !config().ads_enabled) return [];
  try {
    const q = new URLSearchParams({ kinds: kinds.join(',') });
    const area = currentArea();
    if (area && area !== 'Unknown' && area !== 'Other') q.set('area', area);
    const r = await fetch(`${API_URL}/ads/featured?${q.toString()}`);
    if (r.status !== 200) return [];
    const list = (await r.json()) as any[];
    return list.map((a) => {
      const ad = normalize(a as Ad);
      const [lat, lon] = (ad.creative.action_type === 'directions' ? ad.creative.action_value ?? '' : '').split(',').map(Number);
      return { ...ad, lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null, kind: a.kind ?? '' };
    }).filter((a) => a.lat != null);
  } catch { return []; }
}

export async function send(ad: Ad, event: AdEvent, context?: string) {
  if (ad.id < 0) return;   // preview placeholder
  try {
    await fetch(`${API_URL}/ads/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: ad.id, event, placement: ad.placement, context, device_day_hash: await dayHash(), area: currentArea() }) });
  } catch { /* best effort */ }
}
/** Counted once the ad has actually been on screen (the components call this after ~1 second). */
export async function impression(ad: Ad, context?: string) { if (ad.id < 0) return; await bump(ad.id); send(ad, 'impression', context); }

// ---------------- what a tap does ----------------
export function telUrl(v: string) { return `tel:${v.replace(/[^0-9+]/g, '')}`; }
export function directionsUrl(v: string, label: string, os: string = Platform.OS) {
  const [lat, lon] = v.split(',').map((x) => x.trim());
  return os === 'ios' ? `http://maps.apple.com/?daddr=${lat},${lon}&q=${encodeURIComponent(label)}` : `geo:0,0?q=${lat},${lon}(${encodeURIComponent(label)})`;
}
export function ctaText(c: Creative): string {
  if (c.cta_label) return c.cta_label;
  return { website: 'Learn more', call: 'Call', directions: 'Directions', coupon: 'Get coupon', none: '' }[c.action_type ?? 'none'] ?? '';
}

let couponOpener: ((ad: Ad) => void) | null = null;
/** The app root registers the coupon sheet once. */
export function setCouponOpener(fn: (ad: Ad) => void) { couponOpener = fn; }

export function tapAd(ad: Ad, context?: string) {
  if (ad.id < 0) {
    const k = ad.presented_by_section ? `${ad.placement}:${ad.presented_by_section}` : ad.placement;
    const s = AD_SPACES[k];
    Alert.alert(s?.name ?? 'Ad space', [s?.where && `Where: ${s.where}`, s?.rule && `Rule: ${s.rule}`, 'Set the price in Admin → Sponsors. Turn this preview off in Me → Ad spaces preview.'].filter(Boolean).join('\n\n'));
    return;
  }
  const c = ad.creative; const v = c.action_value ?? '';
  track('sponsor_click', { placement: ad.placement, action: c.action_type ?? 'none' });
  switch (c.action_type) {
    case 'website': send(ad, 'click', context); if (/^https?:\/\//i.test(v)) Linking.openURL(v).catch(() => {}); break;
    case 'call': send(ad, 'call', context); Linking.openURL(telUrl(v)).catch(() => {}); break;
    case 'directions': send(ad, 'directions', context); Linking.openURL(directionsUrl(v, ad.advertiser ?? 'Sponsor')).catch(() => {}); break;
    case 'coupon': send(ad, 'coupon_open', context); couponOpener?.(ad); break;
    default: if (c.pdf_url) { send(ad, 'coupon_open', context); couponOpener?.(ad); }
  }
}
// kept for older callers
export function click(ad: Ad, context?: string) { tapAd(ad, context); }

// ---------------- saved coupons (on the phone only) ----------------
export type SavedCoupon = { id: string; advertiser: string; code: string | null; pdf_url: string | null; headline: string | null; savedAt: number };
const COUPONS = 'saved-coupons:v1';
export async function savedCoupons(): Promise<SavedCoupon[]> {
  try { return JSON.parse((await AsyncStorage.getItem(COUPONS)) ?? '[]'); } catch { return []; }
}
export async function saveCoupon(ad: Ad): Promise<boolean> {
  const list = await savedCoupons();
  const id = `${ad.id}`;
  if (list.some((c) => c.id === id)) return false;
  const c = ad.creative;
  list.unshift({ id, advertiser: ad.advertiser ?? 'Sponsor', code: c.action_type === 'coupon' ? c.action_value ?? null : null, pdf_url: c.pdf_url ?? null, headline: c.headline ?? ad.headline, savedAt: Date.now() });
  await AsyncStorage.setItem(COUPONS, JSON.stringify(list.slice(0, 50)));
  send(ad, 'coupon_save');
  return true;
}
export async function removeCoupon(id: string) {
  await AsyncStorage.setItem(COUPONS, JSON.stringify((await savedCoupons()).filter((c) => c.id !== id)));
}
