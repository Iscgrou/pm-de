import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendSessionEquityPoint,
  computeSessionRiskMetrics,
  createInitialEquityHistory,
} from './sessionRisk';
import { createInitialSimAccount } from './tradeSimulator';
import type { ClosedTradeRecord, ConfirmedPosition } from './types';

function makeClosedTrade(id: string, netPnl: number, closedAtMs: number): ClosedTradeRecord {
  return {
    id,
    orderId: `ORD-${id}`,
    proposalId: `prop-${id}`,
    setupType: 'SMC OB Retest',
    direction: 'LONG',
    timeframe: 'M15',
    lotSize: 0.25,
    entryPrice: 2740,
    exitPrice: netPnl >= 0 ? 2750 : 2734,
    openedAtMs: closedAtMs - 60_000,
    closedAtMs,
    exitReason: netPnl >= 0 ? 'TP1_PARTIAL' : 'STOP_LOSS',
    grossPnl: netPnl + 1.75,
    commission: 1.75,
    swap: 0,
    netPnl,
    rMultiple: netPnl >= 0 ? 1.5 : -1.0,
    mfeUsd: Math.max(0, netPnl),
    maeUsd: Math.min(0, netPnl),
    slippageUsd: 0.03,
  };
}

function makeActivePosition(
  id: string,
  netPnl: number,
  status: 'ACTIVE' | 'PENDING_LIMIT' = 'ACTIVE'
): ConfirmedPosition {
  return {
    id,
    orderId: `ORD-${id}`,
    proposalId: `prop-${id}`,
    setupType: 'Bullish FVG CE',
    timeframe: 'M15',
    executionType: status === 'ACTIVE' ? 'MARKET' : 'LIMIT',
    status,
    direction: 'LONG',
    requestedEntry: 2740,
    entry: 2740,
    fillPrice: 2740,
    slippageUsd: 0.03,
    initialSl: 2734,
    stopLoss: 2734,
    tp1: 2752,
    tp2: 2764,
    initialLotSize: 0.25,
    lotSize: 0.25,
    spread: 0.24,
    stage: 'OPEN',
    rrRatio: 2.0,
    unrealizedPnl: netPnl,
    grossPnl: netPnl,
    netPnl,
    realizedPnl: 0,
    commissionPaid: 0.88,
    swapAccrued: 0,
    marginUsed: 685,
    riskUsd: 150,
    mfeUsd: Math.max(0, netPnl),
    maeUsd: Math.min(0, netPnl),
    trailingStopDistance: null,
    realizedPartial: false,
    openedAtMs: 1763590000000,
    history: [],
    executionLog: [],
    rMultiple: netPnl / 150,
    urgency: 'NORMAL',
    actionTag: 'HOLD_RUNNER',
    adviceEn: 'Hold',
    adviceFa: 'نگهداری',
    lastReviewedMs: 1763590001000,
  };
}

test('Real-time current drawdown and max session drawdown track peak-to-trough and recovery', () => {
  let history = createInitialEquityHistory(25000, 25000, 1000, 1000);
  // Session rises to $25,500 peak
  history = appendSessionEquityPoint(history, 25500, 25500, 2000);
  // Pulls back to $24,990 (-$510 / -2.00% from $25,500 peak)
  history = appendSessionEquityPoint(history, 24990, 25500, 3000);
  // Partially recovers to $25,245 (-$255 / -1.00% from $25,500 peak)
  history = appendSessionEquityPoint(history, 25245, 25500, 4000);

  const account = {
    ...createInitialSimAccount(25000, 100),
    equity: 25245,
    balance: 25245,
    peakEquity: 25500,
    maxDrawdownPct: 2.0,
  };

  const snap = computeSessionRiskMetrics({
    account,
    confirmedPositions: [],
    closedTrades: [],
    equityHistory: history,
    basis: 'TRADES',
  });

  assert.equal(snap.peakEquity, 25500);
  assert.equal(snap.currentDrawdownUsd, 255);
  assert.equal(snap.currentDrawdownPct, 1.0);
  assert.equal(snap.maxDrawdownUsd, 510);
  assert.equal(snap.maxDrawdownPct, 2.0);
  assert.equal(snap.isAtPeak, false);
  assert.equal(snap.sessionNetPnlUsd, 245);
  assert.equal(snap.sessionReturnPct, 0.98);
  assert.equal(snap.recoveryFactor, 0.49);
});

test('Trade Sharpe ratio matches exact sample mean/stdDev math across closed + active live trades', () => {
  // Initial balance $10,000
  // Closed trade 1: +$300 on $10,000 -> r1 = +0.0300 (running equity = 10,300)
  // Closed trade 2: -$103 on $10,300 -> r2 = -0.0100 (running equity = 10,197)
  // Active trade 3: +$203.94 on $10,197 balance -> r3 = +0.0200
  // Pending limit order must be ignored!
  // Returns = [0.03, -0.01, 0.02]
  // Mean = 0.04 / 3 = 0.013333...
  // Sample variance = ((0.016667)^2 + (-0.023333)^2 + (0.006667)^2) / 2 = 0.000433333...
  // Sample stdDev = sqrt(0.000433333...) = 0.02081666...
  // Sharpe = 0.013333... / 0.02081666... = 0.6405 -> rounded 0.64
  const account = {
    ...createInitialSimAccount(10000, 100),
    balance: 10197,
    equity: 10400.94,
    peakEquity: 10400.94,
  };
  const closed = [
    makeClosedTrade('t2', -103, 2000), // intentionally reversed order to verify chronological sorting
    makeClosedTrade('t1', 300, 1000),
  ];
  const open = [
    makeActivePosition('p1', 203.94, 'ACTIVE'),
    makeActivePosition('p2', -999, 'PENDING_LIMIT'),
  ];

  const snap = computeSessionRiskMetrics({
    account,
    confirmedPositions: open,
    closedTrades: closed,
    equityHistory: createInitialEquityHistory(10000, 10400.94, 500, 3000),
    basis: 'TRADES',
  });

  assert.equal(snap.closedTradeCount, 2);
  assert.equal(snap.activeTradeCount, 1);
  assert.equal(snap.totalTradeSamples, 3);
  assert.equal(snap.tradeSharpeStatus, 'READY');
  assert.equal(snap.tradeSharpeRatio, 0.64);
  assert.equal(snap.activeSharpeRatio, 0.64);
  assert.equal(snap.sharpeRating, 'GOOD');
});

test('Insufficient trades (< 2) and zero-volatility edge cases never emit NaN or Infinity', () => {
  const account = createInitialSimAccount(25000, 100);

  // Only 1 active trade -> insufficient for sample stdDev
  const oneTrade = computeSessionRiskMetrics({
    account: { ...account, equity: 25050, peakEquity: 25050 },
    confirmedPositions: [makeActivePosition('single', 50, 'ACTIVE')],
    closedTrades: [],
    equityHistory: createInitialEquityHistory(25000, 25050, 1000, 2000),
    basis: 'TRADES',
  });
  assert.equal(oneTrade.tradeSharpeStatus, 'INSUFFICIENT_TRADES');
  assert.equal(oneTrade.tradeSharpeRatio, null);
  assert.equal(oneTrade.sharpeRating, 'PENDING');

  // Two identical positive returns -> zero volatility
  const zeroVol = computeSessionRiskMetrics({
    account: { ...account, balance: 25000, equity: 25200, peakEquity: 25200 },
    confirmedPositions: [
      makeActivePosition('a1', 100, 'ACTIVE'),
      makeActivePosition('a2', 100, 'ACTIVE'),
    ],
    closedTrades: [],
    equityHistory: createInitialEquityHistory(25000, 25200, 1000, 2000),
    basis: 'TRADES',
  });
  assert.equal(zeroVol.tradeSharpeStatus, 'ZERO_VOLATILITY');
  assert.equal(zeroVol.tradeSharpeRatio, null);
});

test('MTM basis computes live Sharpe ratio directly from session equity curve transitions', () => {
  let history = createInitialEquityHistory(25000, 25000, 1000, 1000);
  history = appendSessionEquityPoint(history, 25100, 25100, 2000); // +0.40%
  history = appendSessionEquityPoint(history, 25050, 25100, 3000); // -0.1992%
  history = appendSessionEquityPoint(history, 25200, 25200, 4000); // +0.5988%
  history = appendSessionEquityPoint(history, 25320, 25320, 5000); // +0.4762%

  const account = {
    ...createInitialSimAccount(25000, 100),
    equity: 25320,
    peakEquity: 25320,
    maxDrawdownPct: 0.2,
  };

  const snap = computeSessionRiskMetrics({
    account,
    confirmedPositions: [makeActivePosition('only1', 320, 'ACTIVE')],
    closedTrades: [],
    equityHistory: history,
    basis: 'MTM',
  });

  assert.equal(snap.mtmReturnSamples, 4);
  assert.equal(snap.mtmSharpeStatus, 'READY');
  assert.ok(snap.mtmSharpeRatio !== null && snap.mtmSharpeRatio > 0.5);
  assert.equal(snap.activeSharpeRatio, snap.mtmSharpeRatio);
  assert.ok(snap.sharpeRating === 'GOOD' || snap.sharpeRating === 'EXCELLENT');
});

test('appendSessionEquityPoint caps history length while preserving session opening anchor', () => {
  let history = createInitialEquityHistory(25000, 25000, 1000, 1000);
  for (let i = 1; i <= 40; i++) {
    history = appendSessionEquityPoint(history, 25000 + i * 5, 25000 + i * 5, 1000 + i * 1000, 20);
  }
  assert.equal(history.length, 20);
  assert.equal(history[0].equity, 25000);
  assert.equal(history[history.length - 1].equity, 25200);
});

test('buildTradePerformanceSeries maps equity, drawdown, and rolling Sharpe across the last 20 trades', async () => {
  const { buildTradePerformanceSeries } = await import('./sessionRisk');
  const { generateSeedClosedTrades } = await import('./tradeSimulator');

  // Empty state returns clean zeroed baseline
  const empty = buildTradePerformanceSeries({
    initialBalance: 25000,
    closedTrades: [],
    confirmedPositions: [],
  });
  assert.equal(empty.points.length, 0);
  assert.equal(empty.baselineEquity, 25000);
  assert.equal(empty.latestSharpe, null);

  // 19 seeded closed trades + 1 active live trade + 1 ignored pending limit = exactly 20 entries
  const seeded = generateSeedClosedTrades(2742.6, 25000, 1763590000000);
  assert.equal(seeded.closedTrades.length, 19);

  const series = buildTradePerformanceSeries({
    initialBalance: 25000,
    closedTrades: seeded.closedTrades,
    confirmedPositions: [
      makeActivePosition('live-20', 84.5, 'ACTIVE'),
      makeActivePosition('pending-ignored', -500, 'PENDING_LIMIT'),
    ],
  });

  assert.equal(series.points.length, 20);
  assert.equal(series.totalTradesRecorded, 20);
  assert.equal(series.baselineEquity, 25000);
  assert.equal(series.points[0].slotIndex, 1);
  assert.equal(series.points[0].globalIndex, 1);
  assert.equal(series.points[0].rollingSharpe, null); // n=1 cannot compute sample stdDev
  assert.equal(series.points[19].slotIndex, 20);
  assert.equal(series.points[19].isLive, true);
  assert.ok(series.points[19].rollingSharpe !== null && Number.isFinite(series.points[19].rollingSharpe));
  assert.ok(series.maxDrawdownPct > 0.5, 'seeded history exhibits visible drawdown pocket');
  assert.ok(series.windowNetPnl > 0, 'seeded history finishes net profitable after recovery');
});

test('buildTradePerformanceSeries slides window cleanly when total simulation trades exceed 20', async () => {
  const { buildTradePerformanceSeries } = await import('./sessionRisk');
  // 26 closed trades: first 6 earn +$100 each (so baselineEquity for last 20 = $25,600)
  // Next 20 alternate +$200 and -$100 -> 10 wins (+$2000), 10 losses (-$1000), net +$1000 -> final $26,600
  const closed: ClosedTradeRecord[] = [];
  for (let i = 1; i <= 26; i++) {
    const pnl = i <= 6 ? 100 : i % 2 === 1 ? 200 : -100;
    closed.push(makeClosedTrade(`t${i}`, pnl, i * 1000));
  }

  // Pass newest-first like store does
  const series = buildTradePerformanceSeries({
    initialBalance: 25000,
    closedTrades: closed.slice().reverse(),
    confirmedPositions: [],
    maxEntries: 20,
  });

  assert.equal(series.totalTradesRecorded, 26);
  assert.equal(series.points.length, 20);
  assert.equal(series.baselineEquity, 25600);
  assert.equal(series.points[0].globalIndex, 7);
  assert.equal(series.points[0].slotIndex, 1);
  assert.equal(series.points[19].globalIndex, 26);
  assert.equal(series.points[19].slotIndex, 20);
  assert.equal(series.points[19].equity, 26600);
  assert.equal(series.windowNetPnl, 1000);
  assert.equal(series.winRatePct, 50);
  assert.ok(series.latestSharpe !== null && series.latestSharpe > 0);
});

