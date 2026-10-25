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
