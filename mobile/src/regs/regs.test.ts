import { BUNDLED } from './bundled';
import { changedOn, inTab, lobsterCloses, lobsterOpens, search, statusOn, type Rule } from './regs';

const by = (id: string) => BUNDLED.items.find((r) => r.id === id) as Rule;
const at = (s: string) => new Date(`${s}T12:00:00`);

test('search finds fish by name, nickname, typo and words in the rule', () => {
  expect(search(BUNDLED.items, 'barracuda')[0].id).toBe('barracuda');
  expect(search(BUNDLED.items, 'cuda')[0].id).toBe('barracuda');
  expect(search(BUNDLED.items, 'baracuda')[0].id).toBe('barracuda');
  expect(search(BUNDLED.items, 'Calico')[0].id).toBe('kelp-bass');
  expect(search(BUNDLED.items, 'bugs')[0].id).toBe('lobster');
  expect(search(BUNDLED.items, 'yellowtial')[0].id).toBe('yellowtail');
  expect(search(BUNDLED.items, 'report card').some((r) => r.id === 'lobster')).toBe(true);
  expect(search(BUNDLED.items, 'zzzz').length).toBe(0);
});

test('lobster season dates follow the rule (Friday before the first Wednesday in October to the first Wednesday after March 15)', () => {
  expect(lobsterOpens(2026).toDateString()).toBe(new Date(2026, 9, 2).toDateString());
  expect(lobsterOpens(2026).getHours()).toBe(18);
  expect(lobsterCloses(2027).toDateString()).toBe(new Date(2027, 2, 17).toDateString());
  expect(statusOn(by('lobster'), at('2026-11-03')).state).toBe('open');
  expect(statusOn(by('lobster'), at('2027-03-17')).state).toBe('open');
  expect(statusOn(by('lobster'), at('2027-03-18')).state).toBe('closed');
  expect(statusOn(by('lobster'), new Date(2026, 9, 2, 17, 0)).state).toBe('closed');
});

test('seasons switch by date: rockfish, grunion, white seabass, protected fish', () => {
  expect(statusOn(by('rockfish-near'), at('2026-11-03')).state).toBe('closed');
  expect(statusOn(by('rockfish-shelf'), at('2026-11-03')).state).toBe('limited');
  expect(statusOn(by('rockfish-shelf'), at('2026-05-10')).state).toBe('open');
  expect(statusOn(by('lingcod'), at('2027-01-15')).state).toBe('check');
  expect(statusOn(by('grunion'), at('2027-05-01')).state).toBe('closed');
  expect(statusOn(by('grunion'), at('2026-11-03')).state).toBe('open');
  expect(statusOn(by('white-seabass'), at('2027-04-01')).state).toBe('limited');
  expect(statusOn(by('giant-sea-bass'), at('2026-11-03')).state).toBe('prohibited');
  const off = BUNDLED.items.filter((r) => inTab(r, 'off', new Set(), at('2026-11-03'))).map((r) => r.id);
  expect(off.includes('garibaldi') && off.includes('rockfish-near') && off.includes('salmon')).toBe(true);
  expect(off.includes('barracuda')).toBe(false);
});

test('a changed CDFW page: re-checked rules show a green note, the rest ask a person to check', () => {
  const d = { ...BUNDLED, watch: { checked_at: '2026-11-23T15:30:00Z', changed: { southern: '2026-11-20' }, verified: { yellowtail: '2026-11-23' }, unsure: ['ca-halibut'] } };
  expect(changedOn(d, by('yellowtail'))?.kind).toBe('rechecked');
  expect(changedOn(d, by('ca-halibut'))?.kind).toBe('check');
  expect(changedOn(d, by('lobster'))?.kind).toBe('check');        // also on the changed page, not re-checked
  expect(changedOn(d, by('bluefin'))).toBeNull();                  // its page didn't change
});
