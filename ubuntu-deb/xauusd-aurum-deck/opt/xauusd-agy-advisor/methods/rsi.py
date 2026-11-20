"""True Wilder's Smoothed RSI(14), Cardwell/Hayden Regimes & Divergence Detector for XAU/USD."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from data_pipeline.aggregator import Candle

RsiRegimeLabel = Literal["BULLISH_REGIME", "BEARISH_REGIME", "NEUTRAL_CHOP"]
RsiDivergenceKind = Literal[
    "NONE",
    "BULLISH_REGULAR",
    "BEARISH_REGULAR",
    "BULLISH_HIDDEN",
    "BEARISH_HIDDEN",
]


@dataclass(slots=True)
class RsiTimeframeState:
    timeframe: str
    value: float
    prev_value: float
    regime: RsiRegimeLabel
    zone: str
    divergence: RsiDivergenceKind
    slope: float


def compute_wilder_rsi_series(candles: list[Candle], period: int = 14) -> list[float]:
    """Compute true Wilder smoothed RSI(period) matching TradingView & MT5 institutional feeds."""
    n = len(candles)
    if n == 0:
        return []
    out = [50.0] * n
    if n <= period:
        return out

    gain_sum = 0.0
    loss_sum = 0.0
    for i in range(1, period + 1):
        delta = candles[i].close - candles[i - 1].close
        if delta > 0:
            gain_sum += delta
        else:
            loss_sum += abs(delta)

    avg_gain = gain_sum / period
    avg_loss = loss_sum / period

    def to_rsi(g: float, l: float) -> float:
        if l == 0.0:
            return 100.0 if g > 0.0 else 50.0
        rs = g / l
        return round(100.0 - (100.0 / (1.0 + rs)), 2)

    out[period] = to_rsi(avg_gain, avg_loss)
    for i in range(period + 1, n):
        delta = candles[i].close - candles[i - 1].close
        gain = delta if delta > 0 else 0.0
        loss = -delta if delta < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = to_rsi(avg_gain, avg_loss)
    return out


def classify_cardwell_regime(rsi_series: list[float], lookback: int = 24) -> RsiRegimeLabel:
    """Andrew Cardwell / John Hayden RSI regime classification: Bullish 40-80 vs Bearish 20-60."""
    if not rsi_series:
        return "NEUTRAL_CHOP"
    recent = rsi_series[-min(lookback, len(rsi_series)) :]
    min_r = min(recent)
    max_r = max(recent)
    curr = recent[-1]
    if min_r >= 37.0 and max_r >= 60.0 and curr >= 42.0:
        return "BULLISH_REGIME"
    if max_r <= 63.0 and min_r <= 40.0 and curr <= 58.0:
        return "BEARISH_REGIME"
    return "NEUTRAL_CHOP"


def classify_rsi_zone(value: float) -> str:
    if value >= 72.0:
        return "OVERBOUGHT_EXTREME"
    if value <= 28.0:
        return "OVERSOLD_EXTREME"
    if 38.0 <= value <= 52.0:
        return "DISCOUNT_RESET"
    if 48.0 <= value <= 62.0:
        return "PREMIUM_RESET"
    return "NEUTRAL"


def detect_rsi_divergence(candles: list[Candle], rsi_series: list[float], lookback: int = 38) -> RsiDivergenceKind:
    """Detect Regular (reversal) and Hidden (trend continuation) divergences on swing pivots."""
    n = min(len(candles), len(rsi_series))
    if n < 22:
        return "NONE"
    start = max(2, n - lookback)
    pivot_highs: list[int] = []
    pivot_lows: list[int] = []

    for i in range(start + 2, n - 2):
        c = candles[i]
        if (
            c.high >= candles[i - 1].high
            and c.high >= candles[i - 2].high
            and c.high >= candles[i + 1].high
            and c.high >= candles[i + 2].high
        ):
            pivot_highs.append(i)
        if (
            c.low <= candles[i - 1].low
            and c.low <= candles[i - 2].low
            and c.low <= candles[i + 1].low
            and c.low <= candles[i + 2].low
        ):
            pivot_lows.append(i)

    if len(pivot_lows) >= 2:
        p1, p2 = pivot_lows[-2], pivot_lows[-1]
        if n - 1 - p2 <= 14:
            if candles[p2].low < candles[p1].low and rsi_series[p2] > rsi_series[p1] + 2.5 and rsi_series[p1] <= 44.0:
                return "BULLISH_REGULAR"
            if candles[p2].low > candles[p1].low and rsi_series[p2] < rsi_series[p1] - 2.5 and rsi_series[p2] >= 36.0:
                return "BULLISH_HIDDEN"

    if len(pivot_highs) >= 2:
        p1, p2 = pivot_highs[-2], pivot_highs[-1]
        if n - 1 - p2 <= 14:
            if candles[p2].high > candles[p1].high and rsi_series[p2] < rsi_series[p1] - 2.5 and rsi_series[p1] >= 56.0:
                return "BEARISH_REGULAR"
            if candles[p2].high < candles[p1].high and rsi_series[p2] > rsi_series[p1] + 2.5 and rsi_series[p2] <= 64.0:
                return "BEARISH_HIDDEN"

    return "NONE"


def analyze_rsi_timeframe(timeframe: str, candles: list[Candle], period: int = 14) -> tuple[RsiTimeframeState, list[float]]:
    series = compute_wilder_rsi_series(candles, period)
    curr = series[-1] if series else 50.0
    prev = series[-2] if len(series) >= 2 else curr
    state = RsiTimeframeState(
        timeframe=timeframe,
        value=curr,
        prev_value=prev,
        regime=classify_cardwell_regime(series),
        zone=classify_rsi_zone(curr),
        divergence=detect_rsi_divergence(candles, series),
        slope=round(curr - prev, 2),
    )
    return state, series
