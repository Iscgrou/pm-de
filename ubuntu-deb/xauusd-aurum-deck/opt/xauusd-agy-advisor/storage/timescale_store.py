"""
Optional PostgreSQL 16 + TimescaleDB async repository for the Ubuntu .deb Sentinel daemon.
Automatically activates when DATABASE_URL is configured on the target Ubuntu workstation;
falls back seamlessly to the bundled SQLite WAL database when DATABASE_URL is absent.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

CAGG_TABLES = {
    "M1": "candles_1m",
    "M5": "candles_5m",
    "M15": "candles_15m",
    "M30": "candles_30m",
    "H1": "candles_1h",
    "H4": "candles_4h",
}


class TimescaleRepository:
    def __init__(self, dsn: Optional[str] = None) -> None:
        self.dsn = (dsn or os.getenv("DATABASE_URL") or "").strip()
        self._pool: Any = None
        self.connected = False

    async def connect(self) -> bool:
        if not self.dsn:
            return False
        try:
            import asyncpg  # type: ignore

            self._pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=6, timeout=3.0)
            async with self._pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            self.connected = True
            return True
        except Exception:
            self.connected = False
            self._pool = None
            return False

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            self.connected = False

    async def insert_tick(
        self,
        ts_ms: int,
        bid: float,
        ask: float,
        mid: float,
        spread: float,
        paxg_mid: Optional[float],
        basis_usd: float,
        source: str,
        symbol: str = "XAUUSD",
    ) -> None:
        if not self._pool or not self.connected:
            return
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO market_ticks (ts, symbol, bid, ask, mid, spread, paxg_mid, basis_usd, source)
                VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
                """,
                ts_ms,
                symbol,
                bid,
                ask,
                mid,
                spread,
                paxg_mid,
                basis_usd,
                source,
            )

    async def get_candles(self, timeframe: str, limit: int = 240, symbol: str = "XAUUSD") -> List[Dict[str, Any]]:
        if not self._pool or not self.connected:
            return []
        table = CAGG_TABLES.get(timeframe.upper(), "candles_15m")
        safe_limit = max(20, min(500, int(limit)))
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT EXTRACT(EPOCH FROM bucket)::bigint AS time_sec, open, high, low, close, volume
                FROM {table}
                WHERE symbol = $1
                ORDER BY bucket DESC
                LIMIT $2
                """,
                symbol,
                safe_limit,
            )
        return [
            {
                "time": int(r["time_sec"]),
                "open": round(float(r["open"]), 2),
                "high": round(float(r["high"]), 2),
                "low": round(float(r["low"]), 2),
                "close": round(float(r["close"]), 2),
                "volume": int(round(float(r["volume"]))),
            }
            for r in reversed(rows)
        ]
