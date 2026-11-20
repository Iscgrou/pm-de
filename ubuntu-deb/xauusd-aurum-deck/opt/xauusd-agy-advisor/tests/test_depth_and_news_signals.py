"""Historical backfill depth & 2-tier USD macro news lockout signal tests."""
from __future__ import annotations

import time
from engines.dynamic_news_assistant import DynamicNewsAssistant, MacroEvent
from engines.signal_tracker_fsm import SignalTrackerFSM, TrackedSignal


def test_news_lockout_vetoes_pending_and_caution_halves_lot() -> None:
    now = int(time.time() * 1000)
    news = DynamicNewsAssistant()
    fsm = SignalTrackerFSM()

    # High impact 5 minutes away -> LOCKOUT
    news.set_events([MacroEvent("nfp", "US Non-Farm Payrolls", "USD", "HIGH", now + 300_000)])
    gate = news.evaluate_gate(now)
    assert gate.state == "LOCKOUT"
    sig = TrackedSignal("s1", "LONG", 2740.0, 2734.0, 2750.0, 2762.0, 0.40)
    ok, _ = fsm.arm_signal(sig, 4.0, gate.state)
    assert not ok and sig.state == "EXPIRED_OR_VETOED"

    # Medium impact 2 minutes away -> CAUTION (50% lot cap)
    news.set_events([MacroEvent("claims", "Initial Jobless Claims", "USD", "MEDIUM", now + 120_000)])
    gate2 = news.evaluate_gate(now)
    assert gate2.state == "CAUTION"
    sig2 = TrackedSignal("s2", "LONG", 2740.0, 2734.0, 2750.0, 2762.0, 0.40)
    ok2, _ = fsm.arm_signal(sig2, 4.0, gate2.state)
    assert ok2 and sig2.lot_size == 0.20
