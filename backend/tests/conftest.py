from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from source_trace.api.app import create_app
from source_trace.config import Settings

FIXED = "2026-10-15T12:00:00.000Z"
ORIGIN = "http://localhost:4175"


def make_settings(tmp_path: Path, **overrides: object) -> Settings:
    base = Settings(
        db_path=tmp_path / "t.sqlite3",
        cors_origins=(ORIGIN,),
        ai_log_path=tmp_path / "ai.log",
    )
    return base.with_overrides(**overrides) if overrides else base


def make_client(app: object) -> TestClient:
    """The guard is on in tests too: speak to it as a browser on loopback would."""
    return TestClient(app, base_url="http://localhost")  # type: ignore[arg-type]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with make_client(create_app(settings, clock=lambda: FIXED)) as c:
        yield c
