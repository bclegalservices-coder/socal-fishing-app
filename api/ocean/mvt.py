"""Tiny Mapbox Vector Tile (MVT v2) writer + reader for line features — enough for depth contour tiles.

Why vector tiles: a contour line sent as a picture turns into fat, jagged blocks when the map enlarges it. Sent as
coordinates, the phone draws the line itself at every zoom: always thin, smooth and sharp (how Navionics does it).
Spec: https://github.com/mapbox/vector-tile-spec/tree/master/2.1 (no extra packages needed).
"""
from __future__ import annotations

EXTENT = 4096


# ------------------------------------------------------------------ protobuf basics

def _varint(n: int) -> bytes:
    out = bytearray()
    n &= (1 << 64) - 1
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field: int, wire: int) -> bytes:
    return _varint((field << 3) | wire)


def _bytes(field: int, data: bytes) -> bytes:
    return _key(field, 2) + _varint(len(data)) + data


def _uint(field: int, n: int) -> bytes:
    return _key(field, 0) + _varint(n)


def _packed(field: int, nums) -> bytes:
    return _bytes(field, b"".join(_varint(n) for n in nums))


def _zz(n: int) -> int:
    return (n << 1) ^ (n >> 63)


# ------------------------------------------------------------------ writer

def _geometry(lines) -> list[int]:
    """Command list for one or more polylines (each a list of (x, y) tile coords). Repeated points are dropped."""
    cmds: list[int] = []
    cx = cy = 0
    for line in lines:
        pts = []
        for x, y in line:
            p = (int(round(x)), int(round(y)))
            if not pts or p != pts[-1]:
                pts.append(p)
        if len(pts) < 2:
            continue
        x0, y0 = pts[0]
        cmds += [(1 & 7) | (1 << 3), _zz(x0 - cx), _zz(y0 - cy)]
        cx, cy = x0, y0
        cmds.append((2 & 7) | ((len(pts) - 1) << 3))
        for x, y in pts[1:]:
            cmds += [_zz(x - cx), _zz(y - cy)]
            cx, cy = x, y
    return cmds


def encode_lines(layer: str, features: list[dict], extent: int = EXTENT) -> bytes:
    """features: [{"lines": [[(x, y), ...], ...], "props": {name: int >= 0 | str}}] → MVT tile bytes ('' if empty)."""
    keys: list[str] = []
    vals: list = []
    kidx: dict = {}
    vidx: dict = {}
    feats = b""
    fid = 0
    for f in features:
        geom = _geometry(f["lines"])
        if not geom:
            continue
        tags = []
        for k, v in f.get("props", {}).items():
            if k not in kidx:
                kidx[k] = len(keys); keys.append(k)
            vk = (type(v).__name__, v)
            if vk not in vidx:
                vidx[vk] = len(vals); vals.append(v)
            tags += [kidx[k], vidx[vk]]
        fid += 1
        body = _uint(1, fid) + _packed(2, tags) + _uint(3, 2) + _packed(4, geom)
        feats += _bytes(2, body)
    if not fid:
        return b""
    lay = _uint(15, 2) + _bytes(1, layer.encode())
    lay += feats
    for k in keys:
        lay += _bytes(3, k.encode())
    for v in vals:
        if isinstance(v, str):
            lay += _bytes(4, _bytes(1, v.encode()))
        elif isinstance(v, bool):
            lay += _bytes(4, _uint(7, int(v)))
        else:
            lay += _bytes(4, _uint(5, int(v)))          # uint_value (all our numbers are whole and >= 0)
    lay += _uint(5, extent)
    return _bytes(3, lay)


# ------------------------------------------------------------------ reader (tests and checks)

def _read_varint(b: bytes, i: int):
    n = shift = 0
    while True:
        c = b[i]; i += 1
        n |= (c & 0x7F) << shift
        if c < 0x80:
            return n, i
        shift += 7


def _fields(b: bytes):
    i = 0
    while i < len(b):
        k, i = _read_varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = _read_varint(b, i)
        elif w == 2:
            ln, i = _read_varint(b, i); v = b[i:i + ln]; i += ln
        elif w == 5:
            v = b[i:i + 4]; i += 4
        elif w == 1:
            v = b[i:i + 8]; i += 8
        else:
            raise ValueError(f"wire type {w}")
        yield f, w, v


def _unpack(b: bytes):
    out, i = [], 0
    while i < len(b):
        v, i = _read_varint(b, i); out.append(v)
    return out


def decode(data: bytes) -> dict:
    """{layer name: {"extent": n, "features": [{"props": {...}, "lines": [[(x, y), ...]]}]}}"""
    out = {}
    for f, _, lay in _fields(data):
        if f != 3:
            continue
        name, extent, keys, vals, raw = "", 4096, [], [], []
        for lf, _, v in _fields(lay):
            if lf == 1:
                name = v.decode()
            elif lf == 5:
                extent = v
            elif lf == 3:
                keys.append(v.decode())
            elif lf == 4:
                for vf, _, vv in _fields(v):
                    vals.append(vv.decode() if vf == 1 else bool(vv) if vf == 7 else vv)
            elif lf == 2:
                raw.append(v)
        feats = []
        for fb in raw:
            tags, geom, gtype = [], [], 0
            for ff, _, v in _fields(fb):
                if ff == 2:
                    tags = _unpack(v)
                elif ff == 4:
                    geom = _unpack(v)
                elif ff == 3:
                    gtype = v
            props = {keys[tags[j]]: vals[tags[j + 1]] for j in range(0, len(tags), 2)}
            lines, i, cx, cy = [], 0, 0, 0
            unz = lambda n: (n >> 1) ^ -(n & 1)      # noqa: E731
            while i < len(geom):
                cid, cnt = geom[i] & 7, geom[i] >> 3; i += 1
                for _ in range(cnt):
                    cx += unz(geom[i]); cy += unz(geom[i + 1]); i += 2
                    if cid == 1:
                        lines.append([(cx, cy)])
                    else:
                        lines[-1].append((cx, cy))
            feats.append({"type": gtype, "props": props, "lines": lines})
        out[name] = {"extent": extent, "features": feats}
    return out
