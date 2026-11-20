"""Episodic Memory Manager for recalling similar historical gold market regimes."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Episode:
    episode_id: str
    regime: str
    setup_summary: str
    outcome_r: float
    lesson: str


class EpisodicMemoryManager:
    def __init__(self) -> None:
        self._episodes: list[Episode] = []

    def record(self, episode: Episode) -> None:
        self._episodes.append(episode)

    def recall_by_regime(self, regime: str, limit: int = 5) -> list[Episode]:
        matches = [e for e in self._episodes if e.regime == regime]
        return matches[-limit:]
