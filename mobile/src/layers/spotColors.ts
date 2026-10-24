// Fixed colors so your own spots never look like the known/public spots, whatever theme is on.
// Night (red-light) themes get dim versions that keep night vision.
export const SPOT_COLORS = { mine: '#FF8A00', known: '#1E88E5', ring: '#FFFFFF' };
export const SPOT_COLORS_NIGHT = { mine: '#C77700', known: '#3F6FA8', ring: '#1A0E0C' };
export function spotColors(night: boolean) { return night ? SPOT_COLORS_NIGHT : SPOT_COLORS; }
