"""PAXGUSDT to XAUUSD spot basis calibration using EWMA offset tracking."""
from __future__ import annotations


class PaxgCalibrator:
    """Maintains an exponential moving basis offset (spot - paxg) for seamless Tier 2 failover."""

    def __init__(self, alpha: float = 0.15, max_basis_usd: float = 35.0) -> None:
        self.alpha = alpha
        self.max_basis_usd = max_basis_usd
        self.basis_offset: float = 0.0
        self.samples: int = 0

    def observe(self, spot_xauusd: float, paxg_price: float) -> float:
        raw_basis = spot_xauusd - paxg_price
        clamped = max(-self.max_basis_usd, min(self.max_basis_usd, raw_basis))
        if self.samples == 0:
            self.basis_offset = clamped
        else:
            self.basis_offset = self.alpha * clamped + (1.0 - self.alpha) * self.basis_offset
        self.samples += 1
        return round(self.basis_offset, 4)

    def to_spot(self, paxg_price: float) -> float:
        return round(paxg_price + self.basis_offset, 2)
