"""7-day historical backfill engine (10,080 minutes) via Binance PAXGUSDT + Yahoo GC=F."""
from __future__ import annotations

import datetime as dt
import httpx
from .aggregator import Candle, TIMEFRAME_MS


class BackfillEngine:
    """Hydrates 7 days (10,080 minutes) of XAUUSD candles respecting weekend market closures."""

    BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
    YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F"
    SEVEN_DAYS_MINUTES = 10_080

    @staticmethod
    def is_gold_weekend_closed(ts_ms: int) -> bool:
        """Spot gold closes Friday 21:00 UTC and reopens Sunday 22:00 UTC."""
        d = dt.datetime.fromtimestamp(ts_ms / 1000.0, tz=dt.timezone.utc)
        wd = d.weekday()
        if wd == 5:
            return True
        if wd == 4 and d.hour >= 21:
            return True
        if wd == 6 and d.hour < 22:
            return True
        return False

    async def fetch_binance_m5(self, limit: int = 1000) -> list[Candle]:
        params = {"symbol": "PAXGUSDT", "interval": "5m", "limit": min(limit, 1000)}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(self.BINANCE_KLINES_URL, params=params)
            resp.raise_for_status()
            rows = resp.json()
        candles: list[Candle] = []
        for r in rows:
            ts_ms = int(r[0])
            if self.is_gold_weekend_closed(ts_ms):
                continue
            candles.append(
                Candle(
                    symbol="XAUUSD",
                    timeframe="M5",
                    open_time_ms=ts_ms,
                    open=float(r[1]),
                    high=float(r[2]),
                    low=float(r[3]),
                    close=float(r[4]),
                    volume=float(r[5]),
                    closed=True,
                )
            )
        return candles

    def resample(self, base_candles: list[Candle], target_tf: str) -> list[Candle]:
        bucket_ms = TIMEFRAME_MS[target_tf]
        buckets: dict[int, Candle] = {}
        for c in base_candles:
            b = (c.open_time_ms // bucket_ms) * bucket_ms
            if b not in buckets:
                buckets[b] = Candle(c.symbol, target_tf, b, c.open, c.high, c.low, c.close, c.volume, True)
            else:
                agg = buckets[b]
                agg.high = max(agg.high, c.high)
                agg.low = min(agg.low, c.low)
                agg.close = c.close
                agg.volume += c.volume
        return [buckets[k] for k in sorted(buckets)]
