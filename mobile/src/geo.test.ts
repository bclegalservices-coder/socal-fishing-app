import { bearingTrue, distanceNm, formatLatLon } from './geo';

test('spec example formats as DDM', () => {
  expect(formatLatLon(33.40125, -117.99667, 'ddm')).toBe('33°24.075′N  117°59.800′W');
});

test('one degree of latitude is about 60 NM', () => {
  expect(distanceNm(33, -118, 34, -118)).toBeCloseTo(60.04, 1);
});

test('cardinal bearings', () => {
  expect(bearingTrue(33, -118, 34, -118)).toBeCloseTo(0, 3);
  expect(bearingTrue(33, -118, 33, -117)).toBeCloseTo(89.7, 0);
  expect(bearingTrue(34, -118, 33, -118)).toBeCloseTo(180, 3);
  expect(bearingTrue(33, -117, 33, -118)).toBeCloseTo(270.3, 0);
});

test('minutes never round up to 60', () => {
  expect(formatLatLon(33.9999999, -117.0, 'ddm')).toContain('34°00.000′N');
});
