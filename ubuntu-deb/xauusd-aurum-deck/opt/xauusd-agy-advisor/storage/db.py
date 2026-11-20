"""Async SQLite WAL database manager with institutional performance pragmas."""
from __future__ import annotations

import pathlib
import aiosqlite

SCHEMA_PATH = pathlib.Path(__file__).parent / "schema.sql"


class Database:
    """Manages an async SQLite connection tuned for WAL time-series throughput."""

    def __init__(self, db_path: str = "storage/trading.db") -> None:
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> aiosqlite.Connection:
        if self._conn is not None:
            return self._conn
        self._conn = await aiosqlite.connect(self.db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._apply_pragmas(self._conn)
        if SCHEMA_PATH.exists():
            await self._conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
            await self._conn.commit()
        return self._conn

    @staticmethod
    async def _apply_pragmas(conn: aiosqlite.Connection) -> None:
        await conn.execute("PRAGMA journal_mode = WAL;")
        await conn.execute("PRAGMA synchronous = NORMAL;")
        await conn.execute("PRAGMA temp_store = MEMORY;")
        await conn.execute("PRAGMA cache_size = -64000;")
        await conn.execute("PRAGMA busy_timeout = 5000;")

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not connected; call await db.connect() first.")
        return self._conn

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
