import io
import math
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image

from ocean import bathy, breaks, colormaps, contours, tiles
from ocean.erddap import build_url, parse_table
from ocean.grid import Grid, to_display_units
from ocean.registry import DATASETS


def front_grid(delta=6.0, width_nm=2.0):
    """Synthetic SST: cold north, warm south, tanh front along 33.4N."""
    lats = np.arange(33.0, 33.8, 0.01)
    lons = np.arange(-118.4, -117.6, 0.01)
    LON, LAT = np.meshgrid(lons, lats)
    y_nm = (LAT - 33.4) * 60
    vals = 64 + (delta / 2) * np.tanh(-y_nm / (width_nm / 2))
    return Grid(lats, lons, vals.astype(np.float32), {"units": "degF", "source": "test", "observed_at": "2026-10-01T12:00:00+00:00"})


def test_bilinear_sample():
    g = Grid(np.array([0.0, 1.0]), np.array([0.0, 1.0]), np.array([[0, 10], [20, 30]], dtype=np.float32))
    assert abs(g.sample(0.5, 0.5) - 15) < 1e-6
    assert math.isnan(g.sample(2.0, 0.5))


def test_descending_lats_are_flipped():
    g = Grid(np.array([1.0, 0.0]), np.array([0.0, 1.0]), np.array([[20, 30], [0, 10]], dtype=np.float32))
    assert g.lats[0] == 0.0 and abs(g.sample(0.0, 0.0)) < 1e-6


def test_units_c_to_f_and_depth():
    g = Grid(np.array([0.0, 1.0]), np.array([0.0, 1.0]), np.full((2, 2), 20.0, np.float32), {"units": "degC"})
    assert abs(float(to_display_units(g).values[0, 0]) - 68.0) < 1e-4
    b = Grid(np.array([0.0, 1.0]), np.array([0.0, 1.0]), np.array([[-100, 5], [-50, -10]], np.float32), {"units": "m", "layer": "bathy"})
    d = to_display_units(b).values
    assert abs(d[0, 0] - 328.084) < 0.01 and math.isnan(d[0, 1])


def test_gradient_finds_front_strength():
    g = front_grid(delta=6.0, width_nm=2.0)
    _, mag = breaks.gradient_per_nm(g, sigma_cells=0.0)
    # tanh front: peak gradient = delta / width
    assert 2.5 < np.nanmax(mag) < 3.2


def test_break_lines_follow_front():
    g = front_grid()
    fc = breaks.break_lines(g, 0.5, 1.0, 0.5)
    strong = [f for f in fc["features"] if f["properties"]["strength"] == "strong"]
    assert strong, "expected strong break lines"
    lats = [pt[1] for f in strong for seg in f["geometry"]["coordinates"] for pt in seg]
    assert abs(np.mean(lats) - 33.4) < 0.05


def test_no_breaks_in_flat_water():
    lats = np.arange(33.0, 33.5, 0.01); lons = np.arange(-118.4, -117.9, 0.01)
    rng = np.random.default_rng(1)
    vals = (66 + rng.normal(0, 0.02, (lats.size, lons.size))).astype(np.float32)
    fc = breaks.break_lines(Grid(lats, lons, vals), 0.5, 1.0, 0.5)
    assert fc["features"] == []


def test_describe_near_gives_fisherman_numbers():
    g = front_grid(delta=6.0, width_nm=2.0)
    d = breaks.describe_near(g, 33.45, -118.0, 5.0, 0.5, 1.0)
    assert d and d["strength"] == "strong"
    assert d["to_value"] > d["from_value"]
    assert 2.0 < d["change"] < 6.5
    assert d["distance_nm"] < 5


def test_nan_aware_smoothing_keeps_gaps():
    v = np.ones((10, 10)); v[4:6, 4:6] = np.nan
    s = breaks.nan_gaussian(v, 1.0)
    assert np.isnan(s[5, 5]) and abs(s[0, 0] - 1) < 1e-9


def test_tile_math_roundtrip():
    x, y = tiles.lonlat_to_tile(-118.0, 33.4, 10)
    w, s, e, n = tiles.tile_bounds(10, x, y)
    assert w <= -118.0 <= e and s <= 33.4 <= n
    assert len(list(tiles.tiles_for_bbox((-118.5, 33.0, -117.5, 34.0), 8))) >= 1


def test_render_tile_png():
    g = front_grid()
    x, y = tiles.lonlat_to_tile(-118.0, 33.4, 9)
    png = tiles.render(g, 9, x, y, lambda v: colormaps.apply(v, colormaps.SST_F))
    img = Image.open(io.BytesIO(png))
    assert img.size == (256, 256) and img.mode == "RGBA"
    alpha = np.array(img)[..., 3]
    assert alpha.max() == 255 and alpha.min() == 0  # data inside, transparent outside


def test_render_empty_tile_is_skipped():
    g = front_grid()
    x, y = tiles.lonlat_to_tile(-100.0, 20.0, 9)
    assert tiles.render(g, 9, x, y, lambda v: colormaps.apply(v, colormaps.SST_F)) is None


def test_colormap_log_scale_and_nan():
    rgba = colormaps.apply(np.array([0.03, 10.0, np.nan]), colormaps.CHL)
    assert rgba[2, 3] == 0 and rgba[0, 3] == 255 and not np.array_equal(rgba[0, :3], rgba[1, :3])


def test_marching_squares_circle():
    lats = np.linspace(-1, 1, 41); lons = np.linspace(-1, 1, 41)
    X, Y = np.meshgrid(lons, lats)
    segs = list(contours.segments(lats, lons, np.hypot(X, Y), 0.5))
    pts = np.array([p for s in segs for p in s[:2]])
    assert len(segs) > 20 and np.allclose(np.hypot(pts[:, 0], pts[:, 1]), 0.5, atol=0.02)


def test_bathy_hillshade_and_dropoff():
    lats = np.arange(33.0, 33.3, 0.005); lons = np.arange(-118.3, -118.0, 0.005)
    X, Y = np.meshgrid(lons, lats)
    depth = np.where(X < -118.15, 200.0, 2000.0) + 0 * Y  # cliff (drop-off) at -118.15
    g = Grid(lats, lons, depth.astype(np.float32), {"layer": "bathy"})
    _, hs, slope = bathy.shaded_grid(g)
    col = np.argmin(np.abs(lons + 118.15))
    assert np.nanmax(slope.values[:, col - 1:col + 2]) > 6  # flagged as steep
    assert np.nanmax(slope.values[:, :5]) < 1
    fc = bathy.contour_geojson(g, [300, 1200])
    assert {f["properties"]["depth_ft"] for f in fc["features"]} == {300, 1200}


def test_erddap_url_and_parse():
    ds = DATASETS["chl"]
    url = build_url(ds, (-118.5, 33.0, -117.5, 34.0), "last", 2)
    assert "griddap/" in url and "[(last)]" in url and "[(0.0)]" in url and "[(33.0):2:(34.0)]" in url
    url2 = build_url(DATASETS["sst"], (-118.5, 33.0, -117.5, 34.0), "2026-09-30")
    assert "[(2026-09-30T12:00:00Z)]" in url2
    payload = {"table": {"columnNames": ["time", "latitude", "longitude", "analysed_sst"],
                         "rows": [["2026-09-30T09:00:00Z", 33.0, -118.0, 18.5], ["2026-09-30T09:00:00Z", 33.0, -117.99, None],
                                  ["2026-09-30T09:00:00Z", 33.01, -118.0, 18.7], ["2026-09-30T09:00:00Z", 33.01, -117.99, 18.9]]}}
    lats, lons, vals, t = parse_table(payload, "analysed_sst")
    assert vals.shape == (2, 2) and math.isnan(vals[0, 1]) and t.year == 2026


def test_grid_bytes_roundtrip():
    g = front_grid()
    g2 = Grid.from_bytes(g.to_bytes())
    assert g2.meta["source"] == "test" and np.allclose(g.values, g2.values)


def test_wind_arrows_direction_and_speed():
    from ocean.wind import arrows
    lats = np.array([33.0]); lons = np.array([-118.0])
    # wind blowing toward the east (u>0) comes FROM the west: 270°
    fc = arrows(lats, lons, np.array([[5.0]]), np.array([[0.0]]), np.array([[8.0]]))
    p = fc["features"][0]["properties"]
    assert p["from"] == 270 and abs(p["kt"] - 9.7) < 0.1 and abs(p["gust"] - 15.6) < 0.1
    shaft = fc["features"][0]["geometry"]["coordinates"][0]
    assert shaft[1][0] > shaft[0][0]  # tip is east of tail
    fc = arrows(lats, lons, np.array([[0.0]]), np.array([[-5.0]]))  # blowing south = from north
    assert fc["features"][0]["properties"]["from"] == 0


def test_blank_settings_fall_back_to_defaults():
    """GitHub Actions passes unset repository variables as empty strings; they must not blank out dataset IDs."""
    import importlib, os
    os.environ["SST_DATASET"] = ""
    os.environ["MPA_URL"] = ""
    try:
        import ocean.registry as reg
        import rules.layers as rl
        importlib.reload(reg); importlib.reload(rl)
        assert reg._env("SST_DATASET", "jplMURSST41") == "jplMURSST41"
        assert isinstance(rl.CDFW_MPA, str) and rl.CDFW_MPA.startswith("https://services2.arcgis.com/")
    finally:
        del os.environ["SST_DATASET"], os.environ["MPA_URL"]
        importlib.reload(reg); importlib.reload(rl)
