jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('./supabase', () => ({ supabase: {}, supabaseReady: false }));
jest.mock('expo-notifications', () => ({}));
import { backByPresets, inviteMessage, parseClock, parseEmails, shareIcon, shareTitle } from './community/groupsApi';
import { routeNotification } from './community/groupPush';

test('emails: commas, spaces, new lines, duplicates, case', () => {
  expect(parseEmails('Mike@Gmail.com, sam@x.com;\n mike@gmail.com  joe@y.org')).toEqual(['mike@gmail.com', 'sam@x.com', 'joe@y.org']);
  expect(parseEmails('   ')).toEqual([]);
});

test('back-by time: next occurrence', () => {
  const morning = new Date(2026, 9, 10, 6, 0);           // 6:00 am
  expect(parseClock('5:30pm', morning)!.getHours()).toBe(17);
  expect(parseClock('5:30', morning)!.getHours()).toBe(17);   // 5:30 am already passed → 5:30 pm today
  expect(parseClock('17:45', morning)!.getMinutes()).toBe(45);
  const evening = new Date(2026, 9, 10, 19, 0);           // 7 pm
  const next = parseClock('5:30', evening)!;
  expect(next.getDate()).toBe(11); expect(next.getHours()).toBe(5);  // tomorrow morning
  expect(parseClock('25:00', morning)).toBeNull();
  expect(parseClock('13pm', morning)).toBeNull();
  expect(parseClock('soon', morning)).toBeNull();
  expect(parseClock('12am', evening)!.getHours()).toBe(0);
  const p = backByPresets(new Date(2026, 9, 10, 6, 7));
  expect(p[0].label).toBe('+2 h'); expect(p[0].at.getHours()).toBe(8); expect(p[0].at.getMinutes()).toBe(15);
});

test('feed wording', () => {
  expect(shareTitle({ kind: 'ping', who: 'Reel Therapy', payload: {}, mine: false })).toBe('Reel Therapy: Come to me!');
  expect(shareTitle({ kind: 'catch', who: 'Sam', payload: { quantity: 3, species: 'Yellowtail' }, mine: false })).toBe('Sam caught 3 Yellowtail');
  expect(shareTitle({ kind: 'checkin', who: 'Sam', payload: { status: 'back' }, mine: true })).toBe('You are back at the dock');
  expect(shareTitle({ kind: 'overdue', who: 'Sam', payload: {}, mine: false })).toBe('Sam is overdue');
  expect(shareIcon('checkin', 'out')).toBe('🚤');
  expect(inviteMessage('Reel Crew', 'AB12CD', 'Chris')).toContain('code: AB12CD');
});

test('tapping a notification', () => {
  expect(routeNotification({ type: 'group_share', kind: 'ping', lat: 33.4, lon: -118.3, label: 'Mike', group_id: 'g' }))
    .toEqual({ type: 'goto', lat: 33.4, lon: -118.3, label: 'Mike', kind: 'ping' });
  expect(routeNotification({ type: 'group_share', kind: 'overdue', lat: 33.4, lon: -118.3, label: 'Mike' })!.type).toBe('goto');
  expect(routeNotification({ type: 'group_share', kind: 'catch', lat: 33.4, lon: -118.3, label: 'Mike' })!.type).toBe('show');
  expect(routeNotification({ type: 'group_share', kind: 'overdue', lat: null, lon: null, group_id: 'g1' })).toEqual({ type: 'groups', groupId: 'g1' });
  expect(routeNotification({ type: 'group_invite', group_id: 'g2' })).toEqual({ type: 'groups', groupId: 'g2' });
  expect(routeNotification({ type: 'broadcast' })).toBeNull();
  expect(routeNotification(undefined)).toBeNull();
});
