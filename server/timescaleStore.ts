import { Pool } from 'pg';
import type { Candle, Timeframe } from '../src/engine/types.ts';

export interface LiveTickRecord {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  paxgMid: number | null;
  basisUsd: number;
  source: string;
  timestampMs: number;
}

export interface StorageStatusSnapshot {
  driver: 'timescaledb' | 'memory';
  connected: boolean;
  databaseConfigured: boolean;
  hypertablesReady: boolean;
  ticksPersisted: number;
  candlesCached: Record<Timeframe, number>;
  lastWriteMs: number | null;
  lastError: string | null;
}

const MAX_MEMORY_CANDLES = 400;

const CAGG_TABLE_BY_TF: Record<Timeframe, string> = {
  M1: 'candles_1m',
  M5: 'candles_5m',
  M15: 'candles_15m',
  M30: 'candles_30m',
  H1: 'candles_1h',
  H4: 'candles_4h',
};

/**
 * Dual-mode Chart & Tick Storage Repository:
 * - On Ubuntu target host with DATABASE_URL configured: connects to self-hosted PostgreSQL + TimescaleDB
 *   (hypertables market_ticks & candles_1m + real-time Continuous Aggregates candles_5m..candles_4h).
 * - In preview/sandbox containers without DATABASE_URL: runs cleanly with zero errors on an in-memory ring cache.
 */
export class TimescaleChartStore {
  private pool: Pool | null = null;
  private connected = false;
  private hypertablesReady = false;
  private databaseConfigured = false;
  private ticksPersisted = 0;
  private lastWriteMs: number | null = null;
  private lastError: string | null = null;

  private memoryCandles: Record<Timeframe, Candle[]> = {
    M1: [],
    M5: [],
    M15: [],
    M30: [],
    H1: [],
    H4: [],
  };

  async init(): Promise<void> {
    const connStr = (process.env.DATABASE_URL || '').trim();
    const driverPref = (process.env.CANDLE_STORAGE_DRIVER || 'auto').trim().toLowerCase();

    if (!connStr || driverPref === 'memory') {
      this.databaseConfigured = false;
      this.connected = false;
      this.hypertablesReady = false;
      return;
    }

    this.databaseConfigured = true;
    try {
      this.pool = new Pool({
        connectionString: connStr,
        max: 8,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 3_000,
      });

      this.pool.on('error', (err) => {
        this.lastError = err.message;
        this.connected = false;
      });

      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        this.connected = true;

        // Verify TimescaleDB hypertables exist (initialized via db/timescaledb/001_init_timescaledb.sql)
        const check = await client.query(
          `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('market_ticks', 'candles_1m')`
        );
        this.hypertablesReady = Number(check.rows[0]?.cnt ?? 0) >= 2;
        this.lastError = null;
        console.log(
          `[TimescaleChartStore] Connected to PostgreSQL/TimescaleDB (hypertablesReady=${this.hypertablesReady})`
        );
      } finally {
        client.release();
      }
    } catch (err) {
      this.connected = false;
      this.hypertablesReady = false;
      this.lastError = err instanceof Error ? err.message : 'PostgreSQL/TimescaleDB unavailable';
      console.warn(`[TimescaleChartStore] Fallback to in-memory ring store (${this.lastError})`);
      if (this.pool) {
        await this.pool.end().catch(() => {});
        this.pool = null;
      }
    }
  }

  getStatus(): StorageStatusSnapshot {
    return {
      driver: this.connected && this.hypertablesReady ? 'timescaledb' : 'memory',
      connected: this.connected,
      databaseConfigured: this.databaseConfigured,
      hypertablesReady: this.hypertablesReady,
      ticksPersisted: this.ticksPersisted,
      candlesCached: {
        M1: this.memoryCandles.M1.length,
        M5: this.memoryCandles.M5.length,
        M15: this.memoryCandles.M15.length,
        M30: this.memoryCandles.M30.length,
        H1: this.memoryCandles.H1.length,
        H4: this.memoryCandles.H4.length,
      },
      lastWriteMs: this.lastWriteMs,
      lastError: this.lastError,
    };
  }

  /**
   * Non-blocking fire-and-forget tick recorder for live Interbank BBO ticks.
   */
  recordTick(tick: LiveTickRecord): void {
    this.ticksPersisted += 1;
    this.lastWriteMs = tick.timestampMs;

    if (!this.pool || !this.connected || !this.hypertablesReady) return;

    void this.pool
      .query(
        `INSERT INTO market_ticks (ts, symbol, bid, ask, mid, spread, paxg_mid, basis_usd, source)
         VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          tick.timestampMs,
          tick.symbol,
          tick.bid,
          tick.ask,
          tick.mid,
          tick.spread,
          tick.paxgMid,
          tick.basisUsd,
          tick.source,
        ]
      )
      .catch((err) => {
        this.lastError = err instanceof Error ? err.message : 'Tick write failed';
      });
  }

  /**
   * Upserts candles into the fast in-memory ring cache, and persists M1 bars into TimescaleDB candles_1m hypertable.
   */
  async upsertCandles(timeframe: Timeframe, candles: Candle[], source: string): Promise<void> {
    if (candles.length === 0) return;

    // Merge into in-memory ring cache sorted ascending by unix seconds
    const map = new Map<number, Candle>();
    for (const existing of this.memoryCandles[timeframe]) {
      map.set(existing.time, existing);
    }
    for (const c of candles) {
      map.set(c.time, c);
    }
    const merged = Array.from(map.values())
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_MEMORY_CANDLES);
    this.memoryCandles[timeframe] = merged;
    this.lastWriteMs = Date.now();

    // Persist M1 base bars into TimescaleDB hypertable so Continuous Aggregates (5m..4h) auto-materialize
    if (timeframe !== 'M1' || !this.pool || !this.connected || !this.hypertablesReady) {
      return;
    }

    try {
      const times = candles.map((c) => c.time);
      const opens = candles.map((c) => c.open);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const closes = candles.map((c) => c.close);
      const vols = candles.map((c) => c.volume);

      await this.pool.query(
        `INSERT INTO candles_1m (bucket, symbol, open, high, low, close, volume, source)
         SELECT to_timestamp(t), 'XAUUSD', o, h, l, c, v, $7
         FROM UNNEST($1::bigint[], $2::double precision[], $3::double precision[], $4::double precision[], $5::double precision[], $6::double precision[])
           AS u(t, o, h, l, c, v)
         ON CONFLICT (symbol, bucket) DO UPDATE SET
           high = GREATEST(candles_1m.high, EXCLUDED.high),
           low = LEAST(candles_1m.low, EXCLUDED.low),
           close = EXCLUDED.close,
           volume = GREATEST(candles_1m.volume, EXCLUDED.volume),
           source = EXCLUDED.source`,
        [times, opens, highs, lows, closes, vols, source]
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'TimescaleDB candle upsert failed';
    }
  }

  /**
   * Queries TimescaleDB Continuous Aggregates (when connected & populated), otherwise returns fast memory cache.
   */
  async getCandles(timeframe: Timeframe, limit = 240): Promise<{ candles: Candle[]; fromTimescale: boolean }> {
    const safeLimit = Math.max(20, Math.min(500, Math.floor(limit)));

    if (this.pool && this.connected && this.hypertablesReady) {
      const table = CAGG_TABLE_BY_TF[timeframe];
      try {
        const res = await this.pool.query<{
          time_sec: string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>(
          `SELECT EXTRACT(EPOCH FROM bucket)::bigint AS time_sec, open, high, low, close, volume
           FROM ${table}
           WHERE symbol = 'XAUUSD'
           ORDER BY bucket DESC
           LIMIT $1`,
          [safeLimit]
        );
        if (res.rows.length >= 40) {
          const rows = res.rows
            .map((r) => ({
              time: Number(r.time_sec),
              open: Number(Number(r.open).toFixed(2)),
              high: Number(Number(r.high).toFixed(2)),
              low: Number(Number(r.low).toFixed(2)),
              close: Number(Number(r.close).toFixed(2)),
              volume: Math.round(Number(r.volume)),
            }))
            .reverse();
          return { candles: rows, fromTimescale: true };
        }
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : `TimescaleDB read error (${table})`;
      }
    }

    return {
      candles: this.memoryCandles[timeframe].slice(-safeLimit),
      fromTimescale: false,
    };
  }
}

export const chartStore = new TimescaleChartStore();
