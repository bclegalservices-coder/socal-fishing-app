jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
import { addDays, arrow, boatLabel, compass, dayLabel, downsample, isDate, seasText, weatherPath } from './weather/model';

test('weather request carries the boat and optional course', () => {
  const p = weatherPath(33.61234, -117.9, { type: 'bay', length_ft: 20, comfort: 'easygoing' }, 271.6);
  expect(p).toBe('/weather?lat=33.6123&lon=-117.9000&days=5&boat_type=bay&comfort=easygoing&boat_len=20&course=272');
  expect(weatherPath(33, -118, { type: 'kayak', length_ft: null, comfort: 'normal' }, null)).not.toContain('course');
});

test('labels', () => {
  expect(boatLabel({ type: 'center_console', length_ft: 23, comfort: 'normal' })).toBe('23 ft Center console');
  expect(dayLabel('2026-10-10', new Date(2026, 9, 10, 15))).toBe('Today');
  expect(dayLabel('2026-10-11', new Date(2026, 9, 10, 15))).toBe('Tomorrow');
  expect(dayLabel('2026-10-13', new Date(2026, 9, 10, 15))).toBe('Tue 13');
  expect(compass(292)).toBe('WNW');
  expect(arrow(270)).toBe('→'); // west wind blows toward the east
  expect(seasText({ seas_ft: 3.04, period_s: 12.6, period_estimated: false })).toBe('3 ft @ 13s');
  expect(seasText({ seas_ft: 4, period_s: 4, period_estimated: true })).toBe('4 ft @ 4s*');
});

test('downsample keeps peaks', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ t: String(i), w: i === 503 ? 99 : 1 }));
  const d = downsample(rows, 'w', 100);
  expect(d.length).toBe(100);
  expect(Math.max(...d.map((x) => x.v ?? 0))).toBe(99);
});

test('dates', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  expect(isDate('2026-02-30')).toBe(false);
  expect(isDate('2026-10-10')).toBe(true);
  expect(isDate('10/10/2026')).toBe(false);
});
