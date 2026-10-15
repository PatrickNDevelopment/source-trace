from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from source_trace.ai import AiService, RateLimiter, parse_provider_text
from source_trace.api.app import create_app
from source_trace.config import ConfigError, Settings, normalize_ai_base_url
from source_trace.errors import AppError

from .conftest import FIXED, make_client, make_settings

OPT = {"X-SourceTrace-AI-Opt-In": "session"}
BODY = {
    "task": "suggest_claims",
    "sources": [{"id": "s_1", "title": "T", "text": "The dam failed in 1975. Floods followed."}],
}


@pytest.fixture
def fake(tmp_path: Path) -> Iterator[TestClient]:
    s = make_settings(tmp_path, ai_provider="fake")
    with make_client(create_app(s, clock=lambda: FIXED)) as c:
        yield c


def test_disabled_by_default(client: TestClient) -> None:
    r = client.post("/api/ai/suggest", json=BODY, headers=OPT)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "ai_disabled"


def test_requires_per_session_opt_in(fake: TestClient) -> None:
    r = fake.post("/api/ai/suggest", json=BODY)
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "ai_opt_in_required"
    r = fake.post("/api/ai/suggest", json=BODY, headers={"X-SourceTrace-AI-Opt-In": "always"})
    assert r.status_code == 403


def test_suggestions_reference_only_existing_sources_and_exact_passages(fake: TestClient) -> None:
    r = fake.post("/api/ai/suggest", json=BODY, headers=OPT)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["meta"]["provider"] == "fake"
    assert out["meta"]["promptVersion"] == "st-suggest-1"
    assert out["meta"]["rejected"] == 0
    (s,) = out["suggestions"]
    assert s["sourceId"] == "s_1"
    text = BODY["sources"][0]["text"]
    assert text[s["start"] : s["end"]] == s["text"] == "The dam failed in 1975."
    assert set(out) == {"suggestions", "meta"}
    assert "status" not in s and "approved" not in json.dumps(out)


def test_invented_source_ids_and_bad_locators_are_dropped(fake: TestClient) -> None:
    body = {
        "task": "suggest_claims",
        "sources": [{"id": "s_1", "title": "", "text": "Alpha beta. [[FAKE:INVENT]] More."}],
    }
    out = fake.post("/api/ai/suggest", json=body, headers=OPT).json()
    assert [x["sourceId"] for x in out["suggestions"]] == ["s_1"]
    assert out["meta"]["rejected"] == 1
    bad = {
        "task": "suggest_claims",
        "sources": [{"id": "s_1", "title": "", "text": "Alpha beta. [[FAKE:BADLOC]]"}],
    }
    out = fake.post("/api/ai/suggest", json=bad, headers=OPT).json()
    assert out["suggestions"] == []
    assert out["meta"]["rejected"] == 1


def test_a_response_that_tries_to_set_status_is_rejected_whole(fake: TestClient) -> None:
    body = {
        "task": "suggest_claims",
        "sources": [{"id": "s_1", "title": "", "text": "Alpha beta. [[FAKE:APPROVE]]"}],
    }
    r = fake.post("/api/ai/suggest", json=body, headers=OPT)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "ai_invalid_output"


def test_prose_and_provider_failure(fake: TestClient) -> None:
    prose = {
        "task": "suggest_claims",
        "sources": [{"id": "s_1", "title": "", "text": "x [[FAKE:PROSE]]"}],
    }
    assert (
        fake.post("/api/ai/suggest", json=prose, headers=OPT).json()["error"]["code"]
        == "ai_invalid_output"
    )
    boom = {
        "task": "suggest_claims",
        "sources": [{"id": "s_1", "title": "", "text": "x [[FAKE:ERROR]]"}],
    }
    r = fake.post("/api/ai/suggest", json=boom, headers=OPT)
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "ai_provider_error"


def test_input_limits(fake: TestClient) -> None:
    too_many = {
        "task": "suggest_claims",
        "sources": [{"id": f"s_{i}", "title": "", "text": "a b"} for i in range(1, 7)],
    }
    assert fake.post("/api/ai/suggest", json=too_many, headers=OPT).status_code == 422
    huge = {"task": "suggest_claims", "sources": [{"id": "s_1", "title": "", "text": "a" * 70_000}]}
    assert fake.post("/api/ai/suggest", json=huge, headers=OPT).status_code == 413
    assert (
        fake.post(
            "/api/ai/suggest", json={"task": "approve_all", "sources": []}, headers=OPT
        ).status_code
        == 422
    )


def test_rate_limit_and_usage_log_without_secrets_or_text(tmp_path: Path) -> None:
    s = make_settings(tmp_path, ai_provider="fake", ai_calls_per_hour=2)
    with make_client(create_app(s, clock=lambda: FIXED)) as c:
        assert c.post("/api/ai/suggest", json=BODY, headers=OPT).status_code == 200
        assert c.post("/api/ai/suggest", json=BODY, headers=OPT).status_code == 200
        r = c.post("/api/ai/suggest", json=BODY, headers=OPT)
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "ai_rate_limited"
    lines = (tmp_path / "ai.log").read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    rec = json.loads(lines[0])
    assert rec["promptVersion"] == "st-suggest-1" and rec["sourceIds"] == ["s_1"]
    assert "dam failed" not in lines[0]
    assert len(rec["promptSha256"]) == 64


def test_rate_limiter_window() -> None:
    now = [0.0]
    lim = RateLimiter(2, clock=lambda: now[0])
    lim.check()
    lim.check()
    with pytest.raises(AppError):
        lim.check()
    now[0] = 3601.0
    lim.check()


class TestAnthropicAdapter:
    def settings(self, tmp_path: Path) -> Settings:
        return make_settings(
            tmp_path, ai_provider="anthropic", ai_model="test-model", ai_api_key="sk-test-not-real"
        )

    def test_request_shape_and_secret_stays_in_the_header(self, tmp_path: Path) -> None:
        seen: dict[str, Any] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["headers"] = dict(request.headers)
            seen["body"] = json.loads(request.content)
            text = json.dumps(
                {
                    "suggestions": [
                        {
                            "claimText": "The dam failed in 1975.",
                            "kind": "factual",
                            "sourceId": "s_1",
                            "start": 0,
                            "end": 23,
                            "text": "The dam failed in 1975.",
                            "label": "support",
                            "rationale": "first sentence",
                        }
                    ]
                }
            )
            return httpx.Response(200, json={"content": [{"type": "text", "text": text}]})

        s = self.settings(tmp_path)
        app = create_app(s, clock=lambda: FIXED, ai_transport=httpx.MockTransport(handler))
        with make_client(app) as c:
            caps = c.get("/api/capabilities").json()
            assert caps["ai"]["enabled"] is True
            assert caps["ai"]["provider"] == "anthropic"
            assert "sk-test" not in json.dumps(caps)
            r = c.post("/api/ai/suggest", json=BODY, headers=OPT)
            assert r.status_code == 200, r.text
            assert "sk-test" not in r.text
        assert seen["url"] == "https://api.anthropic.com/v1/messages"
        assert seen["headers"]["x-api-key"] == "sk-test-not-real"
        assert seen["headers"]["anthropic-version"] == "2023-06-01"
        assert seen["body"]["model"] == "test-model"
        assert "untrusted data" in seen["body"]["system"]
        assert "sk-test" not in (tmp_path / "ai.log").read_text(encoding="utf-8")

    def test_http_error_becomes_provider_error(self, tmp_path: Path) -> None:
        transport = httpx.MockTransport(lambda r: httpx.Response(529, json={"error": "overloaded"}))
        app = create_app(self.settings(tmp_path), ai_transport=transport)
        with make_client(app) as c:
            r = c.post("/api/ai/suggest", json=BODY, headers=OPT)
            assert r.status_code == 502
            assert r.json()["error"]["code"] == "ai_provider_error"

    def test_not_enabled_without_key_or_model(self, tmp_path: Path) -> None:
        s = make_settings(tmp_path, ai_provider="anthropic", ai_model="", ai_api_key="")
        assert s.ai_enabled is False
        with make_client(create_app(s)) as c:
            assert c.get("/api/capabilities").json()["ai"]["enabled"] is False


def test_parse_provider_text_accepts_one_fence_only() -> None:
    ok = '```json\n{"suggestions": []}\n```'
    assert parse_provider_text(ok).suggestions == []
    with pytest.raises(AppError):
        parse_provider_text('{"suggestions": [], "approve": true}')
    with pytest.raises(AppError):
        parse_provider_text("here you go: {}")


def test_base_url_validation() -> None:
    assert normalize_ai_base_url("https://api.anthropic.com") == "https://api.anthropic.com"
    assert normalize_ai_base_url("http://127.0.0.1:9999") == "http://127.0.0.1:9999"
    for bad in ("https://evil.example", "http://api.anthropic.com", "https://api.anthropic.com/x"):
        with pytest.raises(ConfigError):
            normalize_ai_base_url(bad)


def test_ai_service_without_provider_has_no_capability() -> None:
    s = Settings()
    svc = AiService(s, None, lambda: FIXED)
    assert svc.capabilities()["enabled"] is False
