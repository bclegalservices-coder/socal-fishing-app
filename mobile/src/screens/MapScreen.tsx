import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import { Camera, GeoJSONSource, Layer, LogManager, Map as MapView, Marker, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { API_URL, CHART_ATTRIBUTION, DEFAULT_CENTER, DEFAULT_ZOOM, CHART_TILE_SIZE, NOAA_CHART_MAXZOOM, NOAA_CHART_MINZOOM, noaaChartTiles } from '../config';
import { cardStyle, colors, makeStyles, setThemePosition, touch, useTheme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { bearingTrue, distanceNm, formatLatLon } from '../geo';
import { crossTrackNm, etaMinutes, SpeedEstimator, steerDelta, type Pt, type TrackPoint } from '../nav';
import * as store from '../storage';
import { getJSON } from '../api';
import { appendLocations, startTrack, stopTrack } from '../tracking';
import type { Conditions } from '../types';
import { Hud, type Fix } from '../components/Hud';
import { Compass, type Orientation } from '../components/Compass';
import { NavPanel } from '../components/NavPanel';
import { SpotCard } from '../components/SpotCard';
import { RouteDraft, RoutesList } from '../components/RoutePanel';
import { TracksPanel } from '../components/TracksPanel';
import { SearchSheet, type SearchHit } from '../components/SearchSheet';
import { BuoyCard } from '../components/BuoyCard';
import { Btn, IconButton, Row, Sheet, Title } from '../components/ui';
import { MapActions } from '../components/MapActions';
import { useCatalog } from '../layers/catalog';
import { MapLayers } from '../layers/MapLayers';
import { LayersSheet } from '../layers/LayersSheet';
import { TimeBar } from '../layers/TimeBar';
import { DEFAULT_LAYERS, type LayerState } from '../layers/state';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CatchMarkers, type Cluster } from '../components/CatchMap';
import { CatchBar } from '../components/CatchBar';
import { ClusterSheet } from '../components/ReportView';
import { BuddyMarkers } from '../components/Buddies';
import { loadCoordFormat } from '../coordPref';
import { HarborLayers, declutter, harborCard, useHarbors } from '../layers/Harbors';
import { harborsOf } from '../layers/catalog';
import { GroupPins } from '../components/GroupPins';
import { SendToGroupSheet } from '../community/SendToGroupSheet';
import { LogCatchSheet } from '../components/LogCatchSheet';
import { catchMap, syncQueue } from '../community/catchApi';
import * as groupsApi from '../community/groupsApi';
import { TIME_WINDOWS } from '../community/species';
import { supabaseReady } from '../supabase';
import { MpaBanner, RuleCard, RulesLayers } from '../components/Rules';
import { TodaySheet } from '../components/TodaySheet';
import { loadRules, protectedIndex, refreshRules, type RulesData } from '../offline/rules';
import { findContaining } from '../offline/pip';
import { autoRefresh, downloadArea } from '../offline/packs';
import { useNetwork } from '../offline/network';
import { grid as gridLayer } from '../layers/catalog';
import { setArea, track } from '../analytics';

const ARRIVE_NM = 0.1;
const LAYERS_KEY = 'layers:v2'; // v2: fresh start after the Oct 20 crash
const REGION_BBOX = '-123.5,30,-116,35'; // Point Conception to below Colonet, out past Cortes and Tanner Banks

// A chart square that fails to load (no signal offshore, or a blank square from NOAA) is normal on the water:
// the map just keeps the previous detail there. Log it quietly instead of raising a red error.
LogManager.onLog((e) => {
  if (/Failed to load tile/.test(e.message)) { console.log(`[map] ${e.message}`); return true; }
  return false;
});

// The NOAA chart is the bottom layer of the map style itself, so everything else (water temp, breaks, spots, MPAs)
// always draws on top of it. Changing chart details or night mode rebuilds the style; the map then re-adds the
// other layers in their normal order. (Oct 20: "slot" placeholder layers + beforeId crashed MapLibre on iOS.)
function buildMapStyle(chartUrl: string) {
  return {
    version: 8,
    sources: {
      noaa: { type: 'raster', tiles: [chartUrl], tileSize: CHART_TILE_SIZE, minzoom: NOAA_CHART_MINZOOM, maxzoom: NOAA_CHART_MAXZOOM, attribution: CHART_ATTRIBUTION },
    },
    layers: [
      { id: 'water', type: 'background', paint: { 'background-color': colors.water } },
      { id: 'noaa-chart', type: 'raster', source: 'noaa', paint: { 'raster-fade-duration': 100 } },
    ],
  };
}

type Nav = { points: Pt[]; leg: number; legStart: Pt; name: string };
type Selected = { kind: 'spot' | 'pin' | 'saved'; pt: Pt & { subtitle?: string; id?: string; saveName?: string } } | null;
type Panel = 'none' | 'routes' | 'tracks' | 'layers' | 'search' | 'actions';
export type PickRequest = { kind: 'spot' | 'saved'; pt: Pt & { subtitle?: string; id?: string }; go?: boolean; route?: Pt[] } | null;

const fc = (features: any[]) => ({ type: 'FeatureCollection' as const, features });
const pointF = (p: Pt, props: Record<string, unknown> = {}) => ({ type: 'Feature' as const, properties: props, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } });
const lineF = (pts: (Pt | TrackPoint)[]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: pts.map((p) => [p.lon, p.lat]) } });

function StayAwake() { useKeepAwake(); return null; }

export function MapScreen({ pick, clearPick, onSpotsChanged, reloadKey = 0, onWeather }: { pick: PickRequest; clearPick: () => void; onSpotsChanged?: (s: store.SavedSpot[]) => void; reloadKey?: number; onWeather?: (lat: number, lon: number, label: string) => void }) {
  const st = useSt();
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const est = useRef(new SpeedEstimator());
  const featurePressAt = useRef(0);
  const [fix, setFix] = useState<Fix | null>(null);
  const [motion, setMotion] = useState<{ sogKt: number | null; cogT: number | null }>({ sogKt: null, cogT: null });
  const [heading, setHeading] = useState<number | null>(null);
  const [status, setStatus] = useState('Waiting for GPS…');
  const [orient, setOrient] = useState<Orientation>('north');
  const [publicSpots, setPublicSpots] = useState<any>(fc([]));
  const [mySpots, setMySpots] = useState<store.SavedSpot[]>([]);
  const [routes, setRoutes] = useState<store.Route[]>([]);
  const [tracks, setTracks] = useState<store.TrackMeta[]>([]);
  const [active, setActive] = useState<store.ActiveTrack | null>(null);
  const [sel, setSel] = useState<Selected>(null);
  const [buoy, setBuoy] = useState<any | null>(null);
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [nav, setNav] = useState<Nav | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [shownLine, setShownLine] = useState<(Pt | TrackPoint)[] | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const chartUrl = useMemo(() => noaaChartTiles({ ...DEFAULT_LAYERS.chart, ...layers.chart }, theme.mode === 'night'), [layers.chart, theme.mode]);
  const mapStyle = useMemo(() => buildMapStyle(chartUrl), [chartUrl]);
  // 3D view (Map options): tip the camera back; flat again when switched off.
  useEffect(() => { camera.current?.setStop({ pitch: layers.tilt ? 55 : 0, duration: 600 }).catch(() => {}); }, [layers.tilt]);
  const [compareOffset, setCompareOffset] = useState<number | null>(null);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [probe, setProbe] = useState(false);
  // Catch and water-temp filters stay folded into small pills until tapped, so the chart stays clear.
  const [openBar, setOpenBar] = useState<'catch' | 'time' | null>(null);
  const [probeAt, setProbeAt] = useState<Pt | null>(null);
  const [probeData, setProbeData] = useState<Conditions | null>(null);
  const { catalog, cached: catalogCached } = useCatalog();
  const harborFc = useHarbors(harborsOf(catalog));
  const [view, setView] = useState<{ minLon: number; minLat: number; maxLon: number; maxLat: number; zoom: number; heading: number } | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [catchHours, setCatchHours] = useState(24);
  const [catchSpecies, setCatchSpecies] = useState<string | null>(null);
  const [catchStatus, setCatchStatus] = useState('Catch reports');
  const [clusterSel, setClusterSel] = useState<Cluster | null>(null);
  const [logAt, setLogAt] = useState<Pt | null>(null);
  const [buddyList, setBuddyList] = useState<groupsApi.Buddy[]>([]);
  const [groupPins, setGroupPins] = useState<groupsApi.Pin[]>([]);
  const [crew, setCrew] = useState<{ mode: 'me' | 'spot'; pt: (Pt & { name?: string }) | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rules, setRules] = useState<RulesData | null>(null);
  const [ruleSel, setRuleSel] = useState<any | null>(null);
  const [mpaHere, setMpaHere] = useState<any[]>([]);
  const [mpaDismissed, setMpaDismissed] = useState<string | null>(null);
  const [today, setToday] = useState(false);
  const net = useNetwork();
  const protectedIdx = useMemo(() => protectedIndex(rules), [rules]);
  const insideAt = (p: Pt) => findContaining(protectedIdx, p.lat, p.lon);
  const activeRef = useRef(active); activeRef.current = active;

  // ---- saved data and layer settings (on the phone, offline-safe) ----
  useEffect(() => {
    (async () => {
      const spots = await store.loadSpots();
      setMySpots(spots); onSpotsChanged?.(spots);
      setRoutes(await store.loadRoutes());
      setTracks(await store.loadTracks());
      setActive(await store.loadActive());
      // Crash guard: if the last start never got past the first 30 seconds, start with default layers.
      let safeStart = false;
      try { safeStart = (await AsyncStorage.getItem('boot:v1')) === 'starting'; await AsyncStorage.setItem('boot:v1', 'starting'); } catch {}
      setTimeout(() => { AsyncStorage.setItem('boot:v1', 'ok').catch(() => {}); }, 30000);
      if (safeStart) setToast('The map had a problem last time, so your map layers were reset.');
      try { const l = safeStart ? null : await AsyncStorage.getItem(LAYERS_KEY); if (l) { const p = JSON.parse(l); setLayers({ ...DEFAULT_LAYERS, ...p, on: { ...DEFAULT_LAYERS.on, ...p.on }, opacity: { ...DEFAULT_LAYERS.opacity, ...p.opacity }, chart: { ...DEFAULT_LAYERS.chart, ...p.chart } }); } } catch {}
      loadCoordFormat();
      const cachedSpots = await store.loadPublicSpots();
      if (cachedSpots) setPublicSpots(cachedSpots);
      if (!API_URL) return;
      try {
        const r = await fetch(`${API_URL}/spots?bbox=${REGION_BBOX}`);
        if (r.ok) { const j = await r.json(); setPublicSpots(j); store.savePublicSpots(j); }
      } catch { /* offline */ }
    })();
  }, []);
  const prevOn = useRef(layers.on);
  useEffect(() => {
    AsyncStorage.setItem(LAYERS_KEY, JSON.stringify(layers)).catch(() => {});
    (Object.keys(layers.on) as (keyof typeof layers.on)[]).forEach((k) => { if (layers.on[k] && !prevOn.current[k]) track('layer_on', { layer: k }); });
    prevOn.current = layers.on;
  }, [layers]);
  useEffect(() => {
    if (!reloadKey) return;
    (async () => { const sp = await store.loadSpots(); setMySpots(sp); onSpotsChanged?.(sp); setRoutes(await store.loadRoutes()); setTracks(await store.loadTracks()); })();
  }, [reloadKey]);

  // ---- rules data from the phone, and automatic offline refresh (app open + every 3 h) ----
  // MPA boundaries: the saved copy first; if there is none yet, download them (our server, or CDFW directly).
  useEffect(() => { loadRules().then((r) => { if (r) setRules(r); else refreshRules().then(setRules).catch(() => {}); }); }, []);
  // MPA alert silencing: 'leave' = until you leave the area(s) you're in; otherwise a time.
  const [mpaSilence, setMpaSilence] = useState<{ until: number; key: string | null }>({ until: 0, key: null });
  useEffect(() => { AsyncStorage.getItem('mpa-silence:v1').then((s) => s && setMpaSilence(JSON.parse(s))).catch(() => {}); }, []);
  const silenceMpa = (how: 'leave' | 'hour' | 'today') => {
    const key = mpaHere.map((f) => f.properties?.name).join('|');
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const v = how === 'leave' ? { until: 0, key } : { until: how === 'hour' ? Date.now() + 3600000 : end.getTime(), key: null };
    setMpaSilence(v); AsyncStorage.setItem('mpa-silence:v1', JSON.stringify(v)).catch(() => {}); track('mpa_alert_silenced', { how });
  };
  const mpaKey = mpaHere.map((f) => f.properties?.name).join('|');
  const mpaSilenced = (!!mpaSilence.key && mpaSilence.key === mpaKey) || mpaSilence.until > Date.now();
  useEffect(() => {
    if (!catalog) return;
    const run = () => autoRefresh(catalog).then(() => loadRules().then((r) => r && setRules(r))).catch(() => {});
    run();
    const t = setInterval(run, 3 * 3600000);
    return () => clearInterval(t);
  }, [!!catalog]);

  // ---- Today: open once a day automatically when the app starts at the dock ----
  useEffect(() => {
    const t = setTimeout(async () => {
      const d = new Date().toISOString().slice(0, 10);
      if ((await AsyncStorage.getItem('today-shown')) === d) return;
      if (motion.sogKt != null && motion.sogKt > 3) return;
      await AsyncStorage.setItem('today-shown', d);
      setToday(true); track('screen_view', { screen: 'today' });
    }, 2500);
    return () => clearTimeout(t);
  }, []);

  // ---- requests from other tabs (e.g. tap a spot in the Spots list) ----
  useEffect(() => {
    if (!pick) return;
    setPanel('none'); setCrew(null);
    if (pick.go) startNav([pick.pt], pick.pt.name ?? 'Buddy');           // e.g. tapped a "Come to me" notification
    else if (pick.route?.length) { setSel(null); setShownLine(pick.route); fitTo(pick.route); }
    else setSel(pick);
    if (!pick.route?.length) camera.current?.setStop({ center: [pick.pt.lon, pick.pt.lat], zoom: 11, duration: 700 });
    clearPick();
  }, [pick]);

  // ---- GPS, speed and compass ----
  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    let hsub: Location.LocationSubscription | undefined;
    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (perm !== 'granted') { setStatus('Location off — map still works'); return; }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (p) => {
          const f: Fix = { lat: p.coords.latitude, lon: p.coords.longitude, speed: p.coords.speed, heading: p.coords.heading, accuracy: p.coords.accuracy, time: p.timestamp };
          setFix(f);
          setMotion(est.current.update(f));
          setArea(f.lat, f.lon);
          if (activeRef.current?.mode === 'foreground') appendLocations([p]);
        },
      );
      try { hsub = await Location.watchHeadingAsync((h) => setHeading(h.trueHeading >= 0 ? h.trueHeading : h.magHeading)); } catch {}
    })();
    return () => { sub?.remove(); hsub?.remove(); };
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => setActive(await store.loadActive()), 5000);
    return () => clearInterval(t);
  }, [active?.id]);

  // ---- MPA alert: checked on the phone for every GPS fix (works with no signal) ----
  useEffect(() => {
    if (!fix || !protectedIdx.length) return;
    const inside = findContaining(protectedIdx, fix.lat, fix.lon);
    const key = inside.map((f) => f.properties?.name).join('|');
    const prev = mpaHere.map((f) => f.properties?.name).join('|');
    if (key !== prev) {
      const timeSilenced = mpaSilence.until > Date.now();
      if (inside.length && !timeSilenced) { Vibration.vibrate([0, 300, 150, 300, 150, 300]); track('mpa_alert_shown', { no_take: inside.some((x) => x.properties?.take === 'no_take') }); }
      setMpaHere(inside);
      if (!inside.length) { setMpaDismissed(null); if (mpaSilence.key) { setMpaSilence({ until: mpaSilence.until, key: null }); AsyncStorage.setItem('mpa-silence:v1', JSON.stringify({ until: mpaSilence.until, key: null })).catch(() => {}); } }
    }
  }, [fix?.time, protectedIdx]);

  // ---- arrival alarm + auto-advance ----
  useEffect(() => {
    if (!fix || !nav) return;
    const tgt = nav.points[nav.leg];
    if (distanceNm(fix.lat, fix.lon, tgt.lat, tgt.lon) > ARRIVE_NM) return;
    Vibration.vibrate([0, 400, 200, 400]);
    if (nav.leg < nav.points.length - 1) setNav({ ...nav, leg: nav.leg + 1, legStart: tgt });
    else { setNav(null); setArrived(tgt.name ?? 'your waypoint'); track('go_to_arrived'); }
  }, [fix]);

  // ---- probe: light conditions under the crosshair, after the map stops moving ----
  useEffect(() => {
    if (!probe || !probeAt) return;
    const t = setTimeout(async () => {
      try {
        const r = await getJSON<Conditions>(`/conditions?lat=${probeAt.lat.toFixed(4)}&lon=${probeAt.lon.toFixed(4)}&fields=water,depth`, { timeoutMs: 8000 });
        setProbeData(r.data);
      } catch { setProbeData(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [probe, probeAt?.lat, probeAt?.lon]);

  // ---- Catch Map clusters for the visible area ----
  useEffect(() => {
    if (!layers.on.catches || !view || !supabaseReady) { setClusters([]); return; }
    const t = setTimeout(async () => {
      try {
        const c = await catchMap(view, view.zoom, catchHours, catchSpecies ? [catchSpecies] : null);
        setClusters(c);
        const reports = c.reduce((a, x) => a + Number(x.n), 0);
        const label = TIME_WINDOWS.find((w) => w.h === catchHours)?.label ?? `${catchHours} h`;
        setCatchStatus(`${reports} catch report${reports === 1 ? '' : 's'} in view · last ${label}`);
      } catch { setCatchStatus('Catch reports need signal'); }
    }, 450);
    return () => clearTimeout(t);
  }, [layers.on.catches, view?.minLon, view?.minLat, view?.maxLon, view?.maxLat, view?.zoom, catchHours, catchSpecies]);

  // ---- send catches saved offline, every 2 minutes ----
  useEffect(() => {
    const run = () => syncQueue().then((r) => { if (r.sent) setToast(`${r.sent} saved catch${r.sent === 1 ? '' : 'es'} sent`); }).catch(() => {});
    run();
    const t = setInterval(run, 120000);
    return () => clearInterval(t);
  }, []);

  // ---- buddy boats: refresh every 30 s while the layer is on ----
  useEffect(() => {
    if (!layers.on.buddies || !supabaseReady) { setBuddyList([]); setGroupPins([]); return; }
    const load = () => {
      groupsApi.buddies().then(setBuddyList).catch(() => {});
      groupsApi.pins(24).then(setGroupPins).catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [layers.on.buddies]);

  // ---- share my position with my groups (only while sharing is on; throttled inside) ----
  useEffect(() => {
    if (fix && supabaseReady) groupsApi.publishPosition({ lat: fix.lat, lon: fix.lon, sog: motion.sogKt, cog: motion.cogT, acc: fix.accuracy }).catch(() => {});
  }, [fix?.time]);

  useEffect(() => { if (fix) setThemePosition(fix.lat, fix.lon); }, [fix ? Math.round(fix.lat * 10) : null, fix ? Math.round(fix.lon * 10) : null]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);

  const nearestPublicSpot = (p: Pt) => {
    let best: { id: string; name: string } | null = null, bd = 3;
    for (const f of publicSpots?.features ?? []) {
      const d = distanceNm(p.lat, p.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]);
      if (d < bd) { bd = d; best = { id: f.properties.id, name: f.properties.name }; }
    }
    return best;
  };
  const openLog = (p?: Pt | null) => {
    const at = p ?? here();
    if (!at) { Alert.alert('Waiting for GPS', 'Long-press where you caught it, then tap "Log a catch here".'); return; }
    const noTake = insideAt(at).find((f) => f.properties?.take === 'no_take');
    const go = () => { setSel(null); setPanel('none'); setLogAt(at); };
    if (noTake) Alert.alert('Inside a no-take area', `${noTake.properties?.name}: ${noTake.properties?.rule}\n\nLog anyway (e.g. a catch-and-release record)?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Log anyway', onPress: go }]);
    else go();
  };
  const saveArea = () => {
    if (!view) return;
    const name = `${view.minLat.toFixed(2)},${view.minLon.toFixed(2)}`;
    const extra = [gridLayer(catalog, 'bathy')?.dates?.[0]?.tiles].filter(Boolean) as string[];
    setPanel('none'); setToast('Saving this area for offline use…'); track('offline_area_saved');
    downloadArea(name, [view.maxLon, view.maxLat], [view.minLon, view.minLat], extra, (pct) => { if (pct >= 100) setToast('Area saved for offline use'); })
      .catch((e) => setToast(`Area not saved: ${e?.message ?? e}`));
  };

  const navInfo = useMemo(() => {
    if (!nav) return null;
    const tgt = nav.points[nav.leg];
    if (!fix) return { tgt, dist: null, brg: null, xte: null, steer: null, eta: null };
    const dist = distanceNm(fix.lat, fix.lon, tgt.lat, tgt.lon);
    const brg = bearingTrue(fix.lat, fix.lon, tgt.lat, tgt.lon);
    return { tgt, dist, brg, xte: crossTrackNm(nav.legStart, tgt, fix), steer: motion.cogT != null ? steerDelta(motion.cogT, brg) : null, eta: etaMinutes(dist, motion.sogKt) };
  }, [nav, fix, motion]);

  // ---- actions ----
  const here = (): Pt | null => (fix ? { lat: fix.lat, lon: fix.lon } : null);
  const startNav = (points: Pt[], name: string) => {
    if (!points.length) return;
    setNav({ points, leg: 0, legStart: here() ?? points[0], name });
    track('go_to_start', { legs: points.length });
    setSel(null); setDraft(null); setPanel('none'); setArrived(null); setProbe(false);
    if (!fix) Alert.alert('Waiting for GPS', 'Distance and bearing appear as soon as your position is found.');
  };
  const saveSpots = async (next: store.SavedSpot[]) => { setMySpots(next); onSpotsChanged?.(next); await store.saveSpots(next); };
  const addToRoute = (p: Pt) => { setDraft((d) => [...(d ?? []), p]); setSel(null); setPanel('none'); };
  const saveSpot = async (p: Pt) => {
    const noTake = insideAt(p).find((f) => f.properties?.take === 'no_take');
    track('spot_saved');
    if (noTake) Alert.alert('Heads up', `This spot is inside ${noTake.properties?.name} (no take). Saved anyway.`);
    const saveName = (sel?.pt as any)?.saveName as string | undefined;          // e.g. "Kelp paddy (from Mike)"
    await saveSpots([...mySpots, { id: store.newId(), name: saveName ?? (p.name && sel?.kind !== 'pin' ? `${p.name} (mine)` : `My spot ${mySpots.length + 1}`),
      lat: p.lat, lon: p.lon, createdAt: Date.now(), ...(saveName ? { folder: 'From my groups' } : {}) }]);
    if (saveName) setToast(`Saved "${saveName}" to My spots — works offline.`);
    setSel(null);
  };
  const deleteSpot = async (id?: string) => { await saveSpots(mySpots.filter((s) => s.id !== id)); setSel(null); };
  const saveDraft = async () => {
    if (!draft || draft.length < 2) return;
    const next = [{ id: store.newId(), name: `Route ${routes.length + 1}`, points: draft, createdAt: Date.now() }, ...routes];
    setRoutes(next); await store.saveRoutes(next); setDraft(null); setPanel('routes'); track('route_saved', { legs: draft.length - 1 });
  };
  const fitTo = (pts: (Pt | TrackPoint)[]) => {
    if (pts.length < 2) return;
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    camera.current?.fitBounds([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
      { padding: { top: 80, right: 80, bottom: 80, left: 80 }, duration: 600 });
  };
  const toggleTrack = async () => {
    try {
      if (active) {
        const meta = await stopTrack(); setActive(null);
        if (meta) { setTracks(await store.loadTracks()); track('track_saved'); } else Alert.alert('Track not saved', 'It was too short to save.');
      } else {
        const mode = await startTrack(); setActive(await store.loadActive()); track('track_started', { background: mode === 'background' });
        if (mode === 'foreground') Alert.alert('Recording while the app is open', 'To keep recording with the screen off, set Location to "Always" for this app in Settings.');
      }
    } catch (e: any) { Alert.alert('Could not record', e?.message ?? String(e)); }
  };
  const cycleOrient = () => {
    const next: Orientation = orient === 'north' ? 'heading' : orient === 'heading' ? 'course' : 'north';
    setOrient(next);
    if (next === 'north') camera.current?.setStop({ bearing: 0, duration: 300 });
  };
  const recenter = () => { if (fix) camera.current?.setStop({ center: [fix.lon, fix.lat], zoom: 11, duration: 600, easing: 'ease' }); };
  const onSearchPick = (h: SearchHit) => {
    setPanel('none'); track('search_pick', { kind: h.kind });
    setSel({ kind: h.kind, pt: { lat: h.lat, lon: h.lon, name: h.name, subtitle: h.sub, id: h.id } });
    camera.current?.setStop({ center: [h.lon, h.lat], zoom: 11, duration: 700 });
  };

  // ---- map presses ----
  const coordOf = (f: any): Pt => ({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
  // MapLibre v11 press events carry the tapped position in nativeEvent.lngLat ([lon, lat]).
  const lngLatOf = (e: any): Pt => ({ lon: e.nativeEvent.lngLat[0], lat: e.nativeEvent.lngLat[1] });
  const onMapPress = (e: any) => {
    if (Date.now() - featurePressAt.current < 350) return;
    if (draft) { setDraft([...draft, lngLatOf(e)]); return; }
    setSel(null); setBuoy(null); setClusterSel(null); setRuleSel(null);
  };
  const onLongPress = (e: any) => {
    if (draft) { setDraft([...draft, lngLatOf(e)]); return; }
    setPanel('none'); setBuoy(null); setSel({ kind: 'pin', pt: lngLatOf(e) }); track('pin_dropped');
  };
  const onSpotPress = (e: any, kind: 'spot' | 'saved') => {
    const f = e?.nativeEvent?.features?.[0]; if (!f) return;
    e.stopPropagation?.();
    featurePressAt.current = Date.now();
    const p = { ...coordOf(f), name: f.properties?.name, subtitle: f.properties?.subtitle, id: f.properties?.id };
    if (draft) { setDraft([...draft, p]); return; }
    setPanel('none'); setBuoy(null); setSel({ kind, pt: p });
  };

  // ---- map data ----
  // Spot names appear once you zoom in (like a chartplotter), at most 60 at a time so the map stays fast and clean.
  const spotLabels = useMemo(() => {
    if (!view || view.zoom < 10.3 || !layers.on.spots) return [];
    const out: any[] = [];
    for (const f of publicSpots?.features ?? []) {
      const [lon, lat] = f.geometry?.coordinates ?? [];
      if (lon >= view.minLon && lon <= view.maxLon && lat >= view.minLat && lat <= view.maxLat) out.push(f);
    }
    return declutter(out, view.zoom, 40);
  }, [publicSpots, view, layers.on.spots]);
  const mySpotsFC = useMemo(() => fc(mySpots.map((s) => pointF(s, { id: s.id, name: s.name, subtitle: 'Private — only you' }))), [mySpots]);
  const pinFC = useMemo(() => fc(sel?.kind === 'pin' ? [pointF(sel.pt)] : []), [sel]);
  const draftFC = useMemo(() => fc(draft && draft.length ? [...(draft.length > 1 ? [lineF(draft)] : []), ...draft.map((p) => pointF(p))] : []), [draft]);
  const navFC = useMemo(() => (!nav || !fix ? fc([]) : fc([lineF([{ lat: fix.lat, lon: fix.lon }, ...nav.points.slice(nav.leg)]), ...nav.points.slice(nav.leg).map((p) => pointF(p))])), [nav, fix]);
  const activeFC = useMemo(() => fc(active && active.points.length > 1 ? [lineF(active.points)] : []), [active]);
  const shownFC = useMemo(() => fc(shownLine && shownLine.length > 1 ? [lineF(shownLine)] : []), [shownLine]);

  // ---- bottom area ----
  let bottom: ReactNode = null;
  if (crew) {
    bottom = <SendToGroupSheet mode={crew.mode} pt={crew.mode === 'me' ? here() : crew.pt} onClose={() => setCrew(null)}
      onDone={(m) => { setCrew(null); setToast(m); }} />;
  } else if (panel === 'actions') {
    const h = here();
    bottom = <MapActions onClose={() => setPanel('none')} actions={[
      { key: 'log', label: 'Log a catch', sub: 'At your position', icon: 'fish', tint: colors.accent, onPress: () => openLog(null) },
      { key: 'save', label: 'Save this spot', sub: h ? 'Where the boat is now' : 'Waiting for GPS', icon: 'bookmark', onPress: () => { if (h) saveSpot({ ...h, name: undefined } as any); else Alert.alert('Waiting for GPS', 'Long-press the map to save any other spot.'); } },
      { key: 'crew', label: 'Send to my crew', sub: 'Come to me / my position', icon: 'megaphone', tint: colors.buddy, hidden: !supabaseReady, onPress: () => { setSel(null); setCrew({ mode: 'me', pt: null }); } },
      { key: 'route', label: 'Routes', sub: `${routes.length} saved · plan a new one`, icon: 'git-commit', onPress: () => setPanel('routes') },
      { key: 'track', label: active ? 'Recording…' : 'Record a trip', sub: active ? 'Tap to stop and save' : `${tracks.length} saved trips`, icon: active ? 'stop-circle' : 'radio-button-on', tint: colors.alert, active: !!active, onPress: () => setPanel('tracks') },
      { key: 'probe', label: probe ? 'Stop reading' : 'Read conditions', sub: 'Water temp & depth under the crosshair', icon: 'scan', onPress: () => { if (!probe) track('probe_used'); setProbe(!probe); setProbeData(null); } },
      { key: 'today', label: "Today's report", sub: "What's biting, water, warnings", icon: 'newspaper', tint: colors.ok, onPress: () => { setToday(true); track('screen_view', { screen: 'today' }); } },
      { key: 'wx', label: 'Weather here', sub: '5-day forecast for your boat', icon: 'partly-sunny', tint: colors.warn, hidden: !onWeather, onPress: () => { const p = here(); if (p && onWeather) onWeather(p.lat, p.lon, 'My position'); else if (onWeather) onWeather(33.585, -117.885, 'Off Newport'); } },
    ]} />;
  } else if (nav && navInfo) {
    bottom = <NavPanel target={navInfo.tgt.name ?? (nav.points.length > 1 ? `Waypoint ${nav.leg + 1}` : 'Waypoint')}
      legLabel={nav.points.length > 1 ? `Leg ${nav.leg + 1} of ${nav.points.length}` : null}
      distNm={navInfo.dist} brg={navInfo.brg} cog={motion.cogT} sog={motion.sogKt} etaMin={navInfo.eta} xteNm={navInfo.xte} steer={navInfo.steer}
      onEnd={() => setNav(null)}
      onSkip={nav.leg < nav.points.length - 1 ? () => setNav({ ...nav, leg: nav.leg + 1, legStart: here() ?? nav.points[nav.leg] }) : undefined} />;
  } else if (draft) {
    bottom = <RouteDraft points={draft} sogKt={motion.sogKt} onUndo={() => setDraft(draft.slice(0, -1))} onSave={saveDraft}
      onGo={() => startNav(draft, 'Route')} onCancel={() => setDraft(null)} />;
  } else if (ruleSel) {
    bottom = <RuleCard p={ruleSel} checkedAt={rules?.checked_at ?? null} onClose={() => setRuleSel(null)} />;
  } else if (clusterSel) {
    bottom = <ClusterSheet c={clusterSel} hours={catchHours} onClose={() => setClusterSel(null)} />;
  } else if (buoy) {
    bottom = <BuoyCard p={buoy} onClose={() => setBuoy(null)} />;
  } else if (sel) {
    bottom = <SpotCard spot={sel.pt} boat={here()} kind={sel.kind}
      onGo={() => startNav([sel.pt], sel.pt.name ?? 'Dropped pin')} onAddToRoute={() => addToRoute(sel.pt)}
      onSave={sel.kind !== 'saved' ? () => saveSpot(sel.pt) : undefined}
      onDelete={sel.kind === 'saved' ? () => deleteSpot(sel.pt.id) : undefined} onClose={() => setSel(null)}
      onLog={() => openLog(sel.kind === 'pin' ? sel.pt : here() ?? sel.pt)} protectedHere={insideAt(sel.pt)}
      onWeather={onWeather ? () => onWeather(sel.pt.lat, sel.pt.lon, sel.pt.name ?? 'Dropped pin') : undefined}
      onShareToGroup={supabaseReady ? () => { setCrew({ mode: 'spot', pt: { lat: sel.pt.lat, lon: sel.pt.lon, name: sel.pt.name } }); setSel(null); } : undefined} />;
  } else if (panel === 'routes') {
    bottom = <RoutesList routes={routes}
      onNew={() => { setPanel('none'); setDraft(here() ? [{ ...here()!, name: 'Start' }] : []); }}
      onGo={(r) => startNav(r.points, r.name)} onShow={(r) => { setShownLine(r.points); fitTo(r.points); }}
      onDelete={async (r) => { const next = routes.filter((x) => x.id !== r.id); setRoutes(next); await store.saveRoutes(next); }}
      onClose={() => setPanel('none')} />;
  } else if (panel === 'tracks') {
    bottom = <TracksPanel active={active} activePts={active?.points ?? []} tracks={tracks} onStart={toggleTrack} onStop={toggleTrack}
      onShow={async (t) => { const pts = await store.loadTrackPoints(t.id); setShownLine(pts); fitTo(pts); setPanel('none'); }}
      onDelete={async (t) => { const next = tracks.filter((x) => x.id !== t.id); setTracks(next); await store.saveTracks(next); await store.deleteTrackPoints(t.id); }}
      onClose={() => setPanel('none')} />;
  } else if (arrived) {
    bottom = <Sheet><Title>Arrived at {arrived}</Title><Row><Btn label="OK" kind="primary" onPress={() => setArrived(null)} /></Row></Sheet>;
  } else {
    const showTime = (layers.on.sst || layers.on.chl) && !probe;
    bottom = (
      <View style={{ padding: 10, gap: 8 }} pointerEvents="box-none">
        {openBar === 'catch' && layers.on.catches && !probe ? (
          <View>
            <CatchBar hours={catchHours} setHours={setCatchHours} species={catchSpecies} setSpecies={setCatchSpecies} status={catchStatus} />
            <Pressable style={st.barDone} onPress={() => setOpenBar(null)} accessibilityRole="button" accessibilityLabel="Close catch filter"><Text style={st.barDoneT}>Done</Text></Pressable>
          </View>
        ) : null}
        {openBar === 'time' && showTime ? (
          <View>
            <TimeBar catalog={catalog} s={layers} setDay={(i) => setLayers((p) => ({ ...p, dayIndex: i }))} compare={setCompareOffset} compareOffset={compareOffset} />
            <Pressable style={st.barDone} onPress={() => setOpenBar(null)} accessibilityRole="button" accessibilityLabel="Close water layer dates"><Text style={st.barDoneT}>Done</Text></Pressable>
          </View>
        ) : null}
        <View style={st.controls} pointerEvents="box-none">
          <View style={{ gap: 6, alignItems: 'flex-start' }} pointerEvents="box-none">
            {!openBar && layers.on.catches && !probe ? (
              <Pressable style={st.pill} onPress={() => setOpenBar('catch')} accessibilityRole="button" accessibilityLabel="Catch reports filter">
                <Ionicons name="fish" size={15} color={colors.accent} />
                <Text style={st.pillT}>Catches · {TIME_WINDOWS.find((w) => w.h === catchHours)?.label ?? `${catchHours} h`} · {catchSpecies ?? 'All'}</Text>
                <Ionicons name="chevron-up" size={14} color={colors.muted} />
              </Pressable>
            ) : null}
            {!openBar && showTime ? (
              <Pressable style={st.pill} onPress={() => setOpenBar('time')} accessibilityRole="button" accessibilityLabel="Water layer date">
                <Ionicons name="thermometer" size={15} color={colors.live} />
                <Text style={st.pillT}>{layers.on.sst ? 'Water temp' : 'Water color'} · {layers.dayIndex ? 'past day' : 'latest'}</Text>
                <Ionicons name="chevron-up" size={14} color={colors.muted} />
              </Pressable>
            ) : null}
            {shownLine ? <Pressable style={st.chip} onPress={() => setShownLine(null)} accessibilityRole="button"><Text style={st.chipT}>Hide line ✕</Text></Pressable> : null}
            {active ? <Pressable style={[st.chip, { borderColor: colors.alert }]} onPress={() => setPanel('tracks')} accessibilityRole="button"><Text style={[st.chipT, { color: colors.alert }]}>● Recording trip</Text></Pressable> : null}
            <Text style={st.disclaimer}>NOAA chart · not for navigation</Text>
          </View>
          <Pressable style={({ pressed }) => [st.plus, pressed && { opacity: 0.8 }]} onPress={() => { setSel(null); setPanel('actions'); }} accessibilityRole="button" accessibilityLabel="Actions: log a catch, save spot, crew, routes, record, conditions, report, weather">
            <Ionicons name="add" size={34} color={colors.accentInk} />
          </Pressable>
        </View>
      </View>
    );
  }



  return (
    <View style={st.root}>
      {nav || active ? <StayAwake /> : null}
      <MapView style={StyleSheet.absoluteFill} mapStyle={mapStyle as any} attribution logo={false} compass={false}
        onPress={onMapPress} onLongPress={onLongPress}
        onRegionDidChange={(e: any) => {
          const v = e?.nativeEvent; if (!v) return;
          if (probe && v.center) setProbeAt({ lon: v.center[0], lat: v.center[1] });
          const b = v.bounds; // [west, south, east, north]
          if (b) setView({ maxLon: b[2], maxLat: b[3], minLon: b[0], minLat: b[1], zoom: v.zoom ?? 9, heading: v.bearing ?? 0 });
        }}>
        <Camera ref={camera} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }}
          trackUserLocation={orient === 'heading' ? 'heading' : orient === 'course' ? 'course' : undefined}
          onTrackUserLocationChange={(e: any) => { if (e?.nativeEvent?.trackUserLocation == null && orient !== 'north') setOrient('north'); }} />
        <MapLayers catalog={catalog} s={layers} compareOffset={compareOffset} radarPlaying={radarPlaying} onBuoyPress={(p) => { featurePressAt.current = Date.now(); setSel(null); setBuoy(p); }} />
        {/* MPAs on top of every overlay so they're never hidden under relief or satellite */}
        <RulesLayers data={rules} showProtected={layers.on.rules} showHazards={layers.on.hazards}
          onPress={(p, geom) => { featurePressAt.current = Date.now(); setSel(null); setClusterSel(null); setRuleSel({ ...p, geom }); }} />
        <UserLocation heading />
        {layers.on.catches ? <CatchMarkers clusters={clusters} windowHours={catchHours} onPress={(c) => { setSel(null); setBuoy(null); setClusterSel(c); track('cluster_open', { species: c.species_code }); }} /> : null}
        {layers.on.buddies ? <BuddyMarkers buddies={buddyList} rotation={view?.heading ?? 0}
          onPress={(b) => { setClusterSel(null); setSel({ kind: 'spot', pt: { lat: b.lat, lon: b.lon, name: b.boat_name ?? b.display_name ?? 'Buddy', subtitle: `Buddy boat · ${b.status === 'live' ? 'live' : 'last known'} position from ${new Date(b.recorded_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` } }); }} /> : null}
        {layers.on.buddies ? <GroupPins pins={groupPins} onPress={(p) => {
          setClusterSel(null); setBuoy(null); track('group_pin_open', { kind: p.kind, from: 'map' });
          const what = p.kind === 'catch' ? `${p.payload?.quantity ?? 1} ${p.payload?.species ?? 'fish'}` : p.kind === 'spot' ? (p.payload?.name ?? 'Spot') : p.kind === 'ping' ? 'Come to me' : p.kind === 'overdue' ? 'OVERDUE — last known' : 'Position';
          setSel({ kind: 'spot', pt: { lat: p.lat, lon: p.lon, name: p.kind === 'spot' ? (p.payload?.name ?? 'Shared spot') : `${p.mine ? 'You' : p.who}: ${what}`,
            saveName: p.mine ? undefined : `${p.kind === 'spot' ? (p.payload?.name ?? 'Spot') : p.kind === 'catch' ? `${p.payload?.species ?? 'Catch'} spot` : 'Spot'} (from ${p.who})`,
            subtitle: `${p.group_name} · ${new Date(p.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${p.body ? ` · "${p.body}"` : ''}` } });
        }} /> : null}
        <GeoJSONSource id="shown" data={shownFC}><Layer type="line" id="shown-line" style={{ lineColor: colors.live, lineWidth: 3, lineOpacity: 0.7 }} /></GeoJSONSource>
        <GeoJSONSource id="active-track" data={activeFC}><Layer type="line" id="active-track-line" style={{ lineColor: colors.live, lineWidth: 3.5 }} /></GeoJSONSource>
        <GeoJSONSource id="draft" data={draftFC}>
          <Layer type="line" id="draft-line" style={{ lineColor: colors.accent, lineWidth: 3, lineDasharray: [2, 1.5] }} />
          <Layer type="circle" id="draft-pts" style={{ circleRadius: 7, circleColor: colors.accent, circleStrokeColor: colors.bg, circleStrokeWidth: 2 }} />
        </GeoJSONSource>
        <GeoJSONSource id="nav" data={navFC}>
          <Layer type="line" id="nav-line" style={{ lineColor: colors.accent, lineWidth: 3.5, lineDasharray: [2, 1.2] }} />
          <Layer type="circle" id="nav-pts" style={{ circleRadius: 8, circleColor: colors.accent, circleStrokeColor: colors.bg, circleStrokeWidth: 2 }} />
        </GeoJSONSource>
        <HarborLayers fc={harborFc} s={layers} view={view} onPress={(p, [lon, lat]) => {
          featurePressAt.current = Date.now(); setBuoy(null); setPanel('none');
          const c = harborCard(p); setSel({ kind: 'spot', pt: { lat, lon, name: c.name, subtitle: c.subtitle } });
        }} />
        {layers.on.spots ? <GeoJSONSource id="public-spots" data={publicSpots} onPress={(e: any) => onSpotPress(e, 'spot')} hitbox={{ top: 15, right: 15, bottom: 15, left: 15 }}>
          <Layer type="circle" id="public-spots-dots" style={{ circleRadius: 5, circleColor: colors.accent, circleStrokeColor: colors.bg, circleStrokeWidth: 1.5 }} />
        </GeoJSONSource> : null}
        {spotLabels.map((f: any) => (
          <Marker key={`lbl-${f.properties.id}`} lngLat={f.geometry.coordinates} anchor="left" offset={[9, 0]}>
            <View pointerEvents="none" style={st.spotLbl}><Text style={st.spotLblT} numberOfLines={1}>{f.properties.name}</Text></View>
          </Marker>
        ))}
        <GeoJSONSource id="my-spots" data={mySpotsFC} onPress={(e: any) => onSpotPress(e, 'saved')} hitbox={{ top: 15, right: 15, bottom: 15, left: 15 }}>
          <Layer type="circle" id="my-spots-dots" style={{ circleRadius: 7, circleColor: colors.live, circleStrokeColor: colors.bg, circleStrokeWidth: 2 }} />
        </GeoJSONSource>
        <GeoJSONSource id="pin" data={pinFC}>
          <Layer type="circle" id="pin-ring" style={{ circleRadius: 11, circleColor: 'rgba(0,0,0,0)', circleStrokeColor: colors.text, circleStrokeWidth: 2 }} />
        </GeoJSONSource>
      </MapView>
      {/* NOAA draws a real night chart now, so only a light red wash is needed to protect night vision */}
      {theme.mode === 'night' ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(28,0,0,0.3)' }]} /> : null}

      {probe ? (
        <View pointerEvents="none" style={st.crossWrap}>
          <View style={st.crossH} /><View style={st.crossV} /><View style={st.crossRing} />
        </View>
      ) : null}

      <SafeAreaView style={st.top} edges={['top']} pointerEvents="box-none">
        <View style={st.searchRow}>
          <Pressable style={st.search} onPress={() => setPanel('search')} accessibilityRole="search" accessibilityLabel="Search spots">
            <Ionicons name="search" size={19} color={colors.muted} />
            <Text style={st.searchT} numberOfLines={1}>Search spots, numbers, my spots</Text>
          </Pressable>
          <IconButton icon={theme.mode === 'night' ? 'sunny' : 'moon'} size={48} label={theme.mode === 'night' ? 'Switch to day mode' : 'Switch to night mode'} onPress={() => { theme.toggle(); track('theme_changed', { setting: theme.mode === 'night' ? 'day' : 'night' }); }} />
        </View>
        <Hud fix={fix} status={status} sogKt={motion.sogKt} cogT={motion.cogT} recording={!!active} />
        {layers.on.rules && mpaHere.length && mpaDismissed !== mpaKey ? (
          <MpaBanner areas={mpaHere} silenced={mpaSilenced} onSilence={silenceMpa}
            onRules={() => { const a = mpaHere.find((x) => x.properties?.take === 'no_take') ?? mpaHere[0]; setRuleSel({ ...a.properties, geom: a.geometry }); }}
            onUnsilence={() => { setMpaSilence({ until: 0, key: null }); AsyncStorage.removeItem('mpa-silence:v1').catch(() => {}); }} />
        ) : null}
        {!net.online ? <Text style={st.offline}>Offline · showing saved maps and data, each with its age</Text> : null}
        {probe ? (
          <View style={st.probe} pointerEvents="none">
            {probeAt ? <Text style={st.probeC}>{formatLatLon(probeAt.lat, probeAt.lon)}</Text> : <Text style={st.probeL}>Move the map under the crosshair</Text>}
            {[...(probeData?.water?.items ?? []), ...(probeData?.depth?.items ?? [])].map((m, i) => <Text key={i} style={st.probeL}>{m.label}</Text>)}
            {probeAt && fix ? <Text style={st.probeL}>{distanceNm(fix.lat, fix.lon, probeAt.lat, probeAt.lon).toFixed(1)} NM from boat at {Math.round(bearingTrue(fix.lat, fix.lon, probeAt.lat, probeAt.lon))}°T</Text> : null}
          </View>
        ) : null}
        <View style={st.rail} pointerEvents="box-none">
          <View style={st.railGroup}>
            <Pressable style={st.railBtn} onPress={() => { setSel(null); setPanel('layers'); }} accessibilityRole="button" accessibilityLabel="Map layers">
              <Ionicons name="layers" size={22} color={colors.text} /><Text style={st.railT}>Layers</Text>
            </Pressable>
            <View style={st.railLine} />
            <Compass heading={heading} mode={orient} onPress={cycleOrient} />
            <View style={st.railLine} />
            <Pressable style={st.railBtn} onPress={recenter} accessibilityRole="button" accessibilityLabel="Center on my boat">
              <Ionicons name="navigate" size={22} color={colors.live} /><Text style={st.railT}>Me</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <View style={st.bottom} pointerEvents="box-none">{bottom}</View>

      {panel === 'layers' ? (
        <LayersSheet catalog={catalog} cached={catalogCached} s={layers} set={(fn) => setLayers(fn)} radarPlaying={radarPlaying} setRadarPlaying={setRadarPlaying}
          onClose={() => setPanel('none')} rulesChecked={rules?.checked_at ?? null} onSaveArea={view ? saveArea : undefined} />
      ) : null}
      {logAt ? (
        <LogCatchSheet lat={logAt.lat} lon={logAt.lon} nearestSpot={nearestPublicSpot(logAt)} depthFt={null}
          onCancel={() => setLogAt(null)} onDone={(m) => { setLogAt(null); setToast(m); }} />
      ) : null}
      {today ? <TodaySheet onClose={() => setToday(false)} onOpenCatchMap={() => { setToday(false); setLayers((p) => ({ ...p, on: { ...p.on, catches: true } })); setCatchHours(24); }} /> : null}
      {toast ? <View style={st.toast} pointerEvents="none"><Text style={st.toastT}>{toast}</Text></View> : null}
      {panel === 'search' ? <SearchSheet boat={here()} mySpots={mySpots} publicSpots={publicSpots} onPick={onSearchPick} onClose={() => setPanel('none')} /> : null}
    </View>
  );
}

const useSt = makeStyles((colors) => ({
  spotLbl: { backgroundColor: colors.panel, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, maxWidth: 150 },
  spotLblT: { color: colors.text, fontSize: 11, fontWeight: '700' },
  root: { flex: 1, backgroundColor: colors.bg },
  top: { position: 'absolute', top: 0, left: 10, right: 10, paddingTop: 6, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, height: 48, borderRadius: 12, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14,
    shadowColor: colors.shadow, shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  searchT: { color: colors.muted, fontSize: 15.5, flex: 1 },
  rail: { alignSelf: 'flex-end', gap: 10, alignItems: 'flex-end' },
  railGroup: { ...cardStyle(colors), backgroundColor: colors.panel, borderRadius: 12, overflow: 'hidden', alignItems: 'center', width: 58 },
  railBtn: { width: 58, minHeight: touch.min + 4, alignItems: 'center', justifyContent: 'center', gap: 1 },
  railT: { color: colors.text, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3 },
  railLine: { height: 1, alignSelf: 'stretch', backgroundColor: colors.line },
  plus: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.panelSolid,
    shadowColor: colors.shadow, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 4 },
  disclaimer: { color: colors.muted, fontSize: 11, backgroundColor: colors.panel, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  pill: { ...cardStyle(colors), flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.panelSolid, borderColor: colors.border, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, minHeight: 36 },
  pillT: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
  barDone: { alignSelf: 'flex-end', marginTop: 6, backgroundColor: colors.panelSolid, borderColor: colors.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center' },
  barDoneT: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  chip: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  chipT: { color: colors.text, fontSize: 14, fontWeight: '600' },
  fab: { width: 76, minHeight: touch.min - 4, borderRadius: 14, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  fabOn: { backgroundColor: colors.live, borderColor: colors.live },
  logFab: { backgroundColor: colors.accent, borderColor: colors.accent },
  offline: { color: colors.accentInk, backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12.5, fontWeight: '700', alignSelf: 'flex-start', overflow: 'hidden' },
  toast: { position: 'absolute', left: 20, right: 20, top: '45%', backgroundColor: colors.panelSolid, borderColor: colors.live, borderWidth: 1, borderRadius: 12, padding: 12 },
  toastT: { color: colors.text, fontSize: 14, textAlign: 'center' },
  fabT: { color: colors.text, fontSize: 14, fontWeight: '700' },
  probe: { backgroundColor: colors.panel, borderColor: colors.live, borderWidth: 1.5, borderRadius: 12, padding: 10, gap: 3, marginRight: 70 },
  probeC: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  probeL: { color: colors.text, fontSize: 13 },
  crossWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 56, height: 2, backgroundColor: colors.live },
  crossV: { position: 'absolute', width: 2, height: 56, backgroundColor: colors.live },
  crossRing: { position: 'absolute', width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.live },
}));
