"""Nov 12: new bottom (v7): smooth pictures without baked lines + vector contour tiles, model fills survey gaps."""
import json

import numpy as np

from ocean import bottom2 as B
from ocean.mvt import decode, encode_lines


def test_mvt_round_trip():
    data = encode_lines("contours", [{"lines": [[(0, 0), (10, 5), (10, 5), (40, 9)], [(100, 100), (90, 120)]], "props": {"lv": 60, "major": 0}},
                                     {"lines": [[(5, 5)]], "props": {"lv": 1}}])          # single point: dropped
    t = decode(data)["contours"]
    assert t["extent"] == 4096 and len(t["features"]) == 1
    f = t["features"][0]
    assert f["type"] == 2 and f["props"] == {"lv": 60, "major": 0}
    assert f["lines"] == [[(0, 0), (10, 5), (40, 9)], [(100, 100), (90, 120)]]
    assert encode_lines("contours", []) == b""


def _slope(n=512, pad=0, top=-2.0, per_px=-0.08, land_rows=0):
    yy = np.mgrid[0:n + 2 * pad, 0:n + 2 * pad][0].astype(np.float32)
    dem = top + yy * per_px                          # deeper going down the square
    if land_rows:
        dem[:land_rows] = 3.0
    return dem.astype(np.float32)


def test_contour_tile_has_levels_flags_and_stays_in_buffer():
    from ocean.hdrender import MARGIN
    dem = _slope(pad=MARGIN, per_px=-0.15)
    res = np.full(dem.shape, 4.0, np.float32)
    data = B.contour_tile(dem, res, MARGIN, 14, 33.6)
    feats = decode(data)["contours"]["features"]
    lvs = {f["props"]["lv"] for f in feats}
    assert {50, 60, 100, 200}.issubset(lvs) and 45 in lvs
    for f in feats:
        p = f["props"]
        assert p["major"] == int(B.is_major(p["lv"])) and p["std"] == int(B.is_std(p["lv"]))
        assert 14 <= p["minz"] <= B.LAST_Z
        for line in f["lines"]:
            xs = [x for x, _ in line]; ys = [y for _, y in line]
            assert min(xs) >= -B.BUFFER and max(xs) <= 4096 + B.BUFFER and min(ys) >= -B.BUFFER and max(ys) <= 4096 + B.BUFFER
    # lines run across the square (left to right) for a slope that deepens downward
    long = max((max(x for x, _ in l) - min(x for x, _ in l)) for f in feats for l in f["lines"])
    assert long > 3000


def test_steep_wall_holds_back_fine_lines_until_zoomed_in():
    from ocean.hdrender import MARGIN
    dem = _slope(pad=MARGIN, per_px=-1.0, top=70.0)          # steep: ~3 ft per px (margin rows are land)
    res = np.full(dem.shape, 4.0, np.float32)
    feats = decode(B.contour_tile(dem, res, MARGIN, 14, 33.6))["contours"]["features"]
    five = [f["props"]["minz"] for f in feats if f["props"]["lv"] % 10 == 5]
    hundred = [f["props"]["minz"] for f in feats if f["props"]["lv"] % 100 == 0]
    assert five and hundred and min(five) > min(hundred)


def test_lower_zoom_lines_have_tile_zoom_and_std():
    dem = _slope(per_px=-0.6)
    res = np.full(dem.shape, 8.0, np.float32)
    feats = decode(B.contour_tile(dem, res, 0, 12, 33.6))["contours"]["features"]
    assert feats and all(f["props"]["minz"] == 12 and f["props"]["std"] == 1 for f in feats)
    assert all(f["props"]["lv"] in B.vec_levels(12) for f in feats)


def test_land_only_square_gives_nothing():
    dem = np.full((512, 512), 5.0, np.float32)
    assert B.contour_tile(dem, dem, 0, 13, 33.6) == b""


def test_model_fills_survey_gaps_and_feathers():
    dem = _slope(n=200, per_px=-0.1)
    dem[:, 120:] = np.nan                              # survey stops
    res = np.where(np.isfinite(dem), 4.0, np.nan).astype(np.float32)
    crm = np.full(dem.shape, -50.0, np.float32)
    crm[:5] = 10.0                                     # model's land
    d2, r2 = B.fill_gaps(dem, res, crm, pxm=5.0)
    assert np.isfinite(d2[10:, 125:]).all() and (d2[10:, 150:] == -50).all()
    assert (r2[10:, 150:] == B.CRM_RES_M).all()
    assert d2[3, 150] == 10.0                          # model land stays land
    # just inside the survey edge the two are mixed; far inside it's the survey untouched
    assert d2[100, 115] != dem[100, 115] and d2[100, 10] == dem[100, 10]


def test_build_tree_writes_pictures_and_line_tiles_every_zoom():
    from ocean.tiles import pixel_lonlat, tiles_for_bbox
    bbox = (-118.30, 33.60, -118.28, 33.62)

    def read(z, x, y):
        lon, lat = pixel_lonlat(z, x, y)
        return (-(5 + (33.62 - lat) * 4000)).astype(np.float32)
    got = {}
    put = lambda k, d, c: got.__setitem__(k, (d, c))   # noqa: E731
    stats = {"tiles": 0, "lines": 0}
    for z, x, y in tiles_for_bbox(bbox, 12):
        B.build_tree(read, put, z, x, y, bbox, stats, max_z=14)
    pngs = {int(k.split("/")[0]) for k in got if k.endswith(".png")}
    pbfs = {int(k.split("/")[1]) for k in got if k.endswith(".pbf")}
    assert pngs == {12, 13, 14} and pbfs == {12, 13, 14}
    assert all(c == "application/x-protobuf" for k, (d, c) in got.items() if k.endswith(".pbf"))
    # pictures have no baked lines: down one column the color changes smoothly (no dark line pixels)
    from PIL import Image
    import io
    k14 = next(k for k in got if k.startswith("14/") and k.endswith(".png"))
    im = np.asarray(Image.open(io.BytesIO(got[k14][0])).convert("RGBA")).astype(int)
    col = im[40:-40, 256, :3].sum(axis=1)
    assert np.abs(np.diff(col)).max() < 25


def test_manifest_points_at_its_own_folder():
    class S:
        def url(self, k): return "https://data.example/" + k
    m = B.manifest(S(), "tiles/bottom2/socal/v7", "202611120000", 3, 77, "")
    assert m["key"] == "bottom2" and m["complete"] is False and m["progress"] == "3/77"
    assert m["tiles"].startswith("https://data.example/tiles/bottom2/socal/v7/{z}/{x}/{y}.png")
    assert m["contours"].startswith("https://data.example/tiles/bottom2/socal/v7/c/{z}/{x}/{y}.pbf")
    assert m["contour_layer"] == "contours" and m["contour_minzoom"] == 10 and m["contour_maxzoom"] == 14
    assert "bottomhd" not in m["tiles"]                 # never overwrites the old HD bottom
    json.dumps(m)


def test_blocks_near_san_pedro_first():
    from ocean.tiles import lonlat_to_tile, tiles_for_bbox
    tops = B.order_blocks(list(tiles_for_bbox(B.AREAS["socal"], 10)))
    assert tops[0] == (10, *lonlat_to_tile(-118.27, 33.70, 10))
