"""Today's satellite passes (Nov 6): find passes, put them on the grid, newest wins, GOES fills gaps, each pass is
downloaded only once, preview vs on."""
import json
from datetime import datetime, timezone

import functools
import os

import numpy as np


class _MP:
    """Tiny stand-in for pytest's monkeypatch (tests.run calls tests with no arguments)."""
    def __init__(self): self.undo_list = []
    def setattr(self, obj, name, val):
        self.undo_list.append(lambda o=obj, n=name, v=getattr(obj, name): setattr(o, n, v)); setattr(obj, name, val)
    def setenv(self, k, v):
        old = os.environ.get(k); self.undo_list.append(lambda: os.environ.pop(k, None) if old is None else os.environ.__setitem__(k, old)); os.environ[k] = v
    def delenv(self, k, raising=False):
        old = os.environ.pop(k, None)
        if old is not None: self.undo_list.append(lambda: os.environ.__setitem__(k, old))
    def undo(self):
        for f in reversed(self.undo_list): f()


def _patched(fn):
    @functools.wraps(fn)
    def run():
        mp = _MP()
        try:
            fn(mp)
        finally:
            mp.undo()
    return run

BOX = (-121.0, 31.0, -116.6, 35.0)
NOW = datetime(2026, 11, 6, 22, 0, tzinfo=timezone.utc)


class _Store:
    def __init__(self): self.d = {}
    def get(self, k): return self.d.get(k)
    def put(self, k, v, ct=None): self.d[k] = v
    def url(self, k): return "https://x/" + k


class _R:
    def __init__(self, j): self._j, self.status_code = j, 200
    def json(self): return self._j
    def raise_for_status(self): pass


class _CMR:
    """Fake NASA catalog: 2 VIIRS chlorophyll passes today, GOES files for water temp."""
    def __init__(self, granules): self.granules, self.calls = granules, []
    def get(self, url, params=None):
        self.calls.append((url, params))
        if url.endswith("collections.json"):
            sn = params["short_name"].replace("*", "X")
            return _R({"feed": {"entry": [{"id": "C-" + sn, "short_name": sn, "version_id": "1"}]}})
        cid = params["collection_concept_id"]
        return _R({"feed": {"entry": [g for g in self.granules if g["_c"] in cid]}})


class _Resp:
    status_code = 200
    headers: dict = {}
    def __init__(self, content): self.content = content
    def raise_for_status(self): pass


def _gran(c, gid, at):
    return {"_c": c, "id": gid, "title": gid, "time_start": at, "links": [{"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": f"https://data.nasa.gov/{gid}.nc"}]}


def test_pixels_land_in_the_right_cells_and_chlorophyll_averages_on_a_log_scale():
    from ocean.passes import bin_pixels, target_grid
    lats, lons = target_grid(BOX)
    out = bin_pixels(lats, lons, np.array([33.0, 33.002, 34.5]), np.array([-118.0, -118.001, -120.0]), np.array([0.1, 10.0, 2.0]), log_space=True)
    i, j = np.argmin(abs(lats - 33.0)), np.argmin(abs(lons + 118.0))
    assert abs(out[i, j] - 1.0) < 1e-6                       # geometric mean of 0.1 and 10
    assert np.isfinite(out[np.argmin(abs(lats - 34.5)), np.argmin(abs(lons + 120.0))])
    assert np.isfinite(out).sum() == 2


@_patched
def test_newest_pass_wins_gaps_stay_open_and_each_pass_downloads_once(monkeypatch):
    from ocean import passes
    from ocean.passes import target_grid
    lats, lons = target_grid(BOX)
    monkeypatch_patterns = {"chl": ["VIIRSJ1_L2_OC_NRT"], "sst": [], "sst_fill": []}
    monkeypatch.setattr(passes, "COLLECTIONS", monkeypatch_patterns)
    cmr = _CMR([_gran("VIIRSJ1", "early", "2026-11-06T19:10:00Z"), _gran("VIIRSJ1", "late", "2026-11-06T20:50:00Z")])
    downloads = []

    class _Auth:
        def get(self, url):
            downloads.append(url)
            return _Resp(b"\x89HDF\r\n\x1a\n" + url.encode())

    def fake_read(content, layer, bbox):
        late = b"late" in content
        la = np.array([33.0, 34.0]); lo = np.array([-118.0, -119.0])
        return (la, lo, np.array([5.0, np.nan])) if late else (la, lo, np.array([1.0, 2.0]))
    monkeypatch.setattr(passes, "read_pass", fake_read)
    st = _Store()
    g = passes.composite("chl", "socal", BOX, cmr, _Auth(), st, NOW, log=lambda *a: None)
    v = lambda la, lo: g.values[np.argmin(abs(lats - la)), np.argmin(abs(lons - lo))]   # noqa: E731
    assert np.log10(v(33.0, -118.0)) > np.log10(5.0) / 2     # chlorophyll: passes are blended, the newer one counts more
    assert abs(v(34.0, -119.0) - 2.0) < 1e-3                 # cloudy in the newest pass → older pass shows
    assert g.meta["observed_at"] == "2026-11-06T20:50:00Z" and [p["sat"] for p in g.meta["passes"]] == ["NOAA-20", "NOAA-20"]
    assert len(downloads) == 2
    passes.composite("chl", "socal", BOX, cmr, _Auth(), st, NOW, log=lambda *a: None)
    assert len(downloads) == 2                               # second run: nothing re-downloaded


@_patched
def test_goes_west_only_fills_what_the_sharper_passes_missed(monkeypatch):
    from ocean import passes
    from ocean.grid import Grid
    from ocean.passes import target_grid
    lats, lons = target_grid(BOX)
    monkeypatch.setattr(passes, "COLLECTIONS", {"sst": ["VIIRS_N21-OSPO-L2P-*"], "sst_fill": ["ABI_G18-STAR-L3C-*"], "chl": []})
    cmr = _CMR([_gran("VIIRS_N21", "n21", "2026-11-06T10:00:00Z"), _gran("ABI_G18", "goes", "2026-11-06T21:00:00Z")])

    class _Auth:
        def get(self, url):
            return _Resp(b"\x89HDF\r\n\x1a\n" + url.encode())

    def fake_read(content, layer, bbox):
        if b"goes" in content:
            return Grid(np.linspace(31, 35, 81), np.linspace(-121, -116.6, 89), np.full((81, 89), 70.0, np.float32))
        return np.array([33.0]), np.array([-118.0]), np.array([64.0])
    monkeypatch.setattr(passes, "read_pass", fake_read)
    g = passes.composite("sst", "socal", BOX, cmr, _Auth(), _Store(), NOW, log=lambda *a: None)
    v = lambda la, lo: g.values[np.argmin(abs(lats - la)), np.argmin(abs(lons - lo))]   # noqa: E731
    assert abs(v(33.0, -118.0) - 64.0) < 1e-4                # sharp VIIRS pixel kept even though GOES is newer
    assert abs(v(32.0, -117.5) - 70.0) < 1e-4                # elsewhere GOES fills the gap
    assert g.meta["passes"][-1]["fill"] is True and g.meta["observed_at"] == "2026-11-06T10:00:00Z"


@_patched
def test_job_previews_by_default_and_publishes_when_turned_on(monkeypatch):
    from ocean import jobs, passes
    from ocean.grid import Grid
    st = _Store()
    lats, lons = passes.target_grid(BOX)
    comp = Grid(lats, lons, np.full((lats.size, lons.size), np.nan, np.float32), {"observed_at": "2026-11-06T20:50:00Z",
               "passes": [{"sat": "NOAA-21", "at": "2026-11-06T20:50:00Z", "seen": 0.4}], "fresh_share": 0.4, "today_share": 0.4})
    comp.values[:10, :10] = 1.0
    monkeypatch.setattr(jobs, "get_store", lambda: st)
    monkeypatch.setattr(jobs.httpx, "Client", lambda *a, **k: None)
    monkeypatch.setattr(passes, "earthdata_client", lambda: object())
    monkeypatch.setattr(passes, "composite", lambda *a, **k: comp)
    published = []
    monkeypatch.setattr(jobs, "process_surface", lambda layer, region, when, http, store, ds, grid, tag="", seen=None: published.append((ds, grid, tag)) or {"date": "2026-11-06", "tiles": "t"})
    monkeypatch.delenv("PASSES", raising=False)
    r = jobs.run_passes("chl", "socal")
    assert r["mode"] == "preview" and not published and json.loads(st.get("manifests/passes-chl.json"))["fresh_share"] == 0.4
    monkeypatch.setenv("PASSES", "on")
    r = jobs.run_passes("chl", "socal")
    assert r["published"] == "2026-11-06" and "NOAA-21" in published[0][0].source and published[0][2] == "-live"
    m = json.loads(st.get("manifests/chl.json"))
    assert m["dates"][0]["live"] is True and m["dates"][0]["passes"][0]["sat"] == "NOAA-21"


@_patched
def test_no_login_means_nothing_is_tried(monkeypatch):
    from ocean import jobs, passes
    st = _Store()
    monkeypatch.setattr(jobs, "get_store", lambda: st)
    monkeypatch.setattr(jobs.httpx, "Client", lambda *a, **k: None)
    monkeypatch.setattr(passes, "earthdata_client", lambda: None)
    r = jobs.run_passes("sst", "socal")
    assert "Earthdata" in r["error"]


def test_clouds_are_filled_and_blend_in_with_no_blanks_or_steps():
    from ocean.grid import Grid
    from ocean.passes import blend, target_grid
    lats, lons = target_grid((-119.0, 33.0, -118.0, 34.0))
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    truth = 60 + (la - 33) * 4                                  # today: 60–64 °F north-south gradient
    today = truth.copy()
    cloud = (la > 33.3) & (la < 33.7) & (lo > -118.7) & (lo < -118.3)
    today[cloud] = np.nan                                       # a cloud in the middle
    today[:3, :3] = np.nan                                      # and a corner nobody saw
    older = Grid(lats, lons, (truth - 2.0).astype(np.float32))  # yesterday's map: same pattern, 2 °F cooler
    older.values[:3, :3] = np.nan
    g = blend(Grid(lats, lons, today.astype(np.float32), {"observed_at": "x"}), older)
    v = np.asarray(g.values, dtype=np.float64)
    assert np.isfinite(v).all()                                 # no blanks anywhere
    assert np.max(np.abs(v[cloud] - truth[cloud])) < 0.35        # cloud filled ~today's temps, not 2 °F cooler
    edge_jump = np.max(np.abs(np.diff(v, axis=1)))
    assert edge_jump < 0.3                                      # no visible step at the cloud edge
    c = blend(Grid(lats, lons, np.where(cloud, np.nan, 10 ** (truth / 40)).astype(np.float32), {}), None, log_space=True)
    assert np.isfinite(c.values).all() and (np.asarray(c.values) > 0).all()   # chlorophyll: filled, never zero/negative


def test_daily_job_never_paints_over_a_newer_live_map():
    import json as _j
    from ocean import jobs
    st = _Store()
    live = {"date": "2026-11-06", "observed_at": "2026-11-06T21:50:00Z", "tiles": "live-tiles", "live": True}
    st.put("manifests/sst.json", _j.dumps({"dates": [live]}).encode())
    mp = _MP()
    try:
        mp.setattr(jobs, "get_store", lambda: st)
        mp.setattr(jobs.httpx, "Client", lambda *a, **k: None)
        daily = {"date": "2026-11-06", "observed_at": "2026-11-06T09:00:00Z", "tiles": "daily-tiles"}
        mp.setattr(jobs, "_latest_surface", lambda *a, **k: (jobs.DATASETS["sst"], daily))
        jobs.run_surface("sst", "socal", [0])
        m = _j.loads(st.get("manifests/sst.json"))
        assert m["dates"][0]["tiles"] == "live-tiles"          # the newer live map stays
    finally:
        mp.undo()


def test_chlorophyll_passes_blend_into_one_smooth_picture():
    from ocean.grid import Grid
    from ocean.passes import blend_chl_passes, target_grid
    lats, lons = target_grid((-119.0, 33.0, -118.0, 34.0))
    LA, LO = np.meshgrid(lats, lons, indexing="ij")
    truth = 10 ** (-0.5 + 0.6 * (LO + 119.0))                           # smooth offshore → inshore rise
    rng = np.random.default_rng(1)
    a = truth * 10 ** rng.normal(0, 0.08, truth.shape)                  # pass A: noisy pixels
    b = truth * 1.4 * 10 ** rng.normal(0, 0.08, truth.shape)            # pass B: a sensor that reads 40% high
    a[:, 60:] = np.nan; b[:, :40] = np.nan                              # they overlap in the middle
    ga = Grid(lats, lons, a.astype(np.float32), {"observed_at": "2026-11-08T19:00:00Z"})
    gb = Grid(lats, lons, b.astype(np.float32), {"observed_at": "2026-11-08T21:00:00Z"})
    out = blend_chl_passes([ga, gb], NOW)
    lo = np.log10(out)
    step = np.nanmax(np.abs(np.diff(lo, axis=1)))                       # no seam/block edge between the passes
    noise = np.nanstd(np.diff(lo, axis=0))                              # speckle (north-south, where truth is flat)
    assert step < 0.05 and noise < 0.03
    raw_noise = np.nanstd(np.diff(np.log10(a[:, :40]), axis=0))
    assert noise < raw_noise / 3                                         # far less speckly than a raw pass
