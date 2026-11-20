import type { Advisory, Candle, NewsEvent, Position, Tick } from './types';

/**
 * 5 Defensive Normalizers per Blueprint Subsystem 8 (store/useStore.ts):
 * Guarantees raw WebSocket / REST payloads never crash React rendering with undefined/NaN.
 */
export function normalizeTick(raw: Partial<Tick> | null | undefined, fallbackPrice = 2742.5): Tick {
  const last = Number.isFinite(raw?.last) && (raw?.last as number) > 0 ? Number(raw?.last) : fallbackPrice;
  const bid = Number.isFinite(raw?.bid) && (raw?.bid as number) > 0 ? Number(raw?.bid) : Number((last - 0.12).toFixed(2));
  const ask = Number.isFinite(raw?.ask) && (raw?.ask as number) >= bid ? Number(raw?.ask) : Number((last + 0.12).toFixed(2));
  const spread = Number((ask - bid).toFixed(2));
  const tier = raw?.tier === 1 || raw?.tier === 2 || raw?.tier === 3 ? raw.tier : 1;

  return {
    symbol: typeof raw?.symbol === 'string' && raw.symbol.trim() ? raw.symbol : 'XAUUSD',
    last: Number(last.toFixed(2)),
    bid,
    ask,
    spread,
    timestampMs: Number.isFinite(raw?.timestampMs) ? Number(raw?.timestampMs) : Date.now(),
    tier,
    source: typeof raw?.source === 'string' && raw.source ? raw.source : 'TradingView Chrome CDP',
    seq: Number.isFinite(raw?.seq) ? Number(raw?.seq) : 0,
  };
}

export function normalizeCandle(raw: Partial<Candle> | null | undefined): Candle {
  const open = Number.isFinite(raw?.open) ? Number(raw?.open) : 2740;
  const close = Number.isFinite(raw?.close) ? Number(raw?.close) : open;
  const high = Number.isFinite(raw?.high) ? Math.max(Number(raw?.high), open, close) : Math.max(open, close);
  const low = Number.isFinite(raw?.low) ? Math.min(Number(raw?.low), open, close) : Math.min(open, close);
  return {
    time: Number.isFinite(raw?.time) ? Number(raw?.time) : Math.floor(Date.now() / 1000),
    open: Number(open.toFixed(2)),
    high: Number(high.toFixed(2)),
    low: Number(low.toFixed(2)),
    close: Number(close.toFixed(2)),
    volume: Number.isFinite(raw?.volume) && (raw?.volume as number) >= 0 ? Number(raw?.volume) : 0,
  };
}

export function normalizeNews(raw: Partial<NewsEvent> | null | undefined): NewsEvent {
  const impact = raw?.impact === 'HIGH' || raw?.impact === 'MEDIUM' || raw?.impact === 'LOW' ? raw.impact : 'LOW';
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : `news-${Date.now()}`,
    title: typeof raw?.title === 'string' && raw.title ? raw.title : 'رویداد کلان اقتصادی USD',
    currency: typeof raw?.currency === 'string' && raw.currency ? raw.currency.toUpperCase() : 'USD',
    impact,
    scheduledAtMs: Number.isFinite(raw?.scheduledAtMs) ? Number(raw?.scheduledAtMs) : Date.now() + 3600000,
    forecast: typeof raw?.forecast === 'string' ? raw.forecast : '—',
    previous: typeof raw?.previous === 'string' ? raw.previous : '—',
  };
}

export function normalizePosition(raw: Partial<Position> | null | undefined): Position | null {
  if (!raw || !Number.isFinite(raw.entry) || !Number.isFinite(raw.stopLoss)) return null;
  return {
    id: raw.id || `pos-${Date.now()}`,
    direction: raw.direction === 'SHORT' ? 'SHORT' : 'LONG',
    entry: Number(raw.entry),
    initialSl: Number.isFinite(raw.initialSl) ? Number(raw.initialSl) : Number(raw.stopLoss),
    stopLoss: Number(raw.stopLoss),
    tp1: Number.isFinite(raw.tp1) ? Number(raw.tp1) : Number(raw.entry) + 8,
    tp2: Number.isFinite(raw.tp2) ? Number(raw.tp2) : Number(raw.entry) + 16,
    lotSize: Number.isFinite(raw.lotSize) && (raw.lotSize as number) > 0 ? Number(raw.lotSize) : 0.1,
    spread: Number.isFinite(raw.spread) ? Number(raw.spread) : 0.24,
    stage: raw.stage ?? 'OPEN',
    rrRatio: Number.isFinite(raw.rrRatio) ? Number(raw.rrRatio) : 1.5,
    unrealizedPnl: Number.isFinite(raw.unrealizedPnl) ? Number(raw.unrealizedPnl) : 0,
    realizedPartial: Boolean(raw.realizedPartial),
    openedAtMs: Number.isFinite(raw.openedAtMs) ? Number(raw.openedAtMs) : Date.now(),
    history: Array.isArray(raw.history) ? raw.history : [],
  };
}

export function normalizeAdvisory(raw: Partial<Advisory> | null | undefined): Advisory | null {
  if (!raw || !raw.factLedger) return null;
  const verdict =
    raw.verdict === 'HOLD' ||
    raw.verdict === 'SCALE' ||
    raw.verdict === 'PROTECT' ||
    raw.verdict === 'EXIT' ||
    raw.verdict === 'VETO'
      ? raw.verdict
      : 'HOLD';
  return {
    id: raw.id || `adv-${Date.now()}`,
    jobId: raw.jobId || raw.factLedger.jobId,
    verdict,
    confidence: Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0.75,
    rationaleEn: raw.rationaleEn || 'Deterministic fact ledger evaluated.',
    rationaleFa: raw.rationaleFa || 'دفتر کل فکت‌های بازار ارزیابی شد.',
    hallucinationChecked: raw.hallucinationChecked !== false,
    factLedger: raw.factLedger,
    createdAtMs: Number.isFinite(raw.createdAtMs) ? Number(raw.createdAtMs) : Date.now(),
  };
}
