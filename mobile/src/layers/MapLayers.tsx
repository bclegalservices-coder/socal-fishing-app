// Everything drawn on top of the NOAA chart. Order here = stacking order (later is on top).
import { useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSONSource, Layer, RasterSource, VectorSource } from '@maplibre/maplibre-react-native';
import { API_URL, okTile, RADAR_ATTRIBUTION, radarAt, CHART_SETTINGS_AVAILABLE, CHART_TILE_SIZE, RELIEF_ATTRIBUTION, RELIEF_TILES, SATELLITE_ATTRIBUTION, SATELLITE_BASE_ATTRIBUTION, SATELLITE_BASE_TILES, SATELLITE_DETAIL_MINZOOM, SATELLITE_TILES, SAT_INFO_URL, SAT_SHARP_ATTRIBUTION, SAT_SHARP_TILES, LABEL_FONT } from '../config';
import { useTheme } from '../theme';
import type { Catalog } from '../types';
import { DAY_OFFSETS, bottom2, bottom2Lines, external, grid, hdBottom, hdBottomWide, pickDate, wind } from './catalog';
import type { LayerState } from './state';
import { FEATURES_TOP, SHADING_TOP, below } from './order';

/** Short stable id for a tile address (djb2 hash). */
const idOf = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

type Props = { catalog: Catalog | null; s: LayerState; compareOffset: number | null; radarPlaying: boolean; onBuoyPress: (props: any) => void; onRadarLabel?: (label: string | null) => void;
  /** Nov 12: new maps on (Admin off-switch "new_maps" turns them off → the old satellite, HD bottom and contours). */
  newMaps?: boolean };

/** Nov 12: does the chart helper have the sharp-satellite key? Asked once per app start, only when satellite is on. */
let satSharpKnown: boolean | null = null;
function useSatSharp(want: boolean) {
  const [ok, setOk] = useState<boolean>(!!satSharpKnown);
  useEffect(() => {
    if (!want || !SAT_INFO_URL || satSharpKnown !== null) return;
    let live = true;
    fetch(SAT_INFO_URL).then((r) => r.json()).then((j) => { satSharpKnown = !!j?.esri; if (live) setOk(satSharpKnown); }).catch(() => {});
    return () => { live = false; };
  }, [want]);
  return want && ok;
}

/** Nov 12: contour lines (vector). Each line piece says from which zoom it has room (`minz`): one line layer per zoom
 *  step, so on steep walls the 5–10 ft lines appear only once you've zoomed in far enough to tell them apart.
 *  Standard detail shows the `std` lines; Max shows all. */
export function contourFilter(z: number, detail: 'std' | 'max') {
  const base = z <= 14 ? ['<=', ['get', 'minz'], 14] : z >= 17 ? ['>=', ['get', 'minz'], 17] : ['==', ['get', 'minz'], z];
  return detail === 'std' ? ['all', base, ['==', ['get', 'std'], 1]] : base;
}
const CONTOUR_STEPS = [14, 15, 16, 17];

/** Nov 7: "How many breaks" — each line from the server says how strong it is (`rel`: 1 = moderate) and how far it
 *  reaches (`span_nm`). Strongest/Strong also skip the in-between half-degree lines so lines don't stack up.
 *  Older maps without these tags show every line. */
const BREAK_TIERS: Record<number, { rel: number; span: number; whole: boolean }> = {
  1: { rel: 1.9, span: 4, whole: true },     // Strongest: only the sharpest, longest breaks
  2: { rel: 1.25, span: 3, whole: true },    // Strong
  3: { rel: 0.9, span: 2.5, whole: false },  // More (default)
  4: { rel: 0.6, span: 2, whole: false },    // Most: every break we found
};
export function breakFilter(level: number) {
  const t = BREAK_TIERS[level] ?? BREAK_TIERS[3];
  const f: any[] = ['all', ['>=', ['coalesce', ['get', 'rel'], 99], t.rel], ['>=', ['coalesce', ['get', 'span_nm'], 99], t.span]];
  if (t.whole) f.push(['==', ['%', ['*', ['coalesce', ['get', 'level'], 0], 2], 2], 0]);
  return f;
}

export function MapLayers({ catalog, s, compareOffset, radarPlaying, onBuoyPress, onRadarLabel, newMaps = false }: Props) {
  const night = useTheme().mode === 'night';
  const offset = compareOffset ?? DAY_OFFSETS[s.dayIndex] ?? 0;
  const sst = pickDate(grid(catalog, 'sst')?.dates, offset);
  const chl = pickDate(grid(catalog, 'chl')?.dates, offset);
  const bathy = grid(catalog, 'bathy')?.dates?.[0];
  const hd = hdBottom(catalog);
  const hdWide = hdBottomWide(catalog);
  const detail = s.contourDetail ?? 'std';
  const contourTiles = okTile(bathy?.contour_tiles?.[detail]) ? bathy!.contour_tiles![detail]! : null;
  const w = wind(catalog);
  const b2 = newMaps ? bottom2(catalog) : undefined;          // new smooth bottom (may still be being drawn)
  const lines = newMaps ? bottom2Lines(catalog) : undefined;  // its vector contour lines (once finished)
  const windHour = w?.hours?.[Math.min(s.windIndex, (w?.hours?.length ?? 1) - 1)];
  const radar = external(catalog, 'radar');

  // Radar loop: the last ~50 minutes of real radar, then the next few hours of HRRR forecast radar.
  const t12 = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const frames = useMemo(() => {
    const out: { tiles: string | null; label: string }[] = [];
    if (!radar) return out;
    // Real radar every 10 minutes for the last hour (NOAA MRMS), times rounded so map squares are reused.
    const step = 5 * 60000;
    const now = Math.floor((Date.now() - 4 * 60000) / step) * step;   // newest image is usually ~4 min old
    for (let m = 60; m >= 10; m -= 10) out.push({ tiles: radarAt(now - m * 60000), label: `Radar · ${t12(new Date(now - m * 60000))}` });
    out.push({ tiles: radarAt(now), label: `Radar · now ${t12(new Date(now))}` });
    const fc = ((w as any)?.radar_forecast?.frames ?? []) as { valid: string; tiles: string | null }[];
    for (const f of fc) {
      const v = new Date(f.valid);
      if (v.getTime() > now + 10 * 60000) out.push({ tiles: f.tiles, label: `Forecast · ${t12(v)}${f.tiles ? '' : ' · no rain'}` });
    }
    return out.filter((f) => f.tiles == null || (typeof f.tiles === 'string' && f.tiles.startsWith('http')));
  }, [radar, w]);
  const liveIndex = Math.max(0, frames.findIndex((f) => f.label.startsWith('Radar · now')));
  const [frame, setFrame] = useState(liveIndex);
  // Slow, readable loop: 1.2 s per frame, a 2.5 s pause on "now" and on the last frame before it starts over.
  useEffect(() => {
    if (!radarPlaying || frames.length < 2) { setFrame(liveIndex); return; }
    let t: any;
    const tick = (f: number) => {
      setFrame(f);
      const hold = f === liveIndex || f === frames.length - 1 ? 2500 : 1200;
      t = setTimeout(() => tick((f + 1) % frames.length), hold);
    };
    tick(0);
    return () => clearTimeout(t);
  }, [radarPlaying, frames.length, liveIndex]);
  const cur = frames[Math.min(frame, frames.length - 1)];
  useEffect(() => { onRadarLabel?.(s.on.radar && radarPlaying && cur ? cur.label : null); }, [cur?.label, s.on.radar, radarPlaying]);

  // Toggle reliability (Oct 22): a layer is added to the map the first time it's turned on, then stays loaded and is
  // only shown or hidden. Removing a map source and adding one back with the same name a moment later sometimes
  // failed on iPhone, so a switch turned on but nothing appeared until the app restarted.
  const seen = useRef<Record<string, boolean>>({});
  const keep = (k: string, on: boolean) => { if (on) seen.current[k] = true; return !!seen.current[k]; };
  const vis = (on: boolean) => (on ? 'visible' : 'none') as 'visible' | 'none';
  const sat = s.overlay === 'satellite', rel = s.overlay === 'relief';
  const sharp = useSatSharp(newMaps && sat);
  const lineInk = night ? '#CFE6F5' : '#10263A', haloInk = night ? 'rgba(6,20,32,0.85)' : 'rgba(255,255,255,0.9)';
  const overlayOpacity = s.opacity.overlay ?? 0.75;
  return (
    <>
      {/* Map Options overlay, directly over the NOAA chart and under every fishing layer */}
      {keep('satellite', sat) ? (
        <RasterSource key="satellite-base" id="satellite-base" tiles={[SATELLITE_BASE_TILES]} tileSize={256} maxzoom={8} attribution={SATELLITE_BASE_ATTRIBUTION}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id="satellite-base-layer" style={{ visibility: vis(sat), rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {keep('satellite', sat) ? (
        <RasterSource key="satellite" id="satellite" tiles={[SATELLITE_TILES]} tileSize={256} minzoom={SATELLITE_DETAIL_MINZOOM} maxzoom={16} attribution={SATELLITE_ATTRIBUTION}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id="satellite-layer" style={{ visibility: vis(sat), rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {/* Nov 12: zoomed in close (17–19), sharp Esri photos on top of the free USGS ones. The chart helper keeps a
          monthly limit under Esri's free 2 million; past it (or with no key) it sends nothing and USGS shows through. */}
      {keep('satellite-sharp', sat && sharp) ? (
        <RasterSource key="satellite-sharp" id="satellite-sharp" tiles={[SAT_SHARP_TILES]} tileSize={256} minzoom={17} maxzoom={19} attribution={SAT_SHARP_ATTRIBUTION}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id="satellite-sharp-layer" minzoom={17} style={{ visibility: vis(sat && sharp), rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {keep('relief', rel) && CHART_SETTINGS_AVAILABLE ? (
        <RasterSource key="relief" id="relief" tiles={[RELIEF_TILES]} tileSize={CHART_TILE_SIZE} maxzoom={17} attribution={RELIEF_ATTRIBUTION}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id="relief-layer" style={{ visibility: vis(rel), rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {keep('bathy', s.on.bathy) && bathy && okTile(bathy.tiles) ? (
        <RasterSource key={`bathy-${idOf(bathy.tiles)}`} id={`bathy-${idOf(bathy.tiles)}`} tiles={[bathy.tiles]} tileSize={256} minzoom={5} maxzoom={12}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`bathy-${idOf(bathy.tiles)}-layer`} style={{ visibility: vis(s.on.bathy), rasterOpacity: s.opacity.bathy, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {/* HD bottom for all of SoCal (zoom 10–14, enlarged smoothly beyond), under the sharper pilot area */}
      {/* Nov 12 new maps: the old all-SoCal HD bottom only fills in where the new one isn't drawn yet */}
      {keep('bathyHd', s.on.bathyHd) && hdWide && okTile(hdWide.tiles) ? (
        <RasterSource key={`bathyhdw-${idOf(hdWide.tiles)}`} id={`bathyhdw-${idOf(hdWide.tiles)}`} tiles={[hdWide.tiles]} tileSize={256} minzoom={hdWide.minzoom ?? 10} maxzoom={hdWide.maxzoom ?? 14}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`bathyhdw-${idOf(hdWide.tiles)}-layer`} style={{ visibility: vis(s.on.bathyHd && !(b2 && b2.complete)), rasterOpacity: s.opacity.bathyHd ?? 0.95, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {/* HD bottom: sharp relief + dense contours (NOAA BlueTopo), on top of the coarse relief where it's built */}
      {keep('bathyHd', s.on.bathyHd) && hd && okTile(hd.tiles) ? (
        <RasterSource key={`bathyhd-${idOf(hd.tiles)}`} id={`bathyhd-${idOf(hd.tiles)}`} tiles={[hd.tiles]} tileSize={256} minzoom={hd.minzoom ?? 11} maxzoom={hd.maxzoom ?? 16}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`bathyhd-${idOf(hd.tiles)}-layer`} style={{ visibility: vis(s.on.bathyHd && !b2), rasterOpacity: s.opacity.bathyHd ?? 0.95, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {/* Nov 12: the new bottom — smooth colors and relief, no lines baked in (the lines are vector, below) */}
      {keep('bottom2', s.on.bathyHd && !!b2) && b2 && okTile(b2.tiles) ? (
        <RasterSource key={`b2-${idOf(b2.tiles)}`} id={`b2-${idOf(b2.tiles)}`} tiles={[b2.tiles]} tileSize={256} minzoom={b2.minzoom ?? 6} maxzoom={b2.maxzoom ?? 14}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`b2-${idOf(b2.tiles)}-layer`} style={{ visibility: vis(s.on.bathyHd), rasterOpacity: s.opacity.bathyHd ?? 0.95, rasterFadeDuration: 0, rasterResampling: 'linear' }} />
        </RasterSource>
      ) : null}
      {/* Depth contours: drawn line layers (Standard / Max) from the Coastal Relief Model at zoom 9+, the vector lines below that */}
      {keep('contours', s.on.contours) && okTile(bathy?.contours) ? (
        <GeoJSONSource key="contours" id="contours" data={bathy.contours}>
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="contours-line" maxzoom={lines ? 10 : contourTiles ? 9 : 24} style={{ visibility: vis(s.on.contours), lineColor: '#123247', lineWidth: 1.1, lineOpacity: 0.75 }} />
        </GeoJSONSource>
      ) : null}
      {/* Nov 12: vector contour lines from zoom 10 — thin and sharp at every zoom, depth numbers on the bold lines */}
      {keep('contours2', s.on.contours && !!lines) && lines ? (
        <VectorSource key={`c2-${idOf(lines)}`} id={`c2-${idOf(lines)}`} tiles={[lines]} minzoom={10} maxzoom={14}>
          {CONTOUR_STEPS.map((z) => (
            <Layer key={`c2-${idOf(lines)}-l${z}`} beforeId={below(FEATURES_TOP)} type="line" id={`c2-${idOf(lines)}-l${z}`} source-layer="contours"
              minzoom={z <= 14 ? 10 : z} filter={contourFilter(z, detail) as any}
              style={{ visibility: vis(s.on.contours), lineColor: lineInk, lineJoin: 'round', lineCap: 'round',
                lineWidth: ['case', ['==', ['get', 'major'], 1], 1.5, 0.75] as any, lineOpacity: ['case', ['==', ['get', 'major'], 1], 0.9, 0.6] as any }} />
          ))}
          <Layer beforeId={below(FEATURES_TOP)} type="symbol" id={`c2-${idOf(lines)}-labels`} source-layer="contours" minzoom={11}
            filter={['all', ['==', ['get', 'major'], 1], ['<=', ['get', 'minz'], 14]] as any}
            style={{ visibility: vis(s.on.contours), symbolPlacement: 'line', symbolSpacing: 280, textField: ['to-string', ['get', 'lv']] as any,
              textFont: LABEL_FONT, textSize: 11, textColor: lineInk, textHaloColor: haloInk, textHaloWidth: 1.4, textKeepUpright: true, textMaxAngle: 35, textPadding: 2 }} />
        </VectorSource>
      ) : null}
      {keep(`contours-${detail}`, s.on.contours && !lines) && contourTiles ? (
        <RasterSource key={`ctr-${detail}-${idOf(contourTiles)}`} id={`contours-${detail}-${idOf(contourTiles)}`} tiles={[contourTiles]} tileSize={256} minzoom={9} maxzoom={14}>
          <Layer beforeId={below(FEATURES_TOP)} type="raster" id={`contours-${detail}-${idOf(contourTiles)}-layer`} minzoom={8.5} style={{ visibility: vis(s.on.contours && !lines), rasterOpacity: 1, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {(['std', 'max'] as const).filter((d) => d !== detail && seen.current[`contours-${d}`] && bathy?.contour_tiles?.[d]).map((d) => (
        <RasterSource key={`ctr-${d}-${idOf(bathy!.contour_tiles![d]!)}`} id={`contours-${d}-${idOf(bathy!.contour_tiles![d]!)}`} tiles={[bathy!.contour_tiles![d]!]} tileSize={256} minzoom={9} maxzoom={14}>
          <Layer beforeId={below(FEATURES_TOP)} type="raster" id={`contours-${d}-${idOf(bathy!.contour_tiles![d]!)}-layer`} minzoom={8.5} style={{ visibility: 'none' }} />
        </RasterSource>
      ))}
      {keep('sst', s.on.sst) && sst && okTile(sst.tiles) ? (
        <RasterSource key={`sst-${idOf(sst.tiles)}`} id={`sst-${idOf(sst.tiles)}`} tiles={[sst.tiles]} tileSize={256} minzoom={5} maxzoom={10}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`sst-${idOf(sst.tiles)}-layer`} style={{ visibility: vis(s.on.sst), rasterOpacity: s.opacity.sst, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {keep('chl', s.on.chl) && chl && okTile(chl.tiles) ? (
        <RasterSource key={`chl-${idOf(chl.tiles)}`} id={`chl-${idOf(chl.tiles)}`} tiles={[chl.tiles]} tileSize={256} minzoom={5} maxzoom={10}>
          <Layer beforeId={below(SHADING_TOP)} type="raster" id={`chl-${idOf(chl.tiles)}-layer`} style={{ visibility: vis(s.on.chl), rasterOpacity: s.opacity.chl, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {keep('breaks', s.on.breaks) && okTile(sst?.breaks) ? (
        <GeoJSONSource key="sst-breaks" id="sst-breaks" data={sst.breaks}>
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="sst-breaks-line" filter={breakFilter(s.breakLevel ?? 3) as any} style={{
            visibility: vis(s.on.breaks),
            lineColor: '#ffffff', lineOpacity: ['match', ['get', 'strength'], 'strong', 0.95, 0.6] as any,
            lineWidth: ['match', ['get', 'strength'], 'strong', 3, 1.4] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {keep('chlEdges', s.on.chlEdges) && okTile(chl?.breaks) ? (
        <GeoJSONSource key="chl-edges" id="chl-edges" data={chl.breaks}>
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="chl-edges-line" style={{
            visibility: vis(s.on.chlEdges),
            lineColor: '#9cf07a', lineDasharray: [2, 1.5],
            lineWidth: ['match', ['get', 'strength'], 'strong', 2.6, 1.2] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {/* While the loop plays, every frame stays loaded and frames cross-fade (no flicker). */}
      {keep('radar', s.on.radar) ? frames.map((f, i) => {
        const show = i === Math.min(frame, frames.length - 1);
        if (!okTile(f.tiles) || (!radarPlaying && !show)) return null;
        const isFc = f.label.startsWith('Forecast');
        const rid = `radar-${idOf(f.tiles)}`;   // unique per frame time, so a moving time window never reuses an id
        return (
          <RasterSource key={rid} id={rid} tiles={[f.tiles]} tileSize={isFc ? 256 : 512} maxzoom={isFc ? 8 : 12} attribution={isFc ? undefined : RADAR_ATTRIBUTION}>
            <Layer beforeId={below(SHADING_TOP)} key={`${rid}-layer`} type="raster" id={`${rid}-layer`}
              style={{ visibility: vis(s.on.radar), rasterOpacity: show ? s.opacity.radar : 0, rasterOpacityTransition: { duration: 500, delay: 0 } as any, rasterFadeDuration: 0, rasterResampling: 'linear' }} />
          </RasterSource>
        );
      }) : null}
      {keep('wind', s.on.wind) && windHour ? (
        <GeoJSONSource key="wind" id="wind" data={windHour.url}>
          {/* Arrows only when zoomed in close (harbor scale); farther out the moving streaks show the wind (Oct 22: too cluttered) */}
          <Layer beforeId={below(FEATURES_TOP)} type="line" id="wind-arrows" minzoom={11.5} style={{
            visibility: vis(s.on.wind),
            lineWidth: 1.6, lineCap: 'round', lineOpacity: 0.85,
            lineColor: ['interpolate', ['linear'], ['get', 'kt'], 0, '#7fd0e8', 8, '#62cbe2', 12, '#f2d36a', 18, '#f5a524', 24, '#e7663a', 30, '#c43a3a'] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {keep('buoys', s.on.buoys) && API_URL ? (
        <GeoJSONSource id="buoys" data={`${API_URL}/buoys?t=${Math.floor(Date.now() / 1800000)}`} onPress={(e: any) => { const f = e?.nativeEvent?.features?.[0]; if (f) { e.stopPropagation?.(); onBuoyPress(f.properties); } }} hitbox={{ top: 15, right: 15, bottom: 15, left: 15 }}>
          <Layer beforeId={below(FEATURES_TOP)} type="circle" id="buoys-dots" style={{ visibility: vis(s.on.buoys), circleRadius: 7, circleColor: '#ffffff', circleStrokeColor: '#2e7fd6', circleStrokeWidth: 3 }} />
        </GeoJSONSource>
      ) : null}
    </>
  );
}

/** Info for the time bar about what's showing right now. */
export function shownDate(catalog: Catalog | null, s: LayerState, compareOffset: number | null) {
  const offset = compareOffset ?? DAY_OFFSETS[s.dayIndex] ?? 0;
  const key = s.on.sst ? 'sst' : s.on.chl ? 'chl' : null;
  if (!key) return null;
  const d = pickDate(grid(catalog, key)?.dates, offset);
  return { key, entry: d, offset, layer: grid(catalog, key) };
}
