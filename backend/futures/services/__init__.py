"""Service-layer entry points for the futures engine.

Each service is intentionally small and synchronous-friendly so they can
be unit tested in isolation. Cross-service orchestration lives in
``services.orders`` (place/cancel) and ``services.matching`` (fill).
"""
