import type {
  ClosedTradeRecord,
  ConfirmedPosition,
  SessionEquityPoint,
  SessionRiskSnapshot,
  SharpeBasis,
  SimAccountState,
  TradeEquityCurvePoint,
  TradePerformanceSeries,
} from './types';

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const EPSILON = 1e-9;

export const MAX_SESSION_EQUITY_POINTS = 96;

/**
 * Builds the initial equity history anchor points for a fresh or seeded simulation session.
 */
export function createInitialEquityHistory(
  initialBalance: number,
  currentEquity: number,
  startMs: number,
  nowMs = Date.now()
): SessionEquityPoint[] {
  const startEq = round2(Math.max(1, initialBalance));
  const curEq = round2(Math.max(0, currentEquity));
  const first: SessionEquityPoint = {
    timeMs: Math.min(startMs, nowMs),
    equity: startEq,
    peakEquity: startEq,
    drawdownPct: 0,
    drawdownUsd: 0,
  };

  if (Math.abs(curEq - startEq) < 0.005) {
    return [first];
  }

  const peak = round2(Math.max(startEq, curEq));
  const ddUsd = round2(Math.max(0, peak - curEq));
  const ddPct = peak > 0 ? round2((ddUsd / peak) * 100) : 0;

  return [
    first,
    {
      timeMs: Math.max(nowMs, first.timeMs + 1),
      equity: curEq,
      peakEquity: peak,
      drawdownPct: ddPct,
      drawdownUsd: ddUsd,
    },
  ];
}

/**
 * Appends a live equity observation to the current session's curve while updating
 * peak equity and underwater drawdown in real time.
 */
export function appendSessionEquityPoint(
  history: SessionEquityPoint[],
  equity: number,
  knownPeakEquity: number,
  timeMs = Date.now(),
  maxPoints = MAX_SESSION_EQUITY_POINTS
): SessionEquityPoint[] {
  const safeEq = round2(Math.max(0, Number.isFinite(equity) ? equity : 0));
  const prevPeak =
    history.length > 0 ? history[history.length - 1].peakEquity : safeEq;
  const peakEquity = round2(Math.max(prevPeak, knownPeakEquity, safeEq));
  const drawdownUsd = round2(Math.max(0, peakEquity - safeEq));
  const drawdownPct = peakEquity > 0 ? round2((drawdownUsd / peakEquity) * 100) : 0;

  const point: SessionEquityPoint = {
    timeMs,
    equity: safeEq,
    peakEquity,
    drawdownPct,
    drawdownUsd,
  };

  if (history.length === 0) {
    return [point];
  }

  const last = history[history.length - 1];
  // Avoid redundant duplicate points when equity hasn't changed and timestamp is identical
  if (Math.abs(last.equity - safeEq) < 0.005 && timeMs <= last.timeMs) {
    return history;
  }

  // If equity is flat across consecutive ticks and we already have >= 2 flat tail points,
  // update the tail timestamp instead of crowding out meaningful moves.
  if (
    history.length >= 2 &&
    Math.abs(last.equity - safeEq) < 0.005 &&
    Math.abs(history[history.length - 2].equity - safeEq) < 0.005
  ) {
    const updated = history.slice(0, -1);
    updated.push(point);
    return updated;
  }

  const next = [...history, point];
  if (next.length <= maxPoints) {
    return next;
  }

  // Preserve the session anchor point (index 0) and keep the most recent (maxPoints - 1) samples
  return [next[0], ...next.slice(-(maxPoints - 1))];
}

interface SampleStats {
  mean: number;
  stdDev: number;
  sharpe: number | null;
  status: 'READY' | 'INSUFFICIENT' | 'ZERO_VOLATILITY';
}

/**
 * Computes sample mean, Bessel-corrected sample standard deviation (n - 1),
 * and Sharpe ratio (r_f = 0 intraday) for a series of fractional returns.
 */
function computeReturnSeriesSharpe(returns: number[]): SampleStats {
  const n = returns.length;
  if (n < 2) {
    const singleMean = n === 1 ? returns[0] : 0;
    return {
      mean: singleMean,
      stdDev: 0,
      sharpe: null,
      status: 'INSUFFICIENT',
    };
  }

  const mean = returns.reduce((sum, r) => sum + r, 0) / n;
  let sumSq = 0;
  for (const r of returns) {
    const diff = r - mean;
    sumSq += diff * diff;
  }
  const variance = sumSq / (n - 1);
  const stdDev = Math.sqrt(Math.max(0, variance));

  if (stdDev < EPSILON) {
    if (Math.abs(mean) < EPSILON) {
      return { mean: 0, stdDev: 0, sharpe: 0, status: 'READY' };
    }
    return { mean, stdDev: 0, sharpe: null, status: 'ZERO_VOLATILITY' };
  }

  const rawSharpe = mean / stdDev;
  const clamped = Math.max(-99.99, Math.min(99.99, rawSharpe));
  return {
    mean,
    stdDev,
    sharpe: round2(clamped),
    status: 'READY',
  };
}

function classifySharpeRating(
  sharpe: number | null
): SessionRiskSnapshot['sharpeRating'] {
  if (sharpe === null || !Number.isFinite(sharpe)) return 'PENDING';
  if (sharpe >= 1.5) return 'EXCELLENT';
  if (sharpe >= 0.5) return 'GOOD';
  if (sharpe >= 0) return 'NEUTRAL';
  return 'WEAK';
}

export interface ComputeSessionRiskInput {
  account: SimAccountState;
  confirmedPositions: ConfirmedPosition[];
  closedTrades: ClosedTradeRecord[];
  equityHistory: SessionEquityPoint[];
  basis?: SharpeBasis;
}

/**
 * Calculates real-time session Drawdown (current & max in % and $) and Sharpe Ratio
 * for the current session's simulation trades.
 *
 * - TRADES basis: combines chronological closed trade returns (compounded against running
 *   session equity) with live mark-to-market returns of currently ACTIVE open trades.
 *   Unfilled PENDING_LIMIT orders are excluded until filled.
 * - MTM basis: calculates real-time Sharpe from consecutive equity-changing mark-to-market
 *   observations in the session equity curve.
 */
export function computeSessionRiskMetrics(
  input: ComputeSessionRiskInput
): SessionRiskSnapshot {
  const {
    account,
    confirmedPositions,
    closedTrades,
    equityHistory,
    basis = 'TRADES',
  } = input;

  const initialBalance = Math.max(1, account.initialBalance);
  const currentEquity = round2(account.equity);

  // 1. Real-time Peak Equity & Drawdown (Current + Session Maximum)
  let peakEquity = Math.max(initialBalance, account.peakEquity, currentEquity);
  let maxDrawdownPct = Math.max(0, account.maxDrawdownPct);
  let maxDrawdownUsd = 0;

  for (const pt of equityHistory) {
    if (pt.peakEquity > peakEquity) peakEquity = pt.peakEquity;
    if (pt.drawdownPct > maxDrawdownPct) maxDrawdownPct = pt.drawdownPct;
    if (pt.drawdownUsd > maxDrawdownUsd) maxDrawdownUsd = pt.drawdownUsd;
  }

  peakEquity = round2(peakEquity);
  const currentDrawdownUsd = round2(Math.max(0, peakEquity - currentEquity));
  const currentDrawdownPct =
    peakEquity > 0 ? round2((currentDrawdownUsd / peakEquity) * 100) : 0;

  maxDrawdownPct = round2(Math.max(maxDrawdownPct, currentDrawdownPct));
  const impliedMaxDdUsd = round2((maxDrawdownPct / 100) * peakEquity);
  maxDrawdownUsd = round2(Math.max(maxDrawdownUsd, currentDrawdownUsd, impliedMaxDdUsd));

  const isAtPeak = currentDrawdownUsd < 0.01;
  const sessionNetPnlUsd = round2(currentEquity - initialBalance);
  const sessionReturnPct = round2((sessionNetPnlUsd / initialBalance) * 100);

  // 2. Trade-Level Return Series (Closed trades chronologically + Active live trades MTM)
  const chronologicalClosed = [...closedTrades].sort(
    (a, b) => a.closedAtMs - b.closedAtMs
  );

  const tradeReturns: number[] = [];
  let runningEquity = initialBalance;
  for (const trade of chronologicalClosed) {
    const r = trade.netPnl / Math.max(1, runningEquity);
    tradeReturns.push(r);
    runningEquity = Math.max(1, runningEquity + trade.netPnl);
  }

  const activePositions = confirmedPositions.filter((p) => p.status === 'ACTIVE');
  const activeBaseEquity = Math.max(1, account.balance);
  for (const pos of activePositions) {
    tradeReturns.push(pos.netPnl / activeBaseEquity);
  }

  const tradeStats = computeReturnSeriesSharpe(tradeReturns);
  const tradeSharpeStatus: SessionRiskSnapshot['tradeSharpeStatus'] =
    tradeStats.status === 'INSUFFICIENT' ? 'INSUFFICIENT_TRADES' : tradeStats.status;

  // 3. Real-Time MTM Equity-Curve Return Series (only equity-changing transitions)
  const mtmReturns: number[] = [];
  for (let i = 1; i < equityHistory.length; i++) {
    const prev = equityHistory[i - 1].equity;
    const curr = equityHistory[i].equity;
    if (prev > 0 && Math.abs(curr - prev) >= 0.005) {
      mtmReturns.push((curr - prev) / prev);
    }
  }

  const mtmStats = computeReturnSeriesSharpe(mtmReturns);
  const mtmSharpeStatus: SessionRiskSnapshot['mtmSharpeStatus'] =
    mtmStats.status === 'INSUFFICIENT' ? 'INSUFFICIENT_SAMPLES' : mtmStats.status;

  // 4. Resolved active basis & recovery factor
  const activeSharpeRatio =
    basis === 'TRADES' ? tradeStats.sharpe : mtmStats.sharpe;
  const sharpeRating = classifySharpeRating(activeSharpeRatio);
  const recoveryFactor =
    maxDrawdownPct > 0.005 ? round2(sessionReturnPct / maxDrawdownPct) : null;

  return {
    currentEquity,
    peakEquity,
    currentDrawdownUsd,
    currentDrawdownPct,
    maxDrawdownUsd,
    maxDrawdownPct,
    isAtPeak,
    sessionNetPnlUsd,
    sessionReturnPct,
    closedTradeCount: chronologicalClosed.length,
    activeTradeCount: activePositions.length,
    totalTradeSamples: tradeReturns.length,
    tradeSharpeRatio: tradeStats.sharpe,
    tradeMeanReturnPct: round3(tradeStats.mean * 100),
    tradeStdDevPct: round3(tradeStats.stdDev * 100),
    tradeSharpeStatus,
    mtmSharpeRatio: mtmStats.sharpe,
    mtmMeanReturnPct: round3(mtmStats.mean * 100),
    mtmStdDevPct: round3(mtmStats.stdDev * 100),
    mtmReturnSamples: mtmReturns.length,
    mtmSharpeStatus,
    activeBasis: basis,
    activeSharpeRatio,
    sharpeRating,
    recoveryFactor,
  };
}

export const TRADE_EQUITY_WINDOW_SIZE = 20;

export interface BuildTradePerformanceInput {
  initialBalance: number;
  closedTrades: ClosedTradeRecord[];
  confirmedPositions: ConfirmedPosition[];
  maxEntries?: number;
}

/**
 * Builds the chronological equity curve, running underwater drawdown, and rolling
 * Sharpe ratio series across the last `maxEntries` (default 20) simulation trade entries.
 *
 * Includes all closed simulation trades sorted chronologically, followed by currently
 * ACTIVE open positions (marked `isLive: true`). Unfilled PENDING_LIMIT orders are excluded.
 */
export function buildTradePerformanceSeries(
  input: BuildTradePerformanceInput
): TradePerformanceSeries {
  const {
    initialBalance,
    closedTrades,
    confirmedPositions,
    maxEntries = TRADE_EQUITY_WINDOW_SIZE,
  } = input;

  const safeStart = round2(Math.max(1, Number.isFinite(initialBalance) ? initialBalance : 25000));
  const limit = Math.max(1, Math.floor(maxEntries));

  const chronologicalClosed = [...closedTrades].sort(
    (a, b) => a.closedAtMs - b.closedAtMs || a.openedAtMs - b.openedAtMs
  );
  const activePositions = confirmedPositions
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => a.openedAtMs - b.openedAtMs);

  interface RawTradeEntry {
    id: string;
    orderId: string;
    setupType: string;
    direction: 'LONG' | 'SHORT';
    timeframe: ClosedTradeRecord['timeframe'];
    exitReason: ClosedTradeRecord['exitReason'] | 'LIVE_OPEN';
    isLive: boolean;
    timestampMs: number;
    lotSize: number;
    netPnl: number;
    rMultiple: number;
  }

  const allEntries: RawTradeEntry[] = [
    ...chronologicalClosed.map((t) => ({
      id: t.id,
      orderId: t.orderId,
      setupType: t.setupType,
      direction: t.direction,
      timeframe: t.timeframe,
      exitReason: t.exitReason,
      isLive: false,
      timestampMs: t.closedAtMs,
      lotSize: t.lotSize,
      netPnl: round2(t.netPnl),
      rMultiple: round2(t.rMultiple),
    })),
    ...activePositions.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      setupType: p.setupType,
      direction: p.direction,
      timeframe: p.timeframe,
      exitReason: 'LIVE_OPEN' as const,
      isLive: true,
      timestampMs: p.lastReviewedMs || p.openedAtMs,
      lotSize: p.lotSize,
      netPnl: round2(p.netPnl - p.commissionPaid),
      rMultiple: round2(p.rMultiple),
    })),
  ];

  const totalTradesRecorded = allEntries.length;

  if (totalTradesRecorded === 0) {
    return {
      points: [],
      baselineEquity: safeStart,
      totalTradesRecorded: 0,
      windowLimit: limit,
      windowNetPnl: 0,
      windowReturnPct: 0,
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      currentDrawdownUsd: 0,
      currentDrawdownPct: 0,
      latestSharpe: null,
      peakSharpe: null,
      minSharpe: null,
      winRatePct: 0,
    };
  }

  // First pass: accumulate exact equity prior to the sliding window
  const windowStartIdx = Math.max(0, totalTradesRecorded - limit);
  let runningEquity = safeStart;
  for (let i = 0; i < windowStartIdx; i++) {
    runningEquity = round2(Math.max(1, runningEquity + allEntries[i].netPnl));
  }

  const baselineEquity = runningEquity;
  const windowEntries = allEntries.slice(windowStartIdx);

  let peakEquity = baselineEquity;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;
  let peakSharpe: number | null = null;
  let minSharpe: number | null = null;
  let winCount = 0;

  const windowReturns: number[] = [];
  const points: TradeEquityCurvePoint[] = [];

  for (let i = 0; i < windowEntries.length; i++) {
    const entry = windowEntries[i];
    const preEq = Math.max(1, runningEquity);
    const fractionalReturn = entry.netPnl / preEq;
    windowReturns.push(fractionalReturn);

    runningEquity = round2(Math.max(0, runningEquity + entry.netPnl));
    if (runningEquity > peakEquity) {
      peakEquity = runningEquity;
    }

    const drawdownUsd = round2(Math.max(0, peakEquity - runningEquity));
    const drawdownPct = peakEquity > 0 ? round2((drawdownUsd / peakEquity) * 100) : 0;

    if (drawdownUsd > maxDrawdownUsd) maxDrawdownUsd = drawdownUsd;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    if (entry.netPnl >= 0) winCount++;

    const sharpeStats = computeReturnSeriesSharpe(windowReturns);
    const rollingSharpe = sharpeStats.sharpe;
    if (rollingSharpe !== null) {
      peakSharpe = peakSharpe === null ? rollingSharpe : Math.max(peakSharpe, rollingSharpe);
      minSharpe = minSharpe === null ? rollingSharpe : Math.min(minSharpe, rollingSharpe);
    }

    points.push({
      slotIndex: i + 1,
      globalIndex: windowStartIdx + i + 1,
      id: entry.id,
      orderId: entry.orderId,
      setupType: entry.setupType,
      direction: entry.direction,
      timeframe: entry.timeframe,
      exitReason: entry.exitReason,
      isLive: entry.isLive,
      timestampMs: entry.timestampMs,
      lotSize: entry.lotSize,
      netPnl: entry.netPnl,
      rMultiple: entry.rMultiple,
      returnPct: round3(fractionalReturn * 100),
      equity: runningEquity,
      peakEquity: round2(peakEquity),
      drawdownUsd,
      drawdownPct,
      rollingSharpe,
    });
  }

  const lastPoint = points[points.length - 1];
  const windowNetPnl = round2(lastPoint.equity - baselineEquity);
  const windowReturnPct = round2((windowNetPnl / Math.max(1, baselineEquity)) * 100);
  const winRatePct = round2((winCount / points.length) * 100);

  return {
    points,
    baselineEquity,
    totalTradesRecorded,
    windowLimit: limit,
    windowNetPnl,
    windowReturnPct,
    maxDrawdownUsd: round2(maxDrawdownUsd),
    maxDrawdownPct: round2(maxDrawdownPct),
    currentDrawdownUsd: lastPoint.drawdownUsd,
    currentDrawdownPct: lastPoint.drawdownPct,
    latestSharpe: lastPoint.rollingSharpe,
    peakSharpe,
    minSharpe,
    winRatePct,
  };
}

