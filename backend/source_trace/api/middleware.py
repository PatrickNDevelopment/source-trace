"""Pure-ASGI guards: Host allow-list, Origin check on writes, body-size cap, total deadline.

They are ASGI middleware (not ``BaseHTTPMiddleware``) so the body cap counts bytes while they
stream and the deadline can answer before a slow handler finishes. Every refusal uses the single
error envelope.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, MutableMapping
from typing import Any
from urllib.parse import urlsplit

from ..errors import envelope

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def respond(
    send: Send, status: int, code: str, message: str, headers: dict[str, str] | None = None
) -> None:
    body = json.dumps(envelope(code, message)).encode("utf-8")
    raw = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    for key, value in (headers or {}).items():
        raw.append((key.lower().encode("latin-1"), value.encode("latin-1")))
    await send({"type": "http.response.start", "status": status, "headers": raw})
    await send({"type": "http.response.body", "body": body})


def header(scope: Scope, name: str) -> str | None:
    wanted = name.lower().encode("latin-1")
    for key, value in scope.get("headers", []):
        if key == wanted:
            return str(value.decode("latin-1"))
    return None


def host_name(raw: str) -> str | None:
    if "@" in raw:
        return None  # a Host header never carries user info; urlsplit would hide the real host
    try:
        return urlsplit("//" + raw.strip()).hostname
    except ValueError:
        return None


class HostGuard:
    """DNS-rebinding guard: only loopback, the bind address and configured hosts are served."""

    def __init__(self, app: ASGIApp, served_hosts: frozenset[str]) -> None:
        self.app = app
        self.served = served_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            raw = header(scope, "host")
            if raw is not None and host_name(raw) not in self.served:
                await respond(
                    send,
                    400,
                    "host_not_allowed",
                    f"Host {raw!r} is not served by this backend (loopback and configured hosts).",
                )
                return
        await self.app(scope, receive, send)


class OriginGuard:
    """A page on another origin cannot change data, even with a "simple" request."""

    def __init__(self, app: ASGIApp, allowed: frozenset[str]) -> None:
        self.app = app
        self.allowed = allowed

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in SAFE_METHODS:
            origin = header(scope, "origin")
            if origin is not None and origin.rstrip("/") not in self.allowed:
                await respond(
                    send,
                    403,
                    "origin_not_allowed",
                    f"Origin {origin!r} is not in SOURCE_TRACE_CORS_ORIGINS.",
                )
                return
        await self.app(scope, receive, send)


class BodyLimit:
    """Rejects bodies over ``max_bytes``: by Content-Length up front and while streaming.

    When a streamed body crosses the cap, the 413 is sent from here at once and the application
    is told the client disconnected; whatever it tries to send afterwards is dropped. (Raising an
    exception through the application would be turned into a 400 by FastAPI's body parsing.)
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        declared = header(scope, "content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max:
            await respond(send, 413, "payload_too_large", f"The body exceeds {self.max} bytes.")
            return
        seen = 0
        started = False
        refused = False

        async def counting_receive() -> Message:
            nonlocal seen, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max:
                    refused = True
                    if not started:
                        await respond(
                            send, 413, "payload_too_large", f"The body exceeds {self.max} bytes."
                        )
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            if refused:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counting_receive, guarded_send)
        except Exception:
            if not refused:
                raise


class Deadline:
    """A total wall-clock deadline per request (504 ``request_timeout``)."""

    def __init__(self, app: ASGIApp, seconds: float) -> None:
        self.app = app
        self.seconds = seconds

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await asyncio.wait_for(self.app(scope, receive, tracking_send), self.seconds)
        except TimeoutError:
            if not started:
                await respond(
                    send,
                    504,
                    "request_timeout",
                    f"The request took longer than {self.seconds:g} seconds and was stopped.",
                )
