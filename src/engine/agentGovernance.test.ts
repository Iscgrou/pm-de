import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_CONFIG,
  computeLossStreak,
  evaluateRiskCircuitBreakers,
  sanitizeAgentConfig,
} from './agentGovernance.ts';
import { createInitialSimAccount } from './tradeSimulator.ts';
import type { ClosedTradeRecord, ConfirmedPosition, NewsGateStatus } from './types.ts';

const CLEAR_NEWS: NewsGateStatus = {
  state: 'CLEAR',
  lotMultiplier: 1,
  vetoNewEntries: false,
  cancelPendingLimits: false,
  activeEvent: null,
  minutesToEvent: 90,
};

function makeClosed(id: string, netPnl: number, closedAtMs: number): ClosedTradeRecord {
  return {
    id,
    orderId: `ORD-${id}`,
    proposalId: `prop-${id}`,
    setupType: 'OB+FVG',
    direction: 'LONG',
    timeframe: 'M15',
    lotSize: 0.2,
    entryPrice: 2740,
    exitPrice: netPnl >= 0 ? 2750 : 2734,
    openedAtMs: closedAtMs - 600_000,
    closedAtMs,
    exitReason: netPnl >= 0 ? 'TP2_TARGET' : 'STOP_LOSS',
    grossPnl: netPnl,
    commission: 1.4,
    swap: 0,
    netPnl,
    rMultiple: netPnl >= 0 ? 2.0 : -1.0,
    mfeUsd: Math.max(0, netPnl),
    maeUsd: Math.min(0, netPnl),
    slippageUsd: 0.03,
  };
}

test('sanitizeAgentConfig clamps out-of-range inputs cleanly', () => {
  const cfg = sanitizeAgentConfig({
    minConfluenceScore: 999,
    minRrRatio: 0.5,
    maxDailyDrawdownPct: 50,
    maxConcurrentPositions: 0,
    allowCounterH4Scalps: true,
  });
  assert.equal(cfg.minConfluenceScore, 85);
  assert.equal(cfg.minRrRatio, 1.5);
  assert.equal(cfg.maxDailyDrawdownPct, 10);
  assert.equal(cfg.maxConcurrentPositions, 1);
  assert.equal(cfg.allowCounterH4Scalps, true);
});

test('Kill Switch immediately hard-blocks all new entries with 0x risk multiplier', () => {
  const account = createInitialSimAccount(25000);
  const snap = evaluateRiskCircuitBreakers({
    config: { ...DEFAULT_AGENT_CONFIG, killSwitchEngaged: true },
    simAccount: account,
    confirmedPositions: [],
    closedTrades: [],
    spread: 0.24,
    newsGate: CLEAR_NEWS,
  });
  assert.equal(snap.canOpenNewTrades, false);
  assert.equal(snap.effectiveRiskMultiplier, 0);
  assert.ok(snap.activeBreakers.some((b) => b.includes('Kill Switch')));
});

test('Daily Drawdown Cap hard-halts trading when equity drop >= configured cap', () => {
  const account = createInitialSimAccount(25000);
  account.peakEquity = 25000;
  account.equity = 24150; // 3.4% drawdown > 3.0% default cap

  const snap = evaluateRiskCircuitBreakers({
    config: DEFAULT_AGENT_CONFIG,
    simAccount: account,
    confirmedPositions: [],
    closedTrades: [],
    spread: 0.24,
    newsGate: CLEAR_NEWS,
  });
  assert.equal(snap.canOpenNewTrades, false);
  assert.ok(snap.dailyDrawdownPct >= 3.0);
  assert.ok(snap.activeBreakers.some((b) => b.includes('Daily Drawdown')));
});

test('Consecutive Loss Streak triggers 50% throttle at 2 losses and hard cooldown lockout at 3 losses', () => {
  const now = Date.now();
  const account = createInitialSimAccount(25000);

  const twoLosses = [makeClosed('1', -120, now - 300_000), makeClosed('2', -110, now - 120_000)];
  assert.equal(computeLossStreak(twoLosses).consecutiveLosses, 2);

  const warnSnap = evaluateRiskCircuitBreakers({
    config: DEFAULT_AGENT_CONFIG,
    simAccount: account,
    confirmedPositions: [],
    closedTrades: twoLosses,
    spread: 0.24,
    newsGate: CLEAR_NEWS,
    nowMs: now,
  });
  assert.equal(warnSnap.canOpenNewTrades, true);
  assert.equal(warnSnap.effectiveRiskMultiplier, 0.5);

  const threeLosses = [...twoLosses, makeClosed('3', -130, now - 60_000)];
  const tripSnap = evaluateRiskCircuitBreakers({
    config: DEFAULT_AGENT_CONFIG,
    simAccount: account,
    confirmedPositions: [],
    closedTrades: threeLosses,
    spread: 0.24,
    newsGate: CLEAR_NEWS,
    nowMs: now,
  });
  assert.equal(tripSnap.canOpenNewTrades, false);
  assert.ok(tripSnap.cooldownRemainingMin > 0);
});

test('Portfolio Heat Cap and Spread Anomaly Guard enforce hard execution blocks', () => {
  const account = createInitialSimAccount(25000);
  const riskyPos = {
    id: 'p1',
    stage: 'OPEN',
    riskUsd: 700, // 2.8% of $25k > 2.5% cap
    entry: 2740,
    stopLoss: 2733,
    lotSize: 1.0,
  } as ConfirmedPosition;

  const heatSnap = evaluateRiskCircuitBreakers({
    config: DEFAULT_AGENT_CONFIG,
    simAccount: account,
    confirmedPositions: [riskyPos],
    closedTrades: [],
    spread: 1.65, // > $1.20 cap
    newsGate: CLEAR_NEWS,
  });

  assert.equal(heatSnap.canOpenNewTrades, false);
  assert.ok(heatSnap.activeBreakers.some((b) => b.includes('Portfolio Risk Heat')));
  assert.ok(heatSnap.activeBreakers.some((b) => b.includes('Spread Anomaly')));
});
