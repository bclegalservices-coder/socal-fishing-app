jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('expo-device', () => ({ deviceType: 1 }));
jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));
import { areaFor } from './analytics';

test('coarse areas only — islands, coast, offshore, Baja', () => {
  expect(areaFor(33.34, -118.33)).toBe('Catalina');
  expect(areaFor(33.6, -117.9)).toBe('Orange County');
  expect(areaFor(32.72, -117.17)).toBe('San Diego');
  expect(areaFor(32.42, -117.25)).toBe('North Baja');
  expect(areaFor(33.0, -119.5)).toBe('Offshore SoCal');
  expect(areaFor(40, -120)).toBe('Other');
});
