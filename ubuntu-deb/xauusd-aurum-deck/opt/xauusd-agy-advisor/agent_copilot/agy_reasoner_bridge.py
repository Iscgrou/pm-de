"""Antigravity Reasoner Bridge: DeterministicFactLedger & Anti-Hallucination Whitelist Filter."""
from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

NUMBER_REGEX = re.compile(r"\b\d{3,5}(?:\.\d{1,2})?\b")


@dataclass(slots=True)
class DeterministicFactLedger:
    job_id: str
    trigger_reason: str
    spot_price: float
    spread: float
    atr: float
    regime: str
    tpi_composite: float
    news_gate: str
    allowed_numbers: list[float] = field(default_factory=list)
    created_at_ms: int = field(default_factory=lambda: int(time.time() * 1000))


class AntigravityReasonerBridge:
    """Bridges System 1 deterministic facts to System 2 LLM reasoning with anti-hallucination guard."""

    def build_fact_ledger(
        self,
        trigger_reason: str,
        spot_price: float,
        spread: float,
        atr: float,
        regime: str,
        tpi_composite: float,
        news_gate: str,
        key_levels: list[float],
    ) -> DeterministicFactLedger:
        whitelist = sorted({round(v, 2) for v in [spot_price, *key_levels] if v > 0})
        return DeterministicFactLedger(
            job_id=f"job-{uuid.uuid4().hex[:10]}",
            trigger_reason=trigger_reason,
            spot_price=round(spot_price, 2),
            spread=round(spread, 3),
            atr=round(atr, 3),
            regime=regime,
            tpi_composite=round(tpi_composite, 3),
            news_gate=news_gate,
            allowed_numbers=whitelist,
        )

    @staticmethod
    def verify_anti_hallucination(text: str, allowed_numbers: list[float], tolerance: float = 0.05) -> tuple[bool, list[float]]:
        """Rejects any price figure (3-5 digits) in System 2 output not anchored in allowed_numbers."""
        found = [float(m.group(0)) for m in NUMBER_REGEX.finditer(text)]
        hallucinated: list[float] = []
        for num in found:
            if not any(abs(num - allowed) <= tolerance for allowed in allowed_numbers):
                hallucinated.append(num)
        return len(hallucinated) == 0, hallucinated

    def format_advisory_payload(
        self,
        ledger: DeterministicFactLedger,
        verdict: str,
        confidence: float,
        rationale_en: str,
        rationale_fa: str,
    ) -> dict[str, Any]:
        ok_en, bad_en = self.verify_anti_hallucination(rationale_en, ledger.allowed_numbers)
        ok_fa, bad_fa = self.verify_anti_hallucination(rationale_fa, ledger.allowed_numbers)
        if not (ok_en and ok_fa):
            raise ValueError(f"Anti-hallucination filter rejected ungrounded prices: {bad_en + bad_fa}")
        return {
            "job_id": ledger.job_id,
            "verdict": verdict,
            "confidence": round(confidence, 3),
            "rationale_en": rationale_en,
            "rationale_fa": rationale_fa,
            "hallucination_checked": True,
            "created_at_ms": int(time.time() * 1000),
        }
