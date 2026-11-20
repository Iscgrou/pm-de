"""MarketDataOrchestrator: coordinates tripwire, spike filter, calibration, watchdog & aggregation."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from cdp_streamer import TickEvent
from .aggregator import Candle, TimeframeAggregator
from .calibration import PaxgCalibrator
from .candle_manager import CandleManager
from .cleansing import ToxicSpikeFilter
from .tripwire import SymbolTripwire
from .watchdog import TierWatchdog, WatchdogStatus


@dataclass(slots=True)
class IngestOutcome:
    accepted: bool
    tick: Optional[TickEvent]
    candles: list[Candle]
    watchdog: WatchdogStatus
    note: str


class MarketDataOrchestrator:
    """Single entry point for all Tier 1/2/3 ticks entering System 1."""

    def __init__(self) -> None:
        self.tripwire = SymbolTripwire()
        self.cleansing = ToxicSpikeFilter()
        self.calibrator = PaxgCalibrator()
        self.watchdog = TierWatchdog()
        self.aggregator = TimeframeAggregator("XAUUSD")
        self.candle_manager = CandleManager()

    def ingest_tick(self, tick: TickEvent) -> IngestOutcome:
        trip = self.tripwire.inspect(tick.symbol)
        if not trip.allowed:
            status = self.watchdog.force_failover(target_tier=2)
            return IngestOutcome(False, None, [], status, trip.reason)

        price = tick.last
        bid = tick.bid
        ask = tick.ask
        if tick.tier == 2:
            price = self.calibrator.to_spot(price)
            bid = self.calibrator.to_spot(bid)
            ask = self.calibrator.to_spot(ask)

        verdict = self.cleansing.validate(price, bid, ask)
        if not verdict.accepted:
            return IngestOutcome(False, None, [], self.watchdog.evaluate(), verdict.reason)

        normalized = TickEvent(
            symbol="XAUUSD",
            last=round(price, 2),
            bid=round(bid, 2),
            ask=round(ask, 2),
            spread=round(max(0.0, ask - bid), 3),
            timestamp_ms=tick.timestamp_ms,
            tier=tick.tier,
            source=tick.source,
        )
        self.watchdog.heartbeat(tick.tier, tick.timestamp_ms)
        candles = self.aggregator.on_tick(normalized.last, normalized.timestamp_ms)
        for c in candles:
            self.candle_manager.upsert(c)

        return IngestOutcome(True, normalized, candles, self.watchdog.evaluate(), "OK")
