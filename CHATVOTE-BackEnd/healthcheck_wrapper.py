"""
Production wrapper: skip startup Firestore listeners and rate limit reset.
The server serves HTTP requests immediately. Listeners can be started
manually via admin endpoints if needed.
"""

import os
import logging

# Socket.IO re-enabled now that Firestore uses sync client in run_in_executor

from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("wrapper")

if __name__ == "__main__":
    logger.info("=== production wrapper: importing app ===")

    from src.aiohttp_app import app

    # Remove all on_startup handlers — they try async Firestore operations
    # that block the gRPC event loop on Scaleway serverless containers.
    app.on_startup.clear()
    logger.info("Cleared on_startup handlers (Firestore listeners skipped)")

    # ── Diagnostic endpoint to test Firestore connectivity ──
    import asyncio

    async def firestore_diag(request):
        """Test Firestore sync client connectivity with timeout."""
        import time
        from src.firebase_service import db as sync_db

        results = {}

        # Test 1: simple document read with timeout
        def _test_read():
            start = time.monotonic()
            try:
                doc = sync_db.collection("municipalities").document("75056").get()
                elapsed = round(time.monotonic() - start, 3)
                return {"ok": True, "exists": doc.exists, "elapsed_s": elapsed}
            except Exception as e:
                elapsed = round(time.monotonic() - start, 3)
                return {"ok": False, "error": str(e), "elapsed_s": elapsed}

        loop = asyncio.get_event_loop()
        try:
            results["sync_read"] = await asyncio.wait_for(
                loop.run_in_executor(None, _test_read), timeout=15
            )
        except asyncio.TimeoutError:
            results["sync_read"] = {"ok": False, "error": "timeout after 15s"}

        return web.json_response(results)

    app.router.add_get("/diag/firestore", firestore_diag)

    async def qdrant_diag(request):
        """Test raw HTTP connectivity to QDRANT_URL."""
        import aiohttp as _aiohttp
        import socket
        import time

        qdrant_url = os.getenv("QDRANT_URL", "unknown")
        results = {"qdrant_url": qdrant_url}

        # Test 1: DNS resolution
        try:
            from urllib.parse import urlparse

            parsed = urlparse(qdrant_url)
            host = parsed.hostname
            start = time.monotonic()
            addrs = socket.getaddrinfo(host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
            elapsed = round(time.monotonic() - start, 3)
            results["dns"] = {
                "ok": True,
                "host": host,
                "addresses": [a[4][0] for a in addrs[:5]],
                "elapsed_s": elapsed,
            }
        except Exception as e:
            results["dns"] = {"ok": False, "error": str(e)}

        # Test 2: raw HTTP GET /collections
        try:
            start = time.monotonic()
            async with _aiohttp.ClientSession() as session:
                async with session.get(
                    f"{qdrant_url}/collections",
                    timeout=_aiohttp.ClientTimeout(total=10),
                ) as resp:
                    body = await resp.text()
                    elapsed = round(time.monotonic() - start, 3)
                    results["http_get"] = {
                        "ok": resp.status == 200,
                        "status": resp.status,
                        "body_preview": body[:200],
                        "elapsed_s": elapsed,
                    }
        except Exception as e:
            results["http_get"] = {"ok": False, "error": str(e)}

        # Test 3: qdrant-client
        try:
            from src.vector_store_helper import qdrant_client as qc

            start = time.monotonic()
            cols = qc.get_collections()
            elapsed = round(time.monotonic() - start, 3)
            results["qdrant_client"] = {
                "ok": True,
                "collections": [c.name for c in cols.collections],
                "elapsed_s": elapsed,
            }
        except Exception as e:
            results["qdrant_client"] = {"ok": False, "error": str(e)}

        return web.json_response(results)

    app.router.add_get("/diag/qdrant", qdrant_diag)

    logger.info("=== starting app on 0.0.0.0:8080 ===")
    web.run_app(app, host="0.0.0.0", port=8080)
