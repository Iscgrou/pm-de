"""Multi-Timeframe (MTF) Structural Alignment & Health Analyzer."""
from __future__ import annotations

from dataclasses import dataclass
from methods.tpi import TpiSnapshot


@dataclass(slots=True)
class MtfHealthReport:
    aligned: bool
    htf_bias: str
    ltf_bias: str
    conflict_detected: bool
    summary: str


class MtfHealthAnalyzer:
    def evaluate(self, tpi: TpiSnapshot) -> MtfHealthReport:
        h4 = tpi.per_timeframe.get("H4", 0.0)
        h1 = tpi.per_timeframe.get("H1", 0.0)
        m15 = tpi.per_timeframe.get("M15", 0.0)
        m5 = tpi.per_timeframe.get("M5", 0.0)

        htf_avg = (h4 + h1) / 2.0
        ltf_avg = (m15 + m5) / 2.0
        htf_bias = "BULLISH" if htf_avg > 0.15 else "BEARISH" if htf_avg < -0.15 else "NEUTRAL"
        ltf_bias = "BULLISH" if ltf_avg > 0.15 else "BEARISH" if ltf_avg < -0.15 else "NEUTRAL"
        conflict = (htf_bias == "BULLISH" and ltf_bias == "BEARISH") or (
            htf_bias == "BEARISH" and ltf_bias == "BULLISH"
        )
        aligned = not conflict and htf_bias != "NEUTRAL"

        summary = (
            f"HTF ({htf_bias}) & LTF ({ltf_bias}) {'aligned' if aligned else 'diverging'}"
            f" · TPI composite {tpi.composite_score:+.2f}"
        )
        return MtfHealthReport(aligned, htf_bias, ltf_bias, conflict, summary)
