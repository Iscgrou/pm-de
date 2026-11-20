"""Institutional Risk Circuit Breaker, Configurable Agent Constitution & Immutable Audit Log."""
from __future__ import annotations

import json
import pathlib
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class AgentConfig:
    min_confluence_score: int = 62
    min_rr_ratio: float = 1.75
    max_daily_drawdown_pct: float = 3.0
    max_consecutive_losses: int = 3
    cooldown_minutes_after_loss_streak: int = 60
    max_concurrent_positions: int = 3
    max_portfolio_heat_pct: float = 2.5
    max_allowed_spread_usd: float = 1.20
    allow_counter_h4_scalps: bool = False
    allow_asian_session_entries: bool = True
    auto_scale_out_tp1_pct: int = 50
    news_high_impact_pre_min: int = 15
    news_high_impact_post_min: int = 30
    enable_live_news_feeds: bool = True
    kill_switch_engaged: bool = False

    def update(self, patch: dict[str, Any]) -> None:
        bounds = {
            "min_confluence_score": (55, 85, int),
            "min_rr_ratio": (1.50, 3.00, float),
            "max_daily_drawdown_pct": (1.0, 10.0, float),
            "max_consecutive_losses": (2, 6, int),
            "cooldown_minutes_after_loss_streak": (15, 240, int),
            "max_concurrent_positions": (1, 6, int),
            "max_portfolio_heat_pct": (1.0, 6.0, float),
            "max_allowed_spread_usd": (0.40, 3.00, float),
            "auto_scale_out_tp1_pct": (25, 75, int),
            "news_high_impact_pre_min": (5, 30, int),
            "news_high_impact_post_min": (10, 60, int),
        }
        bool_keys = {
            "allow_counter_h4_scalps",
            "allow_asian_session_entries",
            "enable_live_news_feeds",
            "kill_switch_engaged",
        }
        for k, v in patch.items():
            if k in bounds:
                lo, hi, caster = bounds[k]
                try:
                    num = caster(v)
                    setattr(self, k, max(lo, min(hi, round(num, 2) if caster is float else num)))
                except (TypeError, ValueError):
                    continue
            elif k in bool_keys and isinstance(v, bool):
                setattr(self, k, v)


@dataclass
class BreakerCheck:
    id: str
    label: str
    status: str  # OK | WARNING | TRIPPED
    hard_block: bool
    current_value: str
    limit_value: str
    detail: str


@dataclass
class AuditEntry:
    timestamp_ms: int
    category: str
    severity: str
    title: str
    detail: str


class RiskCircuitBreaker:
    """Deterministic 7-breaker portfolio & execution safety node (zero LLM override)."""

    def __init__(self, config_path: str = "cache/agent_config.json") -> None:
        self.config_path = pathlib.Path(config_path)
        self.config = AgentConfig()
        self.audit_log: deque[AuditEntry] = deque(maxlen=100)
        self.closed_pnl_history: list[tuple[int, float]] = []
        self.peak_equity: float = 25_000.0
        self.current_equity: float = 25_000.0
        self._load_config()
        self.record_audit("CONFIG", "INFO", "RiskCircuitBreaker Booted", "7 institutional breakers armed.")

    def _load_config(self) -> None:
        try:
            if self.config_path.exists():
                data = json.loads(self.config_path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self.config.update(data)
        except Exception:
            pass

    def save_config(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(json.dumps(asdict(self.config), indent=2), encoding="utf-8")
        except Exception:
            pass

    def record_audit(self, category: str, severity: str, title: str, detail: str) -> dict[str, Any]:
        entry = AuditEntry(
            timestamp_ms=int(time.time() * 1000),
            category=category,
            severity=severity,
            title=title,
            detail=detail,
        )
        self.audit_log.appendleft(entry)
        return asdict(entry)

    def set_kill_switch(self, engaged: bool, reason: str = "Operator toggle") -> dict[str, Any]:
        self.config.kill_switch_engaged = engaged
        self.save_config()
        self.record_audit(
            "KILL_SWITCH",
            "CRITICAL" if engaged else "INFO",
            "EMERGENCY KILL SWITCH ENGAGED" if engaged else "Kill Switch Disarmed",
            reason,
        )
        return asdict(self.config)

    def record_trade_outcome(self, net_pnl: float, equity_after: float | None = None) -> None:
        now_ms = int(time.time() * 1000)
        self.closed_pnl_history.append((now_ms, net_pnl))
        if equity_after is not None:
            self.current_equity = equity_after
            self.peak_equity = max(self.peak_equity, equity_after)

    def _loss_streak(self) -> tuple[int, int | None]:
        streak = 0
        last_ts = None
        for ts, pnl in reversed(self.closed_pnl_history):
            if pnl < 0:
                streak += 1
                if last_ts is None:
                    last_ts = ts
            else:
                break
        return streak, last_ts

    def evaluate(
        self,
        open_positions_count: int,
        open_risk_usd: float,
        spread: float,
        news_veto: bool,
        news_caution: bool = False,
        shock_headline: str | None = None,
        now_ms: int | None = None,
    ) -> dict[str, Any]:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        cfg = self.config
        checks: list[BreakerCheck] = []

        # 1. Emergency Kill Switch
        checks.append(
            BreakerCheck(
                id="KILL_SWITCH",
                label="Emergency Kill Switch",
                status="TRIPPED" if cfg.kill_switch_engaged else "OK",
                hard_block=cfg.kill_switch_engaged,
                current_value="ENGAGED" if cfg.kill_switch_engaged else "DISARMED",
                limit_value="DISARMED",
                detail="Emergency kill switch engaged — all new entries hard-locked." if cfg.kill_switch_engaged else "Operational authorization active.",
            )
        )

        # 2. Daily Drawdown Hard Cap
        dd_pct = round(max(0.0, ((self.peak_equity - self.current_equity) / max(1.0, self.peak_equity)) * 100.0), 2)
        if dd_pct >= cfg.max_daily_drawdown_pct:
            checks.append(BreakerCheck("DAILY_DRAWDOWN_CAP", "Daily Drawdown Cap", "TRIPPED", True, f"{dd_pct:.2f}%", f"{cfg.max_daily_drawdown_pct:.1f}%", "Daily drawdown cap breached."))
        elif dd_pct >= cfg.max_daily_drawdown_pct * 0.72:
            checks.append(BreakerCheck("DAILY_DRAWDOWN_CAP", "Daily Drawdown Cap", "WARNING", False, f"{dd_pct:.2f}%", f"{cfg.max_daily_drawdown_pct:.1f}%", "Approaching daily drawdown cap — risk throttled 50%."))
        else:
            checks.append(BreakerCheck("DAILY_DRAWDOWN_CAP", "Daily Drawdown Cap", "OK", False, f"{dd_pct:.2f}%", f"{cfg.max_daily_drawdown_pct:.1f}%", "Drawdown within budget."))

        # 3. Consecutive Loss Cooldown
        streak, last_loss_ms = self._loss_streak()
        elapsed_min = ((now - last_loss_ms) / 60_000.0) if last_loss_ms else 9999.0
        rem_min = int(max(0, cfg.cooldown_minutes_after_loss_streak - elapsed_min)) if streak >= cfg.max_consecutive_losses else 0
        if rem_min > 0:
            checks.append(BreakerCheck("CONSECUTIVE_LOSS_COOLDOWN", "Loss Streak Cooldown", "TRIPPED", True, f"{streak} losses ({rem_min}m)", f"Max {cfg.max_consecutive_losses}", "Anti-revenge-trading cooldown active."))
        elif streak >= max(2, cfg.max_consecutive_losses - 1):
            checks.append(BreakerCheck("CONSECUTIVE_LOSS_COOLDOWN", "Loss Streak Cooldown", "WARNING", False, f"{streak} losses", f"Max {cfg.max_consecutive_losses}", "Elevated loss streak — 50% size cap."))
        else:
            checks.append(BreakerCheck("CONSECUTIVE_LOSS_COOLDOWN", "Loss Streak Cooldown", "OK", False, f"{streak} losses", f"Max {cfg.max_consecutive_losses}", "No loss-streak lockout."))

        # 4. Max Concurrent Open Positions
        if open_positions_count >= cfg.max_concurrent_positions:
            checks.append(BreakerCheck("MAX_OPEN_POSITIONS", "Max Open Positions", "TRIPPED", True, f"{open_positions_count} open", f"Max {cfg.max_concurrent_positions}", "Max concurrent positions reached."))
        else:
            checks.append(BreakerCheck("MAX_OPEN_POSITIONS", "Max Open Positions", "OK", False, f"{open_positions_count} open", f"Max {cfg.max_concurrent_positions}", "Position slot available."))

        # 5. Portfolio Heat %
        heat_pct = round((open_risk_usd / max(100.0, self.current_equity)) * 100.0, 2)
        if heat_pct >= cfg.max_portfolio_heat_pct:
            checks.append(BreakerCheck("PORTFOLIO_HEAT_CAP", "Portfolio Risk Heat", "TRIPPED", True, f"{heat_pct:.2f}%", f"{cfg.max_portfolio_heat_pct:.1f}%", "Open risk exceeded portfolio heat cap."))
        elif heat_pct >= cfg.max_portfolio_heat_pct * 0.75:
            checks.append(BreakerCheck("PORTFOLIO_HEAT_CAP", "Portfolio Risk Heat", "WARNING", False, f"{heat_pct:.2f}%", f"{cfg.max_portfolio_heat_pct:.1f}%", "Portfolio heat near cap."))
        else:
            checks.append(BreakerCheck("PORTFOLIO_HEAT_CAP", "Portfolio Risk Heat", "OK", False, f"{heat_pct:.2f}%", f"{cfg.max_portfolio_heat_pct:.1f}%", "Open risk nominal."))

        # 6. Spread Anomaly Guard
        if spread > cfg.max_allowed_spread_usd:
            checks.append(BreakerCheck("SPREAD_ANOMALY_GUARD", "Spread Anomaly Guard", "TRIPPED", True, f"${spread:.2f}", f"<= ${cfg.max_allowed_spread_usd:.2f}", "Spread anomaly exceeds safety threshold."))
        else:
            checks.append(BreakerCheck("SPREAD_ANOMALY_GUARD", "Spread Anomaly Guard", "OK", False, f"${spread:.2f}", f"<= ${cfg.max_allowed_spread_usd:.2f}", "Interbank spread nominal."))

        # 7. Macro News & Shock Shield
        if news_veto or shock_headline:
            checks.append(BreakerCheck("NEWS_SHOCK_GUARD", "Macro & Breaking Shock Shield", "TRIPPED", True, "SHOCK" if shock_headline else "LOCKOUT", "CLEAR", shock_headline or "High-impact USD release blackout active."))
        elif news_caution:
            checks.append(BreakerCheck("NEWS_SHOCK_GUARD", "Macro & Breaking Shock Shield", "WARNING", False, "CAUTION 50%", "CLEAR", "Medium-impact USD release caution active."))
        else:
            checks.append(BreakerCheck("NEWS_SHOCK_GUARD", "Macro & Breaking Shock Shield", "OK", False, "CLEAR", "CLEAR", "Macro calendar & breaking wire clear."))

        tripped = [c for c in checks if c.hard_block]
        warnings = [c for c in checks if c.status == "WARNING"]
        can_open = len(tripped) == 0
        risk_mult = 0.0 if not can_open else (0.5 if warnings else 1.0)

        return {
            "can_open_new_trades": can_open,
            "effective_risk_multiplier": risk_mult,
            "consecutive_losses": streak,
            "cooldown_remaining_min": rem_min,
            "daily_drawdown_pct": dd_pct,
            "open_portfolio_heat_pct": heat_pct,
            "open_positions_count": open_positions_count,
            "active_breakers": [f"{c.label} ({c.current_value})" for c in tripped],
            "breakers": [asdict(c) for c in checks],
        }
