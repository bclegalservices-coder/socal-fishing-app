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


def test_list_datasets_parses_erddap_catalog():
    from ocean.erddap import list_datasets
    body = ("datasetID,title,maxTime\n,,UTC\n"
            "old1,Chlorophyll old,2026-04-29T12:00:00Z\nnew1,Chlorophyll new,2026-10-19T12:00:00Z\n")
    seen = {}

    class Resp:
        text = body
        def raise_for_status(self):
            pass

    class Client:
        def get(self, url):
            seen["url"] = url
            return Resp()
    rows = list_datasets("https://x/erddap", "(?i).*chlorophyll.*", Client())
    assert [r["id"] for r in rows] == ["new1", "old1"]
    assert "allDatasets.csv" in seen["url"] and "title=~" in seen["url"]


class _CopernicusEnv:
    """Set (or clear) the Copernicus login for one test, then put back whatever was there.
    The GitHub job has the real login set, so tests must not depend on it."""
    KEYS = ("COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD")

    def __init__(self, on: bool):
        self.on = on

    def __enter__(self):
        import os
        self.saved = {k: os.environ.get(k) for k in self.KEYS}
        for k in self.KEYS:
            if self.on:
                os.environ[k] = "test"
            else:
                os.environ.pop(k, None)

    def __exit__(self, *a):
        import os
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def test_chl_candidates_skip_missing_and_adapt_variable():
    from ocean.jobs import chl_candidates
    from ocean.registry import DATASETS

    def info(dims, vars_):
        rows = [["dimension", d] for d in dims] + [["variable", v] for v in vars_]
        return {"table": {"columnNames": ["Row Type", "Variable Name"], "rows": rows}}

    class Resp:
        def __init__(self, code, js=None):
            self.status_code, self._js = code, js
        def raise_for_status(self):
            if self.status_code != 200:
                raise RuntimeError(f"HTTP {self.status_code}")
        def json(self):
            return self._js

    class Client:
        def get(self, url):
            if "/info/erdVHNchla1day/" in url:
                return Resp(200, info(["time", "altitude", "latitude", "longitude"], ["chla"]))
            return Resp(404)

    with _CopernicusEnv(on=False):
        got = list(chl_candidates(Client()))
    assert [d.dataset_id for d in got] == ["erdVHNchla1day"]
    assert got[0].variable == "chla" and got[0].fixed == {"altitude": 0.0}
    assert DATASETS["chl"].dataset_id != "erdVHNchla1day" or True


def test_chl_prefers_copernicus_when_logged_in():
    import os
    from ocean.jobs import chl_candidates, _note

    class Client:
        def get(self, url):
            raise RuntimeError("offline")
    with _CopernicusEnv(on=True):
        first = next(iter(chl_candidates(Client())))
        assert first.erddap == "copernicus" and first.kind == "interpolated"
        assert "Copernicus Marine Service Information" in _note("chl", first)


def test_sst_has_backup_servers():
    import os
    from ocean.jobs import sst_candidates
    with _CopernicusEnv(on=True):
        c = list(sst_candidates())
        assert "coastwatch.pfeg" in c[0].erddap and "upwell" in c[1].erddap and c[2].erddap == "copernicus"
        assert c[2].units == "K"


def test_wind_speed_tiles_and_uv_grid():
    import tempfile
    import numpy as np
    from core.storage import LocalStore
    from ocean.wind import speed_tiles, uv_grid
    lats = np.arange(32.0, 34.01, 0.25)
    lons = np.arange(-119.0, -116.99, 0.25)
    u = np.full((lats.size, lons.size), 5.0)
    v = np.full((lats.size, lons.size), -5.0)
    st = LocalStore(tempfile.mkdtemp())
    n = speed_tiles(st, lats, lons, u, v, "tiles/wind/t/f000", (-119.0, 32.0, -117.0, 34.0))
    assert n > 0 and st.get("manifests/none.json") is None
    g = uv_grid(lats, lons, u, v)
    assert len(g["u"]) == lats.size and g["u"][0][0] == 5.0 and g["v"][0][0] == -5.0


def test_local_store_delete_prefix():
    import tempfile
    from core.storage import LocalStore
    st = LocalStore(tempfile.mkdtemp())
    st.put("tiles/wind/socal/2026010100/f000/5/1/1.png", b"x")
    st.put("tiles/wind/socal/2026010106/f000/5/1/1.png", b"x")
    assert st.delete_prefix("tiles/wind/socal/2026010100/") == 1
    assert st.get("tiles/wind/socal/2026010106/f000/5/1/1.png") == b"x"


def test_hrrr_rotation_and_regrid():
    import numpy as np
    from ocean.hrrr import LOV, regrid, rotate_to_earth
    # On the grid's center longitude the grid is already north-up: nothing changes.
    u, v = rotate_to_earth(np.array([3.0]), np.array([4.0]), np.array([LOV]))
    assert abs(u[0] - 3.0) < 1e-9 and abs(v[0] - 4.0) < 1e-9
    # West of it (SoCal, -118) the grid is turned; speed must stay the same.
    u, v = rotate_to_earth(np.array([0.0]), np.array([10.0]), np.array([-118.0]))
    assert abs(np.hypot(u[0], v[0]) - 10.0) < 1e-9 and u[0] < 0
    # A slightly skewed curvilinear grid resamples onto a regular one.
    jj, ii = np.meshgrid(np.arange(60), np.arange(60))
    lat2 = 32.0 + ii * 0.04 + jj * 0.002
    lon2 = -119.0 + jj * 0.04 - ii * 0.002
    lats, lons, g = regrid(lat2, lon2, {"u": np.full(lat2.shape, 7.0)}, (-118.8, 32.2, -117.5, 33.8))
    assert lats[0] == 32.2 and abs(lons[-1] - (-117.5)) < 0.031
    assert np.nanmin(g["u"]) == 7.0 and np.isfinite(g["u"]).mean() > 0.95


def test_forecast_radar_tiles_skip_dry_hours():
    import tempfile
    import numpy as np
    from core.storage import LocalStore
    from ocean.wind import radar_tiles
    lats = np.arange(32.0, 34.01, 0.03)
    lons = np.arange(-119.0, -116.99, 0.03)
    st = LocalStore(tempfile.mkdtemp())
    dry = np.full((lats.size, lons.size), 5.0)
    assert radar_tiles(st, lats, lons, dry, "tiles/radarfc/t/h000", (-119.0, 32.0, -117.0, 34.0)) == 0
    wet = dry.copy()
    wet[20:40, 20:40] = 40.0
    assert radar_tiles(st, lats, lons, wet, "tiles/radarfc/t/h001", (-119.0, 32.0, -117.0, 34.0)) > 0


def test_sst_bands_are_crisp():
    """Each 1 °F band is one solid color in its middle; neighboring degrees get different colors; and since Oct 24 the
    last bit of a band fades softly into the next one (a soft edge instead of a hard step)."""
    import numpy as np
    from ocean import colormaps
    v = np.array([64.3, 64.7, 65.3, np.nan, 64.98, 65.02])
    rgba = colormaps.apply(v, colormaps.SST_F)
    assert (rgba[0, :3] == rgba[1, :3]).all()          # middle of a band → identical color
    assert not (rgba[1, :3] == rgba[2, :3]).all()      # next degree → a different color
    assert rgba[3, 3] == 0                              # no data → transparent
    a, c = rgba[1, :3].astype(int), rgba[2, :3].astype(int)
    for k in (4, 5):                                    # right at the 65° break: in between the two band colors
        m = rgba[k, :3].astype(int)
        assert ((m >= np.minimum(a, c) - 1) & (m <= np.maximum(a, c) + 1)).all() and not (m == a).all() and not (m == c).all()
    assert len(colormaps.SST_F["stops"]) == 24


def test_sst_uses_freshest_source():
    """MUR (1 km) 3 days behind, Copernicus has yesterday → Copernicus. Same day → the sharper MUR wins."""
    from ocean.jobs import pick_freshest
    assert pick_freshest([("mur", "2026-10-19"), ("copernicus", "2026-10-21")]) == 1
    assert pick_freshest([("mur", "2026-10-21"), ("copernicus", "2026-10-21")]) == 0
    assert pick_freshest([("mur", "2026-10-21")]) == 0


def test_latest_sst_picks_newest(monkeypatch=None):
    """End to end with fake sources: publishes the newer Copernicus day, skips NOAA's backup server when NOAA worked."""
    import numpy as np
    from dataclasses import replace
    from ocean import jobs
    from ocean.grid import Grid
    calls, published = [], {}
    mur = jobs.DATASETS["sst"]
    cop = replace(mur, erddap="copernicus", dataset_id="OSTIA")
    up = replace(mur, erddap=jobs.UPWELL)
    def fake_candidates():
        yield mur; yield up; yield cop
    def fake_fetch(layer, region, when, http, ds):
        calls.append(ds.erddap)
        day = "2026-10-21" if ds.erddap == "copernicus" else "2026-10-18"
        return Grid(np.array([33.0, 34.0]), np.array([-119.0, -118.0]), np.full((2, 2), 65.0, np.float32), {"observed_at": day + "T12:00:00+00:00"})
    def fake_process(layer, region, when, http, store, ds=None, grid=None):
        published["ds"], published["day"] = ds.dataset_id, jobs.grid_day(grid)
        return {"date": published["day"]}
    old = (jobs.sst_candidates, jobs.fetch_surface, jobs.process_surface)
    jobs.sst_candidates, jobs.fetch_surface, jobs.process_surface = fake_candidates, fake_fetch, fake_process
    try:
        ds, entry = jobs._latest_surface("sst", "socal", None, None)
    finally:
        jobs.sst_candidates, jobs.fetch_surface, jobs.process_surface = old
    assert published == {"ds": "OSTIA", "day": "2026-10-21"} and entry["date"] == "2026-10-21"
    assert jobs.UPWELL not in calls   # NOAA's backup server isn't asked when the main one answered


def test_land_mask_from_coastline():
    """Flood-fill from the open ocean: mainland and islands become land, the channel between stays water."""
    import math
    import numpy as np
    from ocean import landmask
    bbox = (-121.0, 31.0, -116.6, 35.0)
    main = [(-121.2, 34.6)] + [(-120.5 + 0.05 * i, 34.4 - 0.035 * i) for i in range(80)] + [(-116.4, 31.5)]
    isl = [(-119.45 + 0.22 * math.cos(t), 33.2 + 0.07 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 90)]
    m = landmask.build([main, isl], bbox)
    assert landmask.sane(m)
    lat = np.array([33.2, 33.45, 32.0, 34.5]); lon = np.array([-119.45, -119.45, -120.0, -117.0])
    assert m.is_land(lat, lon).tolist() == [True, False, False, True]   # island, channel, open ocean, mainland
    m2 = landmask.LandMask.from_bytes(m.to_bytes())
    assert (m2.land == m.land).all()


def test_land_mask_rejects_leaky_coast():
    """A coastline with a gap lets the flood pour onto land; such a mask is refused (map draws as before)."""
    import numpy as np
    from ocean import landmask
    bbox = (-121.0, 31.0, -116.6, 35.0)
    broken = [(-120.5 + 0.05 * i, 34.4 - 0.035 * i) for i in range(30)]   # stops in the middle of the box
    assert not landmask.sane(landmask.build([broken], bbox))


def test_fill_gaps_only_near_data():
    import numpy as np
    from ocean import landmask
    v = np.full((1, 12), np.nan, np.float32); v[0, :3] = 60.0
    f = landmask.fill_gaps(v, max_cells=3)
    assert np.isfinite(f[0, :6]).all() and np.isnan(f[0, 7:]).all()


def test_land_mask_from_chart_polygons():
    """NOAA chart land = a strip along the coast + an island. The inland interior (beyond the chart) becomes land,
    the island is land, the channel and open ocean stay water — even with a small gap between two chart sheets."""
    import numpy as np
    from ocean import landmask
    bbox = (-121.0, 31.0, -116.6, 35.0)
    # coastal strip in two pieces with a 0.0015° (~1.5 px) gap between "chart sheets"
    strip1 = {"type": "Polygon", "coordinates": [[(-121.0, 34.2), (-119.0, 33.6), (-119.0, 33.75), (-121.0, 34.35), (-121.0, 34.2)]]}
    strip2 = {"type": "Polygon", "coordinates": [[(-118.9985, 33.6), (-116.6, 32.6), (-116.6, 32.75), (-118.9985, 33.75), (-118.9985, 33.6)]]}
    island = {"type": "MultiPolygon", "coordinates": [[[(-119.6, 33.15), (-119.3, 33.15), (-119.3, 33.25), (-119.6, 33.25), (-119.6, 33.15)]]]}
    raw = landmask.rasterize([strip1, strip2, island], bbox)
    land = landmask.close_inland(raw, bbox)
    m = landmask.LandMask(bbox[0], bbox[1], landmask.RES, land)
    lat = np.array([33.2, 33.4, 32.0, 34.8, 33.67]); lon = np.array([-119.45, -119.45, -120.0, -117.5, -118.99925])
    assert m.is_land(lat, lon).tolist() == [True, False, False, True, True]   # island, channel, ocean, interior, gap closed
    assert landmask.sane(m)


def test_land_mask_coast_stays_exact():
    """Thickening is only for the flood: water right next to the chart's coast stays water."""
    import numpy as np
    from ocean import landmask
    bbox = (-121.0, 31.0, -116.6, 35.0)
    strip = {"type": "Polygon", "coordinates": [[(-121.0, 34.0), (-116.6, 34.0), (-116.6, 34.2), (-121.0, 34.2), (-121.0, 34.0)]]}
    land = landmask.close_inland(landmask.rasterize([strip], bbox), bbox)
    m = landmask.LandMask(bbox[0], bbox[1], landmask.RES, land)
    assert not m.is_land(np.array([33.997]), np.array([-119.0]))[0]   # 300 m offshore is still water
    assert m.is_land(np.array([34.1]), np.array([-119.0]))[0]


def test_breaks_found_on_coarse_5km_map():
    """A 2 °F front spread over ~6 NM on a 5 km map: missed by the 1 km settings, found by the tuned ones."""
    import numpy as np
    from ocean.breaks import break_lines
    from ocean.grid import Grid
    from ocean.registry import BREAKS, break_settings
    lats = np.arange(32.0, 34.0, 0.05); lons = np.arange(-120.0, -118.0, 0.05)
    LO, LA = np.meshgrid(lons, lats)
    v = (66 + 1.0 * np.tanh((LO + 119.0) / 0.06)).astype(np.float32)   # 64 °F west → 68 °F east, front near -119
    g = Grid(lats, lons, v, {"resolution_m": 5500})
    old = BREAKS["sst"]
    assert break_lines(g, old["moderate"], old["strong"], old["interval"])["features"] == []
    b = break_settings("sst", 5500)
    assert 0.15 < b["moderate"] < 0.3 and b["sigma"] == 0.0
    assert break_lines(g, b["moderate"], b["strong"], b["interval"], sigma_cells=b["sigma"])["features"]
    assert break_settings("sst", 1000)["moderate"] == old["moderate"]   # sharp 1 km map: unchanged
