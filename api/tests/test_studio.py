"""Map Studio: snapshots, live HD squares, A/B looks, test-spot sheet and Claude's tool loop (all offline, fakes)."""
import io
import json
import os
import tempfile

import numpy as np

os.environ.setdefault("STUDIO_HOME", tempfile.mkdtemp())


def _studio():
    import studio.core as C
    from ocean.hdrender import MARGIN, READ
    from ocean.tiles import tile_bounds
    from PIL import Image

    def square(self, z, x, y):
        w, s, e, n = tile_bounds(z, x, y)
        N = READ + 2 * MARGIN
        lat = n - (np.arange(N) - MARGIN + 0.5) * (n - s) / READ
        d = np.repeat(-(40 + (33.75 - lat) * 900)[:, None], N, 1).astype(np.float32)
        return d, np.full(d.shape, 16.0, np.float32), MARGIN

    calls = []

    def fetch_tile(self, template, z, x, y):
        calls.append(template)
        im = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
        if "layers=2" not in template:
            im.paste((240, 230, 190, 255), (0, 0, 100, 1024))
        return im

    C.SurveyBank.square = square
    C.Studio.fetch_tile = fetch_tile
    C.Studio.fetch_published = lambda self: None
    st = C.Studio(http=None)
    st.state.update({"hdA": {}, "hdB": {}, "chartA": {}, "chartB": {}, "view": {"lat": 33.6, "lon": -118.3, "zoom": 12.0}})
    return C, st, calls


def test_snapshot_and_live_squares_follow_the_look():
    from PIL import Image
    C, st, calls = _studio()
    a = Image.open(io.BytesIO(st.snapshot("B", size=(400, 300))))
    assert a.size == (400, 300)
    st.set_hd({"COLORS": ["#FF0000"] * 10, "LINES": False, "SHADE_GAIN": 0})
    b = np.asarray(Image.open(io.BytesIO(st.snapshot("B", size=(400, 300)))))
    assert b[150, 300, 0] > 200 and b[150, 300, 1] < 60           # B is drawn red now
    a2 = np.asarray(Image.open(io.BytesIO(st.snapshot("A", size=(400, 300)))))
    assert a2[150, 300, 0] < 120                                    # A untouched
    s = st.public_state()
    assert s["sidA"] != s["sidB"] and st.hd_png(s["sidB"], 13, 1404, 3283)
    assert st.hd_png(s["sidB"], 9, 87, 205) is None                 # live HD only from zoom 11


def test_chart_settings_make_the_same_addresses_as_the_app():
    C, st, calls = _studio()
    chart, depth = C.chart_urls({"look": "standard", "dlw": 20000})
    assert "layers=0,1,3,4,5,6" in chart and "look=standard" in chart and "v=w2" in chart
    assert "layers=2" in depth and "dlw=20000" in depth and "daw=7500" in depth
    assert C.chart_urls({"depths": False})[1] is None
    assert C.chart_resolve({"water": "aadaff", "look": "nope"})["water"] == "#AADAFF"


def test_check_sheet_has_every_spot():
    from PIL import Image
    C, st, calls = _studio()
    im = Image.open(io.BytesIO(st.check_sheet([{"name": "a", "lat": 33.6, "lon": -118.3, "zoom": 12},
                                               {"name": "b", "lat": 33.5, "lon": -118.4, "zoom": 13}])))
    assert im.height > 800


def test_claude_loop_changes_b_and_looks():
    import studio.assistant as A
    C, st, calls = _studio()
    replies = [
        {"stop_reason": "tool_use", "content": [{"type": "text", "text": "Let me look."},
                                                {"type": "tool_use", "id": "t1", "name": "snapshot", "input": {"which": "both"}}]},
        {"stop_reason": "tool_use", "content": [{"type": "tool_use", "id": "t2", "name": "set_hd_style", "input": {"changes": {"DEEP_SHADE": 0.5}}}]},
        {"stop_reason": "end_turn", "content": [{"type": "text", "text": "Smoother now."}]},
    ]
    sent = []

    class R:
        def __init__(self, j): self.j, self.status_code, self.text = j, 200, ""
        def json(self): return self.j

    class Http:
        def post(self, url, json=None, headers=None, timeout=None):
            sent.append(json); return R(replies[len(sent) - 1])

    A.get_key = lambda: "sk-test"
    bot = A.Assistant(st, Http())
    evs = list(bot.chat("deep water looks like crystals", "opus"))
    kinds = [e["type"] for e in evs]
    assert kinds.count("image") == 2 and "state" in kinds and kinds[-1] == "done"
    assert st.state["hdB"]["DEEP_SHADE"] == 0.5
    tr = sent[1]["messages"][2]["content"][0]          # (same list object: index of that turn)
    assert tr["type"] == "tool_result" and any(c.get("type") == "image" for c in tr["content"])
    assert sent[0]["model"] == "claude-opus-5-5" and sent[0]["tools"]


def test_builder_style_tag():
    from ocean.bottomhd import style_tag
    assert style_tag({}) == "" and style_tag({"DEEP_SHADE": 0.4}).startswith("-s")
