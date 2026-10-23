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
