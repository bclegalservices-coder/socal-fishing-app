"""Marching squares on a regular lat/lon grid -> line segments in lon/lat."""
import numpy as np


def segments(lats: np.ndarray, lons: np.ndarray, z: np.ndarray, level: float):
    """Yield ((lon1, lat1), (lon2, lat2), i, j) for every cell the level crosses. NaN cells are skipped."""
    a = z[:-1, :-1]; b = z[:-1, 1:]; c = z[1:, 1:]; d = z[1:, :-1]
    valid = ~(np.isnan(a) | np.isnan(b) | np.isnan(c) | np.isnan(d))
    k = ((a > level) * 8 + (b > level) * 4 + (c > level) * 2 + (d > level) * 1)
    cells = np.argwhere(valid & (k != 0) & (k != 15))
    for i, j in cells:
        va, vb, vc, vd = a[i, j], b[i, j], c[i, j], d[i, j]
        y0, y1, x0, x1 = lats[i], lats[i + 1], lons[j], lons[j + 1]

        def lerp(p, q, vp, vq):
            t = 0.5 if vq == vp else (level - vp) / (vq - vp)
            return p + (q - p) * t

        T = (lerp(x0, x1, va, vb), y0)
        R = (x1, lerp(y0, y1, vb, vc))
        B = (lerp(x0, x1, vd, vc), y1)
        L = (x0, lerp(y0, y1, va, vd))
        kk = int(k[i, j])
        pairs = {1: [(L, B)], 14: [(L, B)], 2: [(B, R)], 13: [(B, R)], 3: [(L, R)], 12: [(L, R)],
                 4: [(T, R)], 11: [(T, R)], 6: [(T, B)], 9: [(T, B)], 7: [(L, T)], 8: [(L, T)],
                 5: [(L, T), (B, R)], 10: [(T, R), (L, B)]}[kk]
        for p, q in pairs:
            yield p, q, i, j


def to_multiline(segs) -> list:
    return [[[round(p[0], 5), round(p[1], 5)], [round(q[0], 5), round(q[1], 5)]] for p, q in segs]
