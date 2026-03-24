"""
Shared fixtures for unit tests.

All fixtures here are designed to work WITHOUT external services
(no Qdrant, no Firebase, no LLM APIs, no Ollama).
"""

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

# Ensure project root is on path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ---------------------------------------------------------------------------
# Environment setup — prevent real service connections during unit tests
# ---------------------------------------------------------------------------

# Set API_NAME before any src imports to avoid load_env() failures
os.environ.setdefault("API_NAME", "chatvote-api")
os.environ.setdefault("ENV", "local")
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "localhost:8081")
os.environ.setdefault("GOOGLE_API_KEY", "fake-key-for-testing")


# ---------------------------------------------------------------------------
# Fake LLM fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_llm():
    """A FakeListChatModel that cycles through responses."""
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    return FakeListChatModel(responses=["Réponse simulée du LLM."])


@pytest.fixture
def make_fake_llm():
    """Factory: create a FakeListChatModel with custom responses."""
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    def _factory(responses: list[str]) -> FakeListChatModel:
        return FakeListChatModel(responses=responses)

    return _factory


# ---------------------------------------------------------------------------
# Mock Firestore fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_firestore_doc():
    """Factory for mock Firestore document snapshots."""

    def _factory(data: dict | None = None, exists: bool = True):
        doc = MagicMock()
        doc.exists = exists
        doc.to_dict.return_value = data if exists else None
        doc.id = data.get("id", "test-doc-id") if data else "test-doc-id"
        return doc

    return _factory


@pytest.fixture
def mock_async_db():
    """Mock async Firestore client with sensible defaults."""
    db = MagicMock()
    # Default: document().get() returns a doc that exists
    default_doc = MagicMock()
    default_doc.exists = True
    default_doc.to_dict.return_value = {"session_id": "test", "messages": []}
    db.collection.return_value.document.return_value.get = AsyncMock(
        return_value=default_doc
    )
    db.collection.return_value.document.return_value.set = AsyncMock()
    db.collection.return_value.document.return_value.update = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# Model factory fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def party_factory():
    """Factory for Party model instances."""
    from src.models.party import Party

    def _factory(**overrides):
        defaults = {
            "party_id": "test-party",
            "name": "Test Party",
            "long_name": "The Test Party",
            "description": "A test party",
            "website_url": "https://test-party.fr",
            "candidate": "Jean Test",
            "election_manifesto_url": "https://test-party.fr/manifesto.pdf",
        }
        return Party(**(defaults | overrides))

    return _factory


@pytest.fixture
def candidate_factory():
    """Factory for Candidate model instances."""
    from src.models.candidate import Candidate

    def _factory(**overrides):
        defaults = {
            "candidate_id": "cand-001",
            "first_name": "Marie",
            "last_name": "Dupont",
            "election_type_id": "municipales-2026",
        }
        return Candidate(**(defaults | overrides))

    return _factory


@pytest.fixture
def message_factory():
    """Factory for Message model instances."""
    from src.models.chat import Message, Role

    def _factory(**overrides):
        defaults = {
            "role": Role.USER,
            "content": "Question de test",
        }
        return Message(**(defaults | overrides))

    return _factory


@pytest.fixture
def sample_parties(party_factory):
    """A list of sample parties for testing."""
    return [
        party_factory(party_id="lfi", name="LFI", long_name="La France Insoumise"),
        party_factory(party_id="rn", name="RN", long_name="Rassemblement National"),
        party_factory(party_id="ps", name="PS", long_name="Parti Socialiste"),
    ]
