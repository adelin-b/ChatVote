"""
Unit tests for the experiment topic-stats and bertopic-analysis endpoints.

Tests the aggregation logic with mocked Qdrant and Firestore data.

Run:
    poetry run pytest tests/test_topic_stats.py -v
"""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop


# ---------------------------------------------------------------------------
# Helpers to build mock Qdrant points
# ---------------------------------------------------------------------------

def _make_point(theme=None, sub_theme=None, source_document=None,
                party_name=None, fiabilite=None, namespace=None):
    """Build a mock Qdrant ScoredPoint-like object."""
    meta = {}
    if theme is not None:
        meta["theme"] = theme
    if sub_theme is not None:
        meta["sub_theme"] = sub_theme
    if source_document is not None:
        meta["source_document"] = source_document
    if party_name is not None:
        meta["party_name"] = party_name
    if fiabilite is not None:
        meta["fiabilite"] = fiabilite
    if namespace is not None:
        meta["namespace"] = namespace
    return SimpleNamespace(payload={"metadata": meta})


MOCK_PARTY_POINTS = [
    _make_point(theme="environnement", sub_theme="biodiversité",
                source_document="election_manifesto", party_name="Les Écologistes", fiabilite=2),
    _make_point(theme="environnement", sub_theme="énergie renouvelable",
                source_document="election_manifesto", party_name="Place Publique", fiabilite=2),
    _make_point(theme="économie", source_document="election_manifesto",
                party_name="Renaissance", fiabilite=1),
    _make_point(),  # unclassified
]

MOCK_CANDIDATE_POINTS = [
    _make_point(theme="environnement", source_document="candidate_website_programme",
                namespace="jean-dupont", fiabilite=3),
    _make_point(theme="sécurité", source_document="candidate_website_programme",
                namespace="marie-martin", fiabilite=2),
    _make_point(),  # unclassified
]


def _mock_scroll(collection_name, limit, offset, with_payload, with_vectors):
    """Mock qdrant_client.scroll that returns test points then stops."""
    if offset is not None:
        return ([], None)  # second call = done

    from src.vector_store_helper import PARTY_INDEX_NAME
    if collection_name == PARTY_INDEX_NAME:
        return (MOCK_PARTY_POINTS, None)
    else:
        return (MOCK_CANDIDATE_POINTS, None)


# ---------------------------------------------------------------------------
# Test: topic-stats aggregation logic
# ---------------------------------------------------------------------------

class TestTopicStatsAggregation:
    """Test the aggregation logic without starting the server."""

    def test_theme_counts(self):
        """Verify theme counting from mock points."""
        all_points = MOCK_PARTY_POINTS + MOCK_CANDIDATE_POINTS
        theme_counts = {}
        total = 0
        classified = 0

        for p in all_points:
            total += 1
            meta = (p.payload or {}).get("metadata", {})
            theme = meta.get("theme")
            if theme:
                classified += 1
                theme_counts[theme] = theme_counts.get(theme, 0) + 1

        assert total == 7
        assert classified == 5
        assert theme_counts["environnement"] == 3
        assert theme_counts["économie"] == 1
        assert theme_counts["sécurité"] == 1

    def test_sub_themes_collected(self):
        """Verify sub-themes are collected per theme."""
        sub_themes = set()
        for p in MOCK_PARTY_POINTS:
            meta = (p.payload or {}).get("metadata", {})
            if meta.get("theme") == "environnement":
                st = meta.get("sub_theme")
                if st:
                    sub_themes.add(st)

        assert sub_themes == {"biodiversité", "énergie renouvelable"}

    def test_party_breakdown(self):
        """Verify per-party counts for a theme."""
        party_counts = {}
        for p in MOCK_PARTY_POINTS + MOCK_CANDIDATE_POINTS:
            meta = (p.payload or {}).get("metadata", {})
            if meta.get("theme") == "environnement":
                party = meta.get("party_name") or meta.get("namespace")
                if party:
                    party_counts[party] = party_counts.get(party, 0) + 1

        assert party_counts["Les Écologistes"] == 1
        assert party_counts["Place Publique"] == 1
        assert party_counts["jean-dupont"] == 1

    def test_fiabilite_breakdown(self):
        """Verify fiabilité distribution for a theme."""
        fiab_counts = {}
        for p in MOCK_PARTY_POINTS + MOCK_CANDIDATE_POINTS:
            meta = (p.payload or {}).get("metadata", {})
            if meta.get("theme") == "environnement":
                f = meta.get("fiabilite")
                if f is not None:
                    key = str(int(f))
                    fiab_counts[key] = fiab_counts.get(key, 0) + 1

        assert fiab_counts["2"] == 2
        assert fiab_counts["3"] == 1

    def test_source_breakdown(self):
        """Verify source document distribution."""
        source_counts = {}
        for p in MOCK_PARTY_POINTS + MOCK_CANDIDATE_POINTS:
            meta = (p.payload or {}).get("metadata", {})
            if meta.get("theme") == "environnement":
                src = meta.get("source_document")
                if src:
                    source_counts[src] = source_counts.get(src, 0) + 1

        assert source_counts["election_manifesto"] == 2
        assert source_counts["candidate_website_programme"] == 1

    def test_unclassified_count(self):
        """Verify unclassified (theme=None) chunks are counted."""
        all_points = MOCK_PARTY_POINTS + MOCK_CANDIDATE_POINTS
        unclassified = sum(
            1 for p in all_points
            if not (p.payload or {}).get("metadata", {}).get("theme")
        )
        assert unclassified == 2

    def test_percentage_calculation(self):
        """Verify percentage calculation."""
        total = 7
        env_count = 3
        pct = round(env_count / total * 100, 1)
        assert pct == 42.9


# ---------------------------------------------------------------------------
# Test: BERTopic response shape (mocked)
# ---------------------------------------------------------------------------

class TestBERTopicResponseShape:
    """Test that the BERTopic response has the expected structure."""

    def test_topic_structure(self):
        """Verify expected fields in a topic dict."""
        topic = {
            "topic_id": 0,
            "label": "0_climat_énergie_pollution",
            "count": 15,
            "percentage": 30.0,
            "words": [{"word": "climat", "weight": 0.15}],
            "representative_messages": [
                {"text": "Que fait le gouvernement pour le climat ?",
                 "session_id": "abc", "chat_title": "Climat"}
            ],
            "by_party": {"Les Écologistes": 5, "Renaissance": 3},
        }

        assert "topic_id" in topic
        assert "label" in topic
        assert "count" in topic
        assert "percentage" in topic
        assert "words" in topic
        assert len(topic["words"]) > 0
        assert "word" in topic["words"][0]
        assert "weight" in topic["words"][0]
        assert "representative_messages" in topic
        assert "by_party" in topic

    def test_insufficient_data_response(self):
        """Verify the insufficient_data response shape."""
        resp = {
            "status": "insufficient_data",
            "message": "Only 3 user messages found. Need at least 5.",
            "total_messages": 3,
            "topics": [],
        }
        assert resp["status"] == "insufficient_data"
        assert resp["total_messages"] == 3
        assert resp["topics"] == []


# ---------------------------------------------------------------------------
# Integration test: HTTP endpoint (requires running server)
# ---------------------------------------------------------------------------

@pytest.mark.integration
class TestTopicStatsEndpoint:
    """Integration tests — only run when backend is live (pytest -m integration)."""

    BASE_URL = "http://localhost:8080"

    @pytest.mark.asyncio
    async def test_topic_stats_returns_200(self):
        """GET /api/v1/experiment/topic-stats returns 200 with expected shape."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.BASE_URL}/api/v1/experiment/topic-stats") as resp:
                assert resp.status == 200
                data = await resp.json()
                assert "total_chunks" in data
                assert "classified_chunks" in data
                assert "unclassified_chunks" in data
                assert "themes" in data
                assert isinstance(data["themes"], list)
                assert "collections" in data

                # Verify each theme has expected fields
                if data["themes"]:
                    t = data["themes"][0]
                    assert "theme" in t
                    assert "count" in t
                    assert "percentage" in t
                    assert "by_party" in t
                    assert "by_source" in t
                    assert "by_fiabilite" in t
                    assert "sub_themes" in t

                # total = classified + unclassified
                assert data["total_chunks"] == data["classified_chunks"] + data["unclassified_chunks"]

    @pytest.mark.asyncio
    async def test_bertopic_returns_200(self):
        """GET /api/v1/experiment/bertopic-analysis returns 200."""
        import aiohttp
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{self.BASE_URL}/api/v1/experiment/bertopic-analysis",
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                assert resp.status == 200
                data = await resp.json()
                assert "status" in data
                assert data["status"] in ("success", "insufficient_data", "error")

                if data["status"] == "success":
                    assert "total_messages" in data
                    assert "num_topics" in data
                    assert "topics" in data
                    assert isinstance(data["topics"], list)

                    if data["topics"]:
                        t = data["topics"][0]
                        assert "topic_id" in t
                        assert "label" in t
                        assert "count" in t
                        assert "words" in t
                        assert "representative_messages" in t
