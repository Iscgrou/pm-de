"""DynamicNewsAssistant: 2-tier USD macro news blackout gate + 14-source live news shock shield."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from .news_sources import CoreNewsAggregator


@dataclass
class MacroEvent:
    event_id: str
    title: str
    currency: str
    impact: str  # HIGH | MEDIUM | LOW
    scheduled_at_ms: int
    forecast: str = ""
    previous: str = ""


@dataclass
class NewsGateState:
    state: str  # CLEAR | CAUTION | LOCKOUT
    lot_multiplier: float
    veto_new_entries: bool
    cancel_pending_limits: bool
    active_event: MacroEvent | None
    minutes_to_event: float | None
    shock_override: bool = False
    shock_headline: str | None = None


class DynamicNewsAssistant:
    """Evaluates ForexFactory USD high/medium blackout windows + emergency breaking headline shocks."""

    def __init__(self, events: list[MacroEvent] | None = None) -> None:
        self.events: list[MacroEvent] = events or []
        self.aggregator = CoreNewsAggregator(cache_ttl_sec=60.0)
        self.last_intelligence: dict[str, Any] | None = None

    def set_events(self, events: list[MacroEvent]) -> None:
        self.events = sorted(events, key=lambda e: e.scheduled_at_ms)

    async def sync_live_feeds(self, force: bool = False) -> dict[str, Any]:
        intel = await self.aggregator.sync(force=force)
        self.last_intelligence = intel
        cal = intel.get("calendar_events") or []
        if cal:
            self.set_events(
                [
                    MacroEvent(
                        event_id=str(e["id"]),
                        title=str(e["title"]),
                        currency=str(e["currency"]),
                        impact=str(e["impact"]),
                        scheduled_at_ms=int(e["scheduled_at_ms"]),
                        forecast=str(e.get("forecast", "—")),
                        previous=str(e.get("previous", "—")),
                    )
                    for e in cal
                ]
            )
        return intel

    def evaluate_gate(
        self,
        now_ms: int | None = None,
        high_pre_min: float = 15.0,
        high_post_min: float = 30.0,
    ) -> NewsGateState:
        now = now_ms if now_ms is not None else int(time.time() * 1000)

        # Emergency breaking news shock overrides everything into LOCKOUT
        if self.last_intelligence and self.last_intelligence.get("shock_detected"):
            return NewsGateState(
                state="LOCKOUT",
                lot_multiplier=0.0,
                veto_new_entries=True,
                cancel_pending_limits=True,
                active_event=None,
                minutes_to_event=0.0,
                shock_override=True,
                shock_headline=self.last_intelligence.get("shock_headline"),
            )

        ordered = sorted(self.events, key=lambda e: e.scheduled_at_ms)

        for ev in ordered:
            if ev.currency.upper() != "USD" or ev.impact.upper() != "HIGH":
                continue
            delta_min = (ev.scheduled_at_ms - now) / 60_000.0
            if -high_post_min <= delta_min <= high_pre_min:
                return NewsGateState(
                    state="LOCKOUT",
                    lot_multiplier=0.0,
                    veto_new_entries=True,
                    cancel_pending_limits=True,
                    active_event=ev,
                    minutes_to_event=round(delta_min, 2),
                )

        for ev in ordered:
            if ev.currency.upper() != "USD" or ev.impact.upper() != "MEDIUM":
                continue
            delta_min = (ev.scheduled_at_ms - now) / 60_000.0
            if -10.0 <= delta_min <= 5.0:
                return NewsGateState(
                    state="CAUTION",
                    lot_multiplier=0.5,
                    veto_new_entries=False,
                    cancel_pending_limits=False,
                    active_event=ev,
                    minutes_to_event=round(delta_min, 2),
                )

        upcoming = next((e for e in ordered if e.scheduled_at_ms > now), None)
        return NewsGateState(
            state="CLEAR",
            lot_multiplier=1.0,
            veto_new_entries=False,
            cancel_pending_limits=False,
            active_event=upcoming,
            minutes_to_event=round((upcoming.scheduled_at_ms - now) / 60_000.0, 2) if upcoming else None,
        )
