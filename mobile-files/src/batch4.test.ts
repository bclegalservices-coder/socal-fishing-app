import { containsPoint, findContaining, indexPolygons } from './offline/pip';
import { buildGPX, findDuplicates, parseAny, parseGPX, parseKML } from './io/gpx';
import { offlineTide } from './offline/tideMath';

const poly = { type: 'Polygon', coordinates: [[[-118, 33], [-117, 33], [-117, 34], [-118, 34], [-118, 33]], [[-117.6, 33.4], [-117.4, 33.4], [-117.4, 33.6], [-117.6, 33.6], [-117.6, 33.4]]] };

test('MPA check: inside, hole, outside, multipolygon', () => {
  expect(containsPoint(poly, 33.2, -117.8)).toBe(true);
  expect(containsPoint(poly, 33.5, -117.5)).toBe(false);
  expect(containsPoint(poly, 35, -117.5)).toBe(false);
  const idx = indexPolygons([{ geometry: poly }, { geometry: { type: 'Point', coordinates: [0, 0] } }]);
  expect(idx).toHaveLength(1);
  expect(findContaining(idx, 33.2, -117.8)).toHaveLength(1);
});

test('GPX waypoints, routes, tracks and bad coordinates', () => {
  const g = parseGPX(`<gpx><wpt lat="33.40125" lon="-117.99667"><name>14 &amp; Kelp</name></wpt><wpt lat="999" lon="1"/>
  <rte><name>Run</name><rtept lat="33.6" lon="-117.9"/><rtept lat="33.4" lon="-118"/></rte></gpx>`);
  expect(g.points[0].name).toBe('14 & Kelp');
  expect(g.warnings).toHaveLength(1);
  expect(g.lines[0]).toMatchObject({ name: 'Run', kind: 'route' });
});

test('KML points and lines; rejects other files', () => {
  const k = parseKML(`<kml><Placemark><name>209</name><Point><coordinates>-117.1,32.9,0</coordinates></Point></Placemark></kml>`);
  expect(k.points[0]).toMatchObject({ name: '209', lat: 32.9, lon: -117.1 });
  expect(() => parseAny('nope')).toThrow();
});

test('duplicates never overwrite; export round-trips', () => {
  const d = findDuplicates([{ name: 'A', lat: 33, lon: -118 }, { name: 'C', lat: 34, lon: -118 }], [{ name: 'x', lat: 33.00005, lon: -118 }]);
  expect(d[0]).not.toBeNull();
  expect(d[1]).toBeNull();
  const back = parseGPX(buildGPX({ points: [{ name: 'My <spot>', lat: 33.1, lon: -118.2 }], routes: [], tracks: [] }));
  expect(back.points[0].name).toBe('My <spot>');
});

test('offline tide from the saved pack', () => {
  const t0 = Date.UTC(2026, 9, 3, 12);
  const r = offlineTide([{ id: 'A', name: 'LA', lat: 33.72, lon: -118.27, hilo: [{ t: new Date(t0 + 3 * 3600e3).toISOString(), v: 4.8, type: 'H' }],
    hourly: [[new Date(t0).toISOString(), 1], [new Date(t0 + 3600e3).toISOString(), 2]] }], 33.6, -118.1, t0 + 1800e3)!;
  expect(r.height_ft).toBe(1.5);
  expect(r.trend).toBe('rising');
  expect(r.next_high?.v).toBe(4.8);
});
