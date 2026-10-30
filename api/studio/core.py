"""Channel Nav Map Studio — the drawing side (no web server here, so it's tested on its own).

Everything the Studio shows is made on this computer, straight from NOAA:
  · HD bottom squares: drawn live from NOAA BlueTopo surveys with any look ("style") — same code the app's builder uses
  · chart squares: from the Channel Nav chart helper (same addresses the app uses), with the Studio's chart settings
  · snapshots: the map as one picture (background water, Mexico land, NOAA depth lines, chart, HD bottom) — what
    Claude looks at when you ask it to judge or fix something
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
import re
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HOME = os.path.expanduser(os.environ.get("STUDIO_HOME", "~/.channelnav-studio"))
SURVEYS_DIR = os.path.join(HOME, "bluetopo")
STATE_FILE = os.path.join(HOME, "state.json")
REPO_STUDIO = os.path.dirname(os.path.abspath(__file__))
SPOTS_FILE = os.path.join(REPO_STUDIO, "spots.json")
NOTES_FILE = os.path.join(REPO_STUDIO, "notes-for-developer.md")
CHART_HELPER = os.environ.get("CHART_HELPER", "https://channelnav-chart.bclegalservices.workers.dev")
API_URL = os.environ.get("API_URL", "https://fishing-app-api-pzto.onrender.com")
HD_MIN_Z, HD_MAX_Z = 11, 18
SURVEY_CACHE_GB = float(os.environ.get("STUDIO_SURVEY_GB", "12"))

# ---------------------------------------------------------------- chart look (what the app's map uses)
CHART_DEFAULT = {
    "water": "#AADAFF",        # map water (light themes)
    "land": "#F2EEE3",         # Mexico land fill under the chart
    "look": "clean",           # clean | standard | full  (how busy NOAA's chart is)
    "depths": True,            # NOAA depth lines & numbers layer
    "depthsFull": False,       # all depth numbers at every zoom (busy)
    "lightCircles": False,     # lighthouse color circles
    "simpleSymbols": False,    # simplified buoy symbols
    "night": False,            # NOAA night colors
    "dlw": 15000,              # zoomed out: lines only (no numbers) when a square is wider than this (m); 0 = never
    "daw": 7500,               # lines + numbers from every chart when wider than this (m); 0 = never
    "details": ["navaids", "lanes", "seabed", "areas"],   # chart groups shown with look=standard/full in the app
}
DETAIL_LAYER = {"seabed": 3, "lanes": 4, "areas": 5, "navaids": 6, "services": 7}
LOOK_DETAILS = {"clean": [], "standard": ["navaids", "lanes", "seabed", "areas"], "full": ["navaids", "lanes", "seabed", "areas", "services"]}


def chart_resolve(c: dict | None) -> dict:
    out = dict(CHART_DEFAULT)
    for k, v in (c or {}).items():
        if k in ("water", "land") and isinstance(v, str) and re.fullmatch(r"#?[0-9a-fA-F]{6}", v):
            out[k] = "#" + v.lstrip("#").upper()
        elif k == "look" and v in LOOK_DETAILS:
            out[k] = v
        elif k in ("depths", "depthsFull", "lightCircles", "simpleSymbols", "night"):
            out[k] = bool(v)
        elif k in ("dlw", "daw"):
            try:
                out[k] = max(0, int(float(v)))
            except (TypeError, ValueError):
                pass
    out["details"] = LOOK_DETAILS[out["look"]]
    return out


def chart_urls(c: dict) -> tuple[str, str | None]:
    """The same tile addresses the app builds (config.ts), with {bbox} to fill in."""
    c = chart_resolve(c)
    ids = sorted([0, 1] + [DETAIL_LAYER[d] for d in c["details"]])
    common = f"ls={2 if c['lightCircles'] else 1}&cs={2 if c['night'] else 0}"
    chart = f"{CHART_HELPER}/chart?bbox={{bbox}}&layers={','.join(map(str, ids))}&{common}&ps={1 if c['simpleSymbols'] else 2}&look={c['look']}&hd=1&v=w2"
    depth = None
    if c["depths"]:
        depth = (f"{CHART_HELPER}/chart?bbox={{bbox}}&layers=2&{common}&ps=2&look={'depthsfull' if c['depthsFull'] else 'depths'}&hd=1&v=d2"
                 f"&dlw={c['dlw']}&daw={c['daw']}")
    return chart, depth


# ---------------------------------------------------------------- styles (HD bottom looks)
STYLES: dict[str, dict] = {}


def style_id(style: dict) -> str:
    from ocean.hdrender import resolve
    st = resolve(style)
    sid = hashlib.sha1(json.dumps(st, sort_keys=True).encode()).hexdigest()[:10]
    STYLES[sid] = st
    return sid


# ---------------------------------------------------------------- web-map math
EARTH = 40075016.685578488


def tile_bbox_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    size = EARTH / n
    x0 = -EARTH / 2 + x * size
    y1 = EARTH / 2 - y * size
    return x0, y1 - size, x0 + size, y1


def lonlat_to_world(lon: float, lat: float, z: float) -> tuple[float, float]:
    """Pixel position at zoom z with 256-pixel squares (like the map)."""
    n = 256 * 2 ** z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(max(-85, min(85, lat))))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


# ---------------------------------------------------------------- NOAA surveys (downloaded once, kept on this computer)
class SurveyBank:
    def __init__(self, http, log=print):
        self.http, self.log = http, log
        self.items: list[dict] | None = None
        self.lock = threading.RLock()
        self.open: "OrderedDict[tuple, object]" = OrderedDict()
        self.downloading = 0
        self.index_error: str | None = None

    def _index(self) -> list[dict]:
        if self.items is not None:
            return self.items
        from ocean.bottomhd import AREAS, BUCKET, latest_scheme_key, scheme_tiles
        os.makedirs(SURVEYS_DIR, exist_ok=True)
        cache = os.path.join(HOME, "bluetopo-index.json")
        if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < 7 * 86400:
            self.items = json.load(open(cache))
            return self.items
        try:
            key = latest_scheme_key(self.http)
            r = self.http.get(f"{BUCKET}/{key}", timeout=120); r.raise_for_status()
            w, s, e, n = AREAS["socal"]
            self.items = scheme_tiles(r.content, (w - 0.3, s - 0.3, e + 0.3, n + 0.3))
            for it in self.items:
                it["bounds"] = list(it["bounds"])
            json.dump(self.items, open(cache, "w"))
        except Exception as e:                    # offline: whatever we had
            self.index_error = f"{type(e).__name__}: {str(e)[:120]}"
            self.items = json.load(open(cache)) if os.path.exists(cache) else []
        return self.items

    def _trim(self):
        files = [os.path.join(SURVEYS_DIR, f) for f in os.listdir(SURVEYS_DIR)]
        total = sum(os.path.getsize(f) for f in files) / 1e9
        if total <= SURVEY_CACHE_GB:
            return
        in_use = {os.path.basename(p) for sv in self.open.values() for p in getattr(sv, "_paths", [])}
        for f in sorted(files, key=os.path.getmtime):
            if os.path.basename(f) in in_use:
                continue
            total -= os.path.getsize(f) / 1e9
            os.unlink(f)
            if total <= SURVEY_CACHE_GB * 0.7:
                break

    def square(self, z: int, x: int, y: int):
        """(depth m, survey cell m, margin px) for one map square, or None where NOAA has no survey."""
        from ocean.bottomhd import Surveys
        from ocean.hdrender import MARGIN, READ
        from ocean.tiles import tile_bounds
        w, s, e, n = tile_bounds(z, x, y)
        mg = (e - w) * (MARGIN / READ + 0.02)
        with self.lock:
            here = [it for it in self._index() if not (it["bounds"][2] < w - mg or it["bounds"][0] > e + mg
                                                       or it["bounds"][3] < s - mg or it["bounds"][1] > n + mg)]
            if not here:
                return None
            key = tuple(sorted(it["tile"] for it in here))
            sv = self.open.get(key)
            if sv is None:
                self.downloading += 1
                try:
                    sv = Surveys(here, SURVEYS_DIR, self.http, log=lambda *a: None)
                    sv._paths = [re.sub(r"[^\w.-]", "_", it["tile"]) + ".tif" for it in here]
                finally:
                    self.downloading -= 1
                self.open[key] = sv
                while len(self.open) > 8:
                    _, old = self.open.popitem(last=False)
                    old.close()
                self._trim()
            else:
                self.open.move_to_end(key)
            dem, res = sv.square(z, x, y)
        return dem, res, MARGIN


# ---------------------------------------------------------------- the Studio
class Studio:
    def __init__(self, http, log=print):
        self.http, self.log = http, log
        self.bank = SurveyBank(http, log)
        self.hd_cache: "OrderedDict[tuple, bytes | None]" = OrderedDict()
        self.hd_lock = threading.Lock()
        self.pool = ThreadPoolExecutor(max_workers=8)
        os.makedirs(HOME, exist_ok=True)
        self.state = {
            "hdA": {}, "hdB": {},                 # A = what the app uses now, B = your changes
            "chartA": {}, "chartB": {},
            "view": {"lat": 33.62, "lon": -118.33, "zoom": 12.0},
            "show": {"hd": True, "chart": True},
            "ab": "B",
            "published_at": {},
        }
        try:
            saved = json.load(open(STATE_FILE))
            self.state.update({k: v for k, v in saved.items() if k in self.state})
        except Exception:
            pass
        self.fetch_published()

    # ---- state
    def save(self):
        try:
            json.dump(self.state, open(STATE_FILE, "w"), indent=1)
        except Exception:
            pass

    def public_state(self) -> dict:
        from ocean.hdrender import resolve
        st = self.state
        return {**st, "hdA": resolve(st["hdA"]), "hdB": resolve(st["hdB"]), "chartA": chart_resolve(st["chartA"]),
                "chartB": chart_resolve(st["chartB"]), "sidA": style_id(st["hdA"]), "sidB": style_id(st["hdB"]),
                "urlsA": chart_urls(st["chartA"]), "urlsB": chart_urls(st["chartB"]),
                "downloading": self.bank.downloading, "index_error": self.bank.index_error}

    def fetch_published(self):
        """A = the looks the app uses right now (saved with Send to app), read from the app's server."""
        for key, slot in (("hd_style", "hdA"), ("map_style", "chartA")):
            try:
                r = self.http.get(f"{API_URL}/config/{key}", timeout=60)
                if r.status_code == 200:
                    v = r.json().get("value") or {}
                    if isinstance(v, dict) and "style" in v:
                        v = v["style"]
                    self.state[slot] = v if isinstance(v, dict) else {}
                    self.state["published_at"][key] = r.json().get("updated_at")
            except Exception as e:
                self.log(f"studio: couldn't read {key} from the app server ({type(e).__name__}) — using the saved copy")

    def set_hd(self, changes: dict, which: str = "B") -> dict:
        from ocean.hdrender import STYLE_KEYS, resolve
        cur = resolve(self.state["hd" + which])
        for k, v in (changes or {}).items():
            if k in STYLE_KEYS or k == "COLORS":
                cur[k] = v
        self.state["hd" + which] = resolve(cur)
        self.save()
        return self.state["hd" + which]

    def set_chart(self, changes: dict, which: str = "B") -> dict:
        cur = chart_resolve(self.state["chart" + which])
        cur.update(changes or {})
        self.state["chart" + which] = chart_resolve(cur)
        self.save()
        return self.state["chart" + which]

    def set_view(self, lat=None, lon=None, zoom=None):
        v = self.state["view"]
        if lat is not None:
            v["lat"] = float(lat)
        if lon is not None:
            v["lon"] = float(lon)
        if zoom is not None:
            v["zoom"] = max(5.0, min(18.0, float(zoom)))
        self.save()

    # ---- HD squares
    def hd_png(self, sid: str, z: int, x: int, y: int) -> bytes | None:
        style = STYLES.get(sid)
        if style is None or z < HD_MIN_Z or z > HD_MAX_Z:
            return None
        k = (sid, z, x, y)
        with self.hd_lock:
            if k in self.hd_cache:
                self.hd_cache.move_to_end(k)
                return self.hd_cache[k]
        got = self.bank.square(z, x, y)
        data = None
        if got is not None:
            from ocean.bottomhd import png
            from ocean.hdrender import draw
            from ocean.tiles import tile_bounds
            dem, res, pad = got
            w, s, e, n = tile_bounds(z, x, y)
            img = draw(dem, res, z, (s + n) / 2, pad, style=style)
            data = None if img is None else png(img)
        with self.hd_lock:
            self.hd_cache[k] = data
            while len(self.hd_cache) > 3000:
                self.hd_cache.popitem(last=False)
        return data

    # ---- chart squares (from the chart helper)
    def fetch_tile(self, template: str, z: int, x: int, y: int):
        from PIL import Image
        bbox = ",".join(f"{v:.2f}" for v in tile_bbox_3857(z, x, y))
        try:
            r = self.http.get(template.replace("{bbox}", bbox), timeout=60)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
                return Image.open(io.BytesIO(r.content)).convert("RGBA")
        except Exception:
            pass
        return None

    # ---- a picture of the map, like the phone shows it
    def snapshot(self, which: str = "B", view: dict | None = None, size=(1000, 760)) -> bytes:
        """The map at `view` with look A or B, as a PNG (2× sharp, like a phone): water → Mexico land → NOAA depth
        lines → chart → HD bottom. This is what Claude looks at."""
        from PIL import Image, ImageDraw
        v = dict(self.state["view"], **(view or {}))
        chart = chart_resolve(self.state["chart" + which])
        sid = style_id(self.state["hd" + which])
        W, H = size
        zi = int(round(v["zoom"]))
        scale = 2 ** (v["zoom"] - zi)          # map zoom between whole levels: stretch a little
        # draw at zoom zi with 512 px per square (= the phone at 2×), then scale to the fractional zoom
        cx, cy = lonlat_to_world(v["lon"], v["lat"], zi)
        cx, cy = cx * 2, cy * 2                 # 512 px squares
        w0, h0 = int(W / scale) + 2, int(H / scale) + 2
        left, top = cx - w0 / 2, cy - h0 / 2
        canvas = Image.new("RGBA", (w0, h0), chart["water"])
        # Mexico land
        try:
            from studio.land import MEXICO_LAND
            pts = []
            for lon, lat in MEXICO_LAND:
                px, py = lonlat_to_world(lon, lat, zi)
                pts.append((px * 2 - left, py * 2 - top))
            ImageDraw.Draw(canvas).polygon(pts, fill=chart["land"])
        except Exception:
            pass
        tiles = [(zi, tx, ty) for tx in range(int(left // 512), int((left + w0) // 512) + 1)
                 for ty in range(int(top // 512), int((top + h0) // 512) + 1)]
        chart_t, depth_t = chart_urls(chart)
        jobs = {}
        for t in tiles:
            if self.state["show"].get("chart", True):
                if depth_t:
                    jobs[("d",) + t] = self.pool.submit(self.fetch_tile, depth_t, *t)
                jobs[("c",) + t] = self.pool.submit(self.fetch_tile, chart_t, *t)
            if self.state["show"].get("hd", True) and HD_MIN_Z <= zi <= HD_MAX_Z:
                jobs[("h",) + t] = self.pool.submit(self.hd_png, sid, *t)
        for layer in ("d", "c", "h"):
            for t in tiles:
                f = jobs.get((layer,) + t)
                if f is None:
                    continue
                try:
                    im = f.result(timeout=240)
                except Exception:
                    im = None
                if im is None:
                    continue
                if isinstance(im, bytes):
                    im = Image.open(io.BytesIO(im)).convert("RGBA")
                im = im.resize((512, 512))
                canvas.alpha_composite(im, (int(t[1] * 512 - left), int(t[2] * 512 - top)))
        if scale != 1:
            canvas = canvas.resize((int(w0 * scale), int(h0 * scale)), Image.BILINEAR)
        out = canvas.crop(((canvas.width - W) // 2, (canvas.height - H) // 2, (canvas.width - W) // 2 + W, (canvas.height - H) // 2 + H))
        buf = io.BytesIO()
        out.convert("RGB").save(buf, "PNG", optimize=True)
        return buf.getvalue()

    def check_sheet(self, spots: list[dict]) -> bytes:
        """Every test spot, A (app now) next to B (your changes), in one picture."""
        from PIL import Image, ImageDraw, ImageFont
        cw, ch, gap, head = 520, 400, 10, 40
        rows = []
        for sp in spots:
            view = {"lat": sp["lat"], "lon": sp["lon"], "zoom": sp.get("zoom", 13)}
            a = Image.open(io.BytesIO(self.snapshot("A", view, (cw, ch))))
            b = Image.open(io.BytesIO(self.snapshot("B", view, (cw, ch))))
            rows.append((sp, a, b))
        sheet = Image.new("RGB", (cw * 2 + gap * 3, head + len(rows) * (ch + 34 + gap) + gap), "white")
        d = ImageDraw.Draw(sheet)
        try:
            f = ImageFont.truetype("DejaVuSans-Bold.ttf", 16)
        except Exception:
            f = ImageFont.load_default()
        d.text((gap, 10), "A = in the app now", fill=(20, 20, 20), font=f)
        d.text((cw + gap * 2, 10), "B = your changes", fill=(200, 20, 150), font=f)
        yy = head
        for sp, a, b in rows:
            d.text((gap, yy), f"{sp['name']}  (zoom {sp.get('zoom', 13)})", fill=(20, 20, 20), font=f)
            sheet.paste(a, (gap, yy + 26)); sheet.paste(b, (cw + gap * 2, yy + 26))
            yy += ch + 34 + gap
        buf = io.BytesIO()
        sheet.save(buf, "PNG", optimize=True)
        return buf.getvalue()


# ---------------------------------------------------------------- spots + notes
def load_spots() -> list[dict]:
    try:
        return json.load(open(SPOTS_FILE))
    except Exception:
        return []


def save_spots(spots: list[dict]) -> None:
    json.dump(spots, open(SPOTS_FILE, "w"), indent=1)


def add_note(text: str) -> None:
    new = not os.path.exists(NOTES_FILE)
    with open(NOTES_FILE, "a") as fh:
        if new:
            fh.write("# Notes for the developer (from Map Studio)\n\nThings that need a code change — send this file to Claude.\n\n")
        fh.write(f"- {time.strftime('%Y-%m-%d %H:%M')} — {text.strip()}\n")


def b64(png_bytes: bytes) -> str:
    return base64.b64encode(png_bytes).decode()
