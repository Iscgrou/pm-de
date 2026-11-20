"""Sentinel Hub FastAPI Server (port 8787) with CrashRecovery, LoopLag probe & /ws/live."""
from __future__ import annotations

import asyncio
import contextlib
import os
import pathlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from storage.recovery import CrashRecovery
from data_pipeline.live_feed_daemon import LiveFeedDaemon
from .rest_api import build_router
from .state import AppState

state = AppState()
state.db.db_path = os.getenv("XAUUSD_DB_PATH", "storage/trading.db")


def _on_live_tick(tick, divergence) -> None:
    state.spot_price = tick.last
    state.spread = tick.spread
    state.last_basis_usd = divergence.basis_usd if divergence else 0.0
    state.ws_hub.broadcast(
        "tick",
        {
            "symbol": tick.symbol,
            "last": tick.last,
            "bid": tick.bid,
            "ask": tick.ask,
            "spread": tick.spread,
            "tier": tick.tier,
            "source": tick.source,
            "basis_usd": state.last_basis_usd,
        },
    )


live_daemon = LiveFeedDaemon(state.orchestrator, on_tick=_on_live_tick, poll_interval_sec=1.5)


async def _loop_lag_daemon() -> None:
    while True:
        await state.lag_monitor.probe_once(0.05)
        await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await state.db.connect()
    recovery = CrashRecovery(state.db)
    report = await recovery.run()
    state.ws_hub.reset_sequence(report.ws_sequence_reset_to)
    lag_task = asyncio.create_task(_loop_lag_daemon())
    feed_task = asyncio.create_task(live_daemon.run_forever())
    try:
        yield
    finally:
        live_daemon.stop()
        lag_task.cancel()
        feed_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await lag_task
            await feed_task
        await state.db.close()


app = FastAPI(title="Payam XAUUSD Institutional Sentinel Hub", version="2.0.0", lifespan=lifespan)
app.include_router(build_router(state))


@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket) -> None:
    await ws.accept()
    state.ws_hub.register(ws)
    pump = asyncio.create_task(state.ws_hub.pump_client(ws))
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        state.ws_hub.unregister(ws)


frontend_dist = pathlib.Path(__file__).parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
