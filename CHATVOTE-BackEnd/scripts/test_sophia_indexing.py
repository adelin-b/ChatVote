"""Quick test: index a candidate website from Drive by URL or candidate_id.

Usage:
    poetry run python scripts/test_sophia_indexing.py https://sophiapourparis.fr
    poetry run python scripts/test_sophia_indexing.py cand-75056-8
    poetry run python scripts/test_sophia_indexing.py  # defaults to Sophia
"""
import asyncio
import logging
import os
import sys
import time

os.environ["DEBUG_INDEXER"] = "1"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    from src.services.data_pipeline.crawl_scraper import load_scraped_from_drive
    from src.services.candidate_indexer import create_documents_from_scraped_website
    from src.models.candidate import Candidate

    arg = sys.argv[1] if len(sys.argv) > 1 else "https://sophiapourparis.fr"

    # Resolve: URL → find candidate, or candidate_id → load from Firestore
    if arg.startswith("http"):
        website_url = arg
        # Try to find the candidate in Firestore by website_url
        from src.firebase_service import async_db
        candidate = None
        async for doc in async_db.collection("candidates").stream():
            data = doc.to_dict()
            if (data.get("website_url") or "").rstrip("/") == website_url.rstrip("/"):
                candidate = Candidate(**data)
                break
        if not candidate:
            logger.info(f"No candidate found for {website_url}, using stub")
            candidate = Candidate(
                candidate_id="test-url",
                first_name="Test",
                last_name="Candidate",
                website_url=website_url,
                election_type_id="municipales",
            )
    elif arg.startswith("cand-"):
        from src.firebase_service import aget_candidate_by_id
        candidate = await aget_candidate_by_id(arg)
        if not candidate:
            logger.error(f"Candidate {arg} not found")
            return
        website_url = candidate.website_url
    else:
        logger.error(f"Usage: {sys.argv[0]} <url|candidate_id>")
        return

    logger.info(f"Candidate: {candidate.full_name} ({candidate.candidate_id})")
    logger.info(f"Website: {website_url}")

    # Step 1: Load from Drive
    t0 = time.monotonic()
    sw = await load_scraped_from_drive(candidate.candidate_id, website_url)
    if not sw:
        logger.error("No Drive data found!")
        return
    t_load = time.monotonic() - t0
    logger.info(f"Loaded {len(sw.pages)} pages, {sw.total_content_length} chars in {t_load:.1f}s")

    # Show pages
    logger.info("\n=== PAGES AFTER FILTERING ===")
    for p in sorted(sw.pages, key=lambda x: -len(x.content)):
        logger.info(f"  {p.url:70s}  {len(p.content):>7d} chars  type={p.page_type}")

    # Step 2: Chunk
    t1 = time.monotonic()
    docs = create_documents_from_scraped_website(candidate, sw)
    t_chunk = time.monotonic() - t1
    logger.info(f"\n=== CHUNKING: {len(docs)} chunks in {t_chunk:.1f}s ===")

    # Step 3: Classify themes
    if "--no-classify" in sys.argv:
        logger.info("Skipping theme classification (--no-classify)")
        total = time.monotonic() - t0
        logger.info(f"\n=== TOTAL: {total:.1f}s (load={t_load:.1f}s chunk={t_chunk:.1f}s) ===")
        return

    t2 = time.monotonic()
    from src.services.theme_classifier import classify_chunks, apply_themes_to_documents
    chunk_texts = [doc.page_content for doc in docs]
    theme_results = await classify_chunks(chunk_texts)
    apply_themes_to_documents(docs, theme_results)
    t_classify = time.monotonic() - t2

    keyword_count = sum(1 for r in theme_results if r.method == "keyword")
    llm_count = sum(1 for r in theme_results if r.method == "llm")
    none_count = sum(1 for r in theme_results if r.method == "none")
    classified = sum(1 for r in theme_results if r.theme is not None)

    logger.info(f"\n=== THEME CLASSIFICATION in {t_classify:.1f}s ===")
    logger.info(f"  classified={classified}/{len(docs)} keyword={keyword_count} llm={llm_count} none={none_count}")

    theme_dist: dict[str, int] = {}
    for r in theme_results:
        if r.theme:
            theme_dist[r.theme] = theme_dist.get(r.theme, 0) + 1
    logger.info(f"  distribution: {dict(sorted(theme_dist.items(), key=lambda x: -x[1]))}")

    total = time.monotonic() - t0
    logger.info(f"\n=== TOTAL: {total:.1f}s (load={t_load:.1f}s chunk={t_chunk:.1f}s classify={t_classify:.1f}s) ===")


if __name__ == "__main__":
    asyncio.run(main())
