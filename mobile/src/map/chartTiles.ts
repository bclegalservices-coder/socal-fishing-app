// NOAA's chart tile cache numbers its levels from web-map zoom 2, so the tile MapLibre calls "zoom 12" is NOAA
// "level 10". A URL template can't subtract, so the chart URL carries a "Z" marker (…/tile/Z12/…) and these native
// URL rewrites turn it into the right NOAA level for every request — on screen and in offline downloads alike.
import { TransformRequestManager } from '@maplibre/maplibre-react-native';
import { NOAA_CHART_MAXZOOM, NOAA_CHART_MINZOOM } from '../config';

let installed = false;

export function installChartTileFix() {
  if (installed) return;
  installed = true;
  try {
    for (let z = NOAA_CHART_MINZOOM; z <= NOAA_CHART_MAXZOOM; z++) {
      TransformRequestManager.addUrlTransform({
        id: `noaa-level-${z}`,
        match: 'NOAACharts/MapServer/tile/Z',
        find: `/tile/Z${z}/`,
        replace: `/tile/${z - NOAA_CHART_MINZOOM}/`,
      });
    }
  } catch (e) {
    installed = false;
    console.warn('Chart tile fix not installed', e);
  }
}

/** Same rewrite in plain JS — used by tests and anywhere a chart tile URL is built outside the map. */
export function noaaTileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
    .replace(`/tile/Z${z}/`, `/tile/${z - NOAA_CHART_MINZOOM}/`);
}
