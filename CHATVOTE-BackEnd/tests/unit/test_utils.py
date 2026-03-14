# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

"""
Unit tests for src/utils.py.

All tests run without external services (no Qdrant, Firebase, LLM APIs).
"""

import os
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.documents import Document
from pydantic import SecretStr

from src.models.chat import Message, Role
from src.models.assistant import CHATVOTE_ASSISTANT
from src.utils import (
    build_chat_history_string,
    build_document_string_for_context,
    build_message_from_perplexity_response,
    build_party_str,
    get_chat_history_hash_key,
    get_cors_allowed_origins,
    safe_load_api_key,
    sanitize_references,
)


# ---------------------------------------------------------------------------
# load_env()
# ---------------------------------------------------------------------------


class TestLoadEnv:
    """Tests for load_env() which guards environment initialisation."""

    def test_returns_early_when_api_name_already_correct(self):
        """When API_NAME == 'chatvote-api', load_env() must return without calling load_dotenv."""
        with patch.dict(os.environ, {"API_NAME": "chatvote-api"}):
            with patch("src.utils.load_dotenv") as mock_load:
                from src.utils import load_env

                load_env()
                mock_load.assert_not_called()

    def test_raises_when_api_name_set_to_wrong_value(self):
        """When API_NAME is set to an unexpected value, load_env() must raise ValueError immediately."""
        with patch.dict(os.environ, {"API_NAME": "wrong-name"}, clear=False):
            with patch("src.utils.load_dotenv"):
                from src.utils import load_env

                with pytest.raises(ValueError, match="wrong-name"):
                    load_env()

    def test_loads_dotenv_when_api_name_not_set_and_env_file_exists(self, tmp_path):
        """When API_NAME is absent and a .env file exists, load_dotenv() is called and API_NAME set."""
        env_file = tmp_path / ".env"
        env_file.write_text("API_NAME=chatvote-api\n")

        env_without_api_name = {k: v for k, v in os.environ.items() if k != "API_NAME"}

        def _fake_load_dotenv(path, override=False):
            os.environ["API_NAME"] = "chatvote-api"

        with patch.dict(os.environ, env_without_api_name, clear=True):
            with patch(
                "src.utils.load_dotenv", side_effect=_fake_load_dotenv
            ) as mock_load:
                with patch("src.utils.BASE_DIR", tmp_path):
                    from src.utils import load_env

                    load_env()
                    mock_load.assert_called_once()

    def test_raises_when_api_name_not_set_and_no_env_file(self, tmp_path):
        """When API_NAME is absent and no .env file exists, load_env() must raise ValueError."""
        env_without_api_name = {k: v for k, v in os.environ.items() if k != "API_NAME"}

        with patch.dict(os.environ, env_without_api_name, clear=True):
            with patch(
                "src.utils.load_dotenv"
            ):  # dotenv is a no-op — doesn't set API_NAME
                with patch("src.utils.BASE_DIR", tmp_path):
                    from src.utils import load_env

                    with pytest.raises(ValueError, match="API_NAME"):
                        load_env()


# ---------------------------------------------------------------------------
# safe_load_api_key()
# ---------------------------------------------------------------------------


class TestSafeLoadApiKey:
    def test_returns_secret_str_when_env_var_is_set(self):
        with patch.dict(os.environ, {"MY_API_KEY": "super-secret-value"}):
            result = safe_load_api_key("MY_API_KEY")
            assert isinstance(result, SecretStr)
            assert result.get_secret_value() == "super-secret-value"

    def test_returns_none_when_env_var_not_set(self):
        env = {k: v for k, v in os.environ.items() if k != "MY_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            result = safe_load_api_key("MY_API_KEY")
            assert result is None

    def test_returns_none_when_env_var_is_empty_string(self):
        with patch.dict(os.environ, {"MY_API_KEY": ""}):
            result = safe_load_api_key("MY_API_KEY")
            assert result is None


# ---------------------------------------------------------------------------
# get_cors_allowed_origins()
# ---------------------------------------------------------------------------


class TestGetCorsAllowedOrigins:
    def test_returns_wildcard_for_dev(self):
        assert get_cors_allowed_origins("dev") == "*"

    def test_returns_wildcard_for_local(self):
        assert get_cors_allowed_origins("local") == "*"

    def test_returns_wildcard_for_prod(self):
        # Current implementation returns "*" for all envs (noted as TODO in source)
        assert get_cors_allowed_origins("prod") == "*"

    def test_returns_wildcard_for_none(self):
        assert get_cors_allowed_origins(None) == "*"


# ---------------------------------------------------------------------------
# build_chat_history_string()
# ---------------------------------------------------------------------------


class TestBuildChatHistoryString:
    def test_user_messages_show_utilisateur(self, message_factory, party_factory):
        messages = [message_factory(role=Role.USER, content="Bonjour")]
        parties = [party_factory(party_id="lfi", name="LFI")]
        result = build_chat_history_string(messages, parties)
        assert 'Utilisateur: "Bonjour"' in result

    def test_assistant_message_with_matching_party_shows_party_name(
        self, message_factory, party_factory
    ):
        messages = [
            message_factory(role=Role.ASSISTANT, content="Réponse LFI", party_id="lfi")
        ]
        parties = [party_factory(party_id="lfi", name="LFI")]
        result = build_chat_history_string(messages, parties)
        assert 'LFI: "Réponse LFI"' in result

    def test_assistant_message_without_matching_party_shows_default_name(
        self, message_factory, party_factory
    ):
        messages = [
            message_factory(
                role=Role.ASSISTANT,
                content="Réponse générique",
                party_id="unknown-party",
            )
        ]
        parties = [party_factory(party_id="lfi", name="LFI")]
        result = build_chat_history_string(
            messages, parties, default_assistant_name="Assistant"
        )
        assert 'Assistant: "Réponse générique"' in result

    def test_assistant_message_no_party_id_shows_default_name(self, message_factory):
        messages = [
            message_factory(role=Role.ASSISTANT, content="Réponse", party_id=None)
        ]
        result = build_chat_history_string(
            messages, [], default_assistant_name="ChatVote"
        )
        assert 'ChatVote: "Réponse"' in result

    def test_empty_chat_history_returns_empty_string(self, party_factory):
        result = build_chat_history_string([], [party_factory()])
        assert result == ""

    def test_messages_are_numbered_starting_from_one(
        self, message_factory, party_factory
    ):
        messages = [
            message_factory(role=Role.USER, content="Q1"),
            message_factory(role=Role.ASSISTANT, content="A1", party_id="lfi"),
            message_factory(role=Role.USER, content="Q2"),
        ]
        parties = [party_factory(party_id="lfi", name="LFI")]
        result = build_chat_history_string(messages, parties)
        assert result.startswith("1.")
        assert "2." in result
        assert "3." in result

    def test_default_assistant_name_is_chatvote(self, message_factory):
        """Default assistant name comes from CHATVOTE_ASSISTANT.name."""
        messages = [
            message_factory(role=Role.ASSISTANT, content="Hello", party_id=None)
        ]
        result = build_chat_history_string(messages, [])
        assert CHATVOTE_ASSISTANT.name in result


# ---------------------------------------------------------------------------
# build_document_string_for_context()
# ---------------------------------------------------------------------------


class TestBuildDocumentStringForContext:
    def _make_doc(self, content="Contenu du doc", **metadata) -> Document:
        return Document(page_content=content, metadata=metadata)

    def test_correct_formatting_with_full_metadata(self):
        doc = self._make_doc(
            content="Texte important",
            document_name="Manifeste LFI",
            document_publish_date="2024-01-15",
        )
        result = build_document_string_for_context(1, doc)
        assert "ID: 1" in result
        assert "Manifeste LFI" in result
        assert "2024-01-15" in result
        assert '"Texte important"' in result

    def test_missing_document_name_shows_inconnu(self):
        doc = self._make_doc(document_publish_date="2024-01-15")
        result = build_document_string_for_context(2, doc)
        assert "inconnu" in result

    def test_missing_publish_date_shows_inconnue(self):
        doc = self._make_doc(document_name="Manifeste")
        result = build_document_string_for_context(3, doc)
        assert "inconnue" in result

    def test_custom_doc_num_label(self):
        doc = self._make_doc(document_name="Doc", document_publish_date="2024-01-01")
        result = build_document_string_for_context(5, doc, doc_num_label="Source")
        assert "Source: 5" in result
        assert "ID:" not in result


# ---------------------------------------------------------------------------
# build_party_str()
# ---------------------------------------------------------------------------


class TestBuildPartyStr:
    def test_correct_formatting_with_all_fields(self, party_factory):
        party = party_factory(
            party_id="lfi",
            name="LFI",
            long_name="La France Insoumise",
            description="Parti de gauche",
            candidate="Jean-Luc Mélenchon",
            is_already_in_parliament=True,
        )
        result = build_party_str(party)
        assert "ID: lfi" in result
        assert "LFI" in result
        assert "La France Insoumise" in result
        assert "Parti de gauche" in result
        assert "Jean-Luc Mélenchon" in result
        assert "True" in result


# ---------------------------------------------------------------------------
# build_message_from_perplexity_response()
# ---------------------------------------------------------------------------


class TestBuildMessageFromPerplexityResponse:
    def _make_response(self, content: str, citations: list[str]):
        """Build a minimal ChatCompletion mock."""
        response = MagicMock()
        response.citations = citations
        response.choices = [MagicMock()]
        response.choices[0].message.content = content
        return response

    def test_constructs_message_with_sources_from_citations(self):
        response = self._make_response(
            content="Réponse [1]",
            citations=["https://source1.fr", "https://source2.fr"],
        )
        msg = build_message_from_perplexity_response(response)
        assert msg.role == Role.ASSISTANT
        assert len(msg.sources) == 2
        assert msg.sources[0] == {"source": "https://source1.fr"}
        assert msg.sources[1] == {"source": "https://source2.fr"}

    def test_source_indices_decremented_by_one(self):
        """Perplexity returns 1-indexed refs; function converts to 0-indexed."""
        response = self._make_response(
            content="Voir [1] et [2, 3].",
            citations=["https://a.fr", "https://b.fr", "https://c.fr"],
        )
        msg = build_message_from_perplexity_response(response)
        assert "[0]" in msg.content
        assert "[1, 2]" in msg.content

    def test_empty_citations_list_produces_no_sources(self):
        response = self._make_response(content="Pas de sources.", citations=[])
        msg = build_message_from_perplexity_response(response)
        assert msg.sources == []

    def test_returns_message_instance(self):
        response = self._make_response(content="Test", citations=[])
        msg = build_message_from_perplexity_response(response)
        assert isinstance(msg, Message)


# ---------------------------------------------------------------------------
# sanitize_references()
# ---------------------------------------------------------------------------


class TestSanitizeReferences:
    def test_removes_non_numeric_chars_from_id_reference(self):
        result = sanitize_references("Voir [id1] pour les détails.")
        assert "[1]" in result

    def test_handles_angle_bracket_patterns(self):
        result = sanitize_references("Ref [<2>] ici.")
        assert "[2]" in result

    def test_handles_multiple_refs_in_one_bracket(self):
        result = sanitize_references("Sources [id2, id3].")
        assert "[2, 3]" in result

    def test_normal_numeric_refs_untouched(self):
        result = sanitize_references("Voir [1] et [2].")
        assert "[1]" in result
        assert "[2]" in result

    def test_text_without_refs_untouched(self):
        original = "Pas de références dans ce texte."
        assert sanitize_references(original) == original

    def test_full_example_from_docstring(self):
        """Matches the __main__ block example in utils.py."""
        text = (
            "Salaire minimum de 15 euros. [id1]\n"
            "Participation renforcée. [<2>]\n"
            "Protection contre abus. [id2, id3]\n"
        )
        result = sanitize_references(text)
        assert "[1]" in result
        assert "[2]" in result
        assert "[2, 3]" in result


# ---------------------------------------------------------------------------
# get_chat_history_hash_key()
# ---------------------------------------------------------------------------


class TestGetChatHistoryHashKey:
    def test_returns_consistent_hash_for_same_input(self):
        key1 = get_chat_history_hash_key("some conversation")
        key2 = get_chat_history_hash_key("some conversation")
        assert key1 == key2

    def test_different_inputs_produce_different_hashes(self):
        key1 = get_chat_history_hash_key("conversation A")
        key2 = get_chat_history_hash_key("conversation B")
        assert key1 != key2

    def test_returns_string_hex_digest(self):
        key = get_chat_history_hash_key("test input")
        assert isinstance(key, str)
        # xxh64 hex digest is 16 hex characters
        assert len(key) == 16
        assert all(c in "0123456789abcdef" for c in key)

    def test_empty_string_produces_valid_hash(self):
        key = get_chat_history_hash_key("")
        assert isinstance(key, str)
        assert len(key) == 16
