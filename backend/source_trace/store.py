"""SQLite persistence for workspace snapshots, with a minimal ordered migration runner.

Only validated snapshots are stored (the caller runs ``validate_workspace``). Each save bumps the
revision; a ``saves`` row keeps an append-only record of who-saved-what-when (hash, counts), never
the content.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Final

MIGRATIONS: Final[tuple[str, ...]] = (
    # 1: workspaces and the append-only save log
    """
    CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        body TEXT NOT NULL
    );
    CREATE TABLE saves (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        saved_at TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        sources INTEGER NOT NULL,
        claims INTEGER NOT NULL
    );
    """,
)


class RevisionConflictError(Exception):
    def __init__(self, current: int | None) -> None:
        super().__init__("stale revision")
        self.current = current


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def migrate(path: Path) -> int:
    """Applies pending migrations and returns the schema version."""
    conn = connect(path)
    try:
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if version > len(MIGRATIONS):
            raise RuntimeError(
                f"database schema version {version} is newer than this program ({len(MIGRATIONS)})"
            )
        for number, script in enumerate(MIGRATIONS, start=1):
            if number <= version:
                continue
            conn.executescript("BEGIN;\n" + script + f"\nPRAGMA user_version = {number};\nCOMMIT;")
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    finally:
        conn.close()


class Store:
    def __init__(self, path: Path, now: Callable[[], str]) -> None:
        self.path = path
        self.now = now

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = connect(self.path)
        try:
            yield conn
        finally:
            conn.close()

    def list_all(self) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT id, name, revision, updated_at FROM workspaces ORDER BY id"
            ).fetchall()
        return [
            {
                "id": r["id"],
                "name": r["name"],
                "revision": r["revision"],
                "updatedAt": r["updated_at"],
            }
            for r in rows
        ]

    def get(self, workspace_id: str) -> dict[str, Any] | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
        if r is None:
            return None
        return {
            "id": r["id"],
            "revision": r["revision"],
            "updatedAt": r["updated_at"],
            "workspace": json.loads(r["body"]),
        }

    def save(
        self, workspace_id: str, workspace: dict[str, Any], base_revision: int | None
    ) -> dict[str, Any]:
        body = json.dumps(workspace, ensure_ascii=False, separators=(",", ":"))
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        saved_at = self.now()
        with self._conn() as c:
            c.execute("BEGIN IMMEDIATE")
            try:
                row = c.execute(
                    "SELECT revision FROM workspaces WHERE id = ?", (workspace_id,)
                ).fetchone()
                current = None if row is None else int(row["revision"])
                if current != base_revision:
                    raise RevisionConflictError(current)
                revision = 1 if current is None else current + 1
                c.execute(
                    "INSERT INTO workspaces (id, name, revision, updated_at, body) "
                    "VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET "
                    "name = excluded.name, revision = excluded.revision, "
                    "updated_at = excluded.updated_at, body = excluded.body",
                    (workspace_id, workspace["name"], revision, saved_at, body),
                )
                c.execute(
                    "INSERT INTO saves (workspace_id, revision, saved_at, sha256, sources, claims) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        workspace_id,
                        revision,
                        saved_at,
                        digest,
                        len(workspace["sources"]),
                        len(workspace["claims"]),
                    ),
                )
                c.execute("COMMIT")
            except BaseException:
                c.execute("ROLLBACK")
                raise
        return {"id": workspace_id, "revision": revision, "updatedAt": saved_at}

    def delete(self, workspace_id: str) -> bool:
        with self._conn() as c:
            cur = c.execute("DELETE FROM workspaces WHERE id = ?", (workspace_id,))
            c.commit()
            return cur.rowcount > 0

    def saves(self, workspace_id: str) -> list[dict[str, Any]]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT revision, saved_at, sha256, sources, claims FROM saves "
                "WHERE workspace_id = ? ORDER BY seq",
                (workspace_id,),
            ).fetchall()
        return [dict(r) for r in rows]
