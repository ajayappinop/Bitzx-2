"""Verify Trust Wallet IBO → universal BEP-20 deposit path."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_dotenv() -> None:
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def flag(name: str, default: str = "") -> bool:
    v = (os.getenv(name) or default).strip().lower()
    return v in ("1", "true", "yes", "on")


def main() -> int:
    load_dotenv()
    checks: list[tuple[str, bool, str]] = []

    contract = (os.getenv("IBO_CONTRACT_ADDRESS") or "").strip().lower()
    checks.append(
        (
            "IBO_CONTRACT_ADDRESS valid",
            bool(re.match(r"^0x[a-f0-9]{40}$", contract)),
            f"{contract[:10]}...{contract[-4:]}" if contract else "MISSING",
        )
    )

    bsc = (os.getenv("QUICKNODE_BSC_URL") or "").strip()
    checks.append(("QUICKNODE_BSC_URL configured", bsc.startswith("http"), "ok" if bsc else "MISSING"))

    checks.append(("DEPOSIT_POLL_ENABLED", flag("DEPOSIT_POLL_ENABLED", "true"), os.getenv("DEPOSIT_POLL_ENABLED", "default true")))
    checks.append(("DEPOSIT_CREDIT_ENABLED", flag("DEPOSIT_CREDIT_ENABLED"), os.getenv("DEPOSIT_CREDIT_ENABLED", "")))
    checks.append(("IBO_DEPOSIT_ENABLED", flag("IBO_DEPOSIT_ENABLED", "true"), os.getenv("IBO_DEPOSIT_ENABLED", "")))

    from listings.deposit_catalog import _is_universal_bep20
    from listings.wallet_assets import deposit_asset_network_ok

    checks.append(("IBO uses universal BEP-20 address", _is_universal_bep20("BEP-20 (BNB Chain)", "bsc", "IBO"), ""))
    checks.append(("API allows IBO BEP-20 deposit", deposit_asset_network_ok("IBO", "BEP-20 (BNB Chain)"), ""))

    try:
        from services import blockchain_service

        prov = blockchain_service.get_provider()
        ibo_c = getattr(prov, "_ibo_contract", None)
        match_env = ibo_c == contract if ibo_c and contract else False
        checks.append(
            (
                "Provider loads same IBO contract as env",
                bool(ibo_c) and match_env,
                ibo_c or "provider has no IBO contract",
            )
        )
    except Exception as exc:  # noqa: BLE001
        checks.append(("Provider IBO contract", False, str(exc)[:100]))

    from workers.deposit_poller import (
        _build_addr_index,
        _build_network_addr_index,
        _is_dust_deposit,
        _network_watch_rows,
        _resolve_deposit_owner,
    )
    from services.blockchain_service import IncomingTx

    net = "BEP-20 (BNB Chain)"
    addr = "0xabcdef0123456789abcdef0123456789abcdef01"
    rows = [{"uid": "user_test", "asset": "USDT", "network": net, "address": addr}]
    watch = _network_watch_rows(rows, net, asset_label="IBO")
    idx = _build_addr_index(rows)
    net_idx = _build_network_addr_index(rows)
    ev = IncomingTx(
        asset="IBO",
        network=net,
        address=addr,
        amount=100.0,
        tx_hash="0xdeadbeef",
        confirmations=15,
    )
    asset, _, uid = _resolve_deposit_owner(ev, idx, net_idx)
    checks.append(
        (
            "IBO transfer to USDT-only deposit address maps to user + IBO asset",
            uid == "user_test" and asset == "IBO",
            f"uid={uid} asset={asset}",
        )
    )
    checks.append(
        (
            "BSC token scan watches all BEP-20 addresses for IBO",
            len(watch) == 1 and watch[0]["asset"] == "IBO",
            f"watch_rows={len(watch)}",
        )
    )

    ev_ok = IncomingTx(asset="IBO", network=net, address=addr, amount=5.0, tx_hash="0x1", confirmations=1)
    ev_dust = IncomingTx(asset="IBO", network=net, address=addr, amount=0.001, tx_hash="0x2", confirmations=1)
    checks.append(("5 IBO passes dust filter", not _is_dust_deposit(ev_ok), ""))
    checks.append(("0.001 IBO rejected as dust", _is_dust_deposit(ev_dust), f"MIN_WALLET_NOTIONAL_USDT={os.getenv('MIN_WALLET_NOTIONAL_USDT', '1')}"))

    print("=== TRUST WALLET IBO DEPOSIT VERIFICATION ===\n")
    ok = fail = 0
    for name, passed, detail in checks:
        mark = "PASS" if passed else "FAIL"
        ok += passed
        fail += not passed
        suffix = f" — {detail}" if detail else ""
        print(f"[{mark}] {name}{suffix}")
    print(f"\n--- {ok}/{len(checks)} checks passed ---")
    if fail:
        print("\nFix FAIL items before expecting Trust Wallet IBO to credit.")
    else:
        print("Still required: correct address from app, BSC network, KYC, deploy + restart, rescan for old txs.")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
