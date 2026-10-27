// "Screen stays on" setting (Oct 27): keep the phone from locking while you use the map.
//   always — whenever Channel Nav is open (default)  ·  active — only while navigating or recording a trip  ·  off
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AwakeMode = 'always' | 'active' | 'off';
const KEY = 'keep-awake:v1';
let current: AwakeMode = 'always';
const subs = new Set<(m: AwakeMode) => void>();
AsyncStorage.getItem(KEY).then((v) => { if (v === 'always' || v === 'active' || v === 'off') { current = v; subs.forEach((f) => f(v)); } }).catch(() => {});

export const AWAKE_LABELS: Record<AwakeMode, string> = {
  always: 'Always while the app is open', active: 'Only while navigating or recording', off: 'Off (phone locks normally)' };

export function setAwakeMode(m: AwakeMode) {
  current = m; subs.forEach((f) => f(m));
  AsyncStorage.setItem(KEY, m).catch(() => {});
}

export function useAwakeMode(): AwakeMode {
  const [m, setM] = useState(current);
  useEffect(() => { subs.add(setM); setM(current); return () => { subs.delete(setM); }; }, []);
  return m;
}
