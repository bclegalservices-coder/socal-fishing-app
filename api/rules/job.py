"""python -m ocean.jobs rules   — refreshes the rules & hazards layers (run weekly by GitHub Actions)."""
import json
from datetime import datetime, timezone

import httpx

from .arcgis import find_layers, query_layer
from .layers import RULE_LAYERS, normalize


def run(store, bbox: tuple, log=print) -> dict:
    http = httpx.Client(timeout=120, follow_redirects=True, headers={"User-Agent": "fishing-app-pipeline"})
    checked = datetime.now(timezone.utc).isoformat()
    entries = []
    for layer in RULE_LAYERS:
        entry = {"key": layer["key"], "label": layer["label"], "kind": layer["kind"], "source": layer["source"], "checked_at": checked}
        try:
            raw: list[dict] = []
            if layer.get("url"):
                if layer["url"].endswith(".geojson") or layer["url"].endswith(".json"):
                    raw = http.get(layer["url"]).raise_for_status().json().get("features", [])
                else:
                    raw = query_layer(http, layer["url"], bbox)
            elif layer.get("service"):
                found = find_layers(http, layer["service"], layer["match"])
                entry["found_layers"] = [n for _, n in found]
                for url, name in found:
                    for f in query_layer(http, url, bbox):
                        (f.setdefault("properties", {}))["_layer_name"] = name
                        raw.append(f)
            else:
                entry.update({"available": False, "note": "No source configured yet (set the URL in the environment)."})
                entries.append(entry)
                log(f"rules {layer['key']}: not configured")
                continue
            feats = [x for x in (normalize(layer, f) for f in raw) if x]
            key = f"vectors/rules/{layer['key']}.geojson"
            store.put(key, json.dumps({"type": "FeatureCollection", "features": feats}).encode(), "application/geo+json")
            entry.update({"available": True, "count": len(feats), "url": store.url(key)})
            log(f"rules {layer['key']}: {len(feats)} features")
        except Exception as e:  # keep the previous file; report the problem
            entry.update({"available": False, "error": f"{type(e).__name__}: {e}"[:300]})
            log(f"rules {layer['key']}: FAILED {e}")
        entries.append(entry)
    # keep last good URLs for layers that failed this time
    old = store.get("manifests/rules.json")
    if old:
        prev = {e["key"]: e for e in json.loads(old).get("layers", [])}
        for e in entries:
            p = prev.get(e["key"])
            if not e.get("available") and p and p.get("available"):
                e.update({"available": True, "url": p["url"], "count": p.get("count"), "checked_at": p.get("checked_at"), "stale": True})
    manifest = {"layer": "rules", "checked_at": checked, "layers": entries,
                "note": "Boundaries shown for reference; the official regulations govern."}
    store.put("manifests/rules.json", json.dumps(manifest).encode(), "application/json")
    return manifest
