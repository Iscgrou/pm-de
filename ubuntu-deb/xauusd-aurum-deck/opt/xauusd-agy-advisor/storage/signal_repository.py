"""7-State Signal Lifecycle repository."""
from __future__ import annotations

import time
from typing import Any
from .db import Database

VALID_STATES = (
    "DETECTED",
    "PENDING_ENTRY",
    "OPEN",
    "BREAK_EVEN_ARMED",
    "RISK_FREE_TP1",
    "CLOSED_TP2",
    "EXPIRED_OR_VETOED",
)


class SignalRepository:
    def __init__(self, db: Database) -> None:
        self.db = db

    async def create(
        self,
        signal_id: str,
        direction: str,
        entry_price: float,
        stop_loss: float,
        tp1: float,
        tp2: float,
        rr_ratio: float,
        lot_size: float = 0.10,
        state: str = "PENDING_ENTRY",
    ) -> None:
        now = int(time.time() * 1000)
        await self.db.conn.execute(
            """
            INSERT INTO trade_signals (
                signal_id, symbol, direction, state, entry_price, stop_loss, tp1, tp2,
                rr_ratio, lot_size, created_at_ms, updated_at_ms
            ) VALUES (?, 'XAUUSD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (signal_id, direction, state, entry_price, stop_loss, tp1, tp2, rr_ratio, lot_size, now, now),
        )
        await self.db.conn.commit()

    async def transition(self, signal_id: str, new_state: str) -> None:
        if new_state not in VALID_STATES:
            raise ValueError(f"Invalid signal state: {new_state}")
        now = int(time.time() * 1000)
        await self.db.conn.execute(
            "UPDATE trade_signals SET state = ?, updated_at_ms = ? WHERE signal_id = ?",
            (new_state, now, signal_id),
        )
        await self.db.conn.commit()

    async def cancel_pending_entries(self) -> int:
        now = int(time.time() * 1000)
        cur = await self.db.conn.execute(
            "UPDATE trade_signals SET state = 'EXPIRED_OR_VETOED', updated_at_ms = ? WHERE state = 'PENDING_ENTRY'",
            (now,),
        )
        await self.db.conn.commit()
        return cur.rowcount

    async def list_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        cur = await self.db.conn.execute(
            "SELECT * FROM trade_signals ORDER BY created_at_ms DESC LIMIT ?",
            (limit,),
        )
        return [dict(r) for r in await cur.fetchall()]
