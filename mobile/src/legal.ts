// Safety & legal wording shown in the app (first-launch notice, Me → Safety & legal, Go To warning).
// Kept in the app so it works offline. Change LEGAL_VERSION when the wording changes materially:
// everyone is asked to accept the new version the next time they open the app.
export const LEGAL_VERSION = 1;

export const SHORT_WARNING = 'Not for navigation · not a chartplotter';

export const FIRST_LAUNCH: { icon: string; title: string; text: string }[] = [
  { icon: 'compass-off-outline', title: 'Not for navigation', text: 'Channel Nav is a fishing and planning aid. It is not a certified chartplotter or a substitute for official NOAA charts, your boat\'s electronics, or a proper lookout.' },
  { icon: 'map-marker-alert-outline', title: 'Data can be wrong or late', text: 'Charts, depths, water temperature, chlorophyll, wind, radar, tides, buoys, harbor info, spot positions and catch reports can be delayed, incomplete or wrong.' },
  { icon: 'vector-line', title: '"Go To" is a straight line', text: 'Go To and routes are not checked for land, rocks, kelp, shallow water, restricted areas or traffic.' },
  { icon: 'weather-lightning-rainy', title: 'Weather is guidance', text: 'Boat ratings and forecasts are planning aids, not guarantees. National Weather Service warnings and your own judgment come first.' },
  { icon: 'fish', title: 'Know the rules', text: 'Protected areas, closures and limits are shown for reference only. Official California regulations govern — check them before you fish.' },
  { icon: 'lifebuoy', title: 'Emergencies', text: 'This app is not an emergency service. Use VHF channel 16 or call the Coast Guard. You are responsible for the safety of your vessel and crew.' },
];

export const FULL_TEXT: { h: string; p: string }[] = [
  { h: 'Not for navigation', p: 'Channel Nav provides fishing and navigation assistance only. It is not a certified chartplotter, ECDIS or GPS navigation device, and it must not be used as your primary means of navigation. Always carry and use official nautical charts and your vessel\'s own equipment, keep a proper lookout, follow the Navigation Rules (rules of the road) and use good seamanship.' },
  { h: 'Charts and depths', p: 'NOAA chart images, seafloor shading and depth contours are shown for reference. They may be out of date, simplified or misaligned and can be shown at scales they were not made for. Shoals, rocks, wrecks, buoys and other hazards may be missing or in the wrong place.' },
  { h: 'Go To and routes', p: 'Go To and routes draw straight lines between points. They do not avoid land, shallow water, rocks, kelp, restricted or closed areas, shipping lanes or other traffic. Distances, bearings and arrival times are estimates.' },
  { h: 'GPS and position', p: 'Your phone\'s position can be inaccurate, delayed or lost (signal, battery, background limits). Do not rely on it for close-quarters maneuvering, crossing bars or entering harbors.' },
  { h: 'Ocean and weather data', p: 'Water temperature, chlorophyll ("water color"), wind, radar, forecasts, tides, currents and buoy readings come from government and scientific sources and our own processing. They can be late, have gaps (clouds, outages) or be wrong. Boat ratings ("Can my boat handle it?") are planning guidance, not a guarantee of safe conditions. National Weather Service forecasts, watches and warnings take priority.' },
  { h: 'Harbors, fuel, bait and spots', p: 'Marina, dock, fuel, pump-out, bait and launch-ramp information, and fishing spot positions, come from public and community sources and may be wrong or out of date. Always confirm hours, fuel and services directly with the business. Spot positions are approximate.' },
  { h: 'Fishing rules and protected areas', p: 'Marine Protected Areas, closures, seasons and limits are shown for reference only and may be incomplete or out of date. The official California Department of Fish and Wildlife and federal regulations govern. You are responsible for knowing and following them.' },
  { h: 'Community content', p: 'Catch reports, posts and shared spots are written by other users. We don\'t verify them and they are not a promise that fish are present.' },
  { h: 'Sponsors', p: 'Ads and "presented by" sponsors are paid placements and are labeled. They are not endorsements, and sponsors have no access to your personal data or exact location.' },
  { h: 'Float plans and crew sharing', p: 'Float plans, overdue alerts and location sharing depend on your phone, signal and other people seeing the alert. They are not an emergency service and may fail. In an emergency use VHF channel 16 or call the U.S. Coast Guard.' },
  { h: 'Your responsibility', p: 'You are solely responsible for the safe operation of your vessel and the safety of everyone aboard, and for decisions made using this app. The app and all data are provided "as is" and "as available", without warranties of any kind, to the fullest extent permitted by law. To the fullest extent permitted by law, we are not liable for any loss, damage, injury or penalty arising from use of, or reliance on, the app or its data.' },
];
