jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('react-native', () => ({ StyleSheet: { create: (s: any) => s } }));
import { AMBER, NIGHT_NAVY, DAY, DAY_THEMES, NIGHT, NIGHT_THEMES, boatColor, findTheme, isNightAt, routeColor, sunTimes } from './theme';

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

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('every theme is complete and readable (4.5:1 or better)', () => {
  const keys = Object.keys(DAY) as (keyof typeof DAY)[];
  for (const t of [...DAY_THEMES, ...NIGHT_THEMES]) {
    for (const k of keys) expect(t.palette[k]).toBeDefined();
    expect(contrast(t.palette.text, t.palette.panelSolid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.palette.muted, t.palette.panelSolid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.palette.accentInk, t.palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.palette.live, t.palette.panelSolid)).toBeGreaterThanOrEqual(4.5);
  }
});

test('Harbor Blue is the default day look, Night Navy the default night look', () => {
  expect(findTheme(DAY_THEMES, undefined).palette).toBe(DAY);
  expect(findTheme(NIGHT_THEMES, 'nope').palette).toBe(NIGHT_NAVY);   // Nov 6: Night Navy is the default night look
  expect(findTheme(NIGHT_THEMES, 'darkblue').palette).toBe(NIGHT_NAVY);
  expect(findTheme(NIGHT_THEMES, 'red').palette).toBe(NIGHT);
  expect(routeColor(DAY, 'day')).toBe('#FF1CF0');
  expect(boatColor(DAY, 'day')).toBe('#00A3FF');
});

test('red light and amber keep the route and boat off bright blue/magenta', () => {
  const blue = (hex: string) => parseInt(hex.slice(5, 7), 16);
  for (const p of [NIGHT, AMBER]) {
    expect(blue(routeColor(p, 'night'))).toBeLessThan(0xB0);
    expect(blue(boatColor(p, 'night'))).toBeLessThan(0xB0);
    expect(p.wash).toBeTruthy();
  }
});
