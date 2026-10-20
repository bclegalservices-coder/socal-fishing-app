jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('react-native', () => ({ StyleSheet: { create: (s: any) => s } }));
import { DAY, NIGHT, isNightAt, sunTimes } from './theme';

test('sunrise and sunset for Newport Beach in October', () => {
  const t = sunTimes(33.6, -117.9, new Date(2026, 9, 10, 12))!;
  // ~6:52 AM and ~6:24 PM Pacific (13:52 and 01:24 UTC)
  expect(t.rise.getUTCHours()).toBe(13);
  expect(Math.abs(t.rise.getUTCMinutes() - 52)).toBeLessThan(4);
  expect(t.set.getUTCHours()).toBe(1);
});

test('auto night mode switches 20 minutes after sunset and before sunrise', () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 10, h, m));  // UTC; Pacific = UTC-7
  expect(isNightAt(33.6, -117.9, at(19))).toBe(false);          // noon Pacific
  expect(isNightAt(33.6, -117.9, at(1, 30))).toBe(false);       // 6:30 PM — just after sunset, still Day
  expect(isNightAt(33.6, -117.9, at(2, 0))).toBe(true);         // 7:00 PM
  expect(isNightAt(33.6, -117.9, at(10))).toBe(true);           // 3:00 AM
});

test('night palette has no bright blue/white and dims the chart', () => {
  const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);
  for (const k of ['text', 'muted', 'accent', 'live', 'border'] as const) expect(blue(NIGHT[k])).toBeLessThan(0xB0);
  expect(NIGHT.chartBrightness).toBeLessThan(0.5);
  expect(DAY.panelSolid).toBe('#FFFFFF');
});
