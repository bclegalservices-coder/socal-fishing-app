"""After editing regs.json, run from the repo folder:  python3 api/regs/sync_app_copy.py
It writes the app's built-in copy (mobile/src/regs/bundled.ts) so the rules also work with no signal."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1] / "mobile" / "src" / "regs" / "bundled.ts"
HEAD = ("// Built-in copy of api/regs/regs.json so the rules work with no signal. Made by: python3 api/regs/sync_app_copy.py\n"
        "// (a server test checks it matches). Don't edit by hand.\nimport type { RegsData } from './regs';\n\nexport const BUNDLED: RegsData = ")


def render() -> str:
    return HEAD + json.dumps(json.loads((HERE / "regs.json").read_text(encoding="utf-8")), ensure_ascii=False, indent=1) + ";\n"


if __name__ == "__main__":
    APP.write_text(render(), encoding="utf-8")
    print(f"wrote {APP}")
