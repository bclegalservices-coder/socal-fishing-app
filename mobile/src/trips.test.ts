import { analyze, at, autoName, records, searchTrips, sortTrips, speedBins, speedColor, speedLines } from './trips';
import type { TrackMeta } from './storage';

// 1 minute apart, heading north along -118 at 0.01° lat per fix (~0.6 NM/min = 36 kt), then stopped
const pts = [0, 1, 2, 3, 4].map((i) => ({ lat: 33.5 + Math.min(i, 3) * 0.01, lon: -118, t: i * 60000, sog: null }));

test('analyze: distance, time, speed and moving time', () => {
  const a = analyze(pts);
  expect(a.distanceNm).toBeCloseTo(1.8, 1);
  expect(a.durationMin).toBe(4);
  expect(a.maxKt).toBeGreaterThan(30);
  expect(a.movingMin).toBeGreaterThanOrEqual(3);
});

test('at: interpolates position and distance between fixes, clamps to the trip', () => {
  const a = analyze(pts);
  const m = at(a, 90000);
  expect(m.lat).toBeCloseTo(33.515, 3);
  expect(m.distNm).toBeCloseTo(0.9, 1);
  expect(Math.round(m.heading)).toBe(0);
  expect(at(a, -5).elapsedMs).toBe(0);
  expect(at(a, 1e9).elapsedMs).toBe(240000);
});

test('speed graph bins and speed-colored line', () => {
  const a = analyze(pts);
  expect(speedBins(a, 4).length).toBe(4);
  expect(speedColor(1)).not.toBe(speedColor(40));
  expect(speedLines(a).features.length).toBeGreaterThan(0);
  const half = speedLines(a, 90000);
  const last = half.features[half.features.length - 1].geometry.coordinates.slice(-1)[0];
  expect(last[1]).toBeCloseTo(33.515, 3);   // played part stops at the playback point
});

const meta = (id: string, startedAt: number, mins: number, nm: number, avg: number, max: number): TrackMeta =>
  ({ id, name: id, startedAt, endedAt: startedAt + mins * 60000, distanceNm: nm, avgMovingKt: avg, maxKt: max, points: 10 });

test('sort, search and records', () => {
  const list = [meta('Avalon run', 1000, 90, 26, 18, 35), meta('Harbor loop', 3000, 30, 4, 6, 12), meta('Long day', 2000, 600, 60, 9, 30)];
  expect(sortTrips(list, 'date').map((t) => t.id)).toEqual(['Harbor loop', 'Long day', 'Avalon run']);
  expect(sortTrips(list, 'length')[0].id).toBe('Long day');
  expect(sortTrips(list, 'speed')[0].id).toBe('Avalon run');
  expect(sortTrips(list, 'time')[0].id).toBe('Long day');
  expect(searchTrips(list, 'avalon').length).toBe(1);
  const r = records(list);
  expect(r.best.maxKt).toBe(35);
  expect(r.best.distanceNm).toBe(60);
  expect(r.avg.minutes).toBe(240);
});

test('auto name from nearby places', () => {
  const places = [{ name: 'Cabrillo Marina', lat: 33.5, lon: -118 }, { name: 'Avalon', lat: 33.53, lon: -118 }];
  expect(autoName(pts, places)).toBe('Cabrillo Marina - Avalon');
  expect(autoName(pts, [places[0]])).toBe('From Cabrillo Marina');
  expect(autoName(pts, [])).toBeNull();
});
