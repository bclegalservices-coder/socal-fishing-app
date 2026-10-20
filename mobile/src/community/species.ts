// Species list (codes match the database seed). Colors are used for map markers and chips.
export const SPECIES: { code: string; name: string; color: string }[] = [
  { code: 'BFT', name: 'Bluefin tuna', color: '#2f6fb6' },
  { code: 'YFT', name: 'Yellowfin tuna', color: '#f2d36a' },
  { code: 'YT', name: 'Yellowtail', color: '#f5a524' },
  { code: 'DOR', name: 'Dorado', color: '#5fbfa6' },
  { code: 'WSB', name: 'White seabass', color: '#d9d9d9' },
  { code: 'CAL', name: 'Calico bass', color: '#8fbf5a' },
  { code: 'SAN', name: 'Sand bass', color: '#b9a37a' },
  { code: 'HAL', name: 'California halibut', color: '#a77b5a' },
  { code: 'BAR', name: 'Barracuda', color: '#9aa9b8' },
  { code: 'BON', name: 'Bonito', color: '#4d7c9c' },
  { code: 'RCK', name: 'Rockfish', color: '#e7663a' },
  { code: 'LNG', name: 'Lingcod', color: '#6f8f4f' },
  { code: 'SHP', name: 'Sheephead', color: '#c43a3a' },
  { code: 'ALB', name: 'Albacore', color: '#7fa7d9' },
  { code: 'SKJ', name: 'Skipjack', color: '#5c6f99' },
  { code: 'WAH', name: 'Wahoo', color: '#3a8f8a' },
  { code: 'SWD', name: 'Swordfish', color: '#8b7fd1' },
  { code: 'MAR', name: 'Striped marlin', color: '#b07fd1' },
  { code: 'THR', name: 'Thresher shark', color: '#7a7a7a' },
  { code: 'MAK', name: 'Mako shark', color: '#5a5a7a' },
  { code: 'LOB', name: 'Spiny lobster', color: '#d1584f' },
  { code: 'OTH', name: 'Other', color: '#a3b4c1' },
];
export const speciesColor = (code?: string | null) => SPECIES.find((s) => s.code === code)?.color ?? '#a3b4c1';
export const speciesName = (code?: string | null) => SPECIES.find((s) => s.code === code)?.name ?? code ?? 'Fish';
export const TECHNIQUES = ['Flyline', 'Sinker rig', 'Knife jig', 'Surface iron', 'Yo-yo iron', 'Trolling', 'Kite', 'Live bait', 'Dropper loop', 'Bottom fishing', 'Casting', 'Other'];
export const BAITS = ['Sardine', 'Anchovy', 'Mackerel', 'Squid', 'Artificial lure', 'Jig', 'Other'];
export const TIME_WINDOWS = [{ label: '6 h', h: 6 }, { label: '12 h', h: 12 }, { label: '24 h', h: 24 }, { label: '3 days', h: 72 }, { label: '7 days', h: 168 }, { label: '30 days', h: 720 }];
