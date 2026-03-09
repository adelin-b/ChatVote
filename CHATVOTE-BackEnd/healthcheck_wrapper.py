"""
Diagnostic wrapper: import real app, inspect on_startup handlers,
then serve with timeout protection on each handler.
"""
import asyncio
import logging
import sys
import traceback

from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("wrapper")


if __name__ == "__main__":
    logger.info("=== wrapper: importing real app ===")

    try:
        from src import aiohttp_app

        real_app = aiohttp_app.app
        logger.info(f"=== wrapper: real app loaded, {len(real_app.on_startup)} on_startup handlers ===")

        for i, handler in enumerate(real_app.on_startup):
            logger.info(f"  on_startup[{i}]: {handler.__name__} from {handler.__module__}")

        # Replace all on_startup handlers with timeout-protected versions
        original_handlers = list(real_app.on_startup)
        real_app.on_startup.clear()

        async def safe_startup(app):
            for i, handler in enumerate(original_handlers):
                name = f"{handler.__module__}.{handler.__name__}"
                logger.info(f"=== wrapper: running on_startup[{i}] {name} ===")
                try:
                    await asyncio.wait_for(handler(app), timeout=15)
                    logger.info(f"=== wrapper: on_startup[{i}] {name} completed ===")
                except asyncio.TimeoutError:
                    logger.error(f"=== wrapper: on_startup[{i}] {name} TIMED OUT (15s) — SKIPPING ===")
                except Exception as e:
                    logger.error(f"=== wrapper: on_startup[{i}] {name} FAILED: {e} ===")

        real_app.on_startup.append(safe_startup)

        logger.info("=== wrapper: starting real app on 0.0.0.0:8080 ===")
        web.run_app(real_app, host="0.0.0.0", port=8080)

    except Exception as e:
        logger.error(f"=== FATAL: {e} ===")
        logger.error(traceback.format_exc())

        async def error_health(request):
            return web.json_response(
                {"status": "error", "error": str(e)},
                status=500,
            )

        fallback = web.Application()
        fallback.router.add_route("*", "/{path:.*}", error_health)
        web.run_app(fallback, host="0.0.0.0", port=8080)
