"""HD bottom: BlueTopo index reading and the drawing (no network, no GeoTIFF reader needed)."""
import os
import sqlite3
import struct
import tempfile

import numpy as np

from ocean.bottomhd import build_tree, draw, levels_for, link_url, scheme_tiles


def _gpkg(rows):
    path = tempfile.mktemp(suffix=".gpkg")
    con = sqlite3.connect(path)
    con.execute("create table gpkg_geometry_columns(table_name text, column_name text)")
    con.execute("insert into gpkg_geometry_columns values('Tiles','geom')")
    con.execute("create table Tiles(tile text, GeoTIFF_Link text, Resolution text, geom blob)")
    for t, url, res, (x0, y0, x1, y1) in rows:
        blob = b"GP" + bytes([0, 0b11]) + struct.pack("<i", 4326) + struct.pack("<dddd", x0, x1, y0, y1)
        con.execute("insert into Tiles values(?,?,?,?)", (t, url, res, blob))
    con.commit(); con.close()
    data = open(path, "rb").read(); os.unlink(path)
    return data


def test_index_picks_overlapping_tiles_finest_first():
    g = _gpkg([("A", "s3://bucket/a.tif", "8 m", (-118.5, 33.3, -118.4, 33.4)),
               ("B", "https://x/b.tif", "2", (-118.3, 33.6, -118.2, 33.7)),
               ("C", "https://x/c.tif", "4", (-121.0, 34.3, -120.9, 34.4))])
    out = scheme_tiles(g, (-118.65, 33.25, -118.05, 33.85))
    assert [o["tile"] for o in out] == ["B", "A"]
    assert link_url("s3://bucket/a.tif") == "https://bucket.s3.amazonaws.com/a.tif"


def test_draw_colors_water_and_leaves_land_clear():
    yy, xx = np.mgrid[0:256, 0:256] * 2.0
    dem = -(2 + yy * 0.09)
    dem[:10] = 4.0                      # land strip
    img = draw(dem.astype(np.float32), 16, 33.4)
    assert img.shape == (512, 512, 4)                       # drawn at 2× for Retina screens (v3, Oct 24)
    assert (img[:16, :, 3] == 0).all() and (img[44:, :, 3] == 255).all()
    lv, major = levels_for(16)
    assert 5 in lv and 60 in major and 100 in major
    # contour lines darken some pixels in each column (depth crosses many 5/10 ft levels down the tile)
    assert (img[44:, 256, :3].sum(axis=1) < img[44:, 256, :3].sum(axis=1).max() * 0.8).any()


def test_pyramid_draws_every_zoom():
    from ocean.tiles import pixel_lonlat
    bbox = (-118.50, 33.40, -118.48, 33.42)
    def read(z, x, y):
        lon, lat = pixel_lonlat(z, x, y)
        return (-(5 + (33.42 - lat) * 3000)).astype(np.float32)
    got = {}
    from ocean.tiles import tiles_for_bbox
    for z, x, y in tiles_for_bbox(bbox, 11):
        build_tree(read, lambda k, d: got.__setitem__(k, d), z, x, y, bbox, {"tiles": 0})
    zooms = {int(k.split("/")[0]) for k in got}
    assert zooms == {11, 12, 13, 14, 15, 16}


def test_shrink_keeps_color_and_fades_empty_quarters():
    import numpy as np
    import ocean.bottomhd as B
    a = np.zeros((512, 512, 4), np.uint8); a[..., 2] = 200; a[..., 3] = 255
    out = B._shrink([a, None, None, a])
    assert out[10, 10, 2] == 200 and out[10, 10, 3] == 255          # top-left: full blue
    assert out[10, 400, 3] == 0                                       # top-right: empty
    assert out[400, 400, 2] == 200


def test_restore_points_the_app_back_at_an_earlier_build():
    import json
    from ocean.bottomhd import restore
    class Store:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def put(self, k, v, ct=None): self.d[k] = v
        def url(self, k): return "https://data.example/" + k
    st = Store()
    st.put("work/bottomhd/pilot/done.json", b'["11/1/2"]')
    st.put("manifests/bottomhd.json", json.dumps({"tiles": "https://data.example/tiles/bottomhd/pilot/v4/{z}/{x}/{y}.png"}).encode())
    assert restore(st, "pilot", "legacy", log=lambda *a: None)
    m = json.loads(st.get("manifests/bottomhd.json"))
    assert m["tiles"].startswith("https://data.example/tiles/bottomhd/pilot/{z}/{x}/{y}.png?v=") and m["style"] == "legacy"
    assert not restore(st, "pilot", "v3", log=lambda *a: None)            # nothing saved for v3 → nothing changed
    assert json.loads(st.get("manifests/bottomhd.json"))["style"] == "legacy"


def _faceted(res_m=16.0, n=592, px=1.0, seed=1):
    """A survey of `res_m` cells (with survey noise) stretched onto 1 m pixels with bilinear blending — exactly what
    made the 'boxes': every cell becomes a flat tilted plate."""
    from scipy import ndimage
    rng = np.random.default_rng(seed)
    k = int(n * px / res_m) + 3
    cy, cx = np.mgrid[0:k, 0:k] * res_m
    grid = -(8 + 0.01 * cy + 4 / (1 + np.exp(-(cx * 0.6 - cy * 0.8 + 50) / 6))) + rng.normal(0, 0.12, (k, k))
    c = (np.arange(n) + 0.5) * px / res_m - 0.5
    yy, xx = np.meshgrid(c, c, indexing="ij")
    return ndimage.map_coordinates(grid, [yy, xx], order=1).astype(np.float32)


def _roughness(img):
    """Pixel-to-pixel creases in the shading (the edges of the 'boxes'): mean |Laplacian| of brightness."""
    from scipy import ndimage
    lum = img[..., :3].astype(np.float64).mean(axis=2)
    return float(np.abs(ndimage.laplace(lum))[8:-8, 8:-8].mean())


def test_v5_has_no_survey_boxes():
    import ocean.bottomhd as B
    from PIL import Image
    from ocean.hdrender import MARGIN, draw as draw_v5
    dem = _faceted()                                            # 512 + 2·40 px at about 1 m (zoom 16)
    new = draw_v5(dem, np.full(dem.shape, 16.0, np.float32), 16, 33.7, MARGIN, lines=False)
    keep = B.hd_lines
    B.hd_lines = lambda shaded, *a: np.array(Image.fromarray(shaded, "RGBA").resize((512, 512), Image.BILINEAR))
    try:
        old = B.draw_v4(dem[MARGIN:-MARGIN:2, MARGIN:-MARGIN:2], 16, 33.7)     # the old shading, without lines
    finally:
        B.hd_lines = keep
    assert new.shape == (512, 512, 4) and (new[..., 3] == 255).all()
    assert _roughness(new) < 0.6 * _roughness(old)            # measured Oct 29: 0.25 vs 0.53


def test_neighbouring_squares_join_without_a_seam():
    from ocean.hdrender import MARGIN, READ, draw
    big = _faceted(n=READ * 2 + 2 * MARGIN)
    res = np.full((READ + 2 * MARGIN,) * 2, 16.0, np.float32)
    left = draw(big[:READ + 2 * MARGIN, :READ + 2 * MARGIN], res, 16, 33.7, MARGIN, lines=False)
    right = draw(big[:READ + 2 * MARGIN, READ:2 * READ + 2 * MARGIN], res, 16, 33.7, MARGIN, lines=False)
    jump = np.abs(left[:, -1, :3].astype(int) - right[:, 0, :3].astype(int)).mean()
    inside = np.abs(left[:, -2, :3].astype(int) - left[:, -1, :3].astype(int)).mean()
    assert jump <= inside + 1.5                                  # the edge looks like any other pixel step


def test_fine_survey_keeps_its_detail():
    from ocean.hdrender import smooth_by_resolution
    a = np.zeros((200, 200)); a[:, 100:] = np.sin(np.arange(100) * 2 * np.pi / 16)[None, :]   # 16 m sand waves, right half
    res = np.full(a.shape, 2.0); res[:, :100] = 16.0
    out = smooth_by_resolution(-10 + a * 0.0 + a, res, 1.0)
    fine = out[:, 140:180].std(); assert fine > 0.4               # fine 2 m survey: sand waves kept
    coarse = smooth_by_resolution(-10 + a, np.full(a.shape, 16.0), 1.0)[:, 140:180].std()
    assert coarse < fine / 3                                      # a coarse survey would smooth them away


def test_preview_sheet_is_a_picture():
    from ocean.bottomhd import preview_sheet
    img = np.zeros((512, 512, 4), np.uint8); img[..., 2] = 200; img[..., 3] = 255
    data = preview_sheet([{"name": "Test spot", "res": "8 m", "imgs": [img, img, img, None]}], "title")
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 1000


def test_surveys_feather_instead_of_a_cliff():
    from ocean.bottomhd import blend_surveys
    fine = np.full((100, 200), -20.0, np.float32); fine[:, 120:] = np.nan          # 4 m survey on the left
    coarse = np.full((100, 200), -20.8, np.float32)                                 # 16 m survey reads 0.8 m deeper
    dem, res = blend_surveys([(fine, 4.0), (coarse, 16.0)], 1.0, (100, 200))
    steps = np.abs(np.diff(dem[50]))
    assert steps.max() < 0.05                                    # no sudden 0.8 m step (it ramps over ~48 m)
    assert dem[50, 10] == -20.0 and abs(dem[50, 150] + 20.8) < 1e-6
    assert res[50, 10] == 4.0 and res[50, 150] == 16.0


def test_whole_socal_build_runs_block_by_block_and_keeps_going():
    import json, os
    import ocean.bottomhd as B
    from ocean.tiles import pixel_lonlat
    class Store:
        def __init__(self): self.d = {}
        def get(self, k): return self.d.get(k)
        def put(self, k, v, ct=None): self.d[k] = v
        def url(self, k): return "https://data.example/" + k
    class R:
        content = b""
        def raise_for_status(self): pass
    class Http:
        def get(self, *a, **k): return R()
    made = []
    class FakeSurveys:
        def __init__(self, items, folder, http, log): made.append(len(items))
        def square(self, z, x, y):
            lon, lat = pixel_lonlat(z, x, y)
            return (-(20 + (34.0 - lat) * 900)).astype("float32")
        def close(self): pass
    keep = (B.Surveys, B.latest_scheme_key, B.scheme_tiles, B.AREAS.get("tiny"), B.AREA_ZOOMS.get("tiny"))
    B.Surveys, B.latest_scheme_key = FakeSurveys, (lambda http: "BlueTopo/x.gpkg")
    B.scheme_tiles = lambda gpkg, bbox: [{"tile": "T1", "url": "u", "res_m": 8.0, "bounds": (-118.52, 33.38, -118.47, 33.43)}]
    B.AREAS["tiny"] = (-118.52, 33.38, -118.47, 33.43); B.AREA_ZOOMS["tiny"] = (12, 13)
    cwd = os.getcwd(); import tempfile; os.chdir(tempfile.mkdtemp())
    try:
        st = Store()
        B.run(st, "tiny", Http(), log=lambda *a: None, budget_s=-1)          # no time at all: stops, asks for another run
        assert os.path.exists("bottomhd-continue.txt")
        B.run(st, "tiny", Http(), log=lambda *a: None)                       # finishes
        assert not os.path.exists("bottomhd-continue.txt")
        m = json.loads(st.get("manifests/bottomhd-tiny.json"))
        assert m["key"] == "bottomhd_tiny" and m["complete"] and m["maxzoom"] == 13 and m["minzoom"] == B.OVERVIEW_Z
        assert any(k.startswith(f"tiles/bottomhd/tiny/{B.HD_VERSION}/{B.OVERVIEW_Z}/") for k in st.d)     # zoomed-out squares exist
        from PIL import Image; import io as _io
        z6 = next(v for k, v in st.d.items() if k.startswith(f"tiles/bottomhd/tiny/{B.HD_VERSION}/{B.OVERVIEW_Z}/"))
        assert Image.open(_io.BytesIO(z6)).size == (512, 512)
        st.d["manifests/bottomhd-tiny.json"] = json.dumps({**m, "minzoom": 12}).encode()
        assert B.overview_only(st, "tiny", log=lambda *a: None)
        assert json.loads(st.get("manifests/bottomhd-tiny.json"))["minzoom"] == B.OVERVIEW_Z
        assert any(k.startswith("tiles/bottomhd/tiny/") and k.endswith(".png") for k in st.d) and made
    finally:
        os.chdir(cwd)
        B.Surveys, B.latest_scheme_key, B.scheme_tiles = keep[0], keep[1], keep[2]
        B.AREAS.pop("tiny", None); B.AREA_ZOOMS.pop("tiny", None)


def _tin(depth_m, n=656, px=2.4, edge_m=180.0, seed=4):
    """Deep water the way NOAA often fills it: scattered soundings joined by flat triangles."""
    import numpy as np
    from scipy.interpolate import LinearNDInterpolator
    rng = np.random.default_rng(seed)
    L = n * px
    k = int((L / edge_m) ** 2 * 2) + 50
    P = rng.random((k, 2)) * L * 1.2 - L * 0.1
    D = -(depth_m + P[:, 0] * 0.02 + rng.normal(0, depth_m * 0.04, k))
    yy, xx = np.mgrid[0:n, 0:n] * px
    return LinearNDInterpolator(P, D)(xx, yy).astype(np.float32)


def _creases(img):
    """The sharpest brightness steps (the edges of the triangles): 99th percentile of the brightness gradient."""
    import numpy as np
    lum = img[..., :3].astype(np.float64).mean(axis=2)
    return float(np.percentile(np.hypot(*np.gradient(lum)), 99))


def test_v6_melts_deep_water_triangles_but_keeps_shallow_reefs():
    import numpy as np
    import ocean.hdrender as H
    from ocean.hdrender import MARGIN
    z, lat = 15, 33.6
    deep = _tin(270.0)
    res = np.full(deep.shape, 16.0, np.float32)
    keep = (H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE)
    try:
        H.DEEP_COLOR = H.DEEP_SHADE = H.DEEP_LINE = 0.0
        before = _creases(H.draw(deep, res, z, lat, MARGIN, lines=False))
        H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE = keep
        after = _creases(H.draw(deep, res, z, lat, MARGIN, lines=False))
    finally:
        H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE = keep
    assert after < before * 0.5, (before, after)
    # a shallow reef ledge (10 m) is barely touched: the extra smoothing there is ~1 m
    reef = _faceted(res_m=2.0, n=deep.shape[0], px=1.0)
    r2 = np.full(reef.shape, 2.0, np.float32)
    a = H.draw(reef, r2, 17, lat, MARGIN, lines=False)[..., :3].astype(float).std()
    H.DEEP_COLOR = H.DEEP_SHADE = H.DEEP_LINE = 0.0
    try:
        b = H.draw(reef, r2, 17, lat, MARGIN, lines=False)[..., :3].astype(float).std()
    finally:
        H.DEEP_COLOR, H.DEEP_SHADE, H.DEEP_LINE = keep
    assert a > b * 0.8, (a, b)


def test_v6_fills_pinholes_but_not_real_gaps():
    import numpy as np
    import ocean.hdrender as H
    d = np.full((H.READ + 2 * H.MARGIN,) * 2, -200.0, np.float32)
    d[::2, ::2] = np.nan                       # sparse cells: used to show as a see-through checkerboard
    d[:, :100] = np.nan                        # a real no-data area stays clear
    a = H.draw(d, np.full(d.shape, 16.0, np.float32), 15, 33.6, H.MARGIN, lines=False)[..., 3]
    assert a[100:400, 200:400].min() == 255 and a[10:400, 0:20].max() == 0
