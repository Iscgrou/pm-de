"""Volume-Pivot Order Block (OB) detector with 50% Mean Threshold (MT) & mitigation."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle


@dataclass(slots=True)
class OrderBlock:
    id: str
    direction: str  # 'BULLISH' | 'BEARISH'
    high: float
    low: float
    mt_50: float
    volume: float
    open_time_ms: int
    mitigated: bool


def detect_volume_order_blocks(candles: list[Candle], lookback: int = 5) -> list[OrderBlock]:
    obs: list[OrderBlock] = []
    n = len(candles)
    if n < lookback + 3:
        return obs

    avg_vol = sum(c.volume for c in candles) / max(1, n)
    for i in range(lookback, n - 2):
        c = candles[i]
        nxt = candles[i + 1]
        after = candles[i + 2]
        vol_pivot = c.volume >= avg_vol * 1.15

        # Bullish OB: bearish candle followed by strong bullish displacement
        if vol_pivot and c.close < c.open and nxt.close > c.high and after.close > nxt.open:
            body_hi = max(c.open, c.close)
            body_lo = min(c.open, c.close)
            mt = round((body_hi + body_lo) / 2.0, 2)
            mitigated = any(f.low <= mt for f in candles[i + 2 :])
            obs.append(
                OrderBlock(
                    id=f"ob-bull-{c.open_time_ms}",
                    direction="BULLISH",
                    high=round(c.high, 2),
                    low=round(c.low, 2),
                    mt_50=mt,
                    volume=round(c.volume, 2),
                    open_time_ms=c.open_time_ms,
                    mitigated=mitigated,
                )
            )
        # Bearish OB: bullish candle followed by strong bearish displacement
        elif vol_pivot and c.close > c.open and nxt.close < c.low and after.close < nxt.open:
            body_hi = max(c.open, c.close)
            body_lo = min(c.open, c.close)
            mt = round((body_hi + body_lo) / 2.0, 2)
            mitigated = any(f.high >= mt for f in candles[i + 2 :])
            obs.append(
                OrderBlock(
                    id=f"ob-bear-{c.open_time_ms}",
                    direction="BEARISH",
                    high=round(c.high, 2),
                    low=round(c.low, 2),
                    mt_50=mt,
                    volume=round(c.volume, 2),
                    open_time_ms=c.open_time_ms,
                    mitigated=mitigated,
                )
            )
    return obs
