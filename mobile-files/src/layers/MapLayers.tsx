// Everything drawn on top of the NOAA chart. Order here = stacking order (later is on top).
import { useEffect, useState } from 'react';
import { GeoJSONSource, Layer, RasterSource } from '@maplibre/maplibre-react-native';
import { API_URL, CHART_SETTINGS_AVAILABLE, CHART_TILE_SIZE, RELIEF_ATTRIBUTION, RELIEF_TILES, SATELLITE_ATTRIBUTION, SATELLITE_BASE_ATTRIBUTION, SATELLITE_BASE_TILES, SATELLITE_DETAIL_MINZOOM, SATELLITE_TILES } from '../config';
import type { Catalog } from '../types';
import { DAY_OFFSETS, external, grid, pickDate, wind } from './catalog';
import type { LayerState } from './state';

type Props = { catalog: Catalog | null; s: LayerState; compareOffset: number | null; radarPlaying: boolean; onBuoyPress: (props: any) => void };

export function MapLayers({ catalog, s, compareOffset, radarPlaying, onBuoyPress }: Props) {
  const offset = compareOffset ?? DAY_OFFSETS[s.dayIndex] ?? 0;
  const sst = pickDate(grid(catalog, 'sst')?.dates, offset);
  const chl = pickDate(grid(catalog, 'chl')?.dates, offset);
  const bathy = grid(catalog, 'bathy')?.dates?.[0];
  const w = wind(catalog);
  const windHour = w?.hours?.[Math.min(s.windIndex, (w?.hours?.length ?? 1) - 1)];
  const radar = external(catalog, 'radar');

  // radar loop: step through the last ~50 minutes of frames
  const frames = radar?.frames?.length ? [...radar.frames, radar.tiles] : radar ? [radar.tiles] : [];
  const [frame, setFrame] = useState(frames.length - 1);
  useEffect(() => {
    if (!radarPlaying || frames.length < 2) { setFrame(frames.length - 1); return; }
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 600);
    return () => clearInterval(t);
  }, [radarPlaying, frames.length]);

  const overlayOpacity = s.opacity.overlay ?? 0.75;
  return (
    <>
      {/* Map Options overlay, directly over the NOAA chart and under every fishing layer */}
      {s.overlay === 'satellite' ? (
        <RasterSource key="satellite-base" id="satellite-base" tiles={[SATELLITE_BASE_TILES]} tileSize={256} maxzoom={8} attribution={SATELLITE_BASE_ATTRIBUTION}>
          <Layer type="raster" id="satellite-base-layer" style={{ rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {s.overlay === 'satellite' ? (
        <RasterSource key="satellite" id="satellite" tiles={[SATELLITE_TILES]} tileSize={256} minzoom={SATELLITE_DETAIL_MINZOOM} maxzoom={16} attribution={SATELLITE_ATTRIBUTION}>
          <Layer type="raster" id="satellite-layer" style={{ rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {s.overlay === 'relief' && CHART_SETTINGS_AVAILABLE ? (
        <RasterSource key="relief" id="relief" tiles={[RELIEF_TILES]} tileSize={CHART_TILE_SIZE} maxzoom={17} attribution={RELIEF_ATTRIBUTION}>
          <Layer type="raster" id="relief-layer" style={{ rasterOpacity: overlayOpacity, rasterFadeDuration: 150 }} />
        </RasterSource>
      ) : null}
      {s.on.bathy && bathy ? (
        <RasterSource key={`bathy-${bathy.tiles}`} id="bathy" tiles={[bathy.tiles]} tileSize={256} minzoom={5} maxzoom={11}>
          <Layer type="raster" id="bathy-layer" style={{ rasterOpacity: s.opacity.bathy, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {s.on.contours && bathy?.contours ? (
        <GeoJSONSource key={`contours-${bathy.contours}`} id="contours" data={bathy.contours}>
          <Layer type="line" id="contours-line" style={{ lineColor: '#9fc3d6', lineWidth: 0.8, lineOpacity: 0.7 }} />
        </GeoJSONSource>
      ) : null}
      {s.on.sst && sst ? (
        <RasterSource key={`sst-${sst.tiles}`} id="sst" tiles={[sst.tiles]} tileSize={256} minzoom={5} maxzoom={10}>
          <Layer type="raster" id="sst-layer" style={{ rasterOpacity: s.opacity.sst, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {s.on.chl && chl ? (
        <RasterSource key={`chl-${chl.tiles}`} id="chl" tiles={[chl.tiles]} tileSize={256} minzoom={5} maxzoom={10}>
          <Layer type="raster" id="chl-layer" style={{ rasterOpacity: s.opacity.chl, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {s.on.breaks && sst?.breaks ? (
        <GeoJSONSource key={`breaks-${sst.breaks}`} id="sst-breaks" data={sst.breaks}>
          <Layer type="line" id="sst-breaks-line" style={{
            lineColor: '#ffffff', lineOpacity: ['match', ['get', 'strength'], 'strong', 0.95, 0.6] as any,
            lineWidth: ['match', ['get', 'strength'], 'strong', 3, 1.4] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {s.on.chlEdges && chl?.breaks ? (
        <GeoJSONSource key={`chledges-${chl.breaks}`} id="chl-edges" data={chl.breaks}>
          <Layer type="line" id="chl-edges-line" style={{
            lineColor: '#9cf07a', lineDasharray: [2, 1.5],
            lineWidth: ['match', ['get', 'strength'], 'strong', 2.6, 1.2] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {s.on.radar && frames.length ? (
        <RasterSource key={`radar-${frames[frame]}`} id="radar" tiles={[frames[frame]]} tileSize={256}>
          <Layer type="raster" id="radar-layer" style={{ rasterOpacity: s.opacity.radar, rasterFadeDuration: 0 }} />
        </RasterSource>
      ) : null}
      {s.on.wind && windHour ? (
        <GeoJSONSource key={`wind-${windHour.url}`} id="wind" data={windHour.url}>
          <Layer type="line" id="wind-arrows" style={{
            lineWidth: 2, lineCap: 'round',
            lineColor: ['interpolate', ['linear'], ['get', 'kt'], 0, '#7fd0e8', 8, '#62cbe2', 12, '#f2d36a', 18, '#f5a524', 24, '#e7663a', 30, '#c43a3a'] as any,
          }} />
        </GeoJSONSource>
      ) : null}
      {s.on.buoys && API_URL ? (
        <GeoJSONSource id="buoys" data={`${API_URL}/buoys`} onPress={(e: any) => { const f = e?.nativeEvent?.features?.[0]; if (f) { e.stopPropagation?.(); onBuoyPress(f.properties); } }} hitbox={{ top: 15, right: 15, bottom: 15, left: 15 }}>
          <Layer type="circle" id="buoys-dots" style={{ circleRadius: 7, circleColor: '#ffffff', circleStrokeColor: '#2e7fd6', circleStrokeWidth: 3 }} />
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
