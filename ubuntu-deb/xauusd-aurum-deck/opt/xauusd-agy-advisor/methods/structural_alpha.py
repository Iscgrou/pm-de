"""Structural Alpha: Swing High/Low detection, Break of Structure (BOS) & Change of Character (CHoCH)."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle


@dataclass(slots=True)
class StructureEvent:
    kind: str  # 'BOS' | 'CHoCH'
    direction: str  # 'BULLISH' | 'BEARISH'
    level: float
    time_ms: int


def detect_market_structure(candles: list[Candle], swing_len: int = 3) -> list[StructureEvent]:
    events: list[StructureEvent] = []
    n = len(candles)
    if n < swing_len * 2 + 2:
        return events

    last_swing_high: float | None = None
    last_swing_low: float | None = None
    trend: str = "NEUTRAL"

    for i in range(swing_len, n - swing_len):
        hi = candles[i].high
        lo = candles[i].low
        if all(hi >= candles[j].high for j in range(i - swing_len, i + swing_len + 1)):
            last_swing_high = hi
        if all(lo <= candles[j].low for j in range(i - swing_len, i + swing_len + 1)):
            last_swing_low = lo

        c = candles[i + swing_len]
        if last_swing_high is not None and c.close > last_swing_high:
            kind = "CHoCH" if trend == "BEARISH" else "BOS"
            events.append(StructureEvent(kind, "BULLISH", round(last_swing_high, 2), c.open_time_ms))
            trend = "BULLISH"
            last_swing_high = c.high
        elif last_swing_low is not None and c.close < last_swing_low:
            kind = "CHoCH" if trend == "BULLISH" else "BOS"
            events.append(StructureEvent(kind, "BEARISH", round(last_swing_low, 2), c.open_time_ms))
            trend = "BEARISH"
            last_swing_low = c.low

    return events
