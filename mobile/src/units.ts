// Distance and speed units, shared with the navigation banner (tap its big boxes to switch NM ↔ miles, kt ↔ mph).
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Units = { dist: 'nm' | 'mi'; speed: 'kt' | 'mph' };
const KEY = 'hud-units:v1';
let cached: Units = { dist: 'nm', speed: 'kt' };
AsyncStorage.getItem(KEY).then((v) => { if (v) cached = { ...cached, ...JSON.parse(v) }; }).catch(() => {});

export function useUnits(): Units {
  const [u, setU] = useState<Units>(cached);
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) { cached = { ...cached, ...JSON.parse(v) }; setU(cached); } }).catch(() => {}); }, []);
  return u;
}

const NM_TO_MI = 1.150779;
export const distVal = (nm: number, u: Units) => (u.dist === 'mi' ? nm * NM_TO_MI : nm);
export const speedVal = (kt: number, u: Units) => (u.speed === 'mph' ? kt * NM_TO_MI : kt);
export const distLabel = (u: Units) => (u.dist === 'mi' ? 'mi' : 'NM');
export const speedLabel = (u: Units) => (u.speed === 'mph' ? 'mph' : 'kt');
export function fmtDist(nm: number, u: Units): string {
  const v = distVal(nm, u);
  return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${distLabel(u)}`;
}
export const fmtSpeed = (kt: number, u: Units) => `${speedVal(kt, u).toFixed(1)} ${speedLabel(u)}`;
/** 1h 31m · 26m · 2d 20h */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
/** 26:10 or 1:31:05 for playback clocks */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
