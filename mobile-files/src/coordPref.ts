// Which coordinate format the whole app shows (Me → Coordinate format). Saved on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { setCoordFormat, getCoordFormat, type CoordFormat } from './geo';

const KEY = 'coord-format:v1';
const listeners = new Set<(f: CoordFormat) => void>();

export async function loadCoordFormat() {
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'dd' || v === 'ddm' || v === 'dms') { setCoordFormat(v); listeners.forEach((l) => l(v)); }
  } catch { /* keep default */ }
}

export function chooseCoordFormat(f: CoordFormat) {
  setCoordFormat(f);
  AsyncStorage.setItem(KEY, f).catch(() => {});
  listeners.forEach((l) => l(f));
}

/** Re-renders the screen when the format changes. */
export function useCoordFormat(): CoordFormat {
  const [f, setF] = useState(getCoordFormat());
  useEffect(() => { listeners.add(setF); return () => { listeners.delete(setF); }; }, []);
  return f;
}

export const COORD_EXAMPLES: Record<CoordFormat, string> = {
  ddm: '33°24.075′N (most GPS units)',
  dd: '33.40125°N (decimal)',
  dms: '33°24′04.5″N (degrees, minutes, seconds)',
};
