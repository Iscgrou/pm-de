import type { Candle, KillzoneWindow, Timeframe } from './types';
import { TIMEFRAME_SECONDS } from './smcQuant';

export type ChartStyle = 'CANDLES' | 'HOLLOW' | 'HEIKIN_ASHI' | 'LINE';

export interface ChartSettings {
  chartStyle: ChartStyle;
  showVolume: boolean;
  showEma20: boolean;
  showEma50: boolean;
  showVwap: boolean;
  showPdhPdl: boolean;
  showKillzones: boolean;
  showBidAsk: boolean;
  showCountdown: boolean;
  showMitigatedZones: boolean;
  showZoneLabels: boolean;
  showAllPositions: boolean;
  showPendingLimits: boolean;
  autoFitIncludeLevels: boolean;
  rsiPeriod: number;
  rightMarginBars: number;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  chartStyle: 'CANDLES',
  showVolume: true,
  showEma20: true,
  showEma50: true,
  showVwap: true,
  showPdhPdl: true,
  showKillzones: true,
  showBidAsk: true,
  showCountdown: true,
  showMitigatedZones: false,
  showZoneLabels: true,
  showAllPositions: true,
  showPendingLimits: true,
  autoFitIncludeLevels: false,
  rsiPeriod: 14,
  rightMarginBars: 6,
};

export const CHART_SETTINGS_STORAGE_KEY = 'payam_chart_settings_v2';

const VALID_STYLES = new Set<ChartStyle>(['CANDLES', 'HOLLOW', 'HEIKIN_ASHI', 'LINE']);

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function sanitizeChartSettings(
  partial: Partial<ChartSettings> | null | undefined,
  base: ChartSettings = DEFAULT_CHART_SETTINGS
): ChartSettings {
  if (!partial || typeof partial !== 'object') return { ...base };
  const style =
    typeof partial.chartStyle === 'string' && VALID_STYLES.has(partial.chartStyle as ChartStyle)
      ? (partial.chartStyle as ChartStyle)
      : base.chartStyle;

  const rsiPeriodRaw = Number(partial.rsiPeriod);
  const rsiPeriod = Number.isFinite(rsiPeriodRaw) ? Math.round(clamp(rsiPeriodRaw, 5, 34)) : base.rsiPeriod;

  const rightMarginRaw = Number(partial.rightMarginBars);
  const rightMarginBars = Number.isFinite(rightMarginRaw)
    ? Math.round(clamp(rightMarginRaw, 0, 20))
    : base.rightMarginBars;

  return {
    chartStyle: style,
    showVolume: typeof partial.showVolume === 'boolean' ? partial.showVolume : base.showVolume,
    showEma20: typeof partial.showEma20 === 'boolean' ? partial.showEma20 : base.showEma20,
    showEma50: typeof partial.showEma50 === 'boolean' ? partial.showEma50 : base.showEma50,
    showVwap: typeof partial.showVwap === 'boolean' ? partial.showVwap : base.showVwap,
    showPdhPdl: typeof partial.showPdhPdl === 'boolean' ? partial.showPdhPdl : base.showPdhPdl,
    showKillzones: typeof partial.showKillzones === 'boolean' ? partial.showKillzones : base.showKillzones,
    showBidAsk: typeof partial.showBidAsk === 'boolean' ? partial.showBidAsk : base.showBidAsk,
    showCountdown: typeof partial.showCountdown === 'boolean' ? partial.showCountdown : base.showCountdown,
    showMitigatedZones:
      typeof partial.showMitigatedZones === 'boolean' ? partial.showMitigatedZones : base.showMitigatedZones,
    showZoneLabels: typeof partial.showZoneLabels === 'boolean' ? partial.showZoneLabels : base.showZoneLabels,
    showAllPositions: typeof partial.showAllPositions === 'boolean' ? partial.showAllPositions : base.showAllPositions,
    showPendingLimits:
      typeof partial.showPendingLimits === 'boolean' ? partial.showPendingLimits : base.showPendingLimits,
    autoFitIncludeLevels:
      typeof partial.autoFitIncludeLevels === 'boolean' ? partial.autoFitIncludeLevels : base.autoFitIncludeLevels,
    rsiPeriod,
    rightMarginBars,
  };
}

export function loadChartSettings(): ChartSettings {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(CHART_SETTINGS_STORAGE_KEY);
      if (raw) {
        return sanitizeChartSettings(JSON.parse(raw), DEFAULT_CHART_SETTINGS);
      }
    }
  } catch {
    // Fallback to institutional defaults
  }
  return { ...DEFAULT_CHART_SETTINGS };
}

export function saveChartSettings(settings: ChartSettings): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(CHART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // Ignore storage quota / sandbox restrictions
  }
}

/**
 * Converts standard OHLCV candles into smoothed Heikin-Ashi candles for trend noise filtering.
 */
export function toHeikinAshiCandles(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (out[i - 1].open + out[i - 1].close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    out.push({
      time: c.time,
      open: round2(haOpen),
      high: round2(haHigh),
      low: round2(haLow),
      close: round2(haClose),
      volume: c.volume,
    });
  }
  return out;
}

/**
 * Computes institutional Session VWAP resetting strictly at 00:00 UTC each trading day.
 */
export function computeSessionVwap(candles: Candle[]): number[] {
  if (candles.length === 0) return [];
  const out: number[] = [];
  let currentDayKey = -1;
  let cumPv = 0;
  let cumVol = 0;

  for (const c of candles) {
    const dayKey = Math.floor(c.time / 86400);
    if (dayKey !== currentDayKey) {
      currentDayKey = dayKey;
      cumPv = 0;
      cumVol = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Math.max(1, Number.isFinite(c.volume) ? c.volume : 1);
    cumPv += typical * vol;
    cumVol += vol;
    out.push(round2(cumPv / cumVol));
  }
  return out;
}

export interface PreviousDayLevels {
  pdh: number;
  pdl: number;
  pdc: number;
  dayUtc: string;
}

/**
 * Extracts Previous Day High (PDH), Previous Day Low (PDL), and Previous Day Close (PDC)
 * using UTC calendar day boundaries. Returns null if series spans only a single UTC day.
 */
export function computePreviousDayLevels(candles: Candle[]): PreviousDayLevels | null {
  if (candles.length < 2) return null;
  const latestDay = Math.floor(candles[candles.length - 1].time / 86400);

  let prevDay = -1;
  for (let i = candles.length - 1; i >= 0; i--) {
    const d = Math.floor(candles[i].time / 86400);
    if (d < latestDay) {
      prevDay = d;
      break;
    }
  }
  if (prevDay < 0) return null;

  let pdh = -Infinity;
  let pdl = Infinity;
  let pdc = 0;
  let count = 0;
  for (const c of candles) {
    if (Math.floor(c.time / 86400) === prevDay) {
      if (c.high > pdh) pdh = c.high;
      if (c.low < pdl) pdl = c.low;
      pdc = c.close;
      count++;
    }
  }
  if (count === 0 || !Number.isFinite(pdh) || !Number.isFinite(pdl)) return null;

  const dt = new Date(prevDay * 86400 * 1000);
  const dayUtc = `${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${String(dt.getUTCDate()).padStart(2, '0')}`;
  return {
    pdh: round2(pdh),
    pdl: round2(pdl),
    pdc: round2(pdc),
    dayUtc,
  };
}

/**
 * Maps a UTC unix timestamp (seconds) to an institutional XAUUSD trading killzone.
 */
export function getKillzoneForTimestamp(timeSec: number): KillzoneWindow {
  const hourUtc = new Date(timeSec * 1000).getUTCHours();
  if (hourUtc >= 7 && hourUtc < 10) return 'LONDON_OPEN';
  if (hourUtc >= 12 && hourUtc < 15) return 'NY_OVERLAP';
  if (hourUtc >= 15 && hourUtc < 17) return 'NY_AM';
  if (hourUtc >= 0 && hourUtc < 4) return 'ASIAN_ACCUMULATION';
  return 'OFF_SESSION';
}

export interface ZoneSpanResult {
  x0: number;
  x1: number;
  clippedLeft: boolean;
  stoppedAtMitigation: boolean;
}

/**
 * Pure geometric projector for SMC Order Blocks & Fair Value Gaps.
 * Eliminates pan look-ahead teleportation (zones starting after lastVisibleTime return null)
 * and terminates mitigated zones precisely at their mitigatedTime bar.
 */
export function computeZoneSpanX(params: {
  startTime: number;
  mitigated: boolean;
  mitigatedTime?: number;
  firstVisibleTime: number;
  lastVisibleTime: number;
  timeToX: (t: number) => number | null;
  padLeft: number;
  plotRight: number;
  showMitigated: boolean;
}): ZoneSpanResult | null {
  const {
    startTime,
    mitigated,
    mitigatedTime,
    firstVisibleTime,
    lastVisibleTime,
    timeToX,
    padLeft,
    plotRight,
    showMitigated,
  } = params;

  if (mitigated && !showMitigated) return null;
  // Critical fix: NEVER render future zones when panned left into history
  if (startTime > lastVisibleTime) return null;
  // Zone was already mitigated completely before the visible window started
  if (mitigated && mitigatedTime !== undefined && mitigatedTime < firstVisibleTime) return null;

  const clippedLeft = startTime < firstVisibleTime;
  const rawX0 = clippedLeft ? padLeft : timeToX(startTime);
  if (rawX0 === null) return null;
  const x0 = clamp(rawX0, padLeft, plotRight);

  let x1 = plotRight;
  let stoppedAtMitigation = false;
  if (mitigated && mitigatedTime !== undefined && mitigatedTime <= lastVisibleTime) {
    const mitX = timeToX(mitigatedTime);
    if (mitX !== null) {
      x1 = clamp(mitX, x0 + 4, plotRight);
      stoppedAtMitigation = true;
    }
  }

  if (x1 <= x0 + 1) return null;
  return { x0, x1, clippedLeft, stoppedAtMitigation };
}

export interface LabelPlacementItem {
  id: string;
  desiredY: number;
  priority: number;
}

/**
 * Greedy vertical de-confliction for price/zone text labels so labels never collide or stack illegibly.
 */
export function resolveLabelCollisions(
  items: LabelPlacementItem[],
  minGapPx = 15,
  minY = 20,
  maxY = 480
): Map<string, number> {
  const result = new Map<string, number>();
  if (items.length === 0) return result;

  const sorted = [...items].sort((a, b) => b.priority - a.priority || a.desiredY - b.desiredY);
  const placed: number[] = [];

  for (const item of sorted) {
    let y = clamp(item.desiredY, minY, maxY);
    let attempts = 0;
    while (placed.some((py) => Math.abs(py - y) < minGapPx) && attempts < 14) {
      const step = Math.ceil((attempts + 1) / 2) * minGapPx;
      const dir = attempts % 2 === 0 ? 1 : -1;
      const candidate = clamp(item.desiredY + dir * step, minY, maxY);
      if (!placed.some((py) => Math.abs(py - candidate) < minGapPx)) {
        y = candidate;
        break;
      }
      attempts++;
    }
    placed.push(y);
    result.set(item.id, y);
  }
  return result;
}

/**
 * Date-aware UTC X-axis timestamp formatter:
 * - H1/H4 and UTC day transitions show `MM/DD HH:MM` (or `MM/DD` at 00:00)
 * - Intraday bars on the same day show `HH:MM`
 */
export function formatAxisTimestamp(
  timeSec: number,
  timeframe: Timeframe,
  prevTimeSec?: number | null
): string {
  const d = new Date(timeSec * 1000);
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');

  const dayChanged =
    prevTimeSec !== undefined &&
    prevTimeSec !== null &&
    Math.floor(timeSec / 86400) !== Math.floor(prevTimeSec / 86400);

  if (timeframe === 'H4') {
    return `${mo}/${da} ${hh}:00`;
  }
  if (timeframe === 'H1') {
    return dayChanged || hh === '00' ? `${mo}/${da} ${hh}:00` : `${hh}:00`;
  }
  if (dayChanged) {
    return `${mo}/${da} ${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

export function formatFullUtcTimestamp(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm} UTC`;
}

/**
 * Computes exact remaining time until the current bar closes for the active timeframe.
 */
export function formatCandleCountdown(nowMs: number, timeframe: Timeframe): string {
  const stepSec = TIMEFRAME_SECONDS[timeframe];
  const nowSec = Math.floor(nowMs / 1000);
  const elapsed = ((nowSec % stepSec) + stepSec) % stepSec;
  const remaining = Math.max(0, stepSec - elapsed);

  const hrs = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;

  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Calibrates proxy gold OHLCV candles (e.g. Binance PAXGUSDT or OKX XAUT-USDT) onto
 * Interbank XAU/USD Spot using a clamped basis offset while strictly enforcing OHLC invariants.
 */
export function calibrateCandlesToSpot(
  candles: Candle[],
  basisOffsetUsd: number,
  liveSpot?: number | null,
  maxBasisAbsUsd = 35
): Candle[] {
  if (candles.length === 0) return [];
  const safeOffset = Number.isFinite(basisOffsetUsd)
    ? clamp(basisOffsetUsd, -maxBasisAbsUsd, maxBasisAbsUsd)
    : 0;

  // Sort chronologically & deduplicate timestamps
  const byTime = new Map<number, Candle>();
  for (const raw of candles) {
    if (!Number.isFinite(raw.time) || !Number.isFinite(raw.close) || raw.close <= 0) continue;
    const o = round2(Math.max(0.01, raw.open + safeOffset));
    const c = round2(Math.max(0.01, raw.close + safeOffset));
    const h = round2(Math.max(o, c, raw.high + safeOffset));
    const l = round2(Math.min(o, c, Math.max(0.01, raw.low + safeOffset)));
    byTime.set(Math.floor(raw.time), {
      time: Math.floor(raw.time),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: Math.max(0, Math.round(Number.isFinite(raw.volume) ? raw.volume : 0)),
    });
  }

  const out = Array.from(byTime.values()).sort((a, b) => a.time - b.time);

  // Align the live forming bar close tightly to liveSpot if within reasonable divergence
  if (out.length > 0 && typeof liveSpot === 'number' && Number.isFinite(liveSpot) && liveSpot > 0) {
    const last = out[out.length - 1];
    if (Math.abs(liveSpot - last.close) <= maxBasisAbsUsd) {
      const spotR = round2(liveSpot);
      out[out.length - 1] = {
        ...last,
        close: spotR,
        high: round2(Math.max(last.high, spotR)),
        low: round2(Math.min(last.low, spotR)),
      };
    }
  }

  return out;
}

/**
 * Ensures the live forming candle across all timeframes reflects the latest spot tick
 * without distorting historical closed bars.
 */
export function alignMultiTimeframeClose(
  candlesByTf: Record<Timeframe, Candle[]>,
  liveSpot: number,
  nowSec = Math.floor(Date.now() / 1000),
  maxBarsPerTf = 300
): Record<Timeframe, Candle[]> {
  if (!Number.isFinite(liveSpot) || liveSpot <= 0) return candlesByTf;
  const spot = round2(liveSpot);
  const next = { ...candlesByTf };

  (['M1', 'M5', 'M15', 'M30', 'H1', 'H4'] as Timeframe[]).forEach((tf) => {
    const series = [...(next[tf] ?? [])];
    if (series.length === 0) return;
    const step = TIMEFRAME_SECONDS[tf];
    const bucket = Math.floor(nowSec / step) * step;
    const last = series[series.length - 1];
    if (bucket > last.time) {
      series.push({
        time: bucket,
        open: last.close,
        high: Math.max(last.close, spot),
        low: Math.min(last.close, spot),
        close: spot,
        volume: 1,
      });
      if (series.length > maxBarsPerTf) series.shift();
    } else {
      series[series.length - 1] = {
        ...last,
        high: round2(Math.max(last.high, spot)),
        low: round2(Math.min(last.low, spot)),
        close: spot,
      };
    }
    next[tf] = series;
  });

  return next;
}

export interface RulerMetrics {
  deltaUsd: number;
  deltaPct: number;
  pips: number;
  bars: number;
  durationLabel: string;
}

/**
 * Computes institutional scalper ruler metrics between two chart points.
 */
export function computeRulerMetrics(
  startPrice: number,
  endPrice: number,
  startIdx: number,
  endIdx: number,
  timeframe: Timeframe
): RulerMetrics {
  const deltaUsd = round2(endPrice - startPrice);
  const deltaPct = startPrice > 0 ? round2((deltaUsd / startPrice) * 100) : 0;
  const pips = Math.round(deltaUsd * 10);
  const bars = Math.abs(endIdx - startIdx);
  const totalSec = bars * TIMEFRAME_SECONDS[timeframe];

  let durationLabel = '0m';
  if (totalSec >= 86400) {
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    durationLabel = `${d}d ${h}h`;
  } else if (totalSec >= 3600) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    durationLabel = m > 0 ? `${h}h ${m}m` : `${h}h`;
  } else {
    durationLabel = `${Math.floor(totalSec / 60)}m`;
  }

  return { deltaUsd, deltaPct, pips, bars, durationLabel };
}
