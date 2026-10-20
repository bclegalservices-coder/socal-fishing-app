// Sponsors (plan: 'Ads, sponsorships'). Contextual only: what's on screen + the COARSE area (e.g. "Orange County").
// Frequency caps are kept on the phone; events carry a device hash that changes every day (no identity, no location).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
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

export async function getAd(placement: string, section?: string, tags: string[] = []): Promise<Ad | null> {
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

export async function send(ad: Ad, event: AdEvent, context?: string) {
  try {
    await fetch(`${API_URL}/ads/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: ad.id, event, placement: ad.placement, context, device_day_hash: await dayHash(), area: currentArea() }) });
  } catch { /* best effort */ }
}
/** Counted once the ad has actually been on screen (the components call this after ~1 second). */
export async function impression(ad: Ad, context?: string) { await bump(ad.id); send(ad, 'impression', context); }

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
