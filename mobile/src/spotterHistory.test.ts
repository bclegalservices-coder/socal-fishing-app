import { ageColor, agoText, historyGeoJSON, summaryText, type SpotSession } from './spotterHistory';

const NOW = 1_800_000_000;
const sess = (id: string, hoursAgo: number, active = false): SpotSession => {
  const end = NOW - hoursAgo * 3600, start = end - 20 * 60;
  const pts: SpotSession['points'] = [];
  for (let t = start - 600; t <= end + 120; t += 10) pts.push([-118.6 + Math.cos(t / 20) * 0.01, 33.3 + Math.sin(t / 20) * 0.01, t, 1200]);
  return { id, hex: id, reg: `N${id}`, callsign: null, type: 'C172', desc: null, owner: null, year: null, active, work_from: start, work_to: end,
    last_t: end + 120, minutes: 20, circles: 6, alt_min: 1100, alt_max: 1300, center: [-118.6, 33.3], points: pts };
};

test('colors go pink → orange → yellow → blue with age', () => {
  expect(ageColor(0)).toBe('#ff20d6');
  expect(ageColor(3)).toBe('#ff7800');
  expect(ageColor(6)).toBe('#ffd200');
  expect(ageColor(12)).toBe('#6e96c8');
  expect(ageColor(1.5)).toBe('#ff4c6b');                       // halfway pink → orange
});

test('ago text', () => {
  expect(agoText(60)).toBe('now');
  expect(agoText(25 * 60)).toBe('25 min ago');
  expect(agoText(3 * 3600 + 20 * 60)).toBe('3 h 20 min ago');
  expect(agoText(9 * 3600)).toBe('9 h ago');
});

test('map lines: only the chosen window, real points, work vs travel', () => {
  const s = [sess('A', 0.1, true), sess('B', 5), sess('C', 15)];
  const g12 = historyGeoJSON(s, NOW, 12);
  const ids = new Set(g12.features.map((f: any) => f.properties.id));
  expect([...ids].sort().join(',')).toBe('A,B');                // C was 15 h ago
  expect(g12.features.some((f: any) => f.properties.work === 1)).toBe(true);
  expect(g12.features.some((f: any) => f.properties.work === 0)).toBe(true);   // the 10 min lead-in
  const first = g12.features.find((f: any) => f.properties.id === 'A')!;
  expect(first.geometry.coordinates[0][0]).toBe(s[0].points[0][0]);           // the recorded position, untouched
  expect(historyGeoJSON(s, NOW, 3).features.every((f: any) => f.properties.id === 'A')).toBe(true);
  expect(summaryText(s, NOW, 12)).toBe('2 planes · 2 spots worked · 1 circling now');
  expect(summaryText([], NOW, 6)).toBe('No spotter planes circled in the last 6 h');
});
