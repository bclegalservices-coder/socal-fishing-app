jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('./config', () => ({ API_URL: 'https://api.test' }));
jest.mock('./appConfig', () => ({ config: () => ({ ads_enabled: true }) }));
jest.mock('./analytics', () => ({ currentArea: () => 'Orange County', track: jest.fn() }));
import { ctaText, directionsUrl, normalize, telUrl } from './ads/ads';

test('tap actions build the right links', () => {
  expect(telUrl('(949) 555-0101')).toBe('tel:9495550101');
  expect(directionsUrl('33.6061,-117.889', "Bob's Bait", 'ios')).toBe("http://maps.apple.com/?daddr=33.6061,-117.889&q=Bob's%20Bait");
  expect(directionsUrl('33.6061, -117.889', 'Shop', 'android')).toBe('geo:0,0?q=33.6061,-117.889(Shop)');
});

test('button text falls back by action', () => {
  expect(ctaText({ kind: 'image', action_type: 'call' })).toBe('Call');
  expect(ctaText({ kind: 'image', action_type: 'coupon', cta_label: '10% off' })).toBe('10% off');
  expect(ctaText({ kind: 'image', action_type: 'none' })).toBe('');
});

test('older image-only ads still work', () => {
  const ad = normalize({ id: 1, placement: 'banner_dashboard', presented_by_section: null, creative_url: 'https://x/a.png', click_url: 'https://bob.example',
    headline: null, advertiser: 'Bob', max_per_user_per_day: 3, creative: undefined as any });
  expect(ad.creative).toEqual({ kind: 'image', media_url: 'https://x/a.png', action_type: 'website', action_value: 'https://bob.example' });
});
