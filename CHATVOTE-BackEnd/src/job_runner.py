"""CLI entrypoint for K8s CronJobs.

Usage:
    python -m src.job_runner crawl_scraper
    python -m src.job_runner indexer
"""
from __future__ import annotations

import asyncio
import logging
import sys


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        stream=sys.stdout,
    )


async def _run(node_id: str) -> None:
    # Import pipeline modules AFTER env vars are loaded so that firebase_service
    # initialises with the correct credentials.
    from src.services.data_pipeline.base import PIPELINE_NODES

    # Import the node modules to trigger their register_node() calls.
    import src.services.data_pipeline.crawl_scraper  # noqa: F401
    import src.services.data_pipeline.indexer  # noqa: F401

    node = PIPELINE_NODES.get(node_id)
    if node is None:
        logging.error("Unknown node_id %r. Available: %s", node_id, list(PIPELINE_NODES))
        sys.exit(1)

    await node.execute(force=True)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    node_id = sys.argv[1]

    _configure_logging()

    # Load .env before importing anything that touches Firebase.
    from src.utils import load_env
    load_env()

    try:
        asyncio.run(_run(node_id))
    except Exception:
        logging.exception("Job %r failed", node_id)
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
