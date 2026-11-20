"""System 1 Quantitative SMC & Mathematical Guardrails package."""
from .engine import QuantitativeMethodEngine
from .fvg import detect_luxalgo_fvgs, FairValueGap
from .ob import detect_volume_order_blocks, OrderBlock
from .structural_alpha import detect_market_structure, StructureEvent
from .tfs import compute_tfs_suite, TfsSnapshot
from .tpi import compute_tpi_matrix, TpiSnapshot
from .regime import classify_regime, MarketRegime
from .risk_cost import validate_trade_guardrails, GuardrailResult

__all__ = [
    "QuantitativeMethodEngine",
    "detect_luxalgo_fvgs",
    "FairValueGap",
    "detect_volume_order_blocks",
    "OrderBlock",
    "detect_market_structure",
    "StructureEvent",
    "compute_tfs_suite",
    "TfsSnapshot",
    "compute_tpi_matrix",
    "TpiSnapshot",
    "classify_regime",
    "MarketRegime",
    "validate_trade_guardrails",
    "GuardrailResult",
]
