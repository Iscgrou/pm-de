"""System 1 QuantitativeMethodEngine (<5ms aggregated SMC + TFS + TPI + Regime computation)."""
from __future__ import annotations

import time
from dataclasses import dataclass, asdict
from typing import Any

from data_pipeline.aggregator import Candle
from .fvg import detect_luxalgo_fvgs, FairValueGap
from .ob import detect_volume_order_blocks, OrderBlock
from .structural_alpha import detect_market_structure, StructureEvent
from .tfs import compute_tfs_suite, TfsSnapshot
from .tpi import compute_tpi_matrix, TpiSnapshot
from .regime import classify_regime, MarketRegime
from .rsi import RsiTimeframeState
from .confluence_brain import (
    DealingRangeSnapshot,
    PayamBrainReport,
    evaluate_payam_brain,
)


@dataclass(slots=True)
class QuantSnapshot:
    timeframe: str
    compute_ms: float
    fvgs: list[FairValueGap]
    order_blocks: list[OrderBlock]
    structures: list[StructureEvent]
    tfs: TfsSnapshot
    tpi: TpiSnapshot
    regime: MarketRegime
    rsi_by_tf: dict[str, RsiTimeframeState]
    dealing_range: DealingRangeSnapshot
    brain: PayamBrainReport

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class QuantitativeMethodEngine:
    """Fast deterministic System 1 engine producing full SMC, Wilder RSI(14), OTE & Payam Brain v3 context."""

    def analyze(
        self,
        timeframe: str,
        candles_by_tf: dict[str, list[Candle]],
        news_gate_state: str = "CLEAR",
        basis_status: str = "ALIGNED",
        spread: float = 0.24,
    ) -> QuantSnapshot:
        t0 = time.perf_counter()
        active = candles_by_tf.get(timeframe) or []
        fvgs = detect_luxalgo_fvgs(active)
        obs = detect_volume_order_blocks(active)
        structures = detect_market_structure(active)
        tfs = compute_tfs_suite(active)
        tpi = compute_tpi_matrix(candles_by_tf)
        regime = classify_regime(active)
        brain, rsi_by_tf, dealing_range = evaluate_payam_brain(
            timeframe=timeframe,
            candles_by_tf=candles_by_tf,
            obs=obs[-10:],
            fvgs=fvgs[-12:],
            structures=structures[-12:],
            tpi=tpi,
            regime=regime,
            news_gate_state=news_gate_state,
            basis_status=basis_status,
            spread=spread,
        )
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)

        return QuantSnapshot(
            timeframe=timeframe,
            compute_ms=elapsed_ms,
            fvgs=fvgs[-12:],
            order_blocks=obs[-10:],
            structures=structures[-12:],
            tfs=tfs,
            tpi=tpi,
            regime=regime,
            rsi_by_tf=rsi_by_tf,
            dealing_range=dealing_range,
            brain=brain,
        )
