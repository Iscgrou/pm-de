"""Chrome DevTools Protocol (CDP) WebSocket sniffer & TradingView frame parser."""
from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional

FRAME_PATTERN = re.compile(r"~m~(\d+)~m~")


@dataclass(slots=True)
class TickEvent:
    symbol: str
    last: float
    bid: float
    ask: float
    spread: float
    timestamp_ms: int
    tier: int = 1
    source: str = "tradingview_cdp"


@dataclass(slots=True)
class CandleFragment:
    symbol: str
    timeframe: str
    open_time_ms: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class TradingViewPacketParser:
    """Deframes TradingView WebSocket ~m~LEN~m~JSON packets into qsd ticks & du candles."""

    def deframe(self, raw_payload: str) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        idx = 0
        n = len(raw_payload)
        while idx < n:
            match = FRAME_PATTERN.match(raw_payload, idx)
            if not match:
                break
            length = int(match.group(1))
            start = match.end()
            end = start + length
            chunk = raw_payload[start:end]
            idx = end
            if not chunk or chunk.startswith("~h~"):
                continue
            try:
                parsed = json.loads(chunk)
                if isinstance(parsed, dict):
                    messages.append(parsed)
            except json.JSONDecodeError:
                continue
        return messages

    def parse_payload(self, raw_payload: str) -> tuple[list[TickEvent], list[CandleFragment]]:
        ticks: list[TickEvent] = []
        candles: list[CandleFragment] = []
        now_ms = int(time.time() * 1000)

        for msg in self.deframe(raw_payload):
            method = msg.get("m")
            params = msg.get("p") or []

            if method == "qsd" and len(params) >= 2 and isinstance(params[1], dict):
                quote = params[1]
                symbol = str(quote.get("n") or "XAUUSD")
                v = quote.get("v") or {}
                last = v.get("lp")
                if last is not None:
                    last_f = float(last)
                    bid_f = float(v.get("bid", last_f - 0.12))
                    ask_f = float(v.get("ask", last_f + 0.12))
                    spread = round(max(0.0, ask_f - bid_f), 4)
                    ticks.append(
                        TickEvent(
                            symbol=symbol,
                            last=last_f,
                            bid=bid_f,
                            ask=ask_f,
                            spread=spread,
                            timestamp_ms=int(v.get("chp_ts", now_ms)),
                        )
                    )

            elif method in ("du", "timescale_update") and len(params) >= 2 and isinstance(params[1], dict):
                series_map = params[1]
                for series_data in series_map.values():
                    if not isinstance(series_data, dict):
                        continue
                    bars = series_data.get("s") or []
                    for bar in bars:
                        vals = bar.get("v") if isinstance(bar, dict) else None
                        if isinstance(vals, list) and len(vals) >= 6:
                            candles.append(
                                CandleFragment(
                                    symbol="XAUUSD",
                                    timeframe="M1",
                                    open_time_ms=int(float(vals[0]) * 1000),
                                    open=float(vals[1]),
                                    high=float(vals[2]),
                                    low=float(vals[3]),
                                    close=float(vals[4]),
                                    volume=float(vals[5]),
                                )
                            )
        return ticks, candles


class ChromeCDPStreamer:
    """Connects to local Chrome DevTools remote debugging port (9222) to sniff TradingView WS frames."""

    def __init__(
        self,
        cdp_ws_url: str = "ws://127.0.0.1:9222/devtools/browser",
        on_tick: Optional[Callable[[TickEvent], Any]] = None,
        on_candle: Optional[Callable[[CandleFragment], Any]] = None,
    ) -> None:
        self.cdp_ws_url = cdp_ws_url
        self.on_tick = on_tick
        self.on_candle = on_candle
        self.parser = TradingViewPacketParser()
        self.connected = False
        self._stop = asyncio.Event()

    async def process_raw_frame(self, payload: str) -> tuple[int, int]:
        ticks, candles = self.parser.parse_payload(payload)
        for t in ticks:
            if self.on_tick:
                res = self.on_tick(t)
                if asyncio.iscoroutine(res):
                    await res
        for c in candles:
            if self.on_candle:
                res = self.on_candle(c)
                if asyncio.iscoroutine(res):
                    await res
        return len(ticks), len(candles)

    def stop(self) -> None:
        self._stop.set()
        self.connected = False
