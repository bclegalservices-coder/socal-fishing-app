import { mergeRepeats, parseGPX } from './gpx';
test('Navionics export: curly-quote names cleaned, dates kept, double-tap repeats merged', () => {
  const xml = `<gpx><wpt lat="32.655555" lon="-117.973592"><name>“43”</name><time>2020-08-05T03:16:28Z</time></wpt>
    <wpt lat="33.718788" lon="-118.221220"><name>Marker 257</name><time>2023-12-24T07:21:51Z</time></wpt>
    <wpt lat="33.718788" lon="-118.221220"><name>Marker 258</name><time>2023-12-24T07:21:51Z</time></wpt>
    <wpt lat="33.718788" lon="-118.221220"><name>Start</name><time>2023-12-24T07:21:51Z</time></wpt></gpx>`;
  const r = parseGPX(xml);
  expect(r.points[0].name).toBe('43');
  expect(new Date(r.points[0].time).getUTCFullYear()).toBe(2020);
  const m = mergeRepeats(r.points);
  expect(m.length).toBe(2);
  expect(m[1].name).toBe('Start');          // a real name beats "Marker 257"
});
