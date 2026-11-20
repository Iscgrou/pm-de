"""Core 14-Source Authoritative Gold (XAU/USD) News, Central Bank RSS & ForexFactory Aggregator."""
from __future__ import annotations

import asyncio
import html
import re
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx


@dataclass
class CoreNewsSource:
    id: str
    name: str
    short_name: str
    tier: str  # CENTRAL_BANK | MACRO_AGENCY | CALENDAR_WIRE | METALS_INSTITUTIONAL
    url: str
    feed_url: str | None
    feed_type: str  # RSS | JSON_CALENDAR | PORTAL
    impact_weight: int
    focus: str
    status: str = "REFERENCE"  # ONLINE | CACHED | REFERENCE | OFFLINE
    last_fetched_ms: int = 0
    headline_count: int = 0


@dataclass
class ScoredHeadline:
    id: str
    source_id: str
    source_name: str
    tier: str
    title: str
    link: str
    published_at_ms: int
    gold_bias: str  # BULLISH_GOLD | BEARISH_GOLD | NEUTRAL
    impact_score: int
    is_emergency_shock: bool
    matched_drivers: list[str] = field(default_factory=list)


CORE_GOLD_NEWS_SOURCES: list[CoreNewsSource] = [
    CoreNewsSource(
        id="us-fed-press",
        name="Federal Reserve Board — All Press Releases",
        short_name="US Federal Reserve",
        tier="CENTRAL_BANK",
        url="https://www.federalreserve.gov/newsevents/pressreleases.htm",
        feed_url="https://www.federalreserve.gov/feeds/press_all.xml",
        feed_type="RSS",
        impact_weight=10,
        focus="FOMC Rate Decisions, Powell Statements, Balance Sheet & Liquidity",
    ),
    CoreNewsSource(
        id="us-fed-monetary",
        name="Federal Reserve — Monetary Policy & H.15 Rates",
        short_name="Fed Monetary",
        tier="CENTRAL_BANK",
        url="https://www.federalreserve.gov/monetarypolicy.htm",
        feed_url="https://www.federalreserve.gov/feeds/monetary.xml",
        feed_type="RSS",
        impact_weight=10,
        focus="FOMC Minutes, Dot Plot, Real Rate Path & Fed Funds Guidance",
    ),
    CoreNewsSource(
        id="us-bls",
        name="U.S. Bureau of Labor Statistics (CPI / NFP / PPI)",
        short_name="US BLS (CPI/NFP)",
        tier="MACRO_AGENCY",
        url="https://www.bls.gov/news.release/",
        feed_url="https://www.bls.gov/feed/bls_latest.rss",
        feed_type="RSS",
        impact_weight=10,
        focus="Consumer Price Index (CPI), Non-Farm Payrolls (NFP), Unemployment & PPI",
    ),
    CoreNewsSource(
        id="us-bea",
        name="U.S. Bureau of Economic Analysis (Core PCE / GDP)",
        short_name="US BEA (PCE/GDP)",
        tier="MACRO_AGENCY",
        url="https://www.bea.gov/news/current-releases",
        feed_url="https://www.bea.gov/rss/news_release.xml",
        feed_type="RSS",
        impact_weight=10,
        focus="Fed Preferred Core PCE Inflation & Quarterly US GDP Revisions",
    ),
    CoreNewsSource(
        id="ecb-press",
        name="European Central Bank (ECB)",
        short_name="ECB Press",
        tier="CENTRAL_BANK",
        url="https://www.ecb.europa.eu/press/html/index.en.html",
        feed_url="https://www.ecb.europa.eu/rss/press.html",
        feed_type="RSS",
        impact_weight=9,
        focus="EUR/USD DXY Basket Weight (57.6%), Lagarde Speeches & Rate Decisions",
    ),
    CoreNewsSource(
        id="boe-news",
        name="Bank of England (BoE)",
        short_name="Bank of England",
        tier="CENTRAL_BANK",
        url="https://www.bankofengland.co.uk/news",
        feed_url="https://www.bankofengland.co.uk/rss/news",
        feed_type="RSS",
        impact_weight=8,
        focus="London Bullion Session Liquidity, GBP/DXY Spillover & MPC Votes",
    ),
    CoreNewsSource(
        id="forexfactory-cal",
        name="Forex Factory / Fair Economy Economic Calendar",
        short_name="Forex Factory",
        tier="CALENDAR_WIRE",
        url="https://www.forexfactory.com/calendar",
        feed_url="https://nfs.faireconomy.media/ff_calendar_thisweek.json",
        feed_type="JSON_CALENDAR",
        impact_weight=10,
        focus="Live Red/Orange Folder USD Releases (NFP, CPI, FOMC, Jobless Claims)",
    ),
    CoreNewsSource(
        id="fxstreet-wire",
        name="FXStreet — Real-Time XAU/USD & Macro Wire",
        short_name="FXStreet Gold",
        tier="CALENDAR_WIRE",
        url="https://www.fxstreet.com/news?q=gold",
        feed_url="https://www.fxstreet.com/rss",
        feed_type="RSS",
        impact_weight=9,
        focus="Breaking XAU/USD Order Flow, DXY Yield Reaction & Central Bank Alerts",
    ),
    CoreNewsSource(
        id="kitco-gold",
        name="Kitco News — Precious Metals & Gold Authority",
        short_name="Kitco News",
        tier="METALS_INSTITUTIONAL",
        url="https://www.kitco.com/news/gold",
        feed_url="https://www.kitco.com/rss/news",
        feed_type="RSS",
        impact_weight=9,
        focus="Spot Gold Flows, COMEX Positioning, Mining & Institutional Gold Desk Commentary",
    ),
    CoreNewsSource(
        id="cnbc-commodities",
        name="CNBC Commodities & Macro Markets",
        short_name="CNBC Metals",
        tier="METALS_INSTITUTIONAL",
        url="https://www.cnbc.com/commodities/",
        feed_url="https://www.cnbc.com/id/15839069/device/rss/rss.html",
        feed_type="RSS",
        impact_weight=8,
        focus="US Treasury Yields, Oil-Inflation Link, Geopolitical Risk & Safe-Haven Flows",
    ),
    CoreNewsSource(
        id="marketwatch-pulse",
        name="MarketWatch — Real-Time Market Pulse",
        short_name="MarketWatch",
        tier="CALENDAR_WIRE",
        url="https://www.marketwatch.com/latest-news",
        feed_url="https://feeds.marketwatch.com/marketwatch/marketpulse/",
        feed_type="RSS",
        impact_weight=8,
        focus="Breaking US Yield Spikes, Equity Risk-Off Shocks & Dollar Moves",
    ),
    CoreNewsSource(
        id="cme-fedwatch",
        name="CME Group — FedWatch Rate Probability Monitor",
        short_name="CME FedWatch",
        tier="CENTRAL_BANK",
        url="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
        feed_url=None,
        feed_type="PORTAL",
        impact_weight=10,
        focus="Fed Funds Futures Implied Rate Cut/Hike Odds Driving Real Yields & Gold",
    ),
    CoreNewsSource(
        id="world-gold-council",
        name="World Gold Council (GoldHub)",
        short_name="World Gold Council",
        tier="METALS_INSTITUTIONAL",
        url="https://www.gold.org/goldhub/research",
        feed_url=None,
        feed_type="PORTAL",
        impact_weight=9,
        focus="Central Bank Physical Gold Reserves, Global ETF Flows & Sovereign Demand",
    ),
    CoreNewsSource(
        id="investing-reuters-macro",
        name="Investing.com / Reuters Commodities & InvestingLive",
        short_name="Investing / Reuters",
        tier="CALENDAR_WIRE",
        url="https://www.investing.com/economic-calendar/",
        feed_url=None,
        feed_type="PORTAL",
        impact_weight=9,
        focus="Global Geopolitical Breaking Wires, Sovereign Bond Yields & Live Tick Catalysts",
    ),
]

BULLISH_PATTERNS = [
    (re.compile(r"\b(rate cut|cuts rates|cutting rates|dovish|pivot|easing)\b", re.I), 28, "Dovish / Rate Cut"),
    (re.compile(r"\b(gold (surges|rallies|jumps|hits record|all-time high|climbs|gains)|bullion (rallies|jumps))\b", re.I), 22, "Gold Momentum"),
    (re.compile(r"\b(safe[- ]?haven|flight to safety|geopolitical|missile|airstrike|war escalat|middle east|tariff shock)\b", re.I), 26, "Safe-Haven / Geopolitics"),
    (re.compile(r"\b(yields? (fall|drop|plunge|slide|tumble)|dollar (falls|drops|weakens|slides)|dxy (falls|drops))\b", re.I), 20, "Yields / DXY Weak"),
    (re.compile(r"\b(central bank(s)? buy|gold reserves|pboc gold|etf inflows|stagflation|recession fears?)\b", re.I), 22, "Sovereign / Macro Bid"),
    (re.compile(r"\b(cpi (cools|slows|misses|below)|pce (cools|slows)|unemployment rises|jobless claims (surge|jump|rise))\b", re.I), 24, "Soft US Data"),
]

BEARISH_PATTERNS = [
    (re.compile(r"\b(rate hike|hikes rates|hawkish|higher for longer|tightening)\b", re.I), 28, "Hawkish / Rate Hike"),
    (re.compile(r"\b(gold (drops|falls|slumps|slides|tumbles|retreats|sells off)|bullion (falls|slumps))\b", re.I), 22, "Gold Sell-Off"),
    (re.compile(r"\b(yields? (surge|jump|spike|climb|rise)|dollar (surges|rallies|strengthens|jumps)|dxy (surges|rallies))\b", re.I), 20, "Yields / DXY Surge"),
    (re.compile(r"\b(hotter[- ]than[- ]expected|cpi (beats|hot|jumps|surges)|nfp (beats|surges|blowout)|strong payrolls|retail sales beat)\b", re.I), 24, "Hot US Data"),
    (re.compile(r"\b(ceasefire|peace deal|de-escalation|truce reached|risk[- ]on rally)\b", re.I), 20, "Geopolitical De-escalation"),
]

GOLD_RELEVANCE_RE = re.compile(
    r"\b(gold|xau|bullion|fed|fomc|powell|cpi|pce|nfp|payroll|inflation|treasury|yield|dollar|dxy|ecb|lagarde|boe|central bank|recession|tariff|geopolitical|missile|war|oil|metal|commodity|commodities|interest rate|gdp|jobless|ppi)\b",
    re.I,
)
EMERGENCY_SHOCK_RE = re.compile(
    r"\b(emergency rate|unscheduled (fed|fomc)|nuclear strike|missile strike|war declared|invasion begins|bank collapse|bank failure|flash crash|trading halted|sovereign default)\b",
    re.I,
)


def score_gold_headline(
    title: str,
    link: str,
    published_at_ms: int,
    source: CoreNewsSource,
    idx: int = 0,
) -> ScoredHeadline:
    bull_pts = 0
    bear_pts = 0
    drivers: list[str] = []

    for rx, weight, label in BULLISH_PATTERNS:
        if rx.search(title):
            bull_pts += weight
            drivers.append(f"+{label}")
    for rx, weight, label in BEARISH_PATTERNS:
        if rx.search(title):
            bear_pts += weight
            drivers.append(f"-{label}")

    is_shock = bool(EMERGENCY_SHOCK_RE.search(title))
    if is_shock:
        bull_pts += 35
        drivers.insert(0, "EMERGENCY SHOCK")

    net = bull_pts - bear_pts
    bias = "BULLISH_GOLD" if net >= 12 else "BEARISH_GOLD" if net <= -12 else "NEUTRAL"
    impact = min(100, int(source.impact_weight * 5 + min(45, bull_pts + bear_pts) + (20 if is_shock else 0)))

    return ScoredHeadline(
        id=f"news-{source.id}-{published_at_ms}-{idx}",
        source_id=source.id,
        source_name=source.short_name,
        tier=source.tier,
        title=title,
        link=link or source.url,
        published_at_ms=published_at_ms,
        gold_bias=bias,
        impact_score=impact,
        is_emergency_shock=is_shock,
        matched_drivers=drivers[:3],
    )


def _parse_pub_date(raw: str | None, fallback_ms: int) -> int:
    if not raw:
        return fallback_ms
    raw = raw.strip()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return fallback_ms


def parse_rss_xml(xml_text: str, source: CoreNewsSource, max_items: int = 6) -> list[ScoredHeadline]:
    now_ms = int(time.time() * 1000)
    out: list[ScoredHeadline] = []
    if not xml_text or len(xml_text) < 40:
        return out
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return out

    direct_macro = source.tier in ("CENTRAL_BANK", "MACRO_AGENCY")
    idx = 0
    for elem in root.iter():
        tag = elem.tag.split("}")[-1].lower()
        if tag not in ("item", "entry"):
            continue
        title = ""
        link = source.url
        pub_raw = None
        for child in elem:
            ctag = child.tag.split("}")[-1].lower()
            if ctag == "title" and child.text:
                title = html.unescape(re.sub(r"<[^>]+>", " ", child.text)).strip()
            elif ctag == "link":
                href = child.attrib.get("href")
                if href:
                    link = href.strip()
                elif child.text:
                    link = child.text.strip()
            elif ctag in ("pubdate", "published", "updated", "date") and child.text:
                pub_raw = child.text.strip()
        if len(title) < 10:
            continue
        if not direct_macro and not GOLD_RELEVANCE_RE.search(title):
            continue
        ts_ms = _parse_pub_date(pub_raw, now_ms - idx * 600_000)
        out.append(score_gold_headline(title, link, ts_ms, source, idx))
        idx += 1
        if len(out) >= max_items:
            break
    return out


class CoreNewsAggregator:
    """Async multi-source news & ForexFactory calendar aggregator with 60s cache."""

    def __init__(self, cache_ttl_sec: float = 60.0) -> None:
        self.cache_ttl_sec = cache_ttl_sec
        self._last_sync_ts: float = 0.0
        self._cached_snapshot: dict[str, Any] | None = None

    def list_sources(self) -> list[dict[str, Any]]:
        return [asdict(s) for s in CORE_GOLD_NEWS_SOURCES]

    async def sync(self, force: bool = False) -> dict[str, Any]:
        now_sec = time.time()
        if not force and self._cached_snapshot and (now_sec - self._last_sync_ts) < self.cache_ttl_sec:
            return self._cached_snapshot

        now_ms = int(now_sec * 1000)
        sources = [CoreNewsSource(**asdict(s)) for s in CORE_GOLD_NEWS_SOURCES]
        headlines: list[ScoredHeadline] = []
        calendar_events: list[dict[str, Any]] = []
        calendar_source = "LOCAL_SCHEDULE"

        headers = {"User-Agent": "Mozilla/5.0 (compatible; PayamXAUUSD/2.0; +https://payam.desk)"}
        async with httpx.AsyncClient(timeout=3.0, follow_redirects=True, headers=headers) as client:
            async def _fetch_one(src: CoreNewsSource) -> None:
                nonlocal calendar_source
                if not src.feed_url or src.feed_type == "PORTAL":
                    src.status = "REFERENCE"
                    return
                try:
                    resp = await client.get(src.feed_url)
                    resp.raise_for_status()
                    if src.feed_type == "JSON_CALENDAR":
                        rows = resp.json()
                        if isinstance(rows, list):
                            for i, row in enumerate(rows):
                                if str(row.get("country", "")).upper() != "USD":
                                    continue
                                imp = str(row.get("impact", "")).upper()
                                if imp not in ("HIGH", "MEDIUM"):
                                    continue
                                ts_ms = _parse_pub_date(str(row.get("date", "")), 0)
                                if ts_ms == 0 or ts_ms < now_ms - 7_200_000 or ts_ms > now_ms + 259_200_000:
                                    continue
                                calendar_events.append({
                                    "id": f"ff-{i}-{ts_ms}",
                                    "title": str(row.get("title", "USD Macro Release")),
                                    "currency": "USD",
                                    "impact": imp,
                                    "scheduled_at_ms": ts_ms,
                                    "forecast": str(row.get("forecast") or "—"),
                                    "previous": str(row.get("previous") or "—"),
                                })
                            calendar_events.sort(key=lambda e: e["scheduled_at_ms"])
                            if calendar_events:
                                calendar_source = "FOREX_FACTORY_LIVE"
                            src.status = "ONLINE"
                            src.last_fetched_ms = now_ms
                            src.headline_count = len(calendar_events)
                    else:
                        parsed = parse_rss_xml(resp.text, src, max_items=6)
                        headlines.extend(parsed)
                        src.status = "ONLINE"
                        src.last_fetched_ms = now_ms
                        src.headline_count = len(parsed)
                except Exception:
                    src.status = "OFFLINE"
                    src.headline_count = 0

            await asyncio.gather(*(_fetch_one(s) for s in sources))

        headlines.sort(key=lambda h: (not h.is_emergency_shock, -h.published_at_ms))
        headlines = headlines[:24]

        shock_item = next(
            (h for h in headlines if h.is_emergency_shock and abs(now_ms - h.published_at_ms) <= 21_600_000),
            None,
        )
        w_sum = 0
        w_tot = 0
        for h in headlines[:14]:
            d = 1 if h.gold_bias == "BULLISH_GOLD" else -1 if h.gold_bias == "BEARISH_GOLD" else 0
            w = max(10, h.impact_score)
            w_sum += d * w
            w_tot += w
        sentiment_score = max(-100, min(100, int(round((w_sum / w_tot) * 100)))) if w_tot > 0 else 0
        macro_sentiment = (
            "GEOPOLITICAL_SHOCK"
            if shock_item
            else "BULLISH_GOLD"
            if sentiment_score >= 18
            else "BEARISH_GOLD"
            if sentiment_score <= -18
            else "NEUTRAL"
        )

        snapshot = {
            "fetched_at_ms": now_ms,
            "live_source_count": sum(1 for s in sources if s.status in ("ONLINE", "CACHED")),
            "total_source_count": len(sources),
            "calendar_source": calendar_source,
            "macro_sentiment": macro_sentiment,
            "sentiment_score": sentiment_score,
            "shock_detected": shock_item is not None,
            "shock_headline": shock_item.title if shock_item else None,
            "headlines": [asdict(h) for h in headlines],
            "sources": [asdict(s) for s in sources],
            "calendar_events": calendar_events[:12],
        }
        self._cached_snapshot = snapshot
        self._last_sync_ts = now_sec
        return snapshot
