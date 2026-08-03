"""IBO Perpetual Futures module.

This package is intentionally **isolated** from the existing spot trading
code. Spot uses ``wallets`` / ``orders`` / ``trades`` collections; futures
uses ``futures_*`` collections, its own matching engine, position book,
mark-price feed, liquidation engine, and funding-rate scheduler.

Public surface:

- :mod:`backend.futures.api`     — FastAPI REST router (``/api/futures/...``)
- :mod:`backend.futures.ws`      — WebSocket router (``/ws/futures/...``)
- :mod:`backend.futures.workers` — mark-price / liquidation / funding loops
- :func:`futures.bootstrap.bootstrap_futures` — startup hook

Mount from ``server.py`` with::

    from futures.bootstrap import bootstrap_futures
    from futures.api import router as futures_router
    from futures.ws  import router as futures_ws_router

    app.include_router(futures_router)
    app.include_router(futures_ws_router)
    await bootstrap_futures()  # creates indexes + starts workers
"""

from . import constants  # noqa: F401
