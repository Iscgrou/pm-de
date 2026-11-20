"""REST API endpoints for health, candles, positions, 14-source news hub, 7-breaker governance & MCP bridge."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_copilot.hsm import PositionState
from methods.risk_cost import validate_trade_guardrails
from .state import AppState


class OpenPositionRequest(BaseModel):
    direction: str
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    lot_size: float = 0.10


class SubmitAdvisoryRequest(BaseModel):
    job_id: str
    verdict: str
    confidence: float
    rationale_en: str
    rationale_fa: str


class RegisterProposalRequest(BaseModel):
    direction: str
    setup_type: str
    timeframe: str = "M15"
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    rationale_en: str = ""
    rationale_fa: str = ""
    confluence_score: int = 75
    conviction_grade: str = "A"


class KillSwitchRequest(BaseModel):
    engaged: bool
    reason: str = "Operator toggle"


def build_router(state: AppState) -> APIRouter:
    router = APIRouter()

    def _current_breakers() -> dict[str, Any]:
        cfg = state.risk_breaker.config
        news = state.news_assistant.evaluate_gate(
            high_pre_min=cfg.news_high_impact_pre_min,
            high_post_min=cfg.news_high_impact_post_min,
        )
        return state.risk_breaker.evaluate(
            open_positions_count=len(state.scanner.confirmed_positions),
            open_risk_usd=state.scanner.open_risk_usd(),
            spread=state.spread,
            news_veto=news.veto_new_entries,
            news_caution=(news.state == "CAUTION"),
            shock_headline=news.shock_headline if news.shock_override else None,
        )

    @router.get("/api/v1/health")
    async def health() -> dict:
        wd = state.orchestrator.watchdog.evaluate()
        cfg = state.risk_breaker.config
        news = state.news_assistant.evaluate_gate(
            high_pre_min=cfg.news_high_impact_pre_min,
            high_post_min=cfg.news_high_impact_post_min,
        )
        breakers = _current_breakers()
        return {
            "status": "nominal" if state.lag_monitor.is_healthy() else "degraded",
            "version": "2.0.0",
            "spot_price": state.spot_price,
            "spread": state.spread,
            "active_tier": wd.active_tier,
            "data_source": wd.source_name,
            "ttl_ms": wd.ttl_ms,
            "loop_lag_p99_ms": state.lag_monitor.p99_ms(),
            "ws_sequence_id": state.ws_hub.sequence_id,
            "news_gate": news.state,
            "kill_switch_engaged": cfg.kill_switch_engaged,
            "can_open_new_trades": breakers["can_open_new_trades"],
            "core_news_sources_count": len(state.news_assistant.aggregator.list_sources()),
        }

    @router.get("/api/v1/news/live")
    async def live_news(force: int = 0) -> dict:
        intel = await state.news_assistant.sync_live_feeds(force=bool(force))
        return {"ok": True, **intel}

    @router.get("/api/v1/news/sources")
    async def list_news_sources() -> dict:
        sources = state.news_assistant.aggregator.list_sources()
        return {"ok": True, "count": len(sources), "sources": sources}

    @router.get("/api/v1/agent/config")
    async def get_agent_config() -> dict:
        return {"ok": True, "config": asdict(state.risk_breaker.config)}

    @router.patch("/api/v1/agent/config")
    async def patch_agent_config(patch: dict[str, Any]) -> dict:
        state.risk_breaker.config.update(patch)
        state.risk_breaker.save_config()
        state.risk_breaker.record_audit("CONFIG", "INFO", "Agent Config Updated", f"Keys: {', '.join(patch.keys())}")
        return {"ok": True, "config": asdict(state.risk_breaker.config), "circuit_breakers": _current_breakers()}

    @router.post("/api/v1/agent/kill-switch")
    async def set_kill_switch(req: KillSwitchRequest) -> dict:
        cfg = state.risk_breaker.set_kill_switch(req.engaged, req.reason)
        if req.engaged:
            state.scanner.enabled = False
        state.ws_hub.broadcast("kill_switch", {"engaged": req.engaged, "reason": req.reason})
        return {"ok": True, "config": cfg, "circuit_breakers": _current_breakers()}

    @router.get("/api/v1/agent/circuit-breakers")
    async def get_circuit_breakers() -> dict:
        return {"ok": True, **_current_breakers()}

    @router.get("/api/v1/agent/audit")
    async def get_audit_log(limit: int = 30) -> dict:
        items = [asdict(e) for e in list(state.risk_breaker.audit_log)[: max(1, min(100, limit))]]
        return {"ok": True, "entries": items}

    @router.get("/api/candles")
    async def get_candles(tf: str = "15m", limit: int = 300) -> dict:
        tf_map = {"1m": "M1", "5m": "M5", "15m": "M15", "30m": "M30", "1h": "H1", "4h": "H4"}
        key = tf_map.get(tf.lower(), tf.upper())
        candles = state.orchestrator.candle_manager.get_recent(key, limit=limit)
        by_tf = {k: state.orchestrator.candle_manager.get_recent(k, 200) for k in ("M1", "M5", "M15", "M30", "H1", "H4")}
        quant = state.quant_engine.analyze(key, by_tf)
        return {
            "timeframe": key,
            "candles": [
                {
                    "time": c.open_time_ms // 1000,
                    "open": c.open,
                    "high": c.high,
                    "low": c.low,
                    "close": c.close,
                    "volume": c.volume,
                }
                for c in candles
            ],
            "smc": quant.to_dict(),
        }

    @router.post("/api/v1/position/open")
    async def open_position(req: OpenPositionRequest) -> dict:
        breakers = _current_breakers()
        if not breakers["can_open_new_trades"]:
            raise HTTPException(
                status_code=409,
                detail=f"Entry blocked by Risk Circuit Breaker: {', '.join(breakers['active_breakers'])}",
            )

        m15 = state.orchestrator.candle_manager.get_recent("M15", 60)
        by_tf = {"M15": m15}
        atr = state.quant_engine.analyze("M15", by_tf).regime.atr
        guard = validate_trade_guardrails(req.direction, req.entry, req.stop_loss, req.tp1, req.tp2, atr)
        if not guard.valid:
            raise HTTPException(status_code=422, detail=guard.errors)

        lot = round(max(0.01, req.lot_size * breakers["effective_risk_multiplier"]), 2)
        pos = PositionState(
            position_id="pos-live-1",
            direction=req.direction.upper(),
            entry=req.entry,
            stop_loss=req.stop_loss,
            tp1=req.tp1,
            tp2=req.tp2,
            lot_size=lot,
            spread=state.spread,
        )
        state.active_position = pos
        state.risk_breaker.record_audit("EXECUTION", "INFO", f"Opened {pos.direction} {lot} lot", f"Entry {pos.entry} SL {pos.stop_loss} TP1 {pos.tp1}")
        state.ws_hub.broadcast("position_update", {"stage": pos.stage, "entry": pos.entry, "sl": pos.stop_loss})
        return {"ok": True, "rr_ratio": guard.rr_ratio, "lot_size": lot, "stage": pos.stage}

    @router.get("/api/v1/agent/poll-jobs")
    async def poll_jobs() -> dict:
        return {"jobs": state.pending_jobs}

    @router.post("/api/v1/agent/submit-advisory")
    async def submit_advisory(req: SubmitAdvisoryRequest) -> dict:
        payload = req.model_dump()
        state.last_advisory = payload
        state.pending_jobs = [j for j in state.pending_jobs if j.get("job_id") != req.job_id]
        state.ws_hub.broadcast("advisory_update", payload)
        return {"ok": True, "advisory": payload}

    @router.post("/api/v1/agent/toggle")
    async def toggle_agent(enabled: bool) -> dict:
        if enabled and state.risk_breaker.config.kill_switch_engaged:
            raise HTTPException(status_code=409, detail="Disarm Emergency Kill Switch before enabling autonomous scans.")
        state.scanner.enabled = enabled
        state.ws_hub.broadcast("agent_status", {"enabled": enabled, "mode": state.scanner.mode})
        return {"ok": True, "enabled": state.scanner.enabled, "mode": state.scanner.mode}

    @router.get("/api/v1/agent/proposals")
    async def list_proposals() -> dict:
        return {
            "enabled": state.scanner.enabled,
            "mode": state.scanner.mode,
            "proposals": [p.__dict__ for p in state.scanner.proposals],
            "confirmed_positions": [
                {
                    "position_id": p.position_id,
                    "direction": p.direction,
                    "entry": p.entry,
                    "stop_loss": p.stop_loss,
                    "tp1": p.tp1,
                    "tp2": p.tp2,
                    "lot_size": p.lot_size,
                    "stage": p.stage,
                }
                for p in state.scanner.confirmed_positions.values()
            ],
        }

    @router.post("/api/v1/agent/proposals")
    async def register_proposal(req: RegisterProposalRequest) -> dict:
        breakers = _current_breakers()
        if not breakers["can_open_new_trades"]:
            raise HTTPException(status_code=409, detail=f"Proposal blocked: {', '.join(breakers['active_breakers'])}")
        m15 = state.orchestrator.candle_manager.get_recent("M15", 60)
        atr = state.quant_engine.analyze("M15", {"M15": m15}).regime.atr
        rec, errors = state.scanner.register_proposal(
            direction=req.direction,
            setup_type=req.setup_type,
            timeframe=req.timeframe,
            entry=req.entry,
            stop_loss=req.stop_loss,
            tp1=req.tp1,
            tp2=req.tp2,
            atr=atr,
            confluence_score=req.confluence_score,
            conviction_grade=req.conviction_grade,
            rationale_en=req.rationale_en,
            rationale_fa=req.rationale_fa,
        )
        if rec is None:
            raise HTTPException(status_code=422, detail=errors)
        state.risk_breaker.record_audit("PROPOSAL", "INFO", f"MCP Proposal {rec.direction} [{rec.conviction_grade}]", f"{rec.setup_type} @ {rec.entry}")
        state.ws_hub.broadcast("proposal_created", rec.__dict__)
        return {"ok": True, "proposal": rec.__dict__}

    @router.post("/api/v1/positions/confirm/{proposal_id}")
    async def confirm_proposal(proposal_id: str, lot_size: float = 0.20) -> dict:
        breakers = _current_breakers()
        if not breakers["can_open_new_trades"]:
            raise HTTPException(status_code=409, detail=f"Confirmation blocked: {', '.join(breakers['active_breakers'])}")
        effective_lot = round(max(0.01, lot_size * breakers["effective_risk_multiplier"]), 2)
        pos = state.scanner.confirm_proposal(proposal_id, lot_size=effective_lot, spread=state.spread)
        if pos is None:
            raise HTTPException(status_code=404, detail="Proposal not found")
        state.risk_breaker.record_audit("EXECUTION", "INFO", f"Confirmed {pos.direction} {pos.lot_size} lot", f"ID {pos.position_id} @ {pos.entry}")
        state.ws_hub.broadcast("position_confirmed", {"position_id": pos.position_id, "direction": pos.direction})
        return {"ok": True, "position_id": pos.position_id, "stage": pos.stage, "lot_size": pos.lot_size}

    @router.post("/api/v1/positions/close/{position_id}")
    async def close_confirmed_position(position_id: str) -> dict:
        removed = state.scanner.close_confirmed_position(position_id)
        if not removed:
            raise HTTPException(status_code=404, detail="Confirmed position not found")
        state.ws_hub.broadcast("position_closed", {"position_id": position_id})
        return {"ok": True, "position_id": position_id}

    return router
