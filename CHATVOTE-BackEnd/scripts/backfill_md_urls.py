"""Backfill metadata.url for crawled website chunks that have .md filenames.

Many candidate website chunks (from Julien's crawl service) store relative
.md filenames (e.g. "bonne-annee-2026.md") instead of real HTTP URLs.

Strategy:
  1. Scroll all points where metadata.url contains ".md"
  2. For chunks that contain "> Source: <url>" in page_content, extract the URL
  3. Build a per-namespace mapping: .md filename → real HTTP URL
     Fallback: infer URL from base domain + slug for pages with no Source: line
  4. Apply the mapping to ALL chunks sharing the same .md filename
  5. Use read-modify-write to update ONLY metadata.url without touching other fields
  6. Optionally validate URLs with HEAD requests before writing (--check-urls)

Usage:
    poetry run python scripts/backfill_md_urls.py --dry-run              # Preview
    poetry run python scripts/backfill_md_urls.py                        # Apply
    poetry run python scripts/backfill_md_urls.py --check-urls           # Validate URLs first
    poetry run python scripts/backfill_md_urls.py --namespace cand-63113-6  # Single candidate
"""

import argparse
import concurrent.futures
import json
import logging
import os
import re
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SCROLL_BATCH = 500
UPDATE_BATCH = 100
SOURCE_RE = re.compile(r"> Source:\s*(https?://\S+)")


def _qdrant_post(qdrant_url: str, api_key: str, path: str, body: dict) -> dict:
    url = f"{qdrant_url.rstrip('/')}{path}"
    headers = {"Content-Type": "application/json", "api-key": api_key}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def scroll_md_url_points(
    qdrant_url: str,
    api_key: str,
    collection: str,
    namespace_filter: str | None = None,
) -> list[dict]:
    """Scroll all points where metadata.url contains '.md'."""
    points: list[dict] = []
    offset = None

    must_conditions: list[dict] = [
        {"key": "metadata.url", "match": {"text": ".md"}},
    ]

    if namespace_filter:
        must_conditions.append(
            {"key": "metadata.namespace", "match": {"value": namespace_filter}}
        )

    while True:
        body: dict = {
            "limit": SCROLL_BATCH,
            "with_payload": ["page_content", "metadata.url", "metadata.namespace"],
            "with_vector": False,
            "filter": {"must": must_conditions},
        }
        if offset is not None:
            body["offset"] = offset

        data = _qdrant_post(
            qdrant_url, api_key, f"/collections/{collection}/points/scroll", body
        )
        batch = data["result"]["points"]
        next_offset = data["result"].get("next_page_offset")

        for p in batch:
            meta = p["payload"].get("metadata", {})
            md_url = meta.get("url", "")
            # Double-check: only process .md URLs that are NOT already http
            if md_url and md_url.endswith(".md") and not md_url.startswith("http"):
                content = p["payload"].get("page_content", "")
                points.append(
                    {
                        "id": p["id"],
                        "namespace": meta.get("namespace", ""),
                        "md_url": md_url,
                        "content": content,
                    }
                )

        logger.info(f"Scrolled {len(points)} qualifying .md-url points so far...")

        if not next_offset:
            break
        offset = next_offset

    logger.info(f"Total .md-url points found: {len(points)}")
    return points


def _infer_url_from_slug(base_url: str, md_filename: str) -> str:
    """Infer HTTP URL from base URL and .md filename.

    Rules:
      - Strip .md extension
      - Replace _ with / (crawl service uses _ for path separators)
      - index → homepage (no path appended)
    """
    slug = md_filename[:-3] if md_filename.endswith(".md") else md_filename
    slug = slug.replace("_", "/")
    if slug == "index":
        return base_url.rstrip("/")
    return f"{base_url.rstrip('/')}/{slug}"


def build_url_mapping(
    points: list[dict],
    qdrant_url: str | None = None,
    api_key: str | None = None,
    collection: str | None = None,
) -> dict[str, dict[str, str]]:
    """Build per-namespace mapping: .md filename → real HTTP URL.

    Primary: '> Source: <url>' lines found in page_content.
    Fallback: for .md filenames with no Source: line, infer URL from the
      base domain of the candidate's site (fetched from already-updated
      HTTP chunks in the same namespace) + slug.
      - slug = md_filename without .md, with _ replaced by /
      - index.md → base URL (homepage)
    """
    from urllib.parse import urlparse

    # namespace -> {md_filename -> real_url}
    mapping: dict[str, dict[str, str]] = defaultdict(dict)

    for p in points:
        match = SOURCE_RE.search(p["content"])
        if match:
            real_url = match.group(1).rstrip(")")  # strip trailing ) if any
            mapping[p["namespace"]][p["md_url"]] = real_url

    # Fallback: fill remaining unmapped .md filenames via slug inference
    # Group unmapped by namespace
    unmapped_by_ns: dict[str, set[str]] = defaultdict(set)
    for p in points:
        ns = p["namespace"]
        md_url = p["md_url"]
        if md_url not in mapping.get(ns, {}):
            unmapped_by_ns[ns].add(md_url)

    if not unmapped_by_ns:
        return dict(mapping)

    for ns, unmapped_md_files in unmapped_by_ns.items():
        # Try to get base URL from already-mapped entries first
        base_url = None
        ns_map = mapping.get(ns, {})
        for known_url in ns_map.values():
            parsed = urlparse(known_url)
            base_url = f"{parsed.scheme}://{parsed.netloc}"
            break

        # If no mapped entries in this batch, query Qdrant for any HTTP URL
        # from this namespace (already-updated points)
        if base_url is None and qdrant_url and api_key and collection:
            try:
                data = _qdrant_post(
                    qdrant_url,
                    api_key,
                    f"/collections/{collection}/points/scroll",
                    {
                        "limit": 1,
                        "with_payload": ["metadata.url"],
                        "with_vector": False,
                        "filter": {
                            "must": [
                                {"key": "metadata.namespace", "match": {"value": ns}},
                                {"key": "metadata.url", "match": {"text": "http"}},
                            ]
                        },
                    },
                )
                sample = data["result"]["points"]
                if sample:
                    found_url = sample[0]["payload"].get("metadata", {}).get("url", "")
                    if found_url.startswith("http"):
                        parsed = urlparse(found_url)
                        base_url = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass

        if base_url is None:
            logger.warning(
                f"  [{ns}] Cannot infer base URL — skipping {len(unmapped_md_files)} unmapped files"
            )
            continue

        for md_file in unmapped_md_files:
            inferred = _infer_url_from_slug(base_url, md_file)
            mapping[ns][md_file] = inferred
            logger.info(f"  [{ns}] Inferred: {md_file} → {inferred}")

    return dict(mapping)


def _qdrant_get_points(
    qdrant_url: str,
    api_key: str,
    collection: str,
    point_ids: list,
) -> list[dict]:
    """Fetch full payloads for a list of point IDs."""
    data = _qdrant_post(
        qdrant_url,
        api_key,
        f"/collections/{collection}/points",
        {"ids": point_ids, "with_payload": True, "with_vector": False},
    )
    return data.get("result", [])


def _qdrant_put(qdrant_url: str, api_key: str, path: str, body: dict) -> dict:
    url = f"{qdrant_url.rstrip('/')}{path}"
    headers = {"Content-Type": "application/json", "api-key": api_key}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="PUT"
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def check_urls(
    urls: set[str],
    timeout: int = 5,
    max_workers: int = 20,
) -> dict[str, bool]:
    """HEAD-check a set of URLs concurrently. Returns {url: is_reachable}."""

    def check_one(url: str) -> tuple[str, bool]:
        try:
            req = urllib.request.Request(url, method="HEAD")
            req.add_header("User-Agent", "Mozilla/5.0 (ChatVote bot)")
            resp = urllib.request.urlopen(req, timeout=timeout)
            return url, resp.status < 500
        except urllib.error.HTTPError as e:
            # 4xx means URL exists but forbidden/not found — still reachable domain
            # treat 404 as dead, others (401/403) as alive (domain works)
            return url, e.code != 404
        except Exception:
            return url, False

    results: dict[str, bool] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(check_one, url): url for url in urls}
        done = 0
        for future in concurrent.futures.as_completed(futures):
            url, ok = future.result()
            results[url] = ok
            done += 1
            if done % 50 == 0:
                logger.info(f"  URL check: {done}/{len(urls)} checked...")
    return results


def apply_backfill(
    qdrant_url: str,
    api_key: str,
    collection: str,
    points: list[dict],
    mapping: dict[str, dict[str, str]],
    dry_run: bool,
    check_urls_flag: bool = False,
) -> tuple[int, int, int]:
    """Update metadata.url for points whose .md filename has a mapping.

    Uses read-modify-write: reads full payload, updates url in the
    metadata dict, then overwrites payload. This avoids Qdrant's
    dot-notation bug (creates stray top-level key) and nested-object
    replacement (destroys other metadata fields).

    Returns (updated, skipped_no_mapping, skipped_already_ok).
    """
    updated = 0
    skipped_no_mapping = 0

    # Build list of (point_id, new_url)
    to_update: list[tuple[str | int, str]] = []

    for p in points:
        ns = p["namespace"]
        md_url = p["md_url"]

        ns_map = mapping.get(ns, {})
        real_url = ns_map.get(md_url)

        if not real_url:
            skipped_no_mapping += 1
            continue

        to_update.append((p["id"], real_url))
        updated += 1

        if dry_run and updated <= 20:
            logger.info(f"  [DRY RUN] {p['id']} ({ns}): {md_url} → {real_url}")

    if dry_run:
        logger.info(
            f"[DRY RUN] Would update {updated} points, "
            f"skip {skipped_no_mapping} (no mapping)"
        )
        return updated, skipped_no_mapping, 0

    if not to_update:
        return updated, skipped_no_mapping, 0

    # Optional URL validation: HEAD-check all unique URLs before writing
    skipped_dead = 0
    if check_urls_flag:
        unique_urls = {url for _, url in to_update}
        logger.info(f"Checking {len(unique_urls)} unique URLs (HEAD requests)...")
        url_status = check_urls(unique_urls)
        dead = {u for u, ok in url_status.items() if not ok}
        if dead:
            logger.warning(f"  {len(dead)} URLs unreachable — skipping those points:")
            for u in sorted(dead):
                logger.warning(f"    DEAD: {u}")
            to_update = [(pid, url) for pid, url in to_update if url not in dead]
            skipped_dead = updated - len(to_update)
            updated = len(to_update)
            logger.info(f"  Proceeding with {updated} points after URL check.")

    # Build a lookup: point_id → new_url
    url_by_id: dict[str | int, str] = dict(to_update)

    # Process in batches: read full payload, update url, write back
    applied = 0
    batch_ids_list = [pid for pid, _ in to_update]

    for i in range(0, len(batch_ids_list), UPDATE_BATCH):
        batch_ids = batch_ids_list[i : i + UPDATE_BATCH]

        # Read current full payloads
        fetched = _qdrant_get_points(qdrant_url, api_key, collection, batch_ids)

        for point in fetched:
            pid = point["id"]
            payload = point["payload"]
            new_url = url_by_id[pid]

            # Update url inside the metadata dict
            if "metadata" in payload:
                payload["metadata"]["url"] = new_url
            else:
                payload["metadata"] = {"url": new_url}

            # Overwrite entire payload (preserves all fields)
            _qdrant_put(
                qdrant_url,
                api_key,
                f"/collections/{collection}/points/payload?wait=true",
                {"payload": payload, "points": [pid]},
            )
            applied += 1

        if applied % 500 == 0 or applied == len(to_update):
            logger.info(f"Applied {applied}/{len(to_update)} updates...")

    return updated, skipped_no_mapping, skipped_dead


def verify_sample(
    qdrant_url: str,
    api_key: str,
    collection: str,
    points: list[dict],
    mapping: dict[str, dict[str, str]],
    sample_size: int = 5,
) -> None:
    """Re-fetch a sample of updated points and verify url was changed."""
    # Pick points that had a mapping
    sample = []
    for p in points:
        ns_map = mapping.get(p["namespace"], {})
        if p["md_url"] in ns_map:
            sample.append(p)
        if len(sample) >= sample_size:
            break

    if not sample:
        return

    sample_ids = [p["id"] for p in sample]
    body = {
        "ids": sample_ids,
        "with_payload": ["metadata.url"],
        "with_vector": False,
    }
    data = _qdrant_post(qdrant_url, api_key, f"/collections/{collection}/points", body)
    fetched = data.get("result", [])

    print(f"\n{'=' * 60}")
    print(f"Verification sample ({len(fetched)} points)")
    print(f"{'=' * 60}")
    all_ok = True
    for p in fetched:
        meta = p["payload"].get("metadata", {})
        url = meta.get("url", "")
        is_http = url.startswith("http")
        status = "OK" if is_http else "STILL .md"
        if not is_http:
            all_ok = False
        print(f"  [{status}] {p['id'][:12]}... → {url}")

    if all_ok:
        print("\nAll sampled points now have HTTP URLs.")
    else:
        print("\nWARNING: Some points still have .md URLs!")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfill metadata.url for .md-filename website chunks in Qdrant"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be updated without writing",
    )
    parser.add_argument(
        "--check-urls",
        action="store_true",
        help="HEAD-check each URL before writing; skip unreachable ones",
    )
    parser.add_argument(
        "--namespace",
        type=str,
        default=None,
        help="Restrict to a single candidate namespace (e.g. cand-63113-6)",
    )
    parser.add_argument(
        "--qdrant-url",
        default=os.getenv("QDRANT_URL", "http://212.47.245.238:6333"),
        help="Qdrant base URL",
    )
    parser.add_argument(
        "--qdrant-api-key",
        default=os.getenv("QDRANT_API_KEY", ""),
        help="Qdrant API key",
    )
    parser.add_argument(
        "--collection",
        default="candidates_websites_prod",
        help="Qdrant collection name",
    )
    args = parser.parse_args()

    mode = "DRY RUN" if args.dry_run else "LIVE"
    logger.info(f"Starting .md URL backfill [{mode}]")
    logger.info(f"Qdrant: {args.qdrant_url} / collection: {args.collection}")

    # Step 1: Scroll all .md-url points
    points = scroll_md_url_points(
        args.qdrant_url, args.qdrant_api_key, args.collection, args.namespace
    )

    if not points:
        logger.info("No .md-url points found — nothing to do.")
        return

    # Step 2: Build mapping from > Source: lines in content
    mapping = build_url_mapping(
        points, args.qdrant_url, args.qdrant_api_key, args.collection
    )
    total_mappings = sum(len(v) for v in mapping.values())
    logger.info(
        f"Built URL mapping: {total_mappings} unique .md→URL pairs "
        f"across {len(mapping)} namespaces"
    )

    # Step 3: Preview mapping
    for ns, ns_map in sorted(mapping.items()):
        for md, url in sorted(ns_map.items()):
            logger.info(f"  {ns}: {md} → {url}")

    # Step 4: Apply (or preview) updates
    updated, skipped, skipped_dead = apply_backfill(
        args.qdrant_url,
        args.qdrant_api_key,
        args.collection,
        points,
        mapping,
        dry_run=args.dry_run,
        check_urls_flag=args.check_urls,
    )

    # Step 5: Verify sample (only after real run)
    if not args.dry_run and updated > 0:
        verify_sample(
            args.qdrant_url, args.qdrant_api_key, args.collection, points, mapping
        )

    # Summary
    print(f"\n{'=' * 60}")
    print(f".md URL Backfill Summary ({mode})")
    print(f"{'=' * 60}")
    print(f"Points scanned:       {len(points):,}")
    print(f"URL mappings found:   {total_mappings:,}")
    print(f"Updated:              {updated:,}")
    print(f"Skipped (no mapping): {skipped:,}")
    if skipped_dead:
        print(f"Skipped (dead URL):   {skipped_dead:,}")
    if args.dry_run:
        print("\nRe-run without --dry-run to apply changes.")


if __name__ == "__main__":
    main()
