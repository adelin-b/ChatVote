"""
Chunk Health Audit + Heal script for ChatVote.

Scans the candidates_websites_prod Qdrant collection for common data quality
issues and optionally repairs them.

Detection rules:
  METADATA_ONLY     - chunk is a filename/path, not real content
  EMPTY_CHUNKS      - page_content is blank or whitespace
  TOO_FEW_CHUNKS    - candidate has fewer than MIN_CHUNKS_PER_CANDIDATE chunks
  NULL_THEMES       - metadata.theme is null/missing
  OCR_ARTIFACTS     - broken French words from bad OCR (spaced letters)
  DUPLICATE_CONTENT - chunks with >90% text overlap (beyond overlap window)
  ENCODING_ISSUES   - mojibake / Latin-1 mis-decoded as UTF-8

Usage:
    # Dry-run scan — all candidates
    poetry run python scripts/chunk_health_audit.py audit

    # Scan specific candidates
    poetry run python scripts/chunk_health_audit.py audit --candidates cand-33039-5,cand-08105-2

    # JSON output
    poetry run python scripts/chunk_health_audit.py audit --format json

    # Show per-point detail
    poetry run python scripts/chunk_health_audit.py audit --candidates cand-33039-5 --verbose

    # Heal specific candidates (re-downloads PDF, re-OCRs, re-indexes)
    poetry run python scripts/chunk_health_audit.py heal --candidates cand-33039-5

    # Heal all detected issues
    poetry run python scripts/chunk_health_audit.py heal --all

    # Preview heal without writing
    poetry run python scripts/chunk_health_audit.py heal --all --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Path bootstrap — allow running from project root without `src` on PYTHONPATH
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Load .env early so EMBEDDING_PROVIDER etc. are set before any heavy imports
from src.utils import load_env  # noqa: E402

load_env()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (all overridable via env or --qdrant-url)
# ---------------------------------------------------------------------------

QDRANT_URL = os.getenv("QDRANT_URL", "http://212.47.245.238:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
COLLECTION = "candidates_websites_prod"

# Minimum chunks expected for a 2-page profession de foi PDF
MIN_CHUNKS_PER_CANDIDATE = 3

# Jaccard similarity threshold for DUPLICATE_CONTENT
DUPLICATE_SIMILARITY_THRESHOLD = 0.90

# Max fraction of single-char alpha tokens before flagging OCR artifacts
OCR_SINGLE_CHAR_RATIO = 0.05

# Minimum real-word count for content to be considered meaningful
MIN_REAL_WORDS = 10

# ---------------------------------------------------------------------------
# Severity map
# ---------------------------------------------------------------------------

SEVERITY: dict[str, str] = {
    "METADATA_ONLY": "CRITICAL",
    "EMPTY_CHUNKS": "CRITICAL",
    "TOO_FEW_CHUNKS": "INFO",
    "NULL_THEMES": "WARNING",
    "OCR_ARTIFACTS": "WARNING",
    "DUPLICATE_CONTENT": "WARNING",
    "ENCODING_ISSUES": "WARNING",
}

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class ChunkIssue:
    rule: str
    point_id: Any  # Qdrant point UUID/int, or None for whole-candidate issues
    candidate_id: str
    detail: str
    content_preview: str = ""


@dataclass
class CandidateIssues:
    candidate_id: str
    chunk_count: int = 0
    issues: list[ChunkIssue] = field(default_factory=list)

    def add(self, rule: str, point_id: Any, detail: str, preview: str = "") -> None:
        self.issues.append(
            ChunkIssue(
                rule=rule,
                point_id=point_id,
                candidate_id=self.candidate_id,
                detail=detail,
                content_preview=preview[:120],
            )
        )

    def by_rule(self, rule: str) -> list[ChunkIssue]:
        return [i for i in self.issues if i.rule == rule]


@dataclass
class AuditReport:
    collection: str
    total_points: int = 0
    total_candidates: int = 0
    candidate_issues: dict[str, CandidateIssues] = field(default_factory=dict)

    def all_issues(self) -> list[ChunkIssue]:
        result: list[ChunkIssue] = []
        for ci in self.candidate_issues.values():
            result.extend(ci.issues)
        return result

    def issues_by_rule(self) -> dict[str, list[ChunkIssue]]:
        by_rule: dict[str, list[ChunkIssue]] = defaultdict(list)
        for issue in self.all_issues():
            by_rule[issue.rule].append(issue)
        return dict(by_rule)

    def affected_candidates(self, rule: str) -> list[str]:
        return sorted(
            {
                ci.candidate_id
                for ci in self.candidate_issues.values()
                if ci.by_rule(rule)
            }
        )


# ---------------------------------------------------------------------------
# Qdrant client (standalone — no full app stack import required)
# ---------------------------------------------------------------------------


def _make_qdrant_client():
    from qdrant_client import QdrantClient

    url = QDRANT_URL
    force_rest = url.startswith("https://")
    return QdrantClient(
        url=url,
        api_key=QDRANT_API_KEY,
        prefer_grpc=False,
        https=force_rest,
        port=443 if force_rest else 6333,
        timeout=60,
        check_compatibility=False,
    )


def _scroll_all_points(client, collection: str) -> list[Any]:
    """Scroll ALL points in a collection (no vectors)."""
    all_points: list[Any] = []
    offset = None
    batch = 0
    while True:
        batch += 1
        points, next_offset = client.scroll(
            collection_name=collection,
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        all_points.extend(points)
        if batch % 10 == 0:
            logger.info(f"  scrolled {len(all_points):,} points so far...")
        if next_offset is None:
            break
        offset = next_offset
    return all_points


def _scroll_candidate_points(client, collection: str, candidate_id: str) -> list[Any]:
    """Scroll all points for a single candidate namespace."""
    from qdrant_client.models import Filter, FieldCondition, MatchValue

    all_points: list[Any] = []
    offset = None
    while True:
        points, next_offset = client.scroll(
            collection_name=collection,
            scroll_filter=Filter(
                must=[
                    FieldCondition(
                        key="metadata.namespace",
                        match=MatchValue(value=candidate_id),
                    )
                ]
            ),
            limit=500,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        all_points.extend(points)
        if next_offset is None:
            break
        offset = next_offset
    return all_points


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------

_FILE_ARTIFACT_RE = re.compile(
    r"[a-z0-9_.\-]+\.(pdf|indd|ai|eps|psd|png|jpg|jpeg|docx?|xlsx?)\b",
    re.IGNORECASE,
)
_FRENCH_WORD_RE = re.compile(r"[a-zA-ZÀ-ÿ]{2,}", re.UNICODE)
_OCR_SPACED_RE = re.compile(
    r"\b[a-zA-ZÀ-ÿ]\s[a-zA-ZÀ-ÿ]{1,3}\s[a-zA-ZÀ-ÿ]\b", re.UNICODE
)
_MOJIBAKE_RE = re.compile(
    r"Ã©|Ã¨|Ã |Ã®|Ã»|Ã´|â€™|â€œ|â€|Â«|Â»|Ã‰|Ã€",
    re.UNICODE,
)


def _is_metadata_only(content: str) -> bool:
    """True if content looks like a filename/InDesign artifact rather than real text."""
    stripped = content.strip()
    if not stripped:
        return False  # handled separately as EMPTY_CHUNKS

    stripped_lower = stripped.lower()

    # InDesign/print artefacts: always junk regardless of word count.
    # Matches patterns like "PRUDHOMME_PF A4_RV_R39_BAT.indd   200000"
    if (
        ".indd" in stripped_lower
        or "_bat." in stripped_lower
        or " bat." in stripped_lower
    ):
        return True

    file_matches = _FILE_ARTIFACT_RE.findall(stripped)
    if file_matches:
        words = stripped.split()
        file_ratio = len(file_matches) / max(len(words), 1)
        if file_ratio > 0.5:
            return True

    real_words = _FRENCH_WORD_RE.findall(stripped)
    if len(real_words) < MIN_REAL_WORDS:
        alpha_chars = sum(1 for c in stripped if c.isalpha())
        if len(stripped) > 0 and alpha_chars / len(stripped) < 0.3:
            return True

    return False


def _has_ocr_artifacts(content: str) -> bool:
    """True if content has obvious OCR spacing artifacts (spaced letters)."""
    stripped = content.strip()
    if not stripped:
        return False

    words = stripped.split()
    if not words:
        return False

    single_chars = [w for w in words if len(re.sub(r"[^a-zA-ZÀ-ÿ]", "", w)) == 1]
    ratio = len(single_chars) / len(words)
    if ratio > OCR_SINGLE_CHAR_RATIO and len(single_chars) > 5:
        return True

    # Pattern: "e m p l o i s" style
    if len(_OCR_SPACED_RE.findall(stripped)) >= 3:
        return True

    return False


def _has_encoding_issues(content: str) -> bool:
    """True if content contains mojibake sequences."""
    return bool(_MOJIBAKE_RE.search(content))


def _chunk_fingerprint(text: str) -> frozenset:
    """
    O(n) fingerprint: frozenset of the 40 most-frequent 4-char+ words.
    Two chunks with identical fingerprints are considered near-duplicates.
    This avoids O(n²) pairwise Jaccard across all chunk pairs.
    """
    words = re.findall(r"\b\w{4,}\b", text.lower())
    if not words:
        return frozenset()
    # Count frequencies and take top-40 by frequency (stable across reorderings)
    from collections import Counter

    freq = Counter(words)
    top = frozenset(w for w, _ in freq.most_common(40))
    return top


def _jaccard_similarity(a: str, b: str) -> float:
    """Word-level Jaccard similarity (4-char+ words, case-insensitive)."""
    words_a = set(re.findall(r"\b\w{4,}\b", a.lower()))
    words_b = set(re.findall(r"\b\w{4,}\b", b.lower()))
    if not words_a or not words_b:
        return 0.0
    return len(words_a & words_b) / len(words_a | words_b)


# ---------------------------------------------------------------------------
# Core audit
# ---------------------------------------------------------------------------


def _audit_candidate(candidate_id: str, points: list[Any]) -> CandidateIssues:
    ci = CandidateIssues(candidate_id=candidate_id, chunk_count=len(points))

    # Whole-candidate check: TOO_FEW_CHUNKS
    if len(points) < MIN_CHUNKS_PER_CANDIDATE:
        ci.add(
            "TOO_FEW_CHUNKS",
            point_id=None,
            detail=f"{len(points)} chunks (expected >= {MIN_CHUNKS_PER_CANDIDATE})",
        )

    contents: list[str] = []
    point_ids: list[Any] = []

    for point in points:
        payload = point.payload or {}
        content: str = payload.get("page_content", "") or ""
        metadata: dict = payload.get("metadata", {}) or {}

        # EMPTY_CHUNKS
        if not content.strip():
            ci.add(
                "EMPTY_CHUNKS",
                point_id=point.id,
                detail="page_content is empty or whitespace",
                preview=repr(content)[:80],
            )
            contents.append("")
            point_ids.append(point.id)
            continue

        stripped = content.strip()
        contents.append(stripped)
        point_ids.append(point.id)

        # METADATA_ONLY
        if _is_metadata_only(stripped):
            ci.add(
                "METADATA_ONLY",
                point_id=point.id,
                detail="content looks like a filename or InDesign metadata blob",
                preview=stripped,
            )

        # NULL_THEMES
        theme = metadata.get("theme")
        if theme is None or theme == "":
            ci.add(
                "NULL_THEMES",
                point_id=point.id,
                detail="metadata.theme is null/missing",
                preview=stripped,
            )

        # OCR_ARTIFACTS
        if _has_ocr_artifacts(stripped):
            ci.add(
                "OCR_ARTIFACTS",
                point_id=point.id,
                detail="spaced-letter OCR artifacts detected",
                preview=stripped,
            )

        # ENCODING_ISSUES
        if _has_encoding_issues(stripped):
            ci.add(
                "ENCODING_ISSUES",
                point_id=point.id,
                detail="mojibake/encoding artifacts detected",
                preview=stripped,
            )

    # DUPLICATE_CONTENT — O(n) fingerprint hash-map (avoids O(n²) pairwise Jaccard)
    # Two chunks sharing the same top-40-word fingerprint are flagged as duplicates.
    seen_fingerprints: dict[frozenset, tuple[Any, str]] = {}
    for idx, (content_str, pid) in enumerate(zip(contents, point_ids)):
        if not content_str:
            continue
        fp = _chunk_fingerprint(content_str)
        if not fp:
            continue
        if fp in seen_fingerprints:
            orig_pid, orig_preview = seen_fingerprints[fp]
            ci.add(
                "DUPLICATE_CONTENT",
                point_id=pid,
                detail=f"fingerprint match with point {orig_pid} (keeping first)",
                preview=content_str,
            )
        else:
            seen_fingerprints[fp] = (pid, content_str)

    return ci


def run_audit(
    client,
    candidate_filter: Optional[list[str]] = None,
) -> AuditReport:
    """Run audit, optionally restricted to specific candidate IDs."""
    report = AuditReport(collection=COLLECTION)

    if candidate_filter:
        logger.info(
            f"Fetching points for {len(candidate_filter)} specified candidates..."
        )
        all_points: list[Any] = []
        for cid in candidate_filter:
            pts = _scroll_candidate_points(client, COLLECTION, cid)
            logger.info(f"  {cid}: {len(pts)} points")
            all_points.extend(pts)
    else:
        logger.info(f"Scrolling all points in {COLLECTION}...")
        all_points = _scroll_all_points(client, COLLECTION)

    report.total_points = len(all_points)
    logger.info(f"Total points: {report.total_points:,}")

    # Group by namespace
    by_candidate: dict[str, list[Any]] = defaultdict(list)
    for point in all_points:
        payload = point.payload or {}
        metadata = payload.get("metadata", {}) or {}
        namespace = metadata.get("namespace", "")
        if candidate_filter and namespace not in candidate_filter:
            continue
        by_candidate[namespace].append(point)

    # Ensure explicitly requested candidates appear even if they have 0 points
    if candidate_filter:
        for cid in candidate_filter:
            if cid not in by_candidate:
                by_candidate[cid] = []

    report.total_candidates = len(by_candidate)
    logger.info(f"Candidates to audit: {report.total_candidates:,}")

    for candidate_id, points in sorted(by_candidate.items()):
        ci = _audit_candidate(candidate_id, points)
        if ci.issues:
            report.candidate_issues[candidate_id] = ci

    return report


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

_RULES_ORDERED = [
    "METADATA_ONLY",
    "EMPTY_CHUNKS",
    "DUPLICATE_CONTENT",
    "OCR_ARTIFACTS",
    "ENCODING_ISSUES",
    "NULL_THEMES",
    "TOO_FEW_CHUNKS",
]


def _print_table_report(report: AuditReport, verbose: bool = False) -> None:
    by_rule = report.issues_by_rule()
    total_issues = sum(len(v) for v in by_rule.values())

    print()
    print("DRY RUN — Chunk Health Audit")
    print(f"Collection:         {report.collection}")
    print(f"Points scanned:     {report.total_points:,}")
    print(f"Candidates scanned: {report.total_candidates:,}")
    print(f"Total issues found: {total_issues}")

    if not by_rule:
        print("\nNo issues found.")
        return

    print("\nISSUES FOUND:")
    W_RULE, W_SEV, W_DETAIL = 20, 10, 60
    sep = "  " + "-" * (W_RULE + W_SEV + W_DETAIL + 4)
    print(sep)
    print(f"  {'Rule':<{W_RULE}} {'Severity':<{W_SEV}} {'Summary'}")
    print(sep)

    for rule in _RULES_ORDERED:
        if rule not in by_rule:
            continue
        issues = by_rule[rule]
        severity = SEVERITY.get(rule, "INFO")
        candidates = sorted({i.candidate_id for i in issues})
        cand_preview = ", ".join(candidates[:3])
        if len(candidates) > 3:
            cand_preview += f" (+{len(candidates) - 3} more)"
        detail = f"{len(candidates)} cand, {len(issues)} chunks — {cand_preview}"
        print(f"  {rule:<{W_RULE}} {severity:<{W_SEV}} {detail}")

    print(sep)

    # PROPOSED FIXES
    print("\nPROPOSED FIXES:")
    fix_num = 1

    reindex_cands: set[str] = set()
    for rule in ("METADATA_ONLY", "EMPTY_CHUNKS", "OCR_ARTIFACTS", "ENCODING_ISSUES"):
        for issue in by_rule.get(rule, []):
            reindex_cands.add(issue.candidate_id)

    for cid in sorted(reindex_cands):
        ci = report.candidate_issues.get(cid)
        if ci:
            bad = sum(
                len(ci.by_rule(r))
                for r in (
                    "METADATA_ONLY",
                    "EMPTY_CHUNKS",
                    "OCR_ARTIFACTS",
                    "ENCODING_ISSUES",
                )
            )
            print(
                f"  {fix_num}. {cid}: DELETE {bad} bad chunks"
                f" -> RE-INDEX from PDF (re-OCR at 300 DPI)"
            )
            fix_num += 1

    null_issues = by_rule.get("NULL_THEMES", [])
    if null_issues:
        not_reindex = [i for i in null_issues if i.candidate_id not in reindex_cands]
        if not_reindex:
            print(
                f"  {fix_num}. {len(not_reindex)} chunks across"
                f" {len({i.candidate_id for i in not_reindex})} candidates:"
                f" RUN theme backfill (src.services.backfill_themes)"
            )
            fix_num += 1

    dup_issues = by_rule.get("DUPLICATE_CONTENT", [])
    if dup_issues:
        print(f"  {fix_num}. {len(dup_issues)} duplicate chunks: DELETE duplicates")
        fix_num += 1

    if verbose and report.candidate_issues:
        print("\nDETAILS:")
        for cid, ci in sorted(report.candidate_issues.items()):
            print(f"\n  {cid} ({ci.chunk_count} chunks, {len(ci.issues)} issues):")
            for issue in ci.issues:
                preview = (
                    f"  [{issue.content_preview[:60]}]" if issue.content_preview else ""
                )
                print(
                    f"    [{issue.rule}] point={issue.point_id}"
                    f" — {issue.detail}{preview}"
                )


def _print_json_report(report: AuditReport) -> None:
    by_rule = report.issues_by_rule()
    output = {
        "collection": report.collection,
        "total_points": report.total_points,
        "total_candidates": report.total_candidates,
        "summary": {
            rule: {
                "severity": SEVERITY.get(rule, "INFO"),
                "total_chunks": len(issues),
                "candidates": sorted({i.candidate_id for i in issues}),
            }
            for rule, issues in by_rule.items()
        },
        "issues": {
            rule: [
                {
                    "point_id": str(i.point_id),
                    "candidate_id": i.candidate_id,
                    "detail": i.detail,
                    "preview": i.content_preview,
                }
                for i in issues
            ]
            for rule, issues in by_rule.items()
        },
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Embedding helper — reuses the project's _get_embeddings() without
# triggering the full vector_store_helper module-level init
# ---------------------------------------------------------------------------


def _get_embed_function():
    """
    Return (embed_model, embedding_dim) using the same provider logic as
    vector_store_helper._get_embeddings(). EMBEDDING_PROVIDER env var is respected.
    """
    from src.vector_store_helper import embed as _embed, EMBEDDING_DIM

    return _embed, EMBEDDING_DIM


# ---------------------------------------------------------------------------
# PDF download
# ---------------------------------------------------------------------------


async def _download_pdf(url: str) -> Optional[bytes]:
    """Download a PDF. Adds ?alt=media for Firebase Storage URLs."""
    import aiohttp

    if "firebasestorage.googleapis.com" in url and "alt=media" not in url:
        sep = "&" if "?" in url else "?"
        url = url + sep + "alt=media"

    logger.info(f"Downloading PDF: {url}")
    try:
        async with aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=30)
        ) as session:
            async with session.get(url) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    logger.info(f"Downloaded {len(data):,} bytes")
                    return data
                logger.warning(f"HTTP {resp.status} when downloading {url}")
                return None
    except Exception as e:
        logger.error(f"PDF download failed: {e}")
        return None


# ---------------------------------------------------------------------------
# OCR pipeline (pypdf → tesseract → Gemini)
# ---------------------------------------------------------------------------


def _extract_text_pypdf(pdf_bytes: bytes) -> list[tuple[int, str]]:
    try:
        from src.services.manifesto_indexer import extract_pages_from_pdf

        return extract_pages_from_pdf(pdf_bytes)
    except Exception as e:
        logger.warning(f"pypdf extraction failed: {e}")
        return []


def _ocr_pdf_tesseract(pdf_bytes: bytes) -> list[tuple[int, str]]:
    """OCR PDF pages with tesseract (fra, 300 DPI) via pymupdf + pytesseract."""
    pages: list[tuple[int, str]] = []
    try:
        import io as _io

        import fitz  # pymupdf
        import pytesseract
        from PIL import Image

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(300 / 72, 300 / 72)  # 300 DPI
            pix = page.get_pixmap(matrix=mat)
            img = Image.open(_io.BytesIO(pix.tobytes("png")))
            text = pytesseract.image_to_string(img, lang="fra", config="--psm 6")
            if text and text.strip():
                pages.append((page_num + 1, text))
        doc.close()
        logger.info(f"tesseract extracted text from {len(pages)} pages")
        return pages
    except Exception as e:
        logger.warning(f"tesseract OCR failed: {e}")
        return []


async def _ocr_pdf_scaleway(pdf_bytes: bytes) -> list[tuple[int, str]]:
    """OCR via Scaleway Generative API (Mistral Small 3.2 vision model).

    Uses a single aiohttp session and parallel requests for all pages.
    """
    import base64
    import io

    import aiohttp

    api_key = os.getenv("SCALEWAY_EMBED_API_KEY", "")
    if not api_key:
        logger.warning("SCALEWAY_EMBED_API_KEY not set, skipping Scaleway OCR")
        return []

    try:
        import fitz  # pymupdf
        from PIL import Image

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        # Render all pages to base64 PNGs first
        page_images: list[tuple[int, str]] = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            mat = fitz.Matrix(300 / 72, 300 / 72)  # 300 DPI
            pix = page.get_pixmap(matrix=mat)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            img_b64 = base64.standard_b64encode(buf.getvalue()).decode("utf-8")
            page_images.append((page_num + 1, img_b64))
        doc.close()

        # OCR all pages in parallel with a single session
        async def _ocr_page(
            session: aiohttp.ClientSession, page_num: int, img_b64: str
        ) -> tuple[int, str] | None:
            async with session.post(
                "https://api.scaleway.ai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "mistral-small-3.2-24b-instruct-2506",
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{img_b64}",
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": (
                                        "Extrais le texte complet de cette image de document. "
                                        "Retourne UNIQUEMENT le texte brut, sans commentaire, "
                                        "sans formatage markdown. Préserve la structure des paragraphes."
                                    ),
                                },
                            ],
                        }
                    ],
                    "max_tokens": 8192,
                    "temperature": 0.0,
                },
            ) as resp:
                if resp.status != 200:
                    body = await resp.text()
                    logger.warning(
                        f"Scaleway OCR page {page_num}: HTTP {resp.status} — {body[:200]}"
                    )
                    return None
                data = await resp.json()
                text = data["choices"][0]["message"]["content"]
                if text and text.strip():
                    return (page_num, text.strip())
                return None

        async with aiohttp.ClientSession() as session:
            results = await asyncio.gather(
                *[_ocr_page(session, pn, b64) for pn, b64 in page_images]
            )

        pages = sorted([r for r in results if r is not None], key=lambda x: x[0])
        logger.info(f"Scaleway OCR: extracted text from {len(pages)} pages (parallel)")
        return pages

    except Exception as e:
        logger.warning(f"Scaleway OCR failed: {e}")
        return []


async def _ocr_pdf_gemini(pdf_bytes: bytes) -> list[tuple[int, str]]:
    """OCR via Gemini vision (same helper used by profession_indexer)."""
    try:
        from src.services.profession_indexer import _extract_pages_with_gemini

        return await _extract_pages_with_gemini(pdf_bytes)
    except Exception as e:
        logger.warning(f"Gemini OCR failed: {e}")
        return []


def _is_real_content(pages: list[tuple[int, str]], min_words: int = 30) -> bool:
    """Check if extracted pages contain real French content, not just file metadata."""
    full_text = " ".join(t for _, t in pages)
    real_words = _FRENCH_WORD_RE.findall(full_text)
    if len(real_words) < min_words:
        return False
    if _is_metadata_only(full_text):
        return False
    return True


async def _best_ocr(pdf_bytes: bytes) -> list[tuple[int, str]]:
    """Try pypdf → Scaleway vision → tesseract (300 DPI) → Gemini, return first with real content.

    Scaleway (Mistral vision) produces much cleaner OCR than tesseract on styled/graphic PDFs,
    so it runs before tesseract. Tesseract is the free/local fallback if Scaleway API is down.
    """
    pages = _extract_text_pypdf(pdf_bytes)
    total_chars = sum(len(t) for _, t in pages) if pages else 0
    if pages and total_chars > 200 and _is_real_content(pages):
        logger.info(
            f"pypdf: {total_chars:,} chars from {len(pages)} pages (real content)"
        )
        return pages

    reason = "metadata/noise" if total_chars > 200 else "too little text"
    logger.info(f"pypdf: {reason} ({total_chars} chars), trying Scaleway vision OCR...")
    pages = await _ocr_pdf_scaleway(pdf_bytes)
    total_chars = sum(len(t) for _, t in pages) if pages else 0
    if pages and total_chars > 200 and _is_real_content(pages):
        logger.info(
            f"Scaleway: {total_chars:,} chars from {len(pages)} pages (real content)"
        )
        return pages

    reason = "metadata/noise" if total_chars > 200 else "too little text"
    logger.info(
        f"Scaleway: {reason} ({total_chars} chars), trying tesseract at 300 DPI..."
    )
    pages = _ocr_pdf_tesseract(pdf_bytes)
    total_chars = sum(len(t) for _, t in pages) if pages else 0
    if pages and total_chars > 200 and _is_real_content(pages):
        logger.info(
            f"tesseract: {total_chars:,} chars from {len(pages)} pages (real content)"
        )
        return pages

    reason = "metadata/noise" if total_chars > 200 else "too little text"
    logger.info(
        f"tesseract: {reason} ({total_chars} chars), falling back to Gemini vision OCR..."
    )
    return await _ocr_pdf_gemini(pdf_bytes)


# ---------------------------------------------------------------------------
# Chunking (same config as production indexers)
# ---------------------------------------------------------------------------


def _chunk_pages(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Split page texts into (page_num, chunk_text) pairs."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len,
        separators=["\n\n", "\n", ". ", "? ", "! ", "; ", " ", ""],
    )
    result: list[tuple[int, str]] = []
    for page_num, text in pages:
        for chunk in splitter.split_text(text):
            if len(chunk.strip()) >= 30:
                result.append((page_num, chunk))
    return result


# ---------------------------------------------------------------------------
# Heal: re-index a candidate from its PDF
# ---------------------------------------------------------------------------


async def _heal_reindex_candidate(
    client,
    candidate_id: str,
    points: list[Any],
    dry_run: bool,
) -> bool:
    """
    Re-download PDF, OCR it, re-chunk, re-embed, delete ONLY profession_de_foi chunks, upsert new.
    Preserves website/scraped chunks untouched.
    Returns True on success.
    """
    from qdrant_client.models import (
        PointIdsList,
        PointStruct,
    )

    if not points:
        logger.warning(f"[heal] {candidate_id}: no existing points — skipping")
        return False

    # Separate profession_de_foi chunks from website/other chunks
    pdf_points = []
    other_points = []
    for point in points:
        payload = point.payload or {}
        meta = payload.get("metadata", {}) or {}
        source_doc = meta.get("source_document", "")
        page_type = meta.get("page_type", "")
        # profession_de_foi chunks: have PDF URL or source_document=profession_de_foi
        is_pdf = (
            source_doc == "profession_de_foi"
            or page_type == "pdf_transcription"
            or ".pdf" in meta.get("url", "").lower()
        )
        if is_pdf:
            pdf_points.append(point)
        else:
            other_points.append(point)

    if not pdf_points:
        logger.warning(
            f"[heal] {candidate_id}: no profession_de_foi chunks found — skipping"
        )
        return False

    logger.info(
        f"[heal] {candidate_id}: {len(pdf_points)} PDF chunks to replace, "
        f"{len(other_points)} website chunks preserved"
    )

    # Find PDF URL from profession_de_foi chunk metadata
    pdf_url: Optional[str] = None
    template_metadata: dict = {}
    for point in pdf_points:
        payload = point.payload or {}
        meta = payload.get("metadata", {}) or {}
        url = meta.get("url", "")
        if url and (".pdf" in url.lower() or "firebasestorage" in url):
            pdf_url = url
            template_metadata = dict(meta)
            break

    if not pdf_url:
        logger.warning(
            f"[heal] {candidate_id}: no PDF URL in chunk metadata — cannot re-index"
        )
        return False

    # Download
    pdf_bytes = await _download_pdf(pdf_url)
    if not pdf_bytes:
        logger.error(f"[heal] {candidate_id}: PDF download failed")
        return False

    # OCR
    pages = await _best_ocr(pdf_bytes)
    if not pages:
        logger.error(f"[heal] {candidate_id}: no text extracted from PDF")
        return False

    # Chunk
    chunks = _chunk_pages(pages)
    logger.info(f"[heal] {candidate_id}: {len(chunks)} chunks after splitting")

    if dry_run:
        logger.info(
            f"[heal][DRY RUN] {candidate_id}: would DELETE {len(pdf_points)} PDF chunks"
            f" (keeping {len(other_points)} website chunks)"
            f" and UPSERT {len(chunks)} new chunks"
        )
        return True

    # Classify themes (graceful degradation on failure)
    from langchain_core.documents import Document

    docs: list[Optional[Document]] = [None] * len(chunks)
    try:
        from src.services.theme_classifier import (
            apply_themes_to_documents,
            classify_chunks,
        )

        raw_docs = [Document(page_content=ct, metadata={}) for _, ct in chunks]
        texts = [c for _, c in chunks]
        classifications = await classify_chunks(texts, max_concurrent_llm=5)
        apply_themes_to_documents(raw_docs, classifications)
        docs = raw_docs  # type: ignore[assignment]
        classified = sum(1 for c in classifications if c.theme)
        logger.info(
            f"[heal] {candidate_id}: {classified}/{len(chunks)} chunks classified"
        )
    except Exception as e:
        logger.warning(f"[heal] {candidate_id}: theme classification failed: {e}")

    # Embed
    embed, _dim = _get_embed_function()
    texts_list = [c for _, c in chunks]
    logger.info(f"[heal] {candidate_id}: embedding {len(texts_list)} chunks...")
    try:
        vectors = await asyncio.get_event_loop().run_in_executor(
            None, lambda: embed.embed_documents(texts_list)
        )
    except Exception as e:
        logger.error(f"[heal] {candidate_id}: embedding failed: {e}")
        return False

    # Build PointStructs
    new_points: list[PointStruct] = []
    for idx, ((page_num, chunk_text), vector) in enumerate(zip(chunks, vectors)):
        meta = dict(template_metadata)
        for k in ("chunk_index", "total_chunks", "page"):
            meta.pop(k, None)
        meta["chunk_index"] = idx
        meta["total_chunks"] = len(chunks)
        meta["page"] = page_num

        doc = docs[idx]
        if doc is not None and hasattr(doc, "metadata"):
            if doc.metadata.get("theme"):
                meta["theme"] = doc.metadata["theme"]
            if doc.metadata.get("sub_theme"):
                meta["sub_theme"] = doc.metadata["sub_theme"]

        new_points.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector={"dense": vector},
                payload={"page_content": chunk_text, "metadata": meta},
            )
        )

    # Delete only the old PDF chunks (preserve website chunks)
    pdf_point_ids = [str(p.id) for p in pdf_points]
    logger.info(
        f"[heal] {candidate_id}: deleting {len(pdf_point_ids)} PDF chunks (keeping {len(other_points)} website)..."
    )
    try:
        client.delete(
            collection_name=COLLECTION,
            points_selector=PointIdsList(points=pdf_point_ids),
            wait=True,
        )
    except Exception as e:
        logger.error(f"[heal] {candidate_id}: delete failed: {e}")
        return False

    # Upsert new chunks in batches of 50
    for i in range(0, len(new_points), 50):
        batch = new_points[i : i + 50]
        try:
            client.upsert(collection_name=COLLECTION, points=batch, wait=True)
        except Exception as e:
            logger.error(
                f"[heal] {candidate_id}: upsert batch {i // 50 + 1} failed: {e}"
            )
            return False

    logger.info(
        f"[heal] {candidate_id}: replaced {len(points)} old chunks"
        f" with {len(new_points)} new chunks"
    )
    return True


# ---------------------------------------------------------------------------
# Heal: backfill NULL_THEMES
# ---------------------------------------------------------------------------


async def _heal_null_themes(client, issues: list[ChunkIssue], dry_run: bool) -> int:
    """Classify themes for chunks missing them. Returns count of chunks fixed."""
    from qdrant_client.models import SetPayload, SetPayloadOperation

    from src.services.theme_classifier import classify_chunks

    point_ids = [i.point_id for i in issues if i.point_id is not None]
    if not point_ids:
        return 0

    logger.info(f"[heal] NULL_THEMES: fetching {len(point_ids)} points...")
    try:
        fetched = client.retrieve(
            collection_name=COLLECTION,
            ids=point_ids,
            with_payload=True,
            with_vectors=False,
        )
    except Exception as e:
        logger.error(f"[heal] NULL_THEMES: retrieve failed: {e}")
        return 0

    id_to_point = {str(p.id): p for p in fetched}

    texts: list[str] = []
    valid_ids: list[Any] = []
    for pid in point_ids:
        p = id_to_point.get(str(pid))
        if p:
            content = (p.payload or {}).get("page_content", "").strip()
            if content:
                texts.append(content)
                valid_ids.append(pid)

    if not texts:
        return 0

    logger.info(f"[heal] NULL_THEMES: classifying {len(texts)} chunks...")
    try:
        results = await classify_chunks(texts, max_concurrent_llm=10)
    except Exception as e:
        logger.error(f"[heal] NULL_THEMES: classification failed: {e}")
        return 0

    ops: list[SetPayloadOperation] = []
    classified = 0
    for pid, result in zip(valid_ids, results):
        if result.theme is None:
            continue
        p = id_to_point.get(str(pid))
        if p is None:
            continue
        meta = dict((p.payload or {}).get("metadata", {}))
        meta["theme"] = result.theme
        if result.sub_theme:
            meta["sub_theme"] = result.sub_theme
        ops.append(
            SetPayloadOperation(
                set_payload=SetPayload(
                    payload={"metadata": meta},
                    points=[pid],
                )
            )
        )
        classified += 1

    if dry_run:
        logger.info(f"[heal][DRY RUN] NULL_THEMES: would update {classified} chunks")
        return classified

    if ops:
        try:
            client.batch_update_points(
                collection_name=COLLECTION,
                update_operations=ops,
                wait=True,
            )
            logger.info(f"[heal] NULL_THEMES: updated {classified} chunks with themes")
        except Exception as e:
            logger.error(f"[heal] NULL_THEMES: batch update failed: {e}")
            return 0

    return classified


# ---------------------------------------------------------------------------
# Heal: remove DUPLICATE_CONTENT
# ---------------------------------------------------------------------------


def _heal_duplicates(client, issues: list[ChunkIssue], dry_run: bool) -> int:
    """Delete duplicate chunks (the later one in each pair). Returns deleted count."""
    from qdrant_client.models import PointIdsList

    point_ids = [i.point_id for i in issues if i.point_id is not None]
    if not point_ids:
        return 0

    if dry_run:
        logger.info(
            f"[heal][DRY RUN] DUPLICATE_CONTENT: would DELETE {len(point_ids)} duplicate chunks"
        )
        return len(point_ids)

    try:
        client.delete(
            collection_name=COLLECTION,
            points_selector=PointIdsList(points=point_ids),
            wait=True,
        )
        logger.info(f"[heal] DUPLICATE_CONTENT: deleted {len(point_ids)} chunks")
        return len(point_ids)
    except Exception as e:
        logger.error(f"[heal] DUPLICATE_CONTENT: delete failed: {e}")
        return 0


# ---------------------------------------------------------------------------
# Heal orchestration
# ---------------------------------------------------------------------------


def _confirm(prompt: str, auto_yes: bool = False) -> str:
    """Ask user for y/n/a(ll)/q(uit). Returns 'y', 'n', 'a', or 'q'."""
    if auto_yes:
        return "y"
    while True:
        resp = input(f"{prompt} [y/n/a(ll)/q(uit)] ").strip().lower()
        if resp in ("y", "yes"):
            return "y"
        if resp in ("n", "no"):
            return "n"
        if resp in ("a", "all"):
            return "a"
        if resp in ("q", "quit"):
            return "q"
        print("  Please enter y, n, a (all), or q (quit)")


async def run_heal(
    client,
    report: AuditReport,
    candidate_filter: Optional[list[str]],
    dry_run: bool,
    interactive: bool = True,
) -> None:
    """Orchestrate all repairs based on the audit report."""
    by_rule = report.issues_by_rule()
    auto_yes = dry_run or not interactive  # skip prompts in dry-run mode

    # Determine which candidates need full re-indexing
    reindex_rules = {
        "METADATA_ONLY",
        "EMPTY_CHUNKS",
        "OCR_ARTIFACTS",
        "ENCODING_ISSUES",
    }
    reindex_cands: set[str] = set()
    for rule in reindex_rules:
        for issue in by_rule.get(rule, []):
            if candidate_filter is None or issue.candidate_id in candidate_filter:
                reindex_cands.add(issue.candidate_id)

    healed = 0
    skipped = 0

    if reindex_cands:
        sorted_cands = sorted(reindex_cands)
        print(f"\n[HEAL] {len(sorted_cands)} candidate(s) need re-indexing from PDF:")
        for i, cid in enumerate(sorted_cands, 1):
            pts = _scroll_candidate_points(client, COLLECTION, cid)
            ci = report.candidate_issues.get(cid)
            # Get name from first chunk's metadata
            name = "?"
            for pt in pts:
                payload = pt.payload or {}
                meta = payload.get("metadata", {})
                if meta.get("candidate_name"):
                    name = meta["candidate_name"]
                    break
            rules_hit = ", ".join(sorted({i.rule for i in ci.issues})) if ci else "?"
            print(f"\n  [{i}/{len(sorted_cands)}] {cid} ({name})")
            print(f"    Issues: {rules_hit}")
            pdf_ct = sum(
                1
                for p in pts
                if (p.payload or {}).get("metadata", {}).get("source_document")
                == "profession_de_foi"
                or (p.payload or {}).get("metadata", {}).get("page_type")
                == "pdf_transcription"
                or ".pdf"
                in (p.payload or {}).get("metadata", {}).get("url", "").lower()
            )
            web_ct = len(pts) - pdf_ct
            print(
                f"    Current chunks: {len(pts)} total ({pdf_ct} PDF, {web_ct} website) → will re-OCR {pdf_ct} PDF chunks"
            )

            choice = _confirm(f"    Heal {cid}?", auto_yes=auto_yes)
            if choice == "q":
                print("  Quitting heal.")
                break
            if choice == "a":
                auto_yes = True
                choice = "y"
            if choice == "n":
                skipped += 1
                print("    SKIPPED")
                continue

            print("    Healing...", end=" ", flush=True)
            success = await _heal_reindex_candidate(client, cid, pts, dry_run)
            print("OK" if success else "FAILED")
            if success:
                healed += 1

    # NULL_THEMES backfill — only for candidates NOT being re-indexed
    null_issues = [
        i
        for i in by_rule.get("NULL_THEMES", [])
        if i.candidate_id not in reindex_cands
        and (candidate_filter is None or i.candidate_id in candidate_filter)
    ]
    if null_issues:
        cands_with_null = len({i.candidate_id for i in null_issues})
        choice = _confirm(
            f"\n[HEAL] Backfill themes for {len(null_issues)} chunk(s) across {cands_with_null} candidate(s)?",
            auto_yes=auto_yes,
        )
        if choice in ("y", "a"):
            fixed = await _heal_null_themes(client, null_issues, dry_run)
            print(f"  -> {fixed} chunks classified")
        else:
            print("  SKIPPED theme backfill")

    # DUPLICATE_CONTENT cleanup
    dup_issues = [
        i
        for i in by_rule.get("DUPLICATE_CONTENT", [])
        if candidate_filter is None or i.candidate_id in candidate_filter
    ]
    if dup_issues:
        cands_with_dup = len({i.candidate_id for i in dup_issues})
        choice = _confirm(
            f"\n[HEAL] Remove {len(dup_issues)} duplicate chunk(s) across {cands_with_dup} candidate(s)?",
            auto_yes=auto_yes,
        )
        if choice in ("y", "a"):
            deleted = _heal_duplicates(client, dup_issues, dry_run)
            print(f"  -> {deleted} chunks deleted")
        else:
            print("  SKIPPED duplicate removal")

    if not reindex_cands and not null_issues and not dup_issues:
        print("\n[HEAL] Nothing to heal.")
        return

    suffix = " (DRY RUN — no writes)" if dry_run else ""
    print(f"\n[HEAL] Done{suffix}. Healed: {healed}, Skipped: {skipped}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Chunk health audit and heal for the ChatVote Qdrant collection.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── audit ──────────────────────────────────────────────────────────────
    audit_p = sub.add_parser("audit", help="Detect issues (read-only)")
    audit_p.add_argument(
        "--candidates",
        type=str,
        default=None,
        metavar="IDS",
        help="Comma-separated candidate IDs to restrict scan",
    )
    audit_p.add_argument(
        "--format",
        choices=["table", "json"],
        default="table",
        help="Output format (default: table)",
    )
    audit_p.add_argument(
        "--verbose",
        action="store_true",
        help="Print per-point issue details in table mode",
    )
    audit_p.add_argument(
        "--qdrant-url", type=str, default=None, help="Override QDRANT_URL"
    )

    # ── heal ───────────────────────────────────────────────────────────────
    heal_p = sub.add_parser("heal", help="Fix detected issues")
    heal_p.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip interactive confirmation (auto-approve all)",
    )
    heal_target = heal_p.add_mutually_exclusive_group(required=True)
    heal_target.add_argument(
        "--candidates",
        type=str,
        default=None,
        metavar="IDS",
        help="Comma-separated candidate IDs to heal",
    )
    heal_target.add_argument(
        "--all",
        action="store_true",
        help="Heal all detected issues across the collection",
    )
    heal_p.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what WOULD be done without writing to Qdrant",
    )
    heal_p.add_argument(
        "--qdrant-url", type=str, default=None, help="Override QDRANT_URL"
    )

    return parser


async def _main_async() -> None:
    args = _build_parser().parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    global QDRANT_URL
    if args.qdrant_url:
        QDRANT_URL = args.qdrant_url

    client = _make_qdrant_client()

    candidate_filter: Optional[list[str]] = None
    if hasattr(args, "candidates") and args.candidates:
        candidate_filter = [c.strip() for c in args.candidates.split(",") if c.strip()]

    if args.command == "audit":
        report = run_audit(client, candidate_filter=candidate_filter)
        if args.format == "json":
            _print_json_report(report)
        else:
            _print_table_report(report, verbose=args.verbose)

    elif args.command == "heal":
        heal_filter = candidate_filter if not args.all else None

        print("[1/2] Running audit to identify issues...")
        report = run_audit(client, candidate_filter=heal_filter)
        _print_table_report(report)

        if not report.candidate_issues:
            print("\nNo issues to heal.")
            return

        print(f"\n[2/2] Healing issues{' (DRY RUN)' if args.dry_run else ''}...")
        await run_heal(
            client,
            report,
            candidate_filter=heal_filter,
            dry_run=args.dry_run,
            interactive=not args.yes,
        )


def main() -> None:
    asyncio.run(_main_async())


if __name__ == "__main__":
    main()
