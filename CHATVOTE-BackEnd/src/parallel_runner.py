"""Generic parallel job runner using Firestore as a work queue.

Usage:
    # Enqueue work items
    run_id = await enqueue_items("profession_index", [
        {"commune_code": "75056", "candidate_id": "cand-75056-1", "pdf_url": "https://..."},
        ...
    ])

    # Worker loop (each K8s pod runs this)
    await worker_loop("profession_index", run_id, process_fn)

    # Monitor progress
    status = await get_run_status(run_id)

Firestore layout:
    _job_runs/{run_id}                        — job metadata doc
    _job_runs/{run_id}/items/{item_id}        — individual work item doc

Item statuses: pending → processing → done / failed
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable

from google.cloud.firestore_v1 import AsyncTransaction

logger = logging.getLogger(__name__)

_RUNS_COLLECTION = "_job_runs"
_ITEMS_SUBCOLLECTION = "items"

# How many Firestore writes per batch (API limit: 500)
_BATCH_SIZE = 500

# How often (in completed items) to log ETA
_ETA_LOG_INTERVAL = 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_worker_id() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def enqueue_items(
    job_type: str,
    items: list[dict[str, Any]],
    run_id: str | None = None,
) -> str:
    """Create a job run and enqueue work items in Firestore.

    Args:
        job_type: Logical name for this job class, e.g. "profession_index".
        items: List of payload dicts. Each becomes one work item.
        run_id: Optional explicit run ID. Auto-generated if omitted.

    Returns:
        The run_id string.
    """
    from src.firebase_service import async_db

    if run_id is None:
        run_id = f"{job_type}-{int(time.time())}"

    run_ref = async_db.collection(_RUNS_COLLECTION).document(run_id)
    await run_ref.set(
        {
            "job_type": job_type,
            "run_id": run_id,
            "created_at": _now_iso(),
            "total_items": len(items),
            "status": "running",
            "worker_count": 0,
        }
    )
    logger.info("[parallel_runner] created run %s with %d items", run_id, len(items))

    items_coll = run_ref.collection(_ITEMS_SUBCOLLECTION)

    # Write in batches of up to _BATCH_SIZE
    for batch_start in range(0, len(items), _BATCH_SIZE):
        batch = async_db.batch()
        chunk = items[batch_start : batch_start + _BATCH_SIZE]
        for payload in chunk:
            item_id = str(uuid.uuid4())
            doc_ref = items_coll.document(item_id)
            batch.set(
                doc_ref,
                {
                    "payload": payload,
                    "status": "pending",
                    "claimed_by": None,
                    "claimed_at": None,
                    "completed_at": None,
                    "error": None,
                    "result": None,
                },
            )
        await batch.commit()
        logger.debug(
            "[parallel_runner] enqueued batch %d-%d for run %s",
            batch_start,
            batch_start + len(chunk) - 1,
            run_id,
        )

    return run_id


async def claim_next_item(
    run_id: str,
    worker_id: str,
) -> tuple[str, dict[str, Any]] | None:
    """Atomically claim the next pending work item.

    Uses a Firestore transaction to find the first pending item and mark it
    as processing.  Safe for concurrent workers.

    Returns:
        (item_id, payload) if an item was claimed, else None (queue empty).
    """
    from src.firebase_service import async_db

    items_coll = (
        async_db.collection(_RUNS_COLLECTION)
        .document(run_id)
        .collection(_ITEMS_SUBCOLLECTION)
    )

    # Query for a pending item outside the transaction (cheap read)
    query = items_coll.where("status", "==", "pending").limit(1)
    docs = await query.get()
    if not docs:
        return None

    doc = docs[0]
    item_ref = items_coll.document(doc.id)

    @firestore_async_transactional
    async def _claim(transaction: AsyncTransaction) -> bool:
        """Return True if we successfully claimed the item."""
        snapshot = await item_ref.get(transaction=transaction)
        if not snapshot.exists:
            return False
        data = snapshot.to_dict() or {}
        if data.get("status") != "pending":
            return False
        transaction.update(
            item_ref,
            {
                "status": "processing",
                "claimed_by": worker_id,
                "claimed_at": _now_iso(),
            },
        )
        return True

    transaction = async_db.transaction()
    claimed = await _claim(transaction)

    if not claimed:
        # Another worker grabbed it — caller should retry
        return None

    payload = (doc.to_dict() or {}).get("payload", {})
    return doc.id, payload


async def complete_item(
    run_id: str,
    item_id: str,
    result: dict[str, Any] | None = None,
) -> None:
    """Mark a work item as done."""
    from src.firebase_service import async_db

    ref = (
        async_db.collection(_RUNS_COLLECTION)
        .document(run_id)
        .collection(_ITEMS_SUBCOLLECTION)
        .document(item_id)
    )
    await ref.update(
        {
            "status": "done",
            "completed_at": _now_iso(),
            "result": result or {},
        }
    )


async def fail_item(run_id: str, item_id: str, error: str) -> None:
    """Mark a work item as failed."""
    from src.firebase_service import async_db

    ref = (
        async_db.collection(_RUNS_COLLECTION)
        .document(run_id)
        .collection(_ITEMS_SUBCOLLECTION)
        .document(item_id)
    )
    await ref.update(
        {
            "status": "failed",
            "completed_at": _now_iso(),
            "error": error,
        }
    )


async def reclaim_stale_items(run_id: str, timeout_minutes: int = 30) -> int:
    """Reset items stuck in 'processing' longer than timeout back to 'pending'.

    Handles crashed workers that left items claimed but never completed.

    Returns:
        Number of items reclaimed.
    """
    from src.firebase_service import async_db
    from datetime import timedelta

    cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
    cutoff_iso = cutoff_dt.isoformat()

    items_coll = (
        async_db.collection(_RUNS_COLLECTION)
        .document(run_id)
        .collection(_ITEMS_SUBCOLLECTION)
    )

    query = items_coll.where("status", "==", "processing")
    docs = await query.get()

    reclaimed = 0
    for doc in docs:
        data = doc.to_dict() or {}
        claimed_at = data.get("claimed_at", "")
        if claimed_at and claimed_at < cutoff_iso:
            await doc.reference.update(
                {
                    "status": "pending",
                    "claimed_by": None,
                    "claimed_at": None,
                }
            )
            reclaimed += 1
            logger.info(
                "[parallel_runner] reclaimed stale item %s (claimed_at=%s)",
                doc.id,
                claimed_at,
            )

    if reclaimed:
        logger.info(
            "[parallel_runner] reclaimed %d stale items for run %s", reclaimed, run_id
        )
    return reclaimed


async def get_run_status(run_id: str) -> dict[str, Any]:
    """Return aggregated status for a job run.

    Returns a dict with keys:
        total, pending, processing, done, failed,
        elapsed_s, eta_seconds, items_per_second, status
    """
    from src.firebase_service import async_db

    run_ref = async_db.collection(_RUNS_COLLECTION).document(run_id)
    run_doc = await run_ref.get()
    if not run_doc.exists:
        return {"error": f"run {run_id!r} not found"}

    run_data = run_doc.to_dict() or {}
    created_at_iso = run_data.get("created_at", "")

    items_coll = run_ref.collection(_ITEMS_SUBCOLLECTION)
    all_items = await items_coll.get()

    counts: dict[str, int] = {"pending": 0, "processing": 0, "done": 0, "failed": 0}
    completion_times: list[str] = []

    for doc in all_items:
        data = doc.to_dict() or {}
        status = data.get("status", "pending")
        counts[status] = counts.get(status, 0) + 1
        if status == "done" and data.get("completed_at"):
            completion_times.append(data["completed_at"])

    total = sum(counts.values())
    done = counts.get("done", 0)
    failed = counts.get("failed", 0)
    finished = done + failed

    # Elapsed time
    elapsed_s: float = 0.0
    if created_at_iso:
        try:
            created_dt = datetime.fromisoformat(created_at_iso)
            elapsed_s = (datetime.now(timezone.utc) - created_dt).total_seconds()
        except Exception:
            pass

    # ETA calculation based on recent throughput
    items_per_second: float = 0.0
    eta_seconds: float | None = None
    if completion_times and elapsed_s > 0:
        items_per_second = done / elapsed_s if elapsed_s > 0 else 0.0
        remaining = total - finished
        if items_per_second > 0 and remaining > 0:
            eta_seconds = remaining / items_per_second

    # Overall run status
    if finished == total and total > 0:
        overall_status = "complete" if failed == 0 else "complete_with_errors"
    else:
        overall_status = run_data.get("status", "running")

    return {
        "run_id": run_id,
        "job_type": run_data.get("job_type"),
        "total": total,
        "pending": counts.get("pending", 0),
        "processing": counts.get("processing", 0),
        "done": done,
        "failed": failed,
        "elapsed_s": round(elapsed_s, 1),
        "items_per_second": round(items_per_second, 3),
        "eta_seconds": round(eta_seconds, 0) if eta_seconds is not None else None,
        "status": overall_status,
    }


async def worker_loop(
    job_type: str,
    run_id: str,
    process_fn: Callable[[dict[str, Any]], Awaitable[dict[str, Any] | None]],
    worker_id: str | None = None,
) -> int:
    """Main worker loop: claim items, process them, mark done/failed.

    Each K8s pod calls this function.  The loop exits automatically when the
    queue is empty (no more pending or processing items).

    Args:
        job_type: For logging only.
        run_id: The run to consume from.
        process_fn: Async callable that receives a payload dict and returns a
                    result dict (or None).  Should raise on fatal errors.
        worker_id: Unique pod identifier.  Auto-generated if omitted.

    Returns:
        Total number of items this worker processed.
    """
    if worker_id is None:
        worker_id = _default_worker_id()

    logger.info(
        "[parallel_runner] worker %s starting on run %s (%s)",
        worker_id,
        run_id,
        job_type,
    )

    processed = 0
    consecutive_empty = 0
    # We retry a few times when the queue looks empty in case of in-flight items
    _MAX_EMPTY_RETRIES = 3
    _EMPTY_RETRY_DELAY = 5.0  # seconds

    while True:
        claimed = await claim_next_item(run_id, worker_id)

        if claimed is None:
            consecutive_empty += 1
            if consecutive_empty >= _MAX_EMPTY_RETRIES:
                logger.info(
                    "[parallel_runner] worker %s: queue empty after %d retries, exiting",
                    worker_id,
                    consecutive_empty,
                )
                break
            logger.debug(
                "[parallel_runner] worker %s: no item claimed (attempt %d/%d), waiting %.1fs",
                worker_id,
                consecutive_empty,
                _MAX_EMPTY_RETRIES,
                _EMPTY_RETRY_DELAY,
            )
            await asyncio.sleep(_EMPTY_RETRY_DELAY)
            continue

        consecutive_empty = 0
        item_id, payload = claimed
        logger.debug("[parallel_runner] worker %s claimed item %s", worker_id, item_id)

        try:
            result = await process_fn(payload)
            await complete_item(run_id, item_id, result or {})
            processed += 1
        except Exception as exc:
            error_msg = f"{type(exc).__name__}: {exc}"
            logger.error(
                "[parallel_runner] worker %s: item %s failed: %s",
                worker_id,
                item_id,
                error_msg,
            )
            await fail_item(run_id, item_id, error_msg)
            processed += 1  # still count as processed (attempted)

        if processed % _ETA_LOG_INTERVAL == 0:
            try:
                status = await get_run_status(run_id)
                eta = status.get("eta_seconds")
                eta_str = f"{eta:.0f}s" if eta is not None else "unknown"
                logger.info(
                    "[parallel_runner] worker %s progress — done=%d failed=%d pending=%d "
                    "rate=%.2f/s ETA=%s",
                    worker_id,
                    status.get("done", 0),
                    status.get("failed", 0),
                    status.get("pending", 0),
                    status.get("items_per_second", 0.0),
                    eta_str,
                )
            except Exception:
                pass  # ETA logging is best-effort

    logger.info(
        "[parallel_runner] worker %s finished — processed %d items",
        worker_id,
        processed,
    )
    return processed


# ---------------------------------------------------------------------------
# Firestore async transaction decorator (local import to avoid circular deps)
# ---------------------------------------------------------------------------


def firestore_async_transactional(fn: Callable) -> Callable:
    """Wrap an async function so it runs inside a Firestore transaction."""
    from google.cloud.firestore_v1.async_transaction import async_transactional

    return async_transactional(fn)
