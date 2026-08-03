"""IBO backend service layer.

Modules inside this package own business logic that `server.py` composes:

- ``db``              – shared Motor client/database accessor
- ``errors``          – typed exceptions raised by services
- ``wallet_service``  – atomic wallet operations + ``wallet_txns`` ledger

`server.py` is the HTTP/WebSocket entry point and should delegate all
balance-changing work to these services so every mutation produces exactly
one ledger row.
"""

from . import db, errors, wallet_service, blockchain_service  # noqa: F401
