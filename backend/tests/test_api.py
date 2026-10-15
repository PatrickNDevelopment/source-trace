from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from source_trace.api.app import create_app
from source_trace.config import Settings

from .conftest import FIXED, ORIGIN, make_client, make_settings
from .helpers import make_pdf, valid_workspace


def test_health_and_capabilities(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok", "version": "0.1.0"}
    caps = client.get("/api/capabilities").json()
    assert caps["pdf"]["maxPages"] == 50
    assert caps["ai"]["enabled"] is False
    assert caps["ai"]["provider"] is None
    assert caps["ai"]["requiresOptIn"] is True


def test_unknown_route_and_method_use_the_envelope(client: TestClient) -> None:
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
    r = client.post("/api/health")
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"


class TestWorkspaces:
    def test_roundtrip_and_revisions(self, client: TestClient) -> None:
        ws = valid_workspace()
        first = client.put("/api/workspaces/default", json={"baseRevision": None, "workspace": ws})
        assert first.status_code == 200
        assert first.json() == {"id": "default", "revision": 1, "updatedAt": FIXED}
        got = client.get("/api/workspaces/default").json()
        assert got["revision"] == 1
        assert got["workspace"] == ws
        second = client.put("/api/workspaces/default", json={"baseRevision": 1, "workspace": ws})
        assert second.json()["revision"] == 2
        listing = client.get("/api/workspaces").json()["workspaces"]
        assert listing == [
            {"id": "default", "name": "API fixture", "revision": 2, "updatedAt": FIXED}
        ]

    def test_stale_revision_is_a_conflict_and_changes_nothing(self, client: TestClient) -> None:
        ws = valid_workspace()
        client.put("/api/workspaces/w", json={"baseRevision": None, "workspace": ws})
        client.put("/api/workspaces/w", json={"baseRevision": 1, "workspace": ws})
        stale = client.put("/api/workspaces/w", json={"baseRevision": 1, "workspace": ws})
        assert stale.status_code == 409
        err = stale.json()["error"]
        assert err["code"] == "stale_revision"
        assert err["details"] == {"currentRevision": 2}
        # creating over an existing id with baseRevision null is also stale
        again = client.put("/api/workspaces/w", json={"baseRevision": None, "workspace": ws})
        assert again.status_code == 409
        assert client.get("/api/workspaces/w").json()["revision"] == 2

    def test_invalid_snapshots_are_refused_with_codes(self, client: TestClient) -> None:
        ws = valid_workspace()
        bad = copy.deepcopy(ws)
        bad["claims"][0]["evidence"][0]["label"] = "unknown"  # approved claim loses support
        r = client.put("/api/workspaces/w", json={"baseRevision": None, "workspace": bad})
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_workspace"
        assert r.json()["error"]["details"]["codes"] == ["APPROVED_FAILS_GATE"]
        assert client.get("/api/workspaces/w").status_code == 404

    def test_defence_in_depth_refuses_ai_actor_and_skipped_review(self, client: TestClient) -> None:
        ws = valid_workspace()
        ai = copy.deepcopy(ws)
        ai["claims"][0]["audit"][1]["actor"] = "ai"
        r = client.put("/api/workspaces/w", json={"baseRevision": None, "workspace": ai})
        assert r.json()["error"]["details"]["codes"] == ["AUDIT_ACTOR_INVALID"]
        skipped = copy.deepcopy(ws)
        skipped["claims"][0]["audit"][1].update({"from": "draft", "to": "approved"})
        skipped["claims"][0]["audit"].pop(2)
        for i, e in enumerate(skipped["claims"][0]["audit"]):
            e["seq"] = i + 1
        r = client.put("/api/workspaces/w", json={"baseRevision": None, "workspace": skipped})
        assert r.json()["error"]["details"]["codes"] == ["AUDIT_TRANSITION_INVALID"]

    def test_bad_ids_and_missing(self, client: TestClient) -> None:
        assert client.get("/api/workspaces/..%2Fx").status_code in (404, 422)
        r = client.get("/api/workspaces/bad id")
        assert r.status_code == 422
        assert client.get("/api/workspaces/none").status_code == 404
        assert client.delete("/api/workspaces/none").status_code == 404

    def test_delete(self, client: TestClient) -> None:
        client.put("/api/workspaces/d", json={"baseRevision": None, "workspace": valid_workspace()})
        assert client.delete("/api/workspaces/d").status_code == 204
        assert client.get("/api/workspaces/d").status_code == 404

    def test_malformed_body_uses_the_envelope(self, client: TestClient) -> None:
        r = client.put(
            "/api/workspaces/w", content=b"{nope", headers={"content-type": "application/json"}
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "invalid_request"


class TestGuards:
    def test_foreign_host_header_is_refused(self, client: TestClient) -> None:
        r = client.get("/api/health", headers={"host": "evil.example"})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "host_not_allowed"

    def test_loopback_hosts_are_served(self, client: TestClient) -> None:
        for host in ("localhost:8797", "127.0.0.1:8797", "[::1]:8797"):
            assert client.get("/api/health", headers={"host": host}).status_code == 200

    def test_foreign_origin_cannot_write(self, client: TestClient) -> None:
        r = client.put(
            "/api/workspaces/w",
            json={"baseRevision": None, "workspace": valid_workspace()},
            headers={"origin": "http://evil.example"},
        )
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "origin_not_allowed"
        assert client.get("/api/workspaces/w").status_code == 404

    def test_allowed_origin_gets_cors_headers(self, client: TestClient) -> None:
        r = client.get("/api/health", headers={"origin": ORIGIN})
        assert r.headers["access-control-allow-origin"] == ORIGIN
        r = client.get("/api/health", headers={"origin": "http://evil.example"})
        assert "access-control-allow-origin" not in r.headers

    def test_body_cap_by_content_length_and_streaming(self, tmp_path: Path) -> None:
        small = make_settings(tmp_path, max_body_bytes=1000)
        with make_client(create_app(small)) as c:
            big = b"x" * 5000
            r = c.post("/api/pdf/extract", content=big, headers={"content-type": "application/pdf"})
            assert r.status_code == 413
            assert r.json()["error"]["code"] == "payload_too_large"

            def chunks() -> Any:
                for _ in range(10):
                    yield b"y" * 500

            r = c.post(
                "/api/pdf/extract", content=chunks(), headers={"content-type": "application/pdf"}
            )
            assert r.status_code == 413

    def test_total_deadline(self, tmp_path: Path) -> None:
        import asyncio

        app = create_app(make_settings(tmp_path, request_timeout_s=0.2))

        @app.get("/api/slow")
        async def slow() -> dict[str, str]:
            await asyncio.sleep(2)
            return {"ok": "never"}

        with make_client(app) as c:
            r = c.get("/api/slow")
            assert r.status_code == 504
            assert r.json()["error"]["code"] == "request_timeout"

    def test_loopback_bind_default(self) -> None:
        assert Settings().host == "127.0.0.1"
        assert "127.0.0.1" in Settings().served_hosts()


class TestPdf:
    def post(self, client: TestClient, data: bytes, ctype: str = "application/pdf") -> Any:
        return client.post("/api/pdf/extract", content=data, headers={"content-type": ctype})

    def test_extracts_text_and_hashes_it(self, client: TestClient) -> None:
        r = self.post(client, make_pdf(["Hello source world.", "Second page (with parens)."]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["pages"] == 2
        assert "Hello source world." in body["text"]
        assert "Second page (with parens)." in body["text"]
        assert len(body["contentHash"]) == 64
        assert "\r" not in body["text"]

    def test_wrong_content_type(self, client: TestClient) -> None:
        r = self.post(client, make_pdf(["x"]), "text/plain")
        assert r.status_code == 415

    def test_not_a_pdf_and_malformed(self, client: TestClient) -> None:
        assert self.post(client, b"hello").json()["error"]["code"] == "pdf_invalid"
        broken = make_pdf(["abc"])[:200]
        r = self.post(client, broken)
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "pdf_invalid"

    def test_page_cap_and_size_cap(self, tmp_path: Path) -> None:
        s = make_settings(tmp_path, pdf_max_pages=2, pdf_max_bytes=3000)
        with make_client(create_app(s)) as c:
            r = c.post(
                "/api/pdf/extract",
                content=make_pdf(["a", "b", "c"]),
                headers={"content-type": "application/pdf"},
            )
            assert r.status_code == 422
            assert r.json()["error"]["code"] == "pdf_too_many_pages"
            r = c.post(
                "/api/pdf/extract",
                content=b"%PDF-1.4\n" + b"0" * 4000,
                headers={"content-type": "application/pdf"},
            )
            assert r.status_code == 413

    def test_no_text(self, client: TestClient) -> None:
        r = self.post(client, make_pdf([""]))
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "pdf_no_text"

    def test_script_markup_in_pdf_text_stays_text(self, client: TestClient) -> None:
        r = self.post(client, make_pdf(["<script>alert(1)</script> and javascript:alert(2)"]))
        assert r.status_code == 200
        assert "<script>alert(1)</script>" in r.json()["text"]
