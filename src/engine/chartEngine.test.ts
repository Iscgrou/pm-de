import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHART_SETTINGS,
  alignMultiTimeframeClose,
  calibrateCandlesToSpot,
  computePreviousDayLevels,
  computeRulerMetrics,
  computeSessionVwap,
  computeZoneSpanX,
  formatAxisTimestamp,
  formatCandleCountdown,
  getKillzoneForTimestamp,
  resolveLabelCollisions,
  sanitizeChartSettings,
  toHeikinAshiCandles,
} from './chartEngine';
import type { Candle, Timeframe } from './types';

function makeSeries(startSec: number, stepSec: number, count: number, base = 3500): Candle[] {
  const out: Candle[] = [];
  let p = base;
  for (let i = 0; i < count; i++) {
    const open = p;
    const close = open + (i % 3 === 0 ? 2.5 : -1.1);
    const high = Math.max(open, close) + 1.2;
    const low = Math.min(open, close) - 1.0;
    out.push({
      time: startSec + i * stepSec,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 100 + i * 5,
    });
    p = close;
  }
  return out;
}

test('computeZoneSpanX prevents future zone look-ahead teleportation when panned left', () => {
  const firstVisibleTime = 1_700_000_000;
  const lastVisibleTime = 1_700_003_600;
  const timeToX = (t: number) => 14 + ((t - firstVisibleTime) / (lastVisibleTime - firstVisibleTime)) * 800;

  // Future OB formed AFTER visible window -> MUST return null (never clamp to padLeft!)
  const futureSpan = computeZoneSpanX({
    startTime: lastVisibleTime + 900,
    mitigated: false,
    firstVisibleTime,
    lastVisibleTime,
    timeToX,
    padLeft: 14,
    plotRight: 814,
    showMitigated: true,
  });
  assert.equal(futureSpan, null);

  // Mitigated OB stops cleanly at mitigatedTime instead of stretching to plotRight
  const mitSpan = computeZoneSpanX({
    startTime: firstVisibleTime + 900,
    mitigated: true,
    mitigatedTime: firstVisibleTime + 2700,
    firstVisibleTime,
    lastVisibleTime,
    timeToX,
    padLeft: 14,
    plotRight: 814,
    showMitigated: true,
  });
  assert.ok(mitSpan !== null);
  assert.equal(mitSpan.stoppedAtMitigation, true);
  assert.ok(mitSpan.x1 < 814);
  assert.ok(mitSpan.x1 > mitSpan.x0);

  // Hidden when showMitigated is false
  const hiddenMit = computeZoneSpanX({
    startTime: firstVisibleTime + 900,
    mitigated: true,
    mitigatedTime: firstVisibleTime + 2700,
    firstVisibleTime,
    lastVisibleTime,
    timeToX,
    padLeft: 14,
    plotRight: 814,
    showMitigated: false,
  });
  assert.equal(hiddenMit, null);
});

test('toHeikinAshiCandles enforces OHLC invariants and smooths bodies', () => {
  const raw = makeSeries(1_700_000_000, 900, 12);
  const ha = toHeikinAshiCandles(raw);
  assert.equal(ha.length, raw.length);
  for (const c of ha) {
    assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low <= Math.min(c.open, c.close));
  }
});

test('computeSessionVwap resets cleanly at 00:00 UTC day boundary', () => {
  const day1Start = Date.UTC(2026, 4, 10, 23, 0, 0) / 1000;
  const candles: Candle[] = [
    { time: day1Start, open: 3500, high: 3510, low: 3490, close: 3500, volume: 100 },
    { time: day1Start + 3600, open: 3600, high: 3606, low: 3594, close: 3600, volume: 50 }, // 00:00 UTC next day
  ];
  const vwap = computeSessionVwap(candles);
  assert.equal(vwap[0], 3500);
  assert.equal(vwap[1], 3600);
});

test('computePreviousDayLevels extracts PDH, PDL, and PDC from prior UTC day', () => {
  const day1 = Date.UTC(2026, 4, 10, 12, 0, 0) / 1000;
  const day2 = Date.UTC(2026, 4, 11, 2, 0, 0) / 1000;
  const candles: Candle[] = [
    { time: day1, open: 3500, high: 3542.5, low: 3488.2, close: 3520, volume: 100 },
    { time: day1 + 3600, open: 3520, high: 3530, low: 3510, close: 3525.75, volume: 100 },
    { time: day2, open: 3526, high: 3550, low: 3522, close: 3540, volume: 100 },
  ];
  const levels = computePreviousDayLevels(candles);
  assert.ok(levels !== null);
  assert.equal(levels.pdh, 3542.5);
  assert.equal(levels.pdl, 3488.2);
  assert.equal(levels.pdc, 3525.75);
  assert.equal(levels.dayUtc, '05/10');
});

test('calibrateCandlesToSpot applies clamped basis offset and preserves OHLC invariants', () => {
  const raw = makeSeries(1_700_000_000, 900, 10, 3500);
  const calibrated = calibrateCandlesToSpot(raw, 4.25, raw[raw.length - 1].close + 4.4);
  assert.equal(calibrated.length, 10);
  assert.equal(calibrated[0].open, Number((raw[0].open + 4.25).toFixed(2)));
  assert.equal(calibrated[calibrated.length - 1].close, Number((raw[raw.length - 1].close + 4.4).toFixed(2)));
  for (const c of calibrated) {
    assert.ok(c.high >= Math.max(c.open, c.close));
    assert.ok(c.low <= Math.min(c.open, c.close));
  }
});

test('alignMultiTimeframeClose synchronizes live forming close across M1..H4', () => {
  const nowSec = 1_760_000_400;
  const byTf = {
    M1: makeSeries(nowSec - 60 * 5, 60, 6, 3500),
    M5: makeSeries(nowSec - 300 * 5, 300, 6, 3500),
    M15: makeSeries(nowSec - 900 * 5, 900, 6, 3500),
    M30: makeSeries(nowSec - 1800 * 5, 1800, 6, 3500),
    H1: makeSeries(nowSec - 3600 * 5, 3600, 6, 3500),
    H4: makeSeries(nowSec - 14400 * 5, 14400, 6, 3500),
  } as Record<Timeframe, Candle[]>;

  const aligned = alignMultiTimeframeClose(byTf, 3518.45, nowSec);
  (['M1', 'M5', 'M15', 'M30', 'H1', 'H4'] as Timeframe[]).forEach((tf) => {
    const last = aligned[tf][aligned[tf].length - 1];
    assert.equal(last.close, 3518.45);
    assert.ok(last.high >= 3518.45);
    assert.ok(last.low <= 3518.45);
  });
});

test('resolveLabelCollisions separates overlapping price labels cleanly', () => {
  const map = resolveLabelCollisions(
    [
      { id: 'entry', desiredY: 200, priority: 10 },
      { id: 'ob', desiredY: 202, priority: 5 },
      { id: 'fvg', desiredY: 204, priority: 4 },
    ],
    14,
    20,
    450
  );
  const ys = Array.from(map.values()).sort((a, b) => a - b);
  assert.ok(ys[1] - ys[0] >= 14);
  assert.ok(ys[2] - ys[1] >= 14);
});

test('formatAxisTimestamp & formatCandleCountdown & killzones & ruler work deterministically', () => {
  const t1 = Date.UTC(2026, 4, 11, 8, 15, 0) / 1000;
  assert.equal(getKillzoneForTimestamp(t1), 'LONDON_OPEN');
  assert.equal(formatAxisTimestamp(t1, 'H4', null), '05/11 08:00');
  assert.equal(formatAxisTimestamp(t1, 'M15', t1 - 900), '08:15');
  assert.equal(formatCandleCountdown(Date.UTC(2026, 4, 11, 8, 10, 15), 'M15'), '04:45');
  assert.equal(formatCandleCountdown(Date.UTC(2026, 4, 11, 8, 10, 15), 'H4'), '03:49:45');

  const ruler = computeRulerMetrics(3500, 3512.5, 10, 18, 'M15');
  assert.equal(ruler.deltaUsd, 12.5);
  assert.equal(ruler.pips, 125);
  assert.equal(ruler.bars, 8);
  assert.equal(ruler.durationLabel, '2h');

  const cfg = sanitizeChartSettings({ chartStyle: 'HEIKIN_ASHI', rsiPeriod: 99, rightMarginBars: -5 });
  assert.equal(cfg.chartStyle, 'HEIKIN_ASHI');
  assert.equal(cfg.rsiPeriod, 34);
  assert.equal(cfg.rightMarginBars, 0);
  assert.equal(cfg.showVwap, DEFAULT_CHART_SETTINGS.showVwap);
});
