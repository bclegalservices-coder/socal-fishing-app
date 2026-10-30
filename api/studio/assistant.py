"""Claude inside Map Studio: you type what you want ("the deep water looks like crystals", "make the reefs pop",
"water should be a little darker"), Claude looks at the map, changes the settings, looks again, and tells you what it
did. It works on B (your changes); A (the app now) is never touched until you press Send to app.

Uses the Claude API (Anthropic). The key is kept only on this computer (~/.channelnav-studio/claude-key).
"""
from __future__ import annotations

import json
import os
import time

from . import core

KEY_FILE = os.path.join(core.HOME, "claude-key")
MODELS = {"opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5-5"}
MAX_STEPS = 24
KEEP_IMAGES = 3                       # older snapshots are dropped from the conversation (keeps it fast and cheap)


def get_key() -> str | None:
    k = os.environ.get("ANTHROPIC_API_KEY")
    if k:
        return k.strip()
    try:
        return open(KEY_FILE).read().strip() or None
    except Exception:
        return None


def set_key(k: str) -> None:
    os.makedirs(core.HOME, exist_ok=True)
    with open(KEY_FILE, "w") as fh:
        fh.write(k.strip())
    os.chmod(KEY_FILE, 0o600)


SYSTEM = """You are Claude, working inside Channel Nav Map Studio with Christopher, who is building Channel Nav — a Southern \
California fishing & boating map app ("Navionics on steroids"). Goal: the best-looking, most useful fishing maps on the market. \
He is not a programmer: talk plainly and briefly, like a skilled map designer sitting next to him.

What you control (only B = "your changes"; A = what the app shows now, never edited here):
1) HD bottom look (set_hd_style). Drawn from NOAA BlueTopo surveys. Settings:
   CELLS 0.3–2 (smoothing of colors, in survey cells) · SHADE_CELLS 0.5–3 (smoothing of light & shadow) · LINE_CELLS 0.5–3 \
(smoothing of contour lines) · DEEP_COLOR 0–0.4, DEEP_SHADE 0–0.6, DEEP_LINE 0–0.3 (extra smoothing that grows with depth — \
melts NOAA's deep-water "crystal" triangles; shallow reefs stay sharp) · FILL_HOLES true/false (fills see-through pinholes) · \
ZF_NEAR (zoom ≥15), ZF_MID (13–14), ZF_FAR (≤12) 1–15 (height exaggeration of the relief) · LIGHT_ALT 20–70 (sun height; low = \
long dramatic shadows) · SHADE_GAIN 0–1.6 (strength of light & shadow) · SHADE_MIN 0.2–0.9 / SHADE_MAX 1–1.4 (darkest / brightest) \
· DEEP_LIGHT 0.1–1 (light & shadow left at ~400 m deep) · LINE_WIDTH 0.3–3, LINE_ALPHA 0.2–2 (contour lines) · LINES, LABELS \
true/false · COLORS: 10 hex colors for depths 0, 6, 15, 30, 60, 120, 250, 500, 1000, 3000 ft.
   HD bottom is drawn live from zoom 11 to 18 only.
2) Chart look (set_chart_look): water (hex), land (hex, Mexico fill), look clean|standard|full (how busy the NOAA chart is), \
depths (NOAA depth lines & numbers on/off), depthsFull, lightCircles, simpleSymbols, night, dlw / daw (meters: when zoomed out \
past these square widths, every NOAA chart draws its depth lines (dlw: lines only) / lines + numbers (daw); 0 = never).
3) The view (set_view / go_to_spot) and the layers shown (set_layers).

How to work:
- Before judging, LOOK: call snapshot (B, or "both" to compare with A). Never say something is fixed without a fresh snapshot.
- Change a few related settings at a time, then snapshot again. Iterate until it looks right (usually 1–4 rounds).
- When a look should work everywhere, run check_spots to see all test spots (it's slow — use it for the final check).
- If a request needs new drawing code (not just settings), say so plainly and save it with note_for_developer, in enough \
detail that a developer can build it.
- End each reply with what changed (in plain words) and, if it looks good, remind him: Send to app (HD bottom also needs \
the bottomhd + bottomhd-socal runs in GitHub to redraw the squares; chart look reaches phones within ~10 minutes).
"""

TOOLS = [
    {"name": "get_state", "description": "Current settings for A and B, the view and which layers are shown.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "snapshot", "description": "A picture of the map at the current view (or a given one), like the phone shows it. which: B (default), A, or both.",
     "input_schema": {"type": "object", "properties": {"which": {"type": "string", "enum": ["A", "B", "both"]},
                      "lat": {"type": "number"}, "lon": {"type": "number"}, "zoom": {"type": "number"}}}},
    {"name": "set_hd_style", "description": "Change HD bottom settings on B (only the ones given).",
     "input_schema": {"type": "object", "properties": {"changes": {"type": "object"}}, "required": ["changes"]}},
    {"name": "reset_hd_style", "description": "Set B's HD bottom back to A (the app now) or to the built-in look.",
     "input_schema": {"type": "object", "properties": {"to": {"type": "string", "enum": ["A", "builtin"]}}, "required": ["to"]}},
    {"name": "set_chart_look", "description": "Change chart settings on B (only the ones given).",
     "input_schema": {"type": "object", "properties": {"changes": {"type": "object"}}, "required": ["changes"]}},
    {"name": "set_view", "description": "Move the map (also moves Christopher's map).",
     "input_schema": {"type": "object", "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}, "zoom": {"type": "number"}}}},
    {"name": "go_to_spot", "description": "Move the map to a saved test spot by name.",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
    {"name": "set_layers", "description": "Show or hide layers in the Studio map and snapshots.",
     "input_schema": {"type": "object", "properties": {"hd": {"type": "boolean"}, "chart": {"type": "boolean"}}}},
    {"name": "list_spots", "description": "The saved test spots.", "input_schema": {"type": "object", "properties": {}}},
    {"name": "add_spot", "description": "Save the current view as a test spot.",
     "input_schema": {"type": "object", "properties": {"name": {"type": "string"}, "note": {"type": "string"}}, "required": ["name"]}},
    {"name": "check_spots", "description": "One picture of every test spot (or the named ones), A next to B. Slow.",
     "input_schema": {"type": "object", "properties": {"names": {"type": "array", "items": {"type": "string"}}}}},
    {"name": "note_for_developer", "description": "Save a request that needs a code change (goes to notes-for-developer.md).",
     "input_schema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}},
]


def _img(png: bytes) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": core.b64(png)}}


class Assistant:
    def __init__(self, studio: core.Studio, http):
        self.studio, self.http = studio, http
        self.messages: list[dict] = []

    def reset(self):
        self.messages = []

    # ---- tools: return (content for Claude, events for the page)
    def run_tool(self, name: str, a: dict):
        st = self.studio
        ev = []
        if name == "get_state":
            s = st.public_state()
            keep = {k: s[k] for k in ("hdA", "hdB", "chartA", "chartB", "view", "show")}
            return json.dumps(keep), ev
        if name == "snapshot":
            view = {k: a[k] for k in ("lat", "lon", "zoom") if a.get(k) is not None} or None
            which = a.get("which", "B")
            out = []
            for w in (["A", "B"] if which == "both" else [which]):
                png = st.snapshot(w, view)
                out += [{"type": "text", "text": f"Snapshot {w} ({'app now' if w == 'A' else 'your changes'}):"}, _img(png)]
                ev.append({"type": "image", "label": f"Claude looked at {w}", "png": core.b64(png)})
            return out, ev
        if name == "set_hd_style":
            new = st.set_hd(a.get("changes") or {})
            ev.append({"type": "state"})
            return json.dumps(new), ev
        if name == "reset_hd_style":
            st.state["hdB"] = {} if a.get("to") == "builtin" else dict(st.state["hdA"])
            st.save(); ev.append({"type": "state"})
            return "done", ev
        if name == "set_chart_look":
            new = st.set_chart(a.get("changes") or {})
            ev.append({"type": "state"})
            return json.dumps(new), ev
        if name == "set_view":
            st.set_view(a.get("lat"), a.get("lon"), a.get("zoom"))
            ev.append({"type": "state"})
            return json.dumps(st.state["view"]), ev
        if name == "go_to_spot":
            sp = next((s for s in core.load_spots() if s["name"].lower() == str(a.get("name", "")).lower()), None) \
                or next((s for s in core.load_spots() if str(a.get("name", "")).lower() in s["name"].lower()), None)
            if not sp:
                return "no spot with that name", ev
            st.set_view(sp["lat"], sp["lon"], sp.get("zoom", 13))
            ev.append({"type": "state"})
            return json.dumps(sp), ev
        if name == "set_layers":
            for k in ("hd", "chart"):
                if k in a:
                    st.state["show"][k] = bool(a[k])
            st.save(); ev.append({"type": "state"})
            return json.dumps(st.state["show"]), ev
        if name == "list_spots":
            return json.dumps(core.load_spots()), ev
        if name == "add_spot":
            spots = core.load_spots()
            v = st.state["view"]
            spots.append({"name": a["name"], "lat": round(v["lat"], 5), "lon": round(v["lon"], 5), "zoom": round(v["zoom"], 1), "note": a.get("note", "")})
            core.save_spots(spots); ev.append({"type": "spots"})
            return "saved", ev
        if name == "check_spots":
            spots = core.load_spots()
            if a.get("names"):
                want = [n.lower() for n in a["names"]]
                spots = [s for s in spots if any(w in s["name"].lower() for w in want)] or spots
            png = st.check_sheet(spots)
            ev.append({"type": "image", "label": "Check of the test spots (A left, B right)", "png": core.b64(png)})
            return [{"type": "text", "text": "Test spots, A (left) vs B (right):"}, _img(png)], ev
        if name == "note_for_developer":
            core.add_note(a.get("text", ""))
            return "saved to notes-for-developer.md", ev
        return f"unknown tool {name}", ev

    def _trim_images(self):
        seen = 0
        for m in reversed(self.messages):
            if not isinstance(m["content"], list):
                continue
            for blk in m["content"]:
                if blk.get("type") == "tool_result" and isinstance(blk.get("content"), list):
                    for i, c in enumerate(blk["content"]):
                        if c.get("type") == "image":
                            seen += 1
                            if seen > KEEP_IMAGES:
                                blk["content"][i] = {"type": "text", "text": "[older picture removed]"}
                elif blk.get("type") == "image":
                    seen += 1

    def chat(self, text: str, model: str = "opus", screenshot: bytes | None = None):
        """Generator of events for the page: text, tool, image, state, done, error."""
        key = get_key()
        if not key:
            yield {"type": "error", "text": "Add your Claude API key first (Setup tab)."}
            return
        v = self.studio.state["view"]
        content = [{"type": "text", "text": f"{text}\n\n(Map view now: lat {v['lat']:.4f}, lon {v['lon']:.4f}, zoom {v['zoom']:.1f}; "
                                                 f"showing {'A' if self.studio.state['ab'] == 'A' else 'B'}.)"}]
        if screenshot:
            content.append(_img(screenshot))
        start = len(self.messages)                     # on an error, this whole turn is taken back out
        self.messages.append({"role": "user", "content": content})
        for step in range(MAX_STEPS):
            self._trim_images()
            body = {"model": MODELS.get(model, model), "max_tokens": 4000, "system": SYSTEM, "tools": TOOLS, "messages": self.messages}
            try:
                r = self.http.post("https://api.anthropic.com/v1/messages", json=body, timeout=300,
                                   headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
            except Exception as e:
                yield {"type": "error", "text": f"Couldn't reach Claude ({type(e).__name__})."}
                del self.messages[start:]
                return
            if r.status_code != 200:
                msg = r.text[:300]
                try:
                    msg = r.json()["error"]["message"]
                except Exception:
                    pass
                yield {"type": "error", "text": f"Claude API error {r.status_code}: {msg}"}
                del self.messages[start:]
                return
            resp = r.json()
            blocks = resp.get("content", [])
            self.messages.append({"role": "assistant", "content": blocks})
            for b in blocks:
                if b.get("type") == "text" and b.get("text", "").strip():
                    yield {"type": "text", "text": b["text"]}
            uses = [b for b in blocks if b.get("type") == "tool_use"]
            if resp.get("stop_reason") != "tool_use" or not uses:
                yield {"type": "done"}
                return
            results = []
            for u in uses:
                yield {"type": "tool", "name": u["name"], "input": u.get("input") or {}}
                try:
                    out, evs = self.run_tool(u["name"], u.get("input") or {})
                except Exception as e:
                    out, evs = f"error: {type(e).__name__}: {str(e)[:200]}", []
                for e in evs:
                    yield e
                results.append({"type": "tool_result", "tool_use_id": u["id"], "content": out})
            self.messages.append({"role": "user", "content": results})
        self.messages.append({"role": "assistant", "content": [{"type": "text", "text": "(paused after many steps)"}]})
        yield {"type": "text", "text": "(Stopping here — that was a lot of steps. Tell me how it looks and I'll keep going.)"}
        yield {"type": "done"}
