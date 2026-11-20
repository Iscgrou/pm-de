"""FastMCP Server exposing 10 Institutional XAUUSD Tools to Antigravity / AI Clients."""
from __future__ import annotations

import os
from typing import Any

import httpx

try:
    from mcp.server.fastmcp import FastMCP
except ImportError:  # pragma: no cover - lightweight fallback when mcp not installed
    class FastMCP:  # type: ignore
        def __init__(self, name: str) -> None:
            self.name = name
            self.tools: dict[str, Any] = {}

        def tool(self):
            def decorator(fn):
                self.tools[fn.__name__] = fn
                return fn
            return decorator

        def run(self) -> None:
            raise RuntimeError("Install 'mcp' package to run stdio FastMCP server.")


from methods.risk_cost import validate_trade_guardrails

SENTINEL_URL = os.getenv("XAUUSD_SENTINEL_URL", "http://127.0.0.1:8787")
mcp = FastMCP("Payam XAUUSD Institutional Brain & Governance MCP")


@mcp.tool()
def get_live_smc_context(timeframe: str = "15m", limit: int = 120) -> dict[str, Any]:
    """[READ-ONLY] Fetch real-time XAUUSD candles, FVG/OB/Structure, Wilder RSI(14) & TPI matrix."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/candles", params={"tf": timeframe, "limit": limit})
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def get_payam_brain_confluence(timeframe: str = "15m") -> dict[str, Any]:
    """[READ-ONLY] Retrieve the 6-Pillar 100-Point Payam Brain v3 score, 4H Compass & 7-Gate Defense Shield."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/candles", params={"tf": timeframe, "limit": 120})
        resp.raise_for_status()
        payload = resp.json()
        return {
            "timeframe": payload.get("timeframe"),
            "brain": payload.get("smc", {}).get("brain"),
            "rsi": payload.get("smc", {}).get("rsi"),
            "regime": payload.get("smc", {}).get("regime"),
        }


@mcp.tool()
def fetch_core_gold_news_and_sentiment(force_refresh: bool = False) -> dict[str, Any]:
    """[READ-ONLY] Poll all 14 Core Gold-Moving Websites (Fed, BLS, BEA, ECB, BoE, ForexFactory, FXStreet, Kitco, CNBC, MarketWatch)."""
    with httpx.Client(timeout=8.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/v1/news/live", params={"force": "1" if force_refresh else "0"})
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def check_risk_circuit_breakers() -> dict[str, Any]:
    """[READ-ONLY] Inspect all 7 Deterministic Risk Circuit Breakers (Kill Switch, Daily DD, Loss Cooldown, Heat, Spread, News Shock)."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/v1/agent/circuit-breakers")
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def calculate_position_size(
    account_equity_usd: float,
    risk_percent: float,
    entry: float,
    stop_loss: float,
    risk_multiplier: float = 1.0,
) -> dict[str, Any]:
    """[READ-ONLY] Compute exact institutional XAU/USD lot size (1.00 lot = 100 oz, $1 move = $100/lot)."""
    stop_dist = abs(entry - stop_loss)
    if stop_dist <= 0.1 or account_equity_usd <= 0 or risk_percent <= 0:
        return {"valid": False, "error": "Invalid equity, risk_percent, or stop distance."}
    effective_risk_usd = account_equity_usd * (min(5.0, risk_percent) / 100.0) * max(0.0, min(1.0, risk_multiplier))
    raw_lots = effective_risk_usd / (stop_dist * 100.0)
    lots = max(0.01, round(raw_lots, 2))
    return {
        "valid": True,
        "recommended_lots": lots,
        "risk_usd": round(lots * stop_dist * 100.0, 2),
        "stop_distance_usd": round(stop_dist, 2),
        "effective_risk_multiplier": risk_multiplier,
    }


@mcp.tool()
def validate_and_render_visual_smc_setup(
    direction: str,
    entry: float,
    stop_loss: float,
    tp1: float,
    tp2: float,
    atr: float = 3.5,
) -> dict[str, Any]:
    """[GATED] Enforce non-bypassable geometry, R:R >= 1.50 and 0.25*ATR stop floor before presenting a setup."""
    guard = validate_trade_guardrails(direction, entry, stop_loss, tp1, tp2, atr)
    return {
        "valid": guard.valid,
        "rr_ratio": guard.rr_ratio,
        "stop_distance": guard.stop_distance,
        "min_stop_required": guard.min_stop_required,
        "errors": guard.errors,
    }


@mcp.tool()
def propose_institutional_trade(
    direction: str,
    setup_type: str,
    timeframe: str,
    entry: float,
    stop_loss: float,
    tp1: float,
    tp2: float,
    rationale_en: str,
    rationale_fa: str,
    confluence_score: int = 75,
    conviction_grade: str = "A",
) -> dict[str, Any]:
    """[GATED] Submit a guardrail-verified & circuit-breaker-checked trade proposal to the Aurum Deck queue."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.post(
            f"{SENTINEL_URL}/api/v1/agent/proposals",
            json={
                "direction": direction,
                "setup_type": setup_type,
                "timeframe": timeframe,
                "entry": entry,
                "stop_loss": stop_loss,
                "tp1": tp1,
                "tp2": tp2,
                "rationale_en": rationale_en,
                "rationale_fa": rationale_fa,
                "confluence_score": confluence_score,
                "conviction_grade": conviction_grade,
            },
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def trigger_emergency_kill_switch(engaged: bool, reason: str = "MCP Safety Halt") -> dict[str, Any]:
    """[SAFETY] Engage or disarm the Out-of-Band Emergency Kill Switch on the Sentinel Hub."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.post(
            f"{SENTINEL_URL}/api/v1/agent/kill-switch",
            json={"engaged": engaged, "reason": reason},
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def poll_pending_intelligence_jobs() -> dict[str, Any]:
    """[READ-ONLY] Poll System 2 reasoning jobs enqueued by HSM transitions or News Lockout."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/v1/agent/poll-jobs")
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def submit_system2_advisory(
    job_id: str,
    verdict: str,
    confidence: float,
    rationale_en: str,
    rationale_fa: str,
) -> dict[str, Any]:
    """[GATED] Submit grounded English & Persian System 2 advisory to Sentinel Hub."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.post(
            f"{SENTINEL_URL}/api/v1/agent/submit-advisory",
            json={
                "job_id": job_id,
                "verdict": verdict,
                "confidence": confidence,
                "rationale_en": rationale_en,
                "rationale_fa": rationale_fa,
            },
        )
        resp.raise_for_status()
        return resp.json()


@mcp.tool()
def get_agent_audit_log(limit: int = 30) -> dict[str, Any]:
    """[READ-ONLY] Retrieve immutable timestamped audit log of agent scans, proposals, and circuit-breaker trips."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{SENTINEL_URL}/api/v1/agent/audit", params={"limit": limit})
        resp.raise_for_status()
        return resp.json()


if __name__ == "__main__":
    mcp.run()
