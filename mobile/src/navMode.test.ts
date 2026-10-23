import { autoZoom, guidance, offRouteLimit, remainingNm } from './navMode';
import { cardinal, knotsToMph } from './geo';

test('auto zoom closes in near a turn and backs out on long runs', () => {
  expect(autoZoom(0.1, 6)).toBeGreaterThan(autoZoom(2, 6));
  expect(autoZoom(20, 6)).toBeLessThan(autoZoom(2, 6));
  expect(autoZoom(2, 25)).toBeLessThan(autoZoom(2, 10));
});

test('off-course limit scales with the leg but stays sensible', () => {
  expect(offRouteLimit(0.5)).toBeCloseTo(0.08);
  expect(offRouteLimit(4)).toBeCloseTo(0.2);
  expect(offRouteLimit(40)).toBeCloseTo(0.4);
});

test('guidance says which way to turn at the coming waypoint', () => {
  // north along -118, then turn east
  const nav = { points: [{ lat: 33.1, lon: -118 }, { lat: 33.1, lon: -117.9 }], leg: 0, legStart: { lat: 33, lon: -118 } };
  const g = guidance(nav, { lat: 33.05, lon: -118 });
  expect(g.final).toBe(false);
  expect(g.turnDeg).toBeGreaterThan(80);
  expect(g.text).toBe('Next turn: right to 090°');
  const last = guidance({ ...nav, leg: 1, legStart: nav.points[0] }, { lat: 33.1, lon: -117.91 });
  expect(last.final).toBe(true);
  expect(last.text).toBe('Heading for the waypoint');
});

test('banner distance is the whole trip left and shrinks as you go', () => {
  const nav = { points: [{ lat: 33.1, lon: -118 }, { lat: 33.1, lon: -117.9 }, { lat: 33.2, lon: -117.9 }], leg: 0, legStart: { lat: 33, lon: -118 } };
  const start = remainingNm(nav, { lat: 33.0, lon: -118 });
  const later = remainingNm(nav, { lat: 33.05, lon: -118 });
  expect(start).toBeCloseTo(6 + 5.03 + 6, 0);           // 6 NM north + ~5 NM east + 6 NM north
  expect(later).toBeLessThan(start);
  expect(remainingNm({ ...nav, leg: 2, legStart: nav.points[1] }, { lat: 33.2, lon: -117.9 })).toBeCloseTo(0, 3);
});

test('units and compass points', () => {
  expect(knotsToMph(10)).toBeCloseTo(11.5, 1);
  expect(cardinal(214)).toBe('SW');
  expect(cardinal(359)).toBe('N');
  expect(cardinal(285)).toBe('WNW');
});
