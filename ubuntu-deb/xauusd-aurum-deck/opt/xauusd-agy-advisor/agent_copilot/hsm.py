"""Hierarchical Position State Machine (HSM) with 50% pre-defense & automatic TP1 risk-free SL."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class PositionState:
    position_id: str
    direction: str  # 'LONG' | 'SHORT'
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    lot_size: float
    spread: float = 0.24
    stage: str = "OPEN"  # OPEN -> BREAK_EVEN_ARMED -> RISK_FREE_TP1 -> CLOSED_TP2 | STOPPED_OUT
    realized_partial: bool = False


class HierarchicalPositionStateMachine:
    """Evaluates every tick against active position geometry for zero-emotion risk defense."""

    def on_tick(self, pos: PositionState, price: float, htf_flipped: bool = False) -> tuple[PositionState, str | None]:
        if pos.stage in ("CLOSED_TP2", "STOPPED_OUT"):
            return pos, None

        is_long = pos.direction == "LONG"

        # Stop-loss check
        if (is_long and price <= pos.stop_loss) or (not is_long and price >= pos.stop_loss):
            pos.stage = "STOPPED_OUT"
            return pos, "STOPPED_OUT"

        # TP2 full target check
        if (is_long and price >= pos.tp2) or (not is_long and price <= pos.tp2):
            pos.stage = "CLOSED_TP2"
            return pos, "CLOSED_TP2"

        # TP1 touch -> move stop to Entry + Spread (zero risk!)
        if pos.stage in ("OPEN", "BREAK_EVEN_ARMED"):
            hit_tp1 = (is_long and price >= pos.tp1) or (not is_long and price <= pos.tp1)
            if hit_tp1:
                pos.stage = "RISK_FREE_TP1"
                pos.stop_loss = round(pos.entry + pos.spread if is_long else pos.entry - pos.spread, 2)
                pos.realized_partial = True
                return pos, "RISK_FREE_TP1"

        # 50% progress toward TP1 -> arm Break-Even pre-defense
        if pos.stage == "OPEN":
            halfway = pos.entry + (pos.tp1 - pos.entry) * 0.50
            reached_half = (is_long and price >= halfway) or (not is_long and price <= halfway)
            if reached_half:
                pos.stage = "BREAK_EVEN_ARMED"
                return pos, "BREAK_EVEN_ARMED"

        # Higher timeframe structural flip defense
        if htf_flipped and pos.stage == "OPEN":
            pos.lot_size = round(max(0.01, pos.lot_size * 0.5), 2)
            pos.stage = "BREAK_EVEN_ARMED"
            return pos, "HTF_FLIP_DEFENSE"

        return pos, None
