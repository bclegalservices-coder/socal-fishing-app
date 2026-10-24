// GPX / KML import and GPX export (spec §29–30). Plain-text parsing: works offline, no XML library needed.
export type ImportedPoint = { name: string; lat: number; lon: number; desc?: string; time?: number };
export type ImportedLine = { name: string; points: { lat: number; lon: number; name?: string }[]; kind: 'route' | 'track' };
export type Imported = { points: ImportedPoint[]; lines: ImportedLine[]; warnings: string[] };

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (xml: string, name: string) => { const m = xml.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')); return m ? decode(m[1]) : undefined; };
const attr = (open: string, name: string) => { const m = open.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i')); return m ? m[1] : undefined; };
const valid = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

function blocks(xml: string, name: string): { open: string; body: string }[] {
  const re = new RegExp(`(<(?:\\w+:)?${name}\\b[^>]*?)(?:/>|>([\\s\\S]*?)</(?:\\w+:)?${name}>)`, 'gi');
  const out: { open: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ open: m[1], body: m[2] ?? '' });
  return out;
}

/** Trim spaces and the curly quotes some apps put around names (Navionics: “43” → 43). */
export function cleanName(s?: string): string {
  return (s ?? '').trim().replace(/^[“"'‘]+|[”"'’]+$/g, '').trim();
}

/** Repeats inside one file: points within `m` metres of an earlier one (apps save the same spot again on a double tap).
 *  Keeps one per place: a real name beats "Marker 12" / "Waypoint 3", then the oldest. Returns the kept points. */
export function mergeRepeats(points: ImportedPoint[], m = 10): ImportedPoint[] {
  const generic = (n: string) => /^(marker|waypoint|wpt|mark|placemark)\s*\d+$/i.test(n.trim());
  const keep: ImportedPoint[] = [];
  for (const p of points) {
    const i = keep.findIndex((k) => metres(k, p) < m);
    if (i < 0) { keep.push(p); continue; }
    const k = keep[i];
    const better = (generic(k.name) && !generic(p.name)) || (generic(k.name) === generic(p.name) && (p.time ?? Infinity) < (k.time ?? Infinity));
    if (better) keep[i] = { ...p, desc: p.desc ?? k.desc };
  }
  return keep;
}

export function parseGPX(xml: string): Imported {
  const res: Imported = { points: [], lines: [], warnings: [] };
  let n = 0;
  for (const b of blocks(xml, 'wpt')) {
    const lat = Number(attr(b.open, 'lat')), lon = Number(attr(b.open, 'lon'));
    if (!valid(lat, lon)) { res.warnings.push('Skipped a waypoint with bad coordinates'); continue; }
    const t = Date.parse(tag(b.body, 'time') ?? '');
    res.points.push({ name: cleanName(tag(b.body, 'name')) || `Waypoint ${++n}`, lat, lon, desc: tag(b.body, 'desc') || tag(b.body, 'cmt'), time: Number.isFinite(t) ? t : undefined });
  }
  for (const [kind, outer, inner] of [['route', 'rte', 'rtept'], ['track', 'trk', 'trkpt']] as const) {
    blocks(xml, outer).forEach((r, i) => {
      const pts = blocks(r.body, inner).map((p) => ({ lat: Number(attr(p.open, 'lat')), lon: Number(attr(p.open, 'lon')), name: tag(p.body, 'name') }))
        .filter((p) => valid(p.lat, p.lon));
      // a track's name tag comes before its segments; strip nested points first
      const name = tag(r.body.replace(new RegExp(`<(?:\\w+:)?${inner}[\\s\\S]*?</(?:\\w+:)?${inner}>`, 'gi'), ''), 'name') || `${kind === 'route' ? 'Route' : 'Track'} ${i + 1}`;
      if (pts.length >= 2) res.lines.push({ name, points: pts, kind });
    });
  }
  return res;
}

export function parseKML(xml: string): Imported {
  const res: Imported = { points: [], lines: [], warnings: [] };
  let n = 0;
  for (const pm of blocks(xml, 'Placemark')) {
    const name = tag(pm.body, 'name');
    const coordsText = (tag(pm.body, 'coordinates') ?? '').trim();
    const coords = coordsText.split(/\s+/).map((c) => c.split(',').map(Number)).filter((c) => c.length >= 2 && valid(c[1], c[0]));
    if (/<(?:\w+:)?Point\b/i.test(pm.body) && coords[0]) res.points.push({ name: name || `Placemark ${++n}`, lat: coords[0][1], lon: coords[0][0], desc: tag(pm.body, 'description') });
    else if (/<(?:\w+:)?LineString\b/i.test(pm.body) && coords.length >= 2) res.lines.push({ name: name || `Line ${++n}`, kind: 'route', points: coords.map((c) => ({ lat: c[1], lon: c[0] })) });
    else if (/<(?:\w+:)?Polygon\b/i.test(pm.body)) res.warnings.push(`Skipped area "${name ?? ''}" (areas aren't imported as spots)`);
  }
  return res;
}

export function parseAny(text: string): Imported {
  if (/<gpx[\s>]/i.test(text)) return parseGPX(text);
  if (/<kml[\s>]/i.test(text)) return parseKML(text);
  throw new Error('This file is not GPX or KML');
}

/** Metres between two points (flat-earth is fine at this scale) — used for duplicate checks. */
export function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const dy = (a.lat - b.lat) * 111320, dx = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Duplicate = same name within 50 m, or any existing spot within 15 m. Never overwrites. */
export function findDuplicates(incoming: ImportedPoint[], existing: { name: string; lat: number; lon: number }[]) {
  return incoming.map((p) => existing.find((e) => metres(e, p) < 15 || (e.name.trim().toLowerCase() === p.name.trim().toLowerCase() && metres(e, p) < 50)) ?? null);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f6 = (n: number) => n.toFixed(6);

export function buildGPX(data: { points: { name: string; lat: number; lon: number; desc?: string }[]; routes: { name: string; points: { lat: number; lon: number; name?: string }[] }[];
  tracks: { name: string; points: { lat: number; lon: number; t?: number }[] }[] }, creator = 'SoCal Fishing App'): string {
  const out = [`<?xml version="1.0" encoding="UTF-8"?>`, `<gpx version="1.1" creator="${esc(creator)}" xmlns="http://www.topografix.com/GPX/1/1">`];
  for (const p of data.points) out.push(`  <wpt lat="${f6(p.lat)}" lon="${f6(p.lon)}"><name>${esc(p.name)}</name>${p.desc ? `<desc>${esc(p.desc)}</desc>` : ''}<sym>Fishing Area</sym></wpt>`);
  for (const r of data.routes) {
    out.push(`  <rte><name>${esc(r.name)}</name>`);
    r.points.forEach((p, i) => out.push(`    <rtept lat="${f6(p.lat)}" lon="${f6(p.lon)}"><name>${esc(p.name ?? `${r.name} ${i + 1}`)}</name></rtept>`));
    out.push('  </rte>');
  }
  for (const t of data.tracks) {
    out.push(`  <trk><name>${esc(t.name)}</name><trkseg>`);
    t.points.forEach((p) => out.push(`    <trkpt lat="${f6(p.lat)}" lon="${f6(p.lon)}">${p.t ? `<time>${new Date(p.t).toISOString()}</time>` : ''}</trkpt>`));
    out.push('  </trkseg></trk>');
  }
  out.push('</gpx>');
  return out.join('\n');
}
