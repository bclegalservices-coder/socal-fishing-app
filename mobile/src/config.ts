// Public configuration only. Paid/private keys NEVER go in the app — they live on the server.

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? '';

// NOAA Chart Display Service: official electronic navigational charts (ENC) drawn by NOAA's Maritime Chart Service.
// Source: https://nauticalcharts.noaa.gov/data/gis-data-and-services.html
// NOAA retired the old raster-chart tile cache (MarineChart_Services/NOAACharts …/tile), which now returns no images.
// This endpoint draws each map tile on request for its exact area ({bbox-epsg-3857} is filled in by MapLibre), works
// at every zoom, and is also what offline-pack downloads fetch. Each square is 512 map points drawn as a 1024 px image
// at 192 dpi: as sharp on iPhone screens as 256-point squares, but 4x fewer requests, which keeps NOAA's server from
// throttling us (it answers an overloaded burst with an HTML error page instead of a picture).
export const CHART_TILE_SIZE = 512;
export const NOAA_CHART_SERVICE = 'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer';
export const NOAA_CHART_TILES =
  `${NOAA_CHART_SERVICE}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=1024,1024&dpi=192&format=png&transparent=true&f=image`;
export const NOAA_CHART_MINZOOM = 3;

/** The NOAA chart is drawn in groups (Maritime Chart Service layers). Turning a group off removes it from the chart
 *  image itself. 0 chart info · 1 land/coast/ports · 2 depths · 3 seabed & obstructions · 4 traffic routes ·
 *  5 special areas · 6 buoys, beacons, lights · 7 services & small-craft facilities. */
export type ChartDetail = 'seabed' | 'lanes' | 'areas' | 'navaids' | 'services';
export const CHART_DETAIL_LAYER: Record<ChartDetail, number> = { seabed: 3, lanes: 4, areas: 5, navaids: 6, services: 7 };
/** NOAA chart display settings (S-52). DisplayLightSectors: 1 = off, 2 = on. The light sectors are the big yellow /
 *  orange circles and arcs around lighthouses (which color a light shows from which direction). */
/** Chart helper (a free Cloudflare Worker, tools/chart-helper-worker.js). NOAA's display settings (lighthouse circles
 *  off, night colors, simpler symbols) must be sent as JSON, which turns into %-codes in a web address. The map engine
 *  crashes on %-codes when a NOAA tile fails (Oct 20 crash report), so the app never puts them in an address: the
 *  helper adds them on the server side. Without the helper, the plain NOAA chart is used (circles always shown). */
export const CHART_HELPER = (process.env.EXPO_PUBLIC_CHART_HELPER ?? '').replace(/\/$/, '');
export const CHART_SETTINGS_AVAILABLE = CHART_HELPER.startsWith('https://');

export function noaaChartTiles(show: Record<ChartDetail, boolean> & { lightCircles?: boolean; simpleSymbols?: boolean; look?: 'clean' | 'standard' | 'full' }, night = false, helperOff = false): string {
  const details = (Object.keys(CHART_DETAIL_LAYER) as ChartDetail[]).filter((k) => show[k]).map((k) => CHART_DETAIL_LAYER[k]);
  if (CHART_SETTINGS_AVAILABLE && !helperOff) {
    // Oct 29 v2: NO group 2 here. Group 2 ("depths") is what paints NOAA's pale water fill; without it the water is
    // clear and the map's own baby-blue background shows through. Depth numbers + lines come back on top from
    // noaaDepthTiles() (group 2 drawn without its fill).
    const ids = [0, 1, ...details].sort((a, b) => a - b);
    // ls = light sectors (1 off, 2 on) · cs = color scheme (0 day, 2 night) · ps = symbols (1 simple, 2 paper)
    return `${CHART_HELPER}/chart?bbox={bbox-epsg-3857}&layers=${ids.join(',')}&ls=${show.lightCircles ? 2 : 1}&cs=${night ? 2 : 0}&ps=${show.simpleSymbols ? 1 : 2}&look=${show.look ?? 'standard'}&hd=1&v=w2`;
  }
  return `${NOAA_CHART_TILES}&layers=show:${[0, 1, 2, ...details].sort((a, b) => a - b).join(',')}`;
}

/** NOAA depth numbers and depth lines only (chart group 2 without the water fill), drawn over the baby-blue water.
 *  null = off (Layers → NOAA chart symbols → "Depth numbers & lines"), or no chart helper (then the plain chart keeps
 *  its own depths). */
export function noaaDepthTiles(show: { depths?: boolean; look?: 'clean' | 'standard' | 'full' }, night = false, helperOff = false): string | null {
  if (!CHART_SETTINGS_AVAILABLE || helperOff || show.depths === false) return null;
  return `${CHART_HELPER}/chart?bbox={bbox-epsg-3857}&layers=2&ls=1&cs=${night ? 2 : 0}&ps=2&look=${show.look === 'full' ? 'depthsfull' : 'depths'}&hd=1`;
}

/** Backup chlorophyll when our server has none: NASA's ready-made daily picture tiles (VIIRS satellite pass,
 *  clouds show as gaps). Free, no account. Yesterday's date (UTC), since today's pass may not be in yet. */
export function nasaChlTiles(): string {
  const d = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_L2_Chlorophyll_A/default/${d}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`;
}
export const NASA_CHL_ATTRIBUTION = 'NASA GIBS · VIIRS chlorophyll';

// Map Options overlays (both free, public US-government data):
// Satellite = USGS National Map orthoimagery (USDA NAIP, ~1 m detail on US land and coast; public domain).
export const SATELLITE_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
export const SATELLITE_ATTRIBUTION = 'USGS The National Map · USDA NAIP';
// USGS photos only exist over land and the immediate shoreline, so on its own the ocean comes out blank and blocky.
// Underneath it: NASA Blue Marble (whole planet incl. ocean, with seafloor shading), sharp from orbit, soft up close.
export const SATELLITE_BASE_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
export const SATELLITE_BASE_ATTRIBUTION = 'NASA Blue Marble (GIBS)';
export const SATELLITE_DETAIL_MINZOOM = 11;   // below this, USGS tiles are patchy along the coast
// Relief = NOAA NCEI elevation & bathymetry mosaic drawn as colored hillshade (seafloor detail down to a few meters
// where multibeam surveys exist, which includes most of the SoCal Bight).
// Served through the chart helper: the relief color setting is JSON, which would put %-codes in the address.
export const RELIEF_TILES = `${(process.env.EXPO_PUBLIC_CHART_HELPER ?? '').replace(/\/$/, '')}/relief?bbox={bbox-epsg-3857}`;
export const RELIEF_ATTRIBUTION = 'NOAA NCEI bathymetry';
export const NOAA_CHART_MAXZOOM = 18;

export const CHART_ATTRIBUTION = 'NOAA Office of Coast Survey · Not for navigation';

// Default view: Newport / Catalina channel. Region is data, not a hard-coded limit.
export const DEFAULT_CENTER: [number, number] = [-118.05, 33.45]; // [lon, lat]
export const DEFAULT_ZOOM = 9;

// Links shown under Me → About (App Store review requires a reachable privacy policy and support contact).
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL ?? '';
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL ?? '';
export const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? '';
export const STUDIO_URL = process.env.EXPO_PUBLIC_STUDIO_URL ?? '';
export const DEMO_EMAIL = (process.env.EXPO_PUBLIC_DEMO_EMAIL ?? '').toLowerCase();   // App Review account (password sign-in)

/** Live radar: NOAA's MRMS national radar mosaic (all radars blended, ~550 m detail, new image every few minutes),
 *  drawn for each map square at retina sharpness. `time` picks a moment in the last ~2 hours (epoch ms window).
 *  No %-codes in the address (see CHART_HELPER). */
export const NOAA_RADAR = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/radar/radar_base_reflectivity_time/ImageServer/exportImage'
  + '?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=1024,1024&format=png&transparent=true&interpolation=RSP_BilinearInterpolation&f=image';
export const radarAt = (ms: number) => `${NOAA_RADAR}&time=${ms - 10 * 60000},${ms}`;
export const RADAR_ATTRIBUTION = 'NOAA MRMS radar';

/** True only for a tile/data address the map engine can safely load. A blank address or one with % codes
 *  crashes the native map (seen in testing), so every server-provided layer goes through this first. */
export function okTile(u: unknown): u is string {
  return typeof u === 'string' && u.startsWith('https://') && u.length < 2000 && !u.includes('%') && !/\s/.test(u);
}

/** Just the land from the NOAA chart (chart group 1: land, coastline, ports), clear everywhere else. Drawn on top of
 *  water temperature and chlorophyll so islands and the coast stay crisp and uncolored, matching the chart exactly. */
export function chartLandTiles(night = false): string {
  if (CHART_SETTINGS_AVAILABLE) return `${CHART_HELPER}/chart?bbox={bbox-epsg-3857}&layers=1&ls=1&cs=${night ? 2 : 0}&ps=2&look=clean&hd=1`;
  return `${NOAA_CHART_TILES}&layers=show:1`;
}
