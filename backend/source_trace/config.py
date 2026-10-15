"""Environment-driven settings.

Secrets are read only from the server environment and are never written to a log, an error
message or an API response. ``ANTHROPIC_API_KEY`` is the one secret and is consulted only when
``SOURCE_TRACE_AI_PROVIDER=anthropic``.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Final
from urllib.parse import urlsplit

BACKEND_DIR: Final = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH: Final = BACKEND_DIR / "data" / "source_trace.sqlite3"
DEFAULT_CORS_ORIGINS: Final = ("http://localhost:5174", "http://localhost:4175")
LOOPBACK_HOSTS: Final = frozenset({"localhost", "127.0.0.1", "::1"})
_WILDCARD_BINDS: Final = frozenset({"", "0.0.0.0", "::", "*"})  # noqa: S104
_HOSTNAME_RE: Final = re.compile(r"[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?")
AI_PROVIDERS: Final = ("", "anthropic", "fake")
ANTHROPIC_HOST: Final = "api.anthropic.com"


class ConfigError(ValueError):
    """A setting has an unusable value."""


def _parse_int(name: str, raw: str, *, lo: int, hi: int) -> int:
    try:
        n = int(raw.strip())
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc
    if not lo <= n <= hi:
        raise ConfigError(f"{name} must be between {lo} and {hi}, got {n}")
    return n


def _parse_origins(raw: str) -> tuple[str, ...]:
    out: list[str] = []
    for item in raw.split(","):
        origin = item.strip()
        if not origin:
            continue
        if origin == "*":
            raise ConfigError("SOURCE_TRACE_CORS_ORIGINS must list explicit origins, not '*'")
        parts = urlsplit(origin)
        if (
            parts.scheme not in ("http", "https")
            or not parts.netloc
            or parts.path not in ("", "/")
            or parts.query
            or parts.fragment
        ):
            raise ConfigError(f"CORS origin must look like http(s)://host[:port], got {origin!r}")
        out.append(origin.rstrip("/"))
    return tuple(out)


def _parse_hosts(raw: str) -> tuple[str, ...]:
    out: list[str] = []
    for item in raw.split(","):
        host = item.strip().lower()
        if not host:
            continue
        if host == "*" or (host not in LOOPBACK_HOSTS and _HOSTNAME_RE.fullmatch(host) is None):
            raise ConfigError(
                f"SOURCE_TRACE_ALLOWED_HOSTS entries are bare host names, got {item!r}"
            )
        if host not in out:
            out.append(host)
    return tuple(out)


def normalize_ai_base_url(value: str) -> str:
    """The Anthropic API origin, or a loopback origin (tests point it at a local fake)."""
    parts = urlsplit(value.strip())
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        raise ConfigError(f"SOURCE_TRACE_AI_BASE_URL must be an http(s) origin, got {value!r}")
    if (
        parts.username
        or parts.password
        or parts.query
        or parts.fragment
        or parts.path not in ("", "/")
    ):
        raise ConfigError("SOURCE_TRACE_AI_BASE_URL must be a bare origin")
    if host in LOOPBACK_HOSTS:
        return f"{parts.scheme}://{parts.netloc.lower()}"
    if parts.scheme != "https" or host != ANTHROPIC_HOST:
        raise ConfigError(
            f"SOURCE_TRACE_AI_BASE_URL {value!r} refused: only https://{ANTHROPIC_HOST} "
            "or a loopback origin is allowed"
        )
    return f"https://{host}"


@dataclass(frozen=True)
class Settings:
    db_path: Path = DEFAULT_DB_PATH
    host: str = "127.0.0.1"
    port: int = 8797
    cors_origins: tuple[str, ...] = DEFAULT_CORS_ORIGINS
    allowed_hosts: tuple[str, ...] = ()
    max_body_bytes: int = 6_000_000
    request_timeout_s: float = 30.0
    pdf_max_bytes: int = 5_000_000
    pdf_max_pages: int = 50
    pdf_timeout_s: float = 10.0
    ai_provider: str = ""
    ai_model: str = ""
    ai_base_url: str = f"https://{ANTHROPIC_HOST}"
    ai_api_key: str = ""
    ai_calls_per_hour: int = 20
    ai_max_source_chars: int = 60_000
    ai_log_path: Path | None = None

    def __post_init__(self) -> None:
        if self.ai_provider not in AI_PROVIDERS:
            raise ConfigError(f"SOURCE_TRACE_AI_PROVIDER must be one of {AI_PROVIDERS}")
        normalize_ai_base_url(self.ai_base_url)

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if environ is None else environ
        kw: dict[str, Any] = {}
        if env.get("SOURCE_TRACE_DB_PATH"):
            kw["db_path"] = Path(env["SOURCE_TRACE_DB_PATH"]).expanduser().resolve()
        if env.get("SOURCE_TRACE_HOST"):
            kw["host"] = env["SOURCE_TRACE_HOST"].strip()
        if env.get("SOURCE_TRACE_PORT"):
            kw["port"] = _parse_int("SOURCE_TRACE_PORT", env["SOURCE_TRACE_PORT"], lo=1, hi=65535)
        if "SOURCE_TRACE_CORS_ORIGINS" in env:
            kw["cors_origins"] = _parse_origins(env["SOURCE_TRACE_CORS_ORIGINS"])
        if env.get("SOURCE_TRACE_ALLOWED_HOSTS"):
            kw["allowed_hosts"] = _parse_hosts(env["SOURCE_TRACE_ALLOWED_HOSTS"])
        provider = env.get("SOURCE_TRACE_AI_PROVIDER", "").strip().lower()
        kw["ai_provider"] = provider
        if env.get("SOURCE_TRACE_AI_MODEL"):
            kw["ai_model"] = env["SOURCE_TRACE_AI_MODEL"].strip()
        if env.get("SOURCE_TRACE_AI_BASE_URL"):
            kw["ai_base_url"] = normalize_ai_base_url(env["SOURCE_TRACE_AI_BASE_URL"])
        if provider == "anthropic":
            kw["ai_api_key"] = env.get("ANTHROPIC_API_KEY", "").strip()
        if env.get("SOURCE_TRACE_AI_CALLS_PER_HOUR"):
            kw["ai_calls_per_hour"] = _parse_int(
                "SOURCE_TRACE_AI_CALLS_PER_HOUR",
                env["SOURCE_TRACE_AI_CALLS_PER_HOUR"],
                lo=1,
                hi=10_000,
            )
        if env.get("SOURCE_TRACE_AI_LOG_PATH"):
            kw["ai_log_path"] = Path(env["SOURCE_TRACE_AI_LOG_PATH"]).expanduser().resolve()
        return cls(**kw)

    def with_overrides(self, **changes: Any) -> Settings:
        return replace(self, **changes)

    def served_hosts(self) -> frozenset[str]:
        hosts = set(LOOPBACK_HOSTS) | set(self.allowed_hosts)
        bind = self.host.strip().lower().strip("[]")
        if bind not in _WILDCARD_BINDS:
            hosts.add(bind)
        return frozenset(hosts)

    @property
    def ai_enabled(self) -> bool:
        """Configured, not opted in: every request still needs the per-session opt-in header."""
        if self.ai_provider == "fake":
            return True
        return self.ai_provider == "anthropic" and bool(self.ai_api_key) and bool(self.ai_model)
