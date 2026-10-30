// Channel Nav chart helper — a free Cloudflare Worker (paste this whole file into the Worker editor).
//
// Why: NOAA's chart display settings (lighthouse circles off, night colors, simpler symbols) and NOAA's relief
// colors must be sent as JSON, which becomes %-codes in a web address. The phone's map engine crashes on %-codes
// when a tile fails to load, so the app asks this helper with a clean address and the helper talks to NOAA.
// Bonus: when NOAA is busy and answers with an error page instead of a picture, the helper answers "no tile"
// (HTTP 204) so the map simply skips that square.
//
//   /chart?bbox=<xmin,ymin,xmax,ymax>&layers=0,1,2,6&ls=1&cs=0&ps=2&look=clean&hd=1   → NOAA chart tile (PNG)
//     look = clean | standard | full (see LOOKS) · hd=1 = sharper coastline when zoomed out (see HD_STEPS)
//   /relief?bbox=<xmin,ymin,xmax,ymax>                                  → NOAA NCEI colored seafloor relief tile

// The app's server, pinged by the keep-awake timer at the bottom of this file.
const KEEP_AWAKE = 'https://fishing-app-api-pzto.onrender.com/health';

const CHART = 'https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export';
const RELIEF = 'https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer/exportImage';

const BBOX = /^-?\d+(\.\d+)?(e[-+]?\d+)?(,-?\d+(\.\d+)?(e[-+]?\d+)?){3}$/i;
const LAYERS = /^\d{1,2}(,\d{1,2}){0,15}$/;
const ONE = (v, allowed, dflt) => (allowed.includes(Number(v)) ? Number(v) : dflt);

// Chart styles (look=): how busy the chart is.
//   clean    → S-52 display categories base + standard (coastline, depth areas, main depth lines; no spot depths)
//   standard → + "other" (spot depths, names, minor features); features appear/disappear with zoom (SCAMIN) as NOAA intends
//   full     → everything, and SCAMIN off: all depth numbers and contours even when zoomed out
const LOOKS = {
  clean: { DisplayCategory: '1,2', HonorScamin: 2 },
  standard: { DisplayCategory: '1,2,4', HonorScamin: 2 },
  full: { DisplayCategory: '1,2,4', HonorScamin: 1 },
};

// Zoomed-out detail (hd=1). NOAA picks a coarse "overview" chart (rounded, blobby islands) when a picture covers a
// big area. Asking for a bigger picture of the same area makes NOAA use its detailed coastline. Text and symbols
// get a bit smaller when zoomed out — that's the trade. Tune here without an app update:
//   picture width in meters (web map units) above which a bigger image is requested → image size in pixels
// Oct 28: also for the middle zooms (harbors, coastline, breakwaters show ~1 zoom level sooner). Was [[100000, 1536], [50000, 1280]].
const HD_STEPS = [[100000, 1792], [50000, 1536], [25000, 1408], [12500, 1280]];   // ≤ zoom 9 · 10 · 11 · 12; closer → 1024 px

function sizeFor(p) {
  if (p.get('hd') !== '1') return 1024;
  const [x0, , x1] = p.get('bbox').split(',').map(Number);
  const w = Math.abs(x1 - x0);
  for (const [minW, px] of HD_STEPS) if (w >= minW) return px;
  return 1024;
}

function chartUrl(p, blue = ({ '1': 1, '2': 2 })[p.get('wb')] || 0) {
  const look = LOOKS[p.get('look')] || (p.get('fd') === '1' ? LOOKS.full : null);
  const params = {
    ECDISParameters: {
      version: '10.9.1',
      DynamicParameters: {
        Parameter: [
          { name: 'DisplayLightSectors', value: ONE(p.get('ls'), [1, 2], 1) },
          { name: 'ColorScheme', value: ONE(p.get('cs'), [0, 1, 2], 0) },
          { name: 'PointSymbolizationType', value: ONE(p.get('ps'), [1, 2], 2) },
          ...(look ? [{ name: 'DisplayCategory', value: look.DisplayCategory }, { name: 'HonorScamin', value: look.HonorScamin }] : []),
          // Blue water everywhere. NOAA paints water deeper than its "deep contour" (30 m) white.
          //  wb=1 (Oct 28): deep contour → 9000 m: offshore water becomes the pale "medium-deep" blue.
          //  wb=2 (Oct 29): safety contour → 9000 m too: offshore water becomes the same blue NOAA uses along the
          //  coast ("medium-shallow"); the very shallow strip right at the shore stays a shade darker.
          ...(blue === 2 ? [{ name: 'SafetyContour', value: 9000 }, { name: 'DeepContour', value: 9001 }] : blue ? [{ name: 'DeepContour', value: 9000 }] : []),
        ],
      },
    },
  };
  const layers = LAYERS.test(p.get('layers') || '') ? p.get('layers') : '0,1,2,3,4,5,6';
  const px = sizeFor(p);
  return `${CHART}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=${px},${px}&dpi=192&format=png&transparent=true&f=image`
    + `&layers=show:${layers}&display_params=${encodeURIComponent(JSON.stringify(params))}`;
}

function reliefUrl(p) {
  return `${RELIEF}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=1024,1024&format=png&f=image`
    + `&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: 'ColorHillshade' }))}`;
}

async function tile(url, fallback) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(attempt === 1 && fallback ? fallback : url, { headers: { 'User-Agent': 'ChannelNav-chart-helper' }, cf: { cacheTtl: 604800, cacheEverything: true } });
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
    // If NOAA ever refuses the blue-water setting, the retry asks for the normal chart (never a blank square).
    if (u.pathname === '/chart') return tile(chartUrl(p), p.get('wb') ? chartUrl(p, 0) : null);
    if (u.pathname === '/relief') return tile(reliefUrl(p));
    return new Response('not found', { status: 404 });
  },
  // Keep-awake: Render's free server sleeps after 15 quiet minutes, and the next angler waits ~1 minute.
  // Add a Cron Trigger "*/10 * * * *" to this Worker (Settings → Triggers) and it pings the API every 10 minutes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(KEEP_AWAKE, { headers: { 'user-agent': 'channelnav-keepawake' } }).catch(() => {}));
  },
};
