"""Tests for source dict building logic extracted from websocket_app.py.

The source dict construction is inline in the handler, so these tests exercise
a local helper that mirrors the exact same logic.
"""

from langchain_core.documents import Document


# ---------------------------------------------------------------------------
# Helpers that mirror the inline logic in websocket_app.py (~lines 970-1020)
# ---------------------------------------------------------------------------

_CONTENT_PREVIEW_MAX = 80


def _build_candidate_source(doc: Document) -> dict:
    """Mirror the candidate source-dict block from websocket_app.py."""
    page_raw = doc.metadata.get("page", 0)
    page_number = int(page_raw if page_raw is not None else 0) + 1

    content_preview = doc.page_content[:_CONTENT_PREVIEW_MAX].replace("\n", " ").strip()
    if len(doc.page_content) > _CONTENT_PREVIEW_MAX:
        content_preview += "..."

    return {
        "source": doc.metadata.get("document_name", "Site candidat"),
        "page": page_number,
        "content_preview": content_preview,
        "url": doc.metadata.get("url"),
        "source_type": "candidate",
        "candidate_id": doc.metadata.get("namespace"),
        "candidate_name": doc.metadata.get("candidate_name"),
        "municipality_name": doc.metadata.get("municipality_name"),
        "municipality_code": doc.metadata.get("municipality_code"),
        "fiabilite": doc.metadata.get("fiabilite"),
        "theme": doc.metadata.get("theme"),
        "sub_theme": doc.metadata.get("sub_theme"),
    }


def _build_manifesto_source(doc: Document) -> dict:
    """Mirror the manifesto source-dict block from websocket_app.py."""
    page_raw = doc.metadata.get("page", 0)
    page_number = int(page_raw if page_raw is not None else 0) + 1

    content_preview = doc.page_content[:_CONTENT_PREVIEW_MAX].replace("\n", " ").strip()
    if len(doc.page_content) > _CONTENT_PREVIEW_MAX:
        content_preview += "..."

    return {
        "source": doc.metadata.get("document_name", "Programme"),
        "page": page_number,
        "content_preview": content_preview,
        "url": doc.metadata.get("url"),
        "source_type": "manifesto",
        "party_id": doc.metadata.get("namespace"),
        "fiabilite": doc.metadata.get("fiabilite"),
        "theme": doc.metadata.get("theme"),
        "sub_theme": doc.metadata.get("sub_theme"),
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestCandidateSourceDict:
    def test_candidate_source_dict_has_candidate_id(self):
        doc = Document(
            page_content="Some candidate content",
            metadata={
                "namespace": "cand-75056-1",
                "candidate_name": "Test",
                "municipality_code": "75056",
                "url": "https://example.com",
            },
        )
        result = _build_candidate_source(doc)

        assert result["candidate_id"] == "cand-75056-1"
        assert result["source_type"] == "candidate"
        assert result["municipality_code"] == "75056"

    def test_candidate_source_dict_handles_missing_metadata(self):
        doc = Document(
            page_content="Minimal content",
            metadata={"namespace": "cand-75056-2"},
        )
        result = _build_candidate_source(doc)

        assert result["candidate_id"] == "cand-75056-2"
        assert result["candidate_name"] is None
        assert result["municipality_name"] is None
        assert result["municipality_code"] is None
        assert result["url"] is None

    def test_candidate_source_page_offset_by_one(self):
        """page metadata is 0-indexed; result page should be 1-indexed."""
        doc = Document(
            page_content="Content",
            metadata={"namespace": "cand-75056-1", "page": 4},
        )
        result = _build_candidate_source(doc)
        assert result["page"] == 5

    def test_candidate_source_default_document_name(self):
        doc = Document(
            page_content="Content",
            metadata={"namespace": "cand-75056-1"},
        )
        result = _build_candidate_source(doc)
        assert result["source"] == "Site candidat"

    def test_candidate_source_custom_document_name(self):
        doc = Document(
            page_content="Content",
            metadata={"namespace": "cand-75056-1", "document_name": "Programme local"},
        )
        result = _build_candidate_source(doc)
        assert result["source"] == "Programme local"


class TestManifestoSourceDict:
    def test_manifesto_source_dict_has_party_fields(self):
        doc = Document(
            page_content="Party manifesto content",
            metadata={
                "namespace": "lfi",
                "document_name": "Programme 2027",
                "url": "https://lfi.fr/programme.pdf",
                "page": 0,
            },
        )
        result = _build_manifesto_source(doc)

        assert result["source_type"] == "manifesto"
        assert result["party_id"] == "lfi"
        assert "candidate_id" not in result

    def test_manifesto_source_default_document_name(self):
        doc = Document(
            page_content="Content",
            metadata={"namespace": "ps"},
        )
        result = _build_manifesto_source(doc)
        assert result["source"] == "Programme"

    def test_manifesto_source_page_offset(self):
        doc = Document(
            page_content="Content",
            metadata={"namespace": "ps", "page": 9},
        )
        result = _build_manifesto_source(doc)
        assert result["page"] == 10


class TestContentPreviewTruncation:
    def test_short_content_not_truncated(self):
        short = "Short text"
        doc = Document(page_content=short, metadata={"namespace": "ns"})
        result = _build_candidate_source(doc)
        assert result["content_preview"] == short
        assert not result["content_preview"].endswith("...")

    def test_content_longer_than_80_chars_truncated(self):
        long_content = "A" * 201
        doc = Document(page_content=long_content, metadata={"namespace": "ns"})
        result = _build_candidate_source(doc)
        assert result["content_preview"].endswith("...")
        # Preview body is 80 chars + "..."
        assert len(result["content_preview"]) == 83

    def test_content_exactly_80_chars_not_truncated(self):
        exact = "B" * 80
        doc = Document(page_content=exact, metadata={"namespace": "ns"})
        result = _build_candidate_source(doc)
        assert not result["content_preview"].endswith("...")

    def test_content_newlines_replaced_with_spaces(self):
        doc = Document(
            page_content="line1\nline2\nline3",
            metadata={"namespace": "ns"},
        )
        result = _build_candidate_source(doc)
        assert "\n" not in result["content_preview"]
        assert "line1 line2 line3" == result["content_preview"]

    def test_manifesto_preview_also_truncated(self):
        long_content = "C" * 150
        doc = Document(page_content=long_content, metadata={"namespace": "rn"})
        result = _build_manifesto_source(doc)
        assert result["content_preview"].endswith("...")
