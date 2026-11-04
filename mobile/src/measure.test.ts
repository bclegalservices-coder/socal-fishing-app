import { deg3, legs, measureFC, movePoint, totalNm } from './measure';

test('legs: distance and bearing between taps', () => {
  const pts = [{ lat: 33.0, lon: -118.0 }, { lat: 33.1, lon: -118.0 }, { lat: 33.1, lon: -117.9 }];
  const l = legs(pts);
  expect(l.length).toBe(2);
  expect(l[0].nm).toBeCloseTo(6.0, 1);           // 0.1° of latitude = 6 NM
  expect(Math.round(l[0].brg)).toBe(0);          // due north
  expect(Math.round(l[1].brg)).toBe(90);         // then due east
  expect(totalNm(pts)).toBeCloseTo(6 + 5.03, 1);
  expect(l[0].mid.lat).toBeCloseTo(33.05, 5);
});

test('labels and map data', () => {
  expect(deg3(5)).toBe('005°');
  expect(deg3(263.4)).toBe('263°');
  expect(deg3(359.6)).toBe('000°');
  expect(measureFC([{ lat: 1, lon: 2 }]).features.length).toBe(1);
  expect(measureFC([{ lat: 1, lon: 2 }, { lat: 1.1, lon: 2 }]).features[0].geometry.type).toBe('LineString');
});

test('dragging a point moves only that point and changes the distance', () => {
  const pts = [{ lat: 33.5, lon: -118.0 }, { lat: 33.5, lon: -117.9 }];
  const longer = movePoint(pts, 1, { lat: 33.5, lon: -117.8 });
  expect(longer[0]).toEqual(pts[0]);
  expect(totalNm(longer)).toBeGreaterThan(totalNm(pts) * 1.9);
  const swung = movePoint(pts, 1, { lat: 33.6, lon: -118.0 });
  expect(Math.round(legs(swung)[0].brg)).toBe(0);           // now points due north
  expect(movePoint(pts, 5, { lat: 1, lon: 1 })).toBe(pts);   // bad index: unchanged
  expect(pts[1].lon).toBe(-117.9);                           // original not changed
});
