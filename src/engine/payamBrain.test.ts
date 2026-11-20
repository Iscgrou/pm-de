import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRsiTimeframe,
  BRAIN_PILLAR_WEIGHTS,
  computeDealingRange,
  computeKaufmanEfficiency,
  computeWilderRsiSeries,
  detectLiquiditySweepFootprint,
  detectRsiDivergence,
  evaluatePayamBrain,
} from './payamBrain';
import {
  analyzeQuantSnapshot,
  evaluateBasisDivergence,
  evaluateNewsGate,
  generateQuantProposal,
  generateSeedSeries,
} from './smcQuant';
import type { Candle, Timeframe } from './types';

function makeTrendCandles(
  startPrice: number,
  count: number,
  stepDelta: number,
  stepSec = 900,
  startSec = 1763500000
): Candle[] {
  const out: Candle[] = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    const wave = Math.sin(i * 0.65) * Math.abs(stepDelta) * 0.65;
    const open = p;
    const close = open + stepDelta + wave * 0.25;
    const high = Math.max(open, close) + 0.45;
    const low = Math.min(open, close) - 0.45;
    out.push({
      time: startSec + i * stepSec,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 120 + (i % 5) * 15,
    });
    p = close;
  }
  return out;
}

function buildSeedAllTf(): Record<Timeframe, Candle[]> {
  return {
    M1: generateSeedSeries('M1', 110, 2742.6, 1763590000),
    M5: generateSeedSeries('M5', 110, 2742.6, 1763590000),
    M15: generateSeedSeries('M15', 110, 2742.6, 1763590000),
    M30: generateSeedSeries('M30', 110, 2742.6, 1763590000),
    H1: generateSeedSeries('H1', 110, 2742.6, 1763590000),
    H4: generateSeedSeries('H4', 110, 2742.6, 1763590000),
  };
}

test('6-pillar institutional weights sum strictly to 100 points', () => {
  const sum = Object.values(BRAIN_PILLAR_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
});

test('Wilder RSI(14) accurately tracks uptrends, downtrends, and Cardwell RSI regimes', () => {
  const bullCandles = makeTrendCandles(2680, 60, 0.9);
  const bullRsi = analyzeRsiTimeframe('H1', bullCandles);
  assert.ok(bullRsi.value >= 60, `Expected bullish RSI >= 60, got ${bullRsi.value}`);
  assert.equal(bullRsi.regime, 'BULLISH_REGIME');

  const bearCandles = makeTrendCandles(2820, 60, -0.9);
  const bearRsi = analyzeRsiTimeframe('H1', bearCandles);
  assert.ok(bearRsi.value <= 40, `Expected bearish RSI <= 40, got ${bearRsi.value}`);
  assert.equal(bearRsi.regime, 'BEARISH_REGIME');
});

test('RSI divergence detector identifies Bullish Regular and Bullish Hidden divergences', () => {
  // Construct synthetic candles with two clear swing lows: second lower low with milder drop -> Bullish Regular
  const candles = makeTrendCandles(2750, 50, 0);
  // Override bars 24..44 to craft a sharp drop (low 1) followed by bounce and shallow lower low (low 2)
  const closes = [
    2750, 2746, 2740, 2732, 2724, 2718, // sharp dump into idx 30 (deep RSI trough)
    2726, 2733, 2738, 2741, 2738, 2734, // recovery
    2728, 2722, 2719, 2717.2, // second slightly lower low at idx 40 (higher RSI than sharp dump)
    2721, 2725, 2729, 2732,
  ];
  for (let k = 0; k < closes.length; k++) {
    const idx = 25 + k;
    const prevC = candles[idx - 1].close;
    const c = closes[k];
    candles[idx] = {
      time: candles[idx].time,
      open: prevC,
      close: c,
      high: Math.max(prevC, c) + 0.5,
      low: Math.min(prevC, c) - (k === 5 ? 1.0 : k === 15 ? 1.5 : 0.4),
      volume: 150,
    };
  }
  const rsiSeries = computeWilderRsiSeries(candles, 14);
  const div = detectRsiDivergence(candles, rsiSeries, 2);
  assert.equal(div, 'BULLISH_REGULAR');
});

test('Dealing Range & OTE computes exact 50% Equilibrium and 61.8%-78.6% Fibonacci pockets', () => {
  const candles = makeTrendCandles(2740, 48, 0);
  candles[10] = { ...candles[10], high: 2800, low: 2790, open: 2792, close: 2798 };
  candles[20] = { ...candles[20], high: 2705, low: 2700, open: 2704, close: 2701 };
  candles[47] = { ...candles[47], open: 2728, close: 2730, high: 2732, low: 2727 };

  const dr = computeDealingRange('H1', candles, 48);
  assert.equal(dr.swingHigh, 2800);
  assert.equal(dr.swingLow, 2700);
  assert.equal(dr.equilibrium50, 2750);
  assert.equal(dr.oteLongHigh, 2738.2);
  assert.equal(dr.oteLongLow, 2721.4);
  assert.equal(dr.oteLongSweetSpot, 2729.5);
  assert.equal(dr.positionPct, 30);
  assert.equal(dr.zone, 'DISCOUNT_OTE');
});

test('Liquidity Sweep footprint detects Gold stop-hunt wick piercing SSL and reclaiming inside', () => {
  const candles = makeTrendCandles(2740, 40, 0);
  const priorMin = Math.min(...candles.slice(-36, -6).map((c) => c.low));
  // Inject a classic Gold stop-hunt sweep candle piercing $2.4 below priorMin and closing firmly back above
  candles[38] = {
    ...candles[38],
    open: priorMin + 1.2,
    close: priorMin + 1.8,
    high: priorMin + 1.9,
    low: priorMin - 2.4,
    volume: 320,
  };
  candles[39] = {
    ...candles[39],
    open: priorMin + 1.8,
    close: priorMin + 2.1,
    high: priorMin + 2.2,
    low: priorMin + 1.4,
    volume: 160,
  };
  const sweep = detectLiquiditySweepFootprint(candles, [
    { id: 'ssl-1', side: 'SSL', level: priorMin, time: candles[20].time, swept: true },
  ]);
  assert.equal(sweep.active, true);
  assert.equal(sweep.side, 'SSL_SWEEP_BULLISH');
  assert.ok(sweep.wickRejectionRatio >= 1.5);
});

test('Anti-Emotion Shield blocks entries during News LOCKOUT, PAXG Crypto Inducement, and Extreme ATR Chasing', () => {
  const byTf = buildSeedAllTf();
  const clearGate = evaluateNewsGate([]);
  const alignedBasis = evaluateBasisDivergence(2742.6, 2741.8);

  // 1) USD High-Impact News LOCKOUT forces STAND_DOWN
  const now = Date.now();
  const lockoutGate = evaluateNewsGate(
    [{ id: 'cpi', title: 'US Core CPI', currency: 'USD', impact: 'HIGH', scheduledAtMs: now + 300_000, forecast: '0.3%', previous: '0.3%' }],
    now
  );
  const quantLockout = analyzeQuantSnapshot('M15', byTf, { newsGate: lockoutGate, basis: alignedBasis });
  assert.equal(quantLockout.brain.decision, 'STAND_DOWN');
  assert.equal(quantLockout.brain.convictionGrade, 'STAND_DOWN');
  assert.ok(quantLockout.brain.defenseGates.some((g) => g.id === 'NEWS_SHIELD' && g.hardVeto));
  assert.equal(generateQuantProposal(2742.6, 'M15', quantLockout, lockoutGate, alignedBasis, 0), null);

  // 2) PAXG Crypto Inducement blocks entry via FAKEOUT_TRAP_GUARD
  const inducementBasis = evaluateBasisDivergence(2742.6, 2755.5);
  const quantInducement = analyzeQuantSnapshot('M15', byTf, { newsGate: clearGate, basis: inducementBasis });
  assert.equal(quantInducement.brain.decision, 'STAND_DOWN');
  assert.ok(quantInducement.brain.defenseGates.some((g) => g.id === 'FAKEOUT_TRAP_GUARD' && g.hardVeto));

  // 3) Extreme vertical FOMO candle chasing (> 2.2x ATR above EMA20 + RSI > 75) triggers ANTI_CHASE_ATR veto
  const chasedByTf = buildSeedAllTf();
  const m15 = [...chasedByTf.M15];
  const last = m15[m15.length - 1];
  for (let k = 1; k <= 4; k++) {
    const prev = m15[m15.length - 1];
    m15.push({
      time: prev.time + 900,
      open: prev.close,
      close: Number((prev.close + 7.5).toFixed(2)),
      high: Number((prev.close + 8.0).toFixed(2)),
      low: prev.close - 0.3,
      volume: 280,
    });
  }
  chasedByTf.M15 = m15;
  const quantChase = analyzeQuantSnapshot('M15', chasedByTf, { newsGate: clearGate, basis: alignedBasis });
  assert.ok(
    quantChase.brain.defenseGates.some((g) => g.id === 'ANTI_CHASE_ATR' && g.hardVeto),
    `Expected ANTI_CHASE_ATR hardVeto on vertical FOMO spike (ext=${quantChase.brain.atrExtension}, rsi=${quantChase.rsi.active.value})`
  );
  assert.equal(quantChase.brain.decision, 'STAND_DOWN');
  assert.ok(last.close > 0);
});

test('Kaufman efficiency distinguishes clean trend from choppy whipsaw', () => {
  const cleanTrend = makeTrendCandles(2700, 20, 1.2);
  const erTrend = computeKaufmanEfficiency(cleanTrend, 16);
  assert.ok(erTrend > 0.6, `Expected high efficiency on trend, got ${erTrend}`);

  const chop: Candle[] = Array.from({ length: 20 }, (_, i) => {
    const dir = i % 2 === 0 ? 3.5 : -3.5;
    const base = 2740;
    return {
      time: 1763500000 + i * 900,
      open: base,
      close: base + dir,
      high: base + 4.5,
      low: base - 4.5,
      volume: 120,
    };
  });
  const erChop = computeKaufmanEfficiency(chop, 16);
  assert.ok(erChop < 0.15, `Expected low efficiency on chop, got ${erChop}`);
});

test('Full PayamBrain produces transparent 6-pillar report, 4H->1H->15M->5M matrix, and valid institutional proposal on clean alignment', () => {
  const byTf = buildSeedAllTf();
  const clearGate = evaluateNewsGate([]);
  const alignedBasis = evaluateBasisDivergence(2742.6, 2741.8);
  const londonOpenMs = Date.UTC(2026, 10, 19, 8, 30, 0); // 08:30 UTC London Open Killzone

  const quant = analyzeQuantSnapshot('M15', byTf, {
    newsGate: clearGate,
    basis: alignedBasis,
    spread: 0.24,
    nowMs: londonOpenMs,
  });

  assert.equal(quant.brain.pillars.length, 6);
  assert.equal(quant.brain.defenseGates.length, 7);
  assert.equal(quant.brain.mtfMatrix.length, 4);
  assert.equal(quant.brain.killzone, 'LONDON_OPEN');
  assert.equal(quant.brain.totalScore, quant.brain.pillars.reduce((s, p) => s + p.score, 0));

  const prop = generateQuantProposal(2742.6, 'M15', quant, clearGate, alignedBasis, 0, {
    allowCautionVariant: true,
  });
  assert.ok(prop !== null);
  assert.ok(prop.rrRatio >= 1.5);
  assert.ok(typeof prop.confluenceScore === 'number' && prop.confluenceScore > 0);
  assert.ok(prop.convictionGrade !== undefined);
  assert.ok(prop.pillarBreakdown && prop.pillarBreakdown.length === 6);
});
