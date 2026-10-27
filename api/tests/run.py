"""Runs the tests without pytest:  python -m tests.run   (pytest works too)."""
import importlib
import os
import sys

# Tests must never write to real storage (Cloudflare R2), even when the job's R2 settings are present.
os.environ["STORAGE"] = "local"
import traceback
import types

# The HTTP library isn't needed by these tests; stub it if it isn't installed.
try:
    import httpx  # noqa: F401
except ImportError:
    stub = types.ModuleType("httpx")
    stub.Client = stub.AsyncClient = object
    stub.Timeout = lambda *a, **k: None
    sys.modules["httpx"] = stub

failed = 0
total = 0
for mod_name in ("tests.test_ocean", "tests.test_conditions", "tests.test_rules", "tests.test_features", "tests.test_analytics", "tests.test_seas", "tests.test_billing", "tests.test_harbors", "tests.test_support", "tests.test_navroute", "tests.test_bottomhd", "tests.test_crm", "tests.test_air"):
    mod = importlib.import_module(mod_name)
    for name in sorted(n for n in dir(mod) if n.startswith("test_")):
        total += 1
        try:
            getattr(mod, name)()
            print(f"PASS {mod_name.split('.')[-1]}::{name}")
        except Exception:
            failed += 1
            print(f"FAIL {mod_name.split('.')[-1]}::{name}")
            traceback.print_exc()
print(f"\n{total - failed}/{total} passed")
sys.exit(1 if failed else 0)
