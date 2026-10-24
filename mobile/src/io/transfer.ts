// Pick a GPX / KML / KMZ file and read it; write a GPX and open the share sheet (for chartplotters, email, AirDrop…).
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { strFromU8, unzipSync } from 'fflate';
import { readFileBase64, readFileText, writeText } from '../offline/files';
import { buildGPX, parseAny, type Imported } from './gpx';
import { loadRoutes, loadSpots, loadTrackPoints, loadTracks } from '../storage';

function b64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (chars.indexOf(clean[i]) << 18) | (chars.indexOf(clean[i + 1]) << 12) | ((chars.indexOf(clean[i + 2]) & 63) << 6) | (chars.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

export async function pickAndParse(): Promise<{ fileName: string; data: Imported } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const name = a.name ?? 'Imported';
  let text: string;
  if (/\.kmz$/i.test(name)) {
    const files = unzipSync(b64ToBytes(await readFileBase64(a.uri)));
    const kml = Object.keys(files).find((k) => /\.kml$/i.test(k));
    if (!kml) throw new Error('No KML file inside this KMZ');
    text = strFromU8(files[kml]);
  } else {
    text = await readFileText(a.uri);
  }
  return { fileName: name.replace(/\.(gpx|kml|kmz)$/i, ''), data: parseAny(text) };
}

export async function exportAllGPX() {
  const [spots, routes, metas] = await Promise.all([loadSpots(), loadRoutes(), loadTracks()]);
  const tracks = await Promise.all(metas.map(async (m) => ({ name: m.name, points: await loadTrackPoints(m.id) })));
  const gpx = buildGPX({
    points: spots.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, desc: s.notes })),
    routes: routes.map((r) => ({ name: r.name, points: r.points })),
    tracks: tracks.map((t) => ({ name: t.name, points: t.points.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t })) })),
  });
  const uri = await writeText(`my-fishing-${new Date().toISOString().slice(0, 10)}.gpx`, gpx);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: 'Export my spots, routes and tracks' });
  return { spots: spots.length, routes: routes.length, tracks: tracks.length };
}

/** One trip as a GPX file in the share sheet (Messages, email, AirDrop, chartplotter apps). */
export async function exportTrackGPX(meta: { id: string; name: string }) {
  const points = await loadTrackPoints(meta.id);
  const gpx = buildGPX({ points: [], routes: [], tracks: [{ name: meta.name, points: points.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t })) }] });
  const safe = meta.name.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'trip';
  const uri = await writeText(`${safe}.gpx`, gpx);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: `Share ${meta.name}` });
}

/** Chosen spots as one GPX file in the share sheet (works with Navionics, Garmin, Lowrance, Simrad and most plotters). */
export async function exportSpotsGPX(spots: { name: string; lat: number; lon: number; notes?: string }[]) {
  const gpx = buildGPX({ points: spots.map((s) => ({ name: s.name, lat: s.lat, lon: s.lon, desc: s.notes })), routes: [], tracks: [] });
  const uri = await writeText(`spots-${spots.length}-${new Date().toISOString().slice(0, 10)}.gpx`, gpx);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(uri, { mimeType: 'application/gpx+xml', UTI: 'com.topografix.gpx', dialogTitle: `Share ${spots.length} spot${spots.length === 1 ? '' : 's'}` });
}
