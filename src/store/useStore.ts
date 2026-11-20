import { create } from 'zustand';
import {
  analyzeQuantSnapshot,
  buildSystem2Advisory,
  evaluateBasisDivergence,
  evaluateConfirmedPositionAdvice,
  evaluateNewsGate,
  generateQuantProposal,
  inspectSymbolTripwire,
  run18GateAudit,
  stepHsmPosition,
  TIMEFRAME_SECONDS,
  validateToxicSpike,
  validateTradeGuardrails,
} from '../engine/smcQuant';
import {
  calculateRequiredMargin,
  createInitialSimAccount,
  derivePositionCoPilotDirective,
  executePartialClose,
  modifyPositionLevels,
  reconcileSimAccount,
  simulateOpenTrade,
  stepSimulatedPositions,
} from '../engine/tradeSimulator';
import {
  appendSessionEquityPoint,
  createInitialEquityHistory,
} from '../engine/sessionRisk';
import {
  DEFAULT_AGENT_CONFIG,
  createAuditEntry,
  evaluateRiskCircuitBreakers,
  sanitizeAgentConfig,
} from '../engine/agentGovernance';
import { buildInitialNewsIntelligence } from '../engine/newsIntelligence';
import { normalizeAdvisory, normalizeCandle, normalizeNews, normalizePosition, normalizeTick } from '../engine/normalizers';
import type {
  Advisory,
  AgentAuditEntry,
  AgentConfig,
  AgentEngineMode,
  AgentProposal,
  AiTelemetryState,
  BasisDivergence,
  Candle,
  CircuitBreakerSnapshot,
  ClosedTradeRecord,
  ConfirmedPosition,
  FeedConnectionMode,
  GateAuditResult,
  LiveNewsIntelligence,
  NewsEvent,
  NewsGateStatus,
  OrderExecutionType,
  PendingLimitOrder,
  PipelineStatus,
  Position,
  PositionCoPilotDirective,
  ProposalLifecycleStatus,
  QuantSnapshot,
  SessionEquityPoint,
  SimAccountState,
  Tick,
  Timeframe,
} from '../engine/types';

export interface SmcLayerVisibility {
  fvg: boolean;
  ob: boolean;
  structure: boolean;
  liquidity: boolean;
  tether: boolean;
  ote: boolean;
  rsi: boolean;
}

const AGENT_CONFIG_STORAGE_KEY = 'payam_agent_config_v1';

function loadPersistedAgentConfig(): AgentConfig {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(AGENT_CONFIG_STORAGE_KEY);
      if (raw) {
        return sanitizeAgentConfig(JSON.parse(raw), DEFAULT_AGENT_CONFIG);
      }
    }
  } catch {
    // Fallback to institutional defaults
  }
  return { ...DEFAULT_AGENT_CONFIG };
}

function savePersistedAgentConfig(cfg: AgentConfig): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(AGENT_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
    }
  } catch {
    // Storage quota or sandbox restricted
  }
}

const AGENT_TOOLS = [
  'h4_macro_compass',
  'h1_liquidity_sweep',
  'ob_quality_displacement',
  'fvg_golden_overlap',
  'wilder_rsi14_divergence',
  'core_14src_news_wire',
  'risk_7_circuit_breakers',
  'anti_chase_7gate_shield',
  'validate_rr_guardrails',
];

interface AurumStore {
  activeTab: 'deck' | 'audit' | 'deb';
  timeframe: Timeframe;
  streaming: boolean;
  vectorModalOpen: boolean;
  candlesByTf: Record<Timeframe, Candle[]>;
  tick: Tick;
  feedMode: FeedConnectionMode;
  ticksPerMinute: number;
  tickTimestampsMs: number[];
  basisDivergence: BasisDivergence;
  quant: QuantSnapshot;
  position: Position | null;
  pendingLimits: PendingLimitOrder[];
  newsEvents: NewsEvent[];
  newsGate: NewsGateStatus;
  advisory: Advisory;
  pipeline: PipelineStatus;
  layers: SmcLayerVisibility;
  auditResults: GateAuditResult[];
  lastGuardrailErrors: string[];
  statusBanner: string | null;

  // Phase 2 & 3: Payam Autonomous Agentic Engine & Manual-Broker Position Guardian
  agentEnabled: boolean;
  agentMode: AgentEngineMode;
  agentBusy: boolean;
  agentError: string | null;
  agentScanCount: number;
  lastAgentScanMs: number | null;
  activeTools: string[];
  proposals: AgentProposal[];
  confirmedPositions: ConfirmedPosition[];
  closedTrades: ClosedTradeRecord[];
  closedConfirmedCount: number;
  focusedPositionId: string | null;
  simAccount: SimAccountState;
  sessionEquityHistory: SessionEquityPoint[];

  // Squad 3 / Squad 4 Shared AI Sub-Agent Telemetry
  aiTelemetry: AiTelemetryState;

  // Phase 4: Atomic Agent Governance, Risk Circuit Breakers, 14-Source Live News & Audit Log
  agentConfig: AgentConfig;
  circuitBreakers: CircuitBreakerSnapshot;
  liveNewsIntel: LiveNewsIntelligence;
  newsRefreshing: boolean;
  manualNewsScenario: boolean;
  controlCenterOpen: boolean;
  cooldownBypassAfterMs: number | null;
  agentAuditLog: AgentAuditEntry[];

  // Real Online Calibrated Candle Pipeline & TimescaleDB Storage Metadata
  candleSourceMeta: {
    source: string;
    rawFeed: string;
    calibratedToSpot: boolean;
    basisOffsetUsd: number;
    storageBackend: 'timescaledb' | 'memory';
    liveHistorical: boolean;
    lastSyncedMs: number | null;
    hydrating: boolean;
  };

  setActiveTab: (tab: 'deck' | 'audit' | 'deb') => void;
  setTimeframe: (tf: Timeframe) => void;
  toggleStreaming: () => void;
  setVectorModalOpen: (open: boolean) => void;
  setControlCenterOpen: (open: boolean) => void;
  toggleLayer: (layer: keyof SmcLayerVisibility) => void;
  setFeedConnectionState: (mode: FeedConnectionMode, note?: string) => void;
  ingestSsePayload: (payload: Record<string, unknown>) => void;
  applyTickUpdate: (rawTick?: Partial<Tick>, paxgRefPrice?: number) => void;
  hydrateRealCandles: (force?: boolean) => Promise<void>;
  pollLiveMarket: () => Promise<void>;
  pollLiveNews: (force?: boolean) => Promise<void>;

  // Governance & Safety Actions
  toggleKillSwitch: () => void;
  updateAgentConfig: (partial: Partial<AgentConfig>) => void;
  resetAgentConfig: () => void;
  resetLossCooldown: () => void;

  // Autonomous Agentic Model & Manual-Broker Guardian Actions
  toggleAgentEnabled: () => void;
  setAgentMode: (mode: AgentEngineMode) => void;
  runAgentScanCycle: (opts?: { quantOnly?: boolean }) => Promise<void>;
  monitorOpenPositions: () => Promise<void>;
  applyPositionDirective: (positionId: string) => void;
  markLimitFilledInBroker: (positionId: string, actualFillPrice?: number) => void;
  confirmProposal: (
    proposalId: string,
    optionsOrLot?:
      | number
      | {
          lotSize?: number;
          executionType?: OrderExecutionType;
          actualFillPrice?: number;
          trailingStopDistance?: number | null;
        }
  ) => { ok: boolean; errors: string[]; positionId?: string };
  dismissProposal: (proposalId: string) => void;
  partialClosePosition: (positionId: string, fraction: number) => void;
  closeConfirmedPosition: (positionId: string) => void;
  modifyConfirmedPosition: (
    positionId: string,
    updates: {
      stopLoss?: number;
      tp1?: number;
      tp2?: number;
      trailingStopDistance?: number | null;
    }
  ) => { ok: boolean; error?: string };
  toggleTrailingStop: (positionId: string) => void;
  focusPosition: (positionId: string | null) => void;
  moveConfirmedPositionBreakEven: (positionId: string) => void;
  simulateConfirmedPositionStep: (
    positionId: string,
    target: 'HALF_TP1' | 'TP1' | 'TP2' | 'SL' | 'FILL_LIMIT'
  ) => void;
  simulateMarketShock: (deltaUsd: number) => void;
  resetSimAccount: (initialBalance?: number) => void;

  // Manual Guardrail Ticket Actions
  openPosition: (input: {
    direction: 'LONG' | 'SHORT';
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    lotSize: number;
  }) => { ok: boolean; errors: string[] };
  placePendingLimit: (input: {
    direction: 'LONG' | 'SHORT';
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    lotSize: number;
  }) => { ok: boolean; errors: string[] };
  closePosition: () => void;
  movePositionBreakEven: () => void;
  simulatePositionStep: (target: 'HALF_TP1' | 'TP1' | 'TP2') => void;
  setNewsScenario: (mode: 'CLEAR' | 'CAUTION' | 'LOCKOUT') => void;
  triggerTripwireTest: (symbol: string) => void;
  triggerToxicSpikeTest: () => void;
  restoreTier1: () => void;
  runSystem2Reasoning: (reason?: string) => void;
  run18GateVerification: () => void;
  clearBanner: () => void;
}

export function getDefaultTtlBars(tf: Timeframe): number {
  switch (tf) {
    case 'M1':
      return 12;
    case 'M5':
      return 6;
    case 'M15':
      return 6;
    case 'M30':
      return 4;
    case 'H1':
      return 4;
    case 'H4':
      return 3;
  }
}

export function enrichProposalLifecycle(
  proposal: AgentProposal,
  candlesByTf: Record<Timeframe, Candle[]>,
  spot: number,
  spread: number,
  nowMs = Date.now()
): AgentProposal {
  const tfSeries = candlesByTf[proposal.timeframe] ?? [];
  const latestBarTime = tfSeries.length > 0 ? tfSeries[tfSeries.length - 1].time : Math.floor(nowMs / 1000);
  const ttlBars = proposal.ttlBarsRemaining ?? getDefaultTtlBars(proposal.timeframe);
  const expiresAtTime =
    proposal.expiresAtTime ?? nowMs + ttlBars * TIMEFRAME_SECONDS[proposal.timeframe] * 1000;
  const distFromSpot = Number.isFinite(spot) && spot > 0 ? Math.abs(proposal.entry - spot) : 0;
  const orderType: 'LIMIT' | 'MARKET' =
    proposal.orderType ?? (distFromSpot > Math.max(0.4, spread * 1.5) ? 'LIMIT' : 'MARKET');
  const zoneHalf = Number(Math.max(0.4, Math.min(2.2, Math.abs(proposal.entry - proposal.stopLoss) * 0.16)).toFixed(2));
  const sniperZone = proposal.sniperZone ?? {
    low: Number((proposal.entry - zoneHalf).toFixed(2)),
    high: Number((proposal.entry + zoneHalf).toFixed(2)),
    sweetSpot: Number(proposal.entry.toFixed(2)),
  };
  return {
    ...proposal,
    orderType,
    sniperZone,
    invalidationPrice: proposal.invalidationPrice ?? proposal.stopLoss,
    ttlBarsRemaining: ttlBars,
    expiresAtTime,
    proposalLifecycleStatus: proposal.proposalLifecycleStatus ?? 'ACTIVE',
    lastBarTimeSeen: proposal.lastBarTimeSeen ?? latestBarTime,
  };
}

/**
 * Deterministic Signal TTL & Pre-Fill Invalidation Engine:
 * - Decrements ttlBarsRemaining strictly on each new candle close of proposal.timeframe
 * - Auto-expires when ttlBarsRemaining <= 0 or Date.now() > expiresAtTime ('EXPIRED_TTL')
 * - Cancels LIMIT proposals if live spot reaches TP1 before ever filling ('CANCELLED_FRONT_RUN')
 * - Invalidates unconfirmed proposals if live spot breaches stopLoss / invalidationPrice ('INVALIDATED_STRUCTURE')
 */
export function evaluateProposalLifecycles(
  proposals: AgentProposal[],
  candlesByTf: Record<Timeframe, Candle[]>,
  spot: number,
  bid: number,
  ask: number,
  nowMs = Date.now()
): { proposals: AgentProposal[]; events: string[]; changed: boolean } {
  if (!Number.isFinite(spot) || spot <= 0 || proposals.length === 0) {
    return { proposals, events: [], changed: false };
  }

  let changed = false;
  const events: string[] = [];

  const nextProposals = proposals.map((p) => {
    const lifecycle = p.proposalLifecycleStatus ?? 'ACTIVE';
    if (p.status !== 'PROPOSED' || lifecycle !== 'ACTIVE') {
      return p;
    }

    const isLong = p.direction === 'LONG';
    const tfSeries = candlesByTf[p.timeframe] ?? [];
    const latestBarTime = tfSeries.length > 0 ? tfSeries[tfSeries.length - 1].time : undefined;
    let nextTtl = p.ttlBarsRemaining ?? getDefaultTtlBars(p.timeframe);
    let nextBarSeen = p.lastBarTimeSeen;
    let mutated = false;

    if (latestBarTime !== undefined) {
      if (nextBarSeen === undefined) {
        nextBarSeen = latestBarTime;
        mutated = true;
      } else if (latestBarTime > nextBarSeen) {
        const stepSec = Math.max(60, TIMEFRAME_SECONDS[p.timeframe]);
        const barsClosed = Math.max(1, Math.floor((latestBarTime - nextBarSeen) / stepSec));
        nextTtl = Math.max(0, nextTtl - barsClosed);
        nextBarSeen = latestBarTime;
        mutated = true;
      }
    }

    const invalidation = p.invalidationPrice ?? p.stopLoss;
    const structureBreached = isLong
      ? spot <= invalidation || bid <= invalidation
      : spot >= invalidation || ask >= invalidation;

    if (structureBreached) {
      changed = true;
      events.push(
        `Proposal invalidated (${p.direction} ${p.timeframe}): spot breached invalidation $${invalidation.toFixed(2)} before fill.`
      );
      return {
        ...p,
        ttlBarsRemaining: nextTtl,
        lastBarTimeSeen: nextBarSeen,
        proposalLifecycleStatus: 'INVALIDATED_STRUCTURE' as ProposalLifecycleStatus,
      };
    }

    // Front-Run Protection for LIMIT orders: TP1 reached before entry zone fill
    if ((p.orderType ?? 'LIMIT') === 'LIMIT') {
      const targetHitBeforeFill = isLong
        ? spot >= p.tp1 || bid >= p.tp1
        : spot <= p.tp1 || ask <= p.tp1;
      if (targetHitBeforeFill) {
        changed = true;
        events.push(
          `Front-Run cancelled (${p.direction} ${p.timeframe}): Target $${p.tp1.toFixed(2)} hit before fill — Do NOT enter late!`
        );
        return {
          ...p,
          ttlBarsRemaining: nextTtl,
          lastBarTimeSeen: nextBarSeen,
          proposalLifecycleStatus: 'CANCELLED_FRONT_RUN' as ProposalLifecycleStatus,
        };
      }
    }

    // Candle-age / wall-clock TTL expiration
    const expired = nextTtl <= 0 || (p.expiresAtTime !== undefined && nowMs > p.expiresAtTime);
    if (expired) {
      changed = true;
      events.push(
        `Proposal expired (TTL ${p.timeframe}): ${p.direction} ${p.setupType} timed out before broker execution.`
      );
      return {
        ...p,
        ttlBarsRemaining: 0,
        lastBarTimeSeen: nextBarSeen,
        proposalLifecycleStatus: 'EXPIRED_TTL' as ProposalLifecycleStatus,
      };
    }

    if (mutated) {
      changed = true;
      return {
        ...p,
        ttlBarsRemaining: nextTtl,
        lastBarTimeSeen: nextBarSeen,
      };
    }
    return p;
  });

  return { proposals: changed ? nextProposals : proposals, events, changed };
}

function buildEmptyCandles(): Record<Timeframe, Candle[]> {
  return {
    M1: [],
    M5: [],
    M15: [],
    M30: [],
    H1: [],
    H4: [],
  };
}

function buildDefaultNews(mode: 'CLEAR' | 'CAUTION' | 'LOCKOUT' = 'CLEAR'): NewsEvent[] {
  const now = Date.now();
  const min = 60_000;
  if (mode === 'LOCKOUT') {
    return [
      normalizeNews({
        id: 'ev-cpi',
        title: 'US Core CPI (MoM)',
        currency: 'USD',
        impact: 'HIGH',
        scheduledAtMs: now + 6 * min,
        forecast: '0.3%',
        previous: '0.3%',
      }),
      normalizeNews({
        id: 'ev-claims',
        title: 'US Initial Jobless Claims',
        currency: 'USD',
        impact: 'MEDIUM',
        scheduledAtMs: now + 65 * min,
        forecast: '215K',
        previous: '218K',
      }),
      normalizeNews({
        id: 'ev-fomc',
        title: 'FOMC Rate Statement',
        currency: 'USD',
        impact: 'HIGH',
        scheduledAtMs: now + 240 * min,
        forecast: '4.50%',
        previous: '4.50%',
      }),
    ];
  }
  if (mode === 'CAUTION') {
    return [
      normalizeNews({
        id: 'ev-claims',
        title: 'US Initial Jobless Claims',
        currency: 'USD',
        impact: 'MEDIUM',
        scheduledAtMs: now + 3 * min,
        forecast: '215K',
        previous: '218K',
      }),
      normalizeNews({
        id: 'ev-cpi',
        title: 'US Core CPI (MoM)',
        currency: 'USD',
        impact: 'HIGH',
        scheduledAtMs: now + 110 * min,
        forecast: '0.3%',
        previous: '0.3%',
      }),
      normalizeNews({
        id: 'ev-pce',
        title: 'US Core PCE Price Index',
        currency: 'USD',
        impact: 'HIGH',
        scheduledAtMs: now + 300 * min,
        forecast: '0.2%',
        previous: '0.3%',
      }),
    ];
  }
  return [];
}

const initialCandles = buildEmptyCandles();
const initialNews = buildDefaultNews('CLEAR');
const initialNewsGate = evaluateNewsGate(initialNews);
const initialTick: Tick = {
  symbol: 'XAUUSD',
  last: 0,
  bid: 0,
  ask: 0,
  spread: 0,
  timestampMs: Date.now(),
  tier: 1,
  source: 'Connecting to Interbank Feed...',
  seq: 0,
};
const initialBasis = evaluateBasisDivergence(0, 0);
const initialQuant = analyzeQuantSnapshot('M15', initialCandles, {
  newsGate: initialNewsGate,
  basis: initialBasis,
  spread: 0,
});
const initialAdvisory = buildSystem2Advisory(
  'CONNECTING_LIVE_FEED',
  0,
  0,
  initialQuant,
  initialNewsGate,
  null
);
const initialAccount = createInitialSimAccount(25000, 100, 7.0);
const initialNow = Date.now();
const initialEquityHistory = createInitialEquityHistory(
  initialAccount.initialBalance,
  initialAccount.equity,
  initialNow,
  initialNow
);
const initialAgentConfig = loadPersistedAgentConfig();
const initialLiveNewsIntel = buildInitialNewsIntelligence(initialNews);
const initialCircuitBreakers = evaluateRiskCircuitBreakers({
  config: initialAgentConfig,
  simAccount: initialAccount,
  confirmedPositions: [],
  closedTrades: [],
  spread: 0,
  newsGate: initialNewsGate,
  liveNews: initialLiveNewsIntel,
});
const initialAuditLog: AgentAuditEntry[] = [
  createAuditEntry(
    'CONFIG',
    'INFO',
    'Payam Institutional Governance Booted (Zero-Mock Mode)',
    `Awaiting live interbank XAU/USD stream · 7 Risk Circuit Breakers armed · Min Score ${initialAgentConfig.minConfluenceScore}/100 · Max DD ${initialAgentConfig.maxDailyDrawdownPct.toFixed(1)}%.`
  ),
];
const initialAiTelemetry: AiTelemetryState = {
  activeStage: 0,
  subAgents: {
    smc_quant: { status: 'IDLE' },
    macro_news: { status: 'IDLE' },
    red_team: { status: 'IDLE' },
    execution_architect: { status: 'IDLE' },
    position_guardian: { status: 'IDLE' },
  },
  latestThinkingTrace: undefined,
};

export const useAurumStore = create<AurumStore>((set, get) => ({
  activeTab: 'deck',
  timeframe: 'M15',
  streaming: true,
  vectorModalOpen: false,
  candlesByTf: initialCandles,
  tick: initialTick,
  feedMode: 'CONNECTING',
  ticksPerMinute: 0,
  tickTimestampsMs: [],
  basisDivergence: initialBasis,
  quant: initialQuant,
  position: null,
  pendingLimits: [],
  newsEvents: initialNews,
  newsGate: initialNewsGate,
  advisory: initialAdvisory,
  pipeline: {
    activeTier: 1,
    sourceName: 'Connecting to Interbank Feed...',
    ttlMs: 0,
    loopLagP99Ms: 0,
    failoverCount: 0,
    tripwireCount: 0,
    rejectedSpikes: 0,
    wsSequenceId: 0,
    lastEventNote: 'Connecting to live Swissquote Interbank BBO / SSE market stream...',
  },
  layers: {
    fvg: true,
    ob: true,
    structure: true,
    liquidity: true,
    tether: true,
    ote: true,
    rsi: true,
  },
  auditResults: run18GateAudit(initialCandles),
  lastGuardrailErrors: [],
  statusBanner: null,

  agentEnabled: false,
  agentMode: 'HYBRID',
  agentBusy: false,
  agentError: null,
  agentScanCount: 0,
  lastAgentScanMs: null,
  activeTools: AGENT_TOOLS,
  proposals: [],
  confirmedPositions: [],
  closedTrades: [],
  closedConfirmedCount: 0,
  focusedPositionId: null,
  simAccount: initialAccount,
  sessionEquityHistory: initialEquityHistory,

  aiTelemetry: initialAiTelemetry,

  agentConfig: initialAgentConfig,
  circuitBreakers: initialCircuitBreakers,
  liveNewsIntel: initialLiveNewsIntel,
  newsRefreshing: false,
  manualNewsScenario: false,
  controlCenterOpen: false,
  cooldownBypassAfterMs: null,
  agentAuditLog: initialAuditLog,
  candleSourceMeta: {
    source: 'Connecting to Live Feed...',
    rawFeed: 'NONE',
    calibratedToSpot: false,
    basisOffsetUsd: 0,
    storageBackend: 'memory',
    liveHistorical: false,
    lastSyncedMs: null,
    hydrating: false,
  },

  setActiveTab: (activeTab) => set({ activeTab }),

  setTimeframe: (timeframe) => {
    const { candlesByTf, newsGate, basisDivergence, tick, agentConfig, liveNewsIntel } = get();
    set({
      timeframe,
      quant: analyzeQuantSnapshot(timeframe, candlesByTf, {
        newsGate,
        basis: basisDivergence,
        spread: tick.spread,
        agentConfig,
        newsShock: { detected: liveNewsIntel.shockDetected, headline: liveNewsIntel.shockHeadline },
      }),
    });
  },

  toggleStreaming: () => set((s) => ({ streaming: !s.streaming })),
  setVectorModalOpen: (vectorModalOpen) => set({ vectorModalOpen }),
  setControlCenterOpen: (controlCenterOpen) => set({ controlCenterOpen }),
  toggleLayer: (layer) =>
    set((s) => ({
      layers: { ...s.layers, [layer]: !s.layers[layer] },
    })),

  pollLiveNews: async (force = false) => {
    const state = get();
    if (!state.agentConfig.enableLiveNewsFeeds && !force) return;
    set({ newsRefreshing: true });
    try {
      const res = await fetch(`/api/news/live${force ? '?force=1' : ''}`);
      if (!res.ok) {
        set({ newsRefreshing: false });
        return;
      }
      const data = await res.json();
      if (!data?.ok) {
        set({ newsRefreshing: false });
        return;
      }

      const cur = get();
      const intel: LiveNewsIntelligence = {
        fetchedAtMs: data.fetchedAtMs ?? Date.now(),
        liveSourceCount: data.liveSourceCount ?? 0,
        totalSourceCount: data.totalSourceCount ?? 14,
        calendarSource: data.calendarSource ?? 'LOCAL_SCHEDULE',
        macroSentiment: data.macroSentiment ?? 'NEUTRAL',
        sentimentScore: data.sentimentScore ?? 0,
        shockDetected: Boolean(data.shockDetected),
        shockHeadline: data.shockHeadline ?? null,
        headlines: Array.isArray(data.headlines) ? data.headlines : [],
        sources: Array.isArray(data.sources) ? data.sources : cur.liveNewsIntel.sources,
        calendarEvents: Array.isArray(data.calendarEvents) ? data.calendarEvents : [],
      };

      // Use live ForexFactory USD calendar events if available and user hasn't forced a synthetic test scenario
      const nextEvents =
        !cur.manualNewsScenario && intel.calendarEvents.length > 0 ? intel.calendarEvents : cur.newsEvents;
      const nextGate = evaluateNewsGate(nextEvents, Date.now(), {
        highPreMin: cur.agentConfig.newsHighImpactPreMin,
        highPostMin: cur.agentConfig.newsHighImpactPostMin,
      });
      const nextQuant = analyzeQuantSnapshot(cur.timeframe, cur.candlesByTf, {
        newsGate: nextGate,
        basis: cur.basisDivergence,
        spread: cur.tick.spread,
        agentConfig: cur.agentConfig,
        newsShock: { detected: intel.shockDetected, headline: intel.shockHeadline },
      });
      const nextBreakers = evaluateRiskCircuitBreakers({
        config: cur.agentConfig,
        simAccount: cur.simAccount,
        confirmedPositions: cur.confirmedPositions,
        closedTrades: cur.closedTrades,
        spread: cur.tick.spread,
        newsGate: nextGate,
        liveNews: intel,
        cooldownBypassAfterMs: cur.cooldownBypassAfterMs,
      });

      const nextAudit = intel.shockDetected
        ? [
            createAuditEntry(
              'NEWS_SHOCK',
              'CRITICAL',
              'Emergency Breaking News Shock Veto',
              intel.shockHeadline || 'High-impact breaking geopolitical or central bank shock detected.'
            ),
            ...cur.agentAuditLog,
          ].slice(0, 40)
        : cur.agentAuditLog;

      set({
        liveNewsIntel: intel,
        newsEvents: nextEvents,
        newsGate: nextGate,
        quant: nextQuant,
        circuitBreakers: nextBreakers,
        newsRefreshing: false,
        agentAuditLog: nextAudit,
        statusBanner: force
          ? `Core News Hub synced: ${intel.liveSourceCount}/${intel.totalSourceCount} feeds live · ${intel.headlines.length} Gold headlines · Sentiment ${intel.macroSentiment.replace('_', ' ')}`
          : cur.statusBanner,
      });
    } catch {
      set({ newsRefreshing: false });
    }
  },

  toggleKillSwitch: () => {
    const state = get();
    const nextEngaged = !state.agentConfig.killSwitchEngaged;
    const nextConfig: AgentConfig = { ...state.agentConfig, killSwitchEngaged: nextEngaged };
    savePersistedAgentConfig(nextConfig);

    // When Kill Switch engages: immediately pause autonomous scans and cancel resting pending limit orders
    const nextPendingLimits = nextEngaged
      ? state.pendingLimits.map((o) =>
          o.status === 'PENDING_ENTRY' ? { ...o, status: 'EXPIRED_OR_VETOED' as const } : o
        )
      : state.pendingLimits;

    const cancelledResting = nextEngaged
      ? state.confirmedPositions.filter((p) => p.status === 'PENDING_LIMIT').length
      : 0;
    const nextConfirmed = nextEngaged
      ? state.confirmedPositions.filter((p) => p.status !== 'PENDING_LIMIT')
      : state.confirmedPositions;

    const nextBreakers = evaluateRiskCircuitBreakers({
      config: nextConfig,
      simAccount: state.simAccount,
      confirmedPositions: nextConfirmed,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });

    const entry = createAuditEntry(
      'KILL_SWITCH',
      nextEngaged ? 'CRITICAL' : 'INFO',
      nextEngaged ? 'EMERGENCY KILL SWITCH ENGAGED' : 'Emergency Kill Switch Disarmed',
      nextEngaged
        ? `Autonomous scanning halted; ${cancelledResting} pending limit order(s) purged; all new entries hard-locked.`
        : 'Kill switch disarmed by operator. Standard 7-breaker governance restored.'
    );

    set({
      agentConfig: nextConfig,
      agentEnabled: nextEngaged ? false : state.agentEnabled,
      pendingLimits: nextPendingLimits,
      confirmedPositions: nextConfirmed,
      circuitBreakers: nextBreakers,
      agentAuditLog: [entry, ...state.agentAuditLog].slice(0, 40),
      statusBanner: nextEngaged
        ? 'EMERGENCY KILL SWITCH ENGAGED — Payam agent halted & all new entries hard-blocked'
        : 'Emergency Kill Switch DISARMED — standard institutional governance restored',
    });
  },

  updateAgentConfig: (partial) => {
    const state = get();
    const nextConfig = sanitizeAgentConfig(partial, state.agentConfig);
    savePersistedAgentConfig(nextConfig);

    const nextGate = evaluateNewsGate(state.newsEvents, Date.now(), {
      highPreMin: nextConfig.newsHighImpactPreMin,
      highPostMin: nextConfig.newsHighImpactPostMin,
    });
    const nextQuant = analyzeQuantSnapshot(state.timeframe, state.candlesByTf, {
      newsGate: nextGate,
      basis: state.basisDivergence,
      spread: state.tick.spread,
      agentConfig: nextConfig,
      newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
    });
    const nextBreakers = evaluateRiskCircuitBreakers({
      config: nextConfig,
      simAccount: state.simAccount,
      confirmedPositions: state.confirmedPositions,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: nextGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });

    const changedKeys = Object.keys(partial).join(', ');
    const entry = createAuditEntry(
      'CONFIG',
      'INFO',
      `Agent Constitution Updated (${changedKeys})`,
      `Min Score ${nextConfig.minConfluenceScore} · Min R:R ${nextConfig.minRrRatio.toFixed(2)} · Max DD ${nextConfig.maxDailyDrawdownPct.toFixed(1)}% · Max Heat ${nextConfig.maxPortfolioHeatPct.toFixed(1)}%`
    );

    set({
      agentConfig: nextConfig,
      newsGate: nextGate,
      quant: nextQuant,
      circuitBreakers: nextBreakers,
      agentAuditLog: [entry, ...state.agentAuditLog].slice(0, 40),
    });
  },

  resetAgentConfig: () => {
    get().updateAgentConfig({ ...DEFAULT_AGENT_CONFIG });
    set({ statusBanner: 'Agent Constitution restored to Institutional Defaults' });
  },

  resetLossCooldown: () => {
    const state = get();
    const now = Date.now();
    const nextBreakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: state.simAccount,
      confirmedPositions: state.confirmedPositions,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: now,
      nowMs: now,
    });
    set({
      cooldownBypassAfterMs: now,
      circuitBreakers: nextBreakers,
      agentAuditLog: [
        createAuditEntry('CIRCUIT_BREAKER', 'WARN', 'Loss Streak Cooldown Acknowledged & Reset', 'Operator manually cleared consecutive-loss cooldown timer.'),
        ...state.agentAuditLog,
      ].slice(0, 40),
      statusBanner: 'Consecutive-loss cooldown timer reset by operator',
    });
  },

  setFeedConnectionState: (mode, note) =>
    set((s) => ({
      feedMode: mode,
      pipeline: {
        ...s.pipeline,
        sourceName:
          mode === 'FEED_DISCONNECTED'
            ? 'Feed Disconnected'
            : mode === 'CONNECTING'
              ? 'Connecting to Interbank Feed...'
              : s.pipeline.sourceName,
        lastEventNote:
          note ??
          (mode === 'FEED_DISCONNECTED'
            ? 'Live market feed disconnected — autonomous signal scanning halted.'
            : mode === 'CONNECTING'
              ? 'Connecting to live interbank market stream...'
              : s.pipeline.lastEventNote),
      },
    })),

  ingestSsePayload: (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const state = get();

    // 1. Ingest sub-agent telemetry updates if present in SSE event
    const rawTelemetry = (payload.aiTelemetry ?? payload.telemetry) as Partial<AiTelemetryState> | undefined;
    if (rawTelemetry && typeof rawTelemetry === 'object') {
      set({
        aiTelemetry: {
          activeStage: typeof rawTelemetry.activeStage === 'number' ? rawTelemetry.activeStage : state.aiTelemetry.activeStage,
          subAgents: {
            ...state.aiTelemetry.subAgents,
            ...(rawTelemetry.subAgents && typeof rawTelemetry.subAgents === 'object' ? rawTelemetry.subAgents : {}),
          },
          latestThinkingTrace:
            typeof rawTelemetry.latestThinkingTrace === 'string'
              ? rawTelemetry.latestThinkingTrace
              : state.aiTelemetry.latestThinkingTrace,
        },
      });
    } else if (typeof payload.thinkingTrace === 'string') {
      set({
        aiTelemetry: {
          ...state.aiTelemetry,
          latestThinkingTrace: payload.thinkingTrace,
        },
      });
    }

    // 2. Ingest live spot / PAXG market tick if present
    const spotObj = (payload.spot ?? payload.interbank ?? payload) as Record<string, unknown>;
    const spotPrice = Number(spotObj.mid ?? spotObj.last ?? spotObj.price);
    if (Number.isFinite(spotPrice) && spotPrice > 0) {
      const spot = Number(spotPrice.toFixed(2));
      const bid = Number(
        (typeof spotObj.bid === 'number' && Number.isFinite(spotObj.bid) ? spotObj.bid : spot - 0.14).toFixed(2)
      );
      const ask = Number(
        (typeof spotObj.ask === 'number' && Number.isFinite(spotObj.ask) ? spotObj.ask : spot + 0.14).toFixed(2)
      );
      const spread = Number(
        (typeof spotObj.spread === 'number' && Number.isFinite(spotObj.spread) ? spotObj.spread : Math.max(0.02, ask - bid)).toFixed(2)
      );
      const paxgObj = payload.paxg as Record<string, unknown> | undefined;
      const paxgRaw = Number(paxgObj?.mid ?? paxgObj?.last ?? payload.paxgMid);
      const paxgLast = Number.isFinite(paxgRaw) && paxgRaw > 0 ? Number(paxgRaw.toFixed(2)) : undefined;
      const sourceLabel = typeof spotObj.source === 'string' && spotObj.source ? spotObj.source : 'Swissquote Interbank SSE';
      const tier = spotObj.tier === 2 || spotObj.tier === 3 ? spotObj.tier : 1;
      const tsMs = typeof payload.timestampMs === 'number' && Number.isFinite(payload.timestampMs) ? payload.timestampMs : Date.now();

      if (get().feedMode !== 'LIVE_INTERBANK') {
        set({ feedMode: 'LIVE_INTERBANK' });
      }
      get().applyTickUpdate(
        {
          last: spot,
          bid,
          ask,
          spread,
          tier,
          source: sourceLabel,
          timestampMs: tsMs,
        },
        paxgLast
      );

      if (!get().candleSourceMeta.liveHistorical && !get().candleSourceMeta.hydrating) {
        void get().hydrateRealCandles();
      }
    }
  },

  hydrateRealCandles: async (force = false) => {
    const startState = get();
    if (startState.candleSourceMeta.hydrating && !force) return;
    set({
      candleSourceMeta: { ...startState.candleSourceMeta, hydrating: true },
    });

    try {
      const res = await fetch(`/api/candles/bundle?limit=240${force ? '&force=1' : ''}`);
      if (!res.ok) {
        set((s) => ({
          candleSourceMeta: { ...s.candleSourceMeta, hydrating: false },
          feedMode: s.tick.last > 0 ? s.feedMode : 'FEED_DISCONNECTED',
        }));
        return;
      }
      const data = await res.json();
      if (!data?.ok || !data?.candlesByTf) {
        set((s) => ({
          candleSourceMeta: { ...s.candleSourceMeta, hydrating: false },
          feedMode: s.tick.last > 0 ? s.feedMode : 'FEED_DISCONNECTED',
        }));
        return;
      }

      const state = get();
      const tfs: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];
      const mergedByTf = { ...state.candlesByTf };
      let hydratedAny = false;
      for (const tf of tfs) {
        const arr = data.candlesByTf[tf];
        if (Array.isArray(arr) && arr.length >= 20) {
          mergedByTf[tf] = arr.map((c: Partial<Candle>) => normalizeCandle(c));
          hydratedAny = true;
        }
      }

      if (!hydratedAny) {
        set((s) => ({
          candleSourceMeta: { ...s.candleSourceMeta, hydrating: false },
          feedMode: s.tick.last > 0 ? s.feedMode : 'FEED_DISCONNECTED',
        }));
        return;
      }

      const activeSeries = mergedByTf[state.timeframe];
      const latestBarClose = activeSeries[activeSeries.length - 1]?.close ?? state.tick.last;
      const spotObj = data.spot;
      const spot = Number(((spotObj?.spotMid ?? latestBarClose) || state.tick.last).toFixed(2));
      const bid = Number((spotObj?.spotBid ?? spot - 0.14).toFixed(2));
      const ask = Number((spotObj?.spotAsk ?? spot + 0.14).toFixed(2));
      const spread = Number((spotObj?.spread ?? Math.max(0.05, ask - bid)).toFixed(2));
      const paxgMid = typeof spotObj?.paxgMid === 'number' && Number.isFinite(spotObj.paxgMid) ? spotObj.paxgMid : spot;
      const sourceLabel = spotObj?.spotSource || 'Swissquote Interbank BBO';

      const nextBasis = evaluateBasisDivergence(spot, paxgMid);
      const nextQuant = analyzeQuantSnapshot(state.timeframe, mergedByTf, {
        newsGate: state.newsGate,
        basis: nextBasis,
        spread,
        agentConfig: state.agentConfig,
        newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
      });
      const nextAdvisory = buildSystem2Advisory(
        'LIVE_CANDLES_HYDRATED',
        spot,
        spread,
        nextQuant,
        state.newsGate,
        state.confirmedPositions[0] ?? state.position ?? null
      );
      const nextBreakers = evaluateRiskCircuitBreakers({
        config: state.agentConfig,
        simAccount: state.simAccount,
        confirmedPositions: state.confirmedPositions,
        closedTrades: state.closedTrades,
        spread,
        newsGate: state.newsGate,
        liveNews: state.liveNewsIntel,
        cooldownBypassAfterMs: state.cooldownBypassAfterMs,
      });

      const nextMeta = {
        source: String(data.source || 'Swissquote + PAXG Calibrated'),
        rawFeed: String(data.rawFeed || 'BINANCE_PAXGUSDT'),
        calibratedToSpot: Boolean(data.calibratedToSpot),
        basisOffsetUsd: Number(data.basisOffsetUsd ?? 0),
        storageBackend: (data.storageBackend === 'timescaledb' ? 'timescaledb' : 'memory') as 'timescaledb' | 'memory',
        liveHistorical: true,
        lastSyncedMs: Date.now(),
        hydrating: false,
      };

      set({
        feedMode: 'LIVE_INTERBANK',
        candlesByTf: mergedByTf,
        quant: nextQuant,
        basisDivergence: nextBasis,
        circuitBreakers: nextBreakers,
        advisory: nextAdvisory,
        auditResults: run18GateAudit(mergedByTf),
        candleSourceMeta: nextMeta,
        tick: normalizeTick({
          symbol: 'XAUUSD',
          last: spot,
          bid,
          ask,
          spread,
          tier: 1,
          source: sourceLabel,
          seq: state.pipeline.wsSequenceId + 1,
          timestampMs: Date.now(),
        }),
        pipeline: {
          ...state.pipeline,
          activeTier: 1,
          sourceName: sourceLabel,
          wsSequenceId: state.pipeline.wsSequenceId + 1,
          loopLagP99Ms: Number(Math.max(0.1, nextQuant.computeMs).toFixed(2)),
          lastEventNote: `Hydrated 240 real calibrated bars/TF (${nextMeta.source})`,
        },
      });
    } catch {
      set((s) => ({
        candleSourceMeta: { ...s.candleSourceMeta, hydrating: false },
        feedMode: s.tick.last > 0 ? s.feedMode : 'FEED_DISCONNECTED',
      }));
    }
  },

  pollLiveMarket: async () => {
    try {
      const res = await fetch('/api/market/live');
      if (!res.ok) {
        get().setFeedConnectionState('FEED_DISCONNECTED', `Live market endpoint returned HTTP ${res.status} — scanning halted.`);
        return;
      }
      const data = await res.json();
      const spotObj = data?.spot ?? data?.interbank;
      const spotPrice = Number(spotObj?.mid ?? spotObj?.last);
      if (!data?.live || !Number.isFinite(spotPrice) || spotPrice <= 0) {
        get().setFeedConnectionState(
          'FEED_DISCONNECTED',
          data?.reason || 'Interbank spot feeds unreachable — signal scanning halted (no fake prices synthesized).'
        );
        return;
      }

      const spot = Number(spotPrice.toFixed(2));
      const bid = Number((spotObj?.bid ?? spot - 0.14).toFixed(2));
      const ask = Number((spotObj?.ask ?? spot + 0.14).toFixed(2));
      const spread = Number((spotObj?.spread ?? Math.max(0.05, ask - bid)).toFixed(2));
      const paxgRaw = data?.paxg?.mid ?? data?.paxg?.last;
      const paxgLast = typeof paxgRaw === 'number' && Number.isFinite(paxgRaw) ? Number(paxgRaw.toFixed(2)) : spot;
      const sourceLabel = spotObj?.source || 'Swissquote Interbank BBO';
      const tier = spotObj?.tier === 2 || spotObj?.tier === 3 ? spotObj.tier : 1;
      const storageBackend = data?.storageBackend === 'timescaledb' ? 'timescaledb' : 'memory';
      const tsMs = typeof data?.timestampMs === 'number' && Number.isFinite(data.timestampMs) ? data.timestampMs : Date.now();

      const state = get();
      if (state.candleSourceMeta.storageBackend !== storageBackend) {
        set({ candleSourceMeta: { ...state.candleSourceMeta, storageBackend } });
      }

      set({ feedMode: 'LIVE_INTERBANK' });
      get().applyTickUpdate(
        {
          last: spot,
          bid,
          ask,
          spread,
          tier,
          source: sourceLabel,
          timestampMs: tsMs,
        },
        paxgLast
      );

      if (!get().candleSourceMeta.liveHistorical && !get().candleSourceMeta.hydrating) {
        void get().hydrateRealCandles();
      }
    } catch {
      get().setFeedConnectionState(
        'FEED_DISCONNECTED',
        'Network error polling /api/market/live — signal scanning halted.'
      );
    }
  },

  applyTickUpdate: (rawTick, paxgRefPrice) => {
    // ZERO MOCK FALLBACK: never synthesize fake random drift prices
    if (!rawTick || typeof rawTick.last !== 'number' || !Number.isFinite(rawTick.last) || rawTick.last <= 0) {
      return;
    }

    const state = get();
    const nowMs = Date.now();
    const nextPrice = Number(rawTick.last.toFixed(2));
    const nextBid = Number((rawTick.bid ?? nextPrice - 0.12).toFixed(2));
    const nextAsk = Number((rawTick.ask ?? nextPrice + 0.12).toFixed(2));
    const nextSeq = state.pipeline.wsSequenceId + 1;
    const nextTick = normalizeTick(
      {
        ...rawTick,
        last: nextPrice,
        bid: nextBid,
        ask: nextAsk,
        spread: rawTick.spread ?? Number(Math.max(0.02, nextAsk - nextBid).toFixed(2)),
        tier: rawTick.tier ?? state.pipeline.activeTier,
        source: rawTick.source ?? state.pipeline.sourceName,
        seq: nextSeq,
        timestampMs: nowMs,
      },
      nextPrice
    );

    // Deterministic Real Tick Volume: increment by 1 ONLY on real price-change ticks
    const isPriceChange =
      state.tick.last <= 0 ||
      Math.abs(nextTick.last - state.tick.last) >= 0.005 ||
      Math.abs(nextTick.bid - state.tick.bid) >= 0.005 ||
      Math.abs(nextTick.ask - state.tick.ask) >= 0.005;

    // Track rolling 60-second tick velocity (ticksPerMinute)
    const windowCutoff = nowMs - 60_000;
    const nextTickTimestamps = state.tickTimestampsMs.filter((ts) => ts >= windowCutoff);
    if (isPriceChange) {
      nextTickTimestamps.push(nowMs);
    }
    const ticksPerMinute = nextTickTimestamps.length;

    // Update live forming candle across all timeframes deterministically
    const nowSec = Math.floor(nowMs / 1000);
    const updatedByTf = { ...state.candlesByTf };
    (['M1', 'M5', 'M15', 'M30', 'H1', 'H4'] as Timeframe[]).forEach((tf) => {
      const series = [...updatedByTf[tf]];
      const step = TIMEFRAME_SECONDS[tf];
      const bucket = Math.floor(nowSec / step) * step;
      const last = series[series.length - 1];
      if (!last || bucket > last.time) {
        series.push(
          normalizeCandle({
            time: bucket,
            open: nextTick.last,
            high: nextTick.last,
            low: nextTick.last,
            close: nextTick.last,
            volume: 1,
          })
        );
        if (series.length > 300) series.shift();
      } else {
        series[series.length - 1] = normalizeCandle({
          ...last,
          high: Math.max(last.high, nextTick.last),
          low: Math.min(last.low, nextTick.last),
          close: nextTick.last,
          volume: last.volume + (isPriceChange ? 1 : 0),
        });
      }
      updatedByTf[tf] = series;
    });

    const effectivePaxg =
      typeof paxgRefPrice === 'number' && Number.isFinite(paxgRefPrice) && paxgRefPrice > 0
        ? paxgRefPrice
        : state.basisDivergence.paxgPrice > 0
          ? state.basisDivergence.paxgPrice
          : nextTick.last;
    const nextBasis = evaluateBasisDivergence(nextTick.last, effectivePaxg);
    const nextQuant = analyzeQuantSnapshot(state.timeframe, updatedByTf, {
      newsGate: state.newsGate,
      basis: nextBasis,
      spread: nextTick.spread,
      nowMs,
      agentConfig: state.agentConfig,
      newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
    });

    // Enforce Candle-Age TTL, Front-Run Cancellation & Pre-Fill Invalidation on all unconfirmed proposals
    const lifecycleCheck = evaluateProposalLifecycles(
      state.proposals,
      updatedByTf,
      nextTick.last,
      nextTick.bid,
      nextTick.ask,
      nowMs
    );
    let nextProposals = lifecycleCheck.proposals;

    let nextPos = state.position;
    let nextAdvisory = state.advisory;
    let banner = state.statusBanner;

    if (lifecycleCheck.events.length > 0) {
      banner = lifecycleCheck.events[lifecycleCheck.events.length - 1];
    }

    if (nextPos) {
      const hsm = stepHsmPosition(nextPos, nextTick.last, nowMs);
      nextPos = normalizePosition(hsm.position);
      if (hsm.event) {
        banner = `HSM transition: ${hsm.event} @ $${nextTick.last.toFixed(2)}`;
        nextAdvisory =
          normalizeAdvisory(
            buildSystem2Advisory(hsm.event, nextTick.last, nextTick.spread, nextQuant, state.newsGate, nextPos)
          ) ?? state.advisory;
      }
    }

    // Continuously monitor & step EVERY confirmed broker position on every live Bid/Ask tick
    const prevPendingIds = new Set(
      state.confirmedPositions.filter((p) => p.status === 'PENDING_LIMIT').map((p) => p.proposalId)
    );
    const simStep = stepSimulatedPositions(
      state.confirmedPositions,
      state.simAccount,
      nextTick,
      nextQuant,
      state.newsGate,
      nextBasis,
      nowMs,
      state.agentConfig.autoScaleOutTp1Pct
    );

    // Sync proposalLifecycleStatus to FILLED_IN_BROKER when a tracked LIMIT order fills
    if (prevPendingIds.size > 0) {
      const newlyFilledProposalIds = new Set(
        simStep.positions
          .filter((p) => p.status === 'ACTIVE' && prevPendingIds.has(p.proposalId))
          .map((p) => p.proposalId)
      );
      if (newlyFilledProposalIds.size > 0) {
        nextProposals = nextProposals.map((p) =>
          newlyFilledProposalIds.has(p.id)
            ? { ...p, proposalLifecycleStatus: 'FILLED_IN_BROKER' as ProposalLifecycleStatus }
            : p
        );
      }
    }

    if (simStep.events.length > 0) {
      banner = simStep.events[simStep.events.length - 1];
    }

    const nextClosedTrades =
      simStep.newClosedTrades.length > 0
        ? [...simStep.newClosedTrades, ...state.closedTrades].slice(0, 60)
        : state.closedTrades;

    const nextFocusedId = simStep.positions.some((p) => p.id === state.focusedPositionId)
      ? state.focusedPositionId
      : (simStep.positions[0]?.id ?? null);

    const nextEquityHistory =
      simStep.positions.some((p) => p.status === 'ACTIVE') ||
      simStep.newClosedTrades.length > 0 ||
      Math.abs(simStep.account.equity - state.simAccount.equity) >= 0.005
        ? appendSessionEquityPoint(
            state.sessionEquityHistory,
            simStep.account.equity,
            simStep.account.peakEquity,
            nowMs
          )
        : state.sessionEquityHistory;

    const nextBreakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: simStep.account,
      confirmedPositions: simStep.positions,
      closedTrades: nextClosedTrades,
      spread: nextTick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
      nowMs,
    });

    const sourceTsMs = typeof rawTick.timestampMs === 'number' && Number.isFinite(rawTick.timestampMs) ? rawTick.timestampMs : nowMs;
    const measuredTtlMs = Math.max(1, Math.min(5000, Math.abs(nowMs - sourceTsMs)));
    const measuredLoopLag = Number(Math.max(0.1, nextQuant.computeMs).toFixed(2));

    set({
      tick: nextTick,
      ticksPerMinute,
      tickTimestampsMs: nextTickTimestamps,
      candlesByTf: updatedByTf,
      quant: nextQuant,
      basisDivergence: nextBasis,
      proposals: nextProposals,
      position: nextPos,
      confirmedPositions: simStep.positions,
      closedTrades: nextClosedTrades,
      closedConfirmedCount: state.closedConfirmedCount + simStep.newClosedTrades.length,
      focusedPositionId: nextFocusedId,
      simAccount: simStep.account,
      sessionEquityHistory: nextEquityHistory,
      circuitBreakers: nextBreakers,
      advisory: nextAdvisory,
      statusBanner: banner,
      pipeline: {
        ...state.pipeline,
        activeTier: nextTick.tier,
        sourceName: rawTick.source ?? state.pipeline.sourceName,
        ttlMs: measuredTtlMs,
        loopLagP99Ms: measuredLoopLag,
        wsSequenceId: nextSeq,
      },
    });
  },

  toggleAgentEnabled: () => {
    const state = get();
    if (!state.agentEnabled && state.agentConfig.killSwitchEngaged) {
      set({
        agentError: 'Disarm the Emergency Kill Switch before activating autonomous scans.',
        statusBanner: 'Cannot enable Payam Agent while Emergency Kill Switch is engaged',
      });
      return;
    }
    const nextEnabled = !state.agentEnabled;
    set({
      agentEnabled: nextEnabled,
      agentError: null,
      agentAuditLog: [
        createAuditEntry(
          'SCAN',
          'INFO',
          nextEnabled ? 'Autonomous Scanner ACTIVATED' : 'Autonomous Scanner PAUSED',
          nextEnabled ? 'Live SMC + RSI + 14-Source News + 7-Breaker loop armed.' : 'Autonomous scan loop paused by trader.'
        ),
        ...state.agentAuditLog,
      ].slice(0, 40),
      statusBanner: nextEnabled
        ? 'Payam Agentic Model ACTIVATED — scanning SMC/RSI/News tools & monitoring confirmed broker trades'
        : 'Payam Agentic Model PAUSED — autonomous proposal generation halted',
    });
    if (nextEnabled) {
      void get().runAgentScanCycle();
    }
  },

  setAgentMode: (agentMode) =>
    set({
      agentMode,
      agentError: null,
      statusBanner: `Agentic bridge switched to ${agentMode.replace('_', ' ')}`,
    }),

  runAgentScanCycle: async (opts) => {
    const state = get();
    if (state.agentBusy) return;

    // ZERO-MOCK DISCIPLINE: halt signal scanning whenever feed is connecting or disconnected
    const activeSeriesLen = (state.candlesByTf[state.timeframe] ?? []).length;
    if (state.feedMode !== 'LIVE_INTERBANK' || state.tick.last <= 0 || activeSeriesLen < 20) {
      const msg =
        state.feedMode === 'FEED_DISCONNECTED'
          ? 'Live interbank feed disconnected — signal scanning halted.'
          : 'Waiting for live interbank feed & calibrated candles before scanning.';
      set({
        agentError: msg,
        statusBanner: msg,
      });
      return;
    }

    const liveBreakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: state.simAccount,
      confirmedPositions: state.confirmedPositions,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });

    if (!liveBreakers.canOpenNewTrades) {
      const audit = createAuditEntry('CIRCUIT_BREAKER', 'WARN', 'Scan Halted by Risk Circuit Breaker', liveBreakers.summaryEn);
      set({
        circuitBreakers: liveBreakers,
        agentError: liveBreakers.summaryEn,
        agentAuditLog: [audit, ...state.agentAuditLog].slice(0, 40),
        statusBanner: liveBreakers.summaryEn,
      });
      return;
    }

    const scanStartMs = Date.now();
    set({
      agentBusy: true,
      agentError: null,
      circuitBreakers: liveBreakers,
      aiTelemetry: {
        activeStage: 1,
        subAgents: {
          ...state.aiTelemetry.subAgents,
          smc_quant: { status: 'RUNNING', summary: `Analyzing ${state.timeframe} SMC + RSI` },
          macro_news: { status: 'RUNNING', summary: `${state.liveNewsIntel.macroSentiment}` },
          red_team: { status: 'QUEUED' },
          execution_architect: { status: 'QUEUED' },
        },
        latestThinkingTrace: state.aiTelemetry.latestThinkingTrace,
      },
    });
    const scanIdx = state.agentScanCount + 1;

    try {
      let createdProposal: AgentProposal | null = null;
      let standDownMessage: string | null = null;
      let apiNotice: string | null = null;
      let latestThinkingTrace = state.aiTelemetry.latestThinkingTrace;

      // Refresh deterministic Payam Brain snapshot immediately before proposing
      const liveQuant = analyzeQuantSnapshot(state.timeframe, state.candlesByTf, {
        newsGate: state.newsGate,
        basis: state.basisDivergence,
        spread: state.tick.spread,
        agentConfig: state.agentConfig,
        newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
      });

      // Route ALL AI modes — including ANTIGRAVITY_MCP — through /api/agent/propose with executionMode
      if (!opts?.quantOnly) {
        set((s) => ({
          aiTelemetry: {
            ...s.aiTelemetry,
            activeStage: 2,
            subAgents: {
              ...s.aiTelemetry.subAgents,
              smc_quant: { status: 'DONE', latencyMs: Math.round(liveQuant.computeMs), summary: `Score ${liveQuant.brain.totalScore}/100` },
              macro_news: { status: 'DONE', summary: `${state.newsGate.state}` },
              red_team: { status: 'RUNNING', summary: `Mode: ${state.agentMode}` },
              execution_architect: { status: 'RUNNING' },
            },
          },
        }));

        const res = await fetch('/api/agent/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            executionMode: state.agentMode,
            spotPrice: state.tick.last,
            spread: state.tick.spread,
            timeframe: state.timeframe,
            quant: liveQuant,
            newsGate: state.newsGate,
            basis: state.basisDivergence,
            agentConfig: state.agentConfig,
            circuitBreakers: liveBreakers,
            liveNews: {
              macroSentiment: state.liveNewsIntel.macroSentiment,
              sentimentScore: state.liveNewsIntel.sentimentScore,
              shockDetected: state.liveNewsIntel.shockDetected,
              shockHeadline: state.liveNewsIntel.shockHeadline,
              headlines: state.liveNewsIntel.headlines.slice(0, 6),
            },
          }),
        });

        const payload = await res.json().catch(() => null);
        if (payload?.thinkingTrace && typeof payload.thinkingTrace === 'string') {
          latestThinkingTrace = payload.thinkingTrace;
        }
        if (payload?.aiTelemetry && typeof payload.aiTelemetry === 'object') {
          set((s) => ({
            aiTelemetry: {
              activeStage: payload.aiTelemetry.activeStage ?? 3,
              subAgents: { ...s.aiTelemetry.subAgents, ...(payload.aiTelemetry.subAgents ?? {}) },
              latestThinkingTrace: payload.aiTelemetry.latestThinkingTrace ?? latestThinkingTrace,
            },
          }));
        }

        if (res.ok && payload?.ok && payload.decision === 'STAND_DOWN') {
          standDownMessage =
            payload.standDownReasonEn ||
            liveQuant.brain.summaryEn ||
            'Payam Brain enforced STAND DOWN — anti-emotion shield active.';
        } else if (res.ok && payload?.ok && payload.proposal) {
          createdProposal = payload.proposal as AgentProposal;
          if (createdProposal.thinkingTrace) {
            latestThinkingTrace = createdProposal.thinkingTrace;
          }
        } else {
          apiNotice =
            payload?.error ||
            `Agent bridge (${state.agentMode}) returned HTTP ${res.status}. Configure GEMINI_API_KEY in Secrets or use System 1 Quant Scan.`;
        }
      }

      // Deterministic Payam Brain fallback applies ONLY for explicit quantOnly or HYBRID mode (never silently bypassing ANTIGRAVITY_MCP)
      const allowQuantFallback =
        !standDownMessage && (Boolean(opts?.quantOnly) || state.agentMode === 'HYBRID');

      if (!createdProposal && allowQuantFallback) {
        createdProposal = generateQuantProposal(
          state.tick.last,
          state.timeframe,
          liveQuant,
          state.newsGate,
          state.basisDivergence,
          scanIdx,
          { allowCautionVariant: false, spread: state.tick.spread, minRrRatio: state.agentConfig.minRrRatio }
        );
        if (createdProposal && state.agentMode === 'HYBRID') {
          apiNotice = null;
        } else if (!createdProposal) {
          standDownMessage = liveQuant.brain.summaryEn;
          if (state.agentMode === 'HYBRID') {
            apiNotice = null;
          }
        }
      }

      // Enrich proposal with Sniper Zone, Order Type, Candle-Age TTL & Circuit Breaker risk throttle
      if (createdProposal) {
        createdProposal = enrichProposalLifecycle(
          createdProposal,
          state.candlesByTf,
          state.tick.last,
          state.tick.spread,
          Date.now()
        );
        if (liveBreakers.effectiveRiskMultiplier < 1) {
          createdProposal = {
            ...createdProposal,
            recommendedRiskMultiplier: Number(
              Math.min(createdProposal.recommendedRiskMultiplier ?? 1, liveBreakers.effectiveRiskMultiplier).toFixed(2)
            ),
          };
        }
      }

      const nextProposals = createdProposal
        ? [createdProposal, ...get().proposals].slice(0, 24)
        : get().proposals;

      const auditEntry = createdProposal
        ? createAuditEntry(
            'PROPOSAL',
            'INFO',
            `Proposed ${createdProposal.direction} [${createdProposal.convictionGrade ?? 'A'} · ${createdProposal.confluenceScore ?? liveQuant.brain.totalScore}/100]`,
            `${createdProposal.orderType ?? 'LIMIT'} ${createdProposal.setupType} @ $${createdProposal.entry.toFixed(2)} · SL $${createdProposal.stopLoss.toFixed(2)} · TP1 $${createdProposal.tp1.toFixed(2)} (R:R 1:${createdProposal.rrRatio.toFixed(2)} · TTL ${createdProposal.ttlBarsRemaining}b)`
          )
        : createAuditEntry(
            'STAND_DOWN',
            'INFO',
            `Disciplined STAND DOWN (${liveQuant.brain.totalScore}/100)`,
            standDownMessage || liveQuant.brain.summaryEn
          );

      const scanLatencyMs = Date.now() - scanStartMs;
      set((s) => ({
        agentBusy: false,
        agentScanCount: scanIdx,
        lastAgentScanMs: Date.now(),
        agentError: apiNotice,
        quant: liveQuant,
        proposals: nextProposals,
        agentAuditLog: [auditEntry, ...s.agentAuditLog].slice(0, 40),
        aiTelemetry: {
          activeStage: 4,
          subAgents: {
            ...s.aiTelemetry.subAgents,
            smc_quant: { status: 'DONE', latencyMs: Math.round(liveQuant.computeMs), summary: `${liveQuant.brain.totalScore}/100` },
            macro_news: { status: 'DONE', summary: state.liveNewsIntel.macroSentiment },
            red_team: {
              status: createdProposal ? 'DONE' : 'STAND_DOWN',
              latencyMs: scanLatencyMs,
              summary:
                createdProposal?.redTeamRiskScore !== undefined
                  ? `Risk ${createdProposal.redTeamRiskScore}/100`
                  : standDownMessage
                    ? 'Vetoed / Stand Down'
                    : 'Cleared',
            },
            execution_architect: {
              status: createdProposal ? 'PROPOSED' : 'IDLE',
              latencyMs: scanLatencyMs,
              summary: createdProposal ? `${createdProposal.orderType} ${createdProposal.direction}` : 'No Entry',
            },
          },
          latestThinkingTrace,
        },
        statusBanner: createdProposal
          ? `Payam Brain [${createdProposal.convictionGrade ?? 'A'} · ${createdProposal.confluenceScore ?? Math.round(createdProposal.confidence * 100)}/100] proposed ${createdProposal.orderType} ${createdProposal.direction} ${createdProposal.setupType} @ $${createdProposal.entry.toFixed(2)} (R:R 1:${createdProposal.rrRatio.toFixed(2)})`
          : standDownMessage
            ? `Payam Brain STAND DOWN (${liveQuant.brain.totalScore}/100): ${standDownMessage}`
            : apiNotice
              ? `Agent scan notice: ${apiNotice}`
              : s.statusBanner,
      }));

      // Also refresh live position guardian directives if open positions exist
      if (get().confirmedPositions.length > 0) {
        void get().monitorOpenPositions();
      }
    } catch (err: any) {
      set((s) => ({
        agentBusy: false,
        agentError: err?.message || 'Agentic scan request failed.',
        aiTelemetry: {
          ...s.aiTelemetry,
          activeStage: 0,
          subAgents: {
            ...s.aiTelemetry.subAgents,
            execution_architect: { status: 'ERROR', summary: err?.message || 'Scan failed' },
          },
        },
      }));
    }
  },

  monitorOpenPositions: async () => {
    const state = get();
    if (state.confirmedPositions.length === 0) return;

    const startedAt = Date.now();
    const liveTick = state.tick;
    const liveQuant = state.quant;
    const scaleOutPct = state.agentConfig.autoScaleOutTp1Pct;

    // 1. Always compute deterministic System-1 Co-Pilot directive immediately
    let monitored: ConfirmedPosition[] = state.confirmedPositions.map((cp) => {
      const markPrice =
        liveTick.last > 0
          ? cp.direction === 'LONG'
            ? liveTick.bid
            : liveTick.ask
          : cp.entry;
      const advised =
        cp.status === 'ACTIVE'
          ? evaluateConfirmedPositionAdvice(cp, markPrice, liveQuant, state.newsGate, state.basisDivergence)
          : cp;
      const directive = derivePositionCoPilotDirective(
        advised,
        markPrice,
        liveQuant,
        state.newsGate,
        state.basisDivergence,
        scaleOutPct
      );
      return {
        ...advised,
        ...directive,
        thinkingTrace: cp.thinkingTrace,
        lastReviewedMs: Date.now(),
      };
    });

    set((s) => ({
      confirmedPositions: monitored,
      aiTelemetry: {
        ...s.aiTelemetry,
        subAgents: {
          ...s.aiTelemetry.subAgents,
          position_guardian: {
            status: 'RUNNING',
            summary: `Monitoring ${monitored.length} broker position(s)`,
          },
        },
      },
    }));

    // 2. Call /api/agent/monitor for System-2 Co-Pilot enrichment when live feed is connected
    if (state.feedMode !== 'LIVE_INTERBANK' || liveTick.last <= 0) {
      set((s) => ({
        aiTelemetry: {
          ...s.aiTelemetry,
          subAgents: {
            ...s.aiTelemetry.subAgents,
            position_guardian: {
              status: 'LOCAL_ONLY',
              latencyMs: Date.now() - startedAt,
              summary: 'Deterministic HSM active (awaiting live feed)',
            },
          },
        },
      }));
      return;
    }

    try {
      const monRes = await fetch('/api/agent/monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          executionMode: state.agentMode,
          spotPrice: liveTick.last,
          quant: liveQuant,
          newsGate: state.newsGate,
          basis: state.basisDivergence,
          liveNews: {
            macroSentiment: state.liveNewsIntel.macroSentiment,
            shockHeadline: state.liveNewsIntel.shockHeadline,
          },
          positions: monitored.map((p) => ({
            id: p.id,
            status: p.status,
            direction: p.direction,
            entry: p.entry,
            stopLoss: p.stopLoss,
            tp1: p.tp1,
            tp2: p.tp2,
            lotSize: p.lotSize,
            stage: p.stage,
            rMultiple: p.rMultiple,
            unrealizedPnl: p.unrealizedPnl,
            latestDirective: p.latestDirective,
          })),
        }),
      });

      const monData = await monRes.json().catch(() => null);
      if (monRes.ok && monData?.ok && Array.isArray(monData.updates)) {
        const byId = new Map<string, any>(monData.updates.map((u: any) => [u.positionId, u]));
        const latestPositions = get().confirmedPositions;
        const enriched = latestPositions.map((pos) => {
          const upd = byId.get(pos.id);
          if (!upd) return pos;

          const validDirectives: PositionCoPilotDirective[] = [
            'HOLD_STEADY',
            'MOVE_SL_TO_BREAKEVEN',
            'PARTIAL_TAKE_PROFIT_TP1',
            'TRAIL_STOP_STRUCTURAL',
            'EMERGENCY_EXIT_NOW',
          ];
          const mappedDirective: PositionCoPilotDirective = validDirectives.includes(upd.latestDirective)
            ? upd.latestDirective
            : upd.actionTag === 'EXIT_WARNING' || upd.actionTag === 'PROTECT_NEWS'
              ? 'EMERGENCY_EXIT_NOW'
              : upd.actionTag === 'SCALE_PARTIAL'
                ? 'PARTIAL_TAKE_PROFIT_TP1'
                : upd.actionTag === 'ARM_BE' || upd.actionTag === 'MOVE_SL_RF'
                  ? 'MOVE_SL_TO_BREAKEVEN'
                  : (pos.latestDirective ?? 'HOLD_STEADY');

          const mappedUrgency: 'NORMAL' | 'HIGH' | 'CRITICAL' =
            upd.directiveUrgency === 'CRITICAL' || upd.directiveUrgency === 'HIGH' || upd.directiveUrgency === 'NORMAL'
              ? upd.directiveUrgency
              : upd.urgency === 'CRITICAL'
                ? 'CRITICAL'
                : upd.urgency === 'ATTENTION'
                  ? 'HIGH'
                  : (pos.directiveUrgency ?? 'NORMAL');

          return {
            ...pos,
            actionTag: upd.actionTag || pos.actionTag,
            urgency: upd.urgency || pos.urgency,
            adviceEn: upd.adviceEn || pos.adviceEn,
            adviceFa: upd.adviceFa || pos.adviceFa,
            latestDirective: mappedDirective,
            recommendedActionPrice:
              typeof upd.recommendedActionPrice === 'number' && Number.isFinite(upd.recommendedActionPrice)
                ? Number(upd.recommendedActionPrice.toFixed(2))
                : pos.recommendedActionPrice,
            recommendedScaleOutPct:
              typeof upd.recommendedScaleOutPct === 'number' && Number.isFinite(upd.recommendedScaleOutPct)
                ? upd.recommendedScaleOutPct
                : pos.recommendedScaleOutPct,
            directiveUrgency: mappedUrgency,
            directiveRationaleEn: upd.directiveRationaleEn || upd.adviceEn || pos.directiveRationaleEn,
            directiveRationaleFa: upd.directiveRationaleFa || upd.adviceFa || pos.directiveRationaleFa,
            thinkingTrace: typeof upd.thinkingTrace === 'string' ? upd.thinkingTrace : pos.thinkingTrace,
            lastReviewedMs: Date.now(),
          };
        });

        set((s) => ({
          confirmedPositions: enriched,
          aiTelemetry: {
            ...s.aiTelemetry,
            subAgents: {
              ...s.aiTelemetry.subAgents,
              position_guardian: {
                status: 'DONE',
                latencyMs: Date.now() - startedAt,
                summary: `AI Co-Pilot synced ${enriched.length} position(s)`,
              },
            },
            latestThinkingTrace:
              typeof monData.thinkingTrace === 'string'
                ? monData.thinkingTrace
                : s.aiTelemetry.latestThinkingTrace,
          },
        }));
      } else {
        set((s) => ({
          aiTelemetry: {
            ...s.aiTelemetry,
            subAgents: {
              ...s.aiTelemetry.subAgents,
              position_guardian: {
                status: 'DONE',
                latencyMs: Date.now() - startedAt,
                summary: `HSM Guardian active (${monitored.length} pos)`,
              },
            },
          },
        }));
      }
    } catch {
      set((s) => ({
        aiTelemetry: {
          ...s.aiTelemetry,
          subAgents: {
            ...s.aiTelemetry.subAgents,
            position_guardian: {
              status: 'DONE',
              latencyMs: Date.now() - startedAt,
              summary: `HSM Guardian active (${monitored.length} pos)`,
            },
          },
        },
      }));
    }
  },

  applyPositionDirective: (positionId) => {
    const state = get();
    const pos = state.confirmedPositions.find((p) => p.id === positionId);
    if (!pos) return;

    const directive = pos.latestDirective ?? 'HOLD_STEADY';
    const isLong = pos.direction === 'LONG';
    const nowMs = Date.now();

    if (directive === 'EMERGENCY_EXIT_NOW') {
      get().closeConfirmedPosition(positionId);
      set({
        statusBanner: `Emergency exit synced in broker for ${pos.orderId} — position closed.`,
      });
      return;
    }

    if (directive === 'PARTIAL_TAKE_PROFIT_TP1') {
      const pct = pos.recommendedScaleOutPct ?? state.agentConfig.autoScaleOutTp1Pct;
      const frac = Math.max(0.1, Math.min(0.95, pct / 100));
      get().partialClosePosition(positionId, frac);
      // Also lock remaining runner SL at Break-Even
      get().moveConfirmedPositionBreakEven(positionId);
      set({
        statusBanner: `Broker synced: closed ${Math.round(pct)}% at TP1 & moved remaining SL to Break-Even (${pos.orderId}).`,
      });
      return;
    }

    if (directive === 'MOVE_SL_TO_BREAKEVEN') {
      const targetBe =
        typeof pos.recommendedActionPrice === 'number' && Number.isFinite(pos.recommendedActionPrice)
          ? Number(pos.recommendedActionPrice.toFixed(2))
          : Number((isLong ? pos.entry + Math.max(pos.spread, 0.15) : pos.entry - Math.max(pos.spread, 0.15)).toFixed(2));
      set({
        confirmedPositions: state.confirmedPositions.map((p) =>
          p.id === positionId
            ? {
                ...p,
                stopLoss: targetBe,
                stage: 'RISK_FREE_TP1' as const,
                actionTag: 'HOLD_RUNNER' as const,
                urgency: 'NORMAL' as const,
                latestDirective: 'HOLD_STEADY' as const,
                recommendedActionPrice: targetBe,
                directiveUrgency: 'NORMAL' as const,
                directiveRationaleEn: `Synced: Broker SL moved to Break-Even $${targetBe.toFixed(2)}. Runner is now risk-free toward TP2 $${p.tp2.toFixed(2)}.`,
                directiveRationaleFa: `همگام شد: حد ضرر بروکر در $${targetBe.toFixed(2)} ریسک‌فری شد. ادامه حرکت به سمت TP2 ($${p.tp2.toFixed(2)}) بدون ریسک است.`,
                adviceEn: `Broker SL locked risk-free at $${targetBe.toFixed(2)}.`,
                adviceFa: `حد ضرر بروکر در $${targetBe.toFixed(2)} ریسک‌فری شد.`,
                executionLog: [
                  ...p.executionLog,
                  {
                    id: `ev-sync-be-${nowMs.toString(36)}`,
                    timeMs: nowMs,
                    kind: 'BE_LOCK' as const,
                    message: `Trader synced Break-Even SL in broker -> $${targetBe.toFixed(2)}`,
                    price: state.tick.last || p.entry,
                  },
                ].slice(-16),
                lastReviewedMs: nowMs,
              }
            : p
        ),
        statusBanner: `Broker synced: ${pos.orderId} SL updated to Break-Even $${targetBe.toFixed(2)}.`,
      });
      return;
    }

    if (directive === 'TRAIL_STOP_STRUCTURAL') {
      const targetSl =
        typeof pos.recommendedActionPrice === 'number' && Number.isFinite(pos.recommendedActionPrice)
          ? Number(pos.recommendedActionPrice.toFixed(2))
          : pos.stopLoss;
      const improves = isLong ? targetSl > pos.stopLoss : targetSl < pos.stopLoss;
      const appliedSl = improves ? targetSl : pos.stopLoss;
      set({
        confirmedPositions: state.confirmedPositions.map((p) =>
          p.id === positionId
            ? {
                ...p,
                stopLoss: appliedSl,
                latestDirective: 'HOLD_STEADY' as const,
                recommendedActionPrice: appliedSl,
                directiveUrgency: 'NORMAL' as const,
                directiveRationaleEn: `Synced: Broker SL trailed behind M5 swing to $${appliedSl.toFixed(2)}. Hold runner toward TP2 $${p.tp2.toFixed(2)}.`,
                directiveRationaleFa: `همگام شد: حد ضرر بروکر پشت سوئینگ M5 در $${appliedSl.toFixed(2)} تریل شد. مسیر تا TP2 ($${p.tp2.toFixed(2)}) باز است.`,
                executionLog: [
                  ...p.executionLog,
                  {
                    id: `ev-sync-tr-${nowMs.toString(36)}`,
                    timeMs: nowMs,
                    kind: 'TRAILING_SL' as const,
                    message: `Trader synced Structural Trail SL in broker -> $${appliedSl.toFixed(2)}`,
                    price: state.tick.last || p.entry,
                  },
                ].slice(-16),
                lastReviewedMs: nowMs,
              }
            : p
        ),
        statusBanner: `Broker synced: ${pos.orderId} SL trailed to $${appliedSl.toFixed(2)}.`,
      });
      return;
    }

    set({
      confirmedPositions: state.confirmedPositions.map((p) =>
        p.id === positionId ? { ...p, lastReviewedMs: nowMs } : p
      ),
      statusBanner: `Position ${pos.orderId} confirmed synced with broker (HOLD STEADY).`,
    });
  },

  markLimitFilledInBroker: (positionId, actualFillPrice) => {
    const state = get();
    const target = state.confirmedPositions.find((p) => p.id === positionId);
    if (!target || target.status !== 'PENDING_LIMIT') return;

    const nowMs = Date.now();
    const fill =
      typeof actualFillPrice === 'number' && Number.isFinite(actualFillPrice) && actualFillPrice > 0
        ? Number(actualFillPrice.toFixed(2))
        : target.entry;
    const isLong = target.direction === 'LONG';
    const marginReq = calculateRequiredMargin(fill, target.lotSize, state.simAccount.leverage);
    const openComm = Number(((state.simAccount.commissionPerLotRoundTurn / 2) * target.lotSize).toFixed(2));
    const markPrice = state.tick.last > 0 ? (isLong ? state.tick.bid : state.tick.ask) : fill;
    const grossPnl = Number(((isLong ? markPrice - fill : fill - markPrice) * target.lotSize * 100).toFixed(2));
    const netPnl = Number((grossPnl - openComm).toFixed(2));
    const stopDist = Math.max(0.01, Math.abs(fill - target.stopLoss));
    const rrRatio = Number((Math.abs(target.tp1 - fill) / stopDist).toFixed(2));

    const updatedPosBase: ConfirmedPosition = {
      ...target,
      status: 'ACTIVE',
      entry: fill,
      fillPrice: fill,
      slippageUsd: Number(Math.abs(fill - target.requestedEntry).toFixed(2)),
      rrRatio,
      marginUsed: marginReq,
      commissionPaid: Number((target.commissionPaid + openComm).toFixed(2)),
      grossPnl,
      netPnl,
      unrealizedPnl: netPnl,
      openedAtMs: nowMs,
      executionLog: [
        ...target.executionLog,
        {
          id: `ev-mfill-${nowMs.toString(36)}`,
          timeMs: nowMs,
          kind: 'LIMIT_FILLED' as const,
          message: `Trader confirmed LIMIT filled in broker @ $${fill.toFixed(2)} (anchored SL $${target.stopLoss.toFixed(2)})`,
          price: fill,
        },
      ].slice(-16),
      lastReviewedMs: nowMs,
    };

    const advised = evaluateConfirmedPositionAdvice(
      updatedPosBase,
      markPrice,
      state.quant,
      state.newsGate,
      state.basisDivergence
    );
    const directive = derivePositionCoPilotDirective(
      advised,
      markPrice,
      state.quant,
      state.newsGate,
      state.basisDivergence,
      state.agentConfig.autoScaleOutTp1Pct
    );
    const finalPos: ConfirmedPosition = { ...advised, ...directive };

    const nextConfirmed = state.confirmedPositions.map((p) => (p.id === positionId ? finalPos : p));
    const nextProposals = state.proposals.map((p) =>
      p.id === target.proposalId ? { ...p, proposalLifecycleStatus: 'FILLED_IN_BROKER' as ProposalLifecycleStatus } : p
    );
    const nextAccount = reconcileSimAccount(
      {
        ...state.simAccount,
        balance: Number((state.simAccount.balance - openComm).toFixed(2)),
        realizedPnl: Number((state.simAccount.realizedPnl - openComm).toFixed(2)),
        totalCommissionPaid: Number((state.simAccount.totalCommissionPaid + openComm).toFixed(2)),
      },
      nextConfirmed
    );

    set({
      confirmedPositions: nextConfirmed,
      proposals: nextProposals,
      simAccount: nextAccount,
      statusBanner: `Pending limit ${target.orderId} marked FILLED in broker @ $${fill.toFixed(2)} — Co-Pilot Guardian active.`,
    });
  },

  confirmProposal: (proposalId, optionsOrLot = 0.2) => {
    const state = get();
    const breakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: state.simAccount,
      confirmedPositions: state.confirmedPositions,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });
    if (!breakers.canOpenNewTrades) {
      const errors = [breakers.summaryEn];
      set({
        circuitBreakers: breakers,
        lastGuardrailErrors: errors,
        statusBanner: breakers.summaryEn,
        agentAuditLog: [
          createAuditEntry('CIRCUIT_BREAKER', 'WARN', 'Execution Blocked by Circuit Breaker', breakers.summaryEn),
          ...state.agentAuditLog,
        ].slice(0, 40),
      });
      return { ok: false, errors };
    }

    const target = state.proposals.find((p) => p.id === proposalId);
    if (!target) return { ok: false, errors: ['Proposal not found'] };

    // Prevent confirming expired, invalidated, or front-run signals
    const lifecycle = target.proposalLifecycleStatus ?? 'ACTIVE';
    if (
      lifecycle === 'EXPIRED_TTL' ||
      lifecycle === 'INVALIDATED_STRUCTURE' ||
      lifecycle === 'CANCELLED_FRONT_RUN'
    ) {
      const msg =
        lifecycle === 'CANCELLED_FRONT_RUN'
          ? 'Target hit before fill — Do NOT enter late!'
          : lifecycle === 'INVALIDATED_STRUCTURE'
            ? 'Proposal structure was invalidated before fill.'
            : 'Proposal expired (TTL reached 0).';
      set({ lastGuardrailErrors: [msg], statusBanner: msg });
      return { ok: false, errors: [msg] };
    }

    const rawLotSize = typeof optionsOrLot === 'number' ? optionsOrLot : (optionsOrLot.lotSize ?? 0.2);
    const lotSize = Number(Math.max(0.01, rawLotSize * breakers.effectiveRiskMultiplier).toFixed(2));
    const executionType: OrderExecutionType =
      typeof optionsOrLot === 'number' ? 'MARKET' : (optionsOrLot.executionType ?? 'MARKET');
    const actualFillPrice =
      typeof optionsOrLot === 'number' ? undefined : optionsOrLot.actualFillPrice;
    const trailingStopDistance =
      typeof optionsOrLot === 'number' ? null : (optionsOrLot.trailingStopDistance ?? null);

    const sim = simulateOpenTrade({
      proposal: target,
      lotSize,
      executionType,
      actualFillPrice,
      trailingStopDistance,
      autoScaleOutTp1Pct: state.agentConfig.autoScaleOutTp1Pct,
      tick: state.tick,
      quant: state.quant,
      newsGate: state.newsGate,
      basis: state.basisDivergence,
      account: state.simAccount,
      existingPositions: state.confirmedPositions,
      nowMs: Date.now(),
    });

    if (!sim.ok || !sim.position) {
      set({
        lastGuardrailErrors: sim.errors,
        statusBanner: sim.errors[0] ?? 'Trade execution rejected by guardrails',
      });
      return { ok: false, errors: sim.errors };
    }

    const pos = sim.position;
    const nextLifecycle: ProposalLifecycleStatus =
      pos.status === 'PENDING_LIMIT' ? 'PENDING_LIMIT_IN_BROKER' : 'FILLED_IN_BROKER';
    const updatedProposals = state.proposals.map((p) =>
      p.id === proposalId
        ? { ...p, status: 'CONFIRMED' as const, proposalLifecycleStatus: nextLifecycle }
        : p
    );

    const nextConfirmed = [pos, ...state.confirmedPositions];
    const nextBreakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: sim.account,
      confirmedPositions: nextConfirmed,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: state.newsGate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });
    set({
      proposals: updatedProposals,
      confirmedPositions: nextConfirmed,
      simAccount: sim.account,
      circuitBreakers: nextBreakers,
      sessionEquityHistory: appendSessionEquityPoint(
        state.sessionEquityHistory,
        sim.account.equity,
        sim.account.peakEquity,
        pos.openedAtMs
      ),
      focusedPositionId: pos.id,
      lastGuardrailErrors: [],
      agentAuditLog: [
        createAuditEntry(
          'EXECUTION',
          'INFO',
          `Confirmed ${pos.direction} ${pos.lotSize.toFixed(2)} lot (${pos.orderId})`,
          `${pos.status === 'PENDING_LIMIT' ? 'LIMIT' : 'FILLED'} ${pos.setupType} @ $${pos.fillPrice.toFixed(2)} · Anchored SL $${pos.stopLoss.toFixed(2)} · TP1 $${pos.tp1.toFixed(2)} (R:R 1:${pos.rrRatio.toFixed(2)})`
        ),
        ...state.agentAuditLog,
      ].slice(0, 40),
      statusBanner:
        pos.status === 'PENDING_LIMIT'
          ? `Order ${pos.orderId} tracked: Pending ${pos.direction} LIMIT ${pos.lotSize.toFixed(2)} lot @ $${pos.entry.toFixed(2)} — watching entry zone`
          : `Confirmed in Broker (${pos.orderId}): ${pos.direction} ${pos.lotSize.toFixed(2)} lot @ $${pos.fillPrice.toFixed(2)} · Anchored SL $${pos.stopLoss.toFixed(2)} · Co-Pilot active`,
    });

    return { ok: true, errors: [], positionId: pos.id };
  },

  dismissProposal: (proposalId) =>
    set((s) => ({
      proposals: s.proposals.map((p) => (p.id === proposalId ? { ...p, status: 'DISMISSED' as const } : p)),
    })),

  partialClosePosition: (positionId, fraction) => {
    const state = get();
    const target = state.confirmedPositions.find((p) => p.id === positionId);
    if (!target) return;

    const result = executePartialClose(target, fraction, state.tick, state.simAccount, Date.now());
    const remainingList = result.remainingPosition
      ? state.confirmedPositions.map((p) => (p.id === positionId ? result.remainingPosition! : p))
      : state.confirmedPositions.filter((p) => p.id !== positionId);

    const nextAccount = reconcileSimAccount(result.account, remainingList);
    const nextClosedTrades = result.closedRecord
      ? [result.closedRecord, ...state.closedTrades].slice(0, 60)
      : state.closedTrades;

    set({
      confirmedPositions: remainingList,
      closedTrades: nextClosedTrades,
      closedConfirmedCount: state.closedConfirmedCount + (result.closedRecord ? 1 : 0),
      simAccount: nextAccount,
      sessionEquityHistory: appendSessionEquityPoint(
        state.sessionEquityHistory,
        nextAccount.equity,
        nextAccount.peakEquity,
        Date.now()
      ),
      focusedPositionId:
        !result.remainingPosition && state.focusedPositionId === positionId
          ? (remainingList[0]?.id ?? null)
          : state.focusedPositionId,
      statusBanner: result.closedRecord
        ? `${result.remainingPosition ? 'Partial close' : 'Closed'} ${target.orderId} (${result.closedRecord.lotSize.toFixed(2)} lot @ $${result.closedRecord.exitPrice.toFixed(2)}): Net ${result.closedRecord.netPnl >= 0 ? '+' : ''}$${result.closedRecord.netPnl.toFixed(2)}`
        : `Cancelled resting Limit order ${target.orderId}`,
    });
  },

  closeConfirmedPosition: (positionId) => {
    get().partialClosePosition(positionId, 1);
  },

  modifyConfirmedPosition: (positionId, updates) => {
    const state = get();
    const target = state.confirmedPositions.find((p) => p.id === positionId);
    if (!target) return { ok: false, error: 'Position not found' };
    const markPrice = target.direction === 'LONG' ? state.tick.bid : state.tick.ask;
    const res = modifyPositionLevels(target, updates, markPrice, Date.now());
    if (!res.ok) {
      set({ statusBanner: res.error ?? 'Invalid level modification' });
      return { ok: false, error: res.error };
    }
    set({
      confirmedPositions: state.confirmedPositions.map((p) => (p.id === positionId ? res.position : p)),
      statusBanner: `Updated ${target.orderId} -> SL $${res.position.stopLoss.toFixed(2)} · TP1 $${res.position.tp1.toFixed(2)} · TP2 $${res.position.tp2.toFixed(2)}`,
    });
    return { ok: true };
  },

  toggleTrailingStop: (positionId) => {
    const state = get();
    const target = state.confirmedPositions.find((p) => p.id === positionId);
    if (!target) return;
    const atrTrail = Number(Math.max(2.5, state.quant.regime.atr).toFixed(2));
    const nextDist = target.trailingStopDistance ? null : atrTrail;
    set({
      confirmedPositions: state.confirmedPositions.map((p) =>
        p.id === positionId
          ? {
              ...p,
              trailingStopDistance: nextDist,
              executionLog: [
                ...p.executionLog,
                {
                  id: `ev-tr-${Date.now().toString(36)}`,
                  timeMs: Date.now(),
                  kind: 'TRAILING_SL' as const,
                  message: nextDist
                    ? `Auto ATR Trailing Stop ARMED ($${nextDist.toFixed(2)} distance)`
                    : 'Auto ATR Trailing Stop DISARMED',
                  price: state.tick.last,
                },
              ].slice(-16),
            }
          : p
      ),
      statusBanner: nextDist
        ? `Trailing Stop armed on ${target.orderId} ($${nextDist.toFixed(2)} ATR trail)`
        : `Trailing Stop disarmed on ${target.orderId}`,
    });
  },

  focusPosition: (focusedPositionId) => set({ focusedPositionId }),

  moveConfirmedPositionBreakEven: (positionId) => {
    const state = get();
    const updated = state.confirmedPositions.map((p) => {
      if (p.id !== positionId) return p;
      const isLong = p.direction === 'LONG';
      const beSl = Number((isLong ? p.entry + p.spread : p.entry - p.spread).toFixed(2));
      return {
        ...p,
        stopLoss: beSl,
        stage: 'RISK_FREE_TP1' as const,
        actionTag: 'HOLD_RUNNER' as const,
        urgency: 'NORMAL' as const,
        adviceEn: `Broker SL locked risk-free at ${beSl.toFixed(2)}. Trail runner smoothly toward TP2 ${p.tp2.toFixed(2)}.`,
        adviceFa: `حد ضرر بروکر در ${beSl.toFixed(2)} ریسک‌فری شد. بخش باقی‌مانده را بدون استرس تا TP2 در ${p.tp2.toFixed(2)} دنبال کنید.`,
        executionLog: [
          ...p.executionLog,
          {
            id: `ev-be-${Date.now().toString(36)}`,
            timeMs: Date.now(),
            kind: 'BE_LOCK' as const,
            message: `Manual Risk-Free BE lock applied -> SL $${beSl.toFixed(2)}`,
            price: state.tick.last,
          },
        ].slice(-16),
        history: [
          ...p.history,
          { timeMs: Date.now(), event: `LOCKED RISK-FREE BE (${beSl.toFixed(2)})`, price: state.tick.last },
        ],
      };
    });
    set({
      confirmedPositions: updated,
      statusBanner: `Position SL moved to Risk-Free Break-Even`,
    });
  },

  simulateConfirmedPositionStep: (positionId, target) => {
    const state = get();
    const p = state.confirmedPositions.find((item) => item.id === positionId);
    if (!p) return;
    const isLong = p.direction === 'LONG';
    const liveSpread = Math.max(0.24, state.tick.spread);
    const halfSpread = liveSpread / 2;
    let simPrice = state.tick.last;
    if (target === 'FILL_LIMIT') {
      // LONG limit fills when Ask <= entry; SHORT limit fills when Bid >= entry
      simPrice = Number((isLong ? p.entry - halfSpread - 0.12 : p.entry + halfSpread + 0.12).toFixed(2));
    } else if (target === 'HALF_TP1') {
      const midTarget = p.entry + (p.tp1 - p.entry) * 0.58;
      simPrice = Number((isLong ? midTarget + halfSpread : midTarget - halfSpread).toFixed(2));
    } else if (target === 'TP1') {
      // LONG exits/triggers on Bid >= tp1; SHORT triggers on Ask <= tp1
      simPrice = Number((isLong ? p.tp1 + halfSpread + 0.18 : p.tp1 - halfSpread - 0.18).toFixed(2));
    } else if (target === 'TP2') {
      simPrice = Number((isLong ? p.tp2 + halfSpread + 0.18 : p.tp2 - halfSpread - 0.18).toFixed(2));
    } else if (target === 'SL') {
      simPrice = Number((isLong ? p.stopLoss - halfSpread - 0.18 : p.stopLoss + halfSpread + 0.18).toFixed(2));
    }
    set({ focusedPositionId: positionId });
    get().applyTickUpdate({
      last: simPrice,
      bid: Number((simPrice - halfSpread).toFixed(2)),
      ask: Number((simPrice + halfSpread).toFixed(2)),
      spread: liveSpread,
    });
  },

  simulateMarketShock: (deltaUsd) => {
    const state = get();
    const nextLast = Number(Math.max(1000, state.tick.last + deltaUsd).toFixed(2));
    get().applyTickUpdate({
      last: nextLast,
      bid: Number((nextLast - state.tick.spread / 2).toFixed(2)),
      ask: Number((nextLast + state.tick.spread / 2).toFixed(2)),
      spread: state.tick.spread,
    });
  },

  resetSimAccount: (initialBalance = 25000) => {
    const fresh = createInitialSimAccount(initialBalance, 100, 7.0);
    const now = Date.now();
    set((s) => ({
      simAccount: fresh,
      sessionEquityHistory: createInitialEquityHistory(fresh.initialBalance, fresh.equity, now, now),
      confirmedPositions: [],
      closedTrades: [],
      closedConfirmedCount: 0,
      focusedPositionId: null,
      proposals: s.proposals.map((p) => (p.status === 'CONFIRMED' ? { ...p, status: 'PROPOSED' as const } : p)),
      statusBanner: `Simulated Broker Account reset to $${fresh.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })} (1:100 Leverage)`,
    }));
  },

  openPosition: (input) => {
    const state = get();
    if (state.newsGate.vetoNewEntries) {
      const errors = [
        `Entry vetoed by High-Impact USD News LOCKOUT (${state.newsGate.activeEvent?.title ?? 'Macro Release'})`,
      ];
      set({ lastGuardrailErrors: errors, statusBanner: errors[0] });
      return { ok: false, errors };
    }

    const guard = validateTradeGuardrails(
      input.direction,
      input.entry,
      input.stopLoss,
      input.tp1,
      input.tp2,
      state.quant.regime.atr
    );

    if (!guard.valid) {
      set({ lastGuardrailErrors: guard.errors });
      return { ok: false, errors: guard.errors };
    }

    const adjustedLot = Number(Math.max(0.01, input.lotSize * state.newsGate.lotMultiplier).toFixed(2));
    const pos: Position = {
      id: `pos-${Date.now().toString().slice(-4)}`,
      direction: input.direction,
      entry: Number(input.entry.toFixed(2)),
      initialSl: Number(input.stopLoss.toFixed(2)),
      stopLoss: Number(input.stopLoss.toFixed(2)),
      tp1: Number(input.tp1.toFixed(2)),
      tp2: Number(input.tp2.toFixed(2)),
      lotSize: adjustedLot,
      spread: state.tick.spread,
      stage: 'OPEN',
      rrRatio: guard.rrRatio,
      unrealizedPnl: 0,
      realizedPartial: false,
      openedAtMs: Date.now(),
      history: [{ timeMs: Date.now(), event: `OPENED ${input.direction} (${adjustedLot} lot)`, price: input.entry }],
    };

    const evaluated = stepHsmPosition(pos, state.tick.last).position;
    const advisory = buildSystem2Advisory(
      'POSITION_OPENED',
      state.tick.last,
      state.tick.spread,
      state.quant,
      state.newsGate,
      evaluated
    );

    set({
      position: evaluated,
      advisory,
      lastGuardrailErrors: [],
      statusBanner:
        state.newsGate.state === 'CAUTION'
          ? `Position opened at 50% Caution lot cap (${adjustedLot} lot) · R:R ${guard.rrRatio.toFixed(2)}`
          : `Position opened (${input.direction} ${adjustedLot} lot) · R:R ${guard.rrRatio.toFixed(2)}`,
    });
    return { ok: true, errors: [] };
  },

  placePendingLimit: (input) => {
    const state = get();
    if (state.newsGate.vetoNewEntries) {
      const errors = ['Pending limit blocked: USD News LOCKOUT active'];
      set({ lastGuardrailErrors: errors });
      return { ok: false, errors };
    }
    const guard = validateTradeGuardrails(
      input.direction,
      input.entry,
      input.stopLoss,
      input.tp1,
      input.tp2,
      state.quant.regime.atr
    );
    if (!guard.valid) {
      set({ lastGuardrailErrors: guard.errors });
      return { ok: false, errors: guard.errors };
    }
    const order: PendingLimitOrder = {
      id: `lim-${Date.now().toString().slice(-3)}`,
      direction: input.direction,
      entry: input.entry,
      stopLoss: input.stopLoss,
      tp1: input.tp1,
      tp2: input.tp2,
      lotSize: Number((input.lotSize * state.newsGate.lotMultiplier).toFixed(2)),
      status: 'PENDING_ENTRY',
    };
    set({
      pendingLimits: [order, ...state.pendingLimits],
      lastGuardrailErrors: [],
      statusBanner: `Limit order ${order.id} armed at $${order.entry.toFixed(2)}`,
    });
    return { ok: true, errors: [] };
  },

  closePosition: () => set({ position: null, statusBanner: 'Manual ticket position closed' }),

  movePositionBreakEven: () => {
    const state = get();
    if (!state.position) return;
    const isLong = state.position.direction === 'LONG';
    const beSl = Number((isLong ? state.position.entry + state.position.spread : state.position.entry - state.position.spread).toFixed(2));
    set({
      position: {
        ...state.position,
        stopLoss: beSl,
        stage: 'RISK_FREE_TP1',
        history: [
          ...state.position.history,
          { timeMs: Date.now(), event: `MANUAL_BE (SL -> ${beSl.toFixed(2)})`, price: state.tick.last },
        ],
      },
      statusBanner: `Stop loss locked at Break-Even $${beSl.toFixed(2)}`,
    });
  },

  simulatePositionStep: (target) => {
    const state = get();
    if (!state.position) return;
    const p = state.position;
    let simPrice = state.tick.last;
    if (target === 'HALF_TP1') {
      simPrice = Number((p.entry + (p.tp1 - p.entry) * 0.55).toFixed(2));
    } else if (target === 'TP1') {
      simPrice = Number((p.direction === 'LONG' ? p.tp1 + 0.15 : p.tp1 - 0.15).toFixed(2));
    } else {
      simPrice = Number((p.direction === 'LONG' ? p.tp2 + 0.15 : p.tp2 - 0.15).toFixed(2));
    }
    get().applyTickUpdate({ last: simPrice });
  },

  setNewsScenario: (mode) => {
    const state = get();
    const events = buildDefaultNews(mode);
    const gate = evaluateNewsGate(events, Date.now(), {
      highPreMin: state.agentConfig.newsHighImpactPreMin,
      highPostMin: state.agentConfig.newsHighImpactPostMin,
    });
    const nextQuant = analyzeQuantSnapshot(state.timeframe, state.candlesByTf, {
      newsGate: gate,
      basis: state.basisDivergence,
      spread: state.tick.spread,
      agentConfig: state.agentConfig,
      newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
    });
    const nextBreakers = evaluateRiskCircuitBreakers({
      config: state.agentConfig,
      simAccount: state.simAccount,
      confirmedPositions: state.confirmedPositions,
      closedTrades: state.closedTrades,
      spread: state.tick.spread,
      newsGate: gate,
      liveNews: state.liveNewsIntel,
      cooldownBypassAfterMs: state.cooldownBypassAfterMs,
    });
    const updatedLimits = gate.cancelPendingLimits
      ? state.pendingLimits.map((o) =>
          o.status === 'PENDING_ENTRY' ? { ...o, status: 'EXPIRED_OR_VETOED' as const } : o
        )
      : state.pendingLimits;

    const cancelledCount = gate.cancelPendingLimits
      ? state.pendingLimits.filter((o) => o.status === 'PENDING_ENTRY').length
      : 0;

    const advisory = buildSystem2Advisory(
      `NEWS_${gate.state}`,
      state.tick.last,
      state.tick.spread,
      nextQuant,
      gate,
      state.position
    );

    const updatedConfirmed = state.confirmedPositions.map((cp) =>
      evaluateConfirmedPositionAdvice(cp, state.tick.last, nextQuant, gate, state.basisDivergence)
    );

    set({
      manualNewsScenario: mode !== 'CLEAR',
      newsEvents: events,
      newsGate: gate,
      quant: nextQuant,
      circuitBreakers: nextBreakers,
      pendingLimits: updatedLimits,
      confirmedPositions: updatedConfirmed,
      advisory,
      statusBanner:
        gate.state === 'LOCKOUT'
          ? `News LOCKOUT activated (${gate.activeEvent?.title}) — Payam Brain switched to STAND DOWN & ${cancelledCount} pending limit(s) cancelled`
          : gate.state === 'CAUTION'
            ? `News CAUTION active (${gate.activeEvent?.title}) — position sizing capped at 50%`
            : 'News Gate cleared — normal institutional execution restored',
    });
  },

  triggerTripwireTest: (symbol) => {
    const state = get();
    const res = inspectSymbolTripwire(symbol);
    if (!res.allowed) {
      const nextBasis = evaluateBasisDivergence(state.tick.last, state.tick.last - 9.4);
      const nextQuant = analyzeQuantSnapshot(state.timeframe, state.candlesByTf, {
        newsGate: state.newsGate,
        basis: nextBasis,
        spread: state.tick.spread,
      });
      set({
        basisDivergence: nextBasis,
        quant: nextQuant,
        pipeline: {
          ...state.pipeline,
          activeTier: 2,
          sourceName: 'Binance PAXGUSDT',
          failoverCount: state.pipeline.failoverCount + 1,
          tripwireCount: state.pipeline.tripwireCount + 1,
          lastEventNote: res.reason,
        },
        statusBanner: res.reason,
      });
    }
  },

  triggerToxicSpikeTest: () => {
    const state = get();
    const spikePrice = Number((state.tick.last * 1.041).toFixed(2));
    const res = validateToxicSpike(spikePrice, spikePrice - 0.2, spikePrice + 0.2, state.tick.last);
    if (!res.accepted) {
      set({
        pipeline: {
          ...state.pipeline,
          rejectedSpikes: state.pipeline.rejectedSpikes + 1,
          lastEventNote: res.reason,
        },
        statusBanner: res.reason,
      });
    }
  },

  restoreTier1: () =>
    set((s) => {
      const nextBasis = evaluateBasisDivergence(s.tick.last, s.tick.last - 1.25);
      const nextQuant = analyzeQuantSnapshot(s.timeframe, s.candlesByTf, {
        newsGate: s.newsGate,
        basis: nextBasis,
        spread: s.tick.spread,
      });
      return {
        basisDivergence: nextBasis,
        quant: nextQuant,
        pipeline: {
          ...s.pipeline,
          activeTier: 1,
          sourceName: 'Interbank XAU/USD',
          lastEventNote: 'Tier 1 Interbank XAU/USD stream verified & restored',
        },
        statusBanner: 'Restored Tier 1 Interbank XAU/USD primary feed',
      };
    }),

  runSystem2Reasoning: (reason = 'MANUAL_COPILOT_DISPATCH') => {
    const state = get();
    const advisory = buildSystem2Advisory(
      reason,
      state.tick.last,
      state.tick.spread,
      state.quant,
      state.newsGate,
      state.position ?? state.confirmedPositions[0] ?? null
    );
    set({
      advisory,
      statusBanner: `System 2 job ${advisory.jobId} completed · Verdict ${advisory.verdict} (Anti-hallucination verified)`,
    });
  },

  run18GateVerification: () => {
    const state = get();
    const results = run18GateAudit(state.candlesByTf);
    const passed = results.filter((r) => r.passed).length;
    set({
      auditResults: results,
      statusBanner: `18-Gate Institutional Audit completed: ${passed}/${results.length} gates passed`,
    });
  },

  clearBanner: () => set({ statusBanner: null }),
}));
