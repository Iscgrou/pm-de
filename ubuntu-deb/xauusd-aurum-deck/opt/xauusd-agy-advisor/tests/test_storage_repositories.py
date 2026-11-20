"""Storage repository benchmarks and CrashRecovery tests."""
from __future__ import annotations

import time
import pytest

from data_pipeline.aggregator import Candle
from storage.db import Database
from storage.candle_repository import CandleRepository
from storage.signal_repository import SignalRepository
from storage.recovery import CrashRecovery


@pytest.mark.asyncio
async def test_candle_without_rowid_benchmark_and_recovery() -> None:
    db = Database(":memory:")
    await db.connect()
    repo = CandleRepository(db)
    sig_repo = SignalRepository(db)

    now = int(time.time() * 1000)
    batch = [
        Candle("XAUUSD", "M15", now - i * 900_000, 2740.0, 2742.0, 2738.0, 2741.0, 120.0, True)
        for i in range(2000)
    ]
    await repo.upsert_many(batch)

    t0 = time.perf_counter()
    fetched = await repo.fetch_recent("XAUUSD", "M15", limit=2000)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    assert len(fetched) == 2000
    assert elapsed_ms < 100.0

    await sig_repo.create("sig-1", "LONG", 2740.0, 2734.0, 2750.0, 2760.0, 1.67)
    report = await CrashRecovery(db).run()
    assert report.integrity_ok
    assert report.voided_pending_orders == 1
    await db.close()
