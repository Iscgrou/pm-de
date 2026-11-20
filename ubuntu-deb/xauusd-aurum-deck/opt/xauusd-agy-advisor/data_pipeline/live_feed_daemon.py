"""Autonomous 3-Tier Institutional Live Feed Daemon for standalone Ubuntu .deb deployments.

Tier 1A: TradingView Chrome CDP (OANDA:XAUUSD) when local Chrome debug port 9222 is active.
Tier 1B: Swissquote Interbank Public BBO Spot XAU/USD (zero API key, institutional ECN Bid/Ask).
Tier 2:  Binance PAXGUSDT calibrated via EWMA PaxgCalibrator + BasisDivergenceGuard.
Tier 3:  Yahoo Finance COMEX Gold Futures (GC=F) fallback.
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable, Optional
import httpx

from cdp_streamer import TickEvent
from .divergence_guard import BasisDivergenceGuard, DivergenceReport
from .orchestrator import MarketDataOrchestrator

SWISSQUOTE_XAU_BBO_URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD"
BINANCE_PAXG_BOOK_URL = "https://api.binance.com/api/v3/ticker/bookTicker?symbol=PAXGUSDT"
YAHOO_GCF_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d"


class LiveFeedDaemon:
    """Streams real-time interbank XAU/USD quotes automatically on any Ubuntu machine."""

    def __init__(
        self,
        orchestrator: MarketDataOrchestrator,
        on_tick: Optional[Callable[[TickEvent, DivergenceReport | None], None]] = None,
        poll_interval_sec: float = 1.5,
    ) -> None:
        self.orchestrator = orchestrator
        self.on_tick = on_tick
        self.poll_interval_sec = poll_interval_sec
        self.divergence_guard = BasisDivergenceGuard()
        self.last_paxg_price: float | None = None
        self.last_divergence: DivergenceReport | None = None
        self._running = False

    async def fetch_swissquote_interbank(self, client: httpx.AsyncClient) -> TickEvent | None:
        try:
            resp = await client.get(SWISSQUOTE_XAU_BBO_URL, timeout=4.0)
            resp.raise_for_status()
            payload = resp.json()
            if not isinstance(payload, list) or not payload:
                return None
            # Prefer prime/standard institutional spread tier
            for venue in payload:
                profiles = venue.get("spreadProfilePrices") or []
                if not profiles:
                    continue
                p0 = profiles[0]
                bid = float(p0["bid"])
                ask = float(p0["ask"])
                mid = round((bid + ask) / 2.0, 2)
                return TickEvent(
                    symbol="XAUUSD",
                    last=mid,
                    bid=round(bid, 2),
                    ask=round(ask, 2),
                    spread=round(max(0.0, ask - bid), 3),
                    timestamp_ms=int(venue.get("ts") or time.time() * 1000),
                    tier=1,
                    source="Swissquote Interbank BBO",
                )
        except Exception:
            return None
        return None

    async def fetch_binance_paxg(self, client: httpx.AsyncClient) -> TickEvent | None:
        try:
            resp = await client.get(BINANCE_PAXG_BOOK_URL, timeout=4.0)
            resp.raise_for_status()
            data = resp.json()
            bid = float(data["bidPrice"])
            ask = float(data["askPrice"])
            mid = round((bid + ask) / 2.0, 2)
            self.last_paxg_price = mid
            return TickEvent(
                symbol="PAXGUSDT",
                last=mid,
                bid=round(bid, 2),
                ask=round(ask, 2),
                spread=round(max(0.0, ask - bid), 3),
                timestamp_ms=int(time.time() * 1000),
                tier=2,
                source="Binance PAXGUSDT (Calibrated)",
            )
        except Exception:
            return None

    async def fetch_yahoo_gcf(self, client: httpx.AsyncClient) -> TickEvent | None:
        try:
            resp = await client.get(YAHOO_GCF_URL, timeout=5.0, headers={"User-Agent": "PayamXAUUSD/2.0"})
            resp.raise_for_status()
            meta = resp.json()["chart"]["result"][0]["meta"]
            price = float(meta["regularMarketPrice"])
            return TickEvent(
                symbol="GC=F",
                last=round(price, 2),
                bid=round(price - 0.15, 2),
                ask=round(price + 0.15, 2),
                spread=0.30,
                timestamp_ms=int(time.time() * 1000),
                tier=3,
                source="Yahoo COMEX GC=F",
            )
        except Exception:
            return None

    async def run_forever(self) -> None:
        self._running = True
        async with httpx.AsyncClient() as client:
            while self._running:
                spot_tick, paxg_tick = await asyncio.gather(
                    self.fetch_swissquote_interbank(client),
                    self.fetch_binance_paxg(client),
                )
                chosen = spot_tick
                if spot_tick and paxg_tick:
                    self.orchestrator.calibrator.observe(spot_tick.last, paxg_tick.last)
                    self.last_divergence = self.divergence_guard.evaluate(spot_tick.last, paxg_tick.last)
                elif paxg_tick:
                    chosen = paxg_tick
                else:
                    chosen = await self.fetch_yahoo_gcf(client)

                if chosen:
                    outcome = self.orchestrator.ingest_tick(chosen)
                    if outcome.accepted and outcome.tick and self.on_tick:
                        self.on_tick(outcome.tick, self.last_divergence)

                await asyncio.sleep(self.poll_interval_sec)

    def stop(self) -> None:
        self._running = False
