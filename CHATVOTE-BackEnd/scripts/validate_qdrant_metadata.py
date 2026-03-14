#!/usr/bin/env python3
"""
Validate Qdrant collection metadata after a pipeline run.

Checks that required metadata fields are present and correctly populated
for all_parties_{env} and candidates_websites_{env} collections.

Usage:
    python3 scripts/validate_qdrant_metadata.py [--env dev|prod] [--url http://localhost:6333]
"""

import os
import sys

from qdrant_client import QdrantClient

ENV = os.getenv("ENV", "dev")
QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
SCROLL_LIMIT = 100

REQUIRED_FIELDS_PARTIES = [
    "namespace",
    "party_ids",
    "source_document",
    "document_name",
    "page",
    "chunk_index",
    "total_chunks",
]

REQUIRED_FIELDS_CANDIDATES = [
    "namespace",
    "candidate_ids",
    "source_document",
    "candidate_name",
    "municipality_code",
    "page",
    "chunk_index",
    "total_chunks",
]


def get_payload_value(payload: dict, field: str):
    """Return field value checking metadata sub-dict first, then top-level."""
    metadata = payload.get("metadata", {})
    if isinstance(metadata, dict) and field in metadata:
        return metadata[field]
    return payload.get(field)


def validate_collection(
    client: QdrantClient,
    collection_name: str,
    required_fields: list[str],
    namespace_prefix: str | None = None,
) -> tuple[bool, int]:
    """
    Scroll up to SCROLL_LIMIT points and validate required metadata fields.

    Returns (passed, total_points_checked).
    """
    print(f"\n{'─' * 60}")
    print(f"  Collection: {collection_name}")
    print(f"{'─' * 60}")

    # Check collection exists
    collections = [c.name for c in client.get_collections().collections]
    if collection_name not in collections:
        print(f"  ❌  Collection not found (existing: {collections})")
        return False, 0

    results, _ = client.scroll(
        collection_name=collection_name,
        limit=SCROLL_LIMIT,
        with_payload=True,
        with_vectors=False,
    )

    total = len(results)
    if total == 0:
        print("  ⚠️   Collection is empty — no points to validate")
        return False, 0

    print(f"  Points sampled: {total}")

    # Count coverage per field
    field_hits: dict[str, int] = {f: 0 for f in required_fields}
    namespace_ok = 0
    namespace_total = 0

    for pt in results:
        payload = pt.payload or {}
        for field in required_fields:
            val = get_payload_value(payload, field)
            if val is not None and val != "" and val != [] and val != {}:
                field_hits[field] += 1

        if namespace_prefix is not None:
            namespace_total += 1
            ns = get_payload_value(payload, "namespace") or ""
            if isinstance(ns, str) and ns.startswith(namespace_prefix):
                namespace_ok += 1

    # Report
    all_pass = True
    for field in required_fields:
        hits = field_hits[field]
        pct = hits / total * 100
        icon = "✅" if pct == 100 else ("⚠️ " if pct >= 50 else "❌")
        print(f"  {icon}  {field:<22} {hits:>4}/{total}  ({pct:.1f}%)")
        if pct < 100:
            all_pass = False

    if namespace_prefix is not None and namespace_total > 0:
        pct = namespace_ok / namespace_total * 100
        icon = "✅" if pct == 100 else ("⚠️ " if pct >= 50 else "❌")
        print(f"  {icon}  namespace starts '{namespace_prefix}'  {namespace_ok:>4}/{namespace_total}  ({pct:.1f}%)")
        if pct < 100:
            all_pass = False

    verdict = "✅  PASS" if all_pass else "❌  FAIL"
    print(f"\n  Verdict: {verdict}")
    return all_pass, total


def main():
    env = ENV
    url = QDRANT_URL

    for arg in sys.argv[1:]:
        if arg.startswith("--env="):
            env = arg.split("=", 1)[1]
        elif arg.startswith("--url="):
            url = arg.split("=", 1)[1]
        elif arg == "--env" or arg == "--url":
            pass  # handled below via paired args
    # Handle space-separated --env dev / --url http://...
    args = sys.argv[1:]
    for i, arg in enumerate(args):
        if arg == "--env" and i + 1 < len(args):
            env = args[i + 1]
        elif arg == "--url" and i + 1 < len(args):
            url = args[i + 1]

    print(f"🔍  Validating Qdrant metadata  [env={env}, url={url}]")

    client = QdrantClient(url=url)

    parties_collection = f"all_parties_{env}"
    candidates_collection = f"candidates_websites_{env}"

    parties_pass, parties_total = validate_collection(
        client,
        parties_collection,
        REQUIRED_FIELDS_PARTIES,
        namespace_prefix=None,
    )

    candidates_pass, candidates_total = validate_collection(
        client,
        candidates_collection,
        REQUIRED_FIELDS_CANDIDATES,
        namespace_prefix="cand-",
    )

    print(f"\n{'═' * 60}")
    print("  Summary")
    print(f"{'═' * 60}")
    print(f"  {parties_collection:<40} {parties_total:>4} pts  {'✅ PASS' if parties_pass else '❌ FAIL'}")
    print(f"  {candidates_collection:<40} {candidates_total:>4} pts  {'✅ PASS' if candidates_pass else '❌ FAIL'}")

    overall = parties_pass and candidates_pass
    print(f"\n  Overall: {'✅  PASS' if overall else '❌  FAIL'}")
    print(f"{'═' * 60}\n")

    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    main()
