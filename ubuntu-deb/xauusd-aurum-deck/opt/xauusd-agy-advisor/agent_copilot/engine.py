"""PositionCopilotEngine: combines HSM, HysteresisGate, MtfAnalyzer & ReasonerBridge."""
from __future__ import annotations

from .hsm import HierarchicalPositionStateMachine, PositionState
from .hysteresis_gate import HysteresisGate
from .memory import EpisodicMemoryManager
from .mtf_analyzer import MtfHealthAnalyzer
from .agy_reasoner_bridge import AntigravityReasonerBridge, DeterministicFactLedger
from methods.engine import QuantSnapshot


class PositionCopilotEngine:
    def __init__(self) -> None:
        self.hsm = HierarchicalPositionStateMachine()
        self.hysteresis = HysteresisGate()
        self.memory = EpisodicMemoryManager()
        self.mtf = MtfHealthAnalyzer()
        self.bridge = AntigravityReasonerBridge()

    def process_tick(
        self,
        position: PositionState | None,
        spot_price: float,
        spread: float,
        quant: QuantSnapshot,
        news_gate: str,
    ) -> tuple[PositionState | None, str | None, DeterministicFactLedger | None]:
        mtf_report = self.mtf.evaluate(quant.tpi)
        event: str | None = None
        if position is not None:
            htf_flip = (position.direction == "LONG" and mtf_report.htf_bias == "BEARISH") or (
                position.direction == "SHORT" and mtf_report.htf_bias == "BULLISH"
            )
            position, event = self.hsm.on_tick(position, spot_price, htf_flipped=htf_flip)

        ledger: DeterministicFactLedger | None = None
        if event in ("BREAK_EVEN_ARMED", "RISK_FREE_TP1", "HTF_FLIP_DEFENSE") or news_gate == "LOCKOUT":
            key_levels = [f.ce_50 for f in quant.fvgs] + [o.mt_50 for o in quant.order_blocks]
            if position:
                key_levels.extend([position.entry, position.stop_loss, position.tp1, position.tp2])
            ledger = self.bridge.build_fact_ledger(
                trigger_reason=event or f"NEWS_{news_gate}",
                spot_price=spot_price,
                spread=spread,
                atr=quant.regime.atr,
                regime=quant.regime.label,
                tpi_composite=quant.tpi.composite_score,
                news_gate=news_gate,
                key_levels=key_levels,
            )
        return position, event, ledger
