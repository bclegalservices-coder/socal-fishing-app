"""Channel Nav Map Studio — the local web server (only reachable from this computer: http://localhost:8765)."""
from __future__ import annotations

import base64
import json
import os
import threading

import httpx
from fastapi import Body, FastAPI, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from . import assistant as ai
from . import core

STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

http = httpx.Client(follow_redirects=True, timeout=120, headers={"User-Agent": "ChannelNav-MapStudio"})
app = FastAPI(title="Channel Nav Map Studio")
_studio: core.Studio | None = None
_ai: ai.Assistant | None = None
_lock = threading.Lock()


def studio() -> core.Studio:
    global _studio, _ai
    with _lock:
        if _studio is None:
            _studio = core.Studio(http)
            _ai = ai.Assistant(_studio, http)
    return _studio


def helper() -> ai.Assistant:
    studio()
    return _ai


NO_STORE = {"cache-control": "no-store"}


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC, "index.html"), headers=NO_STORE)


@app.get("/api/state")
def get_state():
    return JSONResponse(studio().public_state(), headers=NO_STORE)


@app.post("/api/hd")
def set_hd(body: dict = Body(...)):
    st = studio()
    st.set_hd(body.get("changes") or {}, body.get("which", "B"))
    return st.public_state()


@app.post("/api/hd/reset")
def reset_hd(body: dict = Body(...)):
    st = studio()
    st.state["hdB"] = {} if body.get("to") == "builtin" else dict(st.state["hdA"])
    st.save()
    return st.public_state()


@app.post("/api/chart")
def set_chart(body: dict = Body(...)):
    st = studio()
    st.set_chart(body.get("changes") or {}, body.get("which", "B"))
    return st.public_state()


@app.post("/api/chart/reset")
def reset_chart(body: dict = Body(...)):
    st = studio()
    st.state["chartB"] = {} if body.get("to") == "builtin" else dict(st.state["chartA"])
    st.save()
    return st.public_state()


@app.post("/api/view")
def set_view(body: dict = Body(...)):
    st = studio()
    st.set_view(body.get("lat"), body.get("lon"), body.get("zoom"))
    if body.get("ab") in ("A", "B"):
        st.state["ab"] = body["ab"]
    for k in ("hd", "chart"):
        if k in (body.get("show") or {}):
            st.state["show"][k] = bool(body["show"][k])
    st.save()
    return {"ok": True}


@app.post("/api/published/refresh")
def refresh_published():
    st = studio()
    st.fetch_published()
    st.save()
    return st.public_state()


@app.post("/api/published/mark")
def mark_published(body: dict = Body(...)):
    """After Send to app: B becomes the new A."""
    st = studio()
    if body.get("what") == "hd":
        st.state["hdA"] = dict(st.state["hdB"])
    if body.get("what") == "chart":
        st.state["chartA"] = dict(st.state["chartB"])
    st.save()
    return st.public_state()


@app.get("/hd/{sid}/{z}/{x}/{y}.png")
def hd_tile(sid: str, z: int, x: int, y: int):
    st = studio()
    if sid not in core.STYLES:
        st.public_state()              # registers A and B
    data = st.hd_png(sid, z, x, y)
    if not data:
        return Response(status_code=204, headers=NO_STORE)
    return Response(data, media_type="image/png", headers={"cache-control": "max-age=3600"})


@app.get("/api/snapshot.png")
def snapshot(which: str = "B"):
    return Response(studio().snapshot(which if which in ("A", "B") else "B"), media_type="image/png", headers=NO_STORE)


@app.get("/api/land")
def land():
    from .land import MEXICO_LAND
    return {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [MEXICO_LAND]}}


@app.get("/api/spots")
def spots():
    return core.load_spots()


@app.post("/api/spots")
def save_spots(body: list = Body(...)):
    core.save_spots([s for s in body if isinstance(s, dict) and "lat" in s and "lon" in s and s.get("name")])
    return core.load_spots()


@app.get("/api/check.png")
def check():
    return Response(studio().check_sheet(core.load_spots()), media_type="image/png", headers=NO_STORE)


@app.get("/api/notes")
def notes():
    try:
        return {"text": open(core.NOTES_FILE).read()}
    except Exception:
        return {"text": ""}


# ---- Claude
@app.get("/api/claude")
def claude_status():
    return {"has_key": bool(ai.get_key())}


@app.post("/api/claude/key")
def claude_key(body: dict = Body(...)):
    k = str(body.get("key", "")).strip()
    if not k.startswith("sk-"):
        return JSONResponse({"ok": False, "error": "That doesn't look like a Claude API key (it starts with sk-ant-)."}, status_code=400)
    ai.set_key(k)
    return {"ok": True}


@app.post("/api/claude/reset")
def claude_reset():
    helper().reset()
    return {"ok": True}


@app.post("/api/claude/chat")
def claude_chat(body: dict = Body(...)):
    shot = None
    if body.get("screenshot"):
        try:
            shot = base64.b64decode(body["screenshot"].split(",", 1)[-1])
        except Exception:
            shot = None

    def gen():
        for ev in helper().chat(str(body.get("text", "")), body.get("model", "opus"), shot):
            if ev.get("type") == "state":
                ev = {"type": "state", "state": studio().public_state()}
            yield json.dumps(ev) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson", headers=NO_STORE)
