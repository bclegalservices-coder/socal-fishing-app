"""Coastal Relief Model job: reading NOAA's netCDF files and the Standard / Max contour layers."""
import io

import numpy as np

from ocean.contourtiles import levels, lines_only
from ocean.grid import Grid


def test_reads_erddap_netcdf():
    from scipy.io import netcdf_file
    from ocean.crm import _read_nc
    buf = io.BytesIO(); f = netcdf_file(buf, "w")
    f.createDimension("latitude", 2); f.createDimension("longitude", 3)
    f.createVariable("latitude", "d", ("latitude",))[:] = [33.0, 33.1]
    f.createVariable("longitude", "d", ("longitude",))[:] = [-118.3, -118.2, -118.1]
    v = f.createVariable("topo", "f", ("latitude", "longitude")); v[:] = [[-5, -6, -99999], [-7, -8, -9]]; v._FillValue = np.float32(-99999)
    f.flush()
    lat, lon, arr = _read_nc(buf.getvalue(), "topo")
    assert arr.shape == (2, 3) and np.isnan(arr[0, 2]) and arr[1, 1] == -8


def test_max_has_more_lines_than_standard():
    s, _ = levels("std", 12); m, major = levels("max", 12)
    assert len(m) > len(s) and 10 in m and 100 in major and 1000 in major
    yy = np.mgrid[0:256, 0:256][0]
    depth = 5.0 + yy * 1.2                       # 5 ft → ~310 ft down the square
    a = lines_only(depth, 12, "std"); b = lines_only(depth, 12, "max")
    assert (b[..., 3] > 0).sum() > (a[..., 3] > 0).sum()
    land = depth.copy(); land[:40] = np.nan       # land stays clear
    c = lines_only(land, 12, "max")
    assert (c[:30, :, 3] == 0).all()             # (a depth label's white edge may reach a few px over the shore)


def test_contour_pyramid_both_densities():
    from ocean.crm import CONTOUR_TOP, contour_tree
    from ocean.tiles import tiles_for_bbox
    lats = np.arange(33.30, 33.60, 1 / 1200) + 1 / 2400; lons = np.arange(-118.60, -118.20, 1 / 1200) + 1 / 2400
    la = lats[:, None] + 0 * lons[None, :]
    g = Grid(lats, lons, (-(5 + (33.58 - la) * 4000)).astype(np.float32), {})
    got = {}
    bbox = (-118.45, 33.42, -118.43, 33.44)
    for z, x, y in tiles_for_bbox(bbox, CONTOUR_TOP):
        contour_tree(g, lambda k, d: got.__setitem__(k, d), z, x, y, bbox, {"tiles": 0})
    assert {k.split("/")[0] for k in got} == {"std", "max"}
    assert {int(k.split("/")[1]) for k in got} == set(range(9, 14))


def test_uses_new_noaa_name_and_converts_longitude():
    """NOAA retired usgsCeCrm6; the job must use usgsCeCrm6_Lon0360 (longitude 0–360) and turn it back into -180…180."""
    from scipy.io import netcdf_file
    from ocean import crm

    def nc(lats, lons):
        buf = io.BytesIO(); f = netcdf_file(buf, "w")
        f.createDimension("latitude", len(lats)); f.createDimension("longitude", len(lons))
        f.createVariable("latitude", "d", ("latitude",))[:] = lats
        f.createVariable("longitude", "d", ("longitude",))[:] = lons
        f.createVariable("topo", "f", ("latitude", "longitude"))[:] = -50.0
        f.flush(); return buf.getvalue()

    class R:
        def __init__(self, code, body=b"", js=None): self.status_code, self.content, self._js, self.text = code, body, js, ""
        def json(self): return self._js
        def raise_for_status(self):
            if self.status_code >= 400: raise RuntimeError(f"HTTP {self.status_code}")

    asked = []
    info = {"table": {"columnNames": ["Row Type", "Variable Name"],
                      "rows": [["dimension", "latitude"], ["dimension", "longitude"], ["variable", "topo"]]}}

    class H:
        def get(self, url, **k):
            asked.append(url)
            if "/info/usgsCeCrm6/" in url: return R(404)
            if "/info/usgsCeCrm6_Lon0360/" in url: return R(200, js=info)
            if "/griddap/usgsCeCrm6_Lon0360.nc" in url:
                q = url.split("topo", 1)[1]
                lo = [float(x) for x in q.split("][")[1].strip("[]").replace("(", "").replace(")", "").split(":1:")]
                assert lo[0] > 180, "longitude must be asked for as 0–360"
                la = [float(x) for x in q.split("][")[0].strip("[]").replace("(", "").replace(")", "").split(":1:")]
                la0, la1 = min(la), max(la)
                return R(200, nc(np.arange(la0, la1, 1 / 1200) + 1 / 2400, np.arange(lo[0], lo[1], 1 / 1200) + 1 / 2400))
            return R(404)

    bbox = (-118.30, 33.00, -118.29, 33.01)
    real = crm.fetch_grid
    crm.fetch_grid = lambda *a, **k: Grid(np.array([32.9, 33.1]), np.array([-118.4, -118.2]), np.full((2, 2), -99.0, np.float32), {})
    try:
        g = crm.fetch_crm(bbox, H(), log=lambda *a: None)
    finally:
        crm.fetch_grid = real
    assert g.meta["dataset"] == "usgsCeCrm6_Lon0360"
    assert any("/info/usgsCeCrm6_Lon0360/" in u for u in asked)
    assert g.lons.min() < 0 and np.isfinite(g.values).any()      # data landed at -118°, not off the grid
    assert crm.lon_offset("usgsCeCrm6_Lon0360") == 360 and crm.lon_offset("usgsCeCrm6") == 0


def test_falls_back_to_ncei_when_coastwatch_refuses():
    """CoastWatch answering 403 to everything (as on 2026-10-23) must not stop the job: NCEI's copy is used instead."""
    from scipy.io import netcdf_file
    from urllib.parse import urlencode
    from ocean import crm

    def nc(lats, lons, val):
        buf = io.BytesIO(); f = netcdf_file(buf, "w")
        f.createDimension("lat", len(lats)); f.createDimension("lon", len(lons))
        f.createVariable("lat", "d", ("lat",))[:] = lats
        f.createVariable("lon", "d", ("lon",))[:] = lons
        f.createVariable("Band1", "f", ("lat", "lon"))[:] = val
        f.flush(); return buf.getvalue()

    class R:
        def __init__(self, code, body=b"", text=""): self.status_code, self.content, self.text = code, body, text
        def json(self): raise ValueError
        def raise_for_status(self):
            if self.status_code >= 400: raise RuntimeError(f"HTTP {self.status_code}")

    ncss = []

    class H:
        def get(self, url, params=None, **k):
            if url.startswith(crm.PFEG): return R(403)
            if url.endswith("/dataset.xml"): return R(200, text='<gridDataset><grid name="Band1" desc="z" shape="lat lon" type="float"/></gridDataset>')
            if url == crm.NCEI_NCSS:
                ncss.append(params)
                s_, n_, w_, e_ = (float(params[x]) for x in ("south", "north", "west", "east"))
                la = np.arange(s_, n_, 1 / 1200) + 1 / 2400; lo = np.arange(w_, e_, 1 / 1200) + 1 / 2400
                return R(200, nc(la, lo, np.full((la.size, lo.size), -120.0)))
            return R(404)

    bbox = (-118.30, 33.00, -118.25, 33.04)
    g = crm.fetch_crm(bbox, H(), log=lambda *a: None)
    assert g.meta["dataset"] == crm.NCEI_ID
    assert ncss and ncss[0]["var"] == "Band1" and ncss[0]["accept"] == "netcdf3"
    assert np.isfinite(g.values).all() and np.allclose(g.values, -120.0)   # every cell filled, depth stays negative
    assert -118.31 < g.lons.min() < g.lons.max() < -118.24


def test_stops_cleanly_when_both_noaa_servers_fail():
    from ocean import crm

    class R:
        status_code, content, text = 403, b"", ""
        def json(self): raise ValueError
        def raise_for_status(self): raise RuntimeError("HTTP 403")

    class H:
        def get(self, *a, **k): return R()
    try:
        crm.fetch_crm((-118.3, 33.0, -118.25, 33.04), H(), log=lambda *a: None)
        assert False, "should have stopped"
    except RuntimeError as e:
        assert "Nothing was changed" in str(e)


def _fake_file_http(blob: bytes):
    """An HTTP client whose .stream() serves one file (the NGDC download) and refuses everything else."""
    class Stream:
        status_code = 200
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def iter_bytes(self, n):
            for i in range(0, len(blob), n):
                yield blob[i:i + n]

    class H:
        def stream(self, method, url, **k):
            assert url.endswith("crm_vol6.nc")
            return Stream()
        def get(self, *a, **k): raise AssertionError("the plain file should be enough")
    return H()


def _fresh_tmp():
    import os, tempfile
    p = os.path.join(tempfile.gettempdir(), "crm_vol6.nc")
    if os.path.exists(p):
        os.remove(p)


def test_plain_file_coards_layout_fills_every_row():
    """NGDC's crm_vol6.nc as a lat/lon grid with points on exact 3″ marks: every row and column must land (no stripes)."""
    from scipy.io import netcdf_file
    from ocean import crm
    lat = np.arange(32.95, 33.10, 1 / 1200); lon = np.arange(-118.35, -118.20, 1 / 1200)
    buf = io.BytesIO(); f = netcdf_file(buf, "w")
    f.createDimension("y", lat.size); f.createDimension("x", lon.size)
    f.createVariable("y", "d", ("y",))[:] = lat
    f.createVariable("x", "d", ("x",))[:] = lon
    f.createVariable("z", "f", ("y", "x"))[:] = -30.0 - (lat[:, None] - 32.95) * 100
    f.flush(); _fresh_tmp()
    g = crm.fetch_crm((-118.30, 33.00, -118.25, 33.04), _fake_file_http(buf.getvalue()), log=lambda *a: None)
    assert g.meta["dataset"] == crm.CRM_FILE_ID
    assert np.isfinite(g.values).all()
    assert (np.diff(g.values[:, 0]) <= 0).all() and g.values.max() < 0      # deeper to the north, no gaps or swaps
    _fresh_tmp()


def test_plain_file_old_gmt_layout():
    """The old GMT layout: x_range/y_range/spacing/dimension and one flat z, rows north → south."""
    from scipy.io import netcdf_file
    from ocean import crm
    nx, ny = 180, 150
    x0, y0 = -118.35, 32.95
    x1, y1 = x0 + (nx - 1) / 1200, y0 + (ny - 1) / 1200
    lats_desc = np.linspace(y1, y0, ny)
    zz = (-30.0 - (lats_desc[:, None] - y0) * 100 + 0 * np.zeros((1, nx))).astype(np.float32)
    buf = io.BytesIO(); f = netcdf_file(buf, "w")
    f.createDimension("side", 2); f.createDimension("xysize", nx * ny)
    f.createVariable("x_range", "d", ("side",))[:] = [x0, x1]
    f.createVariable("y_range", "d", ("side",))[:] = [y0, y1]
    f.createVariable("z_range", "d", ("side",))[:] = [zz.min(), zz.max()]
    f.createVariable("spacing", "d", ("side",))[:] = [1 / 1200, 1 / 1200]
    f.createVariable("dimension", "i", ("side",))[:] = [nx, ny]
    f.createVariable("z", "f", ("xysize",))[:] = zz.ravel()
    f.flush(); _fresh_tmp()
    g = crm.fetch_crm((-118.30, 33.00, -118.25, 33.04), _fake_file_http(buf.getvalue()), log=lambda *a: None)
    assert np.isfinite(g.values).all()
    assert (np.diff(g.values[:, 0]) <= 0).all()                         # north is deeper → rows weren't flipped
    want = -30.0 - (g.lats - y0) * 100
    assert np.allclose(g.values[:, 0], want, atol=0.2)
    _fresh_tmp()
