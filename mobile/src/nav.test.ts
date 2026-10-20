import { crossTrackNm, SpeedEstimator, steerDelta, trackStats } from './nav';

test('steer delta wraps around north', () => {
  expect(steerDelta(350, 10)).toBe(20);
  expect(steerDelta(10, 350)).toBe(-20);
});

test('cross-track sign: right of a northbound leg is positive', () => {
  const a = { lat: 33, lon: -118 }, b = { lat: 34, lon: -118 };
  expect(crossTrackNm(a, b, { lat: 33.5, lon: -117.99 })).toBeGreaterThan(0);
  expect(crossTrackNm(a, b, { lat: 33.5, lon: -118.01 })).toBeLessThan(0);
});

test('speed is calculated from positions when GPS gives none', () => {
  const s = new SpeedEstimator();
  s.update({ lat: 33, lon: -118, time: 0, speed: null, heading: null, accuracy: 5 });
  // 1 minute of latitude (1 NM) in 3 minutes = 20 kt
  const r = s.update({ lat: 33 + 1 / 60, lon: -118, time: 180_000, speed: null, heading: null, accuracy: 5 });
  expect(r.sogKt).toBeCloseTo(20, 0);
  expect(r.cogT).toBeCloseTo(0, 0);
});

test('track stats add up distance', () => {
  const st = trackStats([
    { lat: 33, lon: -118, t: 0, sog: null },
    { lat: 33 + 1 / 60, lon: -118, t: 180_000, sog: null },
  ]);
  expect(st.distanceNm).toBeCloseTo(1, 1);
  expect(st.maxKt).toBeCloseTo(20, 0);
});
