"""Centralized AppState container for Sentinel Server."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from data_pipeline.orchestrator import MarketDataOrchestrator
from methods.engine import QuantitativeMethodEngine
from agent_copilot.engine import PositionCopilotEngine
from agent_copilot.hsm import PositionState
from agent_copilot.autonomous_scanner import AutonomousAgentScanner
from agent_copilot.risk_circuit_breaker import RiskCircuitBreaker
from engines.dynamic_news_assistant import DynamicNewsAssistant
from storage.db import Database
from .ws_hub import WsHub
from .telemetry import LoopLagMonitor


@dataclass
class AppState:
    db: Database = field(default_factory=Database)
    orchestrator: MarketDataOrchestrator = field(default_factory=MarketDataOrchestrator)
    quant_engine: QuantitativeMethodEngine = field(default_factory=QuantitativeMethodEngine)
    copilot: PositionCopilotEngine = field(default_factory=PositionCopilotEngine)
    scanner: AutonomousAgentScanner = field(default_factory=AutonomousAgentScanner)
    risk_breaker: RiskCircuitBreaker = field(default_factory=RiskCircuitBreaker)
    news_assistant: DynamicNewsAssistant = field(default_factory=DynamicNewsAssistant)
    ws_hub: WsHub = field(default_factory=WsHub)
    lag_monitor: LoopLagMonitor = field(default_factory=LoopLagMonitor)
    active_position: PositionState | None = None
    last_advisory: dict[str, Any] | None = None
    last_basis_usd: float = 0.0
    pending_jobs: list[dict[str, Any]] = field(default_factory=list)
    spot_price: float = 2742.50
    spread: float = 0.24
