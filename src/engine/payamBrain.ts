import type {
  AgentConfig,
  AgentProposal,
  BasisDivergence,
  Candle,
  ConfluencePillarScore,
  ConvictionGrade,
  DealingRangeSnapshot,
  DefenseGateResult,
  FairValueGap,
  KillzoneWindow,
  LiquidityPool,
  MarketRegime,
  NewsGateStatus,
  OrderBlock,
  PayamBrainReport,
  RsiDivergenceKind,
  RsiRegimeLabel,
  RsiSnapshot,
  RsiTimeframeState,
  StructureEvent,
  TfsSnapshot,
  Timeframe,
  TimeframeAlignmentRow,
  TpiSnapshot,
} from './types';

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const BRAIN_PILLAR_WEIGHTS = {
  HTF_NARRATIVE_ALIGNMENT: 15,
  LIQUIDITY_RAID_SWEEP: 25,
  MSS_BOS_DISPLACEMENT: 20,
  FVG_CE_OTE_GOLDEN_ZONE: 20,
  RSI_TETHER_TRIGGER: 12,
  KILLZONE_SPREAD_MACRO: 8,
} as const;

export type SniperPillarKey = keyof typeof BRAIN_PILLAR_WEIGHTS;

export const MIN_CONFLUENCE_TRADE_SCORE = 62;
export const GRADE_A_SCORE = 72;
export const GRADE_A_PLUS_SCORE = 82;
export const HYSTERESIS_MARGIN_PTS = 8;

export type LiquidityPoolKind =
  | 'ASIAN_HIGH'
  | 'ASIAN_LOW'
  | 'LONDON_HIGH'
  | 'LONDON_LOW'
  | 'NY_HIGH'
  | 'NY_LOW'
  | 'PDH'
  | 'PDL'
  | 'EQH'
  | 'EQL'
  | 'SWING_BSL'
  | 'SWING_SSL';

export type LiquiditySweepStatus = 'UNTOUCHED' | 'SWEPT_AND_RECLAIMED' | 'STRUCTURAL_BREAKOUT';

export interface InstitutionalLiquidityPool extends LiquidityPool {
  poolKind?: LiquidityPoolKind;
  sweepStatus?: LiquiditySweepStatus;
  sweepTime?: number;
  sweepBarIndex?: number;
  /** Rejection wick divided by total candle range (strict >= 0.45 required for sweep) */
  rejectionWickRatio?: number;
}

export interface InstitutionalStructureEvent extends StructureEvent {
  structureTag?: 'BOS' | 'MSS' | 'CHoCH';
  afterLiquiditySweep?: boolean;
  displacementScore?: number;
  bodyToAtr?: number;
  bodyToRange?: number;
  hasInstitutionalDisplacement?: boolean;
  impulseOriginPrice?: number;
  impulseOriginTime?: number;
  impulseExtremePrice?: number;
  impulseExtremeTime?: number;
  breakBarIndex?: number;
}

export type FvgMitigationState =
  | 'UNMITIGATED'
  | 'TOUCHED_NEAR_EDGE'
  | 'CE50_TESTED'
  | 'INVALIDATED_INVERSION';

export interface InstitutionalFairValueGap extends FairValueGap {
  createdByBosOrMss?: boolean;
  mitigationState?: FvgMitigationState;
}

export interface InstitutionalOrderBlock extends OrderBlock {
  obKind?: 'OB_ORIGIN' | 'REJECTION_BLOCK';
  mt50FvgOverlap?: boolean;
  linkedToStructure?: boolean;
}

export interface InstitutionalDealingRangeSnapshot extends DealingRangeSnapshot {
  oteLong790?: number;
  oteShort790?: number;
  impulseAnchored?: boolean;
  impulseDirection?: 'BULLISH' | 'BEARISH' | 'RANGE';
  impulseStartTime?: number;
  impulseEndTime?: number;
  goldenSniperConfluence?: boolean;
}

export interface RsiPullbackHookResult {
  active: boolean;
  direction: 'LONG' | 'SHORT' | 'NONE';
  timeframe: 'M5' | 'M1' | null;
  hookDelta: number;
  priorRsi: number;
  currentRsi: number;
  atSniperPoi: boolean;
}

export interface SniperStageStatus {
  stage: 1 | 2 | 3 | 4 | 5;
  key:
    | 'HTF_NARRATIVE'
    | 'LIQUIDITY_SWEEP'
    | 'MSS_BOS_DISPLACEMENT'
    | 'FVG_CE_OTE_RETRACE'
    | 'RSI_TETHER_EXECUTION_TRIGGER';
  label: string;
  passed: boolean;
  score: number;
  maxScore: number;
  detail: string;
}

export interface SniperStateMachineSnapshot {
  currentStage: 0 | 1 | 2 | 3 | 4 | 5;
  completedStages: number;
  readyToSnipe: boolean;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  primaryDriverTf: 'M15' | 'M5' | 'M1';
  stages: SniperStageStatus[];
  tfsMtf: {
    M15: TfsSnapshot;
    M5: TfsSnapshot;
    M1: TfsSnapshot;
  };
  rsiHook: RsiPullbackHookResult;
}

export interface SniperConfluencePillarScore extends ConfluencePillarScore {
  pillarKey?: SniperPillarKey;
}

export interface SniperDefenseGateResult extends DefenseGateResult {
  vetoCode?: string;
}

export interface SniperPayamBrainReport extends PayamBrainReport {
  pillars: SniperConfluencePillarScore[];
  defenseGates: SniperDefenseGateResult[];
  sniperStateMachine?: SniperStateMachineSnapshot;
  tfsMtf?: {
    M15: TfsSnapshot;
    M5: TfsSnapshot;
    M1: TfsSnapshot;
  };
  rsiPullbackHook?: RsiPullbackHookResult;
  rolloverDeadzoneLockout?: boolean;
}

export interface SniperAgentProposal extends AgentProposal {
  recommendedOrderType?: 'LIMIT' | 'MARKET';
  sniperZone?: {
    low: number;
    high: number;
    sweetSpot: number;
  };
  invalidationPrice?: number;
  ttlBars?: number;
}

/**
 * Local ATR(14) helper so payamBrain stays free of circular runtime dependencies.
 */
function computeLocalAtr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 2.5;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  const slice = trs.slice(-period);
  return round3(slice.reduce((acc, v) => acc + v, 0) / Math.max(1, slice.length));
}

/**
 * Local TFS Donchian Equilibrium + Velocity Oscillator + MBO fallback (matches smcQuant.computeTfsSuite).
 */
function computeLocalTfs(candles: Candle[], lookback = 20): TfsSnapshot {
  if (candles.length < 5) {
    return {
      tetherPrice: candles[candles.length - 1]?.close ?? 0,
      velocityOscillator: 0,
      mboScore: 0,
      bias: 'NEUTRAL',
    };
  }
  const win = candles.slice(-lookback);
  const hi = Math.max(...win.map((c) => c.high));
  const lo = Math.min(...win.map((c) => c.low));
  const tetherPrice = round2((hi + lo) / 2);
  const closes = win.map((c) => c.close);
  const fast = closes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, closes.length);
  const slow = closes.reduce((a, b) => a + b, 0) / closes.length;
  const velocityOscillator = round3(((fast - slow) / Math.max(1, slow)) * 1000);
  const mboScore = round3(((closes[closes.length - 1] - tetherPrice) / Math.max(0.01, hi - lo)) * 2);
  const bias: TfsSnapshot['bias'] =
    velocityOscillator > 0.15 && mboScore > 0.1
      ? 'BULLISH'
      : velocityOscillator < -0.15 && mboScore < -0.1
        ? 'BEARISH'
        : 'NEUTRAL';
  return { tetherPrice, velocityOscillator, mboScore, bias };
}

/**
 * Computes Exponential Moving Average series for trend & equilibrium anchoring.
 */
export function computeEmaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (Math.max(1, period) + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/**
 * Computes true Wilder's Smoothed RSI(14) series (0..100).
 * Matches institutional TradingView / Bloomberg RSI calculation exactly.
 */
export function computeWilderRsiSeries(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];
  if (candles.length <= period) {
    return candles.map(() => 50);
  }

  const out: number[] = new Array(candles.length).fill(50);
  let sumGain = 0;
  let sumLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    if (diff > 0) sumGain += diff;
    else sumLoss += -diff;
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;
  out[period] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : round2(100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < candles.length; i++) {
    const diff = candles[i].close - candles[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : round2(100 - 100 / (1 + avgGain / avgLoss));
  }

  return out;
}

/**
 * Module 5 — Synchronized Pivot RSI Divergence Detector.
 * Evaluates BOTH bullish trough pairs AND bearish peak pairs across the last 40 bars,
 * returning the MOST RECENT valid divergence (eliminating the bullish early-return masking bug).
 */
export function detectRsiDivergence(candles: Candle[], rsiSeries: number[], swingRadius = 2): RsiDivergenceKind {
  const n = Math.min(candles.length, rsiSeries.length);
  if (n < 22) return 'NONE';

  const startIdx = Math.max(swingRadius + 14, n - 40);
  const swingLows: Array<{ idx: number; price: number; rsi: number }> = [];
  const swingHighs: Array<{ idx: number; price: number; rsi: number }> = [];

  for (let i = startIdx; i < n - swingRadius; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - swingRadius; j <= i + swingRadius; j++) {
      if (j === i) continue;
      if (candles[j].low <= candles[i].low) isLow = false;
      if (candles[j].high >= candles[i].high) isHigh = false;
    }
    if (isLow) swingLows.push({ idx: i, price: candles[i].low, rsi: rsiSeries[i] });
    if (isHigh) swingHighs.push({ idx: i, price: candles[i].high, rsi: rsiSeries[i] });
  }

  interface DivergenceCandidate {
    kind: RsiDivergenceKind;
    pivotIdx: number;
    priority: number; // regular > hidden on identical pivot bar
    rsiDelta: number;
  }

  const candidates: DivergenceCandidate[] = [];

  // Evaluate ALL recent valid bullish trough pairs (do NOT early-return!)
  for (let b = swingLows.length - 1; b >= 1; b--) {
    const curr = swingLows[b];
    if (n - 1 - curr.idx > 14) break;
    for (let a = b - 1; a >= Math.max(0, b - 3); a--) {
      const prev = swingLows[a];
      if (curr.idx - prev.idx < 3) continue;
      // Bullish Regular: Price Lower Low, RSI Higher Low
      if (curr.price < prev.price * 0.9998 && curr.rsi > prev.rsi + 2.2 && curr.rsi < 54) {
        candidates.push({
          kind: 'BULLISH_REGULAR',
          pivotIdx: curr.idx,
          priority: 2,
          rsiDelta: curr.rsi - prev.rsi,
        });
        break;
      }
      // Bullish Hidden: Price Higher Low, RSI Lower Low
      if (curr.price > prev.price * 1.0002 && curr.rsi < prev.rsi - 2.2 && curr.rsi >= 36 && curr.rsi <= 62) {
        candidates.push({
          kind: 'BULLISH_HIDDEN',
          pivotIdx: curr.idx,
          priority: 1,
          rsiDelta: prev.rsi - curr.rsi,
        });
        break;
      }
    }
  }

  // Evaluate ALL recent valid bearish peak pairs
  for (let b = swingHighs.length - 1; b >= 1; b--) {
    const curr = swingHighs[b];
    if (n - 1 - curr.idx > 14) break;
    for (let a = b - 1; a >= Math.max(0, b - 3); a--) {
      const prev = swingHighs[a];
      if (curr.idx - prev.idx < 3) continue;
      // Bearish Regular: Price Higher High, RSI Lower High
      if (curr.price > prev.price * 1.0002 && curr.rsi < prev.rsi - 2.2 && curr.rsi > 46) {
        candidates.push({
          kind: 'BEARISH_REGULAR',
          pivotIdx: curr.idx,
          priority: 2,
          rsiDelta: prev.rsi - curr.rsi,
        });
        break;
      }
      // Bearish Hidden: Price Lower High, RSI Higher High
      if (curr.price < prev.price * 0.9998 && curr.rsi > prev.rsi + 2.2 && curr.rsi >= 38 && curr.rsi <= 66) {
        candidates.push({
          kind: 'BEARISH_HIDDEN',
          pivotIdx: curr.idx,
          priority: 1,
          rsiDelta: curr.rsi - prev.rsi,
        });
        break;
      }
    }
  }

  if (candidates.length === 0) return 'NONE';
  candidates.sort((a, b) => b.pivotIdx - a.pivotIdx || b.priority - a.priority || b.rsiDelta - a.rsiDelta);
  return candidates[0].kind;
}

/**
 * Module 5 — M5/M1 RSI Pullback Hook Detector.
 * Detects when RSI on M5 or M1 pulls back into 38–48 (in bullish M15 regime)
 * or 52–62 (in bearish M15 regime) and hooks back in trade direction (|rsi[now] - rsi[now-1]| >= 1.8)
 * while price tests FVG CE50 / OTE 0.705.
 */
export function detectRsiPullbackHook(params: {
  m5RsiSeries: number[];
  m1RsiSeries?: number[];
  m15Regime: RsiRegimeLabel;
  priceInPoi?: boolean;
  preferredDirection?: 'LONG' | 'SHORT' | 'NEUTRAL';
}): RsiPullbackHookResult {
  const { m5RsiSeries, m1RsiSeries = [], m15Regime, priceInPoi = false, preferredDirection } = params;

  const evalSeries = (
    series: number[],
    tf: 'M5' | 'M1'
  ): RsiPullbackHookResult | null => {
    if (series.length < 3) return null;
    const now = series[series.length - 1];
    const prev = series[series.length - 2];
    const prev2 = series[series.length - 3];
    const delta = round2(now - prev);

    const allowBull =
      m15Regime === 'BULLISH_REGIME' ||
      (m15Regime === 'NEUTRAL_CHOP' && preferredDirection === 'LONG');
    const allowBear =
      m15Regime === 'BEARISH_REGIME' ||
      (m15Regime === 'NEUTRAL_CHOP' && preferredDirection === 'SHORT');

    const recentLow = Math.min(prev, prev2);
    const recentHigh = Math.max(prev, prev2);

    // Bullish pullback into 38–48 with upward hook >= +1.8
    if (allowBull && recentLow >= 38 && recentLow <= 48 && delta >= 1.8) {
      return {
        active: true,
        direction: 'LONG',
        timeframe: tf,
        hookDelta: delta,
        priorRsi: round2(prev),
        currentRsi: round2(now),
        atSniperPoi: priceInPoi,
      };
    }

    // Bearish pullback into 52–62 with downward hook <= -1.8
    if (allowBear && recentHigh >= 52 && recentHigh <= 62 && delta <= -1.8) {
      return {
        active: true,
        direction: 'SHORT',
        timeframe: tf,
        hookDelta: delta,
        priorRsi: round2(prev),
        currentRsi: round2(now),
        atSniperPoi: priceInPoi,
      };
    }

    return null;
  };

  // Prefer M5 hook (stronger institutional signal), fallback to M1 micro-hook
  const m5Hook = evalSeries(m5RsiSeries, 'M5');
  if (m5Hook) return m5Hook;
  const m1Hook = evalSeries(m1RsiSeries, 'M1');
  if (m1Hook) return m1Hook;

  const lastM5 = m5RsiSeries[m5RsiSeries.length - 1] ?? 50;
  const prevM5 = m5RsiSeries[m5RsiSeries.length - 2] ?? lastM5;
  return {
    active: false,
    direction: 'NONE',
    timeframe: null,
    hookDelta: round2(lastM5 - prevM5),
    priorRsi: round2(prevM5),
    currentRsi: round2(lastM5),
    atSniperPoi: priceInPoi,
  };
}

/**
 * Classifies Cardwell / Hayden RSI Regime (40-80 Bullish vs 20-60 Bearish vs Neutral Chop).
 */
export function analyzeRsiTimeframe(
  timeframe: Timeframe,
  candles: Candle[],
  period = 14,
  precomputedSeries?: number[]
): RsiTimeframeState {
  const series = precomputedSeries ?? computeWilderRsiSeries(candles, period);
  const value = series[series.length - 1] ?? 50;
  const prevValue = series[series.length - 2] ?? value;
  const slope = round2(value - (series[series.length - 4] ?? prevValue));

  const recent = series.slice(-24);
  const minRecent = recent.length > 0 ? Math.min(...recent) : 50;
  const maxRecent = recent.length > 0 ? Math.max(...recent) : 50;
  const avgRecent = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 50;

  let regime: RsiRegimeLabel = 'NEUTRAL_CHOP';
  if (minRecent >= 37 && (maxRecent >= 60 || avgRecent >= 53)) {
    regime = 'BULLISH_REGIME';
  } else if (maxRecent <= 63 && (minRecent <= 40 || avgRecent <= 47)) {
    regime = 'BEARISH_REGIME';
  } else if (avgRecent >= 55 && value >= 46) {
    regime = 'BULLISH_REGIME';
  } else if (avgRecent <= 45 && value <= 54) {
    regime = 'BEARISH_REGIME';
  }

  let zone: RsiTimeframeState['zone'] = 'NEUTRAL';
  if (value <= 30) zone = 'OVERSOLD_EXTREME';
  else if (value <= 45) zone = 'DISCOUNT_RESET';
  else if (value >= 70) zone = 'OVERBOUGHT_EXTREME';
  else if (value >= 55) zone = 'PREMIUM_RESET';

  const divergence = detectRsiDivergence(candles, series);

  return {
    timeframe,
    value: round2(value),
    prevValue: round2(prevValue),
    regime,
    zone,
    divergence,
    slope,
  };
}

export function computeRsiSnapshot(activeTimeframe: Timeframe, candlesByTf: Record<Timeframe, Candle[]>): RsiSnapshot {
  const tfs: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];
  const byTimeframe = {} as Record<Timeframe, RsiTimeframeState>;
  let activeSeries: number[] = [];
  for (const tf of tfs) {
    const tfCandles = candlesByTf[tf] ?? [];
    if (tf === activeTimeframe) {
      activeSeries = computeWilderRsiSeries(tfCandles, 14);
      byTimeframe[tf] = analyzeRsiTimeframe(tf, tfCandles, 14, activeSeries);
    } else {
      byTimeframe[tf] = analyzeRsiTimeframe(tf, tfCandles, 14);
    }
  }
  return {
    period: 14,
    activeSeries,
    byTimeframe,
    active: byTimeframe[activeTimeframe],
  };
}

export interface DealingRangeImpulseContext {
  structures?: InstitutionalStructureEvent[];
  liquidity?: InstitutionalLiquidityPool[];
  fvgs?: InstitutionalFairValueGap[];
  orderBlocks?: InstitutionalOrderBlock[];
  /** Optional M5/M15 FVGs and OBs for cross-TF goldenSniperConfluence check */
  scalpingFvgs?: InstitutionalFairValueGap[];
  scalpingObs?: InstitutionalOrderBlock[];
}

/**
 * Module 4 — True Impulse-Anchored Optimal Trade Entry (OTE).
 * When structural context (`structures`) is supplied, anchors the 0%–100% Dealing Range strictly
 * to the Active Verified Impulse Leg that produced the latest BOS or MSS/CHoCH (from swept
 * liquidity extreme to post-break impulse extreme), computes exact 0.500 / 0.618 / 0.705 / 0.790 levels,
 * and flags `goldenSniperConfluence = true` when 0.618–0.790 overlaps an unmitigated/CE50-tested FVG or OB_ORIGIN.
 * Preserves full backward compatibility when called with only `(timeframe, candles, lookback)`.
 */
export function computeDealingRange(
  timeframe: Timeframe,
  candles: Candle[],
  lookback = 48,
  impulseContext?: DealingRangeImpulseContext
): InstitutionalDealingRangeSnapshot {
  const slice = candles.slice(-lookback);
  if (slice.length === 0) {
    return {
      timeframe,
      swingHigh: 2750,
      swingLow: 2730,
      equilibrium50: 2740,
      oteLongLow: 2734.28,
      oteLongHigh: 2737.64,
      oteLongSweetSpot: 2735.9,
      oteLong790: 2734.2,
      oteShortLow: 2742.36,
      oteShortHigh: 2745.72,
      oteShortSweetSpot: 2744.1,
      oteShort790: 2745.8,
      positionPct: 50,
      zone: 'EQUILIBRIUM',
      impulseAnchored: false,
      impulseDirection: 'RANGE',
      goldenSniperConfluence: false,
    };
  }

  let swingHigh = slice[0].high;
  let swingLow = slice[0].low;
  let impulseAnchored = false;
  let impulseDirection: 'BULLISH' | 'BEARISH' | 'RANGE' = 'RANGE';
  let impulseStartTime: number | undefined;
  let impulseEndTime: number | undefined;

  const structures = impulseContext?.structures ?? [];
  const latestStruct = structures.length > 0 ? structures[structures.length - 1] : null;

  if (latestStruct) {
    const breakIdx =
      typeof latestStruct.breakBarIndex === 'number' &&
      latestStruct.breakBarIndex >= 0 &&
      latestStruct.breakBarIndex < candles.length
        ? latestStruct.breakBarIndex
        : candles.findIndex((c) => c.time === latestStruct.time);

    if (breakIdx >= 0) {
      const originTimeTarget = latestStruct.impulseOriginTime ?? latestStruct.swingTime;
      const originIdxFromStruct =
        typeof originTimeTarget === 'number'
          ? candles.findIndex((c) => c.time === originTimeTarget)
          : -1;
      const originSearchStart =
        originIdxFromStruct >= 0 && originIdxFromStruct <= breakIdx
          ? originIdxFromStruct
          : Math.max(0, breakIdx - 28);
      const sweepSearchStart = Math.max(0, breakIdx - 12);
      const postBreakEnd = candles.length - 1;
      const relevantSweeps = (impulseContext?.liquidity ?? []).filter(
        (p) =>
          p.sweepStatus === 'SWEPT_AND_RECLAIMED' &&
          p.sweepTime !== undefined &&
          p.sweepTime <= latestStruct.time &&
          p.sweepTime >= candles[sweepSearchStart].time &&
          ((latestStruct.direction === 'BULLISH' && p.side === 'SSL') ||
            (latestStruct.direction === 'BEARISH' && p.side === 'BSL'))
      );

      if (latestStruct.direction === 'BULLISH') {
        // Anchor 0% to swept SSL extreme low (or impulse origin low) -> 100% to post-break impulse high
        let legLow = latestStruct.impulseOriginPrice ?? Infinity;
        let legLowTime = latestStruct.impulseOriginTime ?? candles[originSearchStart].time;
        for (let i = originSearchStart; i <= breakIdx; i++) {
          if (candles[i].low < legLow) {
            legLow = candles[i].low;
            legLowTime = candles[i].time;
          }
        }
        for (const sw of relevantSweeps) {
          const swIdx = candles.findIndex((c) => c.time === sw.sweepTime);
          if (swIdx >= 0 && candles[swIdx].low <= legLow) {
            legLow = candles[swIdx].low;
            legLowTime = candles[swIdx].time;
          }
        }

        let legHigh = -Infinity;
        let legHighTime = candles[breakIdx].time;
        for (let i = breakIdx; i <= postBreakEnd; i++) {
          if (candles[i].high > legHigh) {
            legHigh = candles[i].high;
            legHighTime = candles[i].time;
          }
        }

        if (Number.isFinite(legLow) && Number.isFinite(legHigh) && legHigh > legLow + 0.25) {
          swingLow = legLow;
          swingHigh = legHigh;
          impulseAnchored = true;
          impulseDirection = 'BULLISH';
          impulseStartTime = legLowTime;
          impulseEndTime = legHighTime;
        }
      } else {
        // Anchor 100% to swept BSL extreme high (or impulse origin high) -> 0% to post-break impulse low
        let legHigh = latestStruct.impulseOriginPrice ?? -Infinity;
        let legHighTime = latestStruct.impulseOriginTime ?? candles[originSearchStart].time;
        for (let i = originSearchStart; i <= breakIdx; i++) {
          if (candles[i].high > legHigh) {
            legHigh = candles[i].high;
            legHighTime = candles[i].time;
          }
        }
        for (const sw of relevantSweeps) {
          const swIdx = candles.findIndex((c) => c.time === sw.sweepTime);
          if (swIdx >= 0 && candles[swIdx].high >= legHigh) {
            legHigh = candles[swIdx].high;
            legHighTime = candles[swIdx].time;
          }
        }

        let legLow = Infinity;
        let legLowTime = candles[breakIdx].time;
        for (let i = breakIdx; i <= postBreakEnd; i++) {
          if (candles[i].low < legLow) {
            legLow = candles[i].low;
            legLowTime = candles[i].time;
          }
        }

        if (Number.isFinite(legLow) && Number.isFinite(legHigh) && legHigh > legLow + 0.25) {
          swingLow = legLow;
          swingHigh = legHigh;
          impulseAnchored = true;
          impulseDirection = 'BEARISH';
          impulseStartTime = legHighTime;
          impulseEndTime = legLowTime;
        }
      }
    }
  }

  if (!impulseAnchored) {
    swingHigh = slice[0].high;
    swingLow = slice[0].low;
    for (const c of slice) {
      if (c.high > swingHigh) swingHigh = c.high;
      if (c.low < swingLow) swingLow = c.low;
    }
  }

  const span = Math.max(0.5, swingHigh - swingLow);
  const equilibrium50 = round2((swingHigh + swingLow) / 2);

  // Exact ICT OTE Fibonacci levels: 0.618, 0.705 (Sweet Spot), 0.790 (0.786 preserved when legacy 3-arg call)
  const deepRetrace = impulseContext ? 0.79 : 0.786;

  // Bullish retracement from High down into Discount OTE
  const oteLongHigh = round2(swingHigh - span * 0.618);
  const oteLongLow = round2(swingHigh - span * deepRetrace);
  const oteLongSweetSpot = round2(swingHigh - span * 0.705);
  const oteLong790 = round2(swingHigh - span * 0.79);

  // Bearish retracement from Low up into Premium OTE
  const oteShortLow = round2(swingLow + span * 0.618);
  const oteShortHigh = round2(swingLow + span * deepRetrace);
  const oteShortSweetSpot = round2(swingLow + span * 0.705);
  const oteShort790 = round2(swingLow + span * 0.79);

  const spot = candles[candles.length - 1].close;
  const positionPct = round2(clamp(((spot - swingLow) / span) * 100, 0, 100));

  let zone: DealingRangeSnapshot['zone'] = 'EQUILIBRIUM';
  if (positionPct <= 21.0) zone = 'DEEP_DISCOUNT';
  else if (positionPct <= 42) zone = 'DISCOUNT_OTE';
  else if (positionPct >= 79.0) zone = 'DEEP_PREMIUM';
  else if (positionPct >= 58) zone = 'PREMIUM_OTE';

  // Golden Sniper Confluence: 0.618–0.790 OTE overlaps an unmitigated/CE50-tested FVG or OB_ORIGIN on M5/M15
  const candidateFvgs = [...(impulseContext?.fvgs ?? []), ...(impulseContext?.scalpingFvgs ?? [])];
  const candidateObs = [...(impulseContext?.orderBlocks ?? []), ...(impulseContext?.scalpingObs ?? [])];

  const overlapsBand = (zoneLow: number, zoneHigh: number, bandLow: number, bandHigh: number) =>
    zoneLow <= bandHigh && zoneHigh >= bandLow;

  const checkBullGolden =
    candidateFvgs.some(
      (f) =>
        f.direction === 'BULLISH' &&
        !f.isInversion &&
        f.mitigationState !== 'INVALIDATED_INVERSION' &&
        (!f.mitigated || f.mitigationState === 'CE50_TESTED') &&
        overlapsBand(f.bottom, f.top, oteLong790, oteLongHigh)
    ) ||
    candidateObs.some(
      (o) =>
        o.direction === 'BULLISH' &&
        !o.mitigated &&
        !o.isBreaker &&
        overlapsBand(o.low, o.high, oteLong790, oteLongHigh)
    );

  const checkBearGolden =
    candidateFvgs.some(
      (f) =>
        f.direction === 'BEARISH' &&
        !f.isInversion &&
        f.mitigationState !== 'INVALIDATED_INVERSION' &&
        (!f.mitigated || f.mitigationState === 'CE50_TESTED') &&
        overlapsBand(f.bottom, f.top, oteShortLow, oteShort790)
    ) ||
    candidateObs.some(
      (o) =>
        o.direction === 'BEARISH' &&
        !o.mitigated &&
        !o.isBreaker &&
        overlapsBand(o.low, o.high, oteShortLow, oteShort790)
    );

  const goldenSniperConfluence =
    impulseDirection === 'BULLISH'
      ? checkBullGolden
      : impulseDirection === 'BEARISH'
        ? checkBearGolden
        : checkBullGolden || checkBearGolden;

  return {
    timeframe,
    swingHigh: round2(swingHigh),
    swingLow: round2(swingLow),
    equilibrium50,
    oteLongLow,
    oteLongHigh,
    oteLongSweetSpot,
    oteLong790,
    oteShortLow,
    oteShortHigh,
    oteShortSweetSpot,
    oteShort790,
    positionPct,
    zone,
    impulseAnchored,
    impulseDirection,
    ...(impulseStartTime !== undefined ? { impulseStartTime } : {}),
    ...(impulseEndTime !== undefined ? { impulseEndTime } : {}),
    goldenSniperConfluence,
  };
}

/**
 * Module 3 — Displacement Fair Value Gaps, 50% Consequent Encroachment & Inversion FVG (iFVG).
 * Tracks exact mitigation states: UNMITIGATED, TOUCHED_NEAR_EDGE, CE50_TESTED, INVALIDATED_INVERSION
 * and tags `createdByBosOrMss` when aligned structure confirms the displacement leg.
 */
export function enrichFairValueGaps(
  candles: Candle[],
  fvgs: FairValueGap[],
  atr: number,
  structures?: InstitutionalStructureEvent[]
): InstitutionalFairValueGap[] {
  const safeAtr = Math.max(0.8, atr);
  const structList = structures ?? [];
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) timeToIdx.set(candles[i].time, i);

  return fvgs.map((fvg) => {
    const idx = timeToIdx.get(fvg.startTime) ?? -1;
    const gapSize = Math.max(0.01, fvg.top - fvg.bottom);
    const atrMultiple = round2(gapSize / safeAtr);

    let maxFill = 0;
    let touchedNearEdge = false;
    let ce50WickTestedAndRespected = false;
    let bodyClosedPastCe50Time: number | undefined;
    let isInversion = false;
    let inversionTime: number | undefined;

    if (idx >= 0) {
      for (let k = idx + 2; k < candles.length; k++) {
        const f = candles[k];
        if (fvg.direction === 'BULLISH') {
          if (f.low <= fvg.top) {
            touchedNearEdge = true;
            maxFill = Math.max(maxFill, clamp((fvg.top - f.low) / gapSize, 0, 1));
          }
          if (f.close < fvg.bottom) {
            isInversion = true;
            if (inversionTime === undefined) inversionTime = f.time;
          } else if (f.low <= fvg.ce50) {
            if (f.close >= fvg.ce50) {
              ce50WickTestedAndRespected = true;
            } else if (bodyClosedPastCe50Time === undefined) {
              bodyClosedPastCe50Time = f.time;
            }
          }
        } else {
          if (f.high >= fvg.bottom) {
            touchedNearEdge = true;
            maxFill = Math.max(maxFill, clamp((f.high - fvg.bottom) / gapSize, 0, 1));
          }
          if (f.close > fvg.top) {
            isInversion = true;
            if (inversionTime === undefined) inversionTime = f.time;
          } else if (f.high >= fvg.ce50) {
            if (f.close <= fvg.ce50) {
              ce50WickTestedAndRespected = true;
            } else if (bodyClosedPastCe50Time === undefined) {
              bodyClosedPastCe50Time = f.time;
            }
          }
        }
      }
    }

    let mitigationState: FvgMitigationState = 'UNMITIGATED';
    if (isInversion) {
      mitigationState = 'INVALIDATED_INVERSION';
    } else if (ce50WickTestedAndRespected && bodyClosedPastCe50Time === undefined) {
      mitigationState = 'CE50_TESTED';
    } else if (touchedNearEdge) {
      mitigationState = 'TOUCHED_NEAR_EDGE';
    }

    // Mitigated flag: invalidated (iFVG) or body closed deeply past CE50; CE50_TESTED stays active!
    const effectiveMitTime = inversionTime ?? bodyClosedPastCe50Time;
    const mitigated = effectiveMitTime !== undefined && effectiveMitTime > fvg.startTime;

    // Tag createdByBosOrMss: true if an aligned BOS/MSS/CHoCH occurred within [-1, +3] bars of c2
    let createdByBosOrMss = (fvg as InstitutionalFairValueGap).createdByBosOrMss ?? false;
    if (!createdByBosOrMss && idx >= 0 && structList.length > 0) {
      const windowStart = candles[Math.max(0, idx - 1)].time;
      const windowEnd = candles[Math.min(candles.length - 1, idx + 3)].time;
      createdByBosOrMss = structList.some(
        (st) => st.direction === fvg.direction && st.time >= windowStart && st.time <= windowEnd
      );
    }

    const base: InstitutionalFairValueGap = {
      ...fvg,
      mitigated,
      atrMultiple,
      fillPct: round2(maxFill),
      isInversion,
      createdByBosOrMss,
      mitigationState,
    };

    if (mitigated && effectiveMitTime !== undefined) {
      base.mitigatedTime = effectiveMitTime;
    } else {
      delete base.mitigatedTime;
    }

    return base;
  });
}

/**
 * Module 3 — Institutional Origin Candle / Rejection Block (`OB_ORIGIN`) Quality Scoring.
 * Zero reliance on synthetic volume! Scored strictly by:
 * - Subsequent displacement magnitude in ATR multiples
 * - Origin candle body commitment ratio
 * - Liquidity-sweep proximity
 * - `mt50 = (open + close) / 2` overlap with unmitigated/CE50-tested FVG
 * - Verified BOS/MSS linkage & Breaker Block detection
 */
export function enrichOrderBlocks(
  candles: Candle[],
  orderBlocks: OrderBlock[],
  fvgs: FairValueGap[],
  atr: number,
  structures?: InstitutionalStructureEvent[],
  liquidity?: InstitutionalLiquidityPool[]
): InstitutionalOrderBlock[] {
  const safeAtr = Math.max(0.8, atr);
  const structList = structures ?? [];
  const liqList = liquidity ?? [];
  const timeToIdx = new Map<number, number>();
  for (let i = 0; i < candles.length; i++) timeToIdx.set(candles[i].time, i);

  return orderBlocks.map((ob) => {
    const idx = timeToIdx.get(ob.startTime) ?? -1;
    if (idx === -1) {
      return {
        ...ob,
        obKind: 'OB_ORIGIN',
        bodyRatio: 0.6,
        displacementAtr: 1.0,
        hasFvgConfluence: false,
        mt50FvgOverlap: false,
        sweptLiquidity: false,
        linkedToStructure: false,
        qualityScore: 55,
        isBreaker: false,
      };
    }

    const c = candles[idx];
    const totalRange = Math.max(0.05, c.high - c.low);
    const bodyRatio = round2(Math.abs(c.close - c.open) / totalRange);

    const nxt1 = candles[idx + 1];
    const nxt2 = candles[idx + 2];
    const nxt3 = candles[idx + 3];
    const dispMove =
      ob.direction === 'BULLISH'
        ? Math.max(
            (nxt1?.close ?? c.close) - c.low,
            (nxt2?.close ?? c.close) - c.low,
            (nxt3?.close ?? c.close) - c.low
          )
        : Math.max(
            c.high - (nxt1?.close ?? c.close),
            c.high - (nxt2?.close ?? c.close),
            c.high - (nxt3?.close ?? c.close)
          );
    const displacementAtr = round2(Math.max(0, dispMove / safeAtr));

    // Check liquidity-sweep proximity: swept prior 8 bars OR sits within 3 bars of a verified SWEPT_AND_RECLAIMED pool
    const priorStart = Math.max(0, idx - 8);
    let sweptPriorLocal = false;
    if (idx - priorStart >= 3) {
      if (ob.direction === 'BULLISH') {
        let minLow = Infinity;
        for (let k = priorStart; k < idx; k++) if (candles[k].low < minLow) minLow = candles[k].low;
        sweptPriorLocal = c.low < minLow;
      } else {
        let maxHigh = -Infinity;
        for (let k = priorStart; k < idx; k++) if (candles[k].high > maxHigh) maxHigh = candles[k].high;
        sweptPriorLocal = c.high > maxHigh;
      }
    }

    const nearVerifiedPoolSweep = liqList.some((p) => {
      if (p.sweepStatus !== 'SWEPT_AND_RECLAIMED' || p.sweepBarIndex === undefined) return false;
      const sideMatches =
        (ob.direction === 'BULLISH' && p.side === 'SSL') ||
        (ob.direction === 'BEARISH' && p.side === 'BSL');
      return sideMatches && Math.abs(p.sweepBarIndex - idx) <= 3;
    });
    const sweptLiquidity = sweptPriorLocal || nearVerifiedPoolSweep;

    // Check mt50 = (open + close) / 2 overlap or proximity with unmitigated/CE50-tested FVG
    const mt50 = round2((c.open + c.close) / 2);
    const mt50FvgOverlap = fvgs.some((f) => {
      if (f.direction !== ob.direction || f.isInversion) return false;
      return mt50 >= f.bottom - safeAtr * 0.25 && mt50 <= f.top + safeAtr * 0.25;
    });

    const hasFvgConfluence =
      mt50FvgOverlap ||
      fvgs.some((f) => {
        if (f.direction !== ob.direction || f.isInversion) return false;
        const dist =
          ob.direction === 'BULLISH'
            ? Math.abs(f.bottom - ob.high)
            : Math.abs(ob.low - f.top);
        const overlaps = f.bottom <= ob.high && f.top >= ob.low;
        return overlaps || dist <= safeAtr * 0.65;
      });

    // Check linkage to verified BOS/MSS structure event within 1..4 bars after origin candle
    const winEnd = candles[Math.min(candles.length - 1, idx + 4)].time;
    const linkedToStructure =
      (ob as InstitutionalOrderBlock).linkedToStructure ||
      structList.some(
        (st) => st.direction === ob.direction && st.time >= c.time && st.time <= winEnd
      );

    // Check Breaker Block flip (candle body closed cleanly past OB extreme)
    let isBreaker = false;
    for (let k = idx + 2; k < candles.length; k++) {
      if (ob.direction === 'BULLISH' ? candles[k].close < ob.low : candles[k].close > ob.high) {
        isBreaker = true;
        break;
      }
    }

    // Pure institutional price-action scoring — ZERO synthetic volume dependency!
    let score = 20;
    if (displacementAtr >= 2.0) score += 32;
    else if (displacementAtr >= 1.4) score += 25;
    else if (displacementAtr >= 0.95) score += 17;
    else score += 8;

    if (bodyRatio >= 0.6) score += 16;
    else if (bodyRatio >= 0.45) score += 11;
    else score += 5;

    if (sweptLiquidity) score += 14;
    if (mt50FvgOverlap) score += 18;
    else if (hasFvgConfluence) score += 11;
    if (linkedToStructure) score += 10;

    if (ob.mitigated) score -= 18;
    if (isBreaker) score -= 14;

    return {
      ...ob,
      mt50,
      obKind: linkedToStructure ? 'OB_ORIGIN' : 'REJECTION_BLOCK',
      bodyRatio,
      displacementAtr,
      hasFvgConfluence,
      mt50FvgOverlap,
      sweptLiquidity,
      linkedToStructure,
      isBreaker,
      qualityScore: Math.round(clamp(score, 10, 100)),
    };
  });
}

/**
 * Module 1 — Shared Strict Sweep vs. Breakout Classifier.
 * - Marks `SWEPT_AND_RECLAIMED` ONLY if price breaches by wick (`high > level + 0.05` for BSL or
 *   `low < level - 0.05` for SSL) AND closes back inside within 1 to 3 candles with
 *   rejection wick ratio >= 0.45 of candle range.
 * - If a candle closes beyond the level with body > 0.35 * ATR, classifies as `STRUCTURAL_BREAKOUT`, NEVER a sweep!
 */
export function evaluateLiquidityPoolSweep(
  candles: Candle[],
  poolFormationIdx: number,
  side: 'BSL' | 'SSL',
  level: number,
  atr: number
): {
  sweepStatus: LiquiditySweepStatus;
  swept: boolean;
  sweepRejected: boolean;
  sweepTime?: number;
  sweepBarIndex?: number;
  rejectionWickRatio: number;
  wickToBodyRatio: number;
} {
  const safeAtr = Math.max(0.4, atr);
  const start = Math.max(0, poolFormationIdx + 1);

  const singleWickMetrics = (c: Candle) => {
    const rng = Math.max(0.01, c.high - c.low);
    const body = Math.max(0.05, Math.abs(c.close - c.open));
    const wick =
      side === 'BSL'
        ? c.high - Math.max(c.open, c.close)
        : Math.min(c.open, c.close) - c.low;
    return {
      wickToRange: Math.max(0, wick) / rng,
      wickToBody: Math.max(0, wick) / body,
    };
  };

  for (let k = start; k < candles.length; k++) {
    const c = candles[k];
    const breached = side === 'BSL' ? c.high > level + 0.05 : c.low < level - 0.05;
    if (!breached) continue;

    // Immediate breakout check on breach bar: body close beyond level with body > 0.35 * ATR => NEVER a sweep
    const bodyK = Math.abs(c.close - c.open);
    const closedBeyondK = side === 'BSL' ? c.close > level : c.close < level;
    if (closedBeyondK && bodyK > 0.35 * safeAtr) {
      return {
        sweepStatus: 'STRUCTURAL_BREAKOUT',
        swept: true,
        sweepRejected: false,
        sweepTime: c.time,
        sweepBarIndex: k,
        rejectionWickRatio: 0,
        wickToBodyRatio: 0,
      };
    }

    // Check reclaim within 1 to 3 candles (m = k, k+1, k+2)
    let compHigh = c.high;
    let compLow = c.low;
    const maxM = Math.min(candles.length - 1, k + 2);
    for (let m = k; m <= maxM; m++) {
      const cm = candles[m];
      if (cm.high > compHigh) compHigh = cm.high;
      if (cm.low < compLow) compLow = cm.low;

      const bodyM = Math.abs(cm.close - cm.open);
      const closedBeyondM = side === 'BSL' ? cm.close > level : cm.close < level;
      if (closedBeyondM && bodyM > 0.35 * safeAtr) {
        return {
          sweepStatus: 'STRUCTURAL_BREAKOUT',
          swept: true,
          sweepRejected: false,
          sweepTime: cm.time,
          sweepBarIndex: m,
          rejectionWickRatio: 0,
          wickToBodyRatio: 0,
        };
      }

      const reclaimed = side === 'BSL' ? cm.close < level : cm.close > level;
      if (reclaimed) {
        const mK = singleWickMetrics(c);
        const mM = singleWickMetrics(cm);
        const compRange = Math.max(0.01, compHigh - compLow);
        const compBody = Math.max(0.05, Math.abs(cm.close - c.open));
        const compWick =
          side === 'BSL'
            ? compHigh - Math.max(c.open, cm.close)
            : Math.min(c.open, cm.close) - compLow;
        const compWickToRange = Math.max(0, compWick) / compRange;
        const compWickToBody = Math.max(0, compWick) / compBody;

        const bestWickToRange =
          m === k ? mK.wickToRange : Math.max(mK.wickToRange, mM.wickToRange, compWickToRange);
        const bestWickToBody =
          m === k ? mK.wickToBody : Math.max(mK.wickToBody, mM.wickToBody, compWickToBody);

        if (bestWickToRange >= 0.45) {
          return {
            sweepStatus: 'SWEPT_AND_RECLAIMED',
            swept: true,
            sweepRejected: true,
            sweepTime: cm.time,
            sweepBarIndex: m,
            rejectionWickRatio: round2(bestWickToRange),
            wickToBodyRatio: round2(bestWickToBody),
          };
        }
      }
    }
  }

  return {
    sweepStatus: 'UNTOUCHED',
    swept: false,
    sweepRejected: false,
    rejectionWickRatio: 0,
    wickToBodyRatio: 0,
  };
}

/**
 * Module 1 — Institutional Liquidity Sweep & Breakout Footprint Detector.
 * Applies the strict Sweep vs. Breakout rule across all Session H/L, PDH/PDL, EQH/EQL,
 * and prior swing liquidity pools. Never mistakes a `STRUCTURAL_BREAKOUT` (body > 0.35*ATR close beyond)
 * for a stop-hunt sweep.
 */
export function detectLiquiditySweepFootprint(
  candles: Candle[],
  liquidity: LiquidityPool[]
): {
  active: boolean;
  side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE';
  level: number | null;
  wickRejectionRatio: number;
  wickToRangeRatio?: number;
  sweepStatus?: LiquiditySweepStatus;
  poolKind?: LiquidityPoolKind;
  sweepBarIndex?: number;
  enrichedLiquidity: InstitutionalLiquidityPool[];
} {
  if (candles.length < 16) {
    return {
      active: false,
      side: 'NONE',
      level: null,
      wickRejectionRatio: 0,
      wickToRangeRatio: 0,
      sweepStatus: 'UNTOUCHED',
      enrichedLiquidity: liquidity,
    };
  }

  const atr = computeLocalAtr(candles, 14);
  const tol = Math.max(0.08, atr * 0.12);
  const recentCutoffIdx = Math.max(0, candles.length - 12);

  let bestSweep: {
    side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH';
    level: number;
    wickToBody: number;
    wickToRange: number;
    barIndex: number;
    poolKind?: LiquidityPoolKind;
  } | null = null;

  const enrichedLiquidity: InstitutionalLiquidityPool[] = liquidity.map((pool) => {
    const instPool = pool as InstitutionalLiquidityPool;
    const poolIdx = candles.findIndex((c) => c.time >= pool.time);
    const formationIdx = poolIdx >= 0 ? poolIdx : Math.max(0, candles.length - 16);

    const evalRes = evaluateLiquidityPoolSweep(candles, formationIdx, pool.side, pool.level, atr);

    // Count distinct touches separated by >= 4 bars if not already counted
    let touches = pool.touches ?? 0;
    if (touches < 1) {
      let lastTouchIdx = -10;
      const scanStart = Math.max(0, candles.length - 60);
      for (let i = scanStart; i < candles.length; i++) {
        const hit =
          pool.side === 'BSL'
            ? Math.abs(candles[i].high - pool.level) <= tol
            : Math.abs(candles[i].low - pool.level) <= tol;
        if (hit && i - lastTouchIdx >= 4) {
          touches++;
          lastTouchIdx = i;
        }
      }
      touches = Math.max(1, touches);
    }

    if (
      evalRes.sweepStatus === 'SWEPT_AND_RECLAIMED' &&
      evalRes.sweepBarIndex !== undefined &&
      evalRes.sweepBarIndex >= recentCutoffIdx
    ) {
      const candidateSide: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' =
        pool.side === 'SSL' ? 'SSL_SWEEP_BULLISH' : 'BSL_SWEEP_BEARISH';
      if (
        !bestSweep ||
        evalRes.sweepBarIndex > bestSweep.barIndex ||
        (evalRes.sweepBarIndex === bestSweep.barIndex && evalRes.rejectionWickRatio > bestSweep.wickToRange)
      ) {
        bestSweep = {
          side: candidateSide,
          level: round2(pool.level),
          wickToBody: evalRes.wickToBodyRatio,
          wickToRange: evalRes.rejectionWickRatio,
          barIndex: evalRes.sweepBarIndex,
          poolKind: instPool.poolKind,
        };
      }
    }

    return {
      ...instPool,
      swept: evalRes.swept,
      sweepRejected: evalRes.sweepRejected,
      sweepStatus: evalRes.sweepStatus,
      ...(evalRes.sweepTime !== undefined ? { sweepTime: evalRes.sweepTime } : {}),
      ...(evalRes.sweepBarIndex !== undefined ? { sweepBarIndex: evalRes.sweepBarIndex } : {}),
      rejectionWickRatio: evalRes.rejectionWickRatio,
      touches,
    };
  });

  // Fallback scan of prior swing high/low window if no explicit pool triggered a recent sweep
  if (!bestSweep && candles.length >= 24) {
    const priorEndIdx = candles.length - 6;
    const priorStartIdx = Math.max(0, candles.length - 36);
    let maxIdx = priorStartIdx;
    let minIdx = priorStartIdx;
    for (let i = priorStartIdx + 1; i < priorEndIdx; i++) {
      if (candles[i].high > candles[maxIdx].high) maxIdx = i;
      if (candles[i].low < candles[minIdx].low) minIdx = i;
    }
    const bslRes = evaluateLiquidityPoolSweep(candles, priorEndIdx - 1, 'BSL', candles[maxIdx].high, atr);
    const sslRes = evaluateLiquidityPoolSweep(candles, priorEndIdx - 1, 'SSL', candles[minIdx].low, atr);

    if (sslRes.sweepStatus === 'SWEPT_AND_RECLAIMED' && sslRes.sweepBarIndex !== undefined) {
      bestSweep = {
        side: 'SSL_SWEEP_BULLISH',
        level: round2(candles[minIdx].low),
        wickToBody: sslRes.wickToBodyRatio,
        wickToRange: sslRes.rejectionWickRatio,
        barIndex: sslRes.sweepBarIndex,
        poolKind: 'SWING_SSL',
      };
    }
    if (
      bslRes.sweepStatus === 'SWEPT_AND_RECLAIMED' &&
      bslRes.sweepBarIndex !== undefined &&
      (!bestSweep || bslRes.sweepBarIndex > bestSweep.barIndex)
    ) {
      bestSweep = {
        side: 'BSL_SWEEP_BEARISH',
        level: round2(candles[maxIdx].high),
        wickToBody: bslRes.wickToBodyRatio,
        wickToRange: bslRes.rejectionWickRatio,
        barIndex: bslRes.sweepBarIndex,
        poolKind: 'SWING_BSL',
      };
    }
  }

  const anyBreakout = enrichedLiquidity.some((p) => p.sweepStatus === 'STRUCTURAL_BREAKOUT');

  return {
    active: bestSweep !== null,
    side: bestSweep?.side ?? 'NONE',
    level: bestSweep?.level ?? null,
    wickRejectionRatio: bestSweep?.wickToBody ?? 0,
    wickToRangeRatio: bestSweep?.wickToRange ?? 0,
    sweepStatus: bestSweep ? 'SWEPT_AND_RECLAIMED' : anyBreakout ? 'STRUCTURAL_BREAKOUT' : 'UNTOUCHED',
    ...(bestSweep?.poolKind ? { poolKind: bestSweep.poolKind } : {}),
    ...(bestSweep ? { sweepBarIndex: bestSweep.barIndex } : {}),
    enrichedLiquidity,
  };
}

/**
 * Checks whether a UTC timestamp falls inside the Interbank Rollover Deadzone (21:00–23:59 UTC).
 */
export function isRolloverDeadzoneUtc(nowMs = Date.now()): boolean {
  const hourUtc = new Date(nowMs).getUTCHours();
  return hourUtc >= 21 && hourUtc <= 23;
}

/**
 * Classifies current UTC institutional Gold trading session / killzone.
 */
export function classifyKillzoneWindow(nowMs = Date.now()): KillzoneWindow {
  const hourUtc = new Date(nowMs).getUTCHours();
  if (hourUtc >= 7 && hourUtc < 10) return 'LONDON_OPEN';
  if (hourUtc >= 12 && hourUtc < 15) return 'NY_OVERLAP';
  if (hourUtc >= 15 && hourUtc < 17) return 'NY_AM';
  if (hourUtc >= 0 && hourUtc < 4) return 'ASIAN_ACCUMULATION';
  return 'OFF_SESSION';
}

/**
 * Computes Timeframe-Adaptive Structural Stop Floor (replaces hardcoded $3.60 floor).
 * - M1 / M5: Math.max(1.40, spread * 3.5, ATR_M5 * 0.55)
 * - M15:     Math.max(2.40, spread * 4.0, ATR_M15 * 0.75)
 * - M30+:    Math.max(2.40, spread * 4.0, atr * 0.85)
 */
export function computeAdaptiveStopFloor(
  timeframe: Timeframe,
  spread: number,
  atr: number,
  atrByTf?: Partial<Record<Timeframe, number>>
): number {
  const safeSpread = Math.max(0.05, Number.isFinite(spread) ? spread : 0.24);
  const safeAtr = Math.max(0.5, Number.isFinite(atr) ? atr : 2.0);
  if (timeframe === 'M1' || timeframe === 'M5') {
    const atrM5 = Math.max(0.5, atrByTf?.M5 ?? safeAtr);
    return round2(Math.max(1.4, safeSpread * 3.5, atrM5 * 0.55));
  }
  if (timeframe === 'M15') {
    const atrM15 = Math.max(0.8, atrByTf?.M15 ?? safeAtr);
    return round2(Math.max(2.4, safeSpread * 4.0, atrM15 * 0.75));
  }
  return round2(Math.max(2.4, safeSpread * 4.0, safeAtr * 0.85));
}

/**
 * Computes Kaufman Efficiency Ratio (0..1): high values = clean directional impulse, low values = choppy whipsaw.
 */
export function computeKaufmanEfficiency(candles: Candle[], window = 16): number {
  const slice = candles.slice(-window);
  if (slice.length < 4) return 0.5;
  const netMove = Math.abs(slice[slice.length - 1].close - slice[0].close);
  let sumMove = 0;
  for (let i = 1; i < slice.length; i++) {
    sumMove += Math.abs(slice[i].close - slice[i - 1].close);
  }
  return round3(clamp(netMove / Math.max(0.01, sumMove), 0, 1));
}

/**
 * Computes structural bias & strength (-1..+1) for a specific timeframe.
 */
export function evaluateTimeframeBias(
  candles: Candle[],
  rsiState: RsiTimeframeState,
  structures: StructureEvent[]
): { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string } {
  if (candles.length < 12) {
    return { bias: 'NEUTRAL', strength: 0, lastStructure: 'INIT' };
  }
  const closes = candles.map((c) => c.close);
  const ema20 = computeEmaSeries(closes, 20);
  const ema50 = computeEmaSeries(closes, Math.min(50, closes.length));
  const lastClose = closes[closes.length - 1];
  const e20 = ema20[ema20.length - 1];
  const e50 = ema50[ema50.length - 1];

  let score = 0;
  if (lastClose > e20 && e20 > e50) score += 0.4;
  else if (lastClose < e20 && e20 < e50) score -= 0.4;
  else if (lastClose > e50) score += 0.15;
  else if (lastClose < e50) score -= 0.15;

  const lastStr = structures[structures.length - 1] as InstitutionalStructureEvent | undefined;
  if (lastStr) {
    const tag = lastStr.structureTag ?? lastStr.kind;
    const mult = tag === 'MSS' ? 0.38 : tag === 'CHoCH' ? 0.34 : 0.28;
    score += lastStr.direction === 'BULLISH' ? mult : -mult;
  }

  if (rsiState.regime === 'BULLISH_REGIME') score += 0.25;
  else if (rsiState.regime === 'BEARISH_REGIME') score -= 0.25;

  const strength = round3(clamp(score, -1, 1));
  const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    strength >= 0.22 ? 'BULLISH' : strength <= -0.22 ? 'BEARISH' : 'NEUTRAL';

  const labelTag = lastStr ? (lastStr.structureTag ?? lastStr.kind) : null;
  return {
    bias,
    strength,
    lastStructure: lastStr && labelTag ? `${lastStr.direction === 'BULLISH' ? 'Bull' : 'Bear'} ${labelTag}` : 'Range',
  };
}

export interface PayamBrainInput {
  executionTimeframe: Timeframe;
  candlesByTf: Record<Timeframe, Candle[]>;
  fvgs: InstitutionalFairValueGap[];
  orderBlocks: InstitutionalOrderBlock[];
  structures: InstitutionalStructureEvent[];
  liquidity: InstitutionalLiquidityPool[];
  tpi: TpiSnapshot;
  regime: MarketRegime;
  rsi: RsiSnapshot;
  dealingRange: InstitutionalDealingRangeSnapshot;
  structuresByTf: Record<Timeframe, InstitutionalStructureEvent[]>;
  obsByTf: Record<Timeframe, InstitutionalOrderBlock[]>;
  fvgsByTf: Record<Timeframe, InstitutionalFairValueGap[]>;
  /** Optional precomputed TFS suites across M15, M5, M1 */
  tfsByTf?: Partial<Record<Timeframe, TfsSnapshot>>;
  /** Optional liquidity pools per scalping timeframe */
  liquidityByTf?: Partial<Record<Timeframe, InstitutionalLiquidityPool[]>>;
  newsGate?: NewsGateStatus;
  basis?: BasisDivergence;
  spread?: number;
  nowMs?: number;
  agentConfig?: Partial<AgentConfig>;
  newsShock?: { detected: boolean; headline?: string | null };
}

/**
 * Scores all 6 Scalping-First Institutional Pillars (total = 100 pts) for LONG or SHORT:
 * 1. HTF_NARRATIVE_ALIGNMENT (15)
 * 2. LIQUIDITY_RAID_SWEEP    (25)
 * 3. MSS_BOS_DISPLACEMENT    (20)
 * 4. FVG_CE_OTE_GOLDEN_ZONE  (20)
 * 5. RSI_TETHER_TRIGGER      (12)
 * 6. KILLZONE_SPREAD_MACRO   (8)
 */
function scoreDirectionPillars(
  dir: 'LONG' | 'SHORT',
  ctx: {
    spot: number;
    atr: number;
    spread: number;
    h4: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    h1: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    m15: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    m5: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    m1: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    execBias: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    rsi: RsiSnapshot;
    rsiHook: RsiPullbackHookResult;
    tfsMtf: { M15: TfsSnapshot; M5: TfsSnapshot; M1: TfsSnapshot };
    dealingRange: InstitutionalDealingRangeSnapshot;
    scalpStructures: InstitutionalStructureEvent[];
    obs: InstitutionalOrderBlock[];
    fvgs: InstitutionalFairValueGap[];
    scalpObs: InstitutionalOrderBlock[];
    scalpFvgs: InstitutionalFairValueGap[];
    liquidity: InstitutionalLiquidityPool[];
    sweep: {
      active: boolean;
      side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE';
      level: number | null;
      wickRejectionRatio: number;
      wickToRangeRatio?: number;
      poolKind?: LiquidityPoolKind;
    };
    killzone: KillzoneWindow;
    newsGate?: NewsGateStatus;
    basis?: BasisDivergence;
  }
): { total: number; pillars: SniperConfluencePillarScore[]; goldenConfluence: boolean } {
  const isLong = dir === 'LONG';
  const smcDir = isLong ? 'BULLISH' : 'BEARISH';
  const oppDir = isLong ? 'BEARISH' : 'BULLISH';

  // --- PILLAR 1: HTF Narrative Alignment (Max 15) ---
  // H4 & H1 act as macro regime / major POI filter; M15 is primary scalping driver
  let p1Score = 0;
  if (ctx.h4.bias === smcDir) p1Score += 5;
  else if (ctx.h4.bias === 'NEUTRAL') p1Score += 3;

  if (ctx.h1.bias === smcDir) p1Score += 4;
  else if (ctx.h1.bias === 'NEUTRAL') p1Score += 2;

  if (ctx.m15.bias === smcDir) p1Score += 6;
  else if (ctx.m15.bias === 'NEUTRAL') p1Score += 2;

  p1Score = clamp(p1Score, 0, BRAIN_PILLAR_WEIGHTS.HTF_NARRATIVE_ALIGNMENT);
  const p1Detail = `M15 ${ctx.m15.bias} (${ctx.m15.lastStructure}) · H1 ${ctx.h1.bias} · H4 ${ctx.h4.bias}`;

  // --- PILLAR 2: Liquidity Raid / Sweep (Max 25) ---
  const alignedSweep =
    (isLong && ctx.sweep.side === 'SSL_SWEEP_BULLISH') || (!isLong && ctx.sweep.side === 'BSL_SWEEP_BEARISH');
  const opposingSweep =
    (isLong && ctx.sweep.side === 'BSL_SWEEP_BEARISH') || (!isLong && ctx.sweep.side === 'SSL_SWEEP_BULLISH');
  const targetSide: 'BSL' | 'SSL' = isLong ? 'BSL' : 'SSL';
  const hasUntouchedTargetPool = ctx.liquidity.some(
    (p) =>
      p.side === targetSide &&
      p.sweepStatus !== 'STRUCTURAL_BREAKOUT' &&
      (isLong ? p.level > ctx.spot + ctx.atr * 0.6 : p.level < ctx.spot - ctx.atr * 0.6)
  );
  const highValuePoolSwept =
    alignedSweep &&
    ctx.sweep.poolKind !== undefined &&
    ['ASIAN_HIGH', 'ASIAN_LOW', 'LONDON_HIGH', 'LONDON_LOW', 'NY_HIGH', 'NY_LOW', 'PDH', 'PDL', 'EQH', 'EQL'].includes(
      ctx.sweep.poolKind
    );

  let p2Score = 0;
  if (alignedSweep) {
    p2Score += 17;
    if (highValuePoolSwept || (ctx.sweep.wickToRangeRatio ?? 0) >= 0.55) p2Score += 4;
    if (hasUntouchedTargetPool) p2Score += 4;
  } else if (opposingSweep) {
    p2Score = 2;
  } else {
    // No active raid yet: score based on clean directional liquidity draw & absence of opposing raid
    p2Score += 7;
    if (ctx.m15.bias === smcDir && ctx.m5.bias === smcDir) p2Score += 4;
    else if (ctx.m15.bias === smcDir || ctx.m5.bias === smcDir) p2Score += 2;
    if (hasUntouchedTargetPool) p2Score += 4;
  }
  p2Score = clamp(p2Score, 0, BRAIN_PILLAR_WEIGHTS.LIQUIDITY_RAID_SWEEP);
  const p2Detail = alignedSweep
    ? `SWEPT_AND_RECLAIMED ${ctx.sweep.poolKind ?? (isLong ? 'SSL' : 'BSL')} @ ${ctx.sweep.level?.toFixed(2)} (wick ${Math.round((ctx.sweep.wickToRangeRatio ?? 0.45) * 100)}%)`
    : opposingSweep
      ? `Opposing ${isLong ? 'BSL' : 'SSL'} sweep active @ ${ctx.sweep.level?.toFixed(2)}`
      : `Clean liquidity draw toward ${targetSide} · M5 ${ctx.m5.bias}`;

  // --- PILLAR 3: MSS / BOS + Displacement & Origin OB (Max 20) ---
  const sortedStructs = [...ctx.scalpStructures].sort((a, b) => a.time - b.time);
  const alignedStructs = sortedStructs.filter((s) => s.direction === smcDir);
  const latestAlignedStruct = alignedStructs[alignedStructs.length - 1];
  const latestAnyStruct = sortedStructs[sortedStructs.length - 1];
  const isLatestAligned = latestAnyStruct?.direction === smcDir;

  const candidateObs = [...ctx.obs, ...ctx.scalpObs].filter((o) => o.direction === smcDir && !o.isBreaker);
  const freshObs = candidateObs.filter((o) => !o.mitigated);
  const bestOb = (freshObs.length > 0 ? freshObs : candidateObs).sort(
    (a, b) => (b.qualityScore ?? 50) - (a.qualityScore ?? 50)
  )[0];

  let p3Score = 0;
  if (latestAlignedStruct) {
    const tag = latestAlignedStruct.structureTag ?? latestAlignedStruct.kind;
    if (tag === 'MSS') p3Score += isLatestAligned ? 10 : 8;
    else if (tag === 'CHoCH') p3Score += isLatestAligned ? 9 : 7;
    else p3Score += isLatestAligned ? 8 : 6;

    if (latestAlignedStruct.hasInstitutionalDisplacement) p3Score += 5;
    else if ((latestAlignedStruct.displacementScore ?? 0) >= 50) p3Score += 3;
  } else if (ctx.execBias.bias === smcDir) {
    p3Score += 6;
  }

  if (bestOb) {
    const obPts = bestOb.mitigated ? 2 : (bestOb.qualityScore ?? 50) >= 65 ? 5 : 4;
    p3Score += obPts;
  }
  p3Score = clamp(p3Score, 0, BRAIN_PILLAR_WEIGHTS.MSS_BOS_DISPLACEMENT);

  const p3Detail = latestAlignedStruct
    ? `${latestAlignedStruct.structureTag ?? latestAlignedStruct.kind} @ ${latestAlignedStruct.level.toFixed(2)} (Disp ${latestAlignedStruct.bodyToAtr?.toFixed(2) ?? '1.0'}xATR)${bestOb ? ` · OB_ORIGIN ${bestOb.mt50.toFixed(2)}` : ''}`
    : bestOb
      ? `OB_ORIGIN ${bestOb.mt50.toFixed(2)} (Q${bestOb.qualityScore ?? 60})`
      : 'Awaiting MSS/BOS displacement';

  // --- PILLAR 4: FVG / CE50 & Impulse-Anchored OTE Golden Zone (Max 20) ---
  const alignedFvgs = [...ctx.fvgs, ...ctx.scalpFvgs].filter(
    (f) => f.direction === smcDir && !f.isInversion && f.mitigationState !== 'INVALIDATED_INVERSION'
  );
  const activeFvgs = alignedFvgs.filter(
    (f) => !f.mitigated || f.mitigationState === 'CE50_TESTED' || f.mitigationState === 'TOUCHED_NEAR_EDGE'
  );
  const bestFvg = activeFvgs[activeFvgs.length - 1] ?? alignedFvgs[alignedFvgs.length - 1];
  const iFvgSupport = [...ctx.fvgs, ...ctx.scalpFvgs].some(
    (f) => f.direction === oppDir && (f.isInversion || f.mitigationState === 'INVALIDATED_INVERSION')
  );

  const goldenConfluence = Boolean(
    ctx.dealingRange.goldenSniperConfluence || (bestOb?.hasFvgConfluence && activeFvgs.length > 0)
  );

  let p4Score = 0;
  if (bestFvg) {
    const state = bestFvg.mitigationState ?? (bestFvg.mitigated ? 'TOUCHED_NEAR_EDGE' : 'UNMITIGATED');
    if (state === 'CE50_TESTED') p4Score += 9;
    else if (state === 'UNMITIGATED') p4Score += 8;
    else if (state === 'TOUCHED_NEAR_EDGE') p4Score += 6;
    if (bestFvg.createdByBosOrMss) p4Score += 2;
  } else if (iFvgSupport) {
    p4Score += 7;
  }

  // OTE / Premium-Discount pricing
  if (isLong) {
    if (ctx.dealingRange.zone === 'DISCOUNT_OTE' || ctx.dealingRange.zone === 'DEEP_DISCOUNT') p4Score += 5;
    else if (ctx.dealingRange.zone === 'EQUILIBRIUM') p4Score += 3;
    else p4Score += 1;
  } else {
    if (ctx.dealingRange.zone === 'PREMIUM_OTE' || ctx.dealingRange.zone === 'DEEP_PREMIUM') p4Score += 5;
    else if (ctx.dealingRange.zone === 'EQUILIBRIUM') p4Score += 3;
    else p4Score += 1;
  }

  if (goldenConfluence) p4Score += 5;
  else if (bestOb?.mt50FvgOverlap) p4Score += 3;

  p4Score = clamp(p4Score, 0, BRAIN_PILLAR_WEIGHTS.FVG_CE_OTE_GOLDEN_ZONE);
  const p4Detail = bestFvg
    ? `${goldenConfluence ? 'Golden OTE+FVG/OB' : `FVG ${bestFvg.mitigationState ?? 'ACTIVE'}`} CE ${bestFvg.ce50.toFixed(2)} · OTE 70.5% ${(isLong ? ctx.dealingRange.oteLongSweetSpot : ctx.dealingRange.oteShortSweetSpot).toFixed(2)}`
    : iFvgSupport
      ? `Inversion FVG (iFVG) + OTE ${ctx.dealingRange.positionPct.toFixed(0)}%`
      : `Dealing Range ${ctx.dealingRange.positionPct.toFixed(0)}% (${ctx.dealingRange.zone.replace('_', ' ')})`;

  // --- PILLAR 5: RSI Pullback Hook + TFS Tether/VO/MBO Trigger (Max 12) ---
  const rExec = ctx.rsi.active;
  const rM15 = ctx.rsi.byTimeframe.M15;
  const rM5 = ctx.rsi.byTimeframe.M5;
  const rH1 = ctx.rsi.byTimeframe.H1;
  let p5Score = 2;
  const p5Notes: string[] = [];

  if (isLong) {
    if (rM15.regime === 'BULLISH_REGIME' || rExec.regime === 'BULLISH_REGIME' || rH1.regime === 'BULLISH_REGIME') {
      p5Score += 3;
      p5Notes.push('Bull RSI');
    }
    if (ctx.rsiHook.active && ctx.rsiHook.direction === 'LONG') {
      p5Score += 4;
      p5Notes.push(`${ctx.rsiHook.timeframe} Hook +${ctx.rsiHook.hookDelta.toFixed(1)}`);
    } else if (
      rM5.divergence === 'BULLISH_REGULAR' ||
      rM5.divergence === 'BULLISH_HIDDEN' ||
      rExec.divergence === 'BULLISH_REGULAR' ||
      rExec.divergence === 'BULLISH_HIDDEN'
    ) {
      p5Score += 3;
      p5Notes.push('Bull Div');
    } else if (rExec.value >= 36 && rExec.value <= 58) {
      p5Score += 2;
      p5Notes.push('Pullback Reset');
    }
    if (rExec.value > 74) {
      p5Score -= 3;
      p5Notes.push('OB Penalty');
    }
    if (rExec.divergence === 'BEARISH_REGULAR') {
      p5Score -= rExec.value >= 55 ? 3 : 1;
      p5Notes.push('Opp Bear Div');
    }
  } else {
    if (rM15.regime === 'BEARISH_REGIME' || rExec.regime === 'BEARISH_REGIME' || rH1.regime === 'BEARISH_REGIME') {
      p5Score += 3;
      p5Notes.push('Bear RSI');
    }
    if (ctx.rsiHook.active && ctx.rsiHook.direction === 'SHORT') {
      p5Score += 4;
      p5Notes.push(`${ctx.rsiHook.timeframe} Hook ${ctx.rsiHook.hookDelta.toFixed(1)}`);
    } else if (
      rM5.divergence === 'BEARISH_REGULAR' ||
      rM5.divergence === 'BEARISH_HIDDEN' ||
      rExec.divergence === 'BEARISH_REGULAR' ||
      rExec.divergence === 'BEARISH_HIDDEN'
    ) {
      p5Score += 3;
      p5Notes.push('Bear Div');
    } else if (rExec.value >= 42 && rExec.value <= 64) {
      p5Score += 2;
      p5Notes.push('Rally Reset');
    }
    if (rExec.value < 26) {
      p5Score -= 3;
      p5Notes.push('OS Penalty');
    }
    if (rExec.divergence === 'BULLISH_REGULAR') {
      p5Score -= rExec.value <= 45 ? 3 : 1;
      p5Notes.push('Opp Bull Div');
    }
  }

  // TFS Tether / Velocity Oscillator / MBO confirmation across M15, M5, M1
  const tfsList = [ctx.tfsMtf.M15, ctx.tfsMtf.M5, ctx.tfsMtf.M1];
  const tfsMatches = tfsList.filter((t) => t.bias === smcDir).length;
  const tfsOpposing = tfsList.filter((t) => t.bias === oppDir).length;
  const tfsTetherAligned = isLong
    ? ctx.spot >= ctx.tfsMtf.M5.tetherPrice || ctx.spot >= ctx.tfsMtf.M15.tetherPrice
    : ctx.spot <= ctx.tfsMtf.M5.tetherPrice || ctx.spot <= ctx.tfsMtf.M15.tetherPrice;
  if (tfsMatches >= 2) {
    p5Score += 4;
    p5Notes.push(`TFS ${tfsMatches}/3`);
  } else if (tfsMatches === 1 || (tfsOpposing === 0 && tfsTetherAligned)) {
    p5Score += 2;
    p5Notes.push(`Tether ${ctx.tfsMtf.M5.tetherPrice.toFixed(1)}`);
  }

  p5Score = clamp(p5Score, 0, BRAIN_PILLAR_WEIGHTS.RSI_TETHER_TRIGGER);
  const p5Detail = `RSI M15 ${rM15.value.toFixed(1)} / M5 ${rM5.value.toFixed(1)} · VO ${ctx.tfsMtf.M5.velocityOscillator.toFixed(2)}${p5Notes.length ? ` · ${p5Notes.join(', ')}` : ''}`;

  // --- PILLAR 6: Killzone, Spread & Macro Hygiene (Max 8) ---
  let p6Score = 0;
  const p6Notes: string[] = [];
  if (ctx.killzone === 'LONDON_OPEN' || ctx.killzone === 'NY_OVERLAP') {
    p6Score += 3;
    p6Notes.push(ctx.killzone.replace('_', ' '));
  } else if (ctx.killzone === 'NY_AM' || ctx.killzone === 'ASIAN_ACCUMULATION') {
    p6Score += 2;
    p6Notes.push(ctx.killzone.replace('_', ' '));
  } else {
    p6Score += 1;
    p6Notes.push('Off-Session');
  }

  const spreadToAtr = ctx.spread / Math.max(0.5, ctx.atr);
  if (spreadToAtr <= 0.14) {
    p6Score += 2;
    p6Notes.push(`Spd $${ctx.spread.toFixed(2)}`);
  } else if (spreadToAtr <= 0.22) {
    p6Score += 1;
  }

  const newsClear = !ctx.newsGate || ctx.newsGate.state === 'CLEAR';
  const basisClean = !ctx.basis || !ctx.basis.cryptoInducementWarning;
  if (newsClear && basisClean) {
    p6Score += 3;
    p6Notes.push('Macro Clear');
  } else if (basisClean && ctx.newsGate?.state === 'CAUTION') {
    p6Score += 1;
    p6Notes.push('News Caution');
  }

  p6Score = clamp(p6Score, 0, BRAIN_PILLAR_WEIGHTS.KILLZONE_SPREAD_MACRO);
  const p6Detail = p6Notes.join(' · ');

  const statusOf = (score: number, max: number): ConfluencePillarScore['status'] => {
    const pct = score / Math.max(1, max);
    if (pct >= 0.72) return 'STRONG';
    if (pct >= 0.48) return 'MODERATE';
    if (pct >= 0.25) return 'WEAK';
    return 'OPPOSING';
  };

  // Preserve exact ConfluencePillarScore['id'] union compatibility with types.ts while attaching sniper pillarKey
  const pillars: SniperConfluencePillarScore[] = [
    {
      id: 'H4_COMPASS',
      pillarKey: 'HTF_NARRATIVE_ALIGNMENT',
      label: 'HTF Narrative Alignment',
      labelFa: 'همسویی روایت تایم‌فریم بالا و M15',
      score: p1Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.HTF_NARRATIVE_ALIGNMENT,
      status: statusOf(p1Score, BRAIN_PILLAR_WEIGHTS.HTF_NARRATIVE_ALIGNMENT),
      detail: p1Detail,
    },
    {
      id: 'H1_SWEEP_STRUCT',
      pillarKey: 'LIQUIDITY_RAID_SWEEP',
      label: 'Liquidity Raid & Sweep',
      labelFa: 'شکار نقدینگی سشن / EQH-EQL',
      score: p2Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.LIQUIDITY_RAID_SWEEP,
      status: statusOf(p2Score, BRAIN_PILLAR_WEIGHTS.LIQUIDITY_RAID_SWEEP),
      detail: p2Detail,
    },
    {
      id: 'OB_QUALITY',
      pillarKey: 'MSS_BOS_DISPLACEMENT',
      label: 'MSS/BOS & Displacement',
      labelFa: 'تغییر ساختار، دیسپلیسمنت و OB_ORIGIN',
      score: p3Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.MSS_BOS_DISPLACEMENT,
      status: statusOf(p3Score, BRAIN_PILLAR_WEIGHTS.MSS_BOS_DISPLACEMENT),
      detail: p3Detail,
    },
    {
      id: 'FVG_GOLDEN',
      pillarKey: 'FVG_CE_OTE_GOLDEN_ZONE',
      label: 'FVG CE50 & OTE Golden Zone',
      labelFa: 'ناحیه طلایی FVG CE50 و OTE ایمپالس',
      score: p4Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.FVG_CE_OTE_GOLDEN_ZONE,
      status: statusOf(p4Score, BRAIN_PILLAR_WEIGHTS.FVG_CE_OTE_GOLDEN_ZONE),
      detail: p4Detail,
    },
    {
      id: 'RSI_MOMENTUM',
      pillarKey: 'RSI_TETHER_TRIGGER',
      label: 'RSI Hook & TFS Tether Trigger',
      labelFa: 'هوک بازگشتی RSI و مومنتوم TFS Tether',
      score: p5Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.RSI_TETHER_TRIGGER,
      status: statusOf(p5Score, BRAIN_PILLAR_WEIGHTS.RSI_TETHER_TRIGGER),
      detail: p5Detail,
    },
    {
      id: 'OTE_SESSION_MACRO',
      pillarKey: 'KILLZONE_SPREAD_MACRO',
      label: 'Killzone, Spread & Macro',
      labelFa: 'کیل‌زون، اسپرد و فیلتر خبر',
      score: p6Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.KILLZONE_SPREAD_MACRO,
      status: statusOf(p6Score, BRAIN_PILLAR_WEIGHTS.KILLZONE_SPREAD_MACRO),
      detail: p6Detail,
    },
  ];

  const total = pillars.reduce((acc, p) => acc + p.score, 0);
  return { total, pillars, goldenConfluence };
}

/**
 * Evaluates the 7-Gate Anti-Emotion, Anti-Chasing, Rollover Deadzone (21:00–23:59 UTC), and Anti-Fakeout Defense Shield.
 */
function evaluateDefenseShield(ctx: {
  candidateDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  spot: number;
  atr: number;
  spread: number;
  candles: Candle[];
  h4: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number };
  rsi: RsiSnapshot;
  dealingRange: InstitutionalDealingRangeSnapshot;
  regime: MarketRegime;
  kaufmanEfficiency: number;
  atrExtensionSigned: number;
  longScore: number;
  shortScore: number;
  sweep: { active: boolean; side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE' };
  hasFreshFvg: boolean;
  newsGate?: NewsGateStatus;
  basis?: BasisDivergence;
  killzone: KillzoneWindow;
  nowMs: number;
  agentConfig?: Partial<AgentConfig>;
  newsShock?: { detected: boolean; headline?: string | null };
}): SniperDefenseGateResult[] {
  const isLong = ctx.candidateDirection === 'LONG';
  const isShort = ctx.candidateDirection === 'SHORT';
  const gates: SniperDefenseGateResult[] = [];

  // 1. USD News & Breaking Geopolitical Shock Shield
  if (ctx.newsShock?.detected) {
    gates.push({
      id: 'NEWS_SHIELD',
      label: 'USD Macro News Shield',
      status: 'BLOCKED',
      hardVeto: true,
      metric: 'SHOCK VETO',
      detail: `Emergency breaking headline shock detected ("${ctx.newsShock.headline ?? 'Macro Shock'}") — new entries hard-vetoed.`,
    });
  } else if (ctx.newsGate?.state === 'LOCKOUT') {
    gates.push({
      id: 'NEWS_SHIELD',
      label: 'USD Macro News Shield',
      status: 'BLOCKED',
      hardVeto: true,
      metric: 'LOCKOUT',
      detail: `High-impact USD release (${ctx.newsGate.activeEvent?.title ?? 'Macro'}) — all new entries hard-vetoed.`,
    });
  } else if (ctx.newsGate?.state === 'CAUTION') {
    gates.push({
      id: 'NEWS_SHIELD',
      label: 'USD Macro News Shield',
      status: 'CAUTION',
      hardVeto: false,
      metric: 'CAUTION 50%',
      detail: `Medium-impact USD release (${ctx.newsGate.activeEvent?.title ?? 'News'}) — lot capped to 50%.`,
    });
  } else {
    gates.push({
      id: 'NEWS_SHIELD',
      label: 'USD Macro News Shield',
      status: 'PASS',
      hardVeto: false,
      metric: 'CLEAR',
      detail: 'No imminent USD macro whipsaw window active.',
    });
  }

  // 2. Anti-Chasing ATR Rubber-Band Filter
  const directionalExt = isLong
    ? ctx.atrExtensionSigned
    : isShort
      ? -ctx.atrExtensionSigned
      : Math.abs(ctx.atrExtensionSigned);
  const rsiExtremeChase =
    (isLong && ctx.rsi.active.value >= 75) || (isShort && ctx.rsi.active.value <= 25);
  if (directionalExt > 1.85 || (directionalExt > 1.35 && rsiExtremeChase)) {
    gates.push({
      id: 'ANTI_CHASE_ATR',
      label: 'Anti-Chase ATR Extension',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `${directionalExt.toFixed(2)}x ATR`,
      detail: `Price overextended ${directionalExt.toFixed(2)}x ATR from EMA-20 equilibrium (RSI ${ctx.rsi.active.value.toFixed(1)}) — chasing vertical FOMO candle blocked.`,
    });
  } else if (directionalExt > 1.25) {
    gates.push({
      id: 'ANTI_CHASE_ATR',
      label: 'Anti-Chase ATR Extension',
      status: 'CAUTION',
      hardVeto: false,
      metric: `${directionalExt.toFixed(2)}x ATR`,
      detail: `Mild extension (${directionalExt.toFixed(2)}x ATR); prefer pullback Limit at OB_ORIGIN/FVG CE50 rather than chasing.`,
    });
  } else {
    gates.push({
      id: 'ANTI_CHASE_ATR',
      label: 'Anti-Chase ATR Extension',
      status: 'PASS',
      hardVeto: false,
      metric: `${directionalExt.toFixed(2)}x ATR`,
      detail: 'Entry sits cleanly near institutional mean without overextension.',
    });
  }

  // 3. Fakeout & Stop-Hunt Trap Guard (Climax Wick + PAXG Inducement)
  const last2 = ctx.candles.slice(-2);
  let climaxWickTrap = false;
  let climaxRatio = 0;
  for (const c of last2) {
    const rng = Math.max(0.05, c.high - c.low);
    const upperWickPct = (c.high - Math.max(c.open, c.close)) / rng;
    const lowerWickPct = (Math.min(c.open, c.close) - c.low) / rng;
    if (isLong && upperWickPct >= 0.68 && c.close < c.open && rng >= ctx.atr * 1.15) {
      climaxWickTrap = true;
      climaxRatio = round2(upperWickPct * 100);
    }
    if (isShort && lowerWickPct >= 0.68 && c.close > c.open && rng >= ctx.atr * 1.15) {
      climaxWickTrap = true;
      climaxRatio = round2(lowerWickPct * 100);
    }
  }

  if (ctx.basis?.cryptoInducementWarning) {
    gates.push({
      id: 'FAKEOUT_TRAP_GUARD',
      label: 'Fakeout & Basis Trap Guard',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `Basis ${ctx.basis.basisUsd >= 0 ? '+' : ''}$${ctx.basis.basisUsd.toFixed(2)}`,
      detail: 'PAXG crypto inducement decoupling detected; ignoring deceptive liquidity sweep.',
    });
  } else if (climaxWickTrap) {
    gates.push({
      id: 'FAKEOUT_TRAP_GUARD',
      label: 'Fakeout & Basis Trap Guard',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `Wick ${climaxRatio}%`,
      detail: `Opposing institutional climax rejection wick (${climaxRatio}% of range) detected — fake breakout trap blocked.`,
    });
  } else {
    gates.push({
      id: 'FAKEOUT_TRAP_GUARD',
      label: 'Fakeout & Basis Trap Guard',
      status: 'PASS',
      hardVeto: false,
      metric: ctx.basis ? `${ctx.basis.status}` : 'CLEAN',
      detail: 'No opposing climax wick trap or PAXG basis inducement detected.',
    });
  }

  // 4. 4H Macro Compass Alignment Gate
  const strongCounterH4 =
    (isLong && ctx.h4.strength <= -0.45) || (isShort && ctx.h4.strength >= 0.45);
  const allowCounterH4 = ctx.agentConfig?.allowCounterH4Scalps ?? false;
  const reversalConfirmed =
    allowCounterH4 &&
    ((isLong && ctx.sweep.side === 'SSL_SWEEP_BULLISH' && ctx.rsi.active.divergence === 'BULLISH_REGULAR') ||
      (isShort && ctx.sweep.side === 'BSL_SWEEP_BEARISH' && ctx.rsi.active.divergence === 'BEARISH_REGULAR'));

  if (strongCounterH4 && !reversalConfirmed) {
    gates.push({
      id: 'HTF_4H_COMPASS',
      label: '4H Trend Compass Gate',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `H4 ${ctx.h4.bias}`,
      detail: allowCounterH4
        ? `Trade fights strong 4H ${ctx.h4.bias} order flow without confirmed sweep + regular RSI divergence.`
        : `Counter-4H scalps disabled in Agent Constitution — refusing trade against strong 4H ${ctx.h4.bias} trend.`,
    });
  } else if (strongCounterH4 && reversalConfirmed) {
    gates.push({
      id: 'HTF_4H_COMPASS',
      label: '4H Trend Compass Gate',
      status: 'CAUTION',
      hardVeto: false,
      metric: 'COUNTER-4H REV',
      detail: 'Counter-4H reversal scalp permitted at 0.5x risk due to confirmed sweep + RSI regular divergence.',
    });
  } else {
    gates.push({
      id: 'HTF_4H_COMPASS',
      label: '4H Trend Compass Gate',
      status: 'PASS',
      hardVeto: false,
      metric: `H4 ${ctx.h4.bias}`,
      detail: `Aligned with 4H compass (${ctx.h4.bias}, strength ${ctx.h4.strength >= 0 ? '+' : ''}${ctx.h4.strength.toFixed(2)}).`,
    });
  }

  // 5. Chop, Session & Rollover Deadzone (21:00–23:59 UTC) Lockout Filter
  const spreadToAtr = ctx.spread / Math.max(0.5, ctx.atr);
  const rolloverLockout = isRolloverDeadzoneUtc(ctx.nowMs);
  const asianBlocked = ctx.agentConfig?.allowAsianSessionEntries === false && ctx.killzone === 'ASIAN_ACCUMULATION';

  if (rolloverLockout) {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      vetoCode: 'ROLLOVER_DEADZONE_LOCKOUT',
      label: 'Rollover Deadzone Lockout',
      status: 'BLOCKED',
      hardVeto: true,
      metric: 'ROLLOVER_DEADZONE_LOCKOUT',
      detail: 'ROLLOVER_DEADZONE_LOCKOUT (21:00–23:59 UTC) active — interbank liquidity vacuum & rollover spread widening hard-vetoed.',
    });
  } else if (asianBlocked) {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      label: 'Chop & Session Filter',
      status: 'BLOCKED',
      hardVeto: true,
      metric: 'ASIAN LOCK',
      detail: 'Asian Accumulation session entries disabled in Agent Settings — waiting for London/NY killzone.',
    });
  } else if (
    (ctx.regime.label === 'VOLATILE_EXPANSION' && ctx.kaufmanEfficiency < 0.22) ||
    spreadToAtr > 0.22
  ) {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      label: 'Chop & Whipsaw Filter',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `ER ${ctx.kaufmanEfficiency.toFixed(2)}`,
      detail: `High-noise whipsaw regime (Kaufman ER ${ctx.kaufmanEfficiency.toFixed(2)}, Spread/ATR ${(spreadToAtr * 100).toFixed(0)}%) — stand aside.`,
    });
  } else if (ctx.kaufmanEfficiency < 0.28) {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      label: 'Chop & Whipsaw Filter',
      status: 'CAUTION',
      hardVeto: false,
      metric: `ER ${ctx.kaufmanEfficiency.toFixed(2)}`,
      detail: 'Moderate range chop; wait for clean OB_ORIGIN/FVG CE50 touch.',
    });
  } else {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      label: 'Chop & Whipsaw Filter',
      status: 'PASS',
      hardVeto: false,
      metric: `ER ${ctx.kaufmanEfficiency.toFixed(2)}`,
      detail: 'Clean directional efficiency outside rollover deadzone without erratic spread distortion.',
    });
  }

  // 6. Premium / Discount Discipline Gate
  if (
    (isLong && ctx.dealingRange.positionPct > 84 && !ctx.hasFreshFvg) ||
    (isShort && ctx.dealingRange.positionPct < 16 && !ctx.hasFreshFvg)
  ) {
    gates.push({
      id: 'PD_DISCIPLINE',
      label: 'Premium / Discount Discipline',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `${ctx.dealingRange.positionPct.toFixed(0)}% Range`,
      detail: isLong
        ? `Refusing LONG in extreme Premium (${ctx.dealingRange.positionPct.toFixed(0)}%) without displacement FVG.`
        : `Refusing SHORT in extreme Discount (${ctx.dealingRange.positionPct.toFixed(0)}%) without displacement FVG.`,
    });
  } else if ((isLong && ctx.dealingRange.positionPct > 68) || (isShort && ctx.dealingRange.positionPct < 32)) {
    gates.push({
      id: 'PD_DISCIPLINE',
      label: 'Premium / Discount Discipline',
      status: 'CAUTION',
      hardVeto: false,
      metric: `${ctx.dealingRange.positionPct.toFixed(0)}% Range`,
      detail: `Sub-optimal range pricing (${ctx.dealingRange.zone.replace('_', ' ')}); scale risk conservatively.`,
    });
  } else {
    gates.push({
      id: 'PD_DISCIPLINE',
      label: 'Premium / Discount Discipline',
      status: 'PASS',
      hardVeto: false,
      metric: `${ctx.dealingRange.positionPct.toFixed(0)}% Range`,
      detail: `Favorable ${ctx.dealingRange.zone.replace('_', ' ')} pricing inside impulse dealing range.`,
    });
  }

  // 7. Hysteresis & Directional Margin Lock
  const margin = Math.abs(ctx.longScore - ctx.shortScore);
  if (margin < HYSTERESIS_MARGIN_PTS) {
    gates.push({
      id: 'HYSTERESIS_LOCK',
      label: 'Hysteresis Bias Stability',
      status: 'BLOCKED',
      hardVeto: true,
      metric: `Δ ${margin} pts`,
      detail: `Long (${ctx.longScore}) vs Short (${ctx.shortScore}) margin < ${HYSTERESIS_MARGIN_PTS} pts — refusing coin-flip flip-flopping.`,
    });
  } else {
    gates.push({
      id: 'HYSTERESIS_LOCK',
      label: 'Hysteresis Bias Stability',
      status: 'PASS',
      hardVeto: false,
      metric: `Δ +${margin} pts`,
      detail: `Clear directional dominance (+${margin} pt hysteresis edge over opposing side).`,
    });
  }

  return gates;
}

/**
 * Builds the 5-Stage MTF Sniper State Machine progress snapshot from the winning directional evaluation.
 */
function buildSniperStateMachine(params: {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  executionTimeframe: Timeframe;
  pillars: SniperConfluencePillarScore[];
  tfsMtf: { M15: TfsSnapshot; M5: TfsSnapshot; M1: TfsSnapshot };
  rsiHook: RsiPullbackHookResult;
  sweepActive: boolean;
  hasDisplacementBreak: boolean;
  goldenSniperConfluence: boolean;
}): SniperStateMachineSnapshot {
  const {
    direction,
    executionTimeframe,
    pillars,
    tfsMtf,
    rsiHook,
    sweepActive,
    hasDisplacementBreak,
    goldenSniperConfluence,
  } = params;

  const p1 = pillars[0];
  const p2 = pillars[1];
  const p3 = pillars[2];
  const p4 = pillars[3];
  const p5 = pillars[4];

  const primaryDriverTf: 'M15' | 'M5' | 'M1' =
    executionTimeframe === 'M1' || executionTimeframe === 'M5' || executionTimeframe === 'M15'
      ? executionTimeframe
      : 'M15';

  const stage1Passed = direction !== 'NEUTRAL' && p1.score >= 9;
  const stage2Passed = direction !== 'NEUTRAL' && (sweepActive || p2.score >= 13);
  const stage3Passed = direction !== 'NEUTRAL' && (hasDisplacementBreak || p3.score >= 12);
  const stage4Passed = direction !== 'NEUTRAL' && (goldenSniperConfluence || p4.score >= 12);
  const stage5Passed = direction !== 'NEUTRAL' && ((rsiHook.active && rsiHook.direction === direction) || p5.score >= 8);

  const stages: SniperStageStatus[] = [
    {
      stage: 1,
      key: 'HTF_NARRATIVE',
      label: 'Stage 1 · HTF Narrative & M15 Filter',
      passed: stage1Passed,
      score: p1.score,
      maxScore: p1.maxScore,
      detail: p1.detail,
    },
    {
      stage: 2,
      key: 'LIQUIDITY_SWEEP',
      label: 'Stage 2 · Session/EQH-EQL Liquidity Sweep',
      passed: stage2Passed,
      score: p2.score,
      maxScore: p2.maxScore,
      detail: p2.detail,
    },
    {
      stage: 3,
      key: 'MSS_BOS_DISPLACEMENT',
      label: 'Stage 3 · MSS/BOS + Institutional Displacement',
      passed: stage3Passed,
      score: p3.score,
      maxScore: p3.maxScore,
      detail: p3.detail,
    },
    {
      stage: 4,
      key: 'FVG_CE_OTE_RETRACE',
      label: 'Stage 4 · FVG CE50 / OTE 0.705 Golden Zone',
      passed: stage4Passed,
      score: p4.score,
      maxScore: p4.maxScore,
      detail: p4.detail,
    },
    {
      stage: 5,
      key: 'RSI_TETHER_EXECUTION_TRIGGER',
      label: 'Stage 5 · RSI Pullback Hook & TFS Tether Trigger',
      passed: stage5Passed,
      score: p5.score,
      maxScore: p5.maxScore,
      detail: p5.detail,
    },
  ];

  const completedStages = stages.filter((s) => s.passed).length;
  let currentStage: 0 | 1 | 2 | 3 | 4 | 5 = 0;
  for (const s of stages) {
    if (s.passed) currentStage = s.stage;
  }

  const readyToSnipe = stage1Passed && stage3Passed && stage4Passed && completedStages >= 4;

  return {
    currentStage,
    completedStages,
    readyToSnipe,
    direction,
    primaryDriverTf,
    stages,
    tfsMtf,
    rsiHook,
  };
}

/**
 * Master Payam Institutional Financial Brain Orchestrator (5-Stage MTF Sniper State Machine).
 * M15 / M5 / M1 act as primary scalping drivers while H4 & H1 act as macro regime & major POI filters.
 * Integrates Module 1 (LIQ), Module 2 (BOS/MSS Displacement), Module 3 (FVG CE50 + OB_ORIGIN),
 * Module 4 (Impulse-Anchored OTE), Module 5 (Wilder RSI + Synchronized Div + Pullback Hook),
 * and Module 6 (TFS Tether/VO/MBO across M15/M5/M1).
 */
export function evaluatePayamBrain(input: PayamBrainInput): SniperPayamBrainReport {
  const nowMs = input.nowMs ?? Date.now();
  const activeCandles = input.candlesByTf[input.executionTimeframe] ?? [];
  const spot = activeCandles[activeCandles.length - 1]?.close ?? 2742.6;
  const atr = Math.max(1.0, input.regime.atr);
  const spread = input.spread ?? 0.24;

  const h4Candles = input.candlesByTf.H4 ?? activeCandles;
  const h1Candles = input.candlesByTf.H1 ?? activeCandles;
  const m15Candles = input.candlesByTf.M15 ?? activeCandles;
  const m5Candles = input.candlesByTf.M5 ?? activeCandles;
  const m1Candles = input.candlesByTf.M1 ?? activeCandles;

  const h4BiasObj = evaluateTimeframeBias(h4Candles, input.rsi.byTimeframe.H4, input.structuresByTf.H4 ?? []);
  const h1BiasObj = evaluateTimeframeBias(h1Candles, input.rsi.byTimeframe.H1, input.structuresByTf.H1 ?? []);
  const m15BiasObj = evaluateTimeframeBias(m15Candles, input.rsi.byTimeframe.M15, input.structuresByTf.M15 ?? []);
  const m5BiasObj = evaluateTimeframeBias(m5Candles, input.rsi.byTimeframe.M5, input.structuresByTf.M5 ?? []);
  const m1BiasObj = evaluateTimeframeBias(m1Candles, input.rsi.byTimeframe.M1, input.structuresByTf.M1 ?? []);
  const execBiasObj = evaluateTimeframeBias(activeCandles, input.rsi.active, input.structures);

  // Module 6: Wire TFS Suite (Tether, Velocity Oscillator, MBO, Bias) across M15, M5, M1
  const tfsMtf = {
    M15: input.tfsByTf?.M15 ?? computeLocalTfs(m15Candles),
    M5: input.tfsByTf?.M5 ?? computeLocalTfs(m5Candles),
    M1: input.tfsByTf?.M1 ?? computeLocalTfs(m1Candles),
  };

  // Module 1: Fast sweep extraction reusing pre-evaluated pool sweepStatus when present
  const extractQuickSweep = (
    series: Candle[],
    pools: InstitutionalLiquidityPool[]
  ) => {
    const cutoff = Math.max(0, series.length - 12);
    let best: InstitutionalLiquidityPool | null = null;
    for (const p of pools) {
      if (p.sweepStatus === 'SWEPT_AND_RECLAIMED' && p.sweepBarIndex !== undefined && p.sweepBarIndex >= cutoff) {
        if (!best || p.sweepBarIndex > (best.sweepBarIndex ?? -1)) best = p;
      }
    }
    if (best) {
      return {
        active: true,
        side: (best.side === 'SSL' ? 'SSL_SWEEP_BULLISH' : 'BSL_SWEEP_BEARISH') as 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH',
        level: best.level,
        wickRejectionRatio: Math.max(1.5, round2((best.rejectionWickRatio ?? 0.5) * 3)),
        wickToRangeRatio: best.rejectionWickRatio ?? 0.5,
        sweepStatus: 'SWEPT_AND_RECLAIMED' as LiquiditySweepStatus,
        poolKind: best.poolKind,
        sweepBarIndex: best.sweepBarIndex,
        enrichedLiquidity: pools,
      };
    }
    return null;
  };

  const preEvaluatedActive = input.liquidity.length > 0 && input.liquidity.every((p) => p.sweepStatus !== undefined);
  const sweepActive = preEvaluatedActive
    ? (extractQuickSweep(activeCandles, input.liquidity) ?? {
        active: false,
        side: 'NONE' as const,
        level: null,
        wickRejectionRatio: 0,
        wickToRangeRatio: 0,
        sweepStatus: 'UNTOUCHED' as LiquiditySweepStatus,
        enrichedLiquidity: input.liquidity,
      })
    : detectLiquiditySweepFootprint(activeCandles, input.liquidity);

  const sweepM5 =
    !sweepActive.active && input.executionTimeframe !== 'M5' && input.liquidityByTf?.M5
      ? extractQuickSweep(m5Candles, input.liquidityByTf.M5)
      : null;
  const sweepM15 =
    !sweepActive.active && !sweepM5 && input.executionTimeframe !== 'M15' && input.liquidityByTf?.M15
      ? extractQuickSweep(m15Candles, input.liquidityByTf.M15)
      : null;

  const sweep = sweepActive.active
    ? sweepActive
    : sweepM5
      ? { ...sweepM5, enrichedLiquidity: sweepActive.enrichedLiquidity }
      : sweepM15
        ? { ...sweepM15, enrichedLiquidity: sweepActive.enrichedLiquidity }
        : sweepActive;

  // Module 5: RSI Pullback Hook Detection on M5/M1 aligned with M15 RSI regime while testing POI
  const m5RsiSeries = computeWilderRsiSeries(m5Candles, 14);
  const m1RsiSeries = computeWilderRsiSeries(m1Candles, 14);
  const scalpFvgs = [...(input.fvgsByTf.M15 ?? []), ...(input.fvgsByTf.M5 ?? []), ...(input.fvgsByTf.M1 ?? [])];
  const scalpObs = [...(input.obsByTf.M15 ?? []), ...(input.obsByTf.M5 ?? []), ...(input.obsByTf.M1 ?? [])];
  const scalpStructures = [
    ...(input.structuresByTf.M15 ?? []),
    ...(input.structuresByTf.M5 ?? []),
    ...(input.structuresByTf.M1 ?? []),
    ...input.structures,
  ];

  const poiTol = Math.max(0.65, atr * 0.45);
  const priceNearFvgCe = [...input.fvgs, ...scalpFvgs].some(
    (f) => !f.isInversion && (!f.mitigated || f.mitigationState === 'CE50_TESTED') && Math.abs(spot - f.ce50) <= poiTol
  );
  const priceNearOteSweet =
    Math.abs(spot - input.dealingRange.oteLongSweetSpot) <= poiTol ||
    Math.abs(spot - input.dealingRange.oteShortSweetSpot) <= poiTol;
  const priceInPoi = priceNearFvgCe || priceNearOteSweet;

  const rsiHook = detectRsiPullbackHook({
    m5RsiSeries,
    m1RsiSeries,
    m15Regime: input.rsi.byTimeframe.M15.regime,
    priceInPoi,
    preferredDirection:
      m15BiasObj.bias === 'BULLISH' ? 'LONG' : m15BiasObj.bias === 'BEARISH' ? 'SHORT' : 'NEUTRAL',
  });

  const killzone = classifyKillzoneWindow(nowMs);
  const kaufmanEfficiency = computeKaufmanEfficiency(activeCandles, 16);

  const closes = activeCandles.map((c) => c.close);
  const ema20Series = computeEmaSeries(closes, 20);
  const ema20 = ema20Series[ema20Series.length - 1] ?? spot;
  const atrExtensionSigned = round2((spot - ema20) / atr);

  const sharedCtx = {
    spot,
    atr,
    spread,
    h4: h4BiasObj,
    h1: h1BiasObj,
    m15: m15BiasObj,
    m5: m5BiasObj,
    m1: m1BiasObj,
    execBias: execBiasObj,
    rsi: input.rsi,
    rsiHook,
    tfsMtf,
    dealingRange: input.dealingRange,
    scalpStructures,
    obs: input.orderBlocks,
    fvgs: input.fvgs,
    scalpObs,
    scalpFvgs,
    liquidity: sweep.enrichedLiquidity,
    sweep,
    killzone,
    newsGate: input.newsGate,
    basis: input.basis,
  };

  const longEval = scoreDirectionPillars('LONG', sharedCtx);
  const shortEval = scoreDirectionPillars('SHORT', sharedCtx);

  const candidateDirection: 'LONG' | 'SHORT' | 'NEUTRAL' =
    longEval.total > shortEval.total
      ? 'LONG'
      : shortEval.total > longEval.total
        ? 'SHORT'
        : 'NEUTRAL';

  const winningEval = candidateDirection === 'SHORT' ? shortEval : longEval;
  const winningSmcDir = candidateDirection === 'SHORT' ? 'BEARISH' : 'BULLISH';
  const hasFreshFvg = input.fvgs.some(
    (f) =>
      (!f.mitigated || f.mitigationState === 'CE50_TESTED') &&
      !f.isInversion &&
      f.direction === winningSmcDir
  );

  const defenseGates = evaluateDefenseShield({
    candidateDirection,
    spot,
    atr,
    spread,
    candles: activeCandles,
    h4: h4BiasObj,
    rsi: input.rsi,
    dealingRange: input.dealingRange,
    regime: input.regime,
    kaufmanEfficiency,
    atrExtensionSigned,
    longScore: longEval.total,
    shortScore: shortEval.total,
    sweep,
    hasFreshFvg,
    newsGate: input.newsGate,
    basis: input.basis,
    killzone,
    nowMs,
    agentConfig: input.agentConfig,
    newsShock: input.newsShock,
  });

  const rolloverDeadzoneLockout = isRolloverDeadzoneUtc(nowMs);
  const hardVetoes = defenseGates.filter((g) => g.hardVeto).map((g) => `${g.label}: ${g.detail}`);
  const cautionCount = defenseGates.filter((g) => g.status === 'CAUTION').length;
  const configuredMinScore = input.agentConfig?.minConfluenceScore ?? MIN_CONFLUENCE_TRADE_SCORE;
  const minThreshold = input.newsGate?.state === 'CAUTION' ? Math.max(70, configuredMinScore) : configuredMinScore;

  let convictionGrade: ConvictionGrade = 'STAND_DOWN';
  let decision: PayamBrainReport['decision'] = 'STAND_DOWN';
  let recommendedRiskMultiplier = 0;

  if (hardVetoes.length === 0 && candidateDirection !== 'NEUTRAL' && winningEval.total >= minThreshold) {
    decision = candidateDirection === 'LONG' ? 'PROPOSE_LONG' : 'PROPOSE_SHORT';
    if (winningEval.total >= GRADE_A_PLUS_SCORE && cautionCount === 0) {
      convictionGrade = 'A+';
      recommendedRiskMultiplier = 1.0;
    } else if (winningEval.total >= GRADE_A_SCORE) {
      convictionGrade = 'A';
      recommendedRiskMultiplier = cautionCount > 0 ? 0.75 : 1.0;
    } else {
      convictionGrade = 'B';
      recommendedRiskMultiplier = 0.5;
    }
    if (input.newsGate?.state === 'CAUTION') {
      recommendedRiskMultiplier = Math.min(recommendedRiskMultiplier, 0.5);
    }
  }

  // Construct Top-Down 4H -> 1H -> 15M -> 5M Matrix (preserving 4-row institutional contract)
  const mtfMatrix: TimeframeAlignmentRow[] = [
    {
      timeframe: 'H4',
      role: 'MACRO_COMPASS',
      bias: h4BiasObj.bias,
      rsi: input.rsi.byTimeframe.H4.value,
      rsiRegime: input.rsi.byTimeframe.H4.regime,
      divergence: input.rsi.byTimeframe.H4.divergence,
      lastStructure: h4BiasObj.lastStructure,
      unmitigatedObCount: (input.obsByTf.H4 ?? []).filter((o) => !o.mitigated).length,
      unmitigatedFvgCount: (input.fvgsByTf.H4 ?? []).filter((f) => !f.mitigated).length,
    },
    {
      timeframe: 'H1',
      role: 'STRUCTURE_POI',
      bias: h1BiasObj.bias,
      rsi: input.rsi.byTimeframe.H1.value,
      rsiRegime: input.rsi.byTimeframe.H1.regime,
      divergence: input.rsi.byTimeframe.H1.divergence,
      lastStructure: h1BiasObj.lastStructure,
      unmitigatedObCount: (input.obsByTf.H1 ?? []).filter((o) => !o.mitigated).length,
      unmitigatedFvgCount: (input.fvgsByTf.H1 ?? []).filter((f) => !f.mitigated).length,
    },
    {
      timeframe: 'M15',
      role: 'SETUP_CHOCH',
      bias: m15BiasObj.bias,
      rsi: input.rsi.byTimeframe.M15.value,
      rsiRegime: input.rsi.byTimeframe.M15.regime,
      divergence: input.rsi.byTimeframe.M15.divergence,
      lastStructure: m15BiasObj.lastStructure,
      unmitigatedObCount: (input.obsByTf.M15 ?? []).filter((o) => !o.mitigated).length,
      unmitigatedFvgCount: (input.fvgsByTf.M15 ?? []).filter((f) => !f.mitigated).length,
    },
    {
      timeframe: 'M5',
      role: 'EXECUTION_TRIGGER',
      bias: m5BiasObj.bias,
      rsi: input.rsi.byTimeframe.M5.value,
      rsiRegime: input.rsi.byTimeframe.M5.regime,
      divergence: input.rsi.byTimeframe.M5.divergence,
      lastStructure: m5BiasObj.lastStructure,
      unmitigatedObCount: (input.obsByTf.M5 ?? []).filter((o) => !o.mitigated).length,
      unmitigatedFvgCount: (input.fvgsByTf.M5 ?? []).filter((f) => !f.mitigated).length,
    },
  ];

  // Build 5-Stage MTF Sniper State Machine
  const alignedSweepActive =
    (candidateDirection === 'LONG' && sweep.side === 'SSL_SWEEP_BULLISH') ||
    (candidateDirection === 'SHORT' && sweep.side === 'BSL_SWEEP_BEARISH');
  const hasDisplacementBreak = scalpStructures.some(
    (s) => s.direction === winningSmcDir && Boolean(s.hasInstitutionalDisplacement)
  );
  const sniperStateMachine = buildSniperStateMachine({
    direction: candidateDirection,
    executionTimeframe: input.executionTimeframe,
    pillars: winningEval.pillars,
    tfsMtf,
    rsiHook,
    sweepActive: alignedSweepActive,
    hasDisplacementBreak,
    goldenSniperConfluence: winningEval.goldenConfluence,
  });

  // Build Watchlist Pullback / Entry Zone anchored strictly to OB_ORIGIN / FVG CE50 / OTE 0.705
  const anchorOb = input.orderBlocks.find((o) => !o.mitigated && !o.isBreaker && o.direction === winningSmcDir);
  const anchorFvg = input.fvgs.find(
    (f) => (!f.mitigated || f.mitigationState === 'CE50_TESTED') && !f.isInversion && f.direction === winningSmcDir
  );
  const optimalEntry = round2(
    anchorFvg?.ce50 ??
      anchorOb?.mt50 ??
      (candidateDirection === 'SHORT' ? input.dealingRange.oteShortSweetSpot : input.dealingRange.oteLongSweetSpot)
  );
  const zoneHalf = round2(Math.max(0.65, atr * 0.3));
  const invalidationLevel = round2(
    candidateDirection === 'SHORT'
      ? anchorOb
        ? anchorOb.high + atr * 0.35
        : optimalEntry + atr * 1.1
      : anchorOb
        ? anchorOb.low - atr * 0.35
        : optimalEntry - atr * 1.1
  );
  const targetLiquidity = round2(
    candidateDirection === 'SHORT'
      ? Math.min(input.dealingRange.swingLow, optimalEntry - atr * 2.2)
      : Math.max(input.dealingRange.swingHigh, optimalEntry + atr * 2.2)
  );

  const watchlistZone = {
    direction: candidateDirection,
    entryLow: round2(optimalEntry - zoneHalf),
    entryHigh: round2(optimalEntry + zoneHalf),
    optimalEntry,
    invalidationLevel,
    targetLiquidity,
  };

  let summaryEn = '';
  let summaryFa = '';

  if (decision === 'STAND_DOWN') {
    const primaryReason =
      hardVetoes[0] ?? `Confluence score ${winningEval.total}/100 is below institutional floor (${minThreshold}/100)`;
    summaryEn = `STAND DOWN (${winningEval.total}/100 · Stage ${sniperStateMachine.currentStage}/5): ${primaryReason}. Watching sniper zone $${watchlistZone.entryLow.toFixed(2)}–$${watchlistZone.entryHigh.toFixed(2)} (M15 ${m15BiasObj.bias}, H4 ${h4BiasObj.bias}).`;
    summaryFa = `توقف منضبط (امتیاز ${winningEval.total}/100 · مرحله ${sniperStateMachine.currentStage}/5): به دلیل فیلتر حفاظتی (${defenseGates.find((g) => g.hardVeto)?.label ?? 'حداقل امتیاز همگرایی'}) از ورود هیجانی خودداری شد. انتظار برای بازگشت به ناحیه اسنایپر ${watchlistZone.entryLow.toFixed(2)} تا ${watchlistZone.entryHigh.toFixed(2)} همسو با M15 (${m15BiasObj.bias}).`;
  } else {
    const dirLabel = decision === 'PROPOSE_LONG' ? 'LONG' : 'SHORT';
    const dirFa = dirLabel === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)';
    summaryEn = `Grade ${convictionGrade} ${dirLabel} (${winningEval.total}/100 · Stage ${sniperStateMachine.currentStage}/5) on ${input.executionTimeframe}: M15 ${m15BiasObj.bias}, M5 ${m5BiasObj.bias}, H4 ${h4BiasObj.bias}, RSI(14) ${input.rsi.active.value.toFixed(1)}, TFS M5 ${tfsMtf.M5.bias}${winningEval.goldenConfluence ? ', Golden OTE+FVG/OB' : ''}. Risk budget ${(recommendedRiskMultiplier * 100).toFixed(0)}%.`;
    summaryFa = `ستاپ اسنایپر گرید ${convictionGrade} در جهت ${dirFa} با امتیاز ${winningEval.total}/100 (مرحله ${sniperStateMachine.currentStage}/5) در ${input.executionTimeframe}: همسو با M15 (${m15BiasObj.bias}) و M5 (${m5BiasObj.bias})، RSI برابر ${input.rsi.active.value.toFixed(1)} و تتر TFS (${tfsMtf.M5.bias})${winningEval.goldenConfluence ? ' با همپوشانی طلایی OTE+FVG' : ''}. ضریب ریسک ${(recommendedRiskMultiplier * 100).toFixed(0)}%.`;
  }

  return {
    timestampMs: nowMs,
    executionTimeframe: input.executionTimeframe,
    h4Bias: h4BiasObj.bias,
    h4Strength: h4BiasObj.strength,
    h1Bias: h1BiasObj.bias,
    candidateDirection,
    decision,
    convictionGrade,
    totalScore: winningEval.total,
    longScore: longEval.total,
    shortScore: shortEval.total,
    recommendedRiskMultiplier,
    killzone,
    atrExtension: round2(Math.abs(atrExtensionSigned)),
    kaufmanEfficiency,
    sweepDetected: {
      active: sweep.active,
      side: sweep.side,
      level: sweep.level,
      wickRejectionRatio: sweep.wickRejectionRatio,
    },
    goldenConfluence: winningEval.goldenConfluence,
    pillars: winningEval.pillars,
    defenseGates,
    hardVetoes,
    mtfMatrix,
    watchlistZone,
    sniperStateMachine,
    tfsMtf,
    rsiPullbackHook: rsiHook,
    rolloverDeadzoneLockout,
    summaryEn,
    summaryFa,
  };
}

/**
 * Generates an institutional structurally-anchored sniper proposal from PayamBrainReport.
 * Uses Timeframe-Adaptive Structural Stop Floor, dynamic validateTradeGuardrails parameters,
 * and outputs `recommendedOrderType`, `sniperZone`, `invalidationPrice`, and `ttlBars`.
 */
export function buildInstitutionalProposalFromBrain(params: {
  spotPrice: number;
  timeframe: Timeframe;
  brain: SniperPayamBrainReport;
  orderBlocks: InstitutionalOrderBlock[];
  fvgs: InstitutionalFairValueGap[];
  liquidity: InstitutionalLiquidityPool[];
  atr: number;
  spread: number;
  newsGate: NewsGateStatus;
  divergence: BasisDivergence;
  validateGuardrails?: (
    direction: 'LONG' | 'SHORT',
    entry: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    atr: number,
    options?: { minRrRatio?: number; minStopDist?: number }
  ) => { valid: boolean; rrRatio: number; errors: string[] };
  variantIndex?: number;
  allowCautionVariant?: boolean;
  minRrRatio?: number;
  atrByTf?: Partial<Record<Timeframe, number>>;
}): SniperAgentProposal | null {
  const {
    spotPrice,
    timeframe,
    brain,
    orderBlocks,
    fvgs,
    liquidity,
    atr,
    spread,
    newsGate,
    divergence,
    validateGuardrails,
    variantIndex = 0,
    allowCautionVariant = false,
    minRrRatio = 1.75,
    atrByTf,
  } = params;

  const effectiveValidateGuardrails =
    validateGuardrails ??
    ((
      dir: 'LONG' | 'SHORT',
      ent: number,
      sl: number,
      t1: number,
      t2: number,
      a: number,
      opts?: { minRrRatio?: number; minStopDist?: number }
    ) => {
      const errs: string[] = [];
      const geomOk =
        dir === 'LONG' ? sl < ent && ent < t1 && t1 < t2 : sl > ent && ent > t1 && t1 > t2;
      if (!geomOk) errs.push('Invalid geometry');
      const sd = Math.abs(ent - sl);
      const rd = Math.abs(t1 - ent);
      const rr = sd > 0 ? Math.round((rd / sd) * 1000) / 1000 : 0;
      const reqRr = opts?.minRrRatio ?? 1.5;
      const reqStop = opts?.minStopDist ?? 0.25 * a;
      if (rr < reqRr) errs.push('R:R below minimum');
      if (sd < reqStop) errs.push('Stop too tight');
      return { valid: errs.length === 0, rrRatio: rr, errors: errs };
    });

  if (newsGate.vetoNewEntries) return null;

  // Enforce strict Anti-Emotion, Rollover Deadzone & Anti-Fakeout Discipline!
  if (brain.decision === 'STAND_DOWN' && !allowCautionVariant) {
    return null;
  }
  if (brain.hardVetoes.length > 0 && !allowCautionVariant) {
    return null;
  }

  const direction: 'LONG' | 'SHORT' =
    brain.decision === 'PROPOSE_SHORT'
      ? 'SHORT'
      : brain.decision === 'PROPOSE_LONG'
        ? 'LONG'
        : brain.candidateDirection === 'SHORT'
          ? 'SHORT'
          : 'LONG';

  const isLong = direction === 'LONG';
  const smcDir = isLong ? 'BULLISH' : 'BEARISH';
  const safeAtr = Math.max(1.0, atr);

  const activeOb = orderBlocks.find((o) => !o.mitigated && !o.isBreaker && o.direction === smcDir);
  const activeFvg = fvgs.find(
    (f) => (!f.mitigated || f.mitigationState === 'CE50_TESTED') && !f.isInversion && f.direction === smcDir
  );

  // Build sniperZone { low, high, sweetSpot } anchored to active FVG/OB/watchlist
  const fallbackSweet = brain.watchlistZone?.optimalEntry ?? spotPrice;
  let zoneLow = activeFvg
    ? Math.min(activeFvg.bottom, activeOb?.low ?? activeFvg.bottom)
    : activeOb
      ? activeOb.low
      : round2(fallbackSweet - Math.max(0.5, safeAtr * 0.25));
  let zoneHigh = activeFvg
    ? Math.max(activeFvg.top, activeOb?.high ?? activeFvg.top)
    : activeOb
      ? activeOb.high
      : round2(fallbackSweet + Math.max(0.5, safeAtr * 0.25));
  if (zoneHigh < zoneLow) {
    const tmp = zoneLow;
    zoneLow = zoneHigh;
    zoneHigh = tmp;
  }
  let sweetSpot = round2(
    variantIndex % 2 === 0
      ? (activeFvg?.ce50 ?? activeOb?.mt50 ?? (zoneLow + zoneHigh) / 2)
      : (activeOb?.mt50 ?? activeFvg?.ce50 ?? (zoneLow + zoneHigh) / 2)
  );
  sweetSpot = round2(clamp(sweetSpot, zoneLow, zoneHigh));

  // If the POI zone is too far (> 2.2 ATR) from spot, re-center sniperZone cleanly around spot/watchlist
  if (Math.abs(sweetSpot - spotPrice) > safeAtr * 2.2) {
    const half = round2(Math.max(0.45, safeAtr * 0.22));
    sweetSpot = round2(spotPrice + (isLong ? -0.35 : 0.35) * (variantIndex % 2));
    zoneLow = round2(sweetSpot - half);
    zoneHigh = round2(sweetSpot + half);
  }

  const sniperZone = {
    low: round2(zoneLow),
    high: round2(zoneHigh),
    sweetSpot: round2(sweetSpot),
  };

  // Determine recommendedOrderType: MARKET if spot is already inside sniperZone with momentum trigger, else LIMIT
  const spotInZone =
    spotPrice >= sniperZone.low - Math.max(0.15, spread) &&
    spotPrice <= sniperZone.high + Math.max(0.15, spread);
  const triggerReady =
    Boolean(brain.rsiPullbackHook?.active && brain.rsiPullbackHook.direction === direction) ||
    brain.sniperStateMachine?.currentStage === 5;
  const recommendedOrderType: 'LIMIT' | 'MARKET' =
    spotInZone && triggerReady ? 'MARKET' : 'LIMIT';

  const entry = recommendedOrderType === 'MARKET' ? round2(spotPrice) : sniperZone.sweetSpot;

  // Timeframe-Adaptive Structural Stop Floor (replaces hardcoded $3.60!)
  const minSlDist = computeAdaptiveStopFloor(timeframe, spread, safeAtr, atrByTf);
  const buffer = round2(Math.max(0.4, spread * 2.0 + safeAtr * 0.15));
  let structuralSl = isLong ? entry - minSlDist : entry + minSlDist;

  if (activeOb) {
    const obExtremeSl = isLong ? activeOb.low - buffer : activeOb.high + buffer;
    const distFromOb = Math.abs(entry - obExtremeSl);
    if (distFromOb >= minSlDist && distFromOb <= Math.max(minSlDist * 2.4, safeAtr * 2.8)) {
      structuralSl = round2(obExtremeSl);
    }
  } else if (brain.sweepDetected.active && brain.sweepDetected.level !== null) {
    const sweepValid =
      (isLong && brain.sweepDetected.side === 'SSL_SWEEP_BULLISH' && brain.sweepDetected.level < entry) ||
      (!isLong && brain.sweepDetected.side === 'BSL_SWEEP_BEARISH' && brain.sweepDetected.level > entry);
    if (sweepValid) {
      const sweepSl = isLong ? brain.sweepDetected.level - buffer : brain.sweepDetected.level + buffer;
      const distFromSweep = Math.abs(entry - sweepSl);
      if (distFromSweep >= minSlDist && distFromSweep <= Math.max(minSlDist * 2.4, safeAtr * 2.8)) {
        structuralSl = round2(sweepSl);
      }
    }
  }

  const stopLoss = round2(structuralSl);
  const invalidationPrice = stopLoss;
  const riskDist = Math.max(minSlDist, Math.abs(entry - stopLoss));

  // Targets: TP1 >= max(minRrRatio, grade target) aligned toward opposing liquidity, TP2 >= TP1 + 1.25R
  const gradeRr = brain.convictionGrade === 'A+' ? 2.15 : brain.convictionGrade === 'A' ? 1.95 : 1.75;
  const rr1 = Math.max(minRrRatio, gradeRr);
  const rr2 = rr1 + 1.25;
  const opposingLiq = liquidity.find(
    (l) =>
      l.side === (isLong ? 'BSL' : 'SSL') &&
      l.sweepStatus !== 'STRUCTURAL_BREAKOUT' &&
      (isLong ? l.level > entry : l.level < entry)
  );

  let tp1 = round2(isLong ? entry + riskDist * rr1 : entry - riskDist * rr1);
  let tp2 = round2(isLong ? entry + riskDist * rr2 : entry - riskDist * rr2);

  if (opposingLiq) {
    const distToLiq = isLong ? opposingLiq.level - entry : entry - opposingLiq.level;
    if (distToLiq >= riskDist * Math.max(1.65, minRrRatio) && distToLiq <= riskDist * 2.8) {
      tp1 = round2(opposingLiq.level);
      tp2 = round2(isLong ? Math.max(tp1 + riskDist * 1.05, tp2) : Math.min(tp1 - riskDist * 1.05, tp2));
    }
  }

  const guard = effectiveValidateGuardrails(direction, entry, stopLoss, tp1, tp2, safeAtr, {
    minRrRatio: Math.max(1.5, minRrRatio),
    minStopDist: round2(minSlDist * 0.95),
  });
  if (!guard.valid) return null;

  const ttlBars = timeframe === 'M1' ? 12 : timeframe === 'M5' ? 6 : timeframe === 'M15' ? 4 : 3;

  const isCounter4H =
    (isLong && brain.h4Bias === 'BEARISH') || (!isLong && brain.h4Bias === 'BULLISH');

  let setupType = isLong ? 'M15/M5 Sniper OB_ORIGIN + FVG Retest' : 'M15/M5 Sniper OB_ORIGIN + FVG Retest';
  if (brain.goldenConfluence && brain.sweepDetected.active) {
    setupType = isLong
      ? 'SSL Sweep + Golden OTE/FVG CE50 Sniper'
      : 'BSL Sweep + Golden OTE/FVG CE50 Sniper';
  } else if (brain.goldenConfluence) {
    setupType = isLong
      ? 'Golden Bullish OTE 70.5% + FVG CE50 Confluence'
      : 'Golden Bearish OTE 70.5% + FVG CE50 Confluence';
  } else if (brain.sweepDetected.active) {
    setupType = isLong
      ? 'SSL Liquidity Raid & MSS Reclaim'
      : 'BSL Liquidity Raid & MSS Rejection';
  } else if (brain.rsiPullbackHook?.active) {
    setupType = isLong
      ? `${brain.rsiPullbackHook.timeframe} RSI Pullback Hook + TFS Tether Long`
      : `${brain.rsiPullbackHook.timeframe} RSI Pullback Hook + TFS Tether Short`;
  } else if (brain.mtfMatrix.some((r) => r.divergence !== 'NONE')) {
    const divRow = brain.mtfMatrix.find((r) => r.divergence !== 'NONE')!;
    setupType = isLong
      ? `${divRow.timeframe} ${divRow.divergence === 'BULLISH_HIDDEN' ? 'Hidden' : 'Regular'} RSI Div + OB_ORIGIN`
      : `${divRow.timeframe} ${divRow.divergence === 'BEARISH_HIDDEN' ? 'Hidden' : 'Regular'} RSI Div + OB_ORIGIN`;
  } else if (isCounter4H) {
    setupType = isLong ? 'Counter-4H Exhaustion Reversal Scalp' : 'Counter-4H Premium Fade Scalp';
  }

  const rsiExec = brain.mtfMatrix.find((r) => r.timeframe === timeframe) ?? brain.mtfMatrix[2];
  const rsiSummary = `RSI ${rsiExec.rsi.toFixed(1)} · ${rsiExec.rsiRegime.replace('_REGIME', '')}${rsiExec.divergence !== 'NONE' ? ` · ${rsiExec.divergence.replace('_', ' ')}` : ''}`;
  const keyAnchor = activeFvg?.ce50 ?? activeOb?.mt50 ?? entry;
  const gradeLabel = brain.convictionGrade === 'STAND_DOWN' ? 'B' : brain.convictionGrade;
  const confidence = round2(clamp(0.55 + (brain.totalScore / 100) * 0.4, 0.62, 0.96));

  const rationaleEn = `[Grade ${gradeLabel} · ${brain.totalScore}/100 · ${recommendedOrderType}] ${setupType} on ${timeframe} anchored at ${entry.toFixed(2)} (Sniper Zone ${sniperZone.low.toFixed(2)}–${sniperZone.high.toFixed(2)}, POI ${keyAnchor.toFixed(2)}). H4 ${brain.h4Bias}, ${rsiSummary}, Basis ${divergence.status}, R:R 1:${guard.rrRatio.toFixed(2)}, TTL ${ttlBars} bars.`;
  const rationaleFa = `[گرید ${gradeLabel} · امتیاز ${brain.totalScore}/100 · ${recommendedOrderType}] ستاپ ${setupType} در تایم‌فریم ${timeframe} با نقطه ورود ${entry.toFixed(2)} (ناحیه اسنایپر ${sniperZone.low.toFixed(2)} تا ${sniperZone.high.toFixed(2)}). همسو با H4 (${brain.h4Bias})، وضعیت ${rsiSummary}، فیلتر واگرایی ${divergence.status} و R:R برابر 1:${guard.rrRatio.toFixed(2)} (اعتبار ${ttlBars} کندل).`;

  return {
    id: `prop-${Date.now().toString(36)}-${variantIndex}`,
    direction,
    setupType,
    timeframe,
    entry,
    stopLoss,
    tp1,
    tp2,
    rrRatio: guard.rrRatio,
    confidence,
    rationaleEn,
    rationaleFa,
    toolsUsed: [
      'htf_narrative_filter',
      'session_eqh_eql_sweep_guard',
      'dual_pivot_mss_bos_displacement',
      'fvg_ce50_impulse_ote_golden',
      'wilder_rsi_hook_tfs_tether',
      'rollover_deadzone_7gate_shield',
      'adaptive_sl_floor_guardrails',
    ],
    engineSource: 'SYSTEM1_QUANT',
    status: 'PROPOSED',
    createdAtMs: Date.now(),
    confluenceScore: brain.totalScore,
    convictionGrade: gradeLabel,
    h4Bias: brain.h4Bias,
    rsiSummary,
    recommendedRiskMultiplier: brain.recommendedRiskMultiplier || 0.5,
    pillarBreakdown: brain.pillars.map((p) => ({ label: p.label, score: p.score, maxScore: p.maxScore })),
    goldenConfluence: brain.goldenConfluence,
    counterTrendFlag: isCounter4H,
    recommendedOrderType,
    sniperZone,
    invalidationPrice,
    ttlBars,
  };
}

/**
 * Institutional alias for buildInstitutionalProposalFromBrain (Squad 1 Sniper Proposal API).
 */
export const buildPayamBrainProposal = buildInstitutionalProposalFromBrain;
