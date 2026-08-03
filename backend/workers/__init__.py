"""IBO backend background workers.

Each submodule exposes:

- ``start(db, ...)``  — kicks off the background task (returns an ``asyncio.Task``).
- ``stop(task)``      — gracefully cancels.

Workers are opt-in via environment variables so local/dev deploys stay
lightweight and a misconfigured production deploy doesn't accidentally
start scanning mainnet.
"""
