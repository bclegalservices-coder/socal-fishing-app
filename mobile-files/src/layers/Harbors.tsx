// Harbors & marinas: marina outlines, individual docks and piers, fuel docks, pump-outs, launch ramps and bait.
// Data: OpenStreetMap (weekly server job → R2), saved on the phone for offline use. © OpenStreetMap contributors.
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { makeStyles } from '../theme';
import type { LayerState } from './state';

export type HarborManifest = { key: 'harbors'; url?: string; updated_at?: string; counts?: Record<string, number>; attribution?: string; note?: string };
type View4 = { minLon: number; minLat: number; maxLon: number; maxLat: number; zoom: number } | null;

const CACHE = 'harbors:v1';
const EMPTY = { type: 'FeatureCollection' as const, features: [] as any[] };

export const HARBOR_KINDS: Record<string, { label: string; color: string; icon: string }> = {
  fuel: { label: 'Fuel dock', color: '#E4572E', icon: '⛽' },
  pumpout: { label: 'Pump-out', color: '#7B4FD6', icon: '🚽' },
  bait: { label: 'Bait', color: '#0E9AA7', icon: '🐟' },
  tackle: { label: 'Tackle & bait shop', color: '#0E9AA7', icon: '🎣' },
  ramp: { label: 'Launch ramp', color: '#2E8B57', icon: '⛵' },
  marina: { label: 'Marina', color: '#1F3A5F', icon: '⚓' },
  harbor_office: { label: 'Harbor office', color: '#1F3A5F', icon: '🏢' },
  service: { label: 'Boater services', color: '#1F3A5F', icon: '🔧' },
};

/** Keeps one label per patch of screen (about 120 × 30 points) so names never pile on top of each other.
 *  Features earlier in the list win, so sort the important ones first. */
export function declutter<T extends { geometry: { coordinates: number[] } }>(features: T[], zoom: number, max: number): T[] {
  const degPerPx = 360 / (256 * 2 ** zoom);
  const cw = 120 * degPerPx, ch = 30 * degPerPx;
  const used = new Set<string>();
  const out: T[] = [];
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const cx = Math.floor(lon / cw), cy = Math.floor(lat / ch);
    const key = `${cx}:${cy}`;
    if (used.has(key) || used.has(`${cx - 1}:${cy}`) || used.has(`${cx + 1}:${cy}`)) continue;
    used.add(key);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

const LABEL_ORDER = ['fuel', 'bait', 'pumpout', 'ramp', 'marina', 'tackle', 'service', 'harbor_office'];

/** Which point kinds each switch shows. */
export function enabledKinds(on: LayerState['on']): string[] {
  const k: string[] = [];
  if (on.marinas) k.push('marina', 'harbor_office', 'service');
  if (on.fuel) k.push('fuel');
  if (on.pumpout) k.push('pumpout');
  if (on.ramps) k.push('ramp');
  if (on.bait) k.push('bait', 'tackle');
  return k;
}

/** Loads the harbor GeoJSON (saved copy first, then the newest from the server). */
export function useHarbors(manifest?: HarborManifest) {
  const [fc, setFc] = useState<any>(EMPTY);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const raw = await AsyncStorage.getItem(CACHE); if (raw && alive) setFc(JSON.parse(raw).data); } catch { /* none saved */ }
      const url = manifest?.url;
      if (!url || !url.startsWith('http')) return;
      try {
        const r = await fetch(url);
        if (!r.ok) return;
        const data = await r.json();
        if (!alive || !Array.isArray(data?.features)) return;
        setFc(data);
        AsyncStorage.setItem(CACHE, JSON.stringify({ savedAt: Date.now(), updated: manifest?.updated_at, data })).catch(() => {});
      } catch { /* offline: keep the saved copy */ }
    })();
    return () => { alive = false; };
  }, [manifest?.url, manifest?.updated_at]);
  return fc;
}

const kindColor: any = ['match', ['get', 'kind'], ...Object.entries(HARBOR_KINDS).flatMap(([k, v]) => [k, v.color]), '#6B7C8C'];

export function HarborLayers({ fc, s, view, onPress }: { fc: any; s: LayerState; view: View4; onPress: (props: any, lonLat: [number, number]) => void }) {
  const st = useSt();
  const kinds = useMemo(() => enabledKinds(s.on), [s.on]);
  const anything = s.on.docks || kinds.length > 0;

  // Names next to the dots once you zoom into a harbor (at most 50 at a time).
  const labels = useMemo(() => {
    if (!view || view.zoom < 13 || !kinds.length) return [];
    const inView: any[] = [];
    for (const f of fc?.features ?? []) {
      if (f.geometry?.type !== 'Point' || !kinds.includes(f.properties?.kind)) continue;
      const [lon, lat] = f.geometry.coordinates;
      if (lon < view.minLon || lon > view.maxLon || lat < view.minLat || lat > view.maxLat) continue;
      inView.push(f);
    }
    inView.sort((a, b) => LABEL_ORDER.indexOf(a.properties.kind) - LABEL_ORDER.indexOf(b.properties.kind)
      || Number(!a.properties.name) - Number(!b.properties.name));
    return declutter(inView, view.zoom, 30);
  }, [fc, view, kinds]);

  if (!anything || !fc?.features?.length) return null;
  const pointFilter: any = ['all', ['==', ['geometry-type'], 'Point'], ['match', ['get', 'kind'], kinds.length ? kinds : ['none'], true, false]];
  return (
    <>
      <GeoJSONSource id="harbors" data={fc} hitbox={{ top: 12, right: 12, bottom: 12, left: 12 }}
        onPress={(e: any) => {
          const f = e?.nativeEvent?.features?.find((x: any) => x?.geometry?.type === 'Point') ?? e?.nativeEvent?.features?.[0];
          if (!f) return;
          e.stopPropagation?.();
          const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : (e?.nativeEvent?.lngLat ?? [0, 0]);
          onPress(f.properties ?? {}, [c[0], c[1]]);
        }}>
        {s.on.marinas ? (
          <Layer key="harbor-marina-fill" type="fill" id="harbor-marina-fill" minzoom={11} filter={['all', ['==', ['get', 'kind'], 'marina'], ['==', ['geometry-type'], 'Polygon']] as any}
            style={{ fillColor: '#1F3A5F', fillOpacity: 0.08 }} />
        ) : null}
        {s.on.marinas ? (
          <Layer key="harbor-marina-line" type="line" id="harbor-marina-line" minzoom={11} filter={['all', ['==', ['get', 'kind'], 'marina'], ['==', ['geometry-type'], 'Polygon']] as any}
            style={{ lineColor: '#1F3A5F', lineWidth: 1.2, lineOpacity: 0.6, lineDasharray: [3, 2] }} />
        ) : null}
        {s.on.docks ? (
          <Layer key="harbor-docks" type="line" id="harbor-docks" minzoom={13} filter={['all', ['==', ['get', 'kind'], 'dock'], ['==', ['geometry-type'], 'LineString']] as any}
            style={{ lineColor: '#3B4A5A', lineWidth: 2.5, lineOpacity: 0.9 }} />
        ) : null}
        <Layer key="harbor-points" type="circle" id="harbor-points" minzoom={9.5} filter={pointFilter}
          style={{ circleRadius: 6, circleColor: kindColor, circleStrokeColor: '#FFFFFF', circleStrokeWidth: 1.5 }} />
      </GeoJSONSource>
      {labels.map((f: any) => {
        const k = HARBOR_KINDS[f.properties.kind];
        return (
          <Marker key={`h-${f.properties.id}`} lngLat={f.geometry.coordinates} anchor="left" offset={[8, 0]}>
            <View pointerEvents="none" style={[st.lbl, { borderColor: k?.color ?? '#6B7C8C' }]}>
              <Text style={st.lblT} numberOfLines={1}>{k?.icon} {f.properties.name || k?.label}</Text>
            </View>
          </Marker>
        );
      })}
    </>
  );
}

/** Title + detail lines for the info card when a harbor dot is tapped. */
export function harborCard(p: any): { name: string; subtitle: string } {
  const k = HARBOR_KINDS[p.kind];
  const site = p.website || p['contact:website'];
  const addr = [p['addr:housenumber'], p['addr:street'], p['addr:city']].filter(Boolean).join(' ');
  const lines = [p.summary || k?.label, p.operator ? `Run by ${p.operator}` : '', addr, site ?? '', 'Data: © OpenStreetMap contributors · confirm hours and fuel with the marina'];
  return { name: p.name || k?.label || 'Harbor', subtitle: lines.filter(Boolean).join('\n') };
}

const useSt = makeStyles((colors) => ({
  lbl: { backgroundColor: colors.panel, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1.5, borderWidth: 1, maxWidth: 170 },
  lblT: { color: colors.text, fontSize: 11, fontWeight: '700' },
}));
