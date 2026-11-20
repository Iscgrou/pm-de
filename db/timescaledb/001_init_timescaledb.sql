-- ============================================================================
-- Payam XAUUSD Institutional Workstation — TimescaleDB (PostgreSQL 16+) Schema
-- Self-Hosted High-Performance Time-Series Storage for Ubuntu Desktop/Laptop
-- ============================================================================
-- Features:
--   1. Hypertable `market_ticks` (1-day chunks, compressed after 3 days, 90d retention)
--   2. Hypertable `candles_1m` (7-day chunks, compressed after 7 days, 2y retention)
--   3. Real-Time Continuous Aggregates: `candles_5m`, `candles_15m`, `candles_30m`,
--      `candles_1h`, `candles_4h` (zero manual resampling drift across timeframes)
--   4. Relational trading, HSM position, closed trade & governance audit tables
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1. Raw Interbank BBO & Basis Tick Stream
CREATE TABLE IF NOT EXISTS market_ticks (
  ts          TIMESTAMPTZ      NOT NULL,
  symbol      TEXT             NOT NULL DEFAULT 'XAUUSD',
  bid         DOUBLE PRECISION NOT NULL,
  ask         DOUBLE PRECISION NOT NULL,
  mid         DOUBLE PRECISION NOT NULL,
  spread      DOUBLE PRECISION NOT NULL,
  paxg_mid    DOUBLE PRECISION,
  basis_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
  source      TEXT             NOT NULL DEFAULT 'Swissquote Interbank BBO'
);

SELECT create_hypertable(
  'market_ticks',
  'ts',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_market_ticks_symbol_ts
  ON market_ticks (symbol, ts DESC);

ALTER TABLE market_ticks SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol',
  timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('market_ticks', INTERVAL '3 days', if_not_exists => TRUE);
SELECT add_retention_policy('market_ticks', INTERVAL '90 days', if_not_exists => TRUE);

-- 2. Base 1-Minute Calibrated OHLCV Hypertable (Single Source of Truth)
CREATE TABLE IF NOT EXISTS candles_1m (
  bucket      TIMESTAMPTZ      NOT NULL,
  symbol      TEXT             NOT NULL DEFAULT 'XAUUSD',
  open        DOUBLE PRECISION NOT NULL,
  high        DOUBLE PRECISION NOT NULL,
  low         DOUBLE PRECISION NOT NULL,
  close       DOUBLE PRECISION NOT NULL,
  volume      DOUBLE PRECISION NOT NULL DEFAULT 0,
  source      TEXT             NOT NULL DEFAULT 'Swissquote + PAXG Calibrated',
  PRIMARY KEY (symbol, bucket)
);

SELECT create_hypertable(
  'candles_1m',
  'bucket',
  chunk_time_interval => INTERVAL '7 days',
  if_not_exists => TRUE
);

ALTER TABLE candles_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol',
  timescaledb.compress_orderby = 'bucket DESC'
);

SELECT add_compression_policy('candles_1m', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('candles_1m', INTERVAL '730 days', if_not_exists => TRUE);

-- 3. Real-Time Continuous Aggregates (M5, M15, M30, H1, H4)
-- `timescaledb.materialized_only = false` blends materialized history with live unmaterialized M1 bars!

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_5m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', bucket) AS bucket,
  symbol,
  first(open, bucket)  AS open,
  max(high)            AS high,
  min(low)             AS low,
  last(close, bucket)  AS close,
  sum(volume)          AS volume
FROM candles_1m
GROUP BY 1, 2
WITH NO DATA;

ALTER MATERIALIZED VIEW candles_5m SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('candles_5m',
  start_offset => INTERVAL '2 hours',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_15m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('15 minutes', bucket) AS bucket,
  symbol,
  first(open, bucket)  AS open,
  max(high)            AS high,
  min(low)             AS low,
  last(close, bucket)  AS close,
  sum(volume)          AS volume
FROM candles_1m
GROUP BY 1, 2
WITH NO DATA;

ALTER MATERIALIZED VIEW candles_15m SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('candles_15m',
  start_offset => INTERVAL '6 hours',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '2 minutes',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_30m
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('30 minutes', bucket) AS bucket,
  symbol,
  first(open, bucket)  AS open,
  max(high)            AS high,
  min(low)             AS low,
  last(close, bucket)  AS close,
  sum(volume)          AS volume
FROM candles_1m
GROUP BY 1, 2
WITH NO DATA;

ALTER MATERIALIZED VIEW candles_30m SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('candles_30m',
  start_offset => INTERVAL '12 hours',
  end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_1h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', bucket) AS bucket,
  symbol,
  first(open, bucket)  AS open,
  max(high)            AS high,
  min(low)             AS low,
  last(close, bucket)  AS close,
  sum(volume)          AS volume
FROM candles_1m
GROUP BY 1, 2
WITH NO DATA;

ALTER MATERIALIZED VIEW candles_1h SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('candles_1h',
  start_offset => INTERVAL '2 days',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS candles_4h
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('4 hours', bucket) AS bucket,
  symbol,
  first(open, bucket)  AS open,
  max(high)            AS high,
  min(low)             AS low,
  last(close, bucket)  AS close,
  sum(volume)          AS volume
FROM candles_1m
GROUP BY 1, 2
WITH NO DATA;

ALTER MATERIALIZED VIEW candles_4h SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('candles_4h',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '15 minutes',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => TRUE
);

-- 4. Relational Institutional Trading & Governance Tables
CREATE TABLE IF NOT EXISTS trade_positions (
  id                TEXT PRIMARY KEY,
  order_id          TEXT             NOT NULL,
  direction         TEXT             NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  timeframe         TEXT             NOT NULL,
  status            TEXT             NOT NULL,
  stage             TEXT             NOT NULL,
  entry_price       DOUBLE PRECISION NOT NULL,
  initial_sl        DOUBLE PRECISION NOT NULL,
  stop_loss         DOUBLE PRECISION NOT NULL,
  tp1               DOUBLE PRECISION NOT NULL,
  tp2               DOUBLE PRECISION NOT NULL,
  lot_size          DOUBLE PRECISION NOT NULL,
  unrealized_pnl    DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized_pnl      DOUBLE PRECISION NOT NULL DEFAULT 0,
  opened_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  metadata_json     JSONB            NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS closed_trades (
  id                TEXT PRIMARY KEY,
  order_id          TEXT             NOT NULL,
  direction         TEXT             NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  timeframe         TEXT             NOT NULL,
  lot_size          DOUBLE PRECISION NOT NULL,
  entry_price       DOUBLE PRECISION NOT NULL,
  exit_price        DOUBLE PRECISION NOT NULL,
  exit_reason       TEXT             NOT NULL,
  net_pnl           DOUBLE PRECISION NOT NULL,
  r_multiple        DOUBLE PRECISION NOT NULL,
  opened_at         TIMESTAMPTZ      NOT NULL,
  closed_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id                TEXT PRIMARY KEY,
  ts                TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  category          TEXT             NOT NULL,
  severity          TEXT             NOT NULL,
  title             TEXT             NOT NULL,
  detail            TEXT             NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_ts ON agent_audit_log (ts DESC);
