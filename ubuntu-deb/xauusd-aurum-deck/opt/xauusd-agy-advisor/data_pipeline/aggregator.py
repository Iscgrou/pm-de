"""Multi-timeframe tick-to-candle aggregator (M1, M5, M15, M30, H1, H4)."""
from __future__ import annotations

from dataclasses import dataclass

TIMEFRAME_MS: dict[str, int] = {
    "M1": 60_000,
    "M5": 300_000,
    "M15": 900_000,
    "M30": 1_800_000,
    "H1": 3_600_000,
    "H4": 14_400_000,
}


@dataclass(slots=True)
class Candle:
    symbol: str
    timeframe: str
    open_time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float = 1.0
    closed: bool = False


class TimeframeAggregator:
    """Rolls incoming XAUUSD ticks into synchronized M1-H4 candles."""

    def __init__(self, symbol: str = "XAUUSD") -> None:
        self.symbol = symbol
        self._active: dict[str, Candle] = {}

    def on_tick(self, price: float, timestamp_ms: int, volume: float = 1.0) -> list[Candle]:
        emitted: list[Candle] = []
        for tf, bucket_ms in TIMEFRAME_MS.items():
            bucket_open = (timestamp_ms // bucket_ms) * bucket_ms
            current = self._active.get(tf)
            if current is None:
                c = Candle(self.symbol, tf, bucket_open, price, price, price, price, volume, False)
                self._active[tf] = c
                emitted.append(c)
            elif bucket_open > current.open_time_ms:
                current.closed = True
                emitted.append(current)
                nxt = Candle(self.symbol, tf, bucket_open, price, price, price, price, volume, False)
                self._active[tf] = nxt
                emitted.append(nxt)
            else:
                current.high = max(current.high, price)
                current.low = min(current.low, price)
                current.close = price
                current.volume += volume
                emitted.append(current)
        return emitted
