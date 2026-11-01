import { makeNext, moveInLine, nearestPastFt, pastDropsGeoJSON, saveSet } from './hoop';
import { AT_NET_FT, atNet, canDropNew, dropNew, dropSuggestion, finish, guide, inUse, limitFor, newSet, nextUp, pull, pullOrder, redrop, setLine, soakState, soakText } from './hoop';

const T0 = 1_700_000_000_000;
const min = 60_000;
const at = (i: number) => ({ lat: 33.4 + i * 0.0002, lon: -118.4 });     // ~22 m apart, in a line

function sixDown() {
  let s = newSet(2, T0);
  for (let i = 0; i < 6; i++) s = dropNew(s, at(i), T0 + i * 3 * min);
  return s;
}

test('nets are numbered in drop order and pulled longest-soak first', () => {
  const s = sixDown();
  expect(s.pots.map((p) => p.no).join(',')).toBe('1,2,3,4,5,6');
  expect(nextUp(s)!.no).toBe(1);
  expect(pullOrder(s).map((p) => p.no).join(',')).toBe('1,2,3,4,5,6');
});

test('a re-dropped net keeps its number but goes to the back of the line', () => {
  let s = sixDown();
  s = pull(s, 1, T0 + 60 * min);
  expect(nextUp(s)!.no).toBe(2);
  expect(dropSuggestion(s)).toEqual({ kind: 'redrop', no: 1 });           // the drop button offers No. 1 back in
  s = redrop(s, 1, at(10), T0 + 62 * min);
  expect(pullOrder(s).map((p) => p.no).join(',')).toBe('2,3,4,5,6,1');    // No. 1 is now last
  expect(s.pots.find((p) => p.no === 1)!.drops).toBe(2);
  expect(s.pots.length).toBe(6);                                          // no extra net was created
});

test('limits: 5 nets solo, 10 per boat with crew', () => {
  expect(limitFor(1)).toBe(5);
  expect(limitFor(2)).toBe(10);
  expect(limitFor(4)).toBe(10);
  let solo = newSet(1, T0);
  for (let i = 0; i < 7; i++) solo = dropNew(solo, at(i), T0 + i * min);
  expect(solo.pots.length).toBe(5);
  expect(canDropNew(solo)).toBe(false);
  expect(dropSuggestion(solo)).toEqual({ kind: 'full' });
  solo = pull(solo, 1, T0 + 30 * min);
  expect(dropSuggestion(solo)).toEqual({ kind: 'redrop', no: 1 });        // aboard still counts toward the 5
  solo = finish(solo, 1);
  expect(inUse(solo)).toBe(4);
  expect(dropSuggestion(solo)).toEqual({ kind: 'new', no: 6 });           // numbers are never reused
});

test('2-hour check reminders', () => {
  const s = sixDown();
  const p = s.pots[0];
  expect(soakState(p, T0 + 60 * min)).toBe('ok');
  expect(soakState(p, T0 + 106 * min)).toBe('soon');
  expect(soakState(p, T0 + 121 * min)).toBe('due');
  expect(soakText(112 * min)).toBe('1h 52m');
  expect(soakText(38 * min)).toBe('38m');
});

test('guidance and "you are at it"', () => {
  const s = sixDown();
  const g = guide({ lat: 33.39, lon: -118.4 }, nextUp(s))!;
  expect(Math.round(g.brg)).toBe(0);                                      // net No. 1 is due north
  expect(g.ft).toBeGreaterThan(3500);
  expect(atNet(s, { lat: 33.39, lon: -118.4 })).toBeNull();
  expect(atNet(s, { lat: 33.40002, lon: -118.4 })!.no).toBe(1);
  expect(AT_NET_FT).toBeGreaterThan(50);
  expect(setLine(finish(s, 3)).map((p) => p.no).join(',')).toBe('1,2,4,5,6');
});

test('pull order can be changed by hand; a re-dropped net still goes to the back', () => {
  let s = sixDown();
  s = moveInLine(s, 3, -1);                                               // No. 3 one place earlier
  expect(pullOrder(s).map((p) => p.no).join(',')).toBe('1,3,2,4,5,6');
  s = makeNext(s, 5);
  expect(pullOrder(s).map((p) => p.no).join(',')).toBe('5,1,3,2,4,6');
  s = pull(s, 5, T0 + 90 * min);
  s = redrop(s, 5, at(12), T0 + 92 * min);
  expect(pullOrder(s).map((p) => p.no).join(',')).toBe('1,3,2,4,6,5');
  s = dropNew(newSet(2, T0), at(0), T0);
  expect(moveInLine(s, 1, -1)).toBe(s);                                   // nothing to swap with
});

test('every drop is logged and a finished set is saved for next time', () => {
  let s = sixDown();
  s = pull(s, 1, T0 + 60 * min);
  s = redrop(s, 1, at(10), T0 + 62 * min);
  expect(s.log!.length).toBe(7);
  const live = pastDropsGeoJSON([], s, T0 + 70 * min);
  expect(live.features.length).toBe(1);                                   // No. 1's first spot (it moved)
  expect(live.features[0].properties.tonight).toBe(1);
  const hist = saveSet([], s, T0 + 3 * 60 * min);
  expect(hist[0].drops.length).toBe(7);
  const later = T0 + 5 * 86400000;
  expect(pastDropsGeoJSON(hist, null, later).features.length).toBe(7);
  expect(nearestPastFt(hist, null, at(0), later)).toBeLessThan(5);
  expect(saveSet(hist, newSet(1, later), later + 46 * 86400000).length).toBe(0);   // old ones expire, empty sets aren't saved
});
