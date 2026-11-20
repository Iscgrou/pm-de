"""WsHub: Bounded Drop-Oldest Ring Buffer WebSocket broadcaster with monotonic Sequence ID."""
from __future__ import annotations

import asyncio
import json
from collections import deque
from typing import Any
from fastapi import WebSocket


class WsHub:
    """Prevents slow dashboard clients from back-pressuring the System 1 tick loop."""

    def __init__(self, max_queue_per_client: int = 128) -> None:
        self.max_queue_per_client = max_queue_per_client
        self._clients: dict[WebSocket, deque[str]] = {}
        self._events: dict[WebSocket, asyncio.Event] = {}
        self.sequence_id: int = 0
        self.dropped_frames: int = 0

    def reset_sequence(self, value: int = 0) -> None:
        self.sequence_id = value

    def register(self, ws: WebSocket) -> None:
        self._clients[ws] = deque(maxlen=self.max_queue_per_client)
        self._events[ws] = asyncio.Event()

    def unregister(self, ws: WebSocket) -> None:
        self._clients.pop(ws, None)
        self._events.pop(ws, None)

    def broadcast(self, event_type: str, payload: dict[str, Any]) -> int:
        self.sequence_id += 1
        envelope = json.dumps({"seq": self.sequence_id, "type": event_type, "data": payload})
        for ws, ring in list(self._clients.items()):
            if len(ring) == ring.maxlen:
                self.dropped_frames += 1
            ring.append(envelope)  # deque(maxlen=N) enforces Drop-Oldest atomically
            evt = self._events.get(ws)
            if evt:
                evt.set()
        return self.sequence_id

    async def pump_client(self, ws: WebSocket) -> None:
        ring = self._clients[ws]
        evt = self._events[ws]
        while ws in self._clients:
            if not ring:
                evt.clear()
                await evt.wait()
            while ring:
                msg = ring.popleft()
                await ws.send_text(msg)
