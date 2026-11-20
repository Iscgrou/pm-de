"""In-memory high-speed candle ring store with 15,000 candle capacity per timeframe."""
from __future__ import annotations

from collections import deque
from .aggregator import Candle, TIMEFRAME_MS


class CandleManager:
    """Stores up to 15,000 candles per timeframe in memory for <5ms System 1 SMC reads."""

    MAX_CAPACITY = 15_000

    def __init__(self) -> None:
        self._series: dict[str, deque[Candle]] = {
            tf: deque(maxlen=self.MAX_CAPACITY) for tf in TIMEFRAME_MS
        }

    def upsert(self, candle: Candle) -> None:
        buf = self._series.setdefault(candle.timeframe, deque(maxlen=self.MAX_CAPACITY))
        if buf and buf[-1].open_time_ms == candle.open_time_ms:
            buf[-1] = candle
        else:
            buf.append(candle)

    def get_recent(self, timeframe: str, limit: int = 300) -> list[Candle]:
        buf = self._series.get(timeframe)
        if not buf:
            return []
        if limit >= len(buf):
            return list(buf)
        return list(buf)[-limit:]

    def count(self, timeframe: str) -> int:
        return len(self._series.get(timeframe, ()))
