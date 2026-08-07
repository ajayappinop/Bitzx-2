"""Runtime futures symbol catalog (static majors + admin-listed tokens)."""

from __future__ import annotations

import time
from typing import Dict, Optional

from .constants import (
    ASSET_CLASS_CRYPTO,
    ASSET_CLASS_RWA,
    ASSET_CLASSES,
    SUPPORTED_SYMBOLS as _STATIC,
)

_CACHE: dict = {"merged": {}, "fetched_at": 0.0}
_TTL_SEC = 30.0


def asset_class_of(meta: Optional[dict]) -> str:
    raw = str((meta or {}).get("asset_class") or ASSET_CLASS_CRYPTO).lower().strip()
    return raw if raw in ASSET_CLASSES else ASSET_CLASS_CRYPTO


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
    # Normalize asset_class so every entry is explicitly tagged.
    for meta in merged.values():
        meta["asset_class"] = asset_class_of(meta)
    _CACHE["merged"] = merged
    _CACHE["fetched_at"] = now
    return dict(merged)


def filter_symbols_by_asset_class(
    symbols: Dict[str, dict],
    asset_class: Optional[str] = ASSET_CLASS_CRYPTO,
) -> Dict[str, dict]:
    """Filter catalog. Default ``crypto`` so RWA never leaks into crypto UIs.

    Pass ``asset_class="all"`` (or empty) only for admin / internal callers.
    """
    if not asset_class or str(asset_class).lower() in {"all", "*"}:
        return dict(symbols)
    want = str(asset_class).lower().strip()
    if want not in ASSET_CLASSES:
        want = ASSET_CLASS_CRYPTO
    return {k: v for k, v in symbols.items() if asset_class_of(v) == want}


def is_rwa_symbol(symbol: str) -> bool:
    meta = get_supported_symbols().get(str(symbol or "").upper()) or {}
    return asset_class_of(meta) == ASSET_CLASS_RWA


def invalidate_supported_symbols_cache() -> None:
    _CACHE["merged"] = {}
    _CACHE["fetched_at"] = 0.0
