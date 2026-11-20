"""SignalTrackerFSM: 7-state trade signal execution, trailing stop & automatic TP1 risk-free."""
from __future__ import annotations

from dataclasses import dataclass
from methods.risk_cost import validate_trade_guardrails


@dataclass(slots=True)
class TrackedSignal:
    signal_id: str
    direction: str
    entry: float
    stop_loss: float
    tp1: float
    tp2: float
    lot_size: float
    spread: float = 0.24
    state: str = "DETECTED"


class SignalTrackerFSM:
    """Enforces 7-state lifecycle: DETECTED -> PENDING_ENTRY -> OPEN -> BREAK_EVEN_ARMED -> RISK_FREE_TP1 -> CLOSED_TP2."""

    def arm_signal(self, signal: TrackedSignal, atr: float, news_gate: str) -> tuple[bool, str]:
        if news_gate == "LOCKOUT":
            signal.state = "EXPIRED_OR_VETOED"
            return False, "Signal vetoed by High-Impact USD News LOCKOUT window"
        guard = validate_trade_guardrails(signal.direction, signal.entry, signal.stop_loss, signal.tp1, signal.tp2, atr)
        if not guard.valid:
            signal.state = "EXPIRED_OR_VETOED"
            return False, "; ".join(guard.errors)
        if news_gate == "CAUTION":
            signal.lot_size = round(max(0.01, signal.lot_size * 0.5), 2)
        signal.state = "PENDING_ENTRY"
        return True, f"Armed PENDING_ENTRY (R:R {guard.rr_ratio:.2f})"

    def step(self, signal: TrackedSignal, price: float, news_gate: str = "CLEAR") -> str:
        is_long = signal.direction == "LONG"

        if signal.state == "PENDING_ENTRY":
            if news_gate == "LOCKOUT":
                signal.state = "EXPIRED_OR_VETOED"
                return signal.state
            filled = (is_long and price <= signal.entry) or (not is_long and price >= signal.entry)
            if filled:
                signal.state = "OPEN"
            return signal.state

        if signal.state in ("OPEN", "BREAK_EVEN_ARMED", "RISK_FREE_TP1"):
            stopped = (is_long and price <= signal.stop_loss) or (not is_long and price >= signal.stop_loss)
            if stopped:
                signal.state = "EXPIRED_OR_VETOED"
                return signal.state
            hit_tp2 = (is_long and price >= signal.tp2) or (not is_long and price <= signal.tp2)
            if hit_tp2:
                signal.state = "CLOSED_TP2"
                return signal.state
            hit_tp1 = (is_long and price >= signal.tp1) or (not is_long and price <= signal.tp1)
            if hit_tp1 and signal.state != "RISK_FREE_TP1":
                signal.state = "RISK_FREE_TP1"
                signal.stop_loss = round(signal.entry + signal.spread if is_long else signal.entry - signal.spread, 2)
                return signal.state
            halfway = signal.entry + (signal.tp1 - signal.entry) * 0.5
            if signal.state == "OPEN" and ((is_long and price >= halfway) or (not is_long and price <= halfway)):
                signal.state = "BREAK_EVEN_ARMED"
                return signal.state

        return signal.state
