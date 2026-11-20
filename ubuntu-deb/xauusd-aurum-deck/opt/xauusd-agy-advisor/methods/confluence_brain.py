"""Payam Institutional Brain v3 — 6-Pillar 100-Point XAU/USD Confluence Matrix & 7-Gate Anti-Emotion Shield."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from data_pipeline.aggregator import Candle
from .fvg import FairValueGap
from .ob import OrderBlock
from .regime import MarketRegime
from .rsi import RsiTimeframeState, analyze_rsi_timeframe
from .structural_alpha import StructureEvent
from .tpi import TpiSnapshot

ConvictionGrade = Literal["A+", "A", "B", "STAND_DOWN"]


@dataclass(slots=True)
class DealingRangeSnapshot:
    timeframe: str
    swing_high: float
    swing_low: float
    equilibrium_50: float
    ote_long_low: float
    ote_long_high: float
    ote_long_sweet: float
    ote_short_low: float
    ote_short_high: float
    ote_short_sweet: float
    position_pct: float
    zone: str


@dataclass(slots=True)
class PillarScore:
    id: str
    label: str
    score: float
    max_score: float
    detail: str


@dataclass(slots=True)
class DefenseGate:
    id: str
    label: str
    status: Literal["PASS", "CAUTION", "BLOCKED"]
    hard_veto: bool
    metric: str
    detail: str


@dataclass(slots=True)
class PayamBrainReport:
    execution_timeframe: str
    h4_bias: Literal["BULLISH", "BEARISH", "NEUTRAL"]
    h1_bias: Literal["BULLISH", "BEARISH", "NEUTRAL"]
    decision: Literal["PROPOSE_LONG", "PROPOSE_SHORT", "STAND_DOWN"]
    conviction_grade: ConvictionGrade
    total_score: int
    long_score: int
    short_score: int
    recommended_risk_multiplier: float
    killzone: str
    atr_extension: float
    kaufman_efficiency: float
    golden_confluence: bool
    pillars: list[PillarScore]
    defense_gates: list[DefenseGate]
    hard_vetoes: list[str]
    summary_en: str
    summary_fa: str


def compute_dealing_range(timeframe: str, candles: list[Candle], lookback: int = 44) -> DealingRangeSnapshot:
    if not candles:
        return DealingRangeSnapshot(timeframe, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50.0, "EQUILIBRIUM")
    window = candles[-min(lookback, len(candles)) :]
    hi = max(c.high for c in window)
    lo = min(c.low for c in window)
    span = max(0.5, hi - lo)
    spot = window[-1].close
    eq = round(lo + span * 0.5, 2)
    pos_pct = round(max(0.0, min(100.0, ((spot - lo) / span) * 100.0)), 1)
    zone = (
        "DEEP_DISCOUNT"
        if pos_pct <= 21.4
        else "DISCOUNT_OTE"
        if pos_pct <= 38.2
        else "DEEP_PREMIUM"
        if pos_pct >= 78.6
        else "PREMIUM_OTE"
        if pos_pct >= 61.8
        else "EQUILIBRIUM"
    )
    return DealingRangeSnapshot(
        timeframe=timeframe,
        swing_high=round(hi, 2),
        swing_low=round(lo, 2),
        equilibrium_50=eq,
        ote_long_low=round(hi - span * 0.786, 2),
        ote_long_high=round(hi - span * 0.618, 2),
        ote_long_sweet=round(hi - span * 0.705, 2),
        ote_short_low=round(lo + span * 0.618, 2),
        ote_short_high=round(lo + span * 0.786, 2),
        ote_short_sweet=round(lo + span * 0.705, 2),
        position_pct=pos_pct,
        zone=zone,
    )


def compute_kaufman_efficiency(candles: list[Candle], period: int = 12) -> float:
    if len(candles) < period + 1:
        return 0.5
    net = abs(candles[-1].close - candles[-1 - period].close)
    path = sum(abs(candles[i].close - candles[i - 1].close) for i in range(len(candles) - period, len(candles)))
    if path <= 0:
        return 0.5
    return round(min(1.0, net / path), 3)


def detect_killzone(now_utc: datetime | None = None) -> str:
    dt = now_utc or datetime.now(timezone.utc)
    h = dt.hour
    if 7 <= h < 10:
        return "LONDON_OPEN"
    if 12 <= h < 15:
        return "NY_OVERLAP"
    if 15 <= h < 17:
        return "NY_AM"
    if 0 <= h < 6:
        return "ASIAN_ACCUMULATION"
    return "OFF_SESSION"


def _has_golden_overlap(obs: list[OrderBlock], fvgs: list[FairValueGap], direction: str) -> bool:
    for ob in obs:
        if ob.mitigated or ob.direction != direction:
            continue
        for fvg in fvgs:
            if fvg.mitigated or fvg.direction != direction:
                continue
            if min(ob.high, fvg.top) >= max(ob.low, fvg.bottom) - 1.5:
                return True
    return False


def evaluate_payam_brain(
    timeframe: str,
    candles_by_tf: dict[str, list[Candle]],
    obs: list[OrderBlock],
    fvgs: list[FairValueGap],
    structures: list[StructureEvent],
    tpi: TpiSnapshot,
    regime: MarketRegime,
    news_gate_state: str = "CLEAR",
    basis_status: str = "ALIGNED",
    spread: float = 0.24,
) -> tuple[PayamBrainReport, dict[str, RsiTimeframeState], DealingRangeSnapshot]:
    """Run the 6-Pillar 100-Point Institutional Confluence Matrix + 7-Gate Anti-Emotion Shield."""
    active_candles = candles_by_tf.get(timeframe) or []
    h4_candles = candles_by_tf.get("H4") or active_candles
    h1_candles = candles_by_tf.get("H1") or active_candles
    spot = active_candles[-1].close if active_candles else 0.0
    atr = max(1.2, regime.atr)

    rsi_by_tf: dict[str, RsiTimeframeState] = {}
    for tf in ("M1", "M5", "M15", "M30", "H1", "H4"):
        st, _ = analyze_rsi_timeframe(tf, candles_by_tf.get(tf) or active_candles)
        rsi_by_tf[tf] = st

    rsi_active = rsi_by_tf[timeframe]
    rsi_h4 = rsi_by_tf["H4"]
    dealing = compute_dealing_range("H1" if len(h1_candles) >= 20 else timeframe, h1_candles if len(h1_candles) >= 20 else active_candles)
    kaufman_er = compute_kaufman_efficiency(active_candles, 12)
    killzone = detect_killzone()
    atr_ext = round((spot - dealing.equilibrium_50) / atr, 2) if atr > 0 else 0.0

    h4_tpi = tpi.per_timeframe.get("H4", 0.0)
    h1_tpi = tpi.per_timeframe.get("H1", 0.0)
    h4_bias: Literal["BULLISH", "BEARISH", "NEUTRAL"] = (
        "BULLISH" if h4_tpi > 0.14 else "BEARISH" if h4_tpi < -0.14 else "NEUTRAL"
    )
    h1_bias: Literal["BULLISH", "BEARISH", "NEUTRAL"] = (
        "BULLISH" if h1_tpi > 0.12 else "BEARISH" if h1_tpi < -0.12 else "NEUTRAL"
    )

    def score_side(side: Literal["LONG", "SHORT"]) -> tuple[int, list[PillarScore], bool]:
        want = "BULLISH" if side == "LONG" else "BEARISH"
        opp = "BEARISH" if side == "LONG" else "BULLISH"

        # 1. 4H Macro Compass (20 pts)
        p1 = 10.0
        if h4_bias == want:
            p1 = 16.0 + (4.0 if rsi_h4.regime == f"{want}_REGIME" else 0.0)
        elif h4_bias == opp:
            p1 = 3.0

        # 2. 1H Structure & Sweep (20 pts)
        p2 = 8.0
        if h1_bias == want:
            p2 += 6.0
        last_st = structures[-1] if structures else None
        if last_st and last_st.direction == want:
            p2 += 6.0
        p2 = min(20.0, p2)

        # 3. OB Institutional Quality (18 pts)
        fresh_obs = [o for o in obs if not o.mitigated and o.direction == want]
        p3 = 14.0 if fresh_obs else 4.0
        if fresh_obs and abs(spot - fresh_obs[-1].mt50) <= atr * 2.2:
            p3 = 18.0

        # 4. FVG & Golden Confluence (15 pts)
        fresh_fvgs = [f for f in fvgs if not f.mitigated and f.direction == want]
        golden = _has_golden_overlap(obs, fvgs, want)
        p4 = 15.0 if golden else (11.0 if fresh_fvgs else 3.0)

        # 5. Wilder RSI(14) Regime & Divergence (15 pts)
        p5 = 6.0
        if rsi_active.regime == f"{want}_REGIME":
            p5 += 5.0
        if (side == "LONG" and rsi_active.divergence in ("BULLISH_REGULAR", "BULLISH_HIDDEN")) or (
            side == "SHORT" and rsi_active.divergence in ("BEARISH_REGULAR", "BEARISH_HIDDEN")
        ):
            p5 += 4.0
        if (side == "LONG" and rsi_active.value >= 72.0) or (side == "SHORT" and rsi_active.value <= 28.0):
            p5 = max(1.0, p5 - 6.0)
        p5 = min(15.0, p5)

        # 6. OTE, Session & Macro Hygiene (12 pts)
        p6 = 4.0
        if (side == "LONG" and dealing.position_pct <= 50.0) or (side == "SHORT" and dealing.position_pct >= 50.0):
            p6 += 4.0
        if killzone in ("LONDON_OPEN", "NY_OVERLAP", "NY_AM"):
            p6 += 2.0
        if news_gate_state == "CLEAR" and basis_status == "ALIGNED":
            p6 += 2.0
        p6 = min(12.0, p6)

        pillars = [
            PillarScore("H4_COMPASS", "4H Macro Compass", round(p1, 1), 20, f"H4 {h4_bias} · RSI {rsi_h4.value:.1f}"),
            PillarScore("H1_SWEEP_STRUCT", "1H Structure & Sweep", round(p2, 1), 20, f"H1 {h1_bias} · {last_st.kind if last_st else 'None'}"),
            PillarScore("OB_QUALITY", "Order Block Quality", round(p3, 1), 18, f"{len(fresh_obs)} fresh {want} OB(s)"),
            PillarScore("FVG_GOLDEN", "FVG & Golden Overlap", round(p4, 1), 15, "Golden OB+FVG" if golden else f"{len(fresh_fvgs)} fresh FVG(s)"),
            PillarScore("RSI_MOMENTUM", "Wilder RSI(14) & Div", round(p5, 1), 15, f"RSI {rsi_active.value:.1f} · {rsi_active.divergence}"),
            PillarScore("OTE_SESSION_MACRO", "OTE, Killzone & Macro", round(p6, 1), 12, f"P/D {dealing.position_pct:.0f}% · {killzone}"),
        ]
        return int(round(sum(p.score for p in pillars))), pillars, golden

    long_score, long_pillars, long_golden = score_side("LONG")
    short_score, short_pillars, short_golden = score_side("SHORT")

    candidate: Literal["LONG", "SHORT"] = "LONG" if long_score >= short_score else "SHORT"
    total_score = long_score if candidate == "LONG" else short_score
    pillars = long_pillars if candidate == "LONG" else short_pillars
    golden = long_golden if candidate == "LONG" else short_golden
    spread_gap = abs(long_score - short_score)

    # 7-Gate Anti-Emotion & Anti-Fakeout Shield
    gates: list[DefenseGate] = []
    gates.append(
        DefenseGate(
            "NEWS_SHIELD",
            "USD Macro News Shield",
            "BLOCKED" if news_gate_state == "LOCKOUT" else "CAUTION" if news_gate_state == "CAUTION" else "PASS",
            news_gate_state == "LOCKOUT",
            news_gate_state,
            "High-impact USD lockout blocks entries." if news_gate_state == "LOCKOUT" else "News window nominal.",
        )
    )
    dir_ext = atr_ext if candidate == "LONG" else -atr_ext
    chase_blocked = dir_ext > 1.85 or (dir_ext > 1.35 and ((candidate == "LONG" and rsi_active.value >= 72) or (candidate == "SHORT" and rsi_active.value <= 28)))
    gates.append(
        DefenseGate(
            "ANTI_CHASE_ATR",
            "Anti-Chase Rubber Band",
            "BLOCKED" if chase_blocked else "PASS",
            chase_blocked,
            f"{dir_ext:+.2f} ATR",
            "Overextended from equilibrium; wait for OTE pullback." if chase_blocked else "Within institutional entry band.",
        )
    )
    trap_blocked = basis_status == "CRYPTO_INDUCEMENT"
    gates.append(
        DefenseGate(
            "FAKEOUT_TRAP_GUARD",
            "Fakeout & Basis Inducement Guard",
            "BLOCKED" if trap_blocked else "PASS",
            trap_blocked,
            basis_status,
            "PAXG/Spot divergence flags stop-hunt inducement." if trap_blocked else "Interbank/PAXG aligned.",
        )
    )
    counter_h4 = (candidate == "LONG" and h4_bias == "BEARISH") or (candidate == "SHORT" and h4_bias == "BULLISH")
    has_reg_div = (candidate == "LONG" and rsi_active.divergence == "BULLISH_REGULAR") or (
        candidate == "SHORT" and rsi_active.divergence == "BEARISH_REGULAR"
    )
    h4_blocked = counter_h4 and not has_reg_div
    gates.append(
        DefenseGate(
            "HTF_4H_COMPASS",
            "4H Macro Compass Alignment",
            "BLOCKED" if h4_blocked else "CAUTION" if counter_h4 else "PASS",
            h4_blocked,
            f"H4 {h4_bias}",
            "Counter-H4 blocked without regular RSI divergence." if h4_blocked else "Aligned with 4H macro bias.",
        )
    )
    chop_blocked = (regime.label == "VOLATILE_EXPANSION" and kaufman_er < 0.22) or (spread / atr > 0.32)
    gates.append(
        DefenseGate(
            "CHOP_EFFICIENCY_FILTER",
            "Chop & Spread Efficiency",
            "BLOCKED" if chop_blocked else "PASS",
            chop_blocked,
            f"ER {kaufman_er:.2f}",
            "Low directional efficiency / high spread chop." if chop_blocked else "Orderly price delivery.",
        )
    )
    pd_blocked = (candidate == "LONG" and dealing.position_pct > 84.0) or (candidate == "SHORT" and dealing.position_pct < 16.0)
    gates.append(
        DefenseGate(
            "PD_DISCIPLINE",
            "Premium/Discount OTE Discipline",
            "BLOCKED" if pd_blocked else "PASS",
            pd_blocked,
            f"{dealing.position_pct:.0f}%",
            "Refusing to buy deep Premium or sell deep Discount." if pd_blocked else "Valid Premium/Discount location.",
        )
    )
    hyst_blocked = spread_gap < 8
    gates.append(
        DefenseGate(
            "HYSTERESIS_LOCK",
            "Hysteresis Direction Lock",
            "BLOCKED" if hyst_blocked else "PASS",
            hyst_blocked,
            f"Δ{spread_gap} pts",
            "Long/Short scores too close; standing down." if hyst_blocked else "Clear directional dominance.",
        )
    )

    hard_vetoes = [g.id for g in gates if g.hard_veto]
    if hard_vetoes or total_score < 62:
        decision: Literal["PROPOSE_LONG", "PROPOSE_SHORT", "STAND_DOWN"] = "STAND_DOWN"
        grade: ConvictionGrade = "STAND_DOWN"
        risk_mult = 0.0
        summary_en = f"STAND DOWN ({total_score}/100): Blocked by {', '.join(hard_vetoes) if hard_vetoes else 'confluence < 62'}."
        summary_fa = f"توقف هوشمند ({total_score}/100): به دلیل فعال شدن فیلتر ضد هیجان از ورود جلوگیری شد."
    else:
        decision = "PROPOSE_LONG" if candidate == "LONG" else "PROPOSE_SHORT"
        grade = "A+" if total_score >= 82 else "A" if total_score >= 72 else "B"
        risk_mult = 1.0 if grade == "A+" else 0.75 if grade == "A" else 0.5
        if news_gate_state == "CAUTION":
            risk_mult = min(risk_mult, 0.5)
        summary_en = f"{decision.replace('_', ' ')} [Grade {grade} · {total_score}/100]: H4 {h4_bias}, RSI(14) {rsi_active.value:.1f}."
        summary_fa = f"سیگنال {candidate} [درجه {grade} · امتیاز {total_score}/100]: همسو با روند 4H و ساختار SMC/RSI."

    report = PayamBrainReport(
        execution_timeframe=timeframe,
        h4_bias=h4_bias,
        h1_bias=h1_bias,
        decision=decision,
        conviction_grade=grade,
        total_score=total_score,
        long_score=long_score,
        short_score=short_score,
        recommended_risk_multiplier=risk_mult,
        killzone=killzone,
        atr_extension=atr_ext,
        kaufman_efficiency=kaufman_er,
        golden_confluence=golden,
        pillars=pillars,
        defense_gates=gates,
        hard_vetoes=hard_vetoes,
        summary_en=summary_en,
        summary_fa=summary_fa,
    )
    return report, rsi_by_tf, dealing
