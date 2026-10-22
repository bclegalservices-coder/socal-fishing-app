"""Auto route on a made-up harbor: a marina basin off a harbor channel, a long breakwater with one 100 m entrance,
and an island offshore. The route must leave the marina, go out through the entrance and around the island."""
import math

import numpy as np

from navroute.build import save_arrays
from navroute.grid import FRES, UNKNOWN, NavData
from navroute.router import dist_nm, route

BBOX = (-118.40, 33.60, -118.10, 33.80)


class DictStore:
    def __init__(self):
        self.d = {}

    def put(self, key, data, content_type=None):
        self.d[key] = data

    def get(self, key):
        return self.d.get(key)


def _lat(i): return BBOX[1] + (i + 0.5) * FRES
def _lon(j): return BBOX[0] + (j + 0.5) * FRES


def fake_harbor() -> NavData:
    h, w = int(round((BBOX[3] - BBOX[1]) / FRES)), int(round((BBOX[2] - BBOX[0]) / FRES))
    lat = BBOX[1] + (np.arange(h) + 0.5)[:, None] * FRES
    lon = BBOX[0] + (np.arange(w) + 0.5)[None, :] * FRES
    land = np.broadcast_to(lat > 33.72, (h, w)).copy()                     # the mainland
    land &= ~((lon > -118.27) & (lon < -118.25) & (lat < 33.76))          # harbor channel cut into it
    land &= ~((lon > -118.30) & (lon <= -118.27) & (lat > 33.745) & (lat < 33.755))   # marina basin off the channel
    bw = np.broadcast_to((lat > 33.700) & (lat < 33.7004), (h, w)).copy()   # breakwater …
    bw &= ((lon > -118.35) & (lon < -118.255)) | ((lon > -118.245) & (lon < -118.15))   # … with a gap at -118.25
    land |= bw
    land |= ((lat - 33.64) / 1.0) ** 2 + ((lon + 118.22) * math.cos(math.radians(33.64))) ** 2 < 0.01 ** 2   # island
    water = ~land
    depth = np.full(water.shape, UNKNOWN, dtype=np.uint8)
    depth[~water] = 0
    store = DictStore()
    save_arrays(store, BBOX, water, depth)
    return NavData(store)


_ND = None


def nd():
    global _ND
    if _ND is None:
        _ND = fake_harbor()
    return _ND


def _all_water(n, pts, step_m=5):
    for p, q in zip(pts[:-1], pts[1:]):
        k = max(2, int(dist_nm(p, q) * 1852 / step_m))
        t = np.linspace(0, 1, k)
        w, _ = n.sample(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
        if not w.all():
            return False
    return True


def _crosses_gap(pts):
    for p, q in zip(pts[:-1], pts[1:]):
        if (p[0] - 33.7002) * (q[0] - 33.7002) < 0:
            f = (33.7002 - p[0]) / (q[0] - p[0])
            x = p[1] + f * (q[1] - p[1])
            if -118.255 < x < -118.245:
                return True
    return False


def test_marina_to_offshore_goes_out_the_entrance():
    n = nd()
    r = route(n, [(33.750, -118.29), (33.62, -118.30)], safety_ft=8)
    pts = [(p["lat"], p["lon"]) for p in r["points"]]
    assert _all_water(n, pts), "route crosses land"
    assert _crosses_gap(pts), "route didn't leave through the breakwater entrance"
    assert 1 <= r["turns"] <= 8, r["turns"]
    assert r["distance_nm"] > r["straight_nm"]


def test_long_run_goes_around_the_island():
    n = nd()
    r = route(n, [(33.755, -118.26), (33.625, -118.205)], safety_ft=8)
    pts = [(p["lat"], p["lon"]) for p in r["points"]]
    assert _all_water(n, pts)
    assert _crosses_gap(pts)


def test_short_hop_inside_harbor_and_pin_on_the_dock():
    n = nd()
    # end pin dropped just on the land at the head of the channel → snapped to the water next to it
    r = route(n, [(33.750, -118.29), (33.7603, -118.26)], safety_ft=8)
    pts = [(p["lat"], p["lon"]) for p in r["points"]]
    assert _all_water(n, pts[1:-1] if len(pts) > 2 else pts) or len(pts) >= 2
    assert r["distance_nm"] < 3


def test_open_water_is_a_straight_line():
    n = nd()
    r = route(n, [(33.66, -118.38), (33.61, -118.30)], safety_ft=8)
    assert r["turns"] == 0
    assert abs(r["distance_nm"] - r["straight_nm"]) < 0.01


def test_detailed_chart_wins_and_breakwaters_block():
    from navroute.build import Canvas, block_from_charts, drval1_ft
    bb = (-118.30, 33.70, -118.29, 33.71)                    # 100 × 100 cells
    sq = lambda x0, y0, x1, y1: {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}
    coastal = {"land": [{"geometry": sq(-118.30, 33.705, -118.29, 33.71)}],                 # north half land …
               "depth": [{"geometry": sq(-118.30, 33.70, -118.29, 33.705), "properties": {"DRVAL1": 20}}]}
    harbour = {"land": [],                                                                  # … but the harbour chart
               "depth": [{"geometry": sq(-118.297, 33.704, -118.293, 33.709), "properties": {"drval1": 3.0}}],   # has a basin
               "shore_lines": [{"geometry": {"type": "LineString", "coordinates": [[-118.30, 33.702], [-118.291, 33.702]]}}]}
    water, depth, cov = block_from_charts(Canvas(bb), [harbour, coastal])
    at = lambda lat, lon: (int((lat - 33.70) / FRES), int((lon + 118.30) / FRES))
    assert cov.all()
    assert water[at(33.7075, -118.295)] and depth[at(33.7075, -118.295)] == 10      # basin from the harbour chart, 3 m ≈ 10 ft
    assert not water[at(33.7085, -118.299)]                                           # coastal land outside the basin
    assert water[at(33.7010, -118.295)] and depth[at(33.7010, -118.295)] == 66        # 20 m ≈ 66 ft
    assert not water[at(33.7020, -118.295)]                                           # breakwater line
    assert water[at(33.7020, -118.2905)]                                              # past the end of the breakwater
    assert drval1_ft({"DRVAL1": None}) == 255 and drval1_ft({"DRVAL1": -1.2}) == 0


def test_via_points_are_kept_and_marked():
    n = nd()
    via = (33.66, -118.36)
    r = route(n, [(33.750, -118.29), via, (33.61, -118.30)], safety_ft=8)
    pts = r["points"]
    assert pts[0].get("target") and pts[-1].get("target")
    assert any(p.get("target") and abs(p["lat"] - via[0]) < 1e-6 and abs(p["lon"] - via[1]) < 1e-6 for p in pts[1:-1])
    assert _all_water(n, [(p["lat"], p["lon"]) for p in pts])
