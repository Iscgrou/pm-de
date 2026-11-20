"""Sentinel Hub WebSocket ring buffer & event loop telemetry integration tests."""
from __future__ import annotations

import pytest
from sentinel_app.ws_hub import WsHub
from sentinel_app.telemetry import LoopLagMonitor


@pytest.mark.asyncio
async def test_ws_monotonic_sequence_and_loop_lag() -> None:
    hub = WsHub(max_queue_per_client=4)
    s1 = hub.broadcast("tick", {"price": 2741.0})
    s2 = hub.broadcast("tick", {"price": 2741.5})
    assert s2 == s1 + 1

    mon = LoopLagMonitor()
    await mon.probe_once(0.005)
    assert mon.is_healthy()
