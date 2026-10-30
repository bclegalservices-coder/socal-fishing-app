import { closedNow, listText, scheduled, sectionAt, statusOf, summary, zonesGeoJSON } from './sci';

const NOW = Date.parse('2026-10-28T18:00:00Z');
const H = 3600e3;
const iso = (ms: number) => new Date(ms).toISOString();

test('G and Wilson Cove always need permission; A–F open unless closed', () => {
  expect(statusOf('G', null, NOW)).toBe('permission');
  expect(statusOf('W', {}, NOW)).toBe('permission');
  expect(statusOf('A', null, NOW)).toBe('open');
  expect(statusOf('A', { sections: { A: { closed: true } } }, NOW)).toBe('closed');
});

test('closures start and end on their own', () => {
  const c = { sections: { A: { closed: true, from: iso(NOW + 2 * H), until: iso(NOW + 8 * H) }, D: { closed: true, until: iso(NOW - H) }, B: { closed: true, until: iso(NOW + H) } } };
  expect(statusOf('A', c, NOW)).toBe('scheduled');
  expect(statusOf('A', c, NOW + 3 * H)).toBe('closed');
  expect(statusOf('A', c, NOW + 9 * H)).toBe('open');
  expect(statusOf('D', c, NOW)).toBe('open');                    // its "until" already passed
  expect(closedNow(c, NOW).join(',')).toBe('B');
  expect(scheduled(c, NOW).join(',')).toBe('A');
});

test('map chip text', () => {
  expect(summary(null, NOW)).toBeNull();
  const s = summary({ sections: { A: { closed: true }, B: { closed: true } } }, NOW)!;
  expect(s.level).toBe('closed');
  expect(s.text).toBe('San Clemente: Sections A and B closed');
  expect(summary({ sections: { D: { closed: true, from: iso(NOW + 3 * H) } } }, NOW)!.level).toBe('soon');
  expect(summary({ sections: { D: { closed: true, from: iso(NOW + 48 * H) } } }, NOW)).toBeNull();   // too far ahead for the chip
  expect(listText(['A', 'B', 'D'])).toBe('A, B and D');
});

test('zones and "which section am I in"', () => {
  const g = zonesGeoJSON({ sections: { C: { closed: true } } }, NOW);
  expect(g.features.length).toBe(8);
  expect(g.features.find((f) => f.properties.id === 'C')!.properties.status).toBe('closed');
  expect(sectionAt(32.81, -118.42)).toBe('D');      // off the south end (Pyramid Cove side)
  expect(sectionAt(33.06, -118.58)).toBe('A');       // off the northwest end
  expect(sectionAt(33.4, -118.4)).toBeNull();        // Catalina side, nowhere near
});
