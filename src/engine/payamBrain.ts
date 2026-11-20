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
  Timeframe,
  TimeframeAlignmentRow,
  TpiSnapshot,
} from './types';

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const BRAIN_PILLAR_WEIGHTS = {
  H4_COMPASS: 20,
  H1_SWEEP_STRUCT: 20,
  OB_QUALITY: 18,
  FVG_GOLDEN: 15,
  RSI_MOMENTUM: 15,
  OTE_SESSION_MACRO: 12,
} as const;

export const MIN_CONFLUENCE_TRADE_SCORE = 62;
export const GRADE_A_SCORE = 72;
export const GRADE_A_PLUS_SCORE = 82;
export const HYSTERESIS_MARGIN_PTS = 8;

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
 * Detects Regular (exhaustion reversal) and Hidden (trend continuation) RSI divergences
 * across confirmed local swing pivots in the last 36 candles.
 */
export function detectRsiDivergence(candles: Candle[], rsiSeries: number[], swingRadius = 2): RsiDivergenceKind {
  const n = Math.min(candles.length, rsiSeries.length);
  if (n < 22) return 'NONE';

  const startIdx = Math.max(swingRadius + 14, n - 42);
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

  // Evaluate most recent swing low pair (only if recent pivot is within last 14 bars)
  if (swingLows.length >= 2) {
    const prev = swingLows[swingLows.length - 2];
    const curr = swingLows[swingLows.length - 1];
    if (n - 1 - curr.idx <= 14 && curr.idx - prev.idx >= 3) {
      // Bullish Regular: Price Lower Low, RSI Higher Low (absorption/reversal)
      if (curr.price < prev.price * 0.9998 && curr.rsi > prev.rsi + 2.2 && curr.rsi < 54) {
        return 'BULLISH_REGULAR';
      }
      // Bullish Hidden: Price Higher Low, RSI Lower Low (institutional uptrend continuation)
      if (curr.price > prev.price * 1.0002 && curr.rsi < prev.rsi - 2.2 && curr.rsi >= 36 && curr.rsi <= 62) {
        return 'BULLISH_HIDDEN';
      }
    }
  }

  // Evaluate most recent swing high pair
  if (swingHighs.length >= 2) {
    const prev = swingHighs[swingHighs.length - 2];
    const curr = swingHighs[swingHighs.length - 1];
    if (n - 1 - curr.idx <= 14 && curr.idx - prev.idx >= 3) {
      // Bearish Regular: Price Higher High, RSI Lower High (distribution/exhaustion)
      if (curr.price > prev.price * 1.0002 && curr.rsi < prev.rsi - 2.2 && curr.rsi > 46) {
        return 'BEARISH_REGULAR';
      }
      // Bearish Hidden: Price Lower High, RSI Higher High (institutional downtrend continuation)
      if (curr.price < prev.price * 0.9998 && curr.rsi > prev.rsi + 2.2 && curr.rsi >= 38 && curr.rsi <= 66) {
        return 'BEARISH_HIDDEN';
      }
    }
  }

  return 'NONE';
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

/**
 * Computes active SMC Dealing Range (Swing Low -> Swing High), 50% Equilibrium,
 * and Optimal Trade Entry (OTE 61.8% - 78.6% Fibonacci pocket, 70.5% sweet spot).
 */
export function computeDealingRange(timeframe: Timeframe, candles: Candle[], lookback = 48): DealingRangeSnapshot {
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
      oteShortLow: 2742.36,
      oteShortHigh: 2745.72,
      oteShortSweetSpot: 2744.1,
      positionPct: 50,
      zone: 'EQUILIBRIUM',
    };
  }

  let swingHigh = slice[0].high;
  let swingLow = slice[0].low;
  for (const c of slice) {
    if (c.high > swingHigh) swingHigh = c.high;
    if (c.low < swingLow) swingLow = c.low;
  }
  const span = Math.max(0.5, swingHigh - swingLow);
  const equilibrium50 = round2((swingHigh + swingLow) / 2);

  // Bullish retracement from High down into Discount OTE (61.8% - 78.6% retrace)
  const oteLongHigh = round2(swingHigh - span * 0.618);
  const oteLongLow = round2(swingHigh - span * 0.786);
  const oteLongSweetSpot = round2(swingHigh - span * 0.705);

  // Bearish retracement from Low up into Premium OTE (61.8% - 78.6% retrace)
  const oteShortLow = round2(swingLow + span * 0.618);
  const oteShortHigh = round2(swingLow + span * 0.786);
  const oteShortSweetSpot = round2(swingLow + span * 0.705);

  const spot = slice[slice.length - 1].close;
  const positionPct = round2(clamp(((spot - swingLow) / span) * 100, 0, 100));

  let zone: DealingRangeSnapshot['zone'] = 'EQUILIBRIUM';
  if (positionPct <= 21.4) zone = 'DEEP_DISCOUNT';
  else if (positionPct <= 42) zone = 'DISCOUNT_OTE';
  else if (positionPct >= 78.6) zone = 'DEEP_PREMIUM';
  else if (positionPct >= 58) zone = 'PREMIUM_OTE';

  return {
    timeframe,
    swingHigh: round2(swingHigh),
    swingLow: round2(swingLow),
    equilibrium50,
    oteLongLow,
    oteLongHigh,
    oteLongSweetSpot,
    oteShortLow,
    oteShortHigh,
    oteShortSweetSpot,
    positionPct,
    zone,
  };
}

/**
 * Computes ATR-normalized Fair Value Gaps with fill percentage & Inversion FVG (iFVG) detection.
 */
export function enrichFairValueGaps(candles: Candle[], fvgs: FairValueGap[], atr: number): FairValueGap[] {
  const safeAtr = Math.max(0.8, atr);
  return fvgs.map((fvg) => {
    const idx = candles.findIndex((c) => c.time === fvg.startTime);
    const future = idx >= 0 ? candles.slice(idx + 2) : [];
    const gapSize = Math.max(0.01, fvg.top - fvg.bottom);
    const atrMultiple = round2(gapSize / safeAtr);

    let maxFill = 0;
    let isInversion = false;

    for (const f of future) {
      if (fvg.direction === 'BULLISH') {
        if (f.low < fvg.top) {
          maxFill = Math.max(maxFill, clamp((fvg.top - f.low) / gapSize, 0, 1));
        }
        if (f.close < fvg.bottom) {
          isInversion = true;
        }
      } else {
        if (f.high > fvg.bottom) {
          maxFill = Math.max(maxFill, clamp((f.high - fvg.bottom) / gapSize, 0, 1));
        }
        if (f.close > fvg.top) {
          isInversion = true;
        }
      }
    }

    return {
      ...fvg,
      atrMultiple,
      fillPct: round2(maxFill),
      isInversion,
    };
  });
}

/**
 * Enriches Order Blocks with Institutional Quality Scoring:
 * - Body-to-range commitment ratio (prefers >= 55% solid body, penalizes dojis)
 * - Displacement impulse strength in ATR multiples
 * - Golden Confluence (overlapping/adjacent unmitigated FVG)
 * - Prior liquidity sweep footprint
 * - Breaker Block flip detection
 */
export function enrichOrderBlocks(
  candles: Candle[],
  orderBlocks: OrderBlock[],
  fvgs: FairValueGap[],
  atr: number
): OrderBlock[] {
  const safeAtr = Math.max(0.8, atr);
  const avgVol = candles.reduce((s, c) => s + c.volume, 0) / Math.max(1, candles.length);

  return orderBlocks.map((ob) => {
    const idx = candles.findIndex((c) => c.time === ob.startTime);
    if (idx === -1) {
      return { ...ob, bodyRatio: 0.6, displacementAtr: 1.0, hasFvgConfluence: false, sweptLiquidity: false, qualityScore: 60, isBreaker: false };
    }

    const c = candles[idx];
    const totalRange = Math.max(0.05, c.high - c.low);
    const bodyRatio = round2(Math.abs(c.close - c.open) / totalRange);

    const nxt1 = candles[idx + 1];
    const nxt2 = candles[idx + 2];
    const dispMove =
      ob.direction === 'BULLISH'
        ? Math.max((nxt1?.close ?? c.close) - c.low, (nxt2?.close ?? c.close) - c.low)
        : Math.max(c.high - (nxt1?.close ?? c.close), c.high - (nxt2?.close ?? c.close));
    const displacementAtr = round2(Math.max(0, dispMove / safeAtr));

    // Check if this OB swept the prior 8 bars' low (bullish) or high (bearish)
    const prior = candles.slice(Math.max(0, idx - 8), idx);
    const sweptLiquidity =
      prior.length >= 3 &&
      (ob.direction === 'BULLISH'
        ? c.low < Math.min(...prior.map((p) => p.low))
        : c.high > Math.max(...prior.map((p) => p.high)));

    // Check "Golden Confluence": unmitigated same-direction FVG overlapping or within 0.6 ATR
    const hasFvgConfluence = fvgs.some((f) => {
      if (f.direction !== ob.direction || f.isInversion) return false;
      const dist =
        ob.direction === 'BULLISH'
          ? Math.abs(f.bottom - ob.high)
          : Math.abs(ob.low - f.top);
      const overlaps = f.bottom <= ob.high && f.top >= ob.low;
      return overlaps || dist <= safeAtr * 0.75;
    });

    // Check Breaker Block flip (candle body closed cleanly past OB extreme)
    const future = candles.slice(idx + 2);
    const isBreaker = future.some((f) =>
      ob.direction === 'BULLISH' ? f.close < ob.low : f.close > ob.high
    );

    const volRatio = c.volume / Math.max(1, avgVol);
    let score = 35;
    if (bodyRatio >= 0.6) score += 18;
    else if (bodyRatio >= 0.45) score += 11;
    else score += 4;

    if (displacementAtr >= 1.5) score += 18;
    else if (displacementAtr >= 1.0) score += 12;
    else score += 5;

    if (hasFvgConfluence) score += 16;
    if (sweptLiquidity) score += 10;
    if (volRatio >= 1.4) score += 6;
    if (ob.mitigated) score -= 18;
    if (isBreaker) score -= 12;

    return {
      ...ob,
      bodyRatio,
      displacementAtr,
      hasFvgConfluence,
      sweptLiquidity,
      isBreaker,
      qualityScore: Math.round(clamp(score, 10, 100)),
    };
  });
}

/**
 * Detects active Gold Stop-Hunt / Liquidity Sweep & Reject footprints on recent candles.
 * Classic XAUUSD institutional behavior: wick pierces prior swing high/low (or equal highs/lows)
 * and closes back inside with strong rejection wick.
 */
export function detectLiquiditySweepFootprint(
  candles: Candle[],
  liquidity: LiquidityPool[]
): {
  active: boolean;
  side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE';
  level: number | null;
  wickRejectionRatio: number;
  enrichedLiquidity: LiquidityPool[];
} {
  if (candles.length < 24) {
    return { active: false, side: 'NONE', level: null, wickRejectionRatio: 0, enrichedLiquidity: liquidity };
  }

  const priorWindow = candles.slice(-36, -6);
  const recentWindow = candles.slice(-6);
  const priorHigh = Math.max(...priorWindow.map((c) => c.high));
  const priorLow = Math.min(...priorWindow.map((c) => c.low));

  let side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE' = 'NONE';
  let level: number | null = null;
  let bestWickRatio = 0;

  for (const c of recentWindow) {
    const body = Math.max(0.05, Math.abs(c.close - c.open));
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);

    // Bullish SSL Sweep & Reclaim: pierced below priorLow, closed back above priorLow
    if (c.low < priorLow && c.close > priorLow) {
      const ratio = round2(lowerWick / body);
      if (ratio >= 0.8) {
        side = 'SSL_SWEEP_BULLISH';
        level = round2(priorLow);
        bestWickRatio = Math.max(bestWickRatio, ratio);
      }
    }

    // Bearish BSL Sweep & Reject: pierced above priorHigh, closed back below priorHigh
    if (c.high > priorHigh && c.close < priorHigh) {
      const ratio = round2(upperWick / body);
      if (ratio >= 0.8) {
        side = 'BSL_SWEEP_BEARISH';
        level = round2(priorHigh);
        bestWickRatio = Math.max(bestWickRatio, ratio);
      }
    }
  }

  // Enrich liquidity pools with sweepRejected & equal touch clusters
  const enrichedLiquidity = liquidity.map((pool) => {
    const tol = Math.max(0.4, (priorHigh - priorLow) * 0.03);
    const touches = candles.slice(-50).filter((c) =>
      pool.side === 'BSL' ? Math.abs(c.high - pool.level) <= tol : Math.abs(c.low - pool.level) <= tol
    ).length;

    const sweepRejected =
      (pool.side === 'SSL' && side === 'SSL_SWEEP_BULLISH') ||
      (pool.side === 'BSL' && side === 'BSL_SWEEP_BEARISH');

    return {
      ...pool,
      touches,
      sweepRejected,
    };
  });

  return {
    active: side !== 'NONE',
    side,
    level,
    wickRejectionRatio: bestWickRatio,
    enrichedLiquidity,
  };
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
 * Computes structural bias & strength (-1..+1) for a specific timeframe (especially 4H Compass & 1H Context).
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
  // EMA stack & slope
  if (lastClose > e20 && e20 > e50) score += 0.4;
  else if (lastClose < e20 && e20 < e50) score -= 0.4;
  else if (lastClose > e50) score += 0.15;
  else if (lastClose < e50) score -= 0.15;

  // Recent structural BOS / CHoCH
  const lastStr = structures[structures.length - 1];
  if (lastStr) {
    const mult = lastStr.kind === 'CHoCH' ? 0.35 : 0.28;
    score += lastStr.direction === 'BULLISH' ? mult : -mult;
  }

  // Cardwell RSI Regime confirmation
  if (rsiState.regime === 'BULLISH_REGIME') score += 0.25;
  else if (rsiState.regime === 'BEARISH_REGIME') score -= 0.25;

  const strength = round3(clamp(score, -1, 1));
  const bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
    strength >= 0.22 ? 'BULLISH' : strength <= -0.22 ? 'BEARISH' : 'NEUTRAL';

  return {
    bias,
    strength,
    lastStructure: lastStr ? `${lastStr.direction === 'BULLISH' ? 'Bull' : 'Bear'} ${lastStr.kind}` : 'Range',
  };
}

export interface PayamBrainInput {
  executionTimeframe: Timeframe;
  candlesByTf: Record<Timeframe, Candle[]>;
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  structures: StructureEvent[];
  liquidity: LiquidityPool[];
  tpi: TpiSnapshot;
  regime: MarketRegime;
  rsi: RsiSnapshot;
  dealingRange: DealingRangeSnapshot;
  structuresByTf: Record<Timeframe, StructureEvent[]>;
  obsByTf: Record<Timeframe, OrderBlock[]>;
  fvgsByTf: Record<Timeframe, FairValueGap[]>;
  newsGate?: NewsGateStatus;
  basis?: BasisDivergence;
  spread?: number;
  nowMs?: number;
  agentConfig?: Partial<AgentConfig>;
  newsShock?: { detected: boolean; headline?: string | null };
}

/**
 * Scores all 6 Institutional Pillars (total = 100 pts) for a single directional hypothesis (LONG or SHORT).
 */
function scoreDirectionPillars(
  dir: 'LONG' | 'SHORT',
  ctx: {
    spot: number;
    atr: number;
    h4: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    h1: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    execBias: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number; lastStructure: string };
    rsi: RsiSnapshot;
    dealingRange: DealingRangeSnapshot;
    obs: OrderBlock[];
    fvgs: FairValueGap[];
    h1Obs: OrderBlock[];
    h1Fvgs: FairValueGap[];
    sweep: { active: boolean; side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE'; level: number | null; wickRejectionRatio: number };
    killzone: KillzoneWindow;
    newsGate?: NewsGateStatus;
    basis?: BasisDivergence;
  }
): { total: number; pillars: ConfluencePillarScore[]; goldenConfluence: boolean } {
  const isLong = dir === 'LONG';
  const smcDir = isLong ? 'BULLISH' : 'BEARISH';
  const oppDir = isLong ? 'BEARISH' : 'BULLISH';

  // --- PILLAR 1: 4H Macro Compass (Max 20) ---
  let p1Score = 10;
  let p1Detail = `H4 Neutral (${ctx.h4.lastStructure}, RSI ${ctx.rsi.byTimeframe.H4.value.toFixed(1)})`;
  if (ctx.h4.bias === smcDir) {
    p1Score = Math.round(14 + Math.min(6, Math.abs(ctx.h4.strength) * 7));
    p1Detail = `H4 ${ctx.h4.bias} (${ctx.h4.lastStructure} · RSI ${ctx.rsi.byTimeframe.H4.value.toFixed(1)} ${ctx.rsi.byTimeframe.H4.regime.replace('_REGIME', '')})`;
  } else if (ctx.h4.bias === oppDir) {
    p1Score = Math.max(0, Math.round(6 - Math.abs(ctx.h4.strength) * 6));
    p1Detail = `Counter-H4 ${ctx.h4.bias} headwind (${ctx.h4.lastStructure})`;
  }

  // --- PILLAR 2: 1H Structure & Liquidity Sweep (Max 20) ---
  let p2Score = 0;
  const alignedSweep =
    (isLong && ctx.sweep.side === 'SSL_SWEEP_BULLISH') || (!isLong && ctx.sweep.side === 'BSL_SWEEP_BEARISH');
  const opposingSweep =
    (isLong && ctx.sweep.side === 'BSL_SWEEP_BEARISH') || (!isLong && ctx.sweep.side === 'SSL_SWEEP_BULLISH');

  if (ctx.h1.bias === smcDir) p2Score += 10;
  else if (ctx.h1.bias === 'NEUTRAL') p2Score += 5;
  else p2Score += 1;

  if (ctx.execBias.bias === smcDir) p2Score += 4;
  if (alignedSweep) p2Score += 6;
  else if (!opposingSweep) p2Score += 2;

  p2Score = clamp(p2Score, 0, 20);
  const p2Detail = alignedSweep
    ? `Confirmed ${isLong ? 'SSL' : 'BSL'} Sweep @ ${ctx.sweep.level?.toFixed(2)} + H1 ${ctx.h1.bias}`
    : `H1 ${ctx.h1.bias} (${ctx.h1.lastStructure}) · Exec ${ctx.execBias.lastStructure}`;

  // --- PILLAR 3: Order Block Quality & Displacement (Max 18) ---
  const candidateObs = [...ctx.obs, ...ctx.h1Obs].filter((o) => o.direction === smcDir && !o.isBreaker);
  const unmitigatedObs = candidateObs.filter((o) => !o.mitigated);
  const bestOb = (unmitigatedObs.length > 0 ? unmitigatedObs : candidateObs).sort(
    (a, b) => (b.qualityScore ?? 50) - (a.qualityScore ?? 50)
  )[0];
  const breakerSupport = [...ctx.obs, ...ctx.h1Obs].find((o) => o.direction === oppDir && o.isBreaker);

  let p3Score = 4;
  let p3Detail = 'No fresh aligned OB detected';
  if (bestOb) {
    const q = bestOb.qualityScore ?? 60;
    const distAtr = Math.abs(ctx.spot - bestOb.mt50) / Math.max(0.8, ctx.atr);
    const proximityBonus = distAtr <= 1.2 ? 5 : distAtr <= 2.5 ? 3 : 1;
    const freshBonus = bestOb.mitigated ? 0 : 4;
    p3Score = clamp(Math.round((q / 100) * 11 + proximityBonus + freshBonus), 0, 18);
    p3Detail = `${bestOb.mitigated ? 'Tested' : 'Fresh'} OB MT ${bestOb.mt50.toFixed(2)} (Q${q} · Body ${Math.round((bestOb.bodyRatio ?? 0.6) * 100)}% · Disp ${(bestOb.displacementAtr ?? 1).toFixed(1)}xATR)`;
  } else if (breakerSupport) {
    p3Score = 12;
    p3Detail = `Breaker Block flip @ ${breakerSupport.mt50.toFixed(2)}`;
  }

  // --- PILLAR 4: Fair Value Gap & Golden OB+FVG Overlap (Max 15) ---
  const alignedFvgs = [...ctx.fvgs, ...ctx.h1Fvgs].filter((f) => f.direction === smcDir && !f.isInversion);
  const freshFvgs = alignedFvgs.filter((f) => !f.mitigated);
  const bestFvg = freshFvgs[freshFvgs.length - 1] ?? alignedFvgs[alignedFvgs.length - 1];
  const goldenConfluence = Boolean(bestOb?.hasFvgConfluence && freshFvgs.length > 0);
  const iFvgSupport = ctx.fvgs.some((f) => f.direction === oppDir && f.isInversion);

  let p4Score = 3;
  let p4Detail = 'No active FVG imbalance';
  if (bestFvg) {
    const base = bestFvg.mitigated ? 5 : 9;
    const goldenBonus = goldenConfluence ? 5 : 0;
    const sizeBonus = (bestFvg.atrMultiple ?? 0.3) >= 0.35 ? 1 : 0;
    p4Score = clamp(base + goldenBonus + sizeBonus, 0, 15);
    p4Detail = `${goldenConfluence ? 'Golden OB+FVG Overlap' : 'FVG CE'} @ ${bestFvg.ce50.toFixed(2)} (${(bestFvg.atrMultiple ?? 0.4).toFixed(2)}x ATR)`;
  } else if (iFvgSupport) {
    p4Score = 10;
    p4Detail = 'Inversion FVG (iFVG) role flip active';
  }

  // --- PILLAR 5: RSI(14) Cardwell Regime & Divergence (Max 15) ---
  const rExec = ctx.rsi.active;
  const rH1 = ctx.rsi.byTimeframe.H1;
  let p5Score = 5;
  const rsiNotes: string[] = [];

  if (isLong) {
    if (rExec.regime === 'BULLISH_REGIME' || rH1.regime === 'BULLISH_REGIME') {
      p5Score += 4;
      rsiNotes.push('Bull 40-80');
    }
    if (rExec.value >= 38 && rExec.value <= 58) {
      p5Score += 3;
      rsiNotes.push('Pullback Reset');
    } else if (rExec.value > 73) {
      p5Score -= 5;
      rsiNotes.push('Overbought Penalty');
    }
    if (rExec.divergence === 'BULLISH_HIDDEN' || rH1.divergence === 'BULLISH_HIDDEN') {
      p5Score += 4;
      rsiNotes.push('Hidden Bull Div');
    } else if (rExec.divergence === 'BULLISH_REGULAR' || rH1.divergence === 'BULLISH_REGULAR') {
      p5Score += 4;
      rsiNotes.push('Regular Bull Div');
    } else if (rExec.divergence === 'BEARISH_REGULAR') {
      p5Score -= 4;
      rsiNotes.push('Opposing Bear Div');
    }
  } else {
    if (rExec.regime === 'BEARISH_REGIME' || rH1.regime === 'BEARISH_REGIME') {
      p5Score += 4;
      rsiNotes.push('Bear 20-60');
    }
    if (rExec.value >= 42 && rExec.value <= 62) {
      p5Score += 3;
      rsiNotes.push('Rally Reset');
    } else if (rExec.value < 27) {
      p5Score -= 5;
      rsiNotes.push('Oversold Penalty');
    }
    if (rExec.divergence === 'BEARISH_HIDDEN' || rH1.divergence === 'BEARISH_HIDDEN') {
      p5Score += 4;
      rsiNotes.push('Hidden Bear Div');
    } else if (rExec.divergence === 'BEARISH_REGULAR' || rH1.divergence === 'BEARISH_REGULAR') {
      p5Score += 4;
      rsiNotes.push('Regular Bear Div');
    } else if (rExec.divergence === 'BULLISH_REGULAR') {
      p5Score -= 4;
      rsiNotes.push('Opposing Bull Div');
    }
  }
  p5Score = clamp(p5Score, 0, 15);
  const p5Detail = `RSI(14) ${rExec.value.toFixed(1)} / H1 ${rH1.value.toFixed(1)}${rsiNotes.length ? ` · ${rsiNotes.join(', ')}` : ''}`;

  // --- PILLAR 6: Premium/Discount OTE + Killzone + Basis/News Hygiene (Max 12) ---
  let p6Score = 0;
  const p6Notes: string[] = [];
  if (isLong) {
    if (ctx.dealingRange.zone === 'DISCOUNT_OTE' || ctx.dealingRange.zone === 'DEEP_DISCOUNT') {
      p6Score += 6;
      p6Notes.push(`Discount ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    } else if (ctx.dealingRange.zone === 'EQUILIBRIUM') {
      p6Score += 3;
      p6Notes.push(`EQ ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    } else {
      p6Score += 1;
      p6Notes.push(`Premium ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    }
  } else {
    if (ctx.dealingRange.zone === 'PREMIUM_OTE' || ctx.dealingRange.zone === 'DEEP_PREMIUM') {
      p6Score += 6;
      p6Notes.push(`Premium ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    } else if (ctx.dealingRange.zone === 'EQUILIBRIUM') {
      p6Score += 3;
      p6Notes.push(`EQ ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    } else {
      p6Score += 1;
      p6Notes.push(`Discount ${ctx.dealingRange.positionPct.toFixed(0)}%`);
    }
  }

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

  const newsClear = !ctx.newsGate || ctx.newsGate.state === 'CLEAR';
  const basisClean = !ctx.basis || !ctx.basis.cryptoInducementWarning;
  if (newsClear && basisClean) p6Score += 3;
  else if (basisClean && ctx.newsGate?.state === 'CAUTION') p6Score += 1;

  p6Score = clamp(p6Score, 0, 12);
  const p6Detail = p6Notes.join(' · ');

  const statusOf = (score: number, max: number): ConfluencePillarScore['status'] => {
    const pct = score / max;
    if (pct >= 0.72) return 'STRONG';
    if (pct >= 0.48) return 'MODERATE';
    if (pct >= 0.25) return 'WEAK';
    return 'OPPOSING';
  };

  const pillars: ConfluencePillarScore[] = [
    {
      id: 'H4_COMPASS',
      label: '4H Macro Compass',
      labelFa: 'قطب‌نمای روند ۴ ساعته',
      score: p1Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.H4_COMPASS,
      status: statusOf(p1Score, BRAIN_PILLAR_WEIGHTS.H4_COMPASS),
      detail: p1Detail,
    },
    {
      id: 'H1_SWEEP_STRUCT',
      label: '1H Structure & Sweep',
      labelFa: 'ساختار ۱ ساعته و شکار نقدینگی',
      score: p2Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.H1_SWEEP_STRUCT,
      status: statusOf(p2Score, BRAIN_PILLAR_WEIGHTS.H1_SWEEP_STRUCT),
      detail: p2Detail,
    },
    {
      id: 'OB_QUALITY',
      label: 'Order Block Quality',
      labelFa: 'کیفیت اردربلاک و دیسپلیسمنت',
      score: p3Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.OB_QUALITY,
      status: statusOf(p3Score, BRAIN_PILLAR_WEIGHTS.OB_QUALITY),
      detail: p3Detail,
    },
    {
      id: 'FVG_GOLDEN',
      label: 'FVG & Golden Overlap',
      labelFa: 'همپوشانی FVG و اردربلاک',
      score: p4Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.FVG_GOLDEN,
      status: statusOf(p4Score, BRAIN_PILLAR_WEIGHTS.FVG_GOLDEN),
      detail: p4Detail,
    },
    {
      id: 'RSI_MOMENTUM',
      label: 'RSI Regime & Divergence',
      labelFa: 'رژیم و واگرایی RSI',
      score: p5Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.RSI_MOMENTUM,
      status: statusOf(p5Score, BRAIN_PILLAR_WEIGHTS.RSI_MOMENTUM),
      detail: p5Detail,
    },
    {
      id: 'OTE_SESSION_MACRO',
      label: 'OTE Zone & Macro Gate',
      labelFa: 'ناحیه OTE و فیلتر سشن/خبر',
      score: p6Score,
      maxScore: BRAIN_PILLAR_WEIGHTS.OTE_SESSION_MACRO,
      status: statusOf(p6Score, BRAIN_PILLAR_WEIGHTS.OTE_SESSION_MACRO),
      detail: p6Detail,
    },
  ];

  const total = pillars.reduce((acc, p) => acc + p.score, 0);
  return { total, pillars, goldenConfluence };
}

/**
 * Evaluates the 7-Gate Anti-Emotion, Anti-Chasing, and Anti-Fakeout Defense Shield.
 */
function evaluateDefenseShield(ctx: {
  candidateDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  spot: number;
  atr: number;
  spread: number;
  candles: Candle[];
  h4: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; strength: number };
  rsi: RsiSnapshot;
  dealingRange: DealingRangeSnapshot;
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
  agentConfig?: Partial<AgentConfig>;
  newsShock?: { detected: boolean; headline?: string | null };
}): DefenseGateResult[] {
  const isLong = ctx.candidateDirection === 'LONG';
  const isShort = ctx.candidateDirection === 'SHORT';
  const gates: DefenseGateResult[] = [];

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
  const directionalExt = isLong ? ctx.atrExtensionSigned : isShort ? -ctx.atrExtensionSigned : Math.abs(ctx.atrExtensionSigned);
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
      detail: `Mild extension (${directionalExt.toFixed(2)}x ATR); prefer pullback Limit at OB/FVG CE rather than chasing.`,
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

  // 5. Chop, Session & Whipsaw Efficiency Filter
  const spreadToAtr = ctx.spread / Math.max(0.5, ctx.atr);
  const asianBlocked = ctx.agentConfig?.allowAsianSessionEntries === false && ctx.killzone === 'ASIAN_ACCUMULATION';
  if (asianBlocked) {
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
      detail: 'Moderate range chop; wait for clean OB/FVG touch.',
    });
  } else {
    gates.push({
      id: 'CHOP_EFFICIENCY_FILTER',
      label: 'Chop & Whipsaw Filter',
      status: 'PASS',
      hardVeto: false,
      metric: `ER ${ctx.kaufmanEfficiency.toFixed(2)}`,
      detail: 'Clean directional efficiency without erratic spread/chop distortion.',
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
      detail: `Favorable ${ctx.dealingRange.zone.replace('_', ' ')} pricing inside dealing range.`,
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
 * Master Payam Institutional Financial Brain Orchestrator.
 * Synthesizes 4H Compass -> 1H Context -> 15M/5M SMC (OB + FVG + Liquidity Sweep) -> Wilder RSI(14) + Divergences ->
 * OTE Dealing Range -> 6-Pillar 100-Point Weighted Confluence -> 7-Gate Anti-Emotion Defense Shield.
 */
export function evaluatePayamBrain(input: PayamBrainInput): PayamBrainReport {
  const nowMs = input.nowMs ?? Date.now();
  const activeCandles = input.candlesByTf[input.executionTimeframe] ?? [];
  const spot = activeCandles[activeCandles.length - 1]?.close ?? 2742.6;
  const atr = Math.max(1.2, input.regime.atr);
  const spread = input.spread ?? 0.24;

  const h4Candles = input.candlesByTf.H4 ?? activeCandles;
  const h1Candles = input.candlesByTf.H1 ?? activeCandles;
  const m15Candles = input.candlesByTf.M15 ?? activeCandles;
  const m5Candles = input.candlesByTf.M5 ?? activeCandles;

  const h4BiasObj = evaluateTimeframeBias(h4Candles, input.rsi.byTimeframe.H4, input.structuresByTf.H4 ?? []);
  const h1BiasObj = evaluateTimeframeBias(h1Candles, input.rsi.byTimeframe.H1, input.structuresByTf.H1 ?? []);
  const m15BiasObj = evaluateTimeframeBias(m15Candles, input.rsi.byTimeframe.M15, input.structuresByTf.M15 ?? []);
  const m5BiasObj = evaluateTimeframeBias(m5Candles, input.rsi.byTimeframe.M5, input.structuresByTf.M5 ?? []);
  const execBiasObj = evaluateTimeframeBias(activeCandles, input.rsi.active, input.structures);

  const sweep = detectLiquiditySweepFootprint(activeCandles, input.liquidity);
  const killzone = classifyKillzoneWindow(nowMs);
  const kaufmanEfficiency = computeKaufmanEfficiency(activeCandles, 16);

  const closes = activeCandles.map((c) => c.close);
  const ema20Series = computeEmaSeries(closes, 20);
  const ema20 = ema20Series[ema20Series.length - 1] ?? spot;
  const atrExtensionSigned = round2((spot - ema20) / atr);

  const sharedCtx = {
    spot,
    atr,
    h4: h4BiasObj,
    h1: h1BiasObj,
    execBias: execBiasObj,
    rsi: input.rsi,
    dealingRange: input.dealingRange,
    obs: input.orderBlocks,
    fvgs: input.fvgs,
    h1Obs: input.obsByTf.H1 ?? [],
    h1Fvgs: input.fvgsByTf.H1 ?? [],
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
  const hasFreshFvg = input.fvgs.some(
    (f) => !f.mitigated && !f.isInversion && f.direction === (candidateDirection === 'SHORT' ? 'BEARISH' : 'BULLISH')
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
    agentConfig: input.agentConfig,
    newsShock: input.newsShock,
  });

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

  // Construct Top-Down 4H -> 1H -> 15M -> 5M Matrix
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

  // Build Watchlist Pullback / Entry Zone anchored strictly to real OB/FVG/OTE levels
  const smcDir = candidateDirection === 'SHORT' ? 'BEARISH' : 'BULLISH';
  const anchorOb = input.orderBlocks.find((o) => !o.mitigated && !o.isBreaker && o.direction === smcDir);
  const anchorFvg = input.fvgs.find((f) => !f.mitigated && !f.isInversion && f.direction === smcDir);
  const optimalEntry = round2(
    anchorOb?.mt50 ??
      anchorFvg?.ce50 ??
      (candidateDirection === 'SHORT' ? input.dealingRange.oteShortSweetSpot : input.dealingRange.oteLongSweetSpot)
  );
  const zoneHalf = round2(Math.max(0.8, atr * 0.35));
  const invalidationLevel = round2(
    candidateDirection === 'SHORT'
      ? (anchorOb ? anchorOb.high + atr * 0.35 : optimalEntry + atr * 1.25)
      : (anchorOb ? anchorOb.low - atr * 0.35 : optimalEntry - atr * 1.25)
  );
  const targetLiquidity = round2(
    candidateDirection === 'SHORT'
      ? Math.min(input.dealingRange.swingLow, optimalEntry - atr * 2.4)
      : Math.max(input.dealingRange.swingHigh, optimalEntry + atr * 2.4)
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
    const primaryReason = hardVetoes[0] ?? `Confluence score ${winningEval.total}/100 is below institutional floor (${minThreshold}/100)`;
    summaryEn = `STAND DOWN (${winningEval.total}/100): ${primaryReason}. Patiently watching pullback zone $${watchlistZone.entryLow.toFixed(2)}–$${watchlistZone.entryHigh.toFixed(2)} aligned with H4 ${h4BiasObj.bias}.`;
    summaryFa = `توقف منضبط (امتیاز ${winningEval.total}/100): به دلیل فیلتر حفاظتی (${defenseGates.find((g) => g.hardVeto)?.label ?? 'حداقل امتیاز همگرایی'}) از ورود هیجانی خودداری شد. انتظار برای بازگشت قیمت به ناحیه نهادی ${watchlistZone.entryLow.toFixed(2)} تا ${watchlistZone.entryHigh.toFixed(2)} در همسویی با روند ۴ ساعته (${h4BiasObj.bias}).`;
  } else {
    const dirLabel = decision === 'PROPOSE_LONG' ? 'LONG' : 'SHORT';
    const dirFa = dirLabel === 'LONG' ? 'خرید (LONG)' : 'فروش (SHORT)';
    summaryEn = `Grade ${convictionGrade} ${dirLabel} (${winningEval.total}/100) on ${input.executionTimeframe}: H4 ${h4BiasObj.bias}, H1 ${h1BiasObj.bias}, RSI(14) ${input.rsi.active.value.toFixed(1)} (${input.rsi.active.regime.replace('_REGIME', '')})${winningEval.goldenConfluence ? ', Golden OB+FVG Overlap' : ''}. Risk budget ${(recommendedRiskMultiplier * 100).toFixed(0)}%.`;
    summaryFa = `ستاپ درجه‌بندی ${convictionGrade} در جهت ${dirFa} با امتیاز ${winningEval.total}/100 در تایم‌فریم ${input.executionTimeframe}: همسو با قطب‌نمای ۴ ساعته (${h4BiasObj.bias}) و ساختار ۱ ساعته (${h1BiasObj.bias})، RSI برابر ${input.rsi.active.value.toFixed(1)}${winningEval.goldenConfluence ? ' و همپوشانی طلایی اردربلاک + FVG' : ''}. ضریب حجم پیشنهادی ${(recommendedRiskMultiplier * 100).toFixed(0)}%.`;
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
    summaryEn,
    summaryFa,
  };
}

/**
 * Generates an institutional structurally-anchored proposal from PayamBrainReport.
 * Strictly respects Stand-Down discipline when hardVetoes exist unless forceWatchlistFallback is set for initial seed demos.
 */
export function buildInstitutionalProposalFromBrain(params: {
  spotPrice: number;
  timeframe: Timeframe;
  brain: PayamBrainReport;
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  liquidity: LiquidityPool[];
  atr: number;
  spread: number;
  newsGate: NewsGateStatus;
  divergence: BasisDivergence;
  validateGuardrails: (
    direction: 'LONG' | 'SHORT',
    entry: number,
    stopLoss: number,
    tp1: number,
    tp2: number,
    atr: number
  ) => { valid: boolean; rrRatio: number; errors: string[] };
  variantIndex?: number;
  allowCautionVariant?: boolean;
  minRrRatio?: number;
}): AgentProposal | null {
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
  } = params;

  if (newsGate.vetoNewEntries) return null;

  // Enforce strict Anti-Emotion & Anti-Fakeout Discipline!
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
  const safeAtr = Math.max(2.2, atr);

  const activeOb = orderBlocks.find((o) => !o.mitigated && !o.isBreaker && o.direction === smcDir);
  const activeFvg = fvgs.find((f) => !f.mitigated && !f.isInversion && f.direction === smcDir);

  // Structural Entry Anchor: snap near fresh OB MT50 or FVG CE50 if within 1.8 ATR of spot, else optimal pullback near spot
  let entry = spotPrice;
  const candidateAnchor =
    variantIndex % 2 === 0
      ? (activeOb?.mt50 ?? activeFvg?.ce50)
      : (activeFvg?.ce50 ?? activeOb?.mt50);

  if (candidateAnchor !== undefined && Math.abs(candidateAnchor - spotPrice) <= safeAtr * 1.85) {
    entry = round2(candidateAnchor);
  } else {
    entry = round2(spotPrice + (isLong ? -0.35 : 0.35) * (variantIndex % 2));
  }

  // Structural Stop Loss: strictly beyond OB extreme wick + Gold spread/ATR buffer (min 1.05 * ATR, min $3.60)
  const minSlDist = Math.max(safeAtr * 1.05, 3.6);
  const buffer = Math.max(0.6, spread * 2 + safeAtr * 0.2);
  let structuralSl = isLong ? entry - minSlDist : entry + minSlDist;

  if (activeOb) {
    const obExtremeSl = isLong ? activeOb.low - buffer : activeOb.high + buffer;
    const distFromOb = Math.abs(entry - obExtremeSl);
    if (distFromOb >= minSlDist * 0.85 && distFromOb <= safeAtr * 2.8) {
      structuralSl = round2(obExtremeSl);
    }
  }
  const stopLoss = round2(structuralSl);
  const riskDist = Math.max(minSlDist * 0.85, Math.abs(entry - stopLoss));

  // Targets: TP1 >= max(minRrRatio, grade target) aligned toward opposing internal liquidity, TP2 >= TP1 + 1.25R
  const gradeRr = brain.convictionGrade === 'A+' ? 2.15 : brain.convictionGrade === 'A' ? 1.95 : 1.75;
  const rr1 = Math.max(minRrRatio, gradeRr);
  const rr2 = rr1 + 1.25;
  const opposingLiq = liquidity.find((l) => l.side === (isLong ? 'BSL' : 'SSL'));

  let tp1 = round2(isLong ? entry + riskDist * rr1 : entry - riskDist * rr1);
  let tp2 = round2(isLong ? entry + riskDist * rr2 : entry - riskDist * rr2);

  if (opposingLiq) {
    const distToLiq = isLong ? opposingLiq.level - entry : entry - opposingLiq.level;
    if (distToLiq >= riskDist * 1.65 && distToLiq <= riskDist * 2.6) {
      tp1 = round2(opposingLiq.level);
      tp2 = round2(isLong ? Math.max(tp1 + riskDist * 1.05, tp2) : Math.min(tp1 - riskDist * 1.05, tp2));
    }
  }

  const guard = validateGuardrails(direction, entry, stopLoss, tp1, tp2, safeAtr);
  if (!guard.valid) return null;

  const isCounter4H =
    (isLong && brain.h4Bias === 'BEARISH') || (!isLong && brain.h4Bias === 'BULLISH');

  // Authentic institutional setup classification based on actual detected footprints
  let setupType = isLong ? 'H4-Aligned Demand OB + FVG Retest' : 'H4-Aligned Supply OB + FVG Retest';
  if (brain.goldenConfluence && brain.sweepDetected.active) {
    setupType = isLong
      ? 'SSL Stop-Hunt + Golden OB/FVG Overlap'
      : 'BSL Stop-Hunt + Golden OB/FVG Overlap';
  } else if (brain.goldenConfluence) {
    setupType = isLong
      ? 'Golden Bullish OB + FVG CE Confluence'
      : 'Golden Bearish OB + FVG CE Confluence';
  } else if (brain.sweepDetected.active) {
    setupType = isLong
      ? 'SSL Liquidity Sweep & CHoCH Reclaim'
      : 'BSL Liquidity Sweep & CHoCH Rejection';
  } else if (brain.mtfMatrix.some((r) => r.divergence !== 'NONE')) {
    const divRow = brain.mtfMatrix.find((r) => r.divergence !== 'NONE')!;
    setupType = isLong
      ? `${divRow.timeframe} ${divRow.divergence === 'BULLISH_HIDDEN' ? 'Hidden' : 'Regular'} RSI Div + Demand OB`
      : `${divRow.timeframe} ${divRow.divergence === 'BEARISH_HIDDEN' ? 'Hidden' : 'Regular'} RSI Div + Supply OB`;
  } else if (isCounter4H) {
    setupType = isLong ? 'Counter-4H Exhaustion Reversal Scalp' : 'Counter-4H Premium Fade Scalp';
  }

  const rsiExec = brain.mtfMatrix.find((r) => r.timeframe === timeframe) ?? brain.mtfMatrix[2];
  const rsiSummary = `RSI ${rsiExec.rsi.toFixed(1)} · ${rsiExec.rsiRegime.replace('_REGIME', '')}${rsiExec.divergence !== 'NONE' ? ` · ${rsiExec.divergence.replace('_', ' ')}` : ''}`;
  const keyAnchor = activeOb?.mt50 ?? activeFvg?.ce50 ?? entry;
  const gradeLabel = brain.convictionGrade === 'STAND_DOWN' ? 'B' : brain.convictionGrade;
  const confidence = round2(clamp(0.55 + (brain.totalScore / 100) * 0.4, 0.62, 0.96));

  const rationaleEn = `[Grade ${gradeLabel} · ${brain.totalScore}/100] ${setupType} on ${timeframe} anchored at ${entry.toFixed(2)} (SMC POI ${keyAnchor.toFixed(2)}). H4 Compass ${brain.h4Bias}, ${rsiSummary}, Basis ${divergence.status}, R:R 1:${guard.rrRatio.toFixed(2)}.`;
  const rationaleFa = `[گرید ${gradeLabel} · امتیاز ${brain.totalScore}/100] ستاپ ${setupType} در تایم‌فریم ${timeframe} با نقطه ورود ${entry.toFixed(2)} (ناحیه نهادی ${keyAnchor.toFixed(2)}). همسو با قطب‌نمای ۴ ساعته (${brain.h4Bias})، وضعیت ${rsiSummary}، فیلتر واگرایی ${divergence.status} و نسبت سود به ضرر 1:${guard.rrRatio.toFixed(2)}.`;

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
      'h4_macro_compass',
      'h1_liquidity_sweep',
      'ob_quality_displacement',
      'fvg_golden_overlap',
      'wilder_rsi14_divergence',
      'ote_premium_discount',
      'anti_chase_7gate_shield',
      'validate_rr_guardrails',
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
  };
}
