// Is a point inside a GeoJSON polygon? Runs on the phone, so the MPA alert works with no signal.
type Ring = number[][];
type Geom = { type: string; coordinates: any };

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon with holes: inside the outer ring and not inside any hole. */
function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(lon, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (inRing(lon, lat, rings[h])) return false;
  return true;
}

export function containsPoint(g: Geom | null | undefined, lat: number, lon: number): boolean {
  if (!g) return false;
  if (g.type === 'Polygon') return inPolygon(lon, lat, g.coordinates);
  if (g.type === 'MultiPolygon') return (g.coordinates as Ring[][]).some((p) => inPolygon(lon, lat, p));
  return false;
}

export type Indexed = { f: any; bbox: [number, number, number, number] };

function bboxOf(g: Geom): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === 'number') { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); }
    else c.forEach(walk);
  };
  walk(g.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Pre-compute bounding boxes once so checking every GPS fix is cheap. */
export function indexPolygons(features: any[]): Indexed[] {
  return features.filter((f) => f?.geometry && /Polygon/.test(f.geometry.type)).map((f) => ({ f, bbox: bboxOf(f.geometry) }));
}

export function findContaining(idx: Indexed[], lat: number, lon: number): any[] {
  return idx.filter(({ bbox: b }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3])
    .filter(({ f }) => containsPoint(f.geometry, lat, lon)).map(({ f }) => f);
}
