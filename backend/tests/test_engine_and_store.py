from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

from source_trace.config import ConfigError, Settings
from source_trace.engine.locator import Locator, build_locator, content_hash, verify_locator
from source_trace.engine.state import can_transition
from source_trace.engine.text import normalize_text, text_problems
from source_trace.store import Store, migrate

ROOT = Path(__file__).resolve().parents[2]


def test_golden_vectors_agree() -> None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "contracts" / "tools" / "check_vectors.py")],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_code_point_offsets_not_utf16() -> None:
    text = "a\U0001f600b"
    built = build_locator(text, 1, 3)
    assert isinstance(built, Locator)
    assert built.text == "\U0001f600b"
    assert build_locator(text, 0, 4) == "LOC_RANGE"  # 4 UTF-16 units, but only 3 code points


def test_crlf_and_hash() -> None:
    assert normalize_text("a\r\nb\rc") == "a\nb\nc"
    assert content_hash("a\r\nb") == content_hash("a\nb")
    assert text_problems("") == ["TEXT_EMPTY"]


def test_locator_tamper() -> None:
    src = "Alpha beta gamma"
    loc = build_locator(src, 6, 10)
    assert isinstance(loc, Locator)
    assert verify_locator(src, loc) == "OK"
    assert verify_locator("Alpha BETA gamma", loc) == "LOC_TEXT_MISMATCH"


def test_transition_table_is_closed() -> None:
    assert can_transition("needs_review", "approved")
    assert not can_transition("draft", "approved")
    assert not can_transition("approved", "approved")
    assert not can_transition("nope", "draft")


def test_migrations_are_idempotent_and_versioned(tmp_path: Path) -> None:
    db = tmp_path / "m.sqlite3"
    assert migrate(db) == 1
    assert migrate(db) == 1
    import sqlite3

    conn = sqlite3.connect(db)
    conn.execute("PRAGMA user_version = 99")
    conn.commit()
    conn.close()
    with pytest.raises(RuntimeError):
        migrate(db)


def test_store_saves_log(tmp_path: Path) -> None:
    db = tmp_path / "s.sqlite3"
    migrate(db)
    store = Store(db, lambda: "2026-10-15T12:00:00.000Z")
    ws = {"name": "n", "sources": [], "claims": []}
    assert store.save("a", ws, None)["revision"] == 1
    assert store.save("a", ws, 1)["revision"] == 2
    assert [s["revision"] for s in store.saves("a")] == [1, 2]
    assert store.saves("a")[0]["claims"] == 0


def test_settings_validation() -> None:
    with pytest.raises(ConfigError):
        Settings.from_env({"SOURCE_TRACE_CORS_ORIGINS": "*"})
    with pytest.raises(ConfigError):
        Settings.from_env({"SOURCE_TRACE_ALLOWED_HOSTS": "http://x"})
    with pytest.raises(ConfigError):
        Settings.from_env({"SOURCE_TRACE_PORT": "99999"})
    with pytest.raises(ConfigError):
        Settings.from_env({"SOURCE_TRACE_AI_PROVIDER": "openai"})
    s = Settings.from_env({"SOURCE_TRACE_AI_PROVIDER": "anthropic", "ANTHROPIC_API_KEY": "k"})
    assert s.ai_enabled is False  # a key alone, without a model, never enables it
    # the key is only read for the anthropic provider
    assert Settings.from_env({"ANTHROPIC_API_KEY": "k"}).ai_api_key == ""
