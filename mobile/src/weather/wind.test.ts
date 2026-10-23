import { beaufort, calmWindow, prevailing, windColor, windNotes } from './wind';

const day = (vals: [number, number, number][]) => vals.map(([hr, kt, dir]) => {
  const d = new Date(2026, 9, 23, hr, 0, 0);
  return { t: d.toISOString(), wind_kt: kt, gust_kt: kt + 3, wind_dir: dir };
});

test('beaufort names', () => {
  expect(beaufort(0).name).toBe('Calm');
  expect(beaufort(12).name).toBe('Moderate breeze');
  expect(beaufort(25).name).toBe('Strong breeze');
});

test('wind colors step up with speed', () => {
  expect(windColor(3)).toBe('#7FC8E8');
  expect(windColor(18)).toBe('#F29A2E');
  expect(windColor(40)).toBe('#B5338A');
});

test('prevailing direction averages across north', () => {
  const p = prevailing([{ t: '', wind_kt: 10, wind_dir: 350 }, { t: '', wind_kt: 10, wind_dir: 10 }])!;
  expect(Math.min(p, 360 - p)).toBeLessThan(1);
});

test('calm window finds the quiet morning', () => {
  const hours = day([[5, 4, 300], [6, 5, 300], [7, 6, 290], [8, 7, 280], [9, 9, 270], [10, 12, 270], [11, 14, 270], [12, 16, 270]]);
  const w = calmWindow(hours)!;
  expect(w.hours).toBe(5);
  expect(new Date(w.start).getHours()).toBe(5);
  expect(new Date(w.end).getHours()).toBe(10);
});

test('afternoon breeze note', () => {
  const hours = day([[6, 4, 300], [7, 5, 300], [8, 5, 290], [9, 6, 280], [12, 14, 270], [13, 16, 270], [14, 17, 270], [15, 15, 270], [16, 13, 270]]);
  const n = windNotes(hours);
  expect(n.some((x) => /Afternoon breeze builds to about 17 kt/.test(x))).toBe(true);
});
