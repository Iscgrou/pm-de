"""Institutional compatibility shim unifying QuantitativeMethodEngine & strict guardrails."""
from __future__ import annotations

from data_pipeline.aggregator import Candle
from methods.engine import QuantitativeMethodEngine, QuantSnapshot
from methods.risk_cost import validate_trade_guardrails, GuardrailResult


class GoldConfluenceEngine:
    def __init__(self) -> None:
        self._engine = QuantitativeMethodEngine()

    def evaluate(
        self,
        timeframe: str,
        candles_by_tf: dict[str, list[Candle]],
        news_gate_state: str = "CLEAR",
        basis_status: str = "ALIGNED",
        spread: float = 0.24,
    ) -> QuantSnapshot:
        return self._engine.analyze(
            timeframe,
            candles_by_tf,
            news_gate_state=news_gate_state,
            basis_status=basis_status,
            spread=spread,
        )

    @staticmethod
    def check_setup(direction: str, entry: float, sl: float, tp1: float, tp2: float, atr: float) -> GuardrailResult:
        return validate_trade_guardrails(direction, entry, sl, tp1, tp2, atr)
