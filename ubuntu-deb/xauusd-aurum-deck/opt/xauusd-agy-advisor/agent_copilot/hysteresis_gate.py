"""HysteresisGate: dampens decision flip-flopping during noisy market micro-fluctuations."""
from __future__ import annotations

import time


class HysteresisGate:
    """Requires consecutive confirmations and a cooldown window before switching verdicts."""

    def __init__(self, required_confirmations: int = 2, cooldown_sec: float = 15.0) -> None:
        self.required_confirmations = required_confirmations
        self.cooldown_sec = cooldown_sec
        self.current_verdict: str = "HOLD"
        self._pending_verdict: str | None = None
        self._pending_count: int = 0
        self._last_switch_ts: float = 0.0

    def evaluate(self, proposed: str) -> str:
        now = time.monotonic()
        if proposed == self.current_verdict:
            self._pending_verdict = None
            self._pending_count = 0
            return self.current_verdict

        if proposed == "VETO":
            self.current_verdict = "VETO"
            self._last_switch_ts = now
            return self.current_verdict

        if now - self._last_switch_ts < self.cooldown_sec:
            return self.current_verdict

        if proposed == self._pending_verdict:
            self._pending_count += 1
        else:
            self._pending_verdict = proposed
            self._pending_count = 1

        if self._pending_count >= self.required_confirmations:
            self.current_verdict = proposed
            self._pending_verdict = None
            self._pending_count = 0
            self._last_switch_ts = now

        return self.current_verdict
