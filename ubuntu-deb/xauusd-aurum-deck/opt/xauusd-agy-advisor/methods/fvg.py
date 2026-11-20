"""LuxAlgo-style True Fair Value Gap (FVG) detector with 50% Consequent Encroachment (CE) & mitigation."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle


@dataclass(slots=True)
class FairValueGap:
    id: str
    direction: str  # 'BULLISH' | 'BEARISH'
    top: float
    bottom: float
    ce_50: float
    start_time_ms: int
    mitigated: bool
    mitigated_at_ms: int | None = None


def detect_luxalgo_fvgs(candles: list[Candle], min_gap_usd: float = 0.60) -> list[FairValueGap]:
    fvgs: list[FairValueGap] = []
    n = len(candles)
    for i in range(2, n):
        c1, c2, c3 = candles[i - 2], candles[i - 1], candles[i]
        # Bullish FVG: c1.high < c3.low
        if c3.low - c1.high >= min_gap_usd and c2.close > c2.open:
            top = round(c3.low, 2)
            bottom = round(c1.high, 2)
            ce = round((top + bottom) / 2.0, 2)
            mitigated = False
            mit_ts = None
            for future in candles[i + 1 :]:
                if future.low <= ce:
                    mitigated = True
                    mit_ts = future.open_time_ms
                    break
            fvgs.append(
                FairValueGap(
                    id=f"fvg-bull-{c2.open_time_ms}",
                    direction="BULLISH",
                    top=top,
                    bottom=bottom,
                    ce_50=ce,
                    start_time_ms=c2.open_time_ms,
                    mitigated=mitigated,
                    mitigated_at_ms=mit_ts,
                )
            )
        # Bearish FVG: c1.low > c3.high
        elif c1.low - c3.high >= min_gap_usd and c2.close < c2.open:
            top = round(c1.low, 2)
            bottom = round(c3.high, 2)
            ce = round((top + bottom) / 2.0, 2)
            mitigated = False
            mit_ts = None
            for future in candles[i + 1 :]:
                if future.high >= ce:
                    mitigated = True
                    mit_ts = future.open_time_ms
                    break
            fvgs.append(
                FairValueGap(
                    id=f"fvg-bear-{c2.open_time_ms}",
                    direction="BEARISH",
                    top=top,
                    bottom=bottom,
                    ce_50=ce,
                    start_time_ms=c2.open_time_ms,
                    mitigated=mitigated,
                    mitigated_at_ms=mit_ts,
                )
            )
    return fvgs
