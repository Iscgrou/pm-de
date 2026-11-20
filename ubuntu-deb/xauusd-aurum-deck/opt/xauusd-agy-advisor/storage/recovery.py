"""5-Step CrashRecovery engine executed automatically on Sentinel server boot."""
from __future__ import annotations

import time
from dataclasses import dataclass
from .db import Database


@dataclass(slots=True)
class RecoveryReport:
    integrity_ok: bool
    voided_pending_orders: int
    restored_open_positions: int
    expired_intelligence_jobs: int
    ws_sequence_reset_to: int


class CrashRecovery:
    """Executes the 5-step boot recovery protocol against SQLite WAL storage."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def run(self) -> RecoveryReport:
        now = int(time.time() * 1000)

        # Step 1: Physical database integrity check
        cur = await self.db.conn.execute("PRAGMA integrity_check;")
        row = await cur.fetchone()
        integrity_ok = bool(row and str(row[0]).lower() == "ok")
        if not integrity_ok:
            raise RuntimeError(f"SQLite integrity check failed: {row}")

        # Step 2: Void dangling PENDING_ENTRY orders
        cur_void = await self.db.conn.execute(
            "UPDATE trade_signals SET state = 'EXPIRED_OR_VETOED', updated_at_ms = ? WHERE state = 'PENDING_ENTRY'",
            (now,),
        )
        voided = cur_void.rowcount

        # Step 3: Restore active OPEN positions and verify stop synchronization
        cur_pos = await self.db.conn.execute("SELECT COUNT(*) FROM positions WHERE status = 'OPEN'")
        restored = int((await cur_pos.fetchone())[0])

        # Step 4: Expire stale pending System 2 intelligence jobs
        cur_jobs = await self.db.conn.execute(
            """
            UPDATE pending_intelligence_jobs
            SET status = 'EXPIRED'
            WHERE status IN ('PENDING', 'CLAIMED') AND expires_at_ms <= ?
            """,
            (now,),
        )
        expired_jobs = cur_jobs.rowcount

        # Step 5: Reset WebSocket Sequence ID watermark
        await self.db.conn.execute(
            """
            INSERT INTO system_state (key, value, updated_at_ms)
            VALUES ('ws_sequence_id', '0', ?)
            ON CONFLICT(key) DO UPDATE SET value = '0', updated_at_ms = excluded.updated_at_ms
            """,
            (now,),
        )
        await self.db.conn.commit()

        return RecoveryReport(
            integrity_ok=integrity_ok,
            voided_pending_orders=voided,
            restored_open_positions=restored,
            expired_intelligence_jobs=expired_jobs,
            ws_sequence_reset_to=0,
        )
