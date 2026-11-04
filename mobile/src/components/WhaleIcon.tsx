// Nov 3: a whale drawn in the same outline style as the app's other icons (the 🐋 emoji didn't match).
// One picture, colored by `color` like any icon. Drawing: mobile/assets/icons/whale.png (+ @2x, @3x).
import { Image } from 'react-native';

const SRC = require('../../assets/icons/whale.png');

export function WhaleIcon({ size = 24, color = '#FFFFFF' }: { size?: number; color?: string }) {
  return <Image source={SRC} style={{ width: size, height: size, tintColor: color }} resizeMode="contain" accessibilityIgnoresInvertColors />;
}
