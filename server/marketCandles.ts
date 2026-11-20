import type { Candle, Timeframe } from '../src/engine/types.ts';
import {
  DEFAULT_BASIS_EMA_ALPHA,
  DEFAULT_MAX_BASIS_ABS_USD,
  HIGH_BASIS_DIVERGENCE_THRESHOLD_USD,
  aggregateSpotTicksToCandles,
  calibrateCandlesToSpot,
  updateRollingBasisEma,
  type BasisObservation,
  type CalibratedCandle,
  type SpotTickSample,
} from '../src/engine/chartEngine.ts';
import { chartStore } from './timescaleStore.ts';

export interface SpotBasisQuote {
  spotMid: number;
  spotBid: number;
  spotAsk: number;
  spread: number;
  spotSource: string;
  paxgMid: number | null;
  basisUsd: number;
  rollingBasisEmaUsd?: number;
  highBasisDivergence?: boolean;
  fetchedAtMs: number;
}

export interface CalibratedCandleResponse {
  ok: boolean;
  timeframe: Timeframe;
  candles: CalibratedCandle[];
  source: string;
  rawFeed: 'BINANCE_PAXGUSDT' | 'OKX_XAUTUSDT' | 'YAHOO_GCF' | 'TIMESCALEDB' | 'SWISSQUOTE_NATIVE';
  calibratedToSpot: boolean;
  spotReference: number | null;
  basisOffsetUsd: number;
  rollingBasisEmaUsd?: number;
  highBasisDivergenceBars?: number;
  nativeSpotBarCount?: number;
  storageBackend: 'timescaledb' | 'memory';
  barCount: number;
  fetchedAtMs: number;
}

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
};

const OKX_BAR: Record<Timeframe, string> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1H',
  H4: '4H',
};

const YAHOO_SPEC: Record<Timeframe, { interval: string; range: string }> = {
  M1: { interval: '1m', range: '1d' },
  M5: { interval: '5m', range: '5d' },
  M15: { interval: '15m', range: '5d' },
  M30: { interval: '30m', range: '1mo' },
  H1: { interval: '60m', range: '1mo' },
  H4: { interval: '60m', range: '3mo' },
};

const TF_CACHE_TTL_MS: Record<Timeframe, number> = {
  M1: 12_000,
  M5: 25_000,
  M15: 35_000,
  M30: 50_000,
  H1: 60_000,
  H4: 90_000,
};

interface CachedTfEntry {
  data: CalibratedCandleResponse;
  expiresAtMs: number;
}

const tfCache = new Map<Timeframe, CachedTfEntry>();
let cachedQuote: SpotBasisQuote | null = null;
let quoteExpiresAtMs = 0;

// Exponential Rolling Basis Calibrator state (alpha = 0.15, clamped to +/-$35.00)
const MAX_BASIS_HISTORY = 720;
const MAX_SPOT_TICKS = 4800;
let rollingBasisEmaUsd: number | null = null;
let lastHighBasisDivergence = false;
const basisHistory: BasisObservation[] = [];
const spotTickRing: SpotTickSample[] = [];

export function recordSpotTick(spotMid: number, timestampMs = Date.now(), volume = 1): void {
  if (!Number.isFinite(spotMid) || spotMid <= 0) return;
  const timeSec = Math.floor(timestampMs / 1000);
  spotTickRing.push({ timeSec, price: Number(spotMid.toFixed(2)), volume });
  if (spotTickRing.length > MAX_SPOT_TICKS) {
    spotTickRing.splice(0, spotTickRing.length - MAX_SPOT_TICKS);
  }
}

export function recordBasisObservation(rawBasisUsd: number, timestampMs = Date.now()): {
  rollingBasisEmaUsd: number;
  highBasisDivergence: boolean;
} {
  const stepped = updateRollingBasisEma(
    rollingBasisEmaUsd,
    rawBasisUsd,
    DEFAULT_BASIS_EMA_ALPHA,
    DEFAULT_MAX_BASIS_ABS_USD,
    HIGH_BASIS_DIVERGENCE_THRESHOLD_USD
  );
  rollingBasisEmaUsd = stepped.basisUsd;
  lastHighBasisDivergence = stepped.highBasisDivergence;

  const bucketSec = Math.floor(timestampMs / 15_000) * 15;
  const prev = basisHistory[basisHistory.length - 1];
  if (prev && prev.time === bucketSec) {
    prev.basisUsd = stepped.basisUsd;
  } else {
    basisHistory.push({ time: bucketSec, basisUsd: stepped.basisUsd });
    if (basisHistory.length > MAX_BASIS_HISTORY) {
      basisHistory.shift();
    }
  }
  return {
    rollingBasisEmaUsd: stepped.basisUsd,
    highBasisDivergence: stepped.highBasisDivergence,
  };
}

export function getNativeSpotCandles(timeframe: Timeframe, limit = 240): CalibratedCandle[] {
  return aggregateSpotTicksToCandles(spotTickRing, timeframe, Math.max(10, Math.min(300, limit)));
}

export function getRollingBasisState(): {
  alpha: number;
  maxBasisAbsUsd: number;
  highDivergenceThresholdUsd: number;
  rollingBasisEmaUsd: number | null;
  highBasisDivergence: boolean;
  historyCount: number;
  nativeTickCount: number;
} {
  return {
    alpha: DEFAULT_BASIS_EMA_ALPHA,
    maxBasisAbsUsd: DEFAULT_MAX_BASIS_ABS_USD,
    highDivergenceThresholdUsd: HIGH_BASIS_DIVERGENCE_THRESHOLD_USD,
    rollingBasisEmaUsd,
    highBasisDivergence: lastHighBasisDivergence,
    historyCount: basisHistory.length,
    nativeTickCount: spotTickRing.length,
  };
}

async function fetchJsonFast(url: string, timeoutMs = 3200): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PayamXAUUSD/3.0)',
        Accept: 'application/json',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLiveSpotAndBasis(force = false): Promise<SpotBasisQuote | null> {
  const now = Date.now();
  if (!force && cachedQuote && now < quoteExpiresAtMs) {
    return cachedQuote;
  }

  const [sqRes, paxgRes] = await Promise.allSettled([
    fetchJsonFast('https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD', 2600),
    fetchJsonFast('https://api.binance.com/api/v3/ticker/bookTicker?symbol=PAXGUSDT', 2600),
  ]);

  let spotBid = 0;
  let spotAsk = 0;
  let spotSource = 'Swissquote Interbank BBO';
  if (sqRes.status === 'fulfilled' && Array.isArray(sqRes.value)) {
    for (const venue of sqRes.value as Array<{ spreadProfilePrices?: Array<{ bid: number; ask: number }> }>) {
      const p0 = venue?.spreadProfilePrices?.[0];
      if (p0 && Number.isFinite(p0.bid) && Number.isFinite(p0.ask) && p0.bid > 0) {
        spotBid = Number(p0.bid.toFixed(2));
        spotAsk = Number(p0.ask.toFixed(2));
        break;
      }
    }
  }

  let paxgMid: number | null = null;
  if (paxgRes.status === 'fulfilled' && paxgRes.value && typeof paxgRes.value === 'object') {
    const d = paxgRes.value as { bidPrice?: string; askPrice?: string };
    const b = Number(d.bidPrice);
    const a = Number(d.askPrice);
    if (Number.isFinite(b) && Number.isFinite(a) && b > 0) {
      paxgMid = Number(((b + a) / 2).toFixed(2));
      if (spotBid <= 0) {
        spotBid = Number(b.toFixed(2));
        spotAsk = Number(a.toFixed(2));
        spotSource = 'Binance PAXGUSDT (Tier 2)';
      }
    }
  }

  if (spotBid <= 0 || spotAsk <= 0) {
    return cachedQuote;
  }

  const spotMid = Number(((spotBid + spotAsk) / 2).toFixed(2));
  const spread = Number(Math.max(0.02, spotAsk - spotBid).toFixed(2));
  const rawBasisUsd = paxgMid !== null ? Number((spotMid - paxgMid).toFixed(2)) : 0;

  if (spotSource === 'Swissquote Interbank BBO') {
    recordSpotTick(spotMid, now, 1);
  }
  const basisState =
    paxgMid !== null
      ? recordBasisObservation(rawBasisUsd, now)
      : {
          rollingBasisEmaUsd: rollingBasisEmaUsd ?? 0,
          highBasisDivergence: lastHighBasisDivergence,
        };

  cachedQuote = {
    spotMid,
    spotBid,
    spotAsk,
    spread,
    spotSource,
    paxgMid,
    basisUsd: rawBasisUsd,
    rollingBasisEmaUsd: basisState.rollingBasisEmaUsd,
    highBasisDivergence: basisState.highBasisDivergence,
    fetchedAtMs: now,
  };
  quoteExpiresAtMs = now + 3_500;
  return cachedQuote;
}

async function fetchBinancePaxgKlines(tf: Timeframe, limit: number): Promise<Candle[]> {
  const interval = BINANCE_INTERVAL[tf];
  const url = `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${limit}`;
  const raw = await fetchJsonFast(url, 3500);
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('Empty Binance PAXGUSDT klines response');
  }
  const candles: Candle[] = [];
  for (const row of raw as Array<Array<string | number>>) {
    const openTimeMs = Number(row[0]);
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    const v = Number(row[5]);
    if (!Number.isFinite(openTimeMs) || !Number.isFinite(c) || c <= 0) continue;
    candles.push({
      time: Math.floor(openTimeMs / 1000),
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(1, Math.round(Number.isFinite(v) ? v * 10 : 1)),
    });
  }
  return candles;
}

async function fetchOkxXautCandles(tf: Timeframe, limit: number): Promise<Candle[]> {
  const bar = OKX_BAR[tf];
  const capped = Math.min(300, limit);
  const url = `https://www.okx.com/api/v5/market/candles?instId=XAUT-USDT&bar=${bar}&limit=${capped}`;
  const raw = (await fetchJsonFast(url, 3500)) as { data?: string[][] };
  if (!Array.isArray(raw?.data) || raw.data.length === 0) {
    throw new Error('Empty OKX XAUT-USDT candles response');
  }
  // OKX returns newest-first; reverse to chronological ascending
  const candles: Candle[] = [];
  for (let i = raw.data.length - 1; i >= 0; i--) {
    const row = raw.data[i];
    const tsMs = Number(row[0]);
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    const v = Number(row[5]);
    if (!Number.isFinite(tsMs) || !Number.isFinite(c) || c <= 0) continue;
    candles.push({
      time: Math.floor(tsMs / 1000),
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(1, Math.round(Number.isFinite(v) ? v * 10 : 1)),
    });
  }
  return candles;
}

function aggregateTo4H(h1Candles: Candle[]): Candle[] {
  const buckets = new Map<number, Candle>();
  for (const c of h1Candles) {
    const b = Math.floor(c.time / 14400) * 14400;
    const prev = buckets.get(b);
    if (!prev) {
      buckets.set(b, { ...c, time: b });
    } else {
      prev.high = Math.max(prev.high, c.high);
      prev.low = Math.min(prev.low, c.low);
      prev.close = c.close;
      prev.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

async function fetchYahooGoldFutures(tf: Timeframe, limit: number): Promise<Candle[]> {
  const spec = YAHOO_SPEC[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${spec.interval}&range=${spec.range}`;
  const raw = (await fetchJsonFast(url, 4000)) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      }>;
    };
  };
  const r0 = raw?.chart?.result?.[0];
  const ts = r0?.timestamp ?? [];
  const q = r0?.indicators?.quote?.[0];
  if (!ts.length || !q) throw new Error('Empty Yahoo GC=F response');

  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    const v = q.volume?.[i] ?? 1;
    if (o == null || h == null || l == null || c == null || !Number.isFinite(c) || c <= 0) continue;
    out.push({
      time: ts[i],
      open: Number(o.toFixed(2)),
      high: Number(h.toFixed(2)),
      low: Number(l.toFixed(2)),
      close: Number(c.toFixed(2)),
      volume: Math.max(1, Math.round(v)),
    });
  }
  const finalSeries = tf === 'H4' ? aggregateTo4H(out) : out;
  return finalSeries.slice(-limit);
}

/**
 * Fetches real, deep, Interbank-calibrated XAU/USD candles for a single timeframe with 3-tier exchange failover
 * and optional TimescaleDB persistence/acceleration.
 */
export async function fetchCalibratedCandles(
  timeframe: Timeframe,
  limit = 240,
  force = false
): Promise<CalibratedCandleResponse> {
  const safeLimit = Math.max(40, Math.min(300, Math.floor(limit)));
  const now = Date.now();
  const cached = tfCache.get(timeframe);
  if (!force && cached && now < cached.expiresAtMs && cached.data.candles.length >= Math.min(safeLimit, 120)) {
    return {
      ...cached.data,
      candles: cached.data.candles.slice(-safeLimit),
      barCount: Math.min(cached.data.candles.length, safeLimit),
    };
  }

  const quote = await fetchLiveSpotAndBasis(false);
  const storageStatus = chartStore.getStatus();

  // Check TimescaleDB first if connected and already richly populated
  if (!force && storageStatus.driver === 'timescaledb') {
    const stored = await chartStore.getCandles(timeframe, safeLimit);
    if (stored.fromTimescale && stored.candles.length >= Math.min(120, safeLimit)) {
      const latestBarAgeSec = Math.floor(now / 1000) - stored.candles[stored.candles.length - 1].time;
      if (latestBarAgeSec <= 180) {
        const resp: CalibratedCandleResponse = {
          ok: true,
          timeframe,
          candles: stored.candles,
          source: 'TimescaleDB Continuous Aggregate (Swissquote Calibrated)',
          rawFeed: 'TIMESCALEDB',
          calibratedToSpot: true,
          spotReference: quote?.spotMid ?? stored.candles[stored.candles.length - 1].close,
          basisOffsetUsd: quote?.basisUsd ?? 0,
          storageBackend: 'timescaledb',
          barCount: stored.candles.length,
          fetchedAtMs: now,
        };
        tfCache.set(timeframe, { data: resp, expiresAtMs: now + TF_CACHE_TTL_MS[timeframe] });
        return resp;
      }
    }
  }

  // Multi-source real market OHLCV waterfall: Binance PAXGUSDT -> OKX XAUT-USDT -> Yahoo GC=F
  let rawCandles: Candle[] = [];
  let rawFeed: CalibratedCandleResponse['rawFeed'] = 'BINANCE_PAXGUSDT';
  let sourceLabel = 'Binance PAXGUSDT';

  try {
    rawCandles = await fetchBinancePaxgKlines(timeframe, safeLimit);
    rawFeed = 'BINANCE_PAXGUSDT';
    sourceLabel = 'Binance PAXGUSDT';
  } catch {
    try {
      rawCandles = await fetchOkxXautCandles(timeframe, safeLimit);
      rawFeed = 'OKX_XAUTUSDT';
      sourceLabel = 'OKX XAUT-USDT';
    } catch {
      rawCandles = await fetchYahooGoldFutures(timeframe, safeLimit);
      rawFeed = 'YAHOO_GCF';
      sourceLabel = 'COMEX GC=F (Yahoo)';
    }
  }

  // Calibrate onto Swissquote Interbank XAU/USD Spot using Exponential Rolling Basis Calibrator (alpha=0.15, +/-$35 clamp)
  const lastRawClose = rawCandles[rawCandles.length - 1]?.close ?? 0;
  let instantaneousBasis = 0;
  let effectiveBasisOffset = rollingBasisEmaUsd ?? 0;
  let calibratedToSpot = false;

  if (quote && quote.spotMid > 0 && lastRawClose > 0) {
    if (rawFeed === 'BINANCE_PAXGUSDT' && quote.paxgMid !== null) {
      instantaneousBasis = quote.basisUsd;
      effectiveBasisOffset = quote.rollingBasisEmaUsd ?? quote.basisUsd;
    } else {
      instantaneousBasis = Number((quote.spotMid - lastRawClose).toFixed(2));
      const updated = updateRollingBasisEma(
        rollingBasisEmaUsd,
        instantaneousBasis,
        DEFAULT_BASIS_EMA_ALPHA,
        DEFAULT_MAX_BASIS_ABS_USD,
        HIGH_BASIS_DIVERGENCE_THRESHOLD_USD
      );
      effectiveBasisOffset = updated.basisUsd;
    }
    calibratedToSpot = true;
  }

  const nativeSpotCandles = getNativeSpotCandles(timeframe, safeLimit);
  const calibrated = calibrateCandlesToSpot(rawCandles, effectiveBasisOffset, quote?.spotMid ?? null, {
    alpha: DEFAULT_BASIS_EMA_ALPHA,
    maxBasisAbsUsd: DEFAULT_MAX_BASIS_ABS_USD,
    highDivergenceThresholdUsd: HIGH_BASIS_DIVERGENCE_THRESHOLD_USD,
    basisHistory: rawFeed === 'BINANCE_PAXGUSDT' ? basisHistory : undefined,
    nativeSpotCandles,
  });

  const highBasisDivergenceBars = calibrated.filter((c) => c.highBasisDivergence).length;
  const fullSource = calibratedToSpot
    ? `${quote?.spotSource ?? 'Swissquote Spot'} + ${sourceLabel} (EMA α=0.15 Calibrated)`
    : sourceLabel;

  // Persist asynchronously into TimescaleDB / Memory store
  await chartStore.upsertCandles(timeframe, calibrated, fullSource);

  const response: CalibratedCandleResponse = {
    ok: calibrated.length > 0,
    timeframe,
    candles: calibrated,
    source: fullSource,
    rawFeed,
    calibratedToSpot,
    spotReference: quote?.spotMid ?? (calibrated[calibrated.length - 1]?.close ?? null),
    basisOffsetUsd: effectiveBasisOffset,
    rollingBasisEmaUsd: effectiveBasisOffset,
    highBasisDivergenceBars,
    nativeSpotBarCount: nativeSpotCandles.length,
    storageBackend: chartStore.getStatus().driver,
    barCount: calibrated.length,
    fetchedAtMs: now,
  };

  tfCache.set(timeframe, { data: response, expiresAtMs: now + TF_CACHE_TTL_MS[timeframe] });
  return response;
}

/**
 * Hydrates all 6 institutional timeframes (M1..H4) in parallel with unified Swissquote Spot calibration.
 */
export async function fetchAllTimeframesBundle(limit = 220, force = false): Promise<{
  ok: boolean;
  candlesByTf: Record<Timeframe, Candle[]>;
  source: string;
  rawFeed: string;
  calibratedToSpot: boolean;
  spot: SpotBasisQuote | null;
  basisOffsetUsd: number;
  storageBackend: 'timescaledb' | 'memory';
  barCounts: Record<Timeframe, number>;
  fetchedAtMs: number;
}> {
  const quote = await fetchLiveSpotAndBasis(force);
  const tfs: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];
  const results = await Promise.allSettled(tfs.map((tf) => fetchCalibratedCandles(tf, limit, force)));

  const candlesByTf = {} as Record<Timeframe, Candle[]>;
  const barCounts = {} as Record<Timeframe, number>;
  let primarySource = 'Swissquote + PAXG Calibrated';
  let primaryRawFeed = 'BINANCE_PAXGUSDT';
  let calibratedToSpot = false;
  let basisOffsetUsd = quote?.basisUsd ?? 0;
  let anySucceeded = false;

  tfs.forEach((tf, idx) => {
    const r = results[idx];
    if (r.status === 'fulfilled' && r.value.candles.length > 0) {
      candlesByTf[tf] = r.value.candles;
      barCounts[tf] = r.value.candles.length;
      anySucceeded = true;
      if (tf === 'M15' || !calibratedToSpot) {
        primarySource = r.value.source;
        primaryRawFeed = r.value.rawFeed;
        calibratedToSpot = r.value.calibratedToSpot;
        basisOffsetUsd = r.value.basisOffsetUsd;
      }
    } else {
      candlesByTf[tf] = [];
      barCounts[tf] = 0;
    }
  });

  return {
    ok: anySucceeded,
    candlesByTf,
    source: primarySource,
    rawFeed: primaryRawFeed,
    calibratedToSpot,
    spot: quote,
    basisOffsetUsd,
    storageBackend: chartStore.getStatus().driver,
    barCounts,
    fetchedAtMs: Date.now(),
  };
}
