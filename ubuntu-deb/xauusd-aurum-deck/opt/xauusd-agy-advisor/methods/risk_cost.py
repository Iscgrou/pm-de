"""Strict mathematical guardrails: R:R >= 1.50, geometric ordering, and >= 0.25 * ATR stop distance."""
from __future__ import annotations

from dataclasses import dataclass
from data_pipeline.aggregator import Candle

MIN_RR_RATIO = 1.50
MIN_ATR_STOP_MULT = 0.25


@dataclass(slots=True)
class GuardrailResult:
    valid: bool
    rr_ratio: float
    stop_distance: float
    min_stop_required: float
    errors: list[str]


def compute_atr(candles: list[Candle], period: int = 14) -> float:
    if len(candles) < 2:
        return 3.5
    trs: list[float] = []
    for i in range(1, len(candles)):
        c, prev = candles[i], candles[i - 1]
        tr = max(c.high - c.low, abs(c.high - prev.close), abs(c.low - prev.close))
        trs.append(tr)
    window = trs[-period:]
    return round(sum(window) / max(1, len(window)), 4)


def validate_trade_guardrails(
    direction: str,
    entry: float,
    stop_loss: float,
    tp1: float,
    tp2: float,
    atr: float,
) -> GuardrailResult:
    errors: list[str] = []
    d = direction.upper()

    if d == "LONG":
        if not (stop_loss < entry < tp1 < tp2):
            errors.append("LONG geometric invariant violated: requires SL < Entry < TP1 < TP2")
    elif d == "SHORT":
        if not (stop_loss > entry > tp1 > tp2):
            errors.append("SHORT geometric invariant violated: requires SL > Entry > TP1 > TP2")
    else:
        errors.append(f"Unsupported direction '{direction}'")

    stop_dist = abs(entry - stop_loss)
    reward_dist = abs(tp1 - entry)
    rr = round(reward_dist / stop_dist, 4) if stop_dist > 0 else 0.0

    if rr < MIN_RR_RATIO:
        errors.append(f"Sub-1.50 R:R rejected ({rr:.2f} < {MIN_RR_RATIO:.2f})")

    min_stop = round(MIN_ATR_STOP_MULT * atr, 4)
    if stop_dist < min_stop:
        errors.append(f"Stop distance ${stop_dist:.2f} tighter than 0.25*ATR (${min_stop:.2f})")

    return GuardrailResult(
        valid=len(errors) == 0,
        rr_ratio=rr,
        stop_distance=round(stop_dist, 4),
        min_stop_required=min_stop,
        errors=errors,
    )
