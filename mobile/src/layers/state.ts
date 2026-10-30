// Which layers are on, how see-through they are, and one-tap presets.
export type LayerKey = 'bathy' | 'bathyHd' | 'contours' | 'sst' | 'breaks' | 'chl' | 'chlEdges' | 'radar' | 'wind' | 'buoys' | 'catches' | 'buddies' | 'rules' | 'hazards'
  | 'spots' | 'mySpots' | 'air' | 'marinas' | 'docks' | 'fuel' | 'pumpout' | 'ramps' | 'bait' | 'sci' | 'spotHist';
export type MapOverlay = 'none' | 'relief' | 'satellite';
/** How busy the NOAA chart is. clean: coastline, depth shading and main depth lines only.
 *  standard: + buoys, lights, lanes, restricted areas, wrecks. full: everything, incl. every depth number and contour,
 *  even when zoomed out (like a paper chart). */
export type ChartLook = 'clean' | 'standard' | 'full';
export type LayerState = {
  on: Record<LayerKey, boolean>;
  overlay: MapOverlay;     // drawn over the NOAA chart: colored seafloor relief or satellite photos
  tilt: boolean;           // 3D view: tip the map back so relief reads like terrain
  contourDetail: 'std' | 'max';   // Depth contours: Standard or Max (lots of lines)
  chart: { look: ChartLook; navaids: boolean; lanes: boolean; seabed: boolean; areas: boolean; services: boolean; lightCircles: boolean; simpleSymbols: boolean };  // NOAA chart details shown
  opacity: { bathy: number; bathyHd: number; sst: number; chl: number; radar: number; overlay: number; wind: number };
  dayIndex: number;      // 0 = latest satellite day, 1 = the one before ...
  windIndex: number;     // forecast hour index
};

/** What each chart style switches on (the switches under "NOAA chart details" can still be changed one by one). */
export const CHART_LOOKS: Record<ChartLook, Omit<LayerState['chart'], 'look' | 'lightCircles' | 'simpleSymbols'>> = {
  clean: { navaids: false, lanes: false, seabed: false, areas: false, services: false },
  standard: { navaids: true, lanes: true, seabed: true, areas: true, services: false },
  full: { navaids: true, lanes: true, seabed: true, areas: true, services: true },
};

/** First open: a calm, clean chart. Only the protected-area outlines (so nobody fishes a closed area by mistake)
 *  and your crew's boats are on; everything else is one tap away in Map options. */
export const DEFAULT_LAYERS: LayerState = {
  on: { bathy: false, bathyHd: false, contours: false, sst: false, breaks: false, chl: false, chlEdges: false, radar: false, wind: false, buoys: false, catches: false, buddies: true, rules: true, hazards: false,
    spots: false, mySpots: true, air: false, marinas: false, docks: false, fuel: false, pumpout: false, ramps: false, bait: false, sci: true, spotHist: false },
  overlay: 'none',
  tilt: false,
  contourDetail: 'std',
  chart: { look: 'clean', ...CHART_LOOKS.clean, lightCircles: false, simpleSymbols: false },
  opacity: { bathy: 0.8, bathyHd: 0.95, sst: 0.85, chl: 0.9, radar: 0.5, overlay: 0.75, wind: 0.3 },
  dayIndex: 0,
  windIndex: 0,
};

const none = { bathy: false, bathyHd: false, contours: false, sst: false, breaks: false, chl: false, chlEdges: false, radar: false, wind: false, buoys: false };
export const PRESETS: { key: string; label: string; on: Partial<LayerState['on']> }[] = [
  { key: 'tuna', label: 'Tuna hunt', on: { ...none, sst: true, breaks: true, chlEdges: true, contours: true } },
  { key: 'bottom', label: 'Bottom fishing', on: { ...none, bathy: true, bathyHd: true, contours: true } },
  { key: 'color', label: 'Water color', on: { ...none, chl: true, chlEdges: true, contours: true } },
  { key: 'weather', label: 'Weather check', on: { ...none, radar: true, wind: true, buoys: true } },
  { key: 'chart', label: 'Chart only', on: { ...none } },
];

export const DAY_LABELS = ['Latest', '24 h', '48 h', '3 days', '7 days'];

/** Turns off anything the admin switched off remotely (Admin → Settings → Emergency off-switches). */
export function applyKillSwitch(p: LayerState, off: string[]): LayerState {
  if (!off.length) return p;
  let on = p.on, changed = false;
  for (const k of Object.keys(on) as LayerKey[]) if (on[k] && off.includes(k)) { if (!changed) on = { ...on }; on[k] = false; changed = true; }
  const overlay = p.overlay && p.overlay !== 'none' && off.includes(p.overlay) ? 'none' : p.overlay;
  return changed || overlay !== p.overlay ? { ...p, on, overlay } : p;
}
