// Channel Nav chart helper — a free Cloudflare Worker (paste this whole file into the Worker editor).
//
// Why: NOAA's chart display settings (lighthouse circles off, night colors, simpler symbols) and NOAA's relief
// colors must be sent as JSON, which becomes %-codes in a web address. The phone's map engine crashes on %-codes
// when a tile fails to load, so the app asks this helper with a clean address and the helper talks to NOAA.
// Bonus: when NOAA is busy and answers with an error page instead of a picture, the helper answers "no tile"
// (HTTP 204) so the map simply skips that square.
//
//   /chart?bbox=<xmin,ymin,xmax,ymax>&layers=0,1,2,6&ls=1&cs=0&ps=2   → NOAA chart tile (1024 px PNG)
//   /relief?bbox=<xmin,ymin,xmax,ymax>                                  → NOAA NCEI colored seafloor relief tile

const CHART = 'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export';
const RELIEF = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage';

const BBOX = /^-?\d+(\.\d+)?(e[-+]?\d+)?(,-?\d+(\.\d+)?(e[-+]?\d+)?){3}$/i;
const LAYERS = /^\d{1,2}(,\d{1,2}){0,15}$/;
const ONE = (v, allowed, dflt) => (allowed.includes(Number(v)) ? Number(v) : dflt);

function chartUrl(p) {
  const params = {
    ECDISParameters: {
      version: '10.9.1',
      DynamicParameters: {
        Parameter: [
          { name: 'DisplayLightSectors', value: ONE(p.get('ls'), [1, 2], 1) },
          { name: 'ColorScheme', value: ONE(p.get('cs'), [0, 1, 2], 0) },
          { name: 'PointSymbolizationType', value: ONE(p.get('ps'), [1, 2], 2) },
        ],
      },
    },
  };
  const layers = LAYERS.test(p.get('layers') || '') ? p.get('layers') : '0,1,2,3,4,5,6';
  return `${CHART}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=1024,1024&dpi=192&format=png&transparent=true&f=image`
    + `&layers=show:${layers}&display_params=${encodeURIComponent(JSON.stringify(params))}`;
}

function reliefUrl(p) {
  return `${RELIEF}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=1024,1024&format=png&f=image`
    + `&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: 'ColorHillshade' }))}`;
}

async function tile(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'ChannelNav-chart-helper' }, cf: { cacheTtl: 604800, cacheEverything: true } });
    const type = r.headers.get('content-type') || '';
    if (r.ok && type.startsWith('image/')) {
      return new Response(r.body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*' } });
    }
    await new Promise((res) => setTimeout(res, 400));   // NOAA busy: wait a moment and try once more
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });   // "no tile here", never an error page
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    const p = u.searchParams;
    if (u.pathname === '/' || u.pathname === '/health') return new Response('Channel Nav chart helper: ok');
    if (!BBOX.test(p.get('bbox') || '')) return new Response('bad bbox', { status: 400 });
    if (u.pathname === '/chart') return tile(chartUrl(p));
    if (u.pathname === '/relief') return tile(reliefUrl(p));
    return new Response('not found', { status: 404 });
  },
};
