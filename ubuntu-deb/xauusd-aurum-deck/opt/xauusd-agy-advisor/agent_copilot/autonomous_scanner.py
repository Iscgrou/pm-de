"""AutonomousAgentScanner: manages proposals, confirmed broker positions & Payam Brain scans."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from agent_copilot.hsm import PositionState
from methods.risk_cost import validate_trade_guardrails


@dataclass
class AgentProposalRecord:
    proposal_id: str
    direction: str
    setup_type: str
    timeframe: str
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    rr_ratio: float
    confidence: float
    confluence_score: int
    conviction_grade: str
    rationale_en: str
    rationale_fa: str
    status: str = "PROPOSED"  # PROPOSED | CONFIRMED | DISMISSED
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))


class AutonomousAgentScanner:
    """Stateful scanner coordinating Payam Brain proposals & user-confirmed broker positions."""

    def __init__(self, mode: str = "HYBRID") -> None:
        self.enabled: bool = False
        self.mode: str = mode
        self.proposals: list[AgentProposalRecord] = []
        self.confirmed_positions: dict[str, PositionState] = {}

    def register_proposal(
        self,
        direction: str,
        setup_type: str,
        timeframe: str,
        entry: float,
        stop_loss: float,
        tp1: float,
        tp2: float,
        atr: float,
        confluence_score: int = 75,
        conviction_grade: str = "A",
        rationale_en: str = "",
        rationale_fa: str = "",
    ) -> tuple[AgentProposalRecord | None, list[str]]:
        guard = validate_trade_guardrails(direction, entry, stop_loss, tp1, tp2, atr)
        if not guard.valid:
            return None, guard.errors

        pid = f"prop-{int(time.time() * 1000)}"
        rec = AgentProposalRecord(
            proposal_id=pid,
            direction=direction.upper(),
            setup_type=setup_type,
            timeframe=timeframe,
            entry=round(entry, 2),
            stop_loss=round(stop_loss, 2),
            tp1=round(tp1, 2),
            tp2=round(tp2, 2),
            rr_ratio=guard.rr_ratio,
            confidence=round(min(0.96, max(0.60, 0.55 + (confluence_score / 100.0) * 0.40)), 2),
            confluence_score=confluence_score,
            conviction_grade=conviction_grade,
            rationale_en=rationale_en,
            rationale_fa=rationale_fa,
        )
        self.proposals.insert(0, rec)
        self.proposals = self.proposals[:24]
        return rec, []

    def confirm_proposal(self, proposal_id: str, lot_size: float = 0.20, spread: float = 0.24) -> PositionState | None:
        target = next((p for p in self.proposals if p.proposal_id == proposal_id), None)
        if target is None:
            return None
        target.status = "CONFIRMED"
        pos_id = f"brk-{proposal_id}"
        pos = PositionState(
            position_id=pos_id,
            direction=target.direction,
            entry=target.entry,
            stop_loss=target.stop_loss,
            tp1=target.tp1,
            tp2=target.tp2,
            lot_size=round(max(0.01, lot_size), 2),
            spread=spread,
        )
        self.confirmed_positions[pos_id] = pos
        return pos

    def close_confirmed_position(self, position_id: str) -> bool:
        return self.confirmed_positions.pop(position_id, None) is not None

    def open_risk_usd(self) -> float:
        total = 0.0
        for p in self.confirmed_positions.values():
            if p.stage == "RISK_FREE_TP1":
                continue
            total += abs(p.entry - p.stop_loss) * p.lot_size * 100.0
        return round(total, 2)

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "proposals": [p.__dict__ for p in self.proposals],
            "confirmed_positions": [p.__dict__ for p in self.confirmed_positions.values()],
        }
