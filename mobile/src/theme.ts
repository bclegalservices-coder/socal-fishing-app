// Look & feel. Two palettes:
//   DAY   — white surfaces, crisp borders, high contrast in sunlight.
//   NIGHT — "red light" helm mode: near-black, warm red/amber text, no blue light, chart dimmed — keeps your
//           night vision and doesn't glare at the helm.
// AUTO switches at sunset / sunrise for where you are. Styles are written once: makeStyles((colors) => ({ … })).
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Mode = 'day' | 'night';
export type ThemeSetting = 'auto' | 'day' | 'night';

export type Palette = {
  bg: string;          // screen background
  water: string;       // map background before tiles load
  panel: string;       // floating panels over the map (slightly see-through)
  panelSolid: string;  // cards, sheets, bars
  inset: string;       // inputs, wells, secondary rows
  line: string;        // hairlines between rows
  border: string;      // card / control outlines (more defined)
  text: string;
  muted: string;
  faint: string;
  accent: string;      // actions and your data
  accentInk: string;   // text on accent
  live: string;        // your boat and live readings
  alert: string;
  alertBg: string;
  ok: string;
  okBg: string;
  warn: string;
  warnBg: string;
  infoBg: string;
  buddy: string;       // buddy boats
  shadow: string;
  overlay: string;     // dim behind sheets
  statusBar: 'dark-content' | 'light-content';
  chartBrightness: number;  // NOAA chart max brightness (1 = normal)
  layerBrightness: number;  // satellite overlays max brightness
};

export const DAY: Palette = {
  bg: '#EEF2F6',
  water: '#D8E6EF',
  panel: 'rgba(255,255,255,0.97)',
  panelSolid: '#FFFFFF',
  inset: '#F4F7FA',
  line: '#DCE3EA',
  border: '#B9C6D2',
  text: '#0B1B2B',
  muted: '#4F6375',
  faint: '#7C8D9C',
  accent: '#D97B00',
  accentInk: '#FFFFFF',
  live: '#0A6E94',
  alert: '#C0362C',
  alertBg: '#FCEBE8',
  ok: '#1E7F48',
  okBg: '#E3F4EA',
  warn: '#9A5B00',
  warnBg: '#FFF3DC',
  infoBg: '#E6F2F8',
  buddy: '#7A3FD0',
  shadow: '#0B1B2B',
  overlay: 'rgba(11,27,43,0.35)',
  statusBar: 'dark-content',
  chartBrightness: 1,
  layerBrightness: 1,
};

export const NIGHT: Palette = {
  bg: '#000000',
  water: '#050302',
  panel: 'rgba(12,6,5,0.94)',
  panelSolid: '#0D0706',
  inset: '#160C0A',
  line: '#2A1714',
  border: '#4A2722',
  text: '#F0B8A6',
  muted: '#A8786B',
  faint: '#7A5349',
  accent: '#E5793A',
  accentInk: '#140804',
  live: '#D99A6C',
  alert: '#FF4E3D',
  alertBg: '#2A0C08',
  ok: '#B5A35E',
  okBg: '#1A1508',
  warn: '#E0A050',
  warnBg: '#1F1206',
  infoBg: '#1A0D0A',
  buddy: '#C77DA0',
  shadow: '#000000',
  overlay: 'rgba(0,0,0,0.6)',
  statusBar: 'light-content',
  chartBrightness: 0.38,
  layerBrightness: 0.6,
};
export const PALETTES: Record<Mode, Palette> = { day: DAY, night: NIGHT };

let current: Palette = DAY;
/** Live colors for inline use (`colors.text`). Always the active palette. */
export const colors: Palette = new Proxy({} as Palette, { get: (_t, k) => (current as any)[k] });
export const touch = { min: 52 };        // big targets for a moving boat
export const radius = { sm: 8, md: 12, lg: 16 };
export const space = (n: number) => n * 4;

// ---------------- sunrise / sunset (same equation as the server; ~1-2 min accuracy) ----------------
export function sunTimes(lat: number, lon: number, date = new Date()): { rise: Date; set: Date } | null {
  const day0 = Date.UTC(2000, 0, 1);
  const n = Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - day0) / 86400000);
  const jStar = n - lon / 360;
  const M = ((357.5291 + 0.98560028 * jStar) % 360) * (Math.PI / 180);
  const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const lam = (((M * 180) / Math.PI + C + 180 + 102.9372) % 360) * (Math.PI / 180);
  const jTransit = 2451545 + jStar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lam);
  const dec = Math.asin(Math.sin(lam) * Math.sin((23.44 * Math.PI) / 180));
  const phi = (lat * Math.PI) / 180;
  const cosW = (Math.sin((-0.833 * Math.PI) / 180) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW <= -1 || cosW >= 1) return null;
  const w = (Math.acos(cosW) * 180) / Math.PI;
  const toDate = (jd: number) => new Date(Date.UTC(2000, 0, 1, 12) + (jd - 2451545) * 86400000);
  return { rise: toDate(jTransit - w / 360), set: toDate(jTransit + w / 360) };
}
/** Night from 20 min after sunset until 20 min before sunrise. */
export function isNightAt(lat: number, lon: number, now = new Date()): boolean {
  const t = sunTimes(lat, lon, now);
  if (!t) return false;
  const m = 20 * 60000;
  return now.getTime() > t.set.getTime() + m || now.getTime() < t.rise.getTime() - m;
}

// ---------------- provider ----------------
type Ctx = { mode: Mode; setting: ThemeSetting; setSetting: (s: ThemeSetting) => void; toggle: () => void; palette: Palette };
const ThemeCtx = createContext<Ctx>({ mode: 'day', setting: 'auto', setSetting: () => {}, toggle: () => {}, palette: DAY });
const KEY = 'theme-setting:v1';
let lastPos = { lat: 33.6, lon: -117.9 };          // updated by the map with your GPS fix
export function setThemePosition(lat: number, lon: number) { lastPos = { lat, lon }; }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>('auto');
  const [autoNight, setAutoNight] = useState(() => isNightAt(lastPos.lat, lastPos.lon));
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v === 'day' || v === 'night' || v === 'auto') setSettingState(v); }).catch(() => {}); }, []);
  useEffect(() => {
    const tick = () => setAutoNight(isNightAt(lastPos.lat, lastPos.lon));
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);
  const mode: Mode = setting === 'auto' ? (autoNight ? 'night' : 'day') : setting;
  current = PALETTES[mode];                        // set before children render
  const value = useMemo<Ctx>(() => ({
    mode, setting, palette: PALETTES[mode],
    setSetting: (s) => { setSettingState(s); AsyncStorage.setItem(KEY, s).catch(() => {}); },
    toggle: () => { const next: Mode = mode === 'day' ? 'night' : 'day'; setSettingState(next); AsyncStorage.setItem(KEY, next).catch(() => {}); },
  }), [mode, setting]);
  return createElement(ThemeCtx.Provider, { value }, children);
}
export const useTheme = () => useContext<Ctx>(ThemeCtx);

/** Write styles once with the palette; each component gets the right set for day or night. */
export function makeStyles<T>(fn: (c: Palette, mode: Mode) => T): () => T {
  const cache: Partial<Record<Mode, T>> = {};
  return function useStyles(): T {
    const { mode } = useContext<Ctx>(ThemeCtx);
    return (cache[mode] ??= StyleSheet.create(fn(PALETTES[mode], mode) as any) as T);
  };
}
/** Card look shared by every screen: defined border + soft shadow in daylight. */
export function cardStyle(c: Palette) {
  return { backgroundColor: c.panelSolid, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    shadowColor: c.shadow, shadowOpacity: c === DAY ? 0.06 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: c === DAY ? 1 : 0 } as const;
}
