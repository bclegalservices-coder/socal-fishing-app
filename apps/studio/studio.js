// Ad Studio — advertisers upload & preview ads, see prices and results; the owner reviews, schedules and gets paid.
// Plain JavaScript, no build step. Data lives in Supabase (row-level security decides who sees what).
'use strict';

const CFG = window.STUDIO || {};
const configured = CFG.supabaseUrl && !CFG.supabaseUrl.includes('YOUR-PROJECT') && CFG.anonKey && !CFG.anonKey.startsWith('YOUR-');
const sb = configured ? supabase.createClient(CFG.supabaseUrl, CFG.anonKey) : null;
const API = (CFG.apiUrl || '').replace(/\/$/, '');
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ------------------------------------------------------------------ small helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => { const v = (Number(c) || 0) / 100; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }); };
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return iso(d); };
const nice = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const niceShort = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const today = () => iso(new Date());
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return iso(d); };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const must = (r) => { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; };
function toast(msg, bad = false) {
  const t = document.createElement('div'); t.className = `toast${bad ? ' bad' : ''}`; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}
const fail = (e) => { console.error(e); toast(e?.message || String(e), true); };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

// ------------------------------------------------------------------ what can be bought
const AREAS = ['Los Angeles', 'Orange County', 'San Diego', 'Santa Barbara / Ventura', 'Catalina', 'San Clemente Island', 'Channel Islands', 'Offshore SoCal', 'North Baja'];
const TAGS = ['tuna', 'yellowtail', 'dorado', 'calico bass', 'halibut', 'white seabass', 'rockfish', 'lobster', 'offshore', 'inshore', 'kayak', 'pier & shore'];
const SPOTS = {
  banner_dashboard: { title: 'Daily report banner', where: 'On the "SoCal Fishing Today" screen anglers open every morning', size: [1200, 375], kinds: ['image', 'gif', 'video', 'html5', 'native'], screen: 'today' },
  banner_reports: { title: 'Catch reports banner', where: 'Top of the live catch-report feed', size: [1200, 375], kinds: ['image', 'gif', 'video', 'html5', 'native'], screen: 'reports' },
  banner_community: { title: 'Forum banner', where: 'Top of the community forum', size: [1200, 375], kinds: ['image', 'gif', 'video', 'html5', 'native'], screen: 'forum' },
  sponsor_intro: { title: 'App-open sponsor (5 sec)', where: 'Full screen for 5 seconds when the app opens — only at the dock, never while driving the boat', size: [1080, 1920], kinds: ['image', 'gif', 'video', 'html5', 'pdf', 'native'], screen: 'intro', maxVideo: 10 },
  banner_weather: { title: 'Weather page banner', where: 'Middle of the Weather tab, right after the hour-by-hour forecast anglers check before every trip', size: [1200, 375], kinds: ['image', 'gif', 'video', 'html5', 'native'], screen: 'today' },
  featured_listing: { title: 'Featured business pin', where: 'A gold ★ pin with your name on the map, right where your fuel dock, bait or marina is — shows when anglers switch on Fuel, Bait or Marinas. Tap opens directions.', size: [512, 512], kinds: ['native'], screen: 'presented', logo: true },
  presented_by: { title: '"Presented by" sponsor', where: 'Your logo and name on a whole section — only one sponsor per section per week', size: [512, 512], kinds: ['image', 'native'], screen: 'presented', logo: true },
};
const KIND_LABEL = { image: 'Image', gif: 'Animated GIF', video: 'Video', html5: 'HTML5 animation', native: 'Quick ad', pdf: 'PDF flyer' };
const LIMITS = { image: 3, gif: 5, video: 20, html5: 1, pdf: 15 }; // MB
const spotKey = (p, s) => `${p}|${s || ''}`;
const spotOf = (p) => SPOTS[p] || { title: p, size: [1200, 375], kinds: ['image'], screen: 'today' };
const spotTitle = (p, s) => (p === 'presented_by' ? `${s} — presented by you` : spotOf(p).title);

// ------------------------------------------------------------------ app state
const S = { user: null, owner: false, advs: [], adv: null, rates: [], discounts: [], cfg: {}, stripe: false, charts: [] };
function clearCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
function chart(el, type, labels, datasets, opts = {}) {
  if (!window.Chart || !el) return;
  S.charts.push(new Chart(el, { type, data: { labels, datasets }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: datasets.length > 1 } }, scales: { y: { beginAtZero: true } }, ...opts } }));
}

async function loadBasics() {
  const [rates, disc, cfg] = await Promise.all([
    sb.from('ad_rates').select('*').order('placement').order('section'),
    sb.from('ad_discounts').select('*').order('min_weeks'),
    sb.from('app_config').select('key,value').in('key', ['ad_area_price_factor', 'ad_business_name', 'ad_payment_instructions', 'ads_enabled']),
  ]);
  S.rates = must(rates); S.discounts = must(disc);
  S.cfg = Object.fromEntries(must(cfg).map((r) => [r.key, r.value]));
  try { S.stripe = !!(await (await fetch(`${API}/billing/config`)).json()).stripe; } catch { S.stripe = false; }
  S.advs = must(await sb.from('advertisers').select('*').order('name'));
  const remembered = store.get('studio-adv', null);
  S.adv = S.owner ? (S.advs.find((a) => a.id === remembered) ?? null) : S.advs[0] ?? null;
  $('#appName').textContent = CFG.appName || S.cfg.ad_business_name || 'Ad Studio';
}

// ------------------------------------------------------------------ order status in plain words
function orderState(o) {
  const t = today();
  if (o.status === 'draft') return ['Draft', ''];
  if (o.status === 'submitted') return ['Waiting for review', 'warn'];
  if (o.status === 'changes_requested') return ['Changes requested', 'bad'];
  if (o.status === 'rejected') return ['Not approved', 'bad'];
  if (o.status === 'cancelled') return ['Cancelled', ''];
  const paidOk = ['paid', 'comped'].includes(o.payment_status) || o.run_unpaid;
  if (!paidOk) return ['Approved — payment due', 'warn'];
  if (o.paused) return ['Paused', ''];
  if (o.end_date <= t) return ['Finished', ''];
  if (o.start_date > t) return ['Scheduled', 'ok'];
  return ['Live now', 'live'];
}
const statePill = (o) => { const [l, c] = orderState(o); return `<span class="pill ${c}">${esc(l)}</span>`; };
const payPill = (o) => ({ paid: '<span class="pill ok">Paid</span>', comped: '<span class="pill live">Free / comped</span>', refunded: '<span class="pill">Refunded</span>' }[o.payment_status]
  ?? (o.status === 'approved' ? '<span class="pill warn">Unpaid</span>' : '<span class="pill">Not billed yet</span>'));
const dates = (o) => `${niceShort(o.start_date)} – ${nice(addDays(o.end_date, -1))} · ${o.weeks} wk`;
const areaText = (a) => (!a || !a.length ? 'All of SoCal' : a.join(', '));

// ------------------------------------------------------------------ creative rendering (Studio + phone previews)
function mediaHtml(c, cls = 'media') {
  if (!c) return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;color:#6E8291">Your ad here</div>`;
  if (c.kind === 'video') return `<video class="${cls}" src="${esc(c.media_url)}" ${c.poster_url ? `poster="${esc(c.poster_url)}"` : ''} muted autoplay loop playsinline></video>`;
  if (c.kind === 'html5') return `<iframe class="${cls}" sandbox="allow-scripts" data-html="${esc(c.html_url)}" title="HTML5 ad" scrolling="no"></iframe>`;
  if (c.kind === 'native') return nativeHtml(c);
  return `<img class="${cls}" src="${esc(c.media_url)}" alt="${esc(c.headline || 'Ad')}">`;
}
function nativeHtml(c, big = false) {
  return `<div class="native" style="${big ? 'flex-direction:column;text-align:center;gap:12px' : ''}">
    ${c.logo_url ? `<img src="${esc(c.logo_url)}" alt="" style="${big ? 'width:120px;height:120px;border-radius:24px' : ''}">` : ''}
    <div style="flex:1;min-width:0"><div class="t" style="${big ? 'font-size:20px' : ''}">${esc(c.headline || '')}</div><div class="b" style="${big ? 'font-size:14px' : ''}">${esc(c.body || '')}</div></div>
    ${c.cta_label ? `<span class="ad-cta">${esc(c.cta_label)}</span>` : ''}</div>`;
}
const htmlCache = {};
function hydrateFrames(root = document) {
  $$('iframe[data-html]', root).forEach(async (f) => {
    const url = f.dataset.html;
    try { htmlCache[url] = htmlCache[url] ?? await (await fetch(url)).text(); f.srcdoc = htmlCache[url]; } catch { f.srcdoc = '<p style="color:#999;font:13px sans-serif">Preview unavailable</p>'; }
  });
}
function actionLabel(c) {
  if (!c) return '';
  return { website: c.cta_label || 'Learn more', call: c.cta_label || 'Call', directions: c.cta_label || 'Directions', coupon: c.cta_label || 'Get coupon', none: '' }[c.action_type] ?? '';
}

// Phone mockups — same layout and colors as the real app screens. Numbers on them are labeled "sample".
function phone(spot, c, adv, section) {
  const name = esc(adv?.name || 'Your business');
  const banner = () => `<div class="ad-banner"><div style="padding:4px 8px 0"><span class="sponsored">SPONSORED · ${name}</span></div>
      ${c?.kind === 'native' ? nativeHtml(c) : mediaHtml(c)}
      ${c && c.kind !== 'native' && actionLabel(c) ? `<div class="cap"><span class="sponsored">${esc(c.headline || '')}</span><span class="ad-cta">${esc(actionLabel(c))}</span></div>` : ''}</div>`;
  let body = '';
  if (spot.screen === 'today') {
    body = `<div class="app-h">SoCal Fishing Today</div><div class="app-s">What's biting, water and weather</div><span class="sample">sample data</span>
      <div class="app-card"><div class="app-row"><span>Yellowtail</span><b>×14</b></div><div class="app-row"><span>Bluefin tuna</span><b>×6</b></div><div class="app-row"><span>Calico bass</span><b>×31</b></div></div>
      ${banner()}
      <div class="app-card"><div class="app-row"><span>Water temp</span><b>66–71°F</b></div><div class="app-row"><span>Strong breaks</span><b>3</b></div></div>`;
  } else if (spot.screen === 'reports') {
    body = `<div class="app-h">Community</div><div class="app-s">Catch reports · last 24 h</div><span class="sample">sample data</span>${banner()}
      ${['Yellowtail ×3 · Catalina', 'Halibut · Long Beach', 'Bluefin ×2 · 43 Fathom'].map((t) => `<div class="app-card"><b>${t}</b><div class="app-s" style="padding:0">Surface iron · 2 h ago</div></div>`).join('')}`;
  } else if (spot.screen === 'forum') {
    body = `<div class="app-h">Community</div><div class="app-s">Forum</div><span class="sample">sample data</span>${banner()}
      ${['Fishing Reports', 'Offshore', 'Catalina', 'Kayak Fishing'].map((t) => `<div class="app-card"><b>${t}</b></div>`).join('')}`;
  } else if (spot.screen === 'intro') {
    const isNative = c?.kind === 'native';
    body = `<div class="intro"><div style="font-weight:800;font-size:16px">Today's SoCal fishing conditions</div><div class="app-s" style="padding:0">presented by</div>
      ${isNative ? nativeHtml(c, true) : mediaHtml(c)}<div style="font-weight:800">${name}</div><span class="sponsored">SPONSORED · 5</span></div>`;
  } else {
    const logo = c?.kind === 'native' ? (c.logo_url || adv?.logo_url) : (c?.media_url || adv?.logo_url);
    const sec = section || 'Weather';
    const lead = sec === 'Weather' ? 'Marine forecast presented by' : sec === 'Today' ? 'Fishing report presented by' : `${sec} presented by`;
    body = `<div class="app-h">${esc(sec === 'Today' ? 'SoCal Fishing Today' : sec)}</div><span class="sample">sample data</span>
      <div class="pb">${esc(lead)} ${logo ? `<img src="${esc(logo)}" alt="">` : ''}<b>${esc(c?.headline || adv?.name || 'Your business')}</b></div>
      <div class="app-card"><div class="app-row"><span>Today</span><b>🟢 Comfortable</b></div><div class="app-row"><span>Wind</span><b>8 kt W</b></div><div class="app-row"><span>Seas</span><b>3 ft @ 13 s</b></div></div>
      <div class="app-card"><div class="app-row"><span>Tomorrow</span><b>🟡 Bumpy</b></div><div class="app-row"><span>Wind</span><b>15 kt NW</b></div></div>`;
  }
  return `<div class="phone"><div class="screen"><div class="notch"></div>${body}
    ${spot.screen === 'intro' ? '' : '<div class="app-tabs"><span>🗺 Map</span><span>🌤 Weather</span><span>◎ Spots</span><span>💬 Community</span><span>🎣 Fishing</span></div>'}</div></div>`;
}

// ------------------------------------------------------------------ file handling (all in the browser — no server needed)
async function uploadBlob(blob, ext, contentType) {
  const path = `${S.user.id}/${uuid()}.${ext}`;
  must(await sb.storage.from('ad-media').upload(path, blob, { contentType, upsert: false, cacheControl: '31536000' }));
  return sb.storage.from('ad-media').getPublicUrl(path).data.publicUrl;
}
const imgSize = (url) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok([i.naturalWidth, i.naturalHeight]); i.onerror = () => no(new Error('Could not read that image')); i.src = url; });
function videoInfo(file) {
  return new Promise((ok, no) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = URL.createObjectURL(file);
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0);
      cv.toBlob((poster) => ok({ w: v.videoWidth, h: v.videoHeight, duration: v.duration, poster }), 'image/jpeg', 0.85);
    };
    v.onerror = () => no(new Error('That video format isn\'t supported — export as MP4 (H.264).'));
  });
}
async function pdfFirstPage(file, width) {
  if (!window.pdfjsLib) throw new Error('PDF reader didn\'t load — check your connection');
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await pdf.getPage(1);
  const v1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: width / v1.width });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  return { blob, w: cv.width, h: cv.height, pages: pdf.numPages };
}
// HTML5 banners: a .zip from Google Web Designer / Adobe Animate / Canva → ONE self-contained file (styles, scripts and images inlined).
async function bundleHtml5(file) {
  if (/\.html?$/i.test(file.name)) return await file.text();
  if (!window.JSZip) throw new Error('Zip reader didn\'t load — check your connection');
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith('__MACOSX'));
  const indexName = names.filter((n) => /(^|\/)index\.html?$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!indexName) throw new Error('The zip needs an index.html file');
  const base = indexName.includes('/') ? indexName.slice(0, indexName.lastIndexOf('/') + 1) : '';
  const resolve = (ref) => { if (/^(https?:|data:|\/\/)/i.test(ref)) return null; const parts = (base + ref.split(/[?#]/)[0]).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } return out.join('/'); };
  const mime = (n) => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', mp4: 'video/mp4', json: 'application/json' }[n.split('.').pop().toLowerCase()] || 'application/octet-stream');
  const dataUri = async (n) => `data:${mime(n)};base64,${await zip.file(n).async('base64')}`;
  const inlineUrls = async (css) => {
    const refs = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]);
    for (const r of refs) { const n = resolve(r); if (n && zip.file(n)) css = css.split(r).join(await dataUri(n)); }
    return css;
  };
  let html = await zip.file(indexName).async('string');
  for (const m of [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi)]) {
    const n = resolve(m[1]); if (n && zip.file(n)) html = html.replace(m[0], `<style>${await inlineUrls(await zip.file(n).async('string'))}</style>`);
  }
  for (const m of [...html.matchAll(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi)]) {
    const n = resolve(m[2]); if (n && zip.file(n)) html = html.replace(m[0], `<script${m[1]}${m[3]}>${(await zip.file(n).async('string')).replace(/<\/script/gi, '<\\/script')}</script>`);
  }
  for (const m of [...html.matchAll(/(src|href|poster)=["']([^"']+)["']/gi)]) {
    const n = resolve(m[2]); if (n && zip.file(n) && !/\.(html?|css|js)$/i.test(n)) html = html.split(m[0]).join(`${m[1]}="${await dataUri(n)}"`);
  }
  html = await inlineUrls(html);
  return html;
}

// Reads any dropped file → a creative draft (uploaded) + friendly checks. Nothing is saved to the database yet.
async function processFile(file, spot, onStatus) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const type = file.type || '';
  let kind = type.startsWith('video/') || ['mp4', 'mov', 'm4v', 'webm'].includes(ext) ? 'video'
    : ext === 'gif' ? 'gif' : ext === 'pdf' ? 'pdf' : ['zip', 'html', 'htm'].includes(ext) ? 'html5'
      : type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext) ? 'image' : null;
  if (!kind) throw new Error('Use a PNG, JPG, WebP, GIF, MP4, PDF, or an HTML5 .zip');
  if (!spot.kinds.includes(kind)) {
    if (spot.logo && kind !== 'image') throw new Error('"Presented by" uses your logo — upload a PNG (transparent background looks best)');
    throw new Error(`${KIND_LABEL[kind]} isn't available for this spot. Use: ${spot.kinds.map((k) => KIND_LABEL[k]).join(', ')}`);
  }
  const mb = file.size / 1048576; const checks = [];
  const lim = LIMITS[kind] ?? 5;
  if (kind !== 'html5' && mb > lim) throw new Error(`That file is ${mb.toFixed(1)} MB — the limit for ${KIND_LABEL[kind]} is ${lim} MB. Export a smaller version.`);
  checks.push(['ok', `${KIND_LABEL[kind]} · ${mb.toFixed(1)} MB`]);
  const [W, H] = spot.size; const want = W / H;
  const ratioCheck = (w, h) => {
    const r = w / h; const off = Math.abs(r - want) / want;
    if (off < 0.06) checks.push(['ok', `${w} × ${h} px — right shape`]);
    else checks.push(['warn', `${w} × ${h} px — this spot is ${W} × ${H}. It will be ${r > want ? 'cropped on the sides' : 'letterboxed'}.`]);
    if (w < W * 0.6) checks.push(['warn', `Small image — it may look soft on big phones. ${W} × ${H} px is best.`]);
  };
  const c = { kind, bytes: file.size };
  if (kind === 'image' || kind === 'gif') {
    onStatus('Uploading…');
    c.media_url = await uploadBlob(file, ext === 'jpeg' ? 'jpg' : ext, type || `image/${ext}`);
    [c.width, c.height] = await imgSize(c.media_url); ratioCheck(c.width, c.height);
  } else if (kind === 'video') {
    onStatus('Reading the video…');
    const v = await videoInfo(file);
    const max = spot.maxVideo || 15;
    if (v.duration > max + 0.5) throw new Error(`Videos for this spot can be up to ${max} seconds — yours is ${Math.round(v.duration)} s.`);
    c.width = v.w; c.height = v.h; c.duration_s = Math.round(v.duration * 10) / 10; ratioCheck(v.w, v.h);
    checks.push(['ok', `${c.duration_s} s · plays muted and loops (sound never plays automatically)`]);
    onStatus('Uploading…');
    c.media_url = await uploadBlob(file, ext === 'mov' ? 'mov' : 'mp4', type || 'video/mp4');
    if (v.poster) c.poster_url = await uploadBlob(v.poster, 'jpg', 'image/jpeg');
  } else if (kind === 'pdf') {
    onStatus('Reading the PDF…');
    const p = await pdfFirstPage(file, 1080);
    c.width = p.w; c.height = p.h; ratioCheck(p.w, p.h);
    checks.push(['ok', `Page 1 is shown in the app${p.pages > 1 ? ` (your PDF has ${p.pages} pages — anglers can open all of it)` : ''}`]);
    onStatus('Uploading…');
    c.media_url = await uploadBlob(p.blob, 'png', 'image/png');
    c.pdf_url = await uploadBlob(file, 'pdf', 'application/pdf');
  } else if (kind === 'html5') {
    onStatus('Packing the animation…');
    const html = await bundleHtml5(file);
    const kb = new Blob([html]).size / 1024;
    if (kb > 1024) throw new Error(`The animation is ${Math.round(kb)} KB after packing — keep it under 1 MB (smaller images help).`);
    checks.push(['ok', `Packed into one file · ${Math.round(kb)} KB`]);
    if (/(document\.cookie|localStorage|navigator\.geolocation)/.test(html)) checks.push(['warn', 'It tries to use cookies/storage/location — that is blocked in the app.']);
    checks.push(['ok', 'Runs locked down: no access to the app or the angler\'s data']);
    onStatus('Uploading…');
    c.html_url = await uploadBlob(new Blob([html], { type: 'text/html' }), 'html', 'text/html');
    htmlCache[c.html_url] = html; c.width = W; c.height = H;
  }
  return { c, checks };
}

// ------------------------------------------------------------------ routing & chrome
function navLinks(active) {
  const links = S.owner
    ? [['owner', 'Dashboard'], ['inbox', 'To review'], ['ads', 'All ads'], ['calendar', 'Calendar'], ['money', 'Money'], ['advertisers', 'Advertisers'], ['prices', 'Prices'], ['new', '➕ New ad']]
    : [['home', 'My ads'], ['new', '➕ New ad'], ['business', 'My business']];
  $('#nav').innerHTML = links.map(([k, l]) => `<a href="#${k}" class="${active === k ? 'on' : ''}">${l}</a>`).join('');
  $('#who').innerHTML = S.user ? `<span>${esc(S.user.email)}${S.owner ? ' · owner' : ''}</span><button id="out">Sign out</button>` : '';
  if ($('#out')) $('#out').onclick = async () => { await sb.auth.signOut(); location.hash = ''; location.reload(); };
}
const ROUTES = {};
async function route() {
  clearCharts();
  const [path, query] = location.hash.slice(1).split('?');
  const [name, arg] = (path || (S.owner ? 'owner' : 'home')).split('/');
  const q = new URLSearchParams(query || '');
  const view = ROUTES[name] || ROUTES[S.owner ? 'owner' : 'home'];
  navLinks(name);
  $('#main').innerHTML = '<div class="card">Loading…</div>';
  try { await view(arg, q); hydrateFrames(); } catch (e) { $('#main').innerHTML = `<div class="card note red">${esc(e.message || e)}</div>`; console.error(e); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

// ------------------------------------------------------------------ sign in & business setup
function viewNotConfigured() {
  $('#main').innerHTML = `<div class="card"><h1>Almost there</h1><p>Open <b>config.js</b> and fill in your Supabase URL, anon key and API URL (SETUP.md → Part P).</p></div>`;
}
function viewSignIn() {
  navLinks('');
  $('#main').innerHTML = `<div class="grid2">
    <div class="card"><h1>Advertise to SoCal anglers</h1>
      <p class="sub">Upload your ad, see exactly how it looks in the app, pick your dates and area, and see the price up front.
      Every ad is reviewed by a real person before it goes live, and you get a report of views, taps, calls and coupon saves.</p>
      <ul class="checks"><li>✅ Images, Canva designs, GIFs, short videos, PDF flyers & coupons, HTML5 animations</li>
      <li>✅ Target all of SoCal or just your area</li><li>✅ Pay by card, or Zelle / Venmo / check</li><li>✅ Live results any time</li></ul></div>
    <div class="card"><h2>Sign in or create an account</h2>
      <label class="f">Your email</label><input class="i" id="em" type="email" autocomplete="email" placeholder="you@business.com">
      <div class="row" style="margin-top:12px"><button class="btn primary" id="send">Email me a code</button></div>
      <div id="codebox" class="hidden"><label class="f">6-digit code from the email</label><input class="i" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        <div class="row" style="margin-top:12px"><button class="btn primary" id="ver">Sign in</button></div></div>
      <p class="sub" id="msg"></p>
      ${CFG.contactEmail ? `<p class="sub">Questions? <a href="mailto:${esc(CFG.contactEmail)}">${esc(CFG.contactEmail)}</a></p>` : ''}</div></div>`;
  $('#send').onclick = async () => {
    const email = $('#em').value.trim(); if (!/^\S+@\S+\.\S+$/.test(email)) { $('#msg').textContent = 'Enter a valid email.'; return; }
    $('#send').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    $('#send').disabled = false;
    if (error) { $('#msg').textContent = error.message; return; }
    $('#msg').textContent = 'Check your email for a 6-digit code.'; $('#codebox').classList.remove('hidden'); $('#code').focus();
  };
  $('#ver').onclick = async () => {
    const { error } = await sb.auth.verifyOtp({ email: $('#em').value.trim(), token: $('#code').value.trim(), type: 'email' });
    if (error) $('#msg').textContent = error.message; else location.reload();
  };
}
function viewSetupBusiness() {
  navLinks('');
  $('#main').innerHTML = `<div class="card" style="max-width:640px"><h1>Tell us about your business</h1>
    <p class="sub">This is what anglers see next to your ad.</p>
    <label class="f">Business name *</label><input class="i" id="bn" placeholder="e.g. Bob's Bait & Tackle">
    <label class="f">Contact email</label><input class="i" id="be" value="${esc(S.user.email)}">
    <label class="f">Phone</label><input class="i" id="bp" placeholder="(949) 555-0101">
    <label class="f">Website</label><input class="i" id="bw" placeholder="https://…">
    <div class="row" style="margin-top:16px"><button class="btn primary" id="go">Continue</button></div></div>`;
  $('#go').onclick = async () => {
    try {
      must(await sb.rpc('create_advertiser', { biz_name: $('#bn').value, email: $('#be').value, phone_no: $('#bp').value, site: $('#bw').value, link_me: true }));
      location.hash = '#new'; location.reload();
    } catch (e) { fail(e); }
  };
}

// ------------------------------------------------------------------ advertiser home
ROUTES.home = async () => {
  if (S.owner) { location.hash = '#owner'; return; }
  const orders = must(await sb.from('ad_orders').select('*, creative:ad_creatives(*)').order('created_at', { ascending: false }));
  const live = orders.filter((o) => orderState(o)[0] === 'Live now').length;
  const due = orders.filter((o) => orderState(o)[0].includes('payment due'));
  $('#main').innerHTML = `<div class="between"><div><h1>${esc(S.adv.name)}</h1><div class="sub">${live ? `${live} ad${live > 1 ? 's' : ''} live now` : 'No ads live right now'}</div></div>
      <a class="btn primary" href="#new">➕ Create an ad</a></div><br>
    ${due.map((o) => `<div class="note" style="margin-bottom:10px">✅ Ad #${o.id} was approved — <a href="#order/${o.id}">pay ${money(o.price_cents)} to go live</a>.</div>`).join('')}
    ${orders.filter((o) => o.status === 'changes_requested').map((o) => `<div class="note red" style="margin-bottom:10px">✏️ Ad #${o.id}: changes requested — <a href="#order/${o.id}">see the note</a>.</div>`).join('')}
    ${orders.length ? `<div class="grid3">${orders.map((o) => `<a class="card" style="text-decoration:none;color:inherit;margin:0" href="#order/${o.id}">
        <div style="height:120px;overflow:hidden;border-radius:10px;background:#0C1D2A;margin-bottom:10px">${o.creative ? (o.creative.kind === 'native' ? `<div style="color:#EAF0F4">${nativeHtml(o.creative)}</div>` : mediaHtml(o.creative, 'thumb')) : ''}</div>
        <div class="between"><b>${esc(spotTitle(o.placement, o.section))}</b>${statePill(o)}</div>
        <div class="sub">${dates(o)} · ${esc(areaText(o.areas))}</div><div class="sub">${money(o.price_cents)} · ${payPill(o)}</div></a>`).join('')}</div>`
      : `<div class="card"><h2>Let's make your first ad</h2><p class="sub">It takes about 5 minutes. You'll see exactly how it looks and what it costs before anything is sent.</p><a class="btn primary" href="#new">Start</a></div>`}`;
};

ROUTES.business = async () => {
  const a = S.adv; if (!a) { location.hash = '#home'; return; }
  $('#main').innerHTML = `<div class="card" style="max-width:640px"><h1>My business</h1>
    <label class="f">Business name</label><input class="i" id="bn" value="${esc(a.name)}">
    <label class="f">Contact email</label><input class="i" id="be" value="${esc(a.contact_email || '')}">
    <label class="f">Phone</label><input class="i" id="bp" value="${esc(a.phone || '')}">
    <label class="f">Website</label><input class="i" id="bw" value="${esc(a.website || '')}">
    <label class="f">Address</label><input class="i" id="ba" value="${esc(a.address || '')}">
    <label class="f">Logo (square PNG looks best)</label><div class="row">${a.logo_url ? `<img src="${esc(a.logo_url)}" style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:10px">` : ''}<input type="file" id="bl" accept="image/png,image/jpeg,image/webp"></div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="save">Save</button></div></div>`;
  $('#save').onclick = async () => {
    try {
      const patch = { name: $('#bn').value.trim(), contact_email: $('#be').value.trim() || null, phone: $('#bp').value.trim() || null, website: $('#bw').value.trim() || null, address: $('#ba').value.trim() || null };
      const f = $('#bl').files[0]; if (f) patch.logo_url = await uploadBlob(f, f.name.split('.').pop().toLowerCase(), f.type);
      must(await sb.from('advertisers').update(patch).eq('id', a.id)); toast('Saved'); await loadBasics(); route();
    } catch (e) { fail(e); }
  };
};

// ------------------------------------------------------------------ the 5-step ad builder
let W = null;
function freshDraft(advId) { return { step: 1, adv: advId, key: null, start: nextMonday(), weeks: 4, areas: [], tags: [], creative: null, checks: [], note: '', orderId: null, quote: null, tab: 'upload' }; }
ROUTES.new = async (arg, q) => {
  const advFromQuery = Number(q.get('adv')) || null;
  if (!W || q.get('fresh') === '1' || (advFromQuery && W.adv !== advFromQuery)) W = freshDraft(advFromQuery || S.adv?.id || null);
  renderWizard();
};
ROUTES.edit = async (id) => {
  const o = must(await sb.from('ad_orders').select('*, creative:ad_creatives(*)').eq('id', id).single());
  W = { ...freshDraft(o.advertiser_id), step: 3, key: spotKey(o.placement, o.section), start: o.start_date < today() ? nextMonday() : o.start_date, weeks: o.weeks,
    areas: o.areas || [], tags: o.tags || [], creative: o.creative ? { ...o.creative, saved: true } : null, orderId: o.id, tab: 'upload',
    act: o.creative ? { type: o.creative.action_type, value: o.creative.action_value || '', cta: o.creative.cta_label || '', headline: o.creative.headline || '', pdf_url: o.creative.pdf_url || null } : null };
  location.hash = '#new';
};
const STEP_NAMES = ['Where', 'When & area', 'Your ad', 'Preview', 'Send'];
function rateOf(key) { const [p, s] = key.split('|'); return S.rates.find((r) => r.placement === p && r.section === s); }
function wizardAdv() { return S.advs.find((a) => a.id === W.adv) || null; }

function renderWizard() {
  const steps = `<div class="steps">${STEP_NAMES.map((n, i) => `<span class="${i + 1 === W.step ? 'on' : i + 1 < W.step ? 'done' : ''}">${i + 1}. ${n}</span>`).join('')}</div>`;
  const ownerPick = S.owner ? `<div class="card"><div class="between"><div><b>Creating this ad for</b><div class="sub">Pick the business, or add a new one.</div></div>
      <div class="row"><select class="i" id="advpick" style="min-width:240px"><option value="">— choose —</option>${S.advs.map((a) => `<option value="${a.id}" ${a.id === W.adv ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <a class="btn small" href="#advertisers?new=1">+ New</a></div></div></div>` : '';
  $('#main').innerHTML = `<h1>${W.orderId ? `Edit ad #${W.orderId}` : 'Create an ad'}</h1>${steps}${ownerPick}<div id="stepbody"></div>`;
  if ($('#advpick')) $('#advpick').onchange = (e) => { W.adv = Number(e.target.value) || null; W.creative = null; store.set('studio-adv', W.adv); renderWizard(); };
  if (S.owner && !W.adv) { $('#stepbody').innerHTML = '<div class="note blue">Choose which business this ad is for.</div>'; return; }
  [step1, step2, step3, step4, step5][W.step - 1]();
  hydrateFrames($('#stepbody'));
}
const go = (n) => { W.step = n; renderWizard(); };

function step1() {
  const rates = S.rates.filter((r) => r.active);
  const minis = { today: '<i style="left:8%;top:12%;width:50%;height:9%;background:#24394B"></i><i style="left:8%;top:30%;width:84%;height:22%;background:#F5A524"></i><i style="left:8%;top:60%;width:84%;height:24%;background:#24394B"></i>',
    reports: '<i style="left:8%;top:12%;width:84%;height:22%;background:#F5A524"></i><i style="left:8%;top:42%;width:84%;height:18%;background:#24394B"></i><i style="left:8%;top:66%;width:84%;height:18%;background:#24394B"></i>',
    forum: '<i style="left:8%;top:12%;width:84%;height:22%;background:#F5A524"></i><i style="left:8%;top:42%;width:84%;height:12%;background:#24394B"></i><i style="left:8%;top:60%;width:84%;height:12%;background:#24394B"></i>',
    intro: '<i style="left:30%;top:6%;width:40%;height:88%;background:#F5A524"></i>',
    presented: '<i style="left:8%;top:12%;width:40%;height:9%;background:#24394B"></i><i style="left:8%;top:26%;width:6%;height:8%;background:#F5A524"></i><i style="left:16%;top:27%;width:40%;height:6%;background:#F5A524"></i><i style="left:8%;top:44%;width:84%;height:40%;background:#24394B"></i>' };
  $('#stepbody').innerHTML = `<div class="card"><h2>Where should your ad appear?</h2><p class="sub">Prices are per week for all of SoCal. Targeting one area costs less, and longer bookings get a discount (${S.discounts.map((d) => `${d.min_weeks}+ weeks: ${Number(d.pct)}% off`).join(', ') || 'none right now'}).</p>
    <div class="placements">${rates.map((r) => { const sp = spotOf(r.placement); const k = spotKey(r.placement, r.section); return `<div class="place ${W.key === k ? 'on' : ''}" data-k="${esc(k)}">
      <div class="mini">${minis[sp.screen] || ''}</div><b>${esc(spotTitle(r.placement, r.section))}</b><div class="sub">${esc(r.description || sp.where)}</div>
      <div class="price">${money(r.price_cents_week)} <small>/ week</small></div><div class="sub">Design size ${sp.size[0]} × ${sp.size[1]} px · ${sp.kinds.map((x) => KIND_LABEL[x]).join(', ')}</div></div>`; }).join('')}</div></div>
    <div class="row"><button class="btn primary" id="next" ${W.key ? '' : 'disabled'}>Next: dates & area →</button></div>`;
  $$('.place').forEach((el) => (el.onclick = () => { W.key = el.dataset.k; W.creative = W.creative && spotOf(W.key.split('|')[0]).kinds.includes(W.creative.kind) ? W.creative : null; renderWizard(); }));
  $('#next').onclick = () => go(2);
}

let quoteTimer = null;
async function refreshQuote() {
  const [p, s] = W.key.split('|');
  const box = $('#quote'); if (!box) return;
  try {
    const qd = must(await sb.rpc('ad_quote', { p, p_sec: s, p_areas: W.areas.length ? W.areas : null, p_start: W.start, p_weeks: W.weeks, ignore_order: W.orderId }));
    W.quote = qd;
    if (!qd.ok) { box.innerHTML = `<div class="note red">${esc(qd.error)}</div>`; return; }
    box.innerHTML = `<div class="sub">${W.weeks} week${W.weeks > 1 ? 's' : ''} × ${money(qd.weekly_cents)}</div>
      ${qd.discount_pct > 0 ? `<div class="sub"><s>${money(qd.list_cents)}</s> · ${Number(qd.discount_pct)}% multi-week discount</div>` : ''}
      <div class="total">${money(qd.price_cents)}</div><div class="sub">total, before review</div><hr style="border:0;border-top:1px solid var(--line)">
      <div class="sub">📈 Estimated views: <b>${qd.est_impressions != null ? fmtNum(qd.est_impressions) : 'not enough app data yet'}</b></div>
      <div class="sub">👥 Sharing this spot with ${qd.sharing_with} other advertiser${qd.sharing_with === 1 ? '' : 's'} (max ${qd.max_slots})</div>
      ${qd.available ? '<div class="ok" style="margin-top:8px">✅ Available</div>' : `<div class="note red" style="margin-top:8px">Sold out the week of ${qd.full_weeks.map(niceShort).join(', ')} — pick other dates or another spot.</div>`}`;
    $('#next') && ($('#next').disabled = !qd.available);
  } catch (e) { box.innerHTML = `<div class="note red">${esc(e.message)}</div>`; }
}
function step2() {
  const [p, s] = W.key.split('|');
  $('#stepbody').innerHTML = `<div class="split"><div>
      <div class="card"><h2>When?</h2><div class="row">
        <div style="flex:1;min-width:180px"><label class="f">Start date</label><input class="i" type="date" id="start" min="${today()}" value="${W.start}"></div>
        <div style="flex:1;min-width:180px"><label class="f">How long</label><select class="i" id="weeks">${[1, 2, 3, 4, 6, 8, 12, 16, 26, 52].map((n) => `<option value="${n}" ${n === W.weeks ? 'selected' : ''}>${n} week${n > 1 ? 's' : ''}</option>`).join('')}</select></div></div>
        <div class="sub" style="margin-top:6px" id="enddate"></div></div>
      <div class="card"><h2>Where?</h2><p class="sub">Your ad shows to anglers in these areas (based on the general area the phone is in — never exact locations).</p>
        <div class="chips" id="areas"><span class="chip ${W.areas.length ? '' : 'on'}" data-a="">All of SoCal</span>${AREAS.map((a) => `<span class="chip ${W.areas.includes(a) ? 'on' : ''}" data-a="${esc(a)}">${esc(a)}</span>`).join('')}</div></div>
      ${p === 'featured_listing' ? `<div class="card"><h2>What kind of business? <span class="sub">(pick at least one)</span></h2><p class="sub">Your pin shows when anglers switch on that layer.</p>
        <div class="chips" id="tags">${[['fuel', '⛽ Fuel dock'], ['bait', '🐟 Bait'], ['marina', '⚓ Marina']].map(([t, l]) => `<span class="chip ${W.tags.includes(t) ? 'on' : ''}" data-t="${t}">${l}</span>`).join('')}</div></div>`
      : p !== 'presented_by' && p !== 'sponsor_intro' ? `<div class="card"><h2>Fishing interests <span class="sub">(optional)</span></h2><p class="sub">When several ads share a spot, yours shows first next to matching reports.</p>
        <div class="chips" id="tags">${TAGS.map((t) => `<span class="chip ${W.tags.includes(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</span>`).join('')}</div></div>` : ''}
    </div><div class="card quote"><h3>${esc(spotTitle(p, s))}</h3><div id="quote">Calculating…</div></div></div>
    <div class="row"><button class="btn" id="back">← Back</button><button class="btn primary" id="next" disabled>Next: your ad →</button></div>`;
  const upd = () => { $('#enddate').textContent = `Runs ${nice(W.start)} through ${nice(addDays(W.start, W.weeks * 7 - 1))}`; clearTimeout(quoteTimer); quoteTimer = setTimeout(refreshQuote, 250); };
  $('#start').onchange = (e) => { if (e.target.value) { W.start = e.target.value; upd(); } };
  $('#weeks').onchange = (e) => { W.weeks = Number(e.target.value); upd(); };
  $$('#areas .chip').forEach((el) => (el.onclick = () => {
    const a = el.dataset.a;
    if (!a) W.areas = []; else W.areas = W.areas.includes(a) ? W.areas.filter((x) => x !== a) : [...W.areas, a];
    $$('#areas .chip').forEach((x) => x.classList.toggle('on', x.dataset.a ? W.areas.includes(x.dataset.a) : !W.areas.length)); upd();
  }));
  $$('#tags .chip').forEach((el) => (el.onclick = () => { const t = el.dataset.t; W.tags = W.tags.includes(t) ? W.tags.filter((x) => x !== t) : [...W.tags, t]; el.classList.toggle('on'); }));
  $('#back').onclick = () => go(1); $('#next').onclick = () => go(3);
  upd();
}

function step3() {
  const [p] = W.key.split('|'); const spot = spotOf(p); const [w, h] = spot.size; const adv = wizardAdv();
  const tabs = [['upload', '⬆️ Upload a file'], ['canva', '🎨 Design in Canva'], ['quick', '⚡ Quick ad (no design needed)'], ['saved', '🗂 Use a previous design']];
  $('#stepbody').innerHTML = `<div class="split"><div><div class="card">
      <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${W.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="tabbody"></div></div>
      <div class="card"><h2>When someone taps your ad</h2>
        <div class="chips" id="acts">${[['website', '🌐 Open my website'], ['call', '📞 Call me'], ['directions', '📍 Directions to my shop'], ['coupon', '🎟 Show a coupon code'], ['none', 'Nothing']].map(([k, l]) => `<span class="chip ${(W.act?.type || 'website') === k ? 'on' : ''}" data-a="${k}">${l}</span>`).join('')}</div>
        <div id="actbody"></div>
        <label class="f">Button text <span class="muted">(optional, e.g. "Shop now", "Get 10% off")</span></label><input class="i" id="cta" maxlength="20" value="${esc(W.act?.cta ?? '')}">
        <label class="f">Headline shown under the ad <span class="muted">(optional, 60 characters)</span></label><input class="i" id="hl" maxlength="60" value="${esc(W.act?.headline ?? '')}">
        <label class="f">Attach a flyer or coupon PDF <span class="muted">(optional — anglers can open and save it)</span></label><input type="file" id="pdfatt" accept="application/pdf">
        ${W.act?.pdf_url ? `<div class="sub">📎 PDF attached · <a href="${esc(W.act.pdf_url)}" target="_blank" rel="noopener">open</a></div>` : ''}</div></div>
    <div class="card quote"><h3>Your ad</h3><div id="current"></div></div></div>
    <div class="row"><button class="btn" id="back">← Back</button><button class="btn primary" id="next">Next: preview →</button></div>`;
  W.act = W.act || { type: 'website', value: adv?.website || '', cta: '', headline: '' };
  const renderAct = () => {
    const t = W.act.type;
    const field = { website: ['Website link', 'https://yourshop.com/specials', 'url'], call: ['Phone number', '(949) 555-0101', 'tel'], directions: ['Shop location — latitude, longitude (or paste a Google Maps link)', '33.6061, -117.8890', 'text'], coupon: ['Promo code', 'FISH10', 'text'] }[t];
    $('#actbody').innerHTML = field ? `<label class="f">${field[0]}</label><input class="i" id="actv" type="${field[2]}" placeholder="${field[1]}" value="${esc(W.act.value || (t === 'call' ? adv?.phone || '' : t === 'website' ? adv?.website || '' : ''))}">` : '';
    const v = $('#actv'); if (v) v.oninput = () => { W.act.value = v.value; };
    if (v && !W.act.value) W.act.value = v.value;
  };
  $$('#acts .chip').forEach((el) => (el.onclick = () => { W.act.type = el.dataset.a; W.act.value = ''; $$('#acts .chip').forEach((x) => x.classList.toggle('on', x === el)); renderAct(); }));
  $('#cta').oninput = (e) => { W.act.cta = e.target.value; }; $('#hl').oninput = (e) => { W.act.headline = e.target.value; };
  $('#pdfatt').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > LIMITS.pdf * 1048576) { toast(`PDF is over ${LIMITS.pdf} MB`, true); return; }
    try { toast('Uploading PDF…'); W.act.pdf_url = await uploadBlob(f, 'pdf', 'application/pdf'); if (W.act.type === 'none') W.act.type = 'coupon'; renderWizard(); } catch (err) { fail(err); }
  };
  renderAct();
  const showCurrent = () => {
    $('#current').innerHTML = W.creative ? `<div style="background:#0C1D2A;border-radius:10px;color:#EAF0F4;overflow:hidden">${W.creative.kind === 'native' ? nativeHtml(W.creative) : mediaHtml(W.creative, 'thumb')}</div>
      <ul class="checks">${(W.checks || []).map(([k, t]) => `<li class="${k}">${k === 'ok' ? '✅' : '⚠️'} ${esc(t)}</li>`).join('')}</ul><div class="sub">${KIND_LABEL[W.creative.kind]}</div>`
      : `<div class="sub">Nothing yet. Upload a file, design one in Canva, or build a quick ad.</div><p class="sub">Best size: <span class="sizecopy">${w} × ${h} px</span></p>`;
    hydrateFrames($('#current'));
  };
  showCurrent();
  const body = $('#tabbody');
  const tab = W.tab;
  if (tab === 'upload') {
    body.innerHTML = `<div class="drop" id="drop"><b>Drag your file here, or click to choose</b><div class="sub" style="margin-top:6px">${spot.kinds.filter((k) => k !== 'native').map((k) => KIND_LABEL[k]).join(' · ')}</div>
      <div class="sub">Best size: <span class="sizecopy">${w} × ${h} px</span>${spot.kinds.includes('video') ? ` · videos up to ${spot.maxVideo || 15} s (muted)` : ''}</div><div class="sub" id="dropmsg"></div></div>
      <input type="file" id="file" class="hidden" accept="${spot.logo ? 'image/png,image/jpeg,image/webp' : 'image/*,video/mp4,video/quicktime,video/webm,application/pdf,.zip,.html,.htm'}">
      <p class="sub">Tips: PNG for crisp text and logos · MP4 for motion · HTML5 = the .zip from Google Web Designer, Adobe Animate or Canva's HTML export.</p>`;
    const drop = $('#drop'); const file = $('#file');
    const handle = async (f) => {
      if (!f) return;
      try {
        const out = await processFile(f, spot, (m) => { $('#dropmsg').textContent = m; });
        W.creative = { ...out.c, saved: false }; W.checks = out.checks; $('#dropmsg').textContent = ''; toast('Looks good — check the preview next'); showCurrent();
      } catch (e) { $('#dropmsg').textContent = ''; fail(e); }
    };
    drop.onclick = () => file.click(); file.onchange = () => handle(file.files[0]);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files[0]); };
  } else if (tab === 'canva') {
    body.innerHTML = `<ol style="line-height:1.9;padding-left:20px">
      <li>Open Canva and click <b>Create a design → Custom size</b>.</li>
      <li>Enter <span class="sizecopy" id="sz">${w} × ${h} px</span> <button class="btn small" id="copysz">Copy size</button></li>
      <li>Design your ad (Canva's "Ad" and "Banner" templates work great — keep text big; it's seen on a phone).</li>
      <li><b>Share → Download</b>: choose <b>PNG</b> for a still ad, <b>MP4 video</b> or <b>GIF</b> for motion${spot.kinds.includes('pdf') ? ', or <b>PDF</b> for a flyer' : ''}.</li>
      <li>Come back here and drop the file on the <a href="#" id="toupload">Upload</a> tab.</li></ol>
      <div class="row"><a class="btn primary" href="https://www.canva.com/" target="_blank" rel="noopener">Open Canva ↗</a></div>
      <p class="sub">Coming later: one-click "Import from Canva" (needs Canva to approve our connection).</p>`;
    $('#copysz').onclick = () => navigator.clipboard?.writeText(`${w} x ${h}`).then(() => toast('Size copied')).catch(() => {});
    $('#toupload').onclick = (e) => { e.preventDefault(); W.tab = 'upload'; renderWizard(); };
  } else if (tab === 'quick') {
    const c = W.creative?.kind === 'native' ? W.creative : { kind: 'native', headline: adv?.name || '', body: '', cta_label: '', logo_url: adv?.logo_url || '' };
    body.innerHTML = `<p class="sub">No design skills needed — your logo, a headline and a short message, styled to match the app.</p>
      <label class="f">Logo</label><div class="row">${c.logo_url ? `<img src="${esc(c.logo_url)}" style="width:56px;height:56px;object-fit:contain;border:1px solid var(--line);border-radius:10px">` : ''}<input type="file" id="ql" accept="image/png,image/jpeg,image/webp"></div>
      <label class="f">Headline (60)</label><input class="i" id="qh" maxlength="60" value="${esc(c.headline)}" placeholder="Live squid & sardines in stock">
      <label class="f">Message (140)</label><textarea class="i" id="qb" maxlength="140" placeholder="Open 4 AM daily at the Newport landing. Show this ad for 10% off.">${esc(c.body || '')}</textarea>
      <label class="f">Button (20)</label><input class="i" id="qc" maxlength="20" value="${esc(c.cta_label || '')}" placeholder="Get directions">
      <div class="row" style="margin-top:12px"><button class="btn primary" id="quse">Use this quick ad</button></div>`;
    $('#ql').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { c.logo_url = await uploadBlob(f, f.name.split('.').pop().toLowerCase(), f.type); W.creative = { ...c, saved: false }; renderWizard(); } catch (err) { fail(err); } };
    $('#quse').onclick = () => {
      const hl = $('#qh').value.trim(); if (!hl) { toast('Add a headline', true); return; }
      W.creative = { ...c, kind: 'native', headline: hl, body: $('#qb').value.trim(), cta_label: $('#qc').value.trim(), saved: false };
      W.checks = [['ok', 'Quick ad — matches the app automatically']]; showCurrent(); toast('Quick ad ready');
    };
  } else {
    body.innerHTML = '<div class="sub">Loading your designs…</div>';
    sb.from('ad_creatives').select('*').eq('advertiser_id', W.adv).order('created_at', { ascending: false }).then((r) => {
      const rows = (r.data || []).filter((c) => spot.kinds.includes(c.kind));
      body.innerHTML = rows.length ? `<div class="grid3">${rows.map((c) => `<div class="card" style="margin:0;cursor:pointer" data-id="${c.id}">
          <div style="background:#0C1D2A;border-radius:10px;color:#EAF0F4;overflow:hidden">${c.kind === 'native' ? nativeHtml(c) : mediaHtml(c, 'thumb')}</div>
          <div class="sub">${KIND_LABEL[c.kind]} · ${new Date(c.created_at).toLocaleDateString()}</div></div>`).join('')}</div>` : '<div class="sub">No previous designs that fit this spot.</div>';
      $$('[data-id]', body).forEach((el) => (el.onclick = () => {
        const c = rows.find((x) => x.id === el.dataset.id);
        W.creative = { ...c, saved: true }; W.checks = [['ok', 'Previously used design']];
        W.act = { type: c.action_type, value: c.action_value || '', cta: c.cta_label || '', headline: c.headline || '', pdf_url: c.pdf_url || W.act?.pdf_url };
        renderWizard();
      }));
      hydrateFrames(body);
    });
  }
  $$('.tabs button').forEach((b) => (b.onclick = () => { W.tab = b.dataset.tab; renderWizard(); }));
  $('#back').onclick = () => go(2);
  $('#next').onclick = () => {
    if (!W.creative) { toast('Add your ad first', true); return; }
    const err = actionError(); if (err) { toast(err, true); return; }
    go(4);
  };
}
function normalizedAction() {
  const t = W.act?.type || 'none'; let v = (W.act?.value || '').trim();
  if (t === 'website' && v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (t === 'directions') { const m = v.match(/@?(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/); v = m ? `${m[1]},${m[2]}` : v; }
  return { type: t, value: t === 'none' ? null : v };
}
function actionError() {
  const { type, value } = normalizedAction();
  if ((W.key || '').startsWith('featured_listing|')) {
    if (type !== 'directions') return 'A featured pin needs your location: choose "📍 Directions to my shop"';
    if (!W.tags.some((t) => ['fuel', 'bait', 'marina'].includes(t))) return 'Go back one step and pick what kind of business you are (fuel, bait or marina)';
  }
  if (type === 'website' && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(value || '')) return 'Enter your website link';
  if (type === 'call' && !/^[+0-9(). -]{7,20}$/.test(value || '')) return 'Enter a phone number';
  if (type === 'directions' && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(value || '')) return 'For directions, enter latitude, longitude — or paste a Google Maps link';
  if (type === 'coupon' && !value && !W.act?.pdf_url) return 'Enter a promo code or attach a coupon PDF';
  return null;
}

function step4() {
  const [p, s] = W.key.split('|'); const adv = wizardAdv();
  const act = normalizedAction();
  const c = { ...W.creative, headline: W.creative.kind === 'native' ? W.creative.headline : (W.act.headline || null), cta_label: W.creative.kind === 'native' ? W.creative.cta_label : (W.act.cta || null), action_type: act.type, action_value: act.value };
  const others = Object.keys(SPOTS).filter((k) => k !== p && SPOTS[k].kinds.includes(c.kind) && SPOTS[k].screen !== 'presented').slice(0, 2);
  $('#stepbody').innerHTML = `<div class="card"><h2>This is how anglers will see it</h2><p class="sub">Real app layout and colors. Numbers on the screens are samples.</p>
      <div class="phonewrap">${phone(spotOf(p), c, adv, s)}</div>
      <div class="note blue" style="margin-top:14px">Tap action: <b>${{ website: `opens ${esc(act.value)}`, call: `calls ${esc(act.value)}`, directions: 'opens directions to your shop', coupon: `shows code <b>${esc(act.value || '')}</b>${W.act.pdf_url ? ' and your coupon PDF' : ''}`, none: 'nothing (view only)' }[act.type]}</b></div></div>
    ${others.length ? `<details class="card"><summary><b>Curious how it would look elsewhere?</b></summary><div class="phonewrap" style="margin-top:12px">${others.map((k) => phone(SPOTS[k], c, adv, '')).join('')}</div></details>` : ''}
    <div class="row"><button class="btn" id="back">← Change the ad</button><button class="btn primary" id="next">Looks good →</button></div>`;
  $('#back').onclick = () => go(3); $('#next').onclick = () => go(5);
}

async function saveCreative() {
  if (W.creative.saved && W.creative.id && W.creative.action_type === normalizedAction().type && (W.creative.action_value || '') === (normalizedAction().value || '')) return W.creative.id;
  const act = normalizedAction(); const c = W.creative;
  const row = {
    advertiser_id: W.adv, kind: c.kind, media_url: c.media_url || null, poster_url: c.poster_url || null, html_url: c.html_url || null,
    pdf_url: c.pdf_url || W.act.pdf_url || null, width: c.width || null, height: c.height || null, duration_s: c.duration_s || null, bytes: c.bytes || null,
    headline: c.kind === 'native' ? c.headline : (W.act.headline || null), body: c.kind === 'native' ? (c.body || null) : null,
    cta_label: c.kind === 'native' ? (c.cta_label || null) : (W.act.cta || null), logo_url: c.logo_url || wizardAdv()?.logo_url || null,
    action_type: act.type, action_value: act.value,
  };
  const saved = must(await sb.from('ad_creatives').insert(row).select().single());
  W.creative = { ...saved, saved: true };
  return saved.id;
}
function step5() {
  const [p, s] = W.key.split('|'); const q = W.quote || {};
  $('#stepbody').innerHTML = `<div class="split"><div class="card"><h2>Review & send</h2>
      <table class="t"><tr><td class="muted">Spot</td><td><b>${esc(spotTitle(p, s))}</b></td></tr>
      <tr><td class="muted">Dates</td><td>${nice(W.start)} – ${nice(addDays(W.start, W.weeks * 7 - 1))} (${W.weeks} week${W.weeks > 1 ? 's' : ''})</td></tr>
      <tr><td class="muted">Area</td><td>${esc(areaText(W.areas))}</td></tr>
      <tr><td class="muted">Ad</td><td>${KIND_LABEL[W.creative.kind]}</td></tr>
      <tr><td class="muted">Price</td><td><b>${money(q.price_cents)}</b>${q.discount_pct > 0 ? ` <span class="sub">(${Number(q.discount_pct)}% off)</span>` : ''}</td></tr></table>
      <label class="f">Anything we should know? <span class="muted">(optional)</span></label><textarea class="i" id="note" maxlength="1000" placeholder="e.g. Please run it before the tuna tournament">${esc(W.note)}</textarea>
      <label style="display:flex;gap:8px;margin-top:12px;font-size:14px"><input type="checkbox" id="agree"> <span>My ad is truthful, legal, family-friendly, and doesn't promote fishing in protected areas. I understand it's reviewed before it runs and the final price is confirmed on approval.</span></label>
    </div><div class="card quote"><h3>What happens next</h3><ol class="sub" style="padding-left:18px;line-height:1.8">
      <li>We review your ad (usually within a day).</li><li>You get a message: approved, or a note if anything needs changing.</li>
      <li>Pay ${S.stripe ? 'by card here, or ' : ''}by Zelle / Venmo / check.</li><li>It goes live on your start date — watch the results here.</li></ol>
      <div class="sub">${esc(S.cfg.ad_payment_instructions || '')}</div></div></div>
    <div class="row"><button class="btn" id="back">← Back</button><button class="btn" id="draft">Save draft</button><button class="btn primary" id="send">Send for review</button></div>`;
  $('#note').oninput = (e) => { W.note = e.target.value; };
  $('#back').onclick = () => go(4);
  const save = async () => {
    const creative = await saveCreative();
    const [pl, sec] = W.key.split('|');
    const id = must(await sb.rpc('save_ad_order', { ord: W.orderId, adv: W.adv, p: pl, sec, target_areas: W.areas.length ? W.areas : null, start: W.start, wks: W.weeks, creative, note: null, ctx_tags: W.tags }));
    W.orderId = id; return id;
  };
  $('#draft').onclick = async () => { try { const id = await save(); toast('Draft saved'); W = null; location.hash = `#order/${id}`; } catch (e) { fail(e); } };
  $('#send').onclick = async () => {
    if (!$('#agree').checked) { toast('Please tick the box to confirm', true); return; }
    $('#send').disabled = true;
    try { const id = await save(); must(await sb.rpc('submit_ad_order', { ord: id, note: W.note || null })); W = null; toast('Sent! We\'ll review it soon.'); location.hash = `#order/${id}`; }
    catch (e) { $('#send').disabled = false; fail(e); }
  };
}

// ------------------------------------------------------------------ one order (advertiser and owner)
ROUTES.order = async (id, q) => {
  const o = must(await sb.from('ad_orders').select('*, creative:ad_creatives(*), advertiser:advertisers(*)').eq('id', id).single());
  const msgs = must(await sb.from('ad_messages').select('*').eq('order_id', id).order('created_at'));
  let rep = null; try { rep = must(await sb.rpc('ad_order_report', { ord: Number(id), days: 365 })); } catch { /* not live yet */ }
  if (q.get('paid') === '1') { toast('Thanks! Your card payment is being confirmed — this page updates in a moment.'); setTimeout(() => { if (location.hash.startsWith(`#order/${id}`)) location.hash = `#order/${id}`; }, 6000); }
  const [state] = orderState(o); const c = o.creative; const spot = spotOf(o.placement);
  const t = rep?.totals || {};
  const canEdit = ['draft', 'changes_requested'].includes(o.status);
  const due = o.status === 'approved' && o.payment_status === 'unpaid';
  $('#main').innerHTML = `<div class="between"><div><a href="#${S.owner ? 'ads' : 'home'}" class="sub noprint">← Back</a><h1>Ad #${o.id} · ${esc(spotTitle(o.placement, o.section))}</h1>
      <div class="row">${statePill(o)} ${payPill(o)} <span class="sub">${esc(o.advertiser?.name)} · ${dates(o)} · ${esc(areaText(o.areas))}</span></div></div>
      <div class="row noprint">${canEdit && !S.owner ? `<a class="btn primary" href="#edit/${o.id}">✏️ Edit & resend</a>` : ''}${o.status === 'draft' ? `<button class="btn primary" id="submit">Send for review</button>` : ''}
        <button class="btn" id="invoice">🧾 Invoice</button><button class="btn" onclick="window.print()">🖨 Print report</button>
        ${['draft', 'submitted', 'changes_requested'].includes(o.status) || S.owner ? `<button class="btn danger" id="cancel">Cancel ad</button>` : ''}</div></div><br>
    ${o.status === 'changes_requested' && o.review_note ? `<div class="note red">✏️ <b>Changes requested:</b> ${esc(o.review_note)}</div><br>` : ''}
    ${o.status === 'rejected' && o.review_note ? `<div class="note red"><b>Not approved:</b> ${esc(o.review_note)}</div><br>` : ''}
    ${due && !S.owner ? `<div class="card" style="border-color:var(--accent)"><h2>✅ Approved — ${money(o.price_cents)} due</h2><p class="sub">Your ad goes live on ${nice(o.start_date)} once payment is in.</p>
        <div class="row">${S.stripe ? '<button class="btn primary" id="paycard">💳 Pay by card</button>' : ''}</div><p class="sub">${esc(S.cfg.ad_payment_instructions || '')} Reference: Ad #${o.id}.</p></div>` : ''}
    ${S.owner ? ownerPanel(o) : ''}
    <div class="grid2">
      <div class="card"><h2>Results</h2>${rep && t.impressions ? `<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
          <div class="kpi"><div class="k">Views</div><div class="v">${fmtNum(t.impressions)}</div><div class="s">${fmtNum(t.reach)} daily reach</div></div>
          <div class="kpi"><div class="k">Taps</div><div class="v">${fmtNum(t.clicks)}</div><div class="s">${pct(t.clicks, t.impressions)} tap rate</div></div>
          ${t.calls ? `<div class="kpi"><div class="k">Calls</div><div class="v">${fmtNum(t.calls)}</div></div>` : ''}
          ${t.directions ? `<div class="kpi"><div class="k">Directions</div><div class="v">${fmtNum(t.directions)}</div></div>` : ''}
          ${t.coupon_opens || t.coupon_saves ? `<div class="kpi"><div class="k">Coupons</div><div class="v">${fmtNum(t.coupon_saves)}</div><div class="s">saved · ${fmtNum(t.coupon_opens)} opened</div></div>` : ''}
          ${t.video_starts ? `<div class="kpi"><div class="k">Video plays</div><div class="v">${fmtNum(t.video_starts)}</div><div class="s">${pct(t.video_completes, t.video_starts)} watched to the end</div></div>` : ''}</div>
          <div class="chartbox"><canvas id="ch"></canvas></div>
          <h3 style="margin-top:12px">Where it was seen</h3><table class="t">${(rep.areas || []).map((a) => `<tr><td>${esc(a.k)}</td><td>${fmtNum(a.n)}</td></tr>`).join('')}</table>`
        : `<p class="sub">${state === 'Live now' ? 'Results appear within a few minutes of the first views.' : 'Results show up here once your ad is live.'}</p>`}
        <p class="sub">Views count when your ad is on screen for at least a second. Anglers are never identified; "reach" counts different phones per day.</p></div>
      <div class="card"><h2>Your ad</h2><div class="phonewrap">${phone(spot, c, o.advertiser, o.section)}</div>
        ${c?.pdf_url ? `<p class="sub">📎 <a href="${esc(c.pdf_url)}" target="_blank" rel="noopener">Flyer / coupon PDF</a></p>` : ''}</div></div>
    <div class="card noprint"><h2>Messages</h2><div class="thread" id="thread">${msgs.map((m) => `<div class="msg ${m.from_owner === S.owner ? 'me' : ''}">${esc(m.body)}<small>${m.from_owner ? (S.owner ? 'You' : 'Ad team') : (S.owner ? esc(o.advertiser?.name) : 'You')} · ${new Date(m.created_at).toLocaleString()}</small></div>`).join('') || '<div class="sub">No messages yet.</div>'}</div>
      <div class="row" style="margin-top:10px"><input class="i" id="msg" style="flex:1" placeholder="Write a message…" maxlength="2000"><button class="btn primary" id="sendmsg">Send</button></div></div>`;
  if (rep?.daily?.length) chart($('#ch'), 'line', rep.daily.map((d) => niceShort(d.d)), [{ label: 'Views', data: rep.daily.map((d) => d.imp), borderColor: '#1F8FB0', tension: 0.3 }, { label: 'Taps & actions', data: rep.daily.map((d) => d.act), borderColor: '#F5A524', tension: 0.3 }]);
  const th = $('#thread'); th.scrollTop = th.scrollHeight;
  $('#sendmsg').onclick = async () => { const b = $('#msg').value.trim(); if (!b) return; try { must(await sb.from('ad_messages').insert({ order_id: o.id, body: b, from_owner: S.owner, author: S.user.id })); route(); } catch (e) { fail(e); } };
  $('#invoice').onclick = () => invoice(o);
  if ($('#submit')) $('#submit').onclick = async () => { try { must(await sb.rpc('submit_ad_order', { ord: o.id, note: null })); toast('Sent for review'); route(); } catch (e) { fail(e); } };
  if ($('#cancel')) $('#cancel').onclick = async () => { if (!confirm('Cancel this ad?')) return; try { must(await sb.rpc('cancel_ad_order', { ord: o.id })); route(); } catch (e) { fail(e); } };
  if ($('#paycard')) $('#paycard').onclick = async () => {
    try {
      const { data } = await sb.auth.getSession();
      const r = await fetch(`${API}/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ order_id: o.id }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.detail || 'Payment page unavailable');
      location.href = j.url;
    } catch (e) { fail(e); }
  };
  if (S.owner) wireOwnerPanel(o);
};

function invoice(o) {
  const biz = CFG.appName || S.cfg.ad_business_name || 'Ad Studio';
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to open the invoice', true); return; }
  const status = o.payment_status === 'paid' ? `PAID ${o.paid_at ? new Date(o.paid_at).toLocaleDateString() : ''} (${esc(o.payment_method || '')})` : o.payment_status === 'comped' ? 'NO CHARGE' : 'DUE';
  w.document.write(`<html><head><title>Invoice — Ad #${o.id}</title><style>body{font:14px system-ui;margin:48px;color:#111}h1{margin:0}table{width:100%;border-collapse:collapse;margin:20px 0}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.big{font-size:22px;font-weight:800}</style></head><body>
    <div style="display:flex;justify-content:space-between"><div><h1>${esc(biz)}</h1><div>${esc(CFG.contactEmail || '')}</div></div><div class="r"><div class="big">INVOICE</div><div>Ad #${o.id}</div><div>${new Date().toLocaleDateString()}</div></div></div>
    <p><b>Bill to:</b> ${esc(o.advertiser?.name)}<br>${esc(o.advertiser?.contact_email || '')}<br>${esc(o.advertiser?.phone || '')}</p>
    <table><tr><th>Description</th><th class="r">Amount</th></tr>
    <tr><td>${esc(spotTitle(o.placement, o.section))}<br><small>${dates(o)} · ${esc(areaText(o.areas))}</small></td><td class="r">${money(o.list_cents || o.price_cents)}</td></tr>
    ${o.list_cents && o.list_cents !== o.price_cents ? `<tr><td>Discount / adjustment</td><td class="r">−${money(o.list_cents - o.price_cents)}</td></tr>` : ''}
    <tr><td class="big">Total</td><td class="r big">${money(o.price_cents)}</td></tr></table>
    <p><b>Status:</b> ${status}</p><p>${esc(S.cfg.ad_payment_instructions || '')}</p><script>window.print()<\/script></body></html>`);
  w.document.close();
}

// ------------------------------------------------------------------ owner tools on an order
function ownerPanel(o) {
  return `<div class="card noprint" style="border-color:var(--navy)"><h2>Your decision</h2>
    ${o.advertiser_note ? `<div class="note blue" style="margin-bottom:10px">💬 ${esc(o.advertiser_note)}</div>` : ''}
    <div class="grid3">
      <div><label class="f">Final price ($)</label><input class="i" id="oprice" type="number" min="0" step="1" value="${(o.price_cents / 100).toFixed(2)}"><div class="sub">List ${money(o.list_cents)}${Number(o.discount_pct) ? ` · ${Number(o.discount_pct)}% discount applied` : ''}</div></div>
      <div><label class="f">Start date</label><input class="i" id="ostart" type="date" value="${o.start_date}"></div>
      <div><label class="f">Weeks</label><input class="i" id="oweeks" type="number" min="1" max="52" value="${o.weeks}"></div></div>
    <label class="f">Note to the advertiser</label><textarea class="i" id="onote" placeholder="e.g. Looks great! / Please make the phone number bigger."></textarea>
    <div class="row" style="margin-top:10px"><button class="btn primary" data-d="approve">✅ Approve</button><button class="btn" data-d="changes">✏️ Ask for changes</button><button class="btn danger" data-d="reject">✖ Reject</button></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
    <h3>Payment</h3><div class="row"><select class="i" id="pmethod" style="max-width:180px">${['zelle', 'venmo', 'check', 'cash', 'stripe', 'other'].map((m) => `<option ${o.payment_method === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <input class="i" id="pnote" style="max-width:260px" placeholder="Note (e.g. check #1042)" value="${esc(o.payment_note || '')}">
      <button class="btn primary" data-p="paid">💵 Mark paid</button><button class="btn" data-p="comped">🎁 Free / comp</button><button class="btn" data-p="unpaid">Mark unpaid</button><button class="btn" data-p="refunded">Refunded</button></div>
    <div class="row" style="margin-top:10px"><label class="row" style="gap:6px"><input type="checkbox" id="rununpaid" ${o.run_unpaid ? 'checked' : ''}> Run before payment (I trust them)</label>
      <label class="row" style="gap:6px"><input type="checkbox" id="paused" ${o.paused ? 'checked' : ''}> Paused</label></div></div>`;
}
function wireOwnerPanel(o) {
  $$('[data-d]').forEach((b) => (b.onclick = async () => {
    const d = b.dataset.d; const note = $('#onote').value.trim();
    if (d !== 'approve' && !note) { toast('Add a note so they know what to change', true); return; }
    try {
      must(await sb.rpc('owner_review_order', { ord: o.id, decision: d, note: note || null, new_price_cents: Math.round(Number($('#oprice').value) * 100),
        new_start: $('#ostart').value || null, new_weeks: Number($('#oweeks').value) || null }));
      toast(d === 'approve' ? 'Approved — they\'ve been notified' : 'Sent'); route();
    } catch (e) { fail(e); }
  }));
  $$('[data-p]').forEach((b) => (b.onclick = async () => {
    try { must(await sb.rpc('owner_set_payment', { ord: o.id, pay_status: b.dataset.p, method: $('#pmethod').value, note: $('#pnote').value || null, amount_cents: Math.round(Number($('#oprice').value) * 100) })); toast('Payment updated'); route(); }
    catch (e) { fail(e); }
  }));
  $('#rununpaid').onchange = async (e) => { try { must(await sb.rpc('owner_set_flags', { ord: o.id, run_before_payment: e.target.checked, pause: null })); toast('Saved'); } catch (err) { fail(err); } };
  $('#paused').onchange = async (e) => { try { must(await sb.rpc('owner_set_flags', { ord: o.id, run_before_payment: null, pause: e.target.checked })); toast('Saved'); } catch (err) { fail(err); } };
}

// ------------------------------------------------------------------ owner: dashboard, inbox, all ads, calendar, money, advertisers, prices
function orderRows(orders) {
  return `<table class="t"><tr><th>#</th><th>Advertiser</th><th>Spot</th><th>Dates</th><th>Price</th><th>Status</th><th>Payment</th></tr>
    ${orders.map((o) => `<tr class="click" onclick="location.hash='#order/${o.id}'"><td>${o.id}</td><td>${esc(o.advertiser?.name)}</td><td>${esc(spotTitle(o.placement, o.section))}<div class="sub">${esc(areaText(o.areas))}</div></td>
      <td>${dates(o)}</td><td>${money(o.price_cents)}</td><td>${statePill(o)}</td><td>${payPill(o)}</td></tr>`).join('') || '<tr><td colspan="7" class="sub">Nothing here.</td></tr>'}</table>`;
}
const ORDER_SEL = '*, advertiser:advertisers(name, contact_email, phone), creative:ad_creatives(kind)';
ROUTES.owner = async () => {
  if (!S.owner) { location.hash = '#home'; return; }
  const ov = must(await sb.rpc('owner_ad_overview'));
  const review = must(await sb.from('ad_orders').select(ORDER_SEL).in('status', ['submitted']).order('submitted_at'));
  const upcoming = must(await sb.from('ad_orders').select(ORDER_SEL).eq('status', 'approved').gte('end_date', today()).order('start_date').limit(15));
  $('#main').innerHTML = `<div class="between"><h1>Ad business</h1><a class="btn primary" href="#new?fresh=1">➕ New ad for a client</a></div><br>
    <div class="kpis">
      <div class="kpi"><div class="k">To review</div><div class="v">${ov.to_review}</div><div class="s"><a href="#inbox">open inbox</a></div></div>
      <div class="kpi"><div class="k">Live right now</div><div class="v">${ov.live_now}</div><div class="s">${ov.starting_7d} starting this week</div></div>
      <div class="kpi"><div class="k">Paid this month</div><div class="v">${money(ov.paid_month_cents)}</div><div class="s">${money(ov.paid_total_cents)} all time</div></div>
      <div class="kpi"><div class="k">Waiting on payment</div><div class="v">${money(ov.unpaid_cents)}</div><div class="s"><a href="#money">collect</a></div></div>
      <div class="kpi"><div class="k">Booked (future)</div><div class="v">${money(ov.booked_future_cents)}</div><div class="s">${ov.advertisers} advertisers</div></div>
      <div class="kpi"><div class="k">Ad views · 30 days</div><div class="v">${fmtNum(ov.impressions_30d)}</div><div class="s">${fmtNum(ov.actions_30d)} taps, calls & coupons</div></div></div>
    <div class="grid2"><div class="card"><h2>📥 Waiting for your review</h2>${orderRows(review)}</div>
      <div class="card"><h2>💵 Revenue by month</h2><div class="chartbox"><canvas id="rev"></canvas></div></div></div>
    <div class="card"><h2>🗓 Live & coming up</h2>${orderRows(upcoming)}</div>`;
  chart($('#rev'), 'bar', (ov.monthly || []).map((m) => m.m), [{ label: 'Paid', data: (ov.monthly || []).map((m) => m.cents / 100), backgroundColor: '#F5A524' }]);
};
ROUTES.inbox = async () => {
  const rows = must(await sb.from('ad_orders').select(ORDER_SEL).in('status', ['submitted', 'changes_requested']).order('submitted_at'));
  $('#main').innerHTML = `<h1>To review</h1><p class="sub">Open one to see the preview, change the price or dates, and approve or send a note.</p><div class="card">${orderRows(rows)}</div>`;
};
ROUTES.ads = async (arg, q) => {
  const f = q.get('f') || 'all';
  let query = sb.from('ad_orders').select(ORDER_SEL).order('created_at', { ascending: false }).limit(500);
  if (f === 'live') query = query.eq('status', 'approved').lte('start_date', today()).gt('end_date', today());
  if (f === 'unpaid') query = query.eq('status', 'approved').eq('payment_status', 'unpaid');
  if (f === 'drafts') query = query.eq('status', 'draft');
  const rows = must(await query);
  $('#main').innerHTML = `<div class="between"><h1>All ads</h1><div class="chips">${[['all', 'All'], ['live', 'Live'], ['unpaid', 'Unpaid'], ['drafts', 'Drafts']].map(([k, l]) => `<a class="chip ${f === k ? 'on' : ''}" href="#ads?f=${k}" style="text-decoration:none;color:inherit">${l}</a>`).join('')}
      <button class="btn small" id="csv">⬇ CSV</button></div></div><br><div class="card">${orderRows(rows)}</div>`;
  $('#csv').onclick = () => {
    const head = ['id', 'advertiser', 'placement', 'section', 'areas', 'start', 'weeks', 'price', 'status', 'payment', 'method', 'paid_at'];
    const lines = rows.map((o) => [o.id, o.advertiser?.name, o.placement, o.section, areaText(o.areas), o.start_date, o.weeks, (o.price_cents / 100).toFixed(2), o.status, o.payment_status, o.payment_method || '', o.paid_at || '']
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' })); a.download = `ads-${today()}.csv`; a.click();
  };
};
ROUTES.calendar = async (arg, q) => {
  const from = q.get('from') || (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  const rows = must(await sb.rpc('owner_ad_calendar', { p_from: from, p_weeks: 12 }));
  const weeks = [...new Set(rows.map((r) => r.week_start))].sort();
  const groups = {}; rows.forEach((r) => { (groups[`${r.placement}|${r.section}`] ||= []).push(r); });
  $('#main').innerHTML = `<div class="between"><h1>Booking calendar</h1><div class="row"><a class="btn small" href="#calendar?from=${addDays(from, -28)}">← 4 weeks</a><a class="btn small" href="#calendar">This week</a><a class="btn small" href="#calendar?from=${addDays(from, 28)}">4 weeks →</a></div></div>
    <p class="sub">Each box is one week: booked / available slots. Orange = partly booked, red = sold out. Hover to see who.</p>
    <div class="card cal"><table><tr><th></th>${weeks.map((w) => `<th>${niceShort(w)}</th>`).join('')}</tr>
    ${Object.entries(groups).map(([k, rs]) => { const [p, s] = k.split('|'); return `<tr><td class="lbl">${esc(spotTitle(p, s))}</td>${weeks.map((w) => { const r = rs.find((x) => x.week_start === w) || { booked: 0, max_slots: 1, orders: [] };
      return `<td class="${r.booked >= r.max_slots ? 'full' : r.booked ? 'part' : ''}" title="${esc(r.orders.map((x) => `#${x.id} ${x.advertiser} (${x.status}${x.paid === 'paid' ? ', paid' : ''})`).join('\n'))}">${r.booked}/${r.max_slots}</td>`; }).join('')}</tr>`; }).join('')}</table></div>`;
};
ROUTES.money = async () => {
  const unpaid = must(await sb.from('ad_orders').select(ORDER_SEL).eq('status', 'approved').eq('payment_status', 'unpaid').order('start_date'));
  const paid = must(await sb.from('ad_orders').select(ORDER_SEL).in('payment_status', ['paid', 'comped', 'refunded']).order('paid_at', { ascending: false }).limit(50));
  const ov = must(await sb.rpc('owner_ad_overview'));
  $('#main').innerHTML = `<h1>Money</h1><div class="kpis"><div class="kpi"><div class="k">Waiting on payment</div><div class="v">${money(ov.unpaid_cents)}</div></div>
      <div class="kpi"><div class="k">Paid this month</div><div class="v">${money(ov.paid_month_cents)}</div></div><div class="kpi"><div class="k">All time</div><div class="v">${money(ov.paid_total_cents)}</div></div>
      <div class="kpi"><div class="k">Card payments</div><div class="v">${S.stripe ? 'On' : 'Off'}</div><div class="s">${S.stripe ? 'Stripe connected' : 'Set up in SETUP.md → Part P'}</div></div></div>
    <div class="card"><h2>Waiting on payment</h2><p class="sub">Got a check, Zelle or Venmo? Open the ad and press <b>Mark paid</b> — it goes live automatically.</p>${orderRows(unpaid)}</div>
    <div class="card"><h2>Recent payments</h2>${orderRows(paid)}</div>`;
};
ROUTES.advertisers = async (arg, q) => {
  const orders = must(await sb.from('ad_orders').select('advertiser_id, price_cents, payment_status, status'));
  const stats = {}; orders.forEach((o) => { const s = (stats[o.advertiser_id] ||= { n: 0, paid: 0 }); s.n++; if (o.payment_status === 'paid') s.paid += o.price_cents; });
  const sel = arg ? S.advs.find((a) => String(a.id) === arg) : null;
  $('#main').innerHTML = `<div class="between"><h1>Advertisers</h1><button class="btn primary" id="newadv">➕ New advertiser</button></div><br>
    <div id="newbox" class="card ${q.get('new') === '1' ? '' : 'hidden'}"><h2>New advertiser</h2><div class="grid3">
      <div><label class="f">Business name *</label><input class="i" id="nn"></div><div><label class="f">Email</label><input class="i" id="ne"></div>
      <div><label class="f">Phone</label><input class="i" id="np"></div><div><label class="f">Website</label><input class="i" id="nw"></div></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="nsave">Create</button></div>
      <p class="sub">When they sign in to the Ad Studio with this email, they're linked to this business automatically and can see their ads and reports.</p></div>
    ${sel ? advertiserCard(sel) : ''}
    <div class="card"><table class="t"><tr><th>Business</th><th>Contact</th><th>Ads</th><th>Paid</th><th></th></tr>
    ${S.advs.map((a) => `<tr class="click" onclick="location.hash='#advertisers/${a.id}'"><td><b>${esc(a.name)}</b>${a.status === 'blocked' ? ' <span class="pill bad">blocked</span>' : ''}</td><td>${esc(a.contact_email || '')}<div class="sub">${esc(a.phone || '')}</div></td>
      <td>${stats[a.id]?.n || 0}</td><td>${money(stats[a.id]?.paid || 0)}</td><td><a class="btn small" href="#new?adv=${a.id}&fresh=1" onclick="event.stopPropagation()">New ad</a></td></tr>`).join('')}</table></div>`;
  $('#newadv').onclick = () => $('#newbox').classList.toggle('hidden');
  $('#nsave').onclick = async () => {
    try {
      const id = must(await sb.rpc('create_advertiser', { biz_name: $('#nn').value, email: $('#ne').value, phone_no: $('#np').value, site: $('#nw').value, link_me: false }));
      await loadBasics(); toast('Advertiser added'); location.hash = `#advertisers/${id}`;
    } catch (e) { fail(e); }
  };
  if (sel) wireAdvertiserCard(sel);
};
function advertiserCard(a) {
  return `<div class="card" style="border-color:var(--navy)"><div class="between"><h2>${esc(a.name)}</h2><a class="btn primary small" href="#new?adv=${a.id}&fresh=1">➕ New ad for them</a></div><div class="grid3">
    ${[['name', 'Business name'], ['contact_email', 'Email'], ['phone', 'Phone'], ['website', 'Website'], ['address', 'Address']].map(([k, l]) => `<div><label class="f">${l}</label><input class="i" data-k="${k}" value="${esc(a[k] || '')}"></div>`).join('')}
    <div><label class="f">Status</label><select class="i" data-k="status"><option ${a.status === 'active' ? 'selected' : ''}>active</option><option ${a.status === 'blocked' ? 'selected' : ''}>blocked</option></select></div></div>
    <label class="f">Private notes (only you see these)</label><textarea class="i" id="anotes"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="asave">Save</button></div>
    <h3 style="margin-top:16px">Logins for this business</h3><div id="logins" class="sub">Loading…</div>
    <div class="row"><input class="i" id="loginEmail" style="max-width:300px" placeholder="their sign-in email"><button class="btn small" id="addlogin">Give access</button></div>
    <p class="sub">They must sign in to the Ad Studio once with that email first.</p></div>`;
}
function wireAdvertiserCard(a) {
  $('#asave').onclick = async () => {
    const patch = {}; $$('[data-k]').forEach((el) => { patch[el.dataset.k] = el.value.trim() || null; }); patch.status = patch.status || 'active';
    try {
      must(await sb.from('advertisers').update(patch).eq('id', a.id));
      must(await sb.from('advertiser_notes').upsert({ advertiser_id: a.id, notes: $('#anotes').value.trim() || null, updated_at: new Date().toISOString() }));
      await loadBasics(); toast('Saved'); route();
    } catch (e) { fail(e); }
  };
  sb.from('advertiser_notes').select('notes').eq('advertiser_id', a.id).maybeSingle().then((r) => { $('#anotes').value = r.data?.notes || ''; });
  sb.rpc('owner_advertiser_logins', { adv: a.id }).then((r) => {
    const rows = r.data || [];
    $('#logins').innerHTML = rows.length ? rows.map((u) => `<div class="row">👤 ${esc(u.email)} <span class="pill">${esc(u.role)}</span><button class="btn small danger" data-unlink="${esc(u.email)}">Remove</button></div>`).join('')
      : 'Nobody yet — you manage this business yourself. If their email above matches, they\'re linked automatically when they first sign in.';
    $$('[data-unlink]').forEach((b) => (b.onclick = async () => { try { must(await sb.rpc('owner_unlink_advertiser_login', { adv: a.id, login_email: b.dataset.unlink })); route(); } catch (e) { fail(e); } }));
  });
  $('#addlogin').onclick = async () => {
    try { must(await sb.rpc('owner_link_advertiser_login', { adv: a.id, login_email: $('#loginEmail').value.trim() })); toast('Access given'); route(); } catch (e) { fail(e); }
  };
}
ROUTES.prices = async () => {
  $('#main').innerHTML = `<h1>Prices</h1><p class="sub">What advertisers see in the Studio. Changes apply to new bookings; approved ads keep their price.</p>
    <div class="card"><table class="t"><tr><th>Spot</th><th>$ per week (all SoCal)</th><th>Advertisers per week</th><th>For sale</th><th>Description</th><th></th></tr>
    ${S.rates.map((r, i) => `<tr><td><b>${esc(spotTitle(r.placement, r.section))}</b></td><td><input class="i" style="max-width:110px" type="number" min="0" step="1" data-i="${i}" data-f="price" value="${r.price_cents_week / 100}"></td>
      <td><input class="i" style="max-width:80px" type="number" min="1" max="50" data-i="${i}" data-f="slots" value="${r.max_slots}"></td><td><input type="checkbox" data-i="${i}" data-f="active" ${r.active ? 'checked' : ''}></td>
      <td><input class="i" data-i="${i}" data-f="desc" value="${esc(r.description || '')}"></td><td><button class="btn small" data-save="${i}">Save</button></td></tr>`).join('')}</table></div>
    <div class="grid2"><div class="card"><h2>Multi-week discounts</h2><table class="t" id="disc">${S.discounts.map((d) => `<tr><td>${d.min_weeks}+ weeks</td><td>${Number(d.pct)}% off</td><td><button class="btn small danger" data-del="${d.min_weeks}">Remove</button></td></tr>`).join('')}</table>
      <div class="row"><input class="i" id="dw" type="number" min="2" max="52" placeholder="weeks" style="max-width:100px"><input class="i" id="dp" type="number" min="0" max="90" placeholder="% off" style="max-width:100px"><button class="btn small" id="dadd">Add</button></div></div>
      <div class="card"><h2>Other settings</h2>
        <label class="f">One targeted area costs this share of the all-SoCal price</label><input class="i" id="factor" type="number" min="0.05" max="1" step="0.05" value="${Number(S.cfg.ad_area_price_factor ?? 0.4)}">
        <label class="f">Payment instructions shown to advertisers</label><textarea class="i" id="payinst">${esc(S.cfg.ad_payment_instructions || '')}</textarea>
        <label class="f">Business name on invoices</label><input class="i" id="bizname" value="${esc(S.cfg.ad_business_name || '')}">
        <div class="row" style="margin-top:12px"><button class="btn primary" id="cfgsave">Save settings</button></div></div></div>`;
  $$('[data-save]').forEach((b) => (b.onclick = async () => {
    const i = b.dataset.save; const r = S.rates[i]; const v = (f) => $(`[data-i="${i}"][data-f="${f}"]`);
    try {
      must(await sb.from('ad_rates').update({ price_cents_week: Math.round(Number(v('price').value) * 100), max_slots: Number(v('slots').value), active: v('active').checked, description: v('desc').value.trim() || null, updated_at: new Date().toISOString() })
        .eq('placement', r.placement).eq('section', r.section));
      await loadBasics(); toast('Price saved');
    } catch (e) { fail(e); }
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => { try { must(await sb.from('ad_discounts').delete().eq('min_weeks', Number(b.dataset.del))); await loadBasics(); route(); } catch (e) { fail(e); } }));
  $('#dadd').onclick = async () => { try { must(await sb.from('ad_discounts').upsert({ min_weeks: Number($('#dw').value), pct: Number($('#dp').value) })); await loadBasics(); route(); } catch (e) { fail(e); } };
  $('#cfgsave').onclick = async () => {
    try {
      must(await sb.from('app_config').upsert([{ key: 'ad_area_price_factor', value: Number($('#factor').value) }, { key: 'ad_payment_instructions', value: $('#payinst').value.trim() }, { key: 'ad_business_name', value: $('#bizname').value.trim() }]));
      await loadBasics(); toast('Settings saved');
    } catch (e) { fail(e); }
  };
};

// ------------------------------------------------------------------ start
(async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!configured) { viewNotConfigured(); return; }
  const { data } = await sb.auth.getSession();
  S.user = data.session?.user ?? null;
  if (!S.user) { viewSignIn(); return; }
  try { S.owner = !!must(await sb.rpc('is_admin')); } catch { S.owner = false; }
  if (!S.owner) { try { await sb.rpc('claim_my_advertiser'); } catch { /* 009 not run yet */ } }
  try { await loadBasics(); } catch (e) { $('#main').innerHTML = `<div class="card note red">Couldn't load the Studio: ${esc(e.message)}. Has the database file 009 been run?</div>`; return; }
  if (!S.owner && !S.adv) { viewSetupBusiness(); return; }
  route();
})();
