import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeQuantSnapshot,
  evaluateBasisDivergence,
  evaluateNewsGate,
  generateQuantProposal,
  generateSeedSeries,
} from './smcQuant';
import {
  calculateExecutionFill,
  calculateRequiredMargin,
  calculateRiskBasedLotSize,
  computeAccountMetrics,
  createInitialSimAccount,
  executePartialClose,
  modifyPositionLevels,
  simulateOpenTrade,
  stepSimulatedPositions,
} from './tradeSimulator';
import type { Candle, Tick, Timeframe } from './types';

function makeContext(spot = 2742.6) {
  const byTf: Record<Timeframe, Candle[]> = {
    M1: generateSeedSeries('M1', 100, spot, 1763590000),
    M5: generateSeedSeries('M5', 100, spot, 1763590000),
    M15: generateSeedSeries('M15', 100, spot, 1763590000),
    M30: generateSeedSeries('M30', 100, spot, 1763590000),
    H1: generateSeedSeries('H1', 100, spot, 1763590000),
    H4: generateSeedSeries('H4', 100, spot, 1763590000),
  };
  const quant = analyzeQuantSnapshot('M15', byTf);
  const newsGate = evaluateNewsGate([]);
  const basis = evaluateBasisDivergence(spot, spot - 1.2);
  const tick: Tick = {
    symbol: 'XAUUSD',
    last: spot,
    bid: Number((spot - 0.12).toFixed(2)),
    ask: Number((spot + 0.12).toFixed(2)),
    spread: 0.24,
    timestampMs: 1763590000000,
    tier: 1,
    source: 'Swissquote Interbank BBO',
    seq: 1,
  };
  return { quant, newsGate, basis, tick };
}

test('XAUUSD 100oz margin calculation and risk-based lot sizing are exact', () => {
  // 0.20 lot @ $2740 at 1:100 leverage => notional = $54,800 => margin = $548.00
  assert.equal(calculateRequiredMargin(2740, 0.2, 100), 548);
  // $25,000 equity * 1% risk = $250; $5.00 stop = $500/lot => 0.50 lot
  assert.equal(calculateRiskBasedLotSize(25000, 1.0, 2740, 2735), 0.5);
});

test('Market execution fills at Ask+slippage for LONG and rejects insufficient margin', () => {
  const { quant, newsGate, basis, tick } = makeContext(2742.6);
  const account = createInitialSimAccount(25000, 100);
  const proposal = generateQuantProposal(tick.last, 'M15', quant, newsGate, basis, 0)!;
  assert.ok(proposal);

  const fill = calculateExecutionFill('LONG', tick, 'MARKET', proposal.entry, 0.25, quant.regime.atr);
  assert.ok(fill.fillPrice > tick.ask);
  assert.ok(fill.slippageUsd > 0);

  const res = simulateOpenTrade({
    proposal: { ...proposal, direction: 'LONG', entry: 2742.6, stopLoss: 2736.6, tp1: 2754.6, tp2: 2766.6 },
    lotSize: 0.25,
    executionType: 'MARKET',
    tick,
    quant,
    newsGate,
    basis,
    account,
    existingPositions: [],
    nowMs: 1763590001000,
  });

  assert.equal(res.ok, true);
  assert.ok(res.position);
  assert.equal(res.position.status, 'ACTIVE');
  assert.ok(res.position.marginUsed > 0);
  assert.ok(res.account.balance < 25000, 'opening commission deducted from balance');
  assert.ok(res.account.freeMargin < res.account.equity);

  // Huge lot exceeding $25k free margin must be rejected
  const over = simulateOpenTrade({
    proposal: { ...proposal, direction: 'LONG', entry: 2742.6, stopLoss: 2736.6, tp1: 2754.6, tp2: 2766.6 },
    lotSize: 15,
    executionType: 'MARKET',
    tick,
    quant,
    newsGate,
    basis,
    account,
    existingPositions: [],
  });
  assert.equal(over.ok, false);
  assert.match(over.errors[0], /مارجین آزاد کافی نیست/);
});

test('Full live trade lifecycle: Market fill -> TP1 50% partial + Risk-Free BE -> Trailing SL -> TP2 close', () => {
  const { quant, newsGate, basis, tick } = makeContext(2740.0);
  const account = createInitialSimAccount(25000, 100);
  const proposal = generateQuantProposal(tick.last, 'M15', quant, newsGate, basis, 0)!;

  const opened = simulateOpenTrade({
    proposal: { ...proposal, direction: 'LONG', entry: 2740, stopLoss: 2734, tp1: 2752, tp2: 2764 },
    lotSize: 0.4,
    executionType: 'MARKET',
    trailingStopDistance: 4.0,
    tick,
    quant,
    newsGate,
    basis,
    account,
    existingPositions: [],
    nowMs: 1763590001000,
  });
  assert.equal(opened.ok, true);
  const pos = opened.position!;

  // Step 1: Price reaches TP1 -> auto 50% partial booked + Risk-Free BE SL locked
  const tp1Tick: Tick = { ...tick, last: pos.tp1 + 0.3, bid: pos.tp1 + 0.2, ask: pos.tp1 + 0.44 };
  const s1 = stepSimulatedPositions([pos], opened.account, tp1Tick, quant, newsGate, basis, 1763590010000);
  assert.equal(s1.positions.length, 1);
  assert.equal(s1.newClosedTrades.length, 1);
  assert.equal(s1.newClosedTrades[0].exitReason, 'TP1_PARTIAL');
  assert.equal(s1.positions[0].lotSize, 0.2);
  assert.equal(s1.positions[0].stage, 'RISK_FREE_TP1');
  assert.ok(s1.positions[0].stopLoss > pos.entry, 'SL moved risk-free above entry');
  assert.ok(s1.account.balance > 25000, 'TP1 partial profit credited to balance');

  // Step 2: Price moves higher -> trailing SL ratchets up monotonically
  const midRunnerTick: Tick = { ...tick, last: pos.tp1 + 6.0, bid: pos.tp1 + 5.88, ask: pos.tp1 + 6.12 };
  const s2 = stepSimulatedPositions(s1.positions, s1.account, midRunnerTick, quant, newsGate, basis, 1763590020000);
  assert.ok(s2.positions[0].stopLoss > s1.positions[0].stopLoss, 'trailing SL ratcheted upward');

  // Step 3: Price hits TP2 -> remaining 0.20 lot closes cleanly, margin releases to 0
  const tp2Tick: Tick = { ...tick, last: pos.tp2 + 0.3, bid: pos.tp2 + 0.2, ask: pos.tp2 + 0.44 };
  const s3 = stepSimulatedPositions(s2.positions, s2.account, tp2Tick, quant, newsGate, basis, 1763590030000);
  assert.equal(s3.positions.length, 0);
  assert.equal(s3.newClosedTrades.length, 1);
  assert.equal(s3.newClosedTrades[0].exitReason, 'TP2_TARGET');
  assert.equal(s3.account.usedMargin, 0);
  assert.equal(s3.account.winCount, 2);

  const metrics = computeAccountMetrics(s3.account, [...s1.newClosedTrades, ...s3.newClosedTrades]);
  assert.equal(metrics.winRatePct, 100);
  assert.ok(metrics.returnPct > 0);
});

test('Pending LIMIT order activates on price touch, manual 50% partial close books P&L, and SL hit closes cleanly', () => {
  const { quant, newsGate, basis, tick } = makeContext(2745.0);
  const account = createInitialSimAccount(25000, 100);
  const proposal = generateQuantProposal(tick.last, 'M15', quant, newsGate, basis, 0)!;

  // Resting LONG limit below current spot ($2740 vs $2745)
  const opened = simulateOpenTrade({
    proposal: { ...proposal, direction: 'LONG', entry: 2740, stopLoss: 2734, tp1: 2752, tp2: 2764 },
    lotSize: 0.2,
    executionType: 'LIMIT',
    tick,
    quant,
    newsGate,
    basis,
    account,
    existingPositions: [],
    nowMs: 1763590001000,
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.position!.status, 'PENDING_LIMIT');
  assert.equal(opened.account.usedMargin, 0);

  // Price drops to touch limit entry -> activates order
  const fillTick: Tick = { ...tick, last: 2739.9, bid: 2739.78, ask: 2740.0 };
  const filled = stepSimulatedPositions([opened.position!], opened.account, fillTick, quant, newsGate, basis, 1763590010000);
  assert.equal(filled.positions[0].status, 'ACTIVE');
  assert.ok(filled.account.usedMargin > 0);

  // Manual modify SL/TP works and rejects invalid SL above current price for LONG
  const badMod = modifyPositionLevels(filled.positions[0], { stopLoss: 2745 }, 2740);
  assert.equal(badMod.ok, false);
  const goodMod = modifyPositionLevels(filled.positions[0], { stopLoss: 2735.5 }, 2740);
  assert.equal(goodMod.ok, true);
  assert.equal(goodMod.position.stopLoss, 2735.5);

  // Manual 50% scale-out in profit
  const profitTick: Tick = { ...tick, last: 2746.0, bid: 2745.88, ask: 2746.12 };
  const partial = executePartialClose(goodMod.position, 0.5, profitTick, filled.account, 1763590020000);
  assert.ok(partial.remainingPosition);
  assert.equal(partial.remainingPosition!.lotSize, 0.1);
  assert.ok(partial.closedRecord!.netPnl > 0);

  // Remaining half stopped out at SL
  const slTick: Tick = { ...tick, last: 2735.4, bid: 2735.3, ask: 2735.54 };
  const stopped = stepSimulatedPositions([partial.remainingPosition!], partial.account, slTick, quant, newsGate, basis, 1763590030000);
  assert.equal(stopped.positions.length, 0);
  assert.equal(stopped.newClosedTrades[0].exitReason, 'STOP_LOSS');
  assert.ok(stopped.newClosedTrades[0].netPnl < 0);
  assert.equal(stopped.account.usedMargin, 0);
});
