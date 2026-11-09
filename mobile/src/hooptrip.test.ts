import { addTrail, dropNew, newSet, pull, summary, tripPoints } from './hoop';
test('a hoop trip keeps the path, every pull with soak time, and a summary', () => {
  let s = newSet(2, 0);
  s = addTrail(s, { lat: 33.7, lon: -118.2, t: 0, sog: 0 });
  expect(addTrail(s, { lat: 33.70001, lon: -118.2, t: 5000, sog: 0 })).toBe(s);           // too close, too soon: skipped
  s = addTrail(s, { lat: 33.701, lon: -118.2, t: 40000, sog: 2 });
  s = dropNew(s, { lat: 33.701, lon: -118.2 }, 60000);
  s = pull(s, 1, 60000 + 45 * 60000);
  const sum = summary(s);
  expect(s.trail!.length).toBe(2);
  expect(sum.nets).toBe(1); expect(sum.pulls).toBe(1); expect(sum.avgSoakMin).toBe(45);
  expect(tripPoints(s).length).toBe(2);
  const noGps = pull(dropNew(newSet(1, 0), { lat: 33.5, lon: -118 }, 1000), 1, 61000);
  expect(tripPoints(noGps).length).toBe(2);                                              // drop + pull spots instead
});
