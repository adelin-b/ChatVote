"""Crawl and index all candidate websites with configurable concurrency.

Resumable: checks Qdrant for existing chunks per candidate and skips
those already indexed. Use --force to re-crawl everything.
"""
import asyncio
import logging
import os
import sys
import time

# Add project root to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.utils import load_env
load_env()

from src.services.candidate_indexer import (  # noqa: E402
    index_candidate_website,
    CANDIDATES_INDEX_NAME,
)
from src.services.candidate_website_scraper import CandidateWebsiteScraper  # noqa: E402
from src.firebase_service import aget_candidates_with_website  # noqa: E402
from src.vector_store_helper import qdrant_client  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

MAX_CONCURRENT = int(os.getenv("CRAWL_CONCURRENCY", "15"))
FORCE = "--force" in sys.argv


def get_indexed_candidate_ids() -> dict[str, int]:
    """Return {candidate_id: chunk_count} for candidates already in Qdrant."""
    try:
        # Scroll through all points and count per namespace
        counts: dict[str, int] = {}
        offset = None
        while True:
            results, offset = qdrant_client.scroll(
                collection_name=CANDIDATES_INDEX_NAME,
                limit=100,
                offset=offset,
                with_payload=["metadata.namespace"],
                with_vectors=False,
            )
            if not results:
                break
            for point in results:
                ns = point.payload.get("metadata", {}).get("namespace", "")
                if ns:
                    counts[ns] = counts.get(ns, 0) + 1
            if offset is None:
                break
        return counts
    except Exception as e:
        logger.warning(f"Could not check existing index: {e}")
        return {}


async def crawl_and_index_one(candidate, scraper, semaphore, results):
    """Crawl + index a single candidate, respecting semaphore."""
    async with semaphore:
        cid = candidate.candidate_id
        name = candidate.full_name
        city = candidate.municipality_name or "?"
        url = candidate.website_url
        logger.info(f"[START] {cid} — {name} ({city}) — {url}")
        t0 = time.time()
        try:
            scraped = await scraper.scrape_candidate_website(candidate)
            if scraped and scraped.is_successful:
                count = await index_candidate_website(candidate, scraped)
                elapsed = time.time() - t0
                logger.info(f"[OK]    {cid} — {count} chunks indexed ({elapsed:.1f}s)")
                results[cid] = {"status": "ok", "chunks": count, "time": elapsed}
            else:
                elapsed = time.time() - t0
                err = scraped.error if scraped else "no result"
                logger.warning(f"[FAIL]  {cid} — scrape failed: {err} ({elapsed:.1f}s)")
                results[cid] = {"status": "scrape_failed", "error": str(err), "time": elapsed}
        except Exception as e:
            elapsed = time.time() - t0
            logger.error(f"[ERROR] {cid} — {e} ({elapsed:.1f}s)")
            results[cid] = {"status": "error", "error": str(e), "time": elapsed}


async def main():
    logger.info(f"=== Candidate Website Crawler (concurrency={MAX_CONCURRENT}, force={FORCE}) ===")

    candidates = await aget_candidates_with_website()
    logger.info(f"Found {len(candidates)} candidates with websites")

    if not candidates:
        logger.warning("No candidates to crawl!")
        return

    # Check which are already indexed
    if not FORCE:
        indexed = get_indexed_candidate_ids()
        already = [c for c in candidates if c.candidate_id in indexed]
        candidates = [c for c in candidates if c.candidate_id not in indexed]
        if already:
            logger.info(
                f"Skipping {len(already)} already-indexed candidates "
                f"(total {sum(indexed.get(c.candidate_id, 0) for c in already)} chunks). "
                f"Use --force to re-crawl."
            )
            for c in already:
                logger.info(f"  [SKIP] {c.candidate_id} — {indexed[c.candidate_id]} chunks")

    if not candidates:
        logger.info("All candidates already indexed! Nothing to do.")
        return

    logger.info(f"Will crawl {len(candidates)} candidates")

    scraper = CandidateWebsiteScraper()
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    results = {}

    t_start = time.time()
    tasks = [
        crawl_and_index_one(c, scraper, semaphore, results)
        for c in candidates
    ]
    await asyncio.gather(*tasks)
    total_time = time.time() - t_start

    # Summary
    ok = sum(1 for r in results.values() if r["status"] == "ok")
    failed = sum(1 for r in results.values() if r["status"] != "ok")
    total_chunks = sum(r.get("chunks", 0) for r in results.values())

    print(f"\n{'='*60}")
    print(f"CRAWL COMPLETE in {total_time:.0f}s ({total_time/60:.1f}min)")
    print(f"  OK: {ok}/{len(results)} candidates")
    print(f"  Failed: {failed}/{len(results)}")
    print(f"  Total chunks indexed: {total_chunks}")
    print(f"{'='*60}")

    if failed:
        print("\nFailed candidates:")
        for cid, r in sorted(results.items()):
            if r["status"] != "ok":
                print(f"  [{r['status']}] {cid}: {r.get('error', '?')}")


if __name__ == "__main__":
    asyncio.run(main())
