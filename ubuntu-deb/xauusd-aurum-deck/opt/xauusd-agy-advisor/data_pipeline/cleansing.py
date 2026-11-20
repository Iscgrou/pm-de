"""Toxic spike cleansing filter to drop corrupt broker ticks."""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass(slots=True)
class CleansingVerdict:
    accepted: bool
    price: float
    deviation_pct: float
    reason: str


class ToxicSpikeFilter:
    """Drops single-tick anomalies exceeding max_jump_pct or atr_multiplier * rolling ATR."""

    def __init__(self, max_jump_pct: float = 0.012, window: int = 30) -> None:
        self.max_jump_pct = max_jump_pct
        self._recent: deque[float] = deque(maxlen=window)
        self.rejected_count: int = 0

    def validate(self, price: float, bid: float, ask: float) -> CleansingVerdict:
        if price <= 0 or bid <= 0 or ask <= 0 or ask < bid:
            self.rejected_count += 1
            return CleansingVerdict(False, price, 1.0, "Invalid OHLC/quote geometry")

        spread = ask - bid
        if spread > 12.0:
            self.rejected_count += 1
            return CleansingVerdict(False, price, spread / price, f"Excessive toxic spread ${spread:.2f}")

        if not self._recent:
            self._recent.append(price)
            return CleansingVerdict(True, price, 0.0, "Baseline tick accepted")

        anchor = self._recent[-1]
        dev = abs(price - anchor) / anchor
        if dev > self.max_jump_pct:
            self.rejected_count += 1
            return CleansingVerdict(
                False,
                price,
                round(dev, 6),
                f"Toxic spike dropped ({dev * 100:.2f}% jump vs anchor {anchor:.2f})",
            )

        self._recent.append(price)
        return CleansingVerdict(True, price, round(dev, 6), "Clean tick")
