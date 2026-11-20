"""Adversarial challenger tests: hostile trader setups, non-gold injection & hallucinated prices."""
from __future__ import annotations

import time
from cdp_streamer import TickEvent
from data_pipeline.orchestrator import MarketDataOrchestrator
from methods.risk_cost import validate_trade_guardrails
from agent_copilot.agy_reasoner_bridge import AntigravityReasonerBridge


def test_rejects_inverted_and_sub_rr_setups() -> None:
    assert not validate_trade_guardrails("LONG", 2740.0, 2745.0, 2750.0, 2760.0, 4.0).valid
    assert not validate_trade_guardrails("SHORT", 2740.0, 2735.0, 2730.0, 2720.0, 4.0).valid
    assert not validate_trade_guardrails("LONG", 2740.0, 2730.0, 2752.0, 2770.0, 4.0).valid  # R:R 1.2 < 1.5
    assert not validate_trade_guardrails("LONG", 2740.0, 2739.5, 2742.0, 2745.0, 4.0).valid  # < 0.25*ATR


def test_tripwire_blocks_non_gold_symbol_and_fails_over() -> None:
    orch = MarketDataOrchestrator()
    out = orch.ingest_tick(TickEvent("EURUSD", 1.085, 1.0849, 1.0851, 0.0002, int(time.time() * 1000)))
    assert not out.accepted
    assert out.watchdog.active_tier == 2


def test_anti_hallucination_whitelist_rejects_ungrounded_price() -> None:
    ok, bad = AntigravityReasonerBridge.verify_anti_hallucination(
        "Watch support at 2738.50 and hallucinated level 2999.00", [2738.50, 2742.00]
    )
    assert not ok
    assert 2999.0 in bad
