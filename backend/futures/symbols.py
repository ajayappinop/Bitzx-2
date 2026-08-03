"""Runtime futures symbol catalog (static majors + admin-listed tokens)."""

from __future__ import annotations

import time
from typing import Dict

from .constants import SUPPORTED_SYMBOLS as _STATIC

_CACHE: dict = {"merged": {}, "fetched_at": 0.0}
_TTL_SEC = 30.0


def get_supported_symbols(*, force: bool = False) -> Dict[str, dict]:
    now = time.time()
    if (
        not force
        and _CACHE["merged"]
        and (now - float(_CACHE.get("fetched_at") or 0)) < _TTL_SEC
    ):
        return dict(_CACHE["merged"])
    from listings.futures_symbols import merge_listed_into_futures

    merged = merge_listed_into_futures(_STATIC)
    _CACHE["merged"] = merged
    _CACHE["fetched_at"] = now
    return dict(merged)


def invalidate_supported_symbols_cache() -> None:
    _CACHE["merged"] = {}
    _CACHE["fetched_at"] = 0.0
