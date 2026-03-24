#!/usr/bin/env python3
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
"""
End-to-end chat validation script via Socket.IO.

Tests the full chat flow:
  1. Connect to the backend
  2. Initialize a chat session
  3. Send a question
  4. Collect streamed responses
  5. Validate the results

Usage:
    python scripts/validate_chat_e2e.py [BACKEND_URL]

    BACKEND_URL defaults to http://localhost:8080
"""

import sys

# Check for python-socketio[asyncio_client] before any other imports
try:
    import socketio  # noqa: F401
    import aiohttp  # noqa: F401
except ImportError:
    print("ERROR: Required package(s) not installed.")
    print()
    print("Install with:")
    print("  pip install 'python-socketio[asyncio_client]'")
    print("or, inside the Poetry environment:")
    print("  poetry add 'python-socketio[asyncio_client]'")
    sys.exit(1)

import asyncio
import os
import uuid


BACKEND_URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get("BACKEND_URL", "http://localhost:8080")
)

SESSION_ID = str(uuid.uuid4())
QUESTION = "Quelles sont les propositions pour l'environnement ?"
RESPONSE_TIMEOUT = 60  # seconds


async def run_e2e_test() -> bool:
    """Run the end-to-end chat test. Returns True if all validations pass."""

    # --- state tracking ---
    state = {
        "connected": False,
        "session_initialized": False,
        "session_id": None,
        "responding_parties": [],
        "sources_received": [],  # list of sources payloads
        "chunk_count": 0,
        "completed": False,
        "errors": [],
        "complete_status": None,
    }

    response_complete_event = asyncio.Event()

    sio = socketio.AsyncClient(logger=False, engineio_logger=False)

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    @sio.event
    async def connect():
        state["connected"] = True
        print("  [connect] Connected to backend")

    @sio.event
    async def disconnect():
        print("  [disconnect] Disconnected from backend")

    @sio.event
    async def connect_error(data):
        state["errors"].append(f"connect_error: {data}")
        print(f"  [connect_error] {data}")

    @sio.on("chat_session_initialized")
    async def on_session_initialized(data):
        status = data.get("status", {})
        indicator = status.get("indicator", "")
        if indicator == "success":
            state["session_initialized"] = True
            state["session_id"] = data.get("session_id")
            print(f"  [chat_session_initialized] OK (session_id={state['session_id']})")
        else:
            msg = status.get("message", str(data))
            state["errors"].append(f"session_init_failed: {msg}")
            print(f"  [chat_session_initialized] ERROR: {msg}")

    @sio.on("responding_parties_selected")
    async def on_responding_parties(data):
        parties = data.get("party_ids", [])
        state["responding_parties"] = parties
        print(f"  [responding_parties_selected] parties={parties}")

    @sio.on("sources_ready")
    async def on_sources_ready(data):
        # data may be a dict with a "sources" key (list) or just a list
        if isinstance(data, list):
            sources = data
        elif isinstance(data, dict):
            sources = data.get("sources", [])
        else:
            sources = []
        state["sources_received"].extend(sources)
        party = data.get("party_id") if isinstance(data, dict) else None
        print(
            f"  [sources_ready] received {len(sources)} source(s)"
            + (f" for party={party}" if party else "")
        )

    @sio.on("party_response_chunk_ready")
    async def on_chunk(data):
        state["chunk_count"] += 1
        is_end = data.get("is_end", False)
        party = data.get("party_id", "?")
        idx = data.get("chunk_index", "?")
        if state["chunk_count"] <= 3 or is_end:
            print(
                f"  [party_response_chunk_ready] party={party} idx={idx}"
                f" is_end={is_end} (total chunks so far: {state['chunk_count']})"
            )

    @sio.on("chat_response_complete")
    async def on_complete(data):
        state["completed"] = True
        state["complete_status"] = data.get("status", {})
        indicator = state["complete_status"].get("indicator", "")
        print(f"  [chat_response_complete] status={indicator}")
        if indicator == "error":
            msg = state["complete_status"].get("message", str(data))
            state["errors"].append(f"response_error: {msg}")
            print(f"    ERROR: {msg}")
        response_complete_event.set()

    @sio.on("error")
    async def on_error(data):
        state["errors"].append(f"server_error: {data}")
        print(f"  [error] {data}")
        response_complete_event.set()

    # ------------------------------------------------------------------
    # Test execution
    # ------------------------------------------------------------------

    print(f"\nConnecting to {BACKEND_URL} ...")
    try:
        await sio.connect(
            BACKEND_URL,
            transports=["websocket"],
            wait_timeout=10,
        )
    except Exception as exc:
        state["errors"].append(f"connection_failed: {exc}")
        print(f"  FAILED to connect: {exc}")
        return _print_summary(state)

    # Step 1 — initialize chat session
    print(f"\nEmitting chat_session_init (session_id={SESSION_ID}) ...")
    await sio.emit(
        "chat_session_init",
        {
            "session_id": SESSION_ID,
            "chat_history": [],
            "current_title": "",
            "locale": "fr",
        },
    )

    await asyncio.sleep(2)

    if not state["session_initialized"]:
        state["errors"].append(
            "session_init_timeout: no chat_session_initialized after 2s"
        )

    # Step 2 — send the question
    print("\nEmitting chat_answer_request ...")
    print(f"  question: {QUESTION!r}")
    await sio.emit(
        "chat_answer_request",
        {
            "session_id": SESSION_ID,
            "user_message": QUESTION,
            "party_ids": [],
            "locale": "fr",
        },
    )

    # Step 3 — wait for completion
    print(f"\nWaiting up to {RESPONSE_TIMEOUT}s for chat_response_complete ...")
    try:
        await asyncio.wait_for(response_complete_event.wait(), timeout=RESPONSE_TIMEOUT)
    except asyncio.TimeoutError:
        state["errors"].append(
            f"timeout: no chat_response_complete within {RESPONSE_TIMEOUT}s"
        )
        print(f"  TIMEOUT after {RESPONSE_TIMEOUT}s")

    await sio.disconnect()

    return _print_summary(state)


def _validate_sources(sources: list) -> tuple[bool, list[str]]:
    """Validate that each source has at least one valid identifier."""
    issues = []
    for i, src in enumerate(sources):
        if not isinstance(src, dict):
            issues.append(f"source[{i}] is not a dict: {src!r}")
            continue
        has_id = (
            src.get("candidate_id")
            or src.get("party_id")
            or src.get("namespace")
            or src.get("metadata", {}).get("candidate_id")
            or src.get("metadata", {}).get("party_id")
            or src.get("metadata", {}).get("namespace")
        )
        if not has_id:
            issues.append(
                f"source[{i}] missing candidate_id / party_id / namespace: keys={list(src.keys())}"
            )
    return len(issues) == 0, issues


def _print_summary(state: dict) -> bool:
    """Print validation summary. Returns True if all checks pass."""

    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)

    results = []

    def check(label: str, passed: bool, detail: str = "") -> bool:
        icon = "✅" if passed else "❌"
        line = f"  {icon}  {label}"
        if detail:
            line += f"  ({detail})"
        print(line)
        results.append(passed)
        return passed

    check("Connected successfully", state["connected"])
    check(
        "Session initialized",
        state["session_initialized"],
        f"session_id={state['session_id']}",
    )
    check(
        "Response completed",
        state["completed"],
    )
    check(
        "Got at least 1 chunk",
        state["chunk_count"] >= 1,
        f"total chunks={state['chunk_count']}",
    )

    # Sources validation (optional — only checked if any were received)
    if state["sources_received"]:
        sources_ok, source_issues = _validate_sources(state["sources_received"])
        check(
            "Sources have valid IDs",
            sources_ok,
            f"{len(state['sources_received'])} source(s) checked"
            + ("" if sources_ok else f"; issues: {source_issues}"),
        )
    else:
        print("  ⚠️   No sources received (skipping source ID check)")

    if state["errors"]:
        print()
        print("  Errors encountered:")
        for err in state["errors"]:
            print(f"    • {err}")

    print()
    overall = all(results)
    if overall:
        print("✅  ALL CHECKS PASSED")
    else:
        failed = results.count(False)
        print(f"❌  {failed} CHECK(S) FAILED")
    print("=" * 60)

    return overall


def main():
    passed = asyncio.run(run_e2e_test())
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
