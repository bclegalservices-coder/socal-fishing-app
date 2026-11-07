// Look & feel. Themes (Nov 6 overhaul): four day themes and four night themes; you pick one of each in Me → Display, and
// Auto switches between them at sunset / sunrise. Harbor Blue and Red Light are the original two palettes:
//   DAY   — white surfaces, crisp borders, high contrast in sunlight.
//   NIGHT — "red light" helm mode: near-black, warm red/amber text, no blue light, chart dimmed — keeps your
//           night vision and doesn't glare at the helm.
// AUTO switches at sunset / sunrise for where you are. Styles are written once: makeStyles((colors) => ({ … })).
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
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
  route?: string;           // the Go To / route line (default: bright magenta by day, accent at night)
  boat?: string;            // your boat while navigating (default: bright blue by day, accent at night)
  wash?: string | null;     // tint laid over the whole map (red-light themes protect night vision)
  land?: string;            // Nov 6: land color on the map (night themes; day uses the chart's own land)
  coast?: string;           // Nov 6: color the night chart is tinted toward (coastline, land edges)
};

export type ThemeInfo = { id: string; name: string; note: string; mode: Mode; palette: Palette };

export const DAY: Palette = {
  bg: '#EEF2F6',
  water: '#AADAFF',      // Oct 29: soft Google-Maps baby blue, same as the chart's water (was #D8E6EF)
  panel: 'rgba(255,255,255,0.97)',
  panelSolid: '#FFFFFF',
  inset: '#F4F7FA',
  line: '#DCE3EA',
  border: '#B9C6D2',
  text: '#0B1B2B',
  muted: '#4F6375',
  faint: '#7C8D9C',
  accent: '#1E6FD9',      // Harbor Blue (Oct 22): buttons, switches, chips, your data
  accentInk: '#FFFFFF',
  live: '#15803D',        // green: live readings (water temp, your boat, GPS) — deep enough to read in sun
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

// Nov 6: night themes rebuilt. The water is a deep color (not pure black), land a shade lighter in the same family,
// and the NOAA chart is dimmed and tinted toward `coast` (MapScreen), so nothing on the map glares.
export const NIGHT: Palette = {   // Red Light — protects night vision
  bg: '#0B0202',
  water: '#0E0303',
  land: '#220B09',
  coast: '#5A1F18',
  panel: 'rgba(20,5,5,0.94)',
  panelSolid: '#140505',
  inset: '#1E0807',
  line: '#2E0F0C',
  border: '#4A1A14',
  text: '#F07A62',
  muted: '#C0604E',
  faint: '#7A3328',
  accent: '#D9483A',
  accentInk: '#140303',
  live: '#E8906E',
  alert: '#FF5A45',
  alertBg: '#2A0806',
  ok: '#C9A25A',
  okBg: '#1C1206',
  warn: '#E8A050',
  warnBg: '#221006',
  infoBg: '#1C0907',
  buddy: '#C77DA0',
  shadow: '#000000',
  overlay: 'rgba(0,0,0,0.6)',
  statusBar: 'light-content',
  chartBrightness: 0.22,
  layerBrightness: 0.6,
  wash: 'rgba(40,0,0,0.18)',
};

const dark = (p: Partial<Palette>): Palette => ({ ...DAY, statusBar: 'light-content', shadow: '#000000', overlay: 'rgba(0,0,0,0.55)', ...p } as Palette);

export const CHANNEL_NAV: Palette = { ...DAY,
  bg: '#F3F7FB', water: '#AADAFF',   // Oct 30: baby-blue water (shows through the chart) border: '#AEBFCF', line: '#D7E0E8', text: '#0A0F14', muted: '#44525E', faint: '#74828E',
  accent: '#1A5FB4', live: '#16773F', ok: '#16773F', okBg: '#E2F3E8', infoBg: '#E4EEF9' };

export const DEEP_OCEAN: Palette = dark({
  bg: '#0F2236', water: '#12304A', panel: 'rgba(22,49,77,0.97)', panelSolid: '#16314D', inset: '#1C3B5C', line: '#244668', border: '#33587E',
  text: '#E6F0F8', muted: '#9DB4C8', faint: '#7590A8', accent: '#19B3A6', accentInk: '#04211E', live: '#4ADE80',
  alert: '#FF6B5E', alertBg: '#3A1714', ok: '#4ADE80', okBg: '#12352A', warn: '#F5B54A', warnBg: '#3A2A10', infoBg: '#173A5A', buddy: '#B794F6' });

export const KELP: Palette = { ...DAY,
  bg: '#F4EFE3', water: '#AADAFF', panel: 'rgba(255,253,247,0.97)', panelSolid: '#FFFDF7', inset: '#F7F2E6', line: '#E3DAC6', border: '#C9BE9F',
  text: '#1F2A1C', muted: '#5E6B57', faint: '#86907E', accent: '#2F5D3A', live: '#3A7D44', ok: '#3A7D44', okBg: '#E5F0E2', infoBg: '#EAF0E6', shadow: '#1F2A1C' };

export const SUNSET: Palette = dark({
  bg: '#1E2024', water: '#23272D', panel: 'rgba(42,45,51,0.97)', panelSolid: '#2A2D33', inset: '#33373E', line: '#3A3F47', border: '#4B515B',
  text: '#F2F2F2', muted: '#A9AEB7', faint: '#80868F', accent: '#F47B20', accentInk: '#2A1200', live: '#4ADE80',
  alert: '#FF6B5E', alertBg: '#3D1C19', ok: '#4ADE80', okBg: '#173322', warn: '#F5B54A', warnBg: '#3A2C12', infoBg: '#2C333D', buddy: '#C4A1FF' });

export const HIGH_CONTRAST: Palette = { ...DAY,
  bg: '#FFFFFF', water: '#AADAFF', panel: '#FFFFFF', panelSolid: '#FFFFFF', inset: '#F2F2F2', line: '#000000', border: '#000000',
  text: '#000000', muted: '#1A1A1A', faint: '#3D3D3D', accent: '#0047AB', live: '#006B2D', alert: '#B00000', ok: '#006B2D', warn: '#7A4500' };

export const AMBER: Palette = { ...NIGHT,   // warm, a bit easier to read than red
  bg: '#0D0902', water: '#100B02', land: '#231A08', coast: '#5C4515',
  panel: 'rgba(23,16,3,0.94)', panelSolid: '#171003', inset: '#211705', line: '#33260A', border: '#4A3810',
  text: '#F2B45A', muted: '#C08A3A', faint: '#7A5A20', accent: '#D9921C', accentInk: '#160D00', live: '#F5C26E',
  alertBg: '#2A1204', okBg: '#1A1608', warnBg: '#241604', infoBg: '#1A1206', buddy: '#D99A6C',
  chartBrightness: 0.24, layerBrightness: 0.62, wash: 'rgba(36,20,0,0.16)' };

/** Night Navy (Nov 6, the new default night look): navy water, slate land, soft white text — a normal dark mode. */
export const NIGHT_NAVY: Palette = dark({
  bg: '#0A1626', water: '#0B1E33', land: '#1F2833', coast: '#3E5570',
  panel: 'rgba(15,27,43,0.95)', panelSolid: '#0F1B2B', inset: '#16243A', line: '#1C2E46', border: '#26405E',
  text: '#D5E2F0', muted: '#8FA6C0', faint: '#5E7C9C', accent: '#4FB3E8', accentInk: '#04121F', live: '#6FD3A8',
  alert: '#FF6B5E', alertBg: '#3A1418', ok: '#6FD3A8', okBg: '#0F3328', warn: '#F5B54A', warnBg: '#36290F', infoBg: '#14284A', buddy: '#B794F6',
  chartBrightness: 0.3, layerBrightness: 0.8, route: '#E05AD0', boat: '#4FB3E8', wash: null });

/** Dusk (Nov 6): a softer dark blue for evenings and at the dock (replaces Deep Ocean / Sunset / Dark Blue). */
export const DUSK: Palette = dark({
  bg: '#122236', water: '#14283D', land: '#2A3340', coast: '#4D6580',
  panel: 'rgba(26,38,56,0.96)', panelSolid: '#1A2638', inset: '#213049', line: '#28395A', border: '#33496A',
  text: '#E6EEF7', muted: '#A3B6CB', faint: '#6E8BAA', accent: '#5FC4B6', accentInk: '#062420', live: '#5FD39A',
  alert: '#FF6B5E', alertBg: '#3A1714', ok: '#5FD39A', okBg: '#12352A', warn: '#F5B54A', warnBg: '#3A2A10', infoBg: '#1C3350', buddy: '#C4A1FF',
  chartBrightness: 0.38, layerBrightness: 0.85, route: '#FF4FD8', boat: '#5FC4B6', wash: null });
export const DARK_BLUE = NIGHT_NAVY;   // older name

export const DAY_THEMES: ThemeInfo[] = [
  { id: 'harbor', name: 'Harbor Blue', note: 'The original', mode: 'day', palette: DAY },
  { id: 'channelnav', name: 'Channel Nav', note: 'Logo blue, black and green', mode: 'day', palette: CHANNEL_NAV },
  { id: 'kelp', name: 'Kelp', note: 'Kelp green and sand', mode: 'day', palette: KELP },
  { id: 'contrast', name: 'High Contrast', note: 'For bright sun', mode: 'day', palette: HIGH_CONTRAST },
];
export const NIGHT_THEMES: ThemeInfo[] = [
  { id: 'navy', name: 'Night Navy', note: 'Easy on the eyes', mode: 'night', palette: NIGHT_NAVY },
  { id: 'red', name: 'Red Light', note: 'Protects night vision', mode: 'night', palette: NIGHT },
  { id: 'amber', name: 'Amber', note: 'Warm, a bit easier to read', mode: 'night', palette: AMBER },
  { id: 'dusk', name: 'Dusk', note: 'Evenings and at the dock', mode: 'night', palette: DUSK },
];
/** Nov 6: themes that were removed or renamed → what they become. */
const RENAMED: Record<string, string> = { darkblue: 'navy', ocean: 'harbor', sunset: 'harbor' };
export const findTheme = (list: ThemeInfo[], id: string | null | undefined) =>
  list.find((t) => t.id === id) ?? list.find((t) => t.id === RENAMED[id ?? '']) ?? list[0];

/** Route line and boat colors for a palette (bright magenta / blue unless the theme says otherwise). */
export const routeColor = (p: Palette, mode: Mode) => p.route ?? (mode === 'night' ? p.accent : '#FF1CF0');
export const boatColor = (p: Palette, mode: Mode) => p.boat ?? (mode === 'night' ? p.accent : '#00A3FF');
/** Light themes get soft card shadows; dark ones don't need them. */
export const isLight = (p: Palette) => p.statusBar === 'dark-content';

// Kept for older code: the active palette per mode is decided by the chosen themes (ThemeProvider).
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
type Ctx = { mode: Mode; setting: ThemeSetting; setSetting: (s: ThemeSetting) => void; toggle: () => void; palette: Palette;
  themeId: string; dayTheme: string; nightTheme: string; setDayTheme: (id: string) => void; setNightTheme: (id: string) => void };
const ThemeCtx = createContext<Ctx>({ mode: 'day', setting: 'auto', setSetting: () => {}, toggle: () => {}, palette: DAY,
  themeId: 'harbor', dayTheme: 'harbor', nightTheme: 'navy', setDayTheme: () => {}, setNightTheme: () => {} });
const KEY = 'theme-setting:v1';
const DAY_KEY = 'theme-day:v1';
const NIGHT_KEY = 'theme-night:v1';
let lastPos = { lat: 33.6, lon: -117.9 };          // updated by the map with your GPS fix
export function setThemePosition(lat: number, lon: number) { lastPos = { lat, lon }; }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>('auto');
  const [dayTheme, setDayState] = useState('harbor');
  const [nightTheme, setNightState] = useState('navy');
  const [autoNight, setAutoNight] = useState(() => isNightAt(lastPos.lat, lastPos.lon));
  useEffect(() => {
    AsyncStorage.multiGet([KEY, DAY_KEY, NIGHT_KEY]).then((rows) => {
      const v = Object.fromEntries(rows);
      if (v[KEY] === 'day' || v[KEY] === 'night' || v[KEY] === 'auto') setSettingState(v[KEY] as ThemeSetting);
      if (v[DAY_KEY]) setDayState(findTheme(DAY_THEMES, v[DAY_KEY]).id);
      if (v[NIGHT_KEY]) setNightState(findTheme(NIGHT_THEMES, v[NIGHT_KEY]).id);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const tick = () => setAutoNight(isNightAt(lastPos.lat, lastPos.lon));
    tick();
    const t = setInterval(tick, 60000);
    return () => clearInterval(t);
  }, []);
  const mode: Mode = setting === 'auto' ? (autoNight ? 'night' : 'day') : setting;
  const theme = mode === 'night' ? findTheme(NIGHT_THEMES, nightTheme) : findTheme(DAY_THEMES, dayTheme);
  current = theme.palette;                         // set before children render
  const value = useMemo<Ctx>(() => ({
    mode, setting, palette: theme.palette, themeId: theme.id, dayTheme, nightTheme,
    setSetting: (s) => { setSettingState(s); AsyncStorage.setItem(KEY, s).catch(() => {}); },
    toggle: () => { const next: Mode = mode === 'day' ? 'night' : 'day'; setSettingState(next); AsyncStorage.setItem(KEY, next).catch(() => {}); },
    setDayTheme: (id) => { setDayState(id); AsyncStorage.setItem(DAY_KEY, id).catch(() => {}); },
    setNightTheme: (id) => { setNightState(id); AsyncStorage.setItem(NIGHT_KEY, id).catch(() => {}); },
  }), [mode, setting, theme.id, dayTheme, nightTheme]);
  return createElement(ThemeCtx.Provider, { value }, children);
}
export const useTheme = () => useContext<Ctx>(ThemeCtx);

/** Write styles once with the palette; each component gets the right set for day or night. */
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };
/** Theme-aware StyleSheet. Typed like StyleSheet.create, so values such as fontWeight: '700' keep their exact type. */
export function makeStyles<T extends NamedStyles<T>>(fn: (c: Palette, mode: Mode) => T & NamedStyles<any>): () => T {
  const cache: Record<string, T> = {};
  return function useStyles(): T {
    const { mode, themeId, palette } = useContext<Ctx>(ThemeCtx);
    return (cache[`${mode}:${themeId}`] ??= StyleSheet.create(fn(palette, mode) as any) as T);
  };
}
/** Card look shared by every screen: defined border + soft shadow in daylight. */
export function cardStyle(c: Palette) {
  return { backgroundColor: c.panelSolid, borderWidth: 1, borderColor: c.border, borderRadius: radius.md,
    shadowColor: c.shadow, shadowOpacity: isLight(c) ? 0.06 : 0, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: isLight(c) ? 1 : 0 } as const;
}
