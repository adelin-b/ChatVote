# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""
Unit tests for src/chatbot_async.py.

All tests run WITHOUT external services (no Qdrant, no Firebase, no LLM APIs).
Heavy module-level imports are mocked via sys.modules BEFORE importing the module.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

from langchain_core.documents import Document
from langchain_core.messages import AIMessage

# ---------------------------------------------------------------------------
# Environment setup — must happen BEFORE any src imports
# ---------------------------------------------------------------------------
os.environ.setdefault("API_NAME", "chatvote-api")
os.environ.setdefault("ENV", "local")
os.environ.setdefault("FIRESTORE_EMULATOR_HOST", "localhost:8081")
os.environ.setdefault("GOOGLE_API_KEY", "fake-key-for-testing")

# ---------------------------------------------------------------------------
# Mock heavy module-level imports BEFORE importing src.chatbot_async
# ---------------------------------------------------------------------------

_mock_firebase_service = MagicMock()
_mock_firebase_service.awrite_llm_status = AsyncMock()
sys.modules.setdefault("src.firebase_service", _mock_firebase_service)

_mock_vector_store_helper = MagicMock()
sys.modules.setdefault("src.vector_store_helper", _mock_vector_store_helper)

# Mock LLM provider packages
from langchain_core.language_models.fake_chat_models import (  # noqa: E402
    FakeListChatModel as _FakeChat,
)


def _make_fake_chat(*args, **kwargs):
    return _FakeChat(responses=["mocked response"])


_mock_google = MagicMock()
_mock_google.ChatGoogleGenerativeAI = _make_fake_chat
_mock_openai = MagicMock()
_mock_openai.ChatOpenAI = _make_fake_chat
_mock_openai.AzureChatOpenAI = _make_fake_chat
_mock_anthropic = MagicMock()
_mock_anthropic.ChatAnthropic = _make_fake_chat
_mock_ollama = MagicMock()
_mock_ollama.ChatOllama = _make_fake_chat

for _mod_name, _mock_mod in [
    ("langchain_google_genai", _mock_google),
    ("langchain_openai", _mock_openai),
    ("langchain_anthropic", _mock_anthropic),
    ("langchain_ollama", _mock_ollama),
]:
    sys.modules.setdefault(_mod_name, _mock_mod)

_mock_model_config = MagicMock()
_mock_model_config.GEMINI_2_FLASH = "gemini-2.0-flash"
_mock_model_config.GPT_4O = "gpt-4o"
_mock_model_config.GPT_4O_MINI = "gpt-4o-mini"
_mock_model_config.AZURE_GPT_4O_DEPLOYMENT = "gpt-4o"
_mock_model_config.AZURE_GPT_4O_MINI_DEPLOYMENT = "gpt-4o-mini"
_mock_model_config.CLAUDE_SONNET = "claude-sonnet-4-5"
_mock_model_config.CLAUDE_HAIKU = "claude-haiku-3-5"
_mock_model_config.OLLAMA_CHAT_MODEL = "llama3.2"
_mock_model_config.CAPACITY_GEMINI_2_FLASH = 200
_mock_model_config.CAPACITY_GPT_4O_OPENAI_TIER_5 = 50
_mock_model_config.CAPACITY_GPT_4O_AZURE = 50
_mock_model_config.CAPACITY_GPT_4O_MINI_OPENAI_TIER_5 = 200
_mock_model_config.CAPACITY_GPT_4O_MINI_AZURE = 200
_mock_model_config.CAPACITY_CLAUDE_SONNET = 50
_mock_model_config.CAPACITY_CLAUDE_HAIKU = 200
sys.modules.setdefault("src.model_config", _mock_model_config)

# Evict mocks set by other test files (e.g. test_aiohttp_app.py) so real modules load
sys.modules.pop("src.chatbot_async", None)
sys.modules.pop("src.utils", None)
sys.modules.pop("src.llms", None)

# Now it is safe to import from src.chatbot_async
from langchain_core.language_models.fake_chat_models import FakeListChatModel  # noqa: E402
from langchain_core.messages import HumanMessage, SystemMessage  # noqa: E402

from src.models.general import LLM, LLMSize  # noqa: E402
from src.models.party import Party  # noqa: E402
from src.models.structured_outputs import RerankingOutput  # noqa: E402

from src.chatbot_async import (  # noqa: E402
    rerank_documents,
    get_improved_rag_query_voting_behavior,
)

# ---------------------------------------------------------------------------


# Helpers
# ---------------------------------------------------------------------------


def make_llm(
    name: str,
    priority: int = 100,
    sizes: list[LLMSize] | None = None,
    responses: list[str] | None = None,
    fail: bool = False,
) -> LLM:
    model = FakeListChatModel(responses=responses or ["default response"])
    if fail:
        object.__setattr__(
            model, "ainvoke", AsyncMock(side_effect=Exception(f"{name} failed"))
        )

        async def _failing_stream(messages, **kwargs):
            raise Exception(f"{name} stream failed")
            yield  # type: ignore[misc]

        object.__setattr__(model, "astream", _failing_stream)
    return LLM(
        name=name,
        model=model,
        sizes=sizes or [LLMSize.LARGE],
        priority=priority,
        user_capacity_per_minute=100,
        is_at_rate_limit=False,
    )


def make_party(
    party_id: str = "test-party",
    name: str = "Test",
    long_name: str = "Test Party",
    is_small: bool = False,
) -> Party:
    return Party(
        party_id=party_id,
        name=name,
        long_name=long_name,
        description="A test party",
        website_url="https://test.fr",
        candidate="Jean Test",
        election_manifesto_url="https://test.fr/manifesto.pdf",
        is_small_party=is_small,
    )


def make_document(
    content: str = "Document content",
    metadata: dict | None = None,
) -> Document:
    return Document(page_content=content, metadata=metadata or {})


class TestRerankDocuments:
    async def test_returns_reranked_documents(self):
        docs = [
            make_document("Doc A"),
            make_document("Doc B"),
            make_document("Doc C"),
        ]
        reranked_response = RerankingOutput(reranked_doc_indices=[2, 0, 1])

        with patch(
            "src.chatbot_async.get_structured_output_from_llms",
            new_callable=AsyncMock,
            return_value=reranked_response,
        ):
            result = await rerank_documents(docs, "test question", "chat history")

        assert result[0].page_content == "Doc C"
        assert result[1].page_content == "Doc A"

    async def test_limits_to_top_5(self):
        docs = [make_document(f"Doc {i}") for i in range(8)]
        reranked_response = RerankingOutput(
            reranked_doc_indices=[7, 6, 5, 4, 3, 2, 1, 0]
        )

        with patch(
            "src.chatbot_async.get_structured_output_from_llms",
            new_callable=AsyncMock,
            return_value=reranked_response,
        ):
            result = await rerank_documents(docs, "question", "history")

        assert len(result) == 5

    async def test_falls_back_to_top5_on_error(self):
        docs = [make_document(f"Doc {i}") for i in range(7)]
        bad_response = MagicMock()
        bad_response.reranked_doc_indices = [99, 98, 97]  # invalid indices

        with patch(
            "src.chatbot_async.get_structured_output_from_llms",
            new_callable=AsyncMock,
            return_value=bad_response,
        ):
            result = await rerank_documents(docs, "question", "history")

        # Should fall back to first 5 original docs
        assert len(result) == 5
        assert result[0].page_content == "Doc 0"

    async def test_empty_reranked_indices_falls_back(self):
        docs = [make_document(f"Doc {i}") for i in range(3)]
        empty_response = RerankingOutput(reranked_doc_indices=[])

        with patch(
            "src.chatbot_async.get_structured_output_from_llms",
            new_callable=AsyncMock,
            return_value=empty_response,
        ):
            result = await rerank_documents(docs, "question", "history")

        assert result == []

    async def test_calls_get_structured_output_with_messages(self):
        docs = [make_document("Content")]
        response = RerankingOutput(reranked_doc_indices=[0])

        with patch(
            "src.chatbot_async.get_structured_output_from_llms",
            new_callable=AsyncMock,
            return_value=response,
        ) as mock_llm:
            await rerank_documents(docs, "user question", "history")

        mock_llm.assert_awaited_once()
        args = mock_llm.call_args[0]
        messages = args[1]
        # Should be a list of [SystemMessage, HumanMessage]
        assert len(messages) == 2
        assert isinstance(messages[0], SystemMessage)
        assert isinstance(messages[1], HumanMessage)

    async def test_user_message_in_prompt(self):
        docs = [make_document("Content")]
        response = RerankingOutput(reranked_doc_indices=[0])
        captured = {}

        async def capture(*args, **kwargs):
            captured["messages"] = args[1]
            return response

        with patch(
            "src.chatbot_async.get_structured_output_from_llms", side_effect=capture
        ):
            await rerank_documents(docs, "specific user question", "history")

        human_msg = captured["messages"][1]
        assert "specific user question" in human_msg.content


# ---------------------------------------------------------------------------
# Tests: get_question_targets_and_type (LLM-dependent)
# ---------------------------------------------------------------------------


class TestGetImprovedRagQueryVotingBehavior:
    async def test_returns_string_content(self):
        party = make_party("lfi", "LFI")
        llm_response = AIMessage(content="Improved voting query")

        with patch(
            "src.chatbot_async.get_answer_from_llms",
            new_callable=AsyncMock,
            return_value=llm_response,
        ):
            result = await get_improved_rag_query_voting_behavior(
                party, "last user message", "last assistant message"
            )

        assert result == "Improved voting query"

    async def test_includes_party_name_in_prompt(self):
        party = make_party("lfi", "LFI")
        captured = {}

        async def capture(*args, **kwargs):
            captured["messages"] = args[1]
            return AIMessage(content="query")

        with patch("src.chatbot_async.get_answer_from_llms", side_effect=capture):
            await get_improved_rag_query_voting_behavior(party, "user msg", "asst msg")

        # Party name should appear in messages
        all_content = " ".join(msg.content for msg in captured["messages"])
        assert "LFI" in all_content

    async def test_includes_user_and_assistant_messages_in_prompt(self):
        party = make_party()
        captured = {}

        async def capture(*args, **kwargs):
            captured["messages"] = args[1]
            return AIMessage(content="query")

        with patch("src.chatbot_async.get_answer_from_llms", side_effect=capture):
            await get_improved_rag_query_voting_behavior(
                party, "specific user question", "specific assistant answer"
            )

        human_msg = captured["messages"][1]
        assert "specific user question" in human_msg.content
        assert "specific assistant answer" in human_msg.content


# ---------------------------------------------------------------------------
# Tests: generate_chat_title_and_chick_replies (LLM-dependent)
# ---------------------------------------------------------------------------
