"""Quick test: index a single profession de foi PDF with detailed OCR cascade logging.

Usage:
    poetry run python scripts/test_profession_indexing.py cand-33039-5
    poetry run python scripts/test_profession_indexing.py cand-75056-8
    poetry run python scripts/test_profession_indexing.py cand-33039-5 --no-index  # OCR only, skip Qdrant
"""

import asyncio
import logging
import os
import sys
import tempfile
import time
from pathlib import Path

# Ensure src is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

os.environ["DEBUG_INDEXER"] = "1"

from src.utils import load_env  # noqa: E402

load_env()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


async def main():
    from src.firebase_service import aget_candidate_by_id
    from src.services.manifesto_indexer import extract_pages_from_pdf
    from src.services.profession_indexer import (
        _extract_pages_with_gemini,
        _is_real_content,
        _ocr_pdf_scaleway,
        _ocr_pdf_tesseract,
    )

    candidate_id = sys.argv[1] if len(sys.argv) > 1 else "cand-33039-5"
    no_index = "--no-index" in sys.argv

    logger.info(f"=== Testing profession de foi indexing for {candidate_id} ===")

    # Step 1: Load candidate from Firestore
    t0 = time.monotonic()
    candidate = await aget_candidate_by_id(candidate_id)
    if not candidate:
        logger.error(f"Candidate {candidate_id} not found in Firestore")
        return
    t_load = time.monotonic() - t0
    logger.info(
        f"Candidate: {candidate.full_name} ({candidate.candidate_id}) [{t_load:.1f}s]"
    )

    # Step 2: Download PDF from Firebase Storage
    t1 = time.monotonic()
    pdf_bytes = await _download_pdf(candidate_id, candidate)
    if not pdf_bytes:
        logger.error("Could not download PDF — aborting")
        return
    t_download = time.monotonic() - t1
    logger.info(f"PDF downloaded: {len(pdf_bytes):,} bytes [{t_download:.1f}s]")

    # Step 3: Run each OCR tier independently and compare
    logger.info("\n" + "=" * 60)
    logger.info("=== OCR CASCADE COMPARISON ===")
    logger.info("=" * 60)

    results = {}

    # Tier 1: pypdf
    t2 = time.monotonic()
    pages_pypdf = extract_pages_from_pdf(pdf_bytes)
    t_pypdf = time.monotonic() - t2
    chars_pypdf = sum(len(t) for _, t in pages_pypdf) if pages_pypdf else 0
    is_real_pypdf = _is_real_content(pages_pypdf) if pages_pypdf else False
    results["pypdf"] = (pages_pypdf, chars_pypdf, t_pypdf, is_real_pypdf)
    logger.info(
        f"\n--- Tier 1: pypdf ---\n"
        f"  Pages: {len(pages_pypdf)}, Chars: {chars_pypdf:,}, "
        f"Real content: {is_real_pypdf}, Time: {t_pypdf:.2f}s"
    )
    if pages_pypdf:
        for pn, txt in pages_pypdf:
            logger.info(f"  Page {pn}: {len(txt):,} chars — {txt[:100]!r}...")

    # Tier 2: Scaleway vision (production order: Scaleway before tesseract)
    t3 = time.monotonic()
    pages_scw = await _ocr_pdf_scaleway(pdf_bytes)
    t_scw = time.monotonic() - t3
    chars_scw = sum(len(t) for _, t in pages_scw) if pages_scw else 0
    is_real_scw = _is_real_content(pages_scw) if pages_scw else False
    results["scaleway"] = (pages_scw, chars_scw, t_scw, is_real_scw)
    logger.info(
        f"\n--- Tier 2: Scaleway vision (Mistral Small 3.2) ---\n"
        f"  Pages: {len(pages_scw)}, Chars: {chars_scw:,}, "
        f"Real content: {is_real_scw}, Time: {t_scw:.2f}s"
    )
    if pages_scw:
        for pn, txt in pages_scw:
            logger.info(f"  Page {pn}: {len(txt):,} chars — {txt[:100]!r}...")

    # Tier 3: tesseract (fallback if Scaleway unavailable)
    t4 = time.monotonic()
    pages_tess = _ocr_pdf_tesseract(pdf_bytes)
    t_tess = time.monotonic() - t4
    chars_tess = sum(len(t) for _, t in pages_tess) if pages_tess else 0
    is_real_tess = _is_real_content(pages_tess) if pages_tess else False
    results["tesseract"] = (pages_tess, chars_tess, t_tess, is_real_tess)
    logger.info(
        f"\n--- Tier 3: tesseract (300 DPI, fra) ---\n"
        f"  Pages: {len(pages_tess)}, Chars: {chars_tess:,}, "
        f"Real content: {is_real_tess}, Time: {t_tess:.2f}s"
    )
    if pages_tess:
        for pn, txt in pages_tess:
            logger.info(f"  Page {pn}: {len(txt):,} chars — {txt[:100]!r}...")

    # Tier 4: Gemini vision
    t5 = time.monotonic()
    pages_gem = await _extract_pages_with_gemini(pdf_bytes)
    t_gem = time.monotonic() - t5
    chars_gem = sum(len(t) for _, t in pages_gem) if pages_gem else 0
    is_real_gem = _is_real_content(pages_gem) if pages_gem else False
    results["gemini"] = (pages_gem, chars_gem, t_gem, is_real_gem)
    logger.info(
        f"\n--- Tier 4: Gemini vision ---\n"
        f"  Pages: {len(pages_gem)}, Chars: {chars_gem:,}, "
        f"Real content: {is_real_gem}, Time: {t_gem:.2f}s"
    )
    if pages_gem:
        for pn, txt in pages_gem:
            logger.info(f"  Page {pn}: {len(txt):,} chars — {txt[:100]!r}...")

    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("=== CASCADE SUMMARY ===")
    logger.info("=" * 60)
    logger.info(f"{'Method':<12} {'Pages':>5} {'Chars':>8} {'Real?':>6} {'Time':>8}")
    logger.info("-" * 45)
    winner = None
    for method, (pages, chars, t, is_real) in results.items():
        mark = ""
        if is_real and winner is None:
            winner = method
            mark = " <-- WINNER"
        logger.info(
            f"{method:<12} {len(pages):>5} {chars:>8,} {'YES' if is_real else 'NO':>6} {t:>7.2f}s{mark}"
        )

    if winner:
        logger.info(f"\nCascade would select: {winner}")
    else:
        logger.info("\nNo tier produced real content!")

    # Step 4: Chunk the winner
    if winner:
        from langchain_text_splitters import RecursiveCharacterTextSplitter

        winning_pages = results[winner][0]
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            separators=["\n\n", "\n", ". ", "? ", "! ", "; ", " ", ""],
        )
        chunks = []
        for pn, txt in winning_pages:
            for chunk in splitter.split_text(txt):
                if len(chunk.strip()) >= 30:
                    chunks.append((pn, chunk))
        logger.info(
            f"\nChunking ({winner}): {len(chunks)} chunks from {len(winning_pages)} pages"
        )

    # Step 5: Full index (unless --no-index)
    if not no_index and winner:
        logger.info("\n=== FULL INDEX RUN ===")
        # Save PDF to temp file for the indexer
        tmp = Path(tempfile.gettempdir()) / f"test_profession_{candidate_id}.pdf"
        tmp.write_bytes(pdf_bytes)
        from src.services.profession_indexer import index_candidate_profession

        t6 = time.monotonic()
        count = await index_candidate_profession(candidate_id, str(tmp))
        t_index = time.monotonic() - t6
        logger.info(f"Indexed {count} chunks in {t_index:.1f}s")
        tmp.unlink(missing_ok=True)

    total = time.monotonic() - t0
    logger.info(f"\n=== TOTAL: {total:.1f}s ===")


async def _download_pdf(candidate_id: str, candidate) -> bytes | None:
    """Download the profession de foi PDF from Firebase Storage."""
    # Try manifesto_pdf_url from Firestore first
    if hasattr(candidate, "manifesto_pdf_url") and candidate.manifesto_pdf_url:
        import aiohttp

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(candidate.manifesto_pdf_url) as resp:
                    if resp.status == 200:
                        data = await resp.read()
                        logger.info(
                            f"Downloaded from manifesto_pdf_url: {len(data):,} bytes"
                        )
                        return data
        except Exception as e:
            logger.warning(f"Failed to download from manifesto_pdf_url: {e}")

    # Fallback: construct Firebase Storage URL
    bucket_name = os.environ.get(
        "FIREBASE_STORAGE_BUCKET", "chat-vote-dev.firebasestorage.app"
    )
    commune_code = candidate.municipality_code or (
        candidate_id.split("-")[1] if len(candidate_id.split("-")) >= 3 else "unknown"
    )
    blob_path = f"public/professions_de_foi/{commune_code}/{candidate_id}.pdf"
    url = (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}"
        f"/o/{blob_path.replace('/', '%2F')}?alt=media"
    )

    import aiohttp

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    logger.info(f"Downloaded from Storage: {len(data):,} bytes")
                    return data
                else:
                    logger.warning(f"Storage download failed: HTTP {resp.status}")
    except Exception as e:
        logger.warning(f"Storage download failed: {e}")

    # Last resort: check local cache
    tmp_dir = Path(tempfile.gettempdir()) / "chatvote_professions_pdfs" / commune_code
    for pdf_path in tmp_dir.glob(f"*-{commune_code}-*.pdf"):
        panneau = pdf_path.stem.split("-")[-1]
        if candidate_id.endswith(f"-{panneau}"):
            logger.info(f"Found in local cache: {pdf_path}")
            return pdf_path.read_bytes()

    return None


if __name__ == "__main__":
    asyncio.run(main())
