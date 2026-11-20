"""Market Regime Classifier: Trending Bullish/Bearish, Range, or High Volatility Expansion."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle
from .risk_cost import compute_atr


@dataclass(slots=True)
class MarketRegime:
    label: str  # 'TRENDING_BULLISH' | 'TRENDING_BEARISH' | 'RANGING' | 'VOLATILE_EXPANSION'
    atr: float
    trend_slope: float


def classify_regime(candles: list[Candle]) -> MarketRegime:
    atr = compute_atr(candles)
    if len(candles) < 15:
        return MarketRegime("RANGING", atr, 0.0)

    recent = candles[-15:]
    delta = recent[-1].close - recent[0].close
    efficiency = abs(delta) / max(0.01, sum(abs(recent[i].close - recent[i - 1].close) for i in range(1, len(recent))))

    if atr > 10.5 and efficiency < 0.35:
        label = "VOLATILE_EXPANSION"
    elif efficiency >= 0.42 and delta > 0:
        label = "TRENDING_BULLISH"
    elif efficiency >= 0.42 and delta < 0:
        label = "TRENDING_BEARISH"
    else:
        label = "RANGING"

    return MarketRegime(label=label, atr=round(atr, 3), trend_slope=round(delta / len(recent), 4))
