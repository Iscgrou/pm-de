-- XAUUSD Institutional Trading System — 10-Table Time-Series WAL Schema
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -64000;
PRAGMA busy_timeout = 5000;

-- 1. Clustered WITHOUT ROWID candles table (<8ms for 2,000 candle reads)
CREATE TABLE IF NOT EXISTS candles (
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    open_time_ms INTEGER NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL DEFAULT 0.0,
    closed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, timeframe, open_time_ms)
) WITHOUT ROWID;

-- 2. 7-State Signal Lifecycle table
CREATE TABLE IF NOT EXISTS trade_signals (
    signal_id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL DEFAULT 'XAUUSD',
    direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
    state TEXT NOT NULL CHECK(state IN (
        'DETECTED', 'PENDING_ENTRY', 'OPEN', 'BREAK_EVEN_ARMED',
        'RISK_FREE_TP1', 'CLOSED_TP2', 'EXPIRED_OR_VETOED'
    )),
    entry_price REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    rr_ratio REAL NOT NULL CHECK(rr_ratio >= 1.50),
    lot_size REAL NOT NULL DEFAULT 0.10,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

-- 3. Active & Historical Positions
CREATE TABLE IF NOT EXISTS positions (
    position_id TEXT PRIMARY KEY,
    signal_id TEXT,
    direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
    entry_price REAL NOT NULL,
    current_sl REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    lot_size REAL NOT NULL,
    hsm_state TEXT NOT NULL,
    unrealized_pnl REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL CHECK(status IN ('OPEN', 'CLOSED')),
    opened_at_ms INTEGER NOT NULL,
    closed_at_ms INTEGER
);

-- 4. System 2 Pending Intelligence Jobs Queue (SQLite WAL backed)
CREATE TABLE IF NOT EXISTS pending_intelligence_jobs (
    job_id TEXT PRIMARY KEY,
    trigger_reason TEXT NOT NULL,
    fact_ledger_json TEXT NOT NULL,
    allowed_numbers_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'CLAIMED', 'COMPLETED', 'EXPIRED')),
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
);

-- 5. System 2 Advisories (Anti-Hallucination Validated)
CREATE TABLE IF NOT EXISTS advisories (
    advisory_id TEXT PRIMARY KEY,
    job_id TEXT,
    verdict TEXT NOT NULL CHECK(verdict IN ('HOLD', 'SCALE', 'PROTECT', 'EXIT', 'VETO')),
    confidence REAL NOT NULL,
    rationale_en TEXT NOT NULL,
    rationale_fa TEXT NOT NULL,
    hallucination_checked INTEGER NOT NULL DEFAULT 1,
    created_at_ms INTEGER NOT NULL
);

-- 6. Macroeconomic News Calendar Events (ForexFactory USD)
CREATE TABLE IF NOT EXISTS news_events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    impact TEXT NOT NULL CHECK(impact IN ('HIGH', 'MEDIUM', 'LOW')),
    scheduled_at_ms INTEGER NOT NULL,
    gate_state TEXT NOT NULL CHECK(gate_state IN ('CLEAR', 'CAUTION', 'LOCKOUT'))
);

-- 7. Data Pipeline Tier Failover & Tripwire Audit Log
CREATE TABLE IF NOT EXISTS tier_failover_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_tier INTEGER NOT NULL,
    to_tier INTEGER NOT NULL,
    reason TEXT NOT NULL,
    elapsed_ms REAL NOT NULL,
    created_at_ms INTEGER NOT NULL
);

-- 8. HSM State Machine Transitions
CREATE TABLE IF NOT EXISTS hsm_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    trigger_price REAL NOT NULL,
    created_at_ms INTEGER NOT NULL
);

-- 9. Agentic Episodic Memory
CREATE TABLE IF NOT EXISTS episodic_memory (
    episode_id TEXT PRIMARY KEY,
    regime TEXT NOT NULL,
    setup_summary TEXT NOT NULL,
    outcome_r REAL NOT NULL,
    lesson TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL
);

-- 10. System Runtime Metadata & Monotonic WS Sequence State
CREATE TABLE IF NOT EXISTS system_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
);

-- 11. Autonomous Agentic Signal Proposals & Broker Confirmation Audit
CREATE TABLE IF NOT EXISTS agent_proposals (
    proposal_id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
    setup_type TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    entry_price REAL NOT NULL,
    stop_loss REAL NOT NULL,
    tp1 REAL NOT NULL,
    tp2 REAL NOT NULL,
    rr_ratio REAL NOT NULL CHECK(rr_ratio >= 1.50),
    confidence REAL NOT NULL,
    rationale_en TEXT NOT NULL,
    rationale_fa TEXT NOT NULL,
    engine_source TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PROPOSED', 'CONFIRMED', 'DISMISSED', 'EXPIRED')),
    created_at_ms INTEGER NOT NULL,
    confirmed_at_ms INTEGER
);

