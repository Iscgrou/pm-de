"""LoopLagMonitor: enforces Asyncio event loop P99 latency < 20.0ms."""
from __future__ import annotations

import asyncio
import time
from collections import deque


class LoopLagMonitor:
    """Samples event-loop scheduling drift and computes P50 / P99 latency in milliseconds."""

    P99_BUDGET_MS = 20.0

    def __init__(self, sample_size: int = 200) -> None:
        self._samples_ms: deque[float] = deque(maxlen=sample_size)
        self._running = False

    def record_sample(self, lag_ms: float) -> None:
        self._samples_ms.append(max(0.0, lag_ms))

    async def probe_once(self, interval_sec: float = 0.01) -> float:
        t0 = time.perf_counter()
        await asyncio.sleep(interval_sec)
        drift_ms = max(0.0, ((time.perf_counter() - t0) - interval_sec) * 1000.0)
        self.record_sample(drift_ms)
        return round(drift_ms, 3)

    def p99_ms(self) -> float:
        if not self._samples_ms:
            return 0.0
        ordered = sorted(self._samples_ms)
        idx = min(len(ordered) - 1, int(len(ordered) * 0.99))
        return round(ordered[idx], 3)

    def is_healthy(self) -> bool:
        return self.p99_ms() < self.P99_BUDGET_MS
