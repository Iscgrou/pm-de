"""TFS Macro Suite: Tether Line, Velocity Oscillator (VO), and Momentum Breakout (MBO)."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle


@dataclass(slots=True)
class TfsSnapshot:
    tether_price: float
    velocity_oscillator: float
    mbo_score: float
    bias: str  # 'BULLISH' | 'BEARISH' | 'NEUTRAL'


def compute_tfs_suite(candles: list[Candle], lookback: int = 20) -> TfsSnapshot:
    if len(candles) < 5:
        price = candles[-1].close if candles else 0.0
        return TfsSnapshot(price, 0.0, 0.0, "NEUTRAL")

    window = candles[-lookback:]
    tether = round((max(c.high for c in window) + min(c.low for c in window)) / 2.0, 2)
    closes = [c.close for c in window]
    fast = sum(closes[-5:]) / min(5, len(closes))
    slow = sum(closes) / len(closes)
    vo = round(((fast - slow) / max(1.0, slow)) * 1000.0, 3)

    range_span = max(0.01, max(c.high for c in window) - min(c.low for c in window))
    mbo = round(((closes[-1] - tether) / range_span) * 2.0, 3)

    bias = "BULLISH" if vo > 0.15 and mbo > 0.1 else "BEARISH" if vo < -0.15 and mbo < -0.1 else "NEUTRAL"
    return TfsSnapshot(tether_price=tether, velocity_oscillator=vo, mbo_score=mbo, bias=bias)
