// Sponsor placements. Never on the map during navigation; never full-screen while the boat is moving.
// Every format from the Ad Studio: images, animated GIFs, muted videos, PDF flyers, HTML5 animations and "quick ads".
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import { colors, makeStyles } from '../theme';
import { ctaText, getAd, impression, isDemo, onAdPreview, removeCoupon, saveCoupon, savedCoupons, send, tapAd, type Ad, type SavedCoupon } from './ads';

/** Changes whenever Ad spaces preview is switched, so every slot re-asks for its ad. */
export function useAdPreviewTick() {
  const [n, setN] = useState(0);
  useEffect(() => onAdPreview(() => setN((x) => x + 1)), []);
  return n;
}

/** Counts a view only after the ad has been on screen for a second. */
function useViewed(ad: Ad | null, context: string) {
  useEffect(() => {
    if (!ad) return;
    const t = setTimeout(() => impression(ad, context), 1000);
    return () => clearTimeout(t);
  }, [ad?.id, context]);
}

function AdVideo({ ad, style, fit }: { ad: Ad; style: any; fit: 'cover' | 'contain' }) {
  const started = useRef(false); const done = useRef(false);
  const player = useVideoPlayer(ad.creative.media_url ?? '', (p) => { p.muted = true; p.loop = true; p.play(); });
  useEffect(() => {
    const a = player.addListener('playingChange', (e: any) => { if (e?.isPlaying && !started.current) { started.current = true; send(ad, 'video_start'); } });
    const b = player.addListener('playToEnd', () => { if (!done.current) { done.current = true; send(ad, 'video_complete'); } });
    return () => { a.remove(); b.remove(); };
  }, [player, ad.id]);
  return <VideoView player={player} style={style} contentFit={fit} nativeControls={false} allowsPictureInPicture={false} />;
}

/** HTML5 ads run sealed off: no navigation, no storage, no access to the app; taps go through our own handler. */
function AdHtml({ ad, style }: { ad: Ad; style: any }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => { let on = true; fetch(ad.creative.html_url!).then((r) => r.text()).then((t) => on && setHtml(t)).catch(() => {}); return () => { on = false; }; }, [ad.creative.html_url]);
  if (!html) return <View style={[style, { backgroundColor: colors.water }]} />;
  return (
    <View style={style} pointerEvents="none">
      <WebView source={{ html }} originWhitelist={['about:*', 'data:*']} onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:')}
        javaScriptEnabled domStorageEnabled={false} incognito scrollEnabled={false} allowFileAccess={false} mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false} style={{ flex: 1, backgroundColor: 'transparent' }} />
    </View>
  );
}

function NativeCard({ ad, big = false }: { ad: Ad; big?: boolean }) {
  const st = useSt();
  const c = ad.creative; const logo = c.logo_url || c.advertiser_logo;
  return (
    <View style={[st.native, big && st.nativeBig]}>
      {logo ? <Image source={{ uri: logo }} style={big ? st.nativeLogoBig : st.nativeLogo} contentFit="contain" /> : null}
      <View style={{ flex: big ? 0 : 1, alignItems: big ? 'center' : 'flex-start' }}>
        <Text style={[st.nativeT, big && { fontSize: 22, textAlign: 'center' }]} numberOfLines={2}>{c.headline ?? ad.advertiser}</Text>
        {c.body ? <Text style={[st.nativeB, big && { fontSize: 15, textAlign: 'center' }]} numberOfLines={big ? 4 : 2}>{c.body}</Text> : null}
      </View>
      {ctaText(c) ? <View style={st.cta}><Text style={st.ctaT}>{ctaText(c)}</Text></View> : null}
    </View>
  );
}

/** The ad itself, whatever format it is. */
export function AdMedia({ ad, style, fit = 'cover' }: { ad: Ad; style: any; fit?: 'cover' | 'contain' }) {
  const c = ad.creative;
  if (c.kind === 'video' && c.media_url) return <AdVideo ad={ad} style={style} fit={fit} />;
  if (c.kind === 'html5' && c.html_url) return <AdHtml ad={ad} style={style} />;
  if (c.kind === 'native') return <NativeCard ad={ad} />;
  const uri = c.media_url ?? ad.creative_url;
  return uri ? <Image source={{ uri }} style={style} contentFit={fit} autoplay transition={150} accessibilityLabel={c.headline ?? ad.advertiser ?? 'Sponsor'} /> : null;
}

/** "Presented by ___" line for a section (Today, Weather, Catch Map, SST Map). */
export function PresentedBy({ section, tags = [], pill = false }: { section: string; tags?: string[]; pill?: boolean }) {
  const st = useSt();
  const tick = useAdPreviewTick();
  const [ad, setAd] = useState<Ad | null>(null);
  useEffect(() => { let on = true; getAd('presented_by', section, tags).then((a) => on && setAd(a)); return () => { on = false; }; }, [section, tags.join(','), tick]);
  useViewed(ad, section);
  if (!ad) return null;
  if (isDemo(ad)) return (
    <Pressable onPress={() => tapAd(ad, section)} style={[st.demoPb, pill && st.pill]}><Text style={st.demoT}>AD SPACE · "{section}" presented by [your logo]</Text></Pressable>
  );
  const c = ad.creative; const logo = c.kind === 'native' ? (c.logo_url || c.advertiser_logo) : (c.media_url || ad.creative_url || c.advertiser_logo);
  const lead = section === 'Weather' ? 'Marine forecast presented by' : section === 'Today' ? 'Fishing report presented by' : 'Presented by';
  return (
    <Pressable onPress={() => tapAd(ad, section)} style={[st.pb, pill && st.pill]} accessibilityLabel={`Sponsored: ${lead} ${ad.advertiser}`}>
      <Text style={st.pbT}>{lead} </Text>
      {logo ? <Image source={{ uri: logo }} style={st.pbLogo} contentFit="contain" /> : null}
      <Text style={st.pbName}>{c.headline || ad.advertiser}</Text>
    </Pressable>
  );
}

/** Banner (Today screen, catch reports, forum). Clearly labeled "Sponsored". */
export function SponsorBanner({ placement, tags = [] }: { placement: 'banner_dashboard' | 'banner_reports' | 'banner_community' | 'banner_weather'; tags?: string[] }) {
  const st = useSt();
  const tick = useAdPreviewTick();
  const [ad, setAd] = useState<Ad | null>(null);
  useEffect(() => { let on = true; getAd(placement, undefined, tags).then((a) => on && setAd(a)); return () => { on = false; }; }, [placement, tags.join(','), tick]);
  useViewed(ad, placement);
  if (!ad) return null;
  if (isDemo(ad)) return (
    <Pressable onPress={() => tapAd(ad, placement)} style={st.demoBanner}>
      <Text style={st.demoT}>AD SPACE · BANNER</Text>
      <Text style={st.demoBig}>{ad.headline?.replace('AD SPACE · ', '')}</Text>
      <Text style={st.demoS}>Logo or photo · headline · Call / Directions / Coupon button · 16:5</Text>
    </Pressable>
  );
  const c = ad.creative;
  return (
    <Pressable onPress={() => tapAd(ad, placement)} style={st.banner} accessibilityRole="link" accessibilityLabel={`Sponsored by ${ad.advertiser}. ${c.headline ?? ''}`}>
      <Text style={st.tag}>SPONSORED · {ad.advertiser}</Text>
      {c.kind === 'native' ? <NativeCard ad={ad} /> : <AdMedia ad={ad} style={st.bannerMedia} />}
      {c.kind !== 'native' && (c.headline || ctaText(c)) ? (
        <View style={st.cap}><Text style={st.capT} numberOfLines={1}>{c.headline ?? ''}</Text>{ctaText(c) ? <View style={st.cta}><Text style={st.ctaT}>{ctaText(c)}</Text></View> : null}</View>
      ) : null}
    </Pressable>
  );
}

/** 5-second "Today's SoCal fishing conditions, presented by ___" at app open. The caller decides if it's allowed
 *  (boat stopped, not navigating or recording, not shown in the last 4 hours). */
export function SponsorIntro({ ad, onDone }: { ad: Ad; onDone: () => void }) {
  const st = useSt();
  const [left, setLeft] = useState(5);
  useViewed(ad, 'intro');
  // Count down once a second; close when it reaches 0 (outside the countdown update, so React is happy).
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left === 0) onDone(); }, [left]);
  const c = ad.creative;
  return (
    <View style={st.intro}>
      <Text style={st.introH}>Today's SoCal fishing conditions</Text>
      <Text style={st.introS}>presented by</Text>
      <Pressable onPress={() => tapAd(ad, 'intro')} style={{ alignItems: 'center', gap: 12, width: '100%', flex: 1, maxHeight: '70%' }}>
        {c.kind === 'native' ? <NativeCard ad={ad} big /> : <AdMedia ad={ad} style={st.introMedia} fit="contain" />}
        <Text style={st.introName}>{ad.advertiser}</Text>
      </Pressable>
      <Pressable onPress={onDone} hitSlop={12}><Text style={st.tag}>SPONSORED · {left}  ✕</Text></Pressable>
    </View>
  );
}

/** Shown when an angler taps a coupon ad: the code, the flyer, and "Save" (kept on the phone). */
export function CouponSheet({ ad, onClose }: { ad: Ad | null; onClose: () => void }) {
  const st = useSt();
  if (!ad) return null;
  const c = ad.creative; const code = c.action_type === 'coupon' ? c.action_value : null;
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.sheet}>
        <Text style={st.tag}>COUPON · {ad.advertiser}</Text>
        <Text style={st.sheetH}>{c.headline ?? ad.headline ?? ad.advertiser}</Text>
        {code ? <View style={st.code}><Text style={st.codeT} selectable>{code}</Text></View> : null}
        {code ? <Text style={st.introS}>Show this code at the counter, or use it online.</Text> : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={[st.btn, st.btnOn]} onPress={async () => { const ok = await saveCoupon(ad); Alert.alert(ok ? 'Saved' : 'Already saved', 'Find it under Me → Saved coupons.'); }}>
            <Text style={[st.btnT, { color: colors.accentInk }]}>Save coupon</Text></Pressable>
          {c.pdf_url ? <Pressable style={st.btn} onPress={() => Linking.openURL(c.pdf_url!).catch(() => {})}><Text style={st.btnT}>Open flyer</Text></Pressable> : null}
          {code ? <Pressable style={st.btn} onPress={() => Share.share({ message: `${ad.advertiser}: code ${code}` }).catch(() => {})}><Text style={st.btnT}>Share</Text></Pressable> : null}
        </View>
        <Pressable onPress={onClose} style={{ alignSelf: 'center', padding: 10 }}><Text style={st.introS}>Close</Text></Pressable>
      </View>
    </Modal>
  );
}

/** Me → Saved coupons. */
export function SavedCoupons() {
  const st = useSt();
  const [list, setList] = useState<SavedCoupon[]>([]);
  useEffect(() => { savedCoupons().then(setList); }, []);
  if (!list.length) return null;
  return (
    <View style={st.saved}>
      <Text style={st.sheetH}>Saved coupons</Text>
      {list.map((c) => (
        <View key={c.id} style={st.savedRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.capT}>{c.advertiser}</Text>
            {c.headline ? <Text style={st.introS} numberOfLines={1}>{c.headline}</Text> : null}
            {c.code ? <Text style={[st.codeT, { fontSize: 18 }]} selectable>{c.code}</Text> : null}
          </View>
          {c.pdf_url ? <Pressable onPress={() => Linking.openURL(c.pdf_url!).catch(() => {})}><Text style={st.link}>Flyer</Text></Pressable> : null}
          <Pressable onPress={async () => { await removeCoupon(c.id); setList(await savedCoupons()); }}><Text style={[st.link, { color: colors.alert }]}>Remove</Text></Pressable>
        </View>
      ))}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  pb: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  pill: { alignSelf: 'flex-start', backgroundColor: colors.panel, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  demoPb: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#E0A800', backgroundColor: '#E0A80022', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  demoBanner: { borderWidth: 2, borderStyle: 'dashed', borderColor: '#E0A800', backgroundColor: '#E0A8001A', borderRadius: 12, padding: 14, gap: 4, minHeight: 96, justifyContent: 'center' },
  demoT: { color: '#B88700', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  demoBig: { color: colors.text, fontSize: 16, fontWeight: '800' },
  demoS: { color: colors.muted, fontSize: 12 },
  pbT: { color: colors.muted, fontSize: 11 },
  pbLogo: { width: 20, height: 20 },
  pbName: { color: colors.text, fontSize: 11.5, fontWeight: '700' },
  banner: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.panelSolid },
  bannerMedia: { width: '100%', aspectRatio: 16 / 5, backgroundColor: colors.water },
  tag: { color: colors.muted, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 },
  cap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  capT: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
  cta: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  ctaT: { color: colors.accentInk, fontWeight: '800', fontSize: 12.5 },
  native: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  nativeBig: { flexDirection: 'column', gap: 14 },
  nativeLogo: { width: 48, height: 48, borderRadius: 10 },
  nativeLogoBig: { width: 140, height: 140, borderRadius: 28 },
  nativeT: { color: colors.text, fontSize: 15, fontWeight: '800' },
  nativeB: { color: colors.muted, fontSize: 13 },
  intro: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 100, padding: 24, paddingTop: 70 },
  introH: { color: colors.text, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  introS: { color: colors.muted, fontSize: 15, textAlign: 'center' },
  introMedia: { width: '100%', flex: 1, borderRadius: 14 },
  introName: { color: colors.text, fontSize: 20, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: colors.overlay },
  sheet: { backgroundColor: colors.panelSolid, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 34, gap: 12, borderTopWidth: 1, borderColor: colors.line },
  sheetH: { color: colors.text, fontSize: 20, fontWeight: '800' },
  code: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: 14, padding: 14, alignItems: 'center' },
  codeT: { color: colors.accent, fontSize: 28, fontWeight: '900', letterSpacing: 2 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  btnOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnT: { color: colors.text, fontWeight: '700', fontSize: 15 },
  saved: { borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 12, gap: 8, backgroundColor: colors.panelSolid },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderColor: colors.line, paddingTop: 8 },
  link: { color: colors.live, fontWeight: '700' },
}));
