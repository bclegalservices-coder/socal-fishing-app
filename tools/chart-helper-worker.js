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
  // Oct 29 v2: depth numbers + depth lines only (chart group 2 WITHOUT "display base", which is where NOAA's water
  // fill lives). The app draws this over its own baby-blue water.
  depths: { DisplayCategory: '2,4', HonorScamin: 2 },
  depthsfull: { DisplayCategory: '2,4', HonorScamin: 1 },
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

// Oct 30 v2: why depth lines stopped along a line offshore when zoomed out. NOAA's chart is a patchwork of charts at
// different scales, and each chart says from which zoom its depth lines appear ("SCAMIN"). The big-area chart shows
// them early, the harbor-approach charts (LA/LB, San Diego…) only when zoomed in — so zoomed out, the approach charts'
// water was empty. For the depth layer, zoomed out, we switch SCAMIN off: every chart draws its lines.
//   map squares wider than DEPTH_LINES_ONLY_W (zoom ≤ 11): all depth LINES, no numbers (numbers would be a carpet)
//   wider than DEPTH_ALL_W (zoom 12):                      all lines + numbers
//   closer:                                                as NOAA intends (numbers thin out / fill in with zoom)
const DEPTH_LINES_ONLY_W = 15000;
const DEPTH_ALL_W = 7500;
function depthLook(p, look) {
  if (look !== LOOKS.depths && look !== LOOKS.depthsfull) return look;
  const [x0, , x1] = p.get('bbox').split(',').map(Number);
  const w = Math.abs(x1 - x0);
  // Map Studio can try other switch points: &dlw=<m> &daw=<m> (0 = never)
  const num = (k, d) => { const v = Number(p.get(k)); return p.get(k) !== null && Number.isFinite(v) && v >= 0 ? v : d; };
  const linesOnly = num('dlw', DEPTH_LINES_ONLY_W), all = num('daw', DEPTH_ALL_W);
  if (linesOnly > 0 && w >= linesOnly) return { DisplayCategory: '2', HonorScamin: 1 };
  if (all > 0 && w >= all) return { DisplayCategory: '2,4', HonorScamin: 1 };
  return look;
}

function chartUrl(p, blue = ({ '1': 1, '2': 2 })[p.get('wb')] || 0) {
  const look = depthLook(p, LOOKS[p.get('look')] || (p.get('fd') === '1' ? LOOKS.full : null));
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
  return `${CHART}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=${px},${px}&dpi=192&format=${p.get('wc') === '1' ? 'png8' : 'png'}&transparent=true&f=image`
    + `&layers=show:${layers}&display_params=${encodeURIComponent(JSON.stringify(params))}`;
}

// ---- Water color (Oct 29, wc=1): NOAA's water blues → a soft "Google Maps" baby blue.
// The chart is asked for as an 8-bit (palette) PNG, so the repaint only touches the color list (a few hundred bytes) —
// no pixels are decoded, which keeps the helper well inside Cloudflare's free CPU limit. Anything unexpected → the
// picture is sent unchanged.
const VERSION = '2026-11-02b';
const WATER_TARGET = [170, 218, 255];            // #AADAFF — every normal water blue becomes exactly this
const WATER_SHADE_FROM = 190;                     // NOAA blues darker than this (the very shallow strip) stay a bit darker
function isWater(r, g, b) { return b - r >= 18 && b >= g - 6 && r >= 70 && b >= 160; }
function waterColor(r, g, b) {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const dark = Math.max(0, WATER_SHADE_FROM - lum) * 0.8;
  return WATER_TARGET.map((c) => Math.max(0, Math.round(c - dark)));
}
let CRC_T = null;
function crc32(bytes) {
  if (!CRC_T) { CRC_T = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function recolorPng(buf, stats = {}) {
  const u = new Uint8Array(buf);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u.length < 33 || dv.getUint32(0) !== 0x89504e47) { stats.skip = 'not a PNG'; return buf; }
  stats.colorType = u[25];
  if (u[25] !== 3) { stats.skip = 'not a palette PNG'; return buf; }   // only palette PNGs (color type 3)
  let off = 8;
  while (off + 12 <= u.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(u[off + 4], u[off + 5], u[off + 6], u[off + 7]);
    if (type === 'PLTE') {
      const d = off + 8;
      stats.palette = len / 3; stats.recolored = 0; stats.samples = [];
      for (let i = 0; i + 2 < len; i += 3) {
        const r = u[d + i], g = u[d + i + 1], b = u[d + i + 2];
        if (!isWater(r, g, b)) continue;
        const c = waterColor(r, g, b);
        if (stats.samples.length < 6) stats.samples.push(`${r},${g},${b} → ${c.join(',')}`);
        u[d + i] = c[0]; u[d + i + 1] = c[1]; u[d + i + 2] = c[2]; stats.recolored++;
      }
      dv.setUint32(d + len, crc32(u.subarray(off + 4, d + len)));
      return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);
    }
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len;
  }
  return buf;
}

function reliefUrl(p) {
  return `${RELIEF}?bbox=${p.get('bbox')}&bboxSR=3857&imageSR=3857&size=1024,1024&format=png&f=image`
    + `&renderingRule=${encodeURIComponent(JSON.stringify({ rasterFunction: 'ColorHillshade' }))}`;
}

async function tile(url, fallback, recolor = false, info = null) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(attempt === 1 && fallback ? fallback : url, { headers: { 'User-Agent': 'ChannelNav-chart-helper' }, cf: { cacheTtl: 604800, cacheEverything: true } });
    const type = r.headers.get('content-type') || '';
    if (info) { info.attempt = attempt + 1; info.usedFallback = attempt === 1 && !!fallback; info.status = r.status; info.contentType = type; }
    if (r.ok && type.startsWith('image/')) {
      let body = r.body;
      const stats = {};
      if (recolor && type.includes('png')) {
        try { body = recolorPng(await r.arrayBuffer(), stats); } catch (e) { stats.error = String(e).slice(0, 80); body = null; }
        if (body === null) continue;                // couldn't read it: try once more (plain)
      }
      if (info) Object.assign(info, stats);
      return new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*',
        'x-channelnav-water': JSON.stringify(stats).slice(0, 300) } });
    }
    await new Promise((res) => setTimeout(res, 400));   // NOAA busy: wait a moment and try once more
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });   // "no tile here", never an error page
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const p = u.searchParams;
    if (u.pathname === '/' || u.pathname === '/health') return new Response(`Channel Nav chart helper: ok · version ${VERSION} · speed cache ${env && env.TILES ? 'ON' : 'off'}`);
    // Open https://<this helper>/check in a browser: draws one chart square off Catalina and reports what happened.
    if (u.pathname === '/check') {
      const q = new URLSearchParams('bbox=-13190000,3930000,-13170000,3950000&layers=0,1,2&ls=1&cs=0&ps=2&look=standard&hd=1&wb=2&wc=1');
      const info = { version: VERSION, water: {} };
      try { await tile(chartUrl(q), chartUrl(q, 0), true, info.water); } catch (e) { info.water.error = String(e).slice(0, 120); }
      // what NOAA sends for each picture format (so we know which one can be recolored cheaply)
      info.formats = {};
      for (const fmt of ['png8', 'png', 'png24', 'png32']) {
        try {
          const r = await fetch(chartUrl(q).replace(/format=png8?/, `format=${fmt}`), { headers: { 'User-Agent': 'ChannelNav-chart-helper' } });
          const b = new Uint8Array(await r.arrayBuffer());
          info.formats[fmt] = { status: r.status, type: r.headers.get('content-type'), bytes: b.length, pngColorType: b[0] === 0x89 ? b[25] : null };
        } catch (e) { info.formats[fmt] = { error: String(e).slice(0, 80) }; }
      }
      return new Response(JSON.stringify(info, null, 2), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    // Nov 2: NOAA ERDDAP relay for the data job. NOAA blocks GitHub's shared machines; this helper isn't blocked.
    //   /erddap/<noaa host>/<path>?<query>  →  https://<noaa host>/<path>?<query>   (NOAA ERDDAP hosts only, GET only)
    if (u.pathname.startsWith('/erddap/')) {
      const m = u.pathname.match(/^\/erddap\/((?:coastwatch|upwell)\.pfeg\.noaa\.gov|coastwatch\.noaa\.gov|polarwatch\.noaa\.gov)(\/erddap\/.*)$/);
      if (!m || request.method !== 'GET') return new Response('not allowed', { status: 403 });
      const r = await fetch(`https://${m[1]}${m[2]}${u.search}`, { headers: { 'User-Agent': 'ChannelNav-data-relay' } });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' } });
    }
    // Nov 2: plane-network relay for the app's server, in case a network blocks or stalls on Render.
    //   /feed/<host>/<path>  →  https://<host>/<path>   (only the three open ADS-B networks, GET only)
    if (u.pathname.startsWith('/feed/')) {
      const m = u.pathname.match(/^\/feed\/(api\.adsb\.lol|api\.airplanes\.live|opendata\.adsb\.fi)(\/.*)$/);
      if (!m || request.method !== 'GET') return new Response('not allowed', { status: 403 });
      const r = await fetch(`https://${m[1]}${m[2]}${u.search}`, { headers: { 'User-Agent': 'ChannelNav-relay', Accept: 'application/json' } });
      return new Response(r.body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
    }
    if (!BBOX.test(p.get('bbox') || '')) return new Response('bad bbox', { status: 400 });
    // If NOAA ever refuses the blue-water setting, the retry asks for the normal chart (never a blank square).
    if (u.pathname !== '/chart' && u.pathname !== '/relief') return new Response('not found', { status: 404 });
    // Oct 30 speed-up: every chart square NOAA has drawn once is kept in an R2 bucket (binding name TILES) for 30 days,
    // so the next angler gets it in a fraction of a second instead of waiting 1–4 s on NOAA. No bucket bound = works as before.
    const key = `v2${u.pathname}?${[...p.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
    const r2 = env && env.TILES;
    if (r2) {
      try {
        const hit = await r2.get(key);
        if (hit && Date.now() - hit.uploaded.getTime() < 30 * 86400e3) {
          return new Response(hit.body, { headers: { 'content-type': hit.httpMetadata?.contentType || 'image/png', 'cache-control': 'public, max-age=604800',
            'access-control-allow-origin': '*', 'x-channelnav-cache': 'hit' } });
        }
      } catch (e) { /* bucket trouble: just draw it */ }
    }
    const res = u.pathname === '/chart'
      ? await tile(chartUrl(p), p.get('wb') ? chartUrl(p, 0) : null, p.get('wc') === '1')
      : await tile(reliefUrl(p));
    if (!r2 || res.status !== 200) return res;
    const bytes = await res.arrayBuffer();
    const type = res.headers.get('content-type') || 'image/png';
    if (ctx) ctx.waitUntil(r2.put(key, bytes, { httpMetadata: { contentType: type } }).catch(() => {}));
    return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800', 'access-control-allow-origin': '*', 'x-channelnav-cache': 'miss' } });
  },
  // Keep-awake: Render's free server sleeps after 15 quiet minutes, and the next angler waits ~1 minute.
  // Add a Cron Trigger "*/10 * * * *" to this Worker (Settings → Triggers) and it pings the API every 10 minutes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(fetch(KEEP_AWAKE, { headers: { 'user-agent': 'channelnav-keepawake' } }).catch(() => {}));
  },
};
