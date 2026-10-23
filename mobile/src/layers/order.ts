// Map layer order (bottom → top), so your boat, the route line and waypoints are NEVER covered:
//   NOAA chart → [shading: water temp, relief, HD bottom, radar, wind colors, MPA fill] → SHADING_TOP
//   → [lines & dots: breaks, contours, buoys, MPA outlines, harbor pins, wind streaks] → FEATURES_TOP
//   → your boat, route, waypoints, spots, pins (added after the style, so always above).
// The two marker layers are part of the base map style itself (MapScreen buildMapStyle), so they always exist
// before any overlay asks to go "before" them. (Oct 23: overlays switched on later used to land on top of the boat.)
export const SHADING_TOP = 'order-shading-top';
export const FEATURES_TOP = 'order-features-top';

// Safety net: ordering can be switched off (then layers stack in the order they're switched on, like before):
//  • automatically, if the app closed during startup after this change (MapScreen crash guard), and
//  • remotely, with the admin console's emergency off-switch "layer_order".
let enabled = true;
export function setLayerOrder(on: boolean) { enabled = on; }
/** The anchor to put a layer under, or nothing when ordering is switched off. */
export const below = (anchor: string): string | undefined => (enabled ? anchor : undefined);
