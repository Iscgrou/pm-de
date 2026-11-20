"""6-Way Multi-Timeframe Trend Alignment Matrix (TPI Composite)."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle

TPI_WEIGHTS = {"M1": 0.08, "M5": 0.12, "M15": 0.18, "M30": 0.18, "H1": 0.22, "H4": 0.22}


@dataclass(slots=True)
class TpiSnapshot:
    composite_score: float  # -1.0 to +1.0
    per_timeframe: dict[str, float]
    alignment_label: str


def compute_tpi_matrix(candles_by_tf: dict[str, list[Candle]]) -> TpiSnapshot:
    scores: dict[str, float] = {}
    weighted_sum = 0.0
    total_w = 0.0

    for tf, weight in TPI_WEIGHTS.items():
        series = candles_by_tf.get(tf) or []
        if len(series) < 6:
            scores[tf] = 0.0
            continue
        closes = [c.close for c in series[-20:]]
        ema_fast = sum(closes[-5:]) / 5.0
        ema_slow = sum(closes) / len(closes)
        raw = max(-1.0, min(1.0, (ema_fast - ema_slow) / max(0.5, ema_slow * 0.0025)))
        scores[tf] = round(raw, 3)
        weighted_sum += raw * weight
        total_w += weight

    composite = round(weighted_sum / total_w, 3) if total_w > 0 else 0.0
    if composite >= 0.35:
        label = "STRONG_BULLISH_ALIGNMENT"
    elif composite <= -0.35:
        label = "STRONG_BEARISH_ALIGNMENT"
    else:
        label = "MIXED_CONSOLIDATION"

    return TpiSnapshot(composite_score=composite, per_timeframe=scores, alignment_label=label)
