"""Options fee treasury (credits collected trade fees into a dedicated options USDT wallet).

* If ``OPTIONS_FEE_SINK_UID`` is **unset**: defaults to ``__OPTIONS_FEE_SINK__`` (internal uid).
* If set to **empty string**: fee sink is disabled (fees debit users only — legacy / burn behaviour).
"""

from __future__ import annotations

import os
from typing import Optional

_DEFAULT_SINK = "__OPTIONS_FEE_SINK__"


def get_fee_sink_uid() -> Optional[str]:
    """Return uid to credit with options trade fees, or ``None`` when disabled."""
    if "OPTIONS_FEE_SINK_UID" not in os.environ:
        return _DEFAULT_SINK
    raw = os.environ.get("OPTIONS_FEE_SINK_UID", "")
    s = str(raw).strip()
    return s or None
