// Which layers are on, how see-through they are, and one-tap presets.
export type LayerKey = 'bathy' | 'contours' | 'sst' | 'breaks' | 'chl' | 'chlEdges' | 'radar' | 'wind' | 'buoys' | 'catches' | 'buddies' | 'rules' | 'hazards'
  | 'spots' | 'marinas' | 'docks' | 'fuel' | 'pumpout' | 'ramps' | 'bait';
export type MapOverlay = 'none' | 'relief' | 'satellite';
export type LayerState = {
  on: Record<LayerKey, boolean>;
  overlay: MapOverlay;     // drawn over the NOAA chart: colored seafloor relief or satellite photos
  tilt: boolean;           // 3D view: tip the map back so relief reads like terrain
  chart: { navaids: boolean; lanes: boolean; seabed: boolean; areas: boolean; services: boolean; lightCircles: boolean; simpleSymbols: boolean };  // NOAA chart details shown
  opacity: { bathy: number; sst: number; chl: number; radar: number; overlay: number; wind: number };
  dayIndex: number;      // 0 = latest satellite day, 1 = the one before ...
  windIndex: number;     // forecast hour index
};

export const DEFAULT_LAYERS: LayerState = {
  on: { bathy: false, contours: false, sst: true, breaks: true, chl: false, chlEdges: false, radar: false, wind: false, buoys: false, catches: true, buddies: true, rules: true, hazards: false,
    spots: true, marinas: true, docks: true, fuel: true, pumpout: false, ramps: false, bait: true },
  overlay: 'none',
  tilt: false,
  chart: { navaids: true, lanes: true, seabed: true, areas: true, services: false, lightCircles: false, simpleSymbols: false },
  opacity: { bathy: 0.8, sst: 0.6, chl: 0.6, radar: 0.5, overlay: 0.75, wind: 0.3 },
  dayIndex: 0,
  windIndex: 0,
};

const none = { bathy: false, contours: false, sst: false, breaks: false, chl: false, chlEdges: false, radar: false, wind: false, buoys: false };
export const PRESETS: { key: string; label: string; on: Partial<LayerState['on']> }[] = [
  { key: 'tuna', label: 'Tuna hunt', on: { ...none, sst: true, breaks: true, chlEdges: true, contours: true } },
  { key: 'bottom', label: 'Bottom fishing', on: { ...none, bathy: true, contours: true } },
  { key: 'color', label: 'Water color', on: { ...none, chl: true, chlEdges: true, contours: true } },
  { key: 'weather', label: 'Weather check', on: { ...none, radar: true, wind: true, buoys: true } },
  { key: 'chart', label: 'Chart only', on: { ...none } },
];

export const DAY_LABELS = ['Latest', '24 h', '48 h', '3 days', '7 days'];
