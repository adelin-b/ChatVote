"""Backfill metadata.url in Qdrant: replace .md filenames with real website URLs.

Reads report.csv from each candidate's Drive folder to build the mapping,
then batch-updates the metadata.url field in Qdrant.

Usage:
    poetry run python scripts/backfill_urls.py --dry-run          # Preview changes
    poetry run python scripts/backfill_urls.py                    # Apply changes
    poetry run python scripts/backfill_urls.py --namespace cand-75056-8  # Single candidate
"""

import argparse
import asyncio
import csv
import io
import json
import logging
import os
import posixpath
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.utils import load_env

load_env()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logger = logging.getLogger(__name__)


def _qdrant_request(qdrant_url: str, api_key: str, path: str, body: dict) -> dict:
    """Make a POST request to Qdrant."""
    url = f"{qdrant_url.rstrip('/')}{path}"
    headers = {"Content-Type": "application/json", "api-key": api_key}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="POST"
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def _qdrant_put(qdrant_url: str, api_key: str, path: str, body: dict) -> dict:
    """Make a PUT request to Qdrant."""
    url = f"{qdrant_url.rstrip('/')}{path}"
    headers = {"Content-Type": "application/json", "api-key": api_key}
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(), headers=headers, method="PUT"
    )
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def scroll_md_chunks(
    qdrant_url: str, api_key: str, collection: str, namespace_filter: str | None = None
) -> dict[str, list[dict]]:
    """Scroll all website chunks with .md URLs, grouped by namespace."""
    by_namespace: dict[str, list[dict]] = defaultdict(list)
    offset = None
    total = 0

    source_types = [
        "candidate_website",
        "candidate_website_programme",
        "candidate_website_proposal",
        "candidate_website_about",
        "candidate_website_pdf",
    ]

    while True:
        body: dict = {
            "limit": 500,
            "with_payload": ["metadata"],
            "with_vector": False,
            "filter": {
                "must": [
                    {
                        "key": "metadata.source_document",
                        "match": {"any": source_types},
                    }
                ]
            },
        }
        if namespace_filter:
            body["filter"]["must"].append(
                {"key": "metadata.namespace", "match": {"value": namespace_filter}}
            )
        if offset is not None:
            body["offset"] = offset

        data = _qdrant_request(
            qdrant_url,
            api_key,
            f"/collections/{collection}/points/scroll",
            body,
        )
        points = data["result"]["points"]
        next_offset = data["result"].get("next_page_offset")

        for p in points:
            meta = p["payload"].get("metadata", {})
            url = meta.get("url", "")
            if url.endswith(".md"):
                ns = meta.get("namespace", "unknown")
                by_namespace[ns].append({"id": p["id"], "metadata": meta, "md_url": url})
                total += 1

        if not next_offset:
            break
        offset = next_offset

    logger.info(f"Found {total} chunks with .md URLs across {len(by_namespace)} namespaces")
    return dict(by_namespace)


async def load_url_map_from_drive(
    candidate_id: str, website_url: str | None
) -> dict[str, str]:
    """Load report.csv from Drive and return {filename: real_url} mapping."""
    import aiohttp
    from src.services.data_pipeline.crawl_scraper import (
        CrawlScraperNode,
        _get_crawl_credentials,
        _slugify_url,
    )

    if not website_url:
        return {}

    try:
        creds = _get_crawl_credentials()
    except Exception:
        logger.warning(f"[{candidate_id}] No Drive credentials")
        return {}

    node = CrawlScraperNode()
    drive_folder_id = node.default_settings["drive_folder_id"]
    slug = _slugify_url(website_url)
    if not slug:
        return {}

    async with aiohttp.ClientSession() as session:
        token = node._ensure_token(creds)

        try:
            subfolders = await node._drive_list(
                session, drive_folder_id, token,
                mime_filter="application/vnd.google-apps.folder",
            )
        except Exception as exc:
            logger.warning(f"[{candidate_id}] Drive list failed: {exc}")
            return {}

        site_folder = next((f for f in subfolders if slug in f["name"]), None)
        if not site_folder:
            logger.warning(f"[{candidate_id}] No Drive folder for slug={slug}")
            return {}

        # Find report.csv
        token = node._ensure_token(creds)
        children = await node._drive_list(session, site_folder["id"], token)
        report_id = next(
            (c["id"] for c in children if c["name"] == "report.csv"), None
        )
        if not report_id:
            logger.warning(f"[{candidate_id}] No report.csv in {site_folder['name']}")
            return {}

        # Download and parse
        token = node._ensure_token(creds)
        raw = await node._drive_download(session, report_id, token)
        url_map: dict[str, str] = {}
        reader = csv.DictReader(
            io.StringIO(raw.decode("utf-8", errors="replace"))
        )
        for row in reader:
            saved_as = row.get("saved_as", "")
            source_url = row.get("url", "")
            if saved_as and source_url:
                filename = posixpath.basename(saved_as)
                url_map[filename] = source_url

        logger.info(
            f"[{candidate_id}] report.csv: {len(url_map)} mappings from {site_folder['name']}"
        )
        return url_map


def batch_update_urls(
    qdrant_client: "QdrantClient",
    collection: str,
    points: list[dict],
    url_map: dict[str, str],
    dry_run: bool,
) -> tuple[int, int]:
    """Update metadata.url for points using the url_map. Returns (updated, skipped)."""
    from qdrant_client.models import SetPayloadOperation, SetPayload

    updated = 0
    skipped = 0

    # Build batch of updates
    ops: list[SetPayloadOperation] = []
    for p in points:
        md_url = p["md_url"]
        real_url = url_map.get(md_url)
        if not real_url:
            skipped += 1
            continue

        new_metadata = dict(p["metadata"])
        new_metadata["url"] = real_url
        ops.append(
            SetPayloadOperation(
                set_payload=SetPayload(
                    payload={"metadata": new_metadata},
                    points=[p["id"]],
                )
            )
        )
        updated += 1

    if dry_run or not ops:
        return updated, skipped

    # Batch update in sub-batches of 100 to avoid oversized requests
    for i in range(0, len(ops), 100):
        sub = ops[i : i + 100]
        qdrant_client.batch_update_points(
            collection_name=collection,
            update_operations=sub,
            wait=True,
        )

    return updated, skipped


async def resolve_website_urls(namespaces: list[str]) -> dict[str, str | None]:
    """Look up website_url from Google Sheet (primary) + Firestore (fallback).

    The crawl service stores candidate_id → website_url in the Google Sheet,
    but many candidates don't have website_url in Firestore. We check both.
    """
    import aiohttp
    from src.services.data_pipeline.crawl_scraper import (
        CrawlScraperNode,
        _get_crawl_credentials,
    )

    result: dict[str, str | None] = {ns: None for ns in namespaces}

    # Step 1: Read Google Sheet for all candidate_id → website_url mappings
    try:
        creds = _get_crawl_credentials()
        node = CrawlScraperNode()
        sheet_id = node.default_settings["sheet_id"]

        async with aiohttp.ClientSession() as session:
            token = node._ensure_token(creds)
            rows = await node._fetch_sheet_rows(session, sheet_id, token)

        # Sheet columns: candidate_id(0), firstname(1), lastname(2), ..., website_url(8)
        for row in rows:
            if len(row) < 9:
                continue
            cid = row[0].strip()
            url = row[8].strip()
            if cid in result and url and url.startswith("http"):
                result[cid] = url

        sheet_found = sum(1 for v in result.values() if v is not None)
        logger.info(f"Google Sheet: resolved {sheet_found}/{len(namespaces)} website URLs")
    except Exception as exc:
        logger.warning(f"Google Sheet lookup failed: {exc}")

    # Step 2: Firestore fallback for any still-missing
    missing = [ns for ns in namespaces if result[ns] is None]
    if missing:
        from src.firebase_service import async_db

        for ns in missing:
            try:
                doc = await async_db.collection("candidates").document(ns).get()
                if doc.exists:
                    data = doc.to_dict()
                    url = data.get("website_url")
                    if url and url.startswith("http"):
                        result[ns] = url
            except Exception:
                pass

        firestore_found = sum(1 for ns in missing if result[ns] is not None)
        logger.info(f"Firestore fallback: resolved {firestore_found}/{len(missing)} more")

    return result


def _make_qdrant_client(url: str, api_key: str) -> "QdrantClient":
    from qdrant_client import QdrantClient

    force_rest = url.startswith("https://")
    return QdrantClient(
        url=url,
        api_key=api_key,
        prefer_grpc=False,
        https=force_rest,
        port=443 if force_rest else 6333,
        timeout=30,
        check_compatibility=False,
    )


async def main(
    qdrant_url: str,
    api_key: str,
    collection: str,
    dry_run: bool,
    namespace_filter: str | None,
) -> None:
    # Step 1: Scroll all .md chunks
    by_namespace = scroll_md_chunks(qdrant_url, api_key, collection, namespace_filter)
    if not by_namespace:
        logger.info("No .md URLs found — nothing to do")
        return

    # Create qdrant client for batch updates
    qclient = _make_qdrant_client(qdrant_url, api_key)

    # Step 2: Resolve website URLs from Firestore
    logger.info(f"Resolving website URLs for {len(by_namespace)} candidates...")
    website_urls = await resolve_website_urls(list(by_namespace.keys()))

    total_updated = 0
    total_skipped = 0
    total_no_website = 0
    total_no_report = 0

    # Step 3: For each candidate, load report.csv and update
    for ns, points in sorted(by_namespace.items()):
        website_url = website_urls.get(ns)
        if not website_url:
            logger.warning(f"[{ns}] No website_url in Firestore — skipping {len(points)} chunks")
            total_no_website += len(points)
            continue

        url_map = await load_url_map_from_drive(ns, website_url)
        if not url_map:
            total_no_report += len(points)
            continue

        updated, skipped = batch_update_urls(
            qclient, collection, points, url_map, dry_run
        )
        total_updated += updated
        total_skipped += skipped

        action = "would update" if dry_run else "updated"
        if updated > 0 or skipped > 0:
            logger.info(f"[{ns}] {action} {updated}, skipped {skipped}/{len(points)}")

    # Summary
    mode = "DRY RUN" if dry_run else "APPLIED"
    print(f"\n{'=' * 50}")
    print(f"URL Backfill Summary ({mode})")
    print(f"{'=' * 50}")
    print(f"Total .md chunks:     {sum(len(v) for v in by_namespace.values()):,}")
    print(f"Updated:              {total_updated:,}")
    print(f"Skipped (no mapping): {total_skipped:,}")
    print(f"No website_url:       {total_no_website:,}")
    print(f"No report.csv:        {total_no_report:,}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Backfill .md URLs with real website URLs in Qdrant"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--namespace", type=str, default=None, help="Single candidate to fix")
    parser.add_argument(
        "--qdrant-url",
        default=os.getenv("QDRANT_URL", "http://212.47.245.238:6333"),
    )
    parser.add_argument(
        "--collection",
        default="candidates_websites_prod",
    )
    args = parser.parse_args()

    api_key = os.getenv(
        "QDRANT_API_KEY",
        "7384d5cc296a254996640081df3a08f824a2f999bb1fb98d91929d811ddc22cb",
    )

    asyncio.run(
        main(
            qdrant_url=args.qdrant_url,
            api_key=api_key,
            collection=args.collection,
            dry_run=args.dry_run,
            namespace_filter=args.namespace,
        )
    )
