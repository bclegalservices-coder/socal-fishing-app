"""Shared HTTP client + small in-memory TTL cache. Government APIs ask for an identifying User-Agent."""
import asyncio
import functools
import os
import time

import httpx

USER_AGENT = os.environ.get("NWS_USER_AGENT", "(fishing-app-dev, contact@example.com)")
_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=10.0),
            headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json, text/plain, */*"},
            follow_redirects=True,
        )
    return _client


def cached(ttl_seconds: float):
    """Cache an async function's result per argument tuple. Failures are not cached."""
    def deco(fn):
        store: dict = {}
        locks: dict = {}

        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            key = (args, tuple(sorted(kwargs.items())))
            hit = store.get(key)
            if hit and time.monotonic() - hit[0] < ttl_seconds:
                return hit[1]
            lock = locks.setdefault(key, asyncio.Lock())
            async with lock:
                hit = store.get(key)
                if hit and time.monotonic() - hit[0] < ttl_seconds:
                    return hit[1]
                val = await fn(*args, **kwargs)
                store[key] = (time.monotonic(), val)
                if len(store) > 2000:  # crude bound
                    store.pop(next(iter(store)))
                return val
        return wrapper
    return deco
