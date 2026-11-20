"""SymbolTripwire: blocks non-gold symbol contamination in <50ms and forces Tier 2 failover."""
from __future__ import annotations

import time
from dataclasses import dataclass

ALLOWED_GOLD_SYMBOLS = frozenset({
    "XAUUSD",
    "OANDA:XAUUSD",
    "FXCM:XAUUSD",
    "FOREXCOM:XAUUSD",
    "TVC:GOLD",
    "COMEX:GC1!",
    "GC=F",
    "PAXGUSDT",
    "GOLD",
})


@dataclass(slots=True)
class TripwireResult:
    allowed: bool
    normalized_symbol: str
    elapsed_ms: float
    failover_triggered: bool
    reason: str


class SymbolTripwire:
    """High-speed guard ensuring non-XAUUSD Chrome tab switches never pollute the quant engine."""

    def __init__(self) -> None:
        self.tripped_count: int = 0
        self.last_blocked_symbol: str | None = None
        self.last_trip_ms: int = 0

    def inspect(self, raw_symbol: str) -> TripwireResult:
        t0 = time.perf_counter()
        cleaned = raw_symbol.strip().upper()
        base = cleaned.split(":")[-1]
        is_gold = cleaned in ALLOWED_GOLD_SYMBOLS or base in ALLOWED_GOLD_SYMBOLS
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        if is_gold:
            return TripwireResult(
                allowed=True,
                normalized_symbol="XAUUSD",
                elapsed_ms=round(elapsed_ms, 4),
                failover_triggered=False,
                reason="Verified gold instrument",
            )

        self.tripped_count += 1
        self.last_blocked_symbol = cleaned
        self.last_trip_ms = int(time.time() * 1000)
        return TripwireResult(
            allowed=False,
            normalized_symbol="XAUUSD",
            elapsed_ms=round(elapsed_ms, 4),
            failover_triggered=True,
            reason=f"SymbolTripwire blocked non-gold symbol '{cleaned}'; routing to Tier 2 PAXGUSDT",
        )
