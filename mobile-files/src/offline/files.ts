// Large data (map vectors, tide pack, tracks) lives in files, not key-value storage
// (Android's key-value store has a small size cap). One place to adjust if the Expo API changes.
import * as FS from 'expo-file-system/legacy';

const dir = `${FS.documentDirectory}data/`;
let ready: Promise<void> | null = null;
const ensure = () => (ready ??= FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {}));
const path = (key: string) => dir + key.replace(/[^a-zA-Z0-9._-]/g, '_');

export async function writeJSON(key: string, v: unknown) { await ensure(); await FS.writeAsStringAsync(path(key), JSON.stringify(v)); }
export async function readJSON<T>(key: string): Promise<T | null> {
  try { await ensure(); return JSON.parse(await FS.readAsStringAsync(path(key))) as T; } catch { return null; }
}
export async function remove(key: string) { await FS.deleteAsync(path(key), { idempotent: true }); }
export async function writeText(name: string, text: string): Promise<string> { await ensure(); const p = path(name); await FS.writeAsStringAsync(p, text); return p; }
export async function readFileText(uri: string): Promise<string> { return FS.readAsStringAsync(uri); }
export async function readFileBase64(uri: string): Promise<string> { return FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 }); }
