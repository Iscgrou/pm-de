"""Tier Watchdog: enforces 2-second TTL freshness and manages Tier 1 -> 2 -> 3 failover."""
from __future__ import annotations

import time
from dataclasses import dataclass

TIER_NAMES = {
    1: "TradingView Chrome CDP",
    2: "Binance PAXGUSDT",
    3: "Yahoo Finance GC=F",
}


@dataclass(slots=True)
class WatchdogStatus:
    active_tier: int
    source_name: str
    ttl_ms: float
    fresh: bool
    failover_count: int


class TierWatchdog:
    """Monitors tick freshness (<2000ms TTL) and promotes healthy fallback tiers."""

    def __init__(self, ttl_limit_ms: float = 2000.0) -> None:
        self.ttl_limit_ms = ttl_limit_ms
        self.active_tier: int = 1
        self.last_tick_ms: dict[int, int] = {1: int(time.time() * 1000), 2: 0, 3: 0}
        self.failover_count: int = 0

    def heartbeat(self, tier: int, ts_ms: int | None = None) -> None:
        self.last_tick_ms[tier] = ts_ms or int(time.time() * 1000)

    def force_failover(self, target_tier: int = 2) -> WatchdogStatus:
        if target_tier != self.active_tier:
            self.active_tier = target_tier
            self.failover_count += 1
        return self.evaluate()

    def evaluate(self, now_ms: int | None = None) -> WatchdogStatus:
        now = now_ms or int(time.time() * 1000)
        elapsed = max(0.0, float(now - self.last_tick_ms.get(self.active_tier, 0)))
        if elapsed > self.ttl_limit_ms and self.active_tier < 3:
            self.active_tier += 1
            self.failover_count += 1
            self.last_tick_ms[self.active_tier] = now
            elapsed = 0.0

        return WatchdogStatus(
            active_tier=self.active_tier,
            source_name=TIER_NAMES[self.active_tier],
            ttl_ms=round(elapsed, 2),
            fresh=elapsed <= self.ttl_limit_ms,
            failover_count=self.failover_count,
        )
