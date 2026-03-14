#!/usr/bin/env python3
"""
Test profession de foi indexer on Paris (75056) only.

This script:
1. Downloads the 9 Paris profession de foi PDFs from interieur.gouv.fr
2. Indexes them via profession_indexer (upload to Firebase Storage + Qdrant)
3. Verifies the chunks are in Qdrant and Firestore URLs are updated

Usage:
    cd CHATVOTE-BackEnd
    poetry run python scripts/test_profession_indexer_paris.py
"""

import asyncio
import logging
import os
import sys
import tempfile
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

PARIS_CODE = "75056"
PARIS_PANNEAUX = list(range(1, 10))  # 9 candidates
PDF_URL_TPL = "https://programme-candidats.interieur.gouv.fr/elections-municipales-2026/data-pdf/1-{commune}-{panneau}.pdf"

PDF_CACHE_DIR = Path(tempfile.gettempdir()) / "chatvote_professions_pdfs"


async def step1_download_paris_pdfs() -> list[tuple[str, str]]:
    """Download Paris profession de foi PDFs. Returns [(candidate_id, pdf_path), ...]."""
    import aiohttp

    logger.info("=== Step 1: Download Paris PDFs ===")
    commune_dir = PDF_CACHE_DIR / PARIS_CODE
    commune_dir.mkdir(parents=True, exist_ok=True)

    downloaded = []
    async with aiohttp.ClientSession() as session:
        for panneau in PARIS_PANNEAUX:
            url = PDF_URL_TPL.format(commune=PARIS_CODE, panneau=panneau)
            pdf_path = commune_dir / f"1-{PARIS_CODE}-{panneau}.pdf"

            # Skip if already cached
            if pdf_path.exists() and pdf_path.stat().st_size > 100:
                logger.info(f"  [cached] panneau {panneau}: {pdf_path.name} ({pdf_path.stat().st_size:,} bytes)")
                downloaded.append((f"cand-{PARIS_CODE}-{panneau}", str(pdf_path)))
                continue

            try:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        logger.warning(f"  [skip] panneau {panneau}: HTTP {resp.status}")
                        continue
                    content = await resp.read()
                    if not content[:4] == b"%PDF":
                        logger.warning(f"  [skip] panneau {panneau}: not a PDF")
                        continue
                    pdf_path.write_bytes(content)
                    logger.info(f"  [downloaded] panneau {panneau}: {len(content):,} bytes")
                    downloaded.append((f"cand-{PARIS_CODE}-{panneau}", str(pdf_path)))
            except Exception as e:
                logger.error(f"  [error] panneau {panneau}: {e}")

    logger.info(f"Downloaded {len(downloaded)}/{len(PARIS_PANNEAUX)} PDFs for Paris")
    return downloaded


async def step2_index_professions(downloaded: list[tuple[str, str]]) -> dict[str, int]:
    """Index downloaded PDFs via profession_indexer."""
    from src.services.profession_indexer import index_candidate_profession

    logger.info("=== Step 2: Index professions de foi ===")
    results = {}
    for candidate_id, pdf_path in downloaded:
        try:
            count = await index_candidate_profession(candidate_id, pdf_path)
            results[candidate_id] = count
            logger.info(f"  {candidate_id}: {count} chunks indexed")
        except Exception as e:
            logger.error(f"  {candidate_id}: FAILED — {e}")
            results[candidate_id] = 0

    return results


async def step3_verify(results: dict[str, int]) -> None:
    """Verify chunks are in Qdrant and Firestore URLs point to Firebase Storage."""
    logger.info("=== Step 3: Verify ===")

    # Check Qdrant
    from src.vector_store_helper import qdrant_client
    from src.services.candidate_indexer import CANDIDATES_INDEX_NAME
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    profession_filter = Filter(
        must=[
            FieldCondition(
                key="metadata.municipality_code",
                match=MatchValue(value=PARIS_CODE),
            ),
            FieldCondition(
                key="metadata.source_document",
                match=MatchValue(value="profession_de_foi"),
            ),
        ]
    )

    try:
        count_result = qdrant_client.count(
            collection_name=CANDIDATES_INDEX_NAME,
            count_filter=profession_filter,
        )
        logger.info(f"  Qdrant: {count_result.count} profession_de_foi chunks for Paris")
    except Exception as e:
        logger.error(f"  Qdrant count failed: {e}")

    # Check Firestore URLs
    from src.firebase_service import async_db

    firebase_storage_count = 0
    gov_url_count = 0
    for candidate_id in results:
        try:
            doc = await async_db.collection("candidates").document(candidate_id).get()
            if doc.exists:
                data = doc.to_dict()
                url = data.get("manifesto_pdf_url", "")
                if "firebasestorage.googleapis.com" in url:
                    firebase_storage_count += 1
                elif "programme-candidats.interieur.gouv.fr" in url:
                    gov_url_count += 1
                    logger.warning(f"  {candidate_id}: still points to interieur.gouv!")
        except Exception as e:
            logger.error(f"  Firestore check failed for {candidate_id}: {e}")

    logger.info(
        f"  Firestore: {firebase_storage_count} candidates now point to Firebase Storage, "
        f"{gov_url_count} still point to interieur.gouv"
    )

    # Sample a chunk to show metadata
    try:
        sample_points, _ = qdrant_client.scroll(
            collection_name=CANDIDATES_INDEX_NAME,
            scroll_filter=profession_filter,
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        if sample_points:
            meta = sample_points[0].payload.get("metadata", {})
            content = sample_points[0].payload.get("page_content", "")[:200]
            logger.info("  Sample chunk metadata:")
            logger.info(f"    namespace: {meta.get('namespace')}")
            logger.info(f"    source_document: {meta.get('source_document')}")
            logger.info(f"    fiabilite: {meta.get('fiabilite')}")
            logger.info(f"    document_name: {meta.get('document_name')}")
            logger.info(f"    url: {meta.get('url', '')[:80]}...")
            logger.info(f"    page: {meta.get('page')}")
            logger.info(f"    content preview: {content}...")
    except Exception as e:
        logger.error(f"  Sample query failed: {e}")


async def main():
    logger.info("Testing profession de foi indexer on Paris (75056)")
    logger.info(f"ENV={os.getenv('ENV', 'dev')}")
    logger.info(f"PDF cache dir: {PDF_CACHE_DIR}")

    # Step 1: Download PDFs
    downloaded = await step1_download_paris_pdfs()
    if not downloaded:
        logger.error("No PDFs downloaded, aborting")
        return

    # Step 2: Index
    results = await step2_index_professions(downloaded)

    # Step 3: Verify
    await step3_verify(results)

    # Summary
    total = sum(results.values())
    successful = sum(1 for v in results.values() if v > 0)
    logger.info("\n=== Summary ===")
    logger.info(f"Candidates: {successful}/{len(results)} indexed successfully")
    logger.info(f"Total chunks: {total}")
    for cid, count in sorted(results.items()):
        status = "OK" if count > 0 else "FAIL"
        logger.info(f"  [{status}] {cid}: {count} chunks")


if __name__ == "__main__":
    asyncio.run(main())
