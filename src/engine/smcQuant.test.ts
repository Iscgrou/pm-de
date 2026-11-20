import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeQuantSnapshot,
  buildSystem2Advisory,
  evaluateBasisDivergence,
  evaluateConfirmedPositionAdvice,
  evaluateNewsGate,
  generateQuantProposal,
  generateSeedSeries,
  inspectSymbolTripwire,
  run18GateAudit,
  stepHsmPosition,
  validateToxicSpike,
  validateTradeGuardrails,
  verifyAntiHallucination,
} from './smcQuant';
import { normalizeCandle, normalizeNews, normalizeTick } from './normalizers';
import type { Candle, ConfirmedPosition, Position, Timeframe } from './types';

function buildAllTf(): Record<Timeframe, Candle[]> {
  return {
    M1: generateSeedSeries('M1', 100, 2742.6, 1763590000),
    M5: generateSeedSeries('M5', 100, 2742.6, 1763590000),
    M15: generateSeedSeries('M15', 100, 2742.6, 1763590000),
    M30: generateSeedSeries('M30', 100, 2742.6, 1763590000),
    H1: generateSeedSeries('H1', 100, 2742.6, 1763590000),
    H4: generateSeedSeries('H4', 100, 2742.6, 1763590000),
  };
}

test('strict mathematical guardrails enforce geometry, R:R >= 1.50, and 0.25*ATR stop', () => {
  const validLong = validateTradeGuardrails('LONG', 2740, 2734, 2750, 2762, 4.0);
  assert.equal(validLong.valid, true);
  assert.ok(validLong.rrRatio >= 1.5);

  const invertedLong = validateTradeGuardrails('LONG', 2740, 2745, 2750, 2760, 4.0);
  assert.equal(invertedLong.valid, false);

  const lowRr = validateTradeGuardrails('LONG', 2740, 2730, 2752, 2770, 4.0);
  assert.equal(lowRr.valid, false);

  const tightStop = validateTradeGuardrails('LONG', 2740, 2739.5, 2742, 2745, 4.0);
  assert.equal(tightStop.valid, false);

  const validShort = validateTradeGuardrails('SHORT', 2740, 2746, 2730, 2720, 4.0);
  assert.equal(validShort.valid, true);
});

test('HSM transitions OPEN -> BREAK_EVEN_ARMED -> RISK_FREE_TP1 (Entry+Spread) -> CLOSED_TP2', () => {
  const pos: Position = {
    id: 'test-1',
    direction: 'LONG',
    entry: 2740,
    initialSl: 2734,
    stopLoss: 2734,
    tp1: 2752,
    tp2: 2764,
    lotSize: 0.2,
    spread: 0.24,
    stage: 'OPEN',
    rrRatio: 2.0,
    unrealizedPnl: 0,
    realizedPartial: false,
    openedAtMs: 1763590000000,
    history: [],
  };

  const r1 = stepHsmPosition(pos, 2746.2);
  assert.equal(r1.event, 'BREAK_EVEN_ARMED');
  assert.equal(r1.position.stage, 'BREAK_EVEN_ARMED');

  const r2 = stepHsmPosition(r1.position, 2752.1);
  assert.equal(r2.event, 'RISK_FREE_TP1');
  assert.equal(r2.position.stopLoss, 2740.24);
  assert.equal(r2.position.realizedPartial, true);

  const r3 = stepHsmPosition(r2.position, 2764.5);
  assert.equal(r3.event, 'CLOSED_TP2');
});

test('2-tier USD news assistant triggers LOCKOUT on High Impact and CAUTION on Medium Impact', () => {
  const now = 1763590000000;
  const lockout = evaluateNewsGate(
    [{ id: '1', title: 'US CPI', currency: 'USD', impact: 'HIGH', scheduledAtMs: now + 600000, forecast: '0.3%', previous: '0.3%' }],
    now
  );
  assert.equal(lockout.state, 'LOCKOUT');
  assert.equal(lockout.vetoNewEntries, true);
  assert.equal(lockout.cancelPendingLimits, true);

  const caution = evaluateNewsGate(
    [{ id: '2', title: 'Jobless Claims', currency: 'USD', impact: 'MEDIUM', scheduledAtMs: now + 180000, forecast: '215K', previous: '218K' }],
    now
  );
  assert.equal(caution.state, 'CAUTION');
  assert.equal(caution.lotMultiplier, 0.5);
});

test('SymbolTripwire, ToxicSpikeFilter, Anti-Hallucination & Normalizers protect pipeline', () => {
  const blocked = inspectSymbolTripwire('NASDAQ:NVDA');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.failoverTriggered, true);

  const allowed = inspectSymbolTripwire('OANDA:XAUUSD');
  assert.equal(allowed.allowed, true);

  const spike = validateToxicSpike(2900, 2899.8, 2900.2, 2742.5);
  assert.equal(spike.accepted, false);

  const hall = verifyAntiHallucination('Entry 2740.00 invalid 2899.50', [2740.0]);
  assert.equal(hall.passed, false);
  assert.deepEqual(hall.ungrounded, [2899.5]);

  const safeTick = normalizeTick({ last: Number.NaN });
  assert.equal(safeTick.symbol, 'XAUUSD');
  assert.ok(safeTick.last > 0);
  assert.ok(normalizeCandle({}).high >= normalizeCandle({}).low);
  assert.equal(normalizeNews({}).currency, 'USD');
});

test('All 18 institutional verification gates pass deterministically and System 2 advisory passes anti-hallucination', () => {
  const byTf = buildAllTf();
  const gates = run18GateAudit(byTf);
  assert.equal(gates.length, 18);
  const failed = gates.filter((g) => !g.passed);
  assert.equal(failed.length, 0, `Failed gates: ${failed.map((f) => f.name).join(', ')}`);

  const quant = analyzeQuantSnapshot('M15', byTf);
  const gate = evaluateNewsGate([]);
  const adv = buildSystem2Advisory('TEST_CHECK', 2742.6, 0.24, quant, gate, null);
  assert.equal(adv.hallucinationChecked, true);
});

test('BasisDivergence guard flags PAXG crypto inducement and Agentic proposal/monitor enforces guardrails', () => {
  const aligned = evaluateBasisDivergence(2742.6, 2741.8);
  assert.equal(aligned.status, 'ALIGNED');

  const inducement = evaluateBasisDivergence(2742.6, 2753.0);
  assert.equal(inducement.status, 'CRYPTO_INDUCEMENT');
  assert.equal(inducement.cryptoInducementWarning, true);

  const byTf = buildAllTf();
  const quant = analyzeQuantSnapshot('M15', byTf);
  const clearGate = evaluateNewsGate([]);
  const prop = generateQuantProposal(2742.6, 'M15', quant, clearGate, aligned, 0);
  assert.ok(prop !== null);
  assert.ok(prop.rrRatio >= 1.5);

  const confirmed: ConfirmedPosition = {
    id: 'brk-1',
    orderId: 'ORD-TEST01',
    proposalId: prop.id,
    setupType: prop.setupType,
    timeframe: 'M15',
    executionType: 'MARKET',
    status: 'ACTIVE',
    direction: 'LONG',
    requestedEntry: 2740,
    entry: 2740,
    fillPrice: 2740,
    slippageUsd: 0.03,
    initialSl: 2734,
    stopLoss: 2734,
    tp1: 2752,
    tp2: 2764,
    initialLotSize: 0.2,
    lotSize: 0.2,
    spread: 0.24,
    stage: 'OPEN',
    rrRatio: 2.0,
    unrealizedPnl: 0,
    grossPnl: 0,
    netPnl: 0,
    realizedPnl: 0,
    commissionPaid: 0.7,
    swapAccrued: 0,
    marginUsed: 548,
    riskUsd: 120,
    mfeUsd: 0,
    maeUsd: 0,
    trailingStopDistance: null,
    executionLog: [],
    realizedPartial: false,
    openedAtMs: Date.now(),
    history: [],
    rMultiple: 0,
    urgency: 'NORMAL',
    actionTag: 'HOLD_RUNNER',
    adviceEn: '',
    adviceFa: '',
    lastReviewedMs: Date.now(),
  };

  const reviewed = evaluateConfirmedPositionAdvice(confirmed, 2752.5, quant, clearGate, aligned);
  assert.equal(reviewed.stage, 'RISK_FREE_TP1');
  assert.equal(reviewed.actionTag, 'MOVE_SL_RF');
  assert.equal(reviewed.stopLoss, 2740.24);
  assert.ok(reviewed.rMultiple >= 2.0);
});

test('SMC indicators enforce strict left-to-right chronology (swingTime < breakTime, mitigatedTime >= startTime)', () => {
  const byTf = buildAllTf();
  const quant = analyzeQuantSnapshot('M15', byTf);

  assert.ok(quant.orderBlocks.length > 0, 'Expected Order Blocks to be detected');
  assert.ok(quant.fvgs.length > 0, 'Expected FVGs to be detected');
  assert.ok(quant.structures.length > 0, 'Expected BOS/CHoCH structures to be detected');

  for (const ob of quant.orderBlocks) {
    if (ob.mitigated) {
      assert.ok(
        typeof ob.mitigatedTime === 'number' && ob.mitigatedTime > ob.startTime,
        `Mitigated OB ${ob.id} must have mitigatedTime (${ob.mitigatedTime}) > startTime (${ob.startTime})`
      );
    } else {
      assert.equal(ob.mitigatedTime, undefined);
    }
  }

  for (const fvg of quant.fvgs) {
    if (fvg.mitigated) {
      assert.ok(
        typeof fvg.mitigatedTime === 'number' && fvg.mitigatedTime > fvg.startTime,
        `Mitigated FVG ${fvg.id} must have mitigatedTime (${fvg.mitigatedTime}) > startTime (${fvg.startTime})`
      );
    } else {
      assert.equal(fvg.mitigatedTime, undefined);
    }
  }

  for (const st of quant.structures) {
    assert.ok(
      st.swingTime < st.time,
      `Structure ${st.kind} ${st.id} must strictly flow left-to-right (swingTime ${st.swingTime} < breakTime ${st.time})`
    );
  }
});

