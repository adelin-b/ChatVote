"""
Wrapper v5: test different app configurations to find what blocks HTTP.
Serves a fresh aiohttp app that manually adds the healthz + assistant routes.
"""
import os
import logging

os.environ["DISABLE_SOCKETIO"] = "1"

from aiohttp import web

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("wrapper")

if __name__ == "__main__":
    logger.info("=== wrapper v5: building fresh app ===")

    # Import just what we need for basic routes
    from src.aiohttp_app import app as real_app

    # Create a completely fresh app — no middleware, no CORS, no Socket.IO
    test_app = web.Application()

    # Manually add a few routes
    async def health(request):
        return web.json_response({"status": "ok"})

    async def assistant(request):
        from src.models.assistant import CHATVOTE_ASSISTANT
        return web.json_response(CHATVOTE_ASSISTANT.model_dump())

    async def commune_dashboard(request):
        commune_code = request.match_info["commune_code"]
        from src.aiohttp_app import commune_dashboard as real_handler
        return await real_handler(request)

    test_app.router.add_get("/healthz", health)
    test_app.router.add_get("/health", health)
    test_app.router.add_get("/api/v1/assistant", assistant)

    # Count routes in real app vs test app
    real_routes = list(real_app.router.routes())
    test_routes = list(test_app.router.routes())
    logger.info(f"Real app: {len(real_routes)} routes, Test app: {len(test_routes)} routes")
    logger.info(f"Real app middlewares: {len(real_app.middlewares)}")
    logger.info(f"Real app on_startup: {len(real_app.on_startup)}")

    logger.info("=== wrapper: starting TEST app on 0.0.0.0:8080 ===")
    web.run_app(test_app, host="0.0.0.0", port=8080)
