import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { adPreviewOn, getAd, loadAdPreview, setCouponOpener, type Ad } from './src/ads/ads';
import { CouponSheet, SponsorIntro } from './src/ads/Sponsor';
import { loadActive } from './src/storage';
import { installCrashReporter, installFetchTimeout, setErrorScreen } from './src/errors';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { SafetyNotice } from './src/components/SafetyNotice';
import { Text } from 'react-native';
import { initAnalytics, setRemoteEnabled, setSignedIn, track } from './src/analytics';
import { loadConfig, needsUpdate, onConfig, refreshConfigIfStale, type AppConfig } from './src/appConfig';
import { supabase, supabaseReady } from './src/supabase';
import { AppState, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startShareUpdates } from './src/tracking'; // also registers the background tasks at startup
import { sharingActive } from './src/community/groupsApi';
import { ThemeProvider, colors, makeStyles, useTheme } from './src/theme';
import type { SavedSpot } from './src/storage';
import { TabBar, type Tab } from './src/components/TabBar';
import { MapScreen, type PickRequest } from './src/screens/MapScreen';
import { SpotsScreen } from './src/screens/SpotsScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { CommunityScreen } from './src/screens/CommunityScreen';
import { WeatherScreen, type WeatherPlace } from './src/screens/WeatherScreen';
import { setupGroupNotifications } from './src/community/groupPush';
import type { GroupNav } from './src/community/GroupsView';

// Keep the launch logo up until the first screen has drawn, then fade it out ourselves (never rely on auto-hide).
SplashScreen.preventAutoHideAsync().catch(() => {});

installCrashReporter();
installFetchTimeout();

export default function App() {
  return <ErrorBoundary><ThemeProvider><AppInner /></ThemeProvider></ErrorBoundary>;
}

function AppInner() {
  const st = useSt();
  const { palette } = useTheme();
  const [tab, setTab] = useState<Tab>('map');
  const [pick, setPick] = useState<PickRequest>(null);
  const [mySpots, setMySpots] = useState<SavedSpot[]>([]);
  const showOnMap = (lat: number, lon: number, name: string) => { setPick({ kind: 'spot', pt: { lat, lon, name } }); setTab('map'); track('screen_view', { screen: 'map' }); };
  const goToOnMap = (lat: number, lon: number, name: string) => { setPick({ kind: 'spot', pt: { lat, lon, name }, go: true }); setTab('map'); track('screen_view', { screen: 'map' }); };
  const groupNav: GroupNav = {
    onShowOnMap: showOnMap, onGoTo: goToOnMap,
    onShowRoute: (points, name) => { if (points.length) { setPick({ kind: 'spot', pt: { ...points[0], name }, route: points }); setTab('map'); } },
  };
  const [openGroup, setOpenGroup] = useState<{ id: string | null; at: number } | null>(null);
  // If I'm still sharing with a group (or on a float plan) after a restart, resume background updates.
  useEffect(() => { sharingActive().then((on) => { if (on) startShareUpdates(); }).catch(() => {}); }, []);
  // Tapping a group notification: "Come to me" → map with Go To running; invites/overdue → My groups.
  useEffect(() => setupGroupNotifications((o) => {
    if (o.type === 'goto') { goToOnMap(o.lat, o.lon, o.label); track('group_pin_open', { kind: o.kind, from: 'push' }); }
    else if (o.type === 'show') { showOnMap(o.lat, o.lon, o.label); track('group_pin_open', { kind: o.kind, from: 'push' }); }
    else { setOpenGroup({ id: o.groupId ?? null, at: Date.now() }); setTab('community'); }
  }), []);
  const [reloadKey, setReloadKey] = useState(0);
  const [intro, setIntro] = useState<Ad | null>(null);
  const [legalOk, setLegalOk] = useState(false);
  const [coupon, setCoupon] = useState<Ad | null>(null);
  useEffect(() => setCouponOpener(setCoupon), []);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [weatherAt, setWeatherAt] = useState<WeatherPlace | null>(null);
  const [wxMounted, setWxMounted] = useState(false);
  const showWeather = (lat: number, lon: number, label: string) => { setWeatherAt({ lat, lon, label, source: 'map' }); setWxMounted(true); setTab('weather'); track('screen_view', { screen: 'weather' }); };

  useEffect(() => {
    (async () => {
      const c = await loadConfig();
      setCfg(c);
      setRemoteEnabled(c.analytics_enabled);
      await initAnalytics();
      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      track('app_open', { stopped: !(pos?.coords.speed != null && pos.coords.speed > 1.5) });
      track('screen_view', { screen: 'map' });
    })();
    if (supabaseReady) {
      supabase.auth.getSession().then(({ data }: any) => setSignedIn(!!data.session));
      const { data } = supabase.auth.onAuthStateChange((_e: any, s: any) => setSignedIn(!!s));
      return () => data.subscription.unsubscribe();
    }
  }, []);
  // Pick up admin changes (maintenance message, off-switches) when the app comes back to the screen.
  useEffect(() => {
    const off = onConfig(setCfg);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refreshConfigIfStale(); });
    return () => { off(); sub.remove(); };
  }, []);
  const goTab = (t: Tab) => { if (t === 'weather') setWxMounted(true); setTab(t); setErrorScreen(t); track('screen_view', { screen: t }); };

  // 5-second sponsor intro at app open — only at the dock: not moving, not recording, not in the last 4 hours.
  useEffect(() => {
    if (!legalOk) return;   // never show a sponsor before the safety notice has been accepted
    (async () => {
      const preview = await loadAdPreview();
      const last = Number((await AsyncStorage.getItem('intro-at')) ?? '0');
      if (!preview && Date.now() - last < 4 * 3600000) return;
      if (await loadActive()) return;
      const pos = await Location.getLastKnownPositionAsync().catch(() => null);
      if (pos?.coords.speed != null && pos.coords.speed > 1.5) return;   // ~3 kt
      const c = await loadConfig();
      if (!adPreviewOn() && (!c.intro_enabled || !c.ads_enabled)) return;
      const ad = await getAd('sponsor_intro');
      if (!ad) return;
      if (!adPreviewOn()) await AsyncStorage.setItem('intro-at', String(Date.now()));
      setIntro(ad);
    })();
  }, [legalOk]);
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={palette.statusBar} />
      <View style={st.root} onLayout={() => { SplashScreen.hideAsync().catch(() => {}); }}>
        {cfg?.maintenance_message ? <Text style={st.notice}>{cfg.maintenance_message}</Text> : null}
        {cfg && needsUpdate(cfg) ? <Text style={st.notice}>A newer version of the app is available — please update from the App Store / Play Store.</Text> : null}
        <View style={st.body}>
          {/* The map stays mounted so GPS, navigation and track recording keep running on every tab. */}
          <View style={[StyleSheet.absoluteFill, tab !== 'map' && st.hidden]} pointerEvents={tab === 'map' ? 'auto' : 'none'}>
            <MapScreen pick={pick} clearPick={() => setPick(null)} onSpotsChanged={setMySpots} reloadKey={reloadKey} onWeather={showWeather} />
          </View>
          {/* Weather stays mounted after first visit so switching tabs doesn't refetch. */}
          {wxMounted ? <View style={[StyleSheet.absoluteFill, tab !== 'weather' && st.gone]} pointerEvents={tab === 'weather' ? 'auto' : 'none'}><WeatherScreen at={weatherAt} mySpots={mySpots} /></View> : null}
          {tab === 'spots' ? <View style={StyleSheet.absoluteFill}><SpotsScreen mySpots={mySpots} onPick={(p) => { setPick(p); setTab('map'); }} onImported={() => setReloadKey((k) => k + 1)} /></View> : null}
          {tab === 'community' ? <View style={StyleSheet.absoluteFill}><CommunityScreen onShowOnMap={showOnMap} groupNav={groupNav} openGroup={openGroup} /></View> : null}
          {tab === 'me' ? <View style={StyleSheet.absoluteFill}><ProfileScreen onShowOnMap={showOnMap} /></View> : null}
        </View>
        <TabBar tab={tab} setTab={goTab} />
        <SafetyNotice onAccepted={() => setLegalOk(true)} />
        {intro ? <SponsorIntro ad={intro} onDone={() => setIntro(null)} /> : null}
        <CouponSheet ad={coupon} onClose={() => setCoupon(null)} />
      </View>
    </SafeAreaProvider>
  );
}

const useSt = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  hidden: { opacity: 0 },
  gone: { display: 'none' },
  notice: { backgroundColor: colors.accent, color: colors.accentInk, fontWeight: '700', fontSize: 13, paddingHorizontal: 12, paddingVertical: 8, paddingTop: 48 },
}));
