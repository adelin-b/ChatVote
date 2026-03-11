"""Tests for DataSourceNode.execute() lifecycle, content_hash, and should_skip.

Firebase/Firestore calls are fully mocked so no live services are needed.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from src.services.data_pipeline.base import (
    DataSourceNode,
    NodeConfig,
    NodeStatus,
    content_hash,
    should_skip,
)


# ---------------------------------------------------------------------------
# Minimal concrete node for testing
# ---------------------------------------------------------------------------

class _FakeNode(DataSourceNode):
    node_id = "fake"
    label = "Fake Node"

    def __init__(self, run_side_effect=None):
        self._run_side_effect = run_side_effect
        self.run_called = False

    async def run(self, cfg: NodeConfig, *, force: bool = False) -> NodeConfig:
        self.run_called = True
        if self._run_side_effect is not None:
            raise self._run_side_effect
        cfg.counts = {"items": 1}
        return cfg


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _disabled_cfg() -> NodeConfig:
    return NodeConfig(node_id="fake", label="Fake Node", enabled=False)


def _enabled_cfg() -> NodeConfig:
    return NodeConfig(node_id="fake", label="Fake Node", enabled=True)


# ---------------------------------------------------------------------------
# execute() lifecycle tests
# ---------------------------------------------------------------------------

class TestExecuteLifecycle:
    @pytest.mark.asyncio
    async def test_execute_skips_when_disabled(self):
        node = _FakeNode()
        cfg = _disabled_cfg()

        with (
            patch("src.services.data_pipeline.base.load_config", new=AsyncMock(return_value=cfg)),
            patch("src.services.data_pipeline.base.update_status", new=AsyncMock()),
            patch("src.services.data_pipeline.base.save_config", new=AsyncMock()),
        ):
            result = await node.execute(force=False)

        assert not node.run_called
        assert result.enabled is False

    @pytest.mark.asyncio
    async def test_execute_runs_when_forced(self):
        node = _FakeNode()
        cfg = _disabled_cfg()

        with (
            patch("src.services.data_pipeline.base.load_config", new=AsyncMock(return_value=cfg)),
            patch("src.services.data_pipeline.base.update_status", new=AsyncMock()),
            patch("src.services.data_pipeline.base.save_config", new=AsyncMock()),
        ):
            result = await node.execute(force=True)

        assert node.run_called
        assert result.status == NodeStatus.SUCCESS

    @pytest.mark.asyncio
    async def test_execute_sets_success_status(self):
        node = _FakeNode()
        cfg = _enabled_cfg()

        with (
            patch("src.services.data_pipeline.base.load_config", new=AsyncMock(return_value=cfg)),
            patch("src.services.data_pipeline.base.update_status", new=AsyncMock()),
            patch("src.services.data_pipeline.base.save_config", new=AsyncMock()),
        ):
            result = await node.execute()

        assert result.status == NodeStatus.SUCCESS
        assert result.last_error is None
        assert result.last_run_at is not None

    @pytest.mark.asyncio
    async def test_execute_sets_error_status_on_exception(self):
        error = RuntimeError("something broke")
        node = _FakeNode(run_side_effect=error)
        cfg = _enabled_cfg()

        with (
            patch("src.services.data_pipeline.base.load_config", new=AsyncMock(return_value=cfg)),
            patch("src.services.data_pipeline.base.update_status", new=AsyncMock()),
            patch("src.services.data_pipeline.base.save_config", new=AsyncMock()),
        ):
            with pytest.raises(RuntimeError, match="something broke"):
                await node.execute()

        assert cfg.status == NodeStatus.ERROR
        assert cfg.last_error == "something broke"

    @pytest.mark.asyncio
    async def test_execute_records_duration(self):
        node = _FakeNode()
        cfg = _enabled_cfg()

        with (
            patch("src.services.data_pipeline.base.load_config", new=AsyncMock(return_value=cfg)),
            patch("src.services.data_pipeline.base.update_status", new=AsyncMock()),
            patch("src.services.data_pipeline.base.save_config", new=AsyncMock()),
        ):
            result = await node.execute()

        assert result.last_duration_s is not None
        assert result.last_duration_s >= 0


# ---------------------------------------------------------------------------
# content_hash
# ---------------------------------------------------------------------------

class TestContentHash:
    def test_deterministic(self):
        data = b"hello world"
        assert content_hash(data) == content_hash(data)

    def test_different_bytes_different_hash(self):
        assert content_hash(b"abc") != content_hash(b"xyz")

    def test_returns_sha256_prefix(self):
        result = content_hash(b"test")
        assert result.startswith("sha256:")

    def test_empty_bytes(self):
        result = content_hash(b"")
        assert result.startswith("sha256:")

    def test_long_data_hashed_via_sample(self):
        # Two payloads that differ only beyond sample_size=10240 bytes
        # Both have same first 10240 bytes and same total length — should collide
        # (by design of the fast fingerprint).
        base = b"A" * 10240
        same_sample_same_len_a = base + b"X" * 100
        same_sample_same_len_b = base + b"Y" * 100
        # Different suffix but same sample + same total len → same hash (expected)
        assert content_hash(same_sample_same_len_a) == content_hash(same_sample_same_len_b)

    def test_different_length_different_hash(self):
        # Same prefix, different total length → different hash
        a = b"A" * 100
        b_ = b"A" * 101
        assert content_hash(a) != content_hash(b_)


# ---------------------------------------------------------------------------
# should_skip
# ---------------------------------------------------------------------------

class TestShouldSkip:
    def test_exact_match_returns_true(self):
        assert should_skip("sha256:abc", "sha256:abc") is True

    def test_different_hashes_returns_false(self):
        assert should_skip("sha256:abc", "sha256:xyz") is False

    def test_none_stored_returns_false(self):
        assert should_skip("sha256:abc", None) is False

    def test_empty_strings_match(self):
        assert should_skip("", "") is True

    def test_case_sensitive(self):
        assert should_skip("sha256:ABC", "sha256:abc") is False
