"""Service-layer exceptions.

Services raise these so callers (HTTP handlers, workers, scripts) can decide
how to surface the failure. `server.py` translates ``InsufficientFundsError``
into a 400 ``HTTPException`` to preserve existing API behaviour.
"""

from __future__ import annotations


class WalletError(Exception):
    """Base class for wallet-service exceptions."""


class InsufficientFundsError(WalletError):
    """Raised when an atomic debit/lock cannot be satisfied."""

    def __init__(
        self,
        uid: str,
        asset: str,
        *,
        have: float,
        need: float,
        bucket: str = "available",
    ) -> None:
        self.uid = uid
        self.asset = asset
        self.have = float(have)
        self.need = float(need)
        self.bucket = bucket
        super().__init__(
            f"Insufficient {asset} {bucket} for {uid}: "
            f"have {self.have:.8f}, need {self.need:.8f}"
        )
