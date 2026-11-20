import { create } from 'zustand';
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
  TIMEFRAME_SECONDS,
  validateToxicSpike,
  validateTradeGuardrails,
} from '../engine/smcQuant';
import {
  calculateRequiredMargin,
  createInitialSimAccount,
  executePartialClose,
  generateSeedClosedTrades,
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
  BasisDivergence,
  Candle,
  CircuitBreakerSnapshot,
  ClosedTradeRecord,
  ConfirmedPosition,
  GateAuditResult,
  LiveNewsIntelligence,
  NewsEvent,
  NewsGateStatus,
  OrderExecutionType,
  PendingLimitOrder,
  PipelineStatus,
  Position,
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
  feedMode: 'LIVE_INTERBANK' | 'REPLAY_SIM';
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

  // Phase 2 & 3: Payam Autonomous Agentic Engine & Comprehensive Real-Broker Simulator
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
  applyTickUpdate: (rawTick?: Partial<Tick>, paxgRefPrice?: number) => void;
  hydrateRealCandles: (force?: boolean) => Promise<void>;
  pollLiveMarket: () => Promise<void>;
  pollLiveNews: (force?: boolean) => Promise<void>;

  // Governance & Safety Actions
  toggleKillSwitch: () => void;
  updateAgentConfig: (partial: Partial<AgentConfig>) => void;
  resetAgentConfig: () => void;
  resetLossCooldown: () => void;

  // Autonomous Agentic Model & Real-Broker Simulation Actions
  toggleAgentEnabled: () => void;
  setAgentMode: (mode: AgentEngineMode) => void;
  runAgentScanCycle: (opts?: { quantOnly?: boolean }) => Promise<void>;
  confirmProposal: (
    proposalId: string,
    optionsOrLot?:
      | number
      | {
          lotSize?: number;
          executionType?: OrderExecutionType;
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

function buildInitialCandles(anchorPrice = 2742.6): Record<Timeframe, Candle[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    M1: generateSeedSeries('M1', 110, anchorPrice, nowSec),
    M5: generateSeedSeries('M5', 110, anchorPrice, nowSec),
    M15: generateSeedSeries('M15', 110, anchorPrice, nowSec),
    M30: generateSeedSeries('M30', 110, anchorPrice, nowSec),
    H1: generateSeedSeries('H1', 110, anchorPrice, nowSec),
    H4: generateSeedSeries('H4', 110, anchorPrice, nowSec),
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
  return [
    normalizeNews({
      id: 'ev-claims',
      title: 'US Initial Jobless Claims',
      currency: 'USD',
      impact: 'MEDIUM',
      scheduledAtMs: now + 48 * min,
      forecast: '215K',
      previous: '218K',
    }),
    normalizeNews({
      id: 'ev-cpi',
      title: 'US Core CPI (MoM)',
      currency: 'USD',
      impact: 'HIGH',
      scheduledAtMs: now + 135 * min,
      forecast: '0.3%',
      previous: '0.3%',
    }),
    normalizeNews({
      id: 'ev-fomc',
      title: 'FOMC Press Conference',
      currency: 'USD',
      impact: 'HIGH',
      scheduledAtMs: now + 290 * min,
      forecast: '—',
      previous: '—',
    }),
  ];
}

const initialCandles = buildInitialCandles(2742.6);
const initialNews = buildDefaultNews('CLEAR');
const initialNewsGate = evaluateNewsGate(initialNews);
const initialTick = normalizeTick({
  symbol: 'XAUUSD',
  last: 2742.6,
  bid: 2742.48,
  ask: 2742.72,
  spread: 0.24,
  tier: 1,
  source: 'Interbank XAU/USD',
  seq: 1,
});
const initialBasis = evaluateBasisDivergence(initialTick.last, initialTick.last - 1.45);
const initialQuant = analyzeQuantSnapshot('M15', initialCandles, {
  newsGate: initialNewsGate,
  basis: initialBasis,
  spread: initialTick.spread,
});
const initialAdvisory = buildSystem2Advisory(
  'BOOT_SNAPSHOT',
  initialTick.last,
  initialTick.spread,
  initialQuant,
  initialNewsGate,
  null
);

function seedInitialProposals(
  spot: number,
  quant: QuantSnapshot,
  newsGate: NewsGateStatus,
  basis: BasisDivergence,
  baseBalance = 25000
): {
  proposals: AgentProposal[];
  confirmed: ConfirmedPosition[];
  closedTrades: ClosedTradeRecord[];
  account: SimAccountState;
  equityHistory: SessionEquityPoint[];
} {
  const nowMs = Date.now();
  const seedOpts = { allowCautionVariant: true, spread: initialTick.spread };
  const p0 = generateQuantProposal(spot, 'M15', quant, newsGate, basis, 0, seedOpts);
  const p1 = generateQuantProposal(spot, 'M5', quant, newsGate, basis, 1, seedOpts);
  const p2 = generateQuantProposal(spot, 'H1', quant, newsGate, basis, 2, seedOpts);
  const p3 = generateQuantProposal(spot, 'M15', quant, newsGate, basis, 3, seedOpts);

  const proposals: AgentProposal[] = [];
  const confirmed: ConfirmedPosition[] = [];
  const seedHistory = generateSeedClosedTrades(spot, baseBalance, nowMs, 7.0);
  let account = seedHistory.account;
  let equityHistory: SessionEquityPoint[] = [];
  for (const pt of seedHistory.equityTrail) {
    equityHistory = appendSessionEquityPoint(equityHistory, pt.equity, pt.peakEquity, pt.timeMs);
  }

  if (p0) {
    const confirmedP0: AgentProposal = { ...p0, id: 'prop-seed-01', status: 'CONFIRMED', createdAtMs: Date.now() - 24 * 60_000 };
    proposals.push(confirmedP0);
    const seedEntry = Number((p0.direction === 'LONG' ? spot - 2.4 : spot + 2.4).toFixed(2));
    const slDist = Math.abs(p0.entry - p0.stopLoss);
    const seedSl = Number((p0.direction === 'LONG' ? seedEntry - slDist : seedEntry + slDist).toFixed(2));
    const seedTp1 = Number((p0.direction === 'LONG' ? seedEntry + slDist * p0.rrRatio : seedEntry - slDist * p0.rrRatio).toFixed(2));
    const seedTp2 = Number((p0.direction === 'LONG' ? seedEntry + slDist * (p0.rrRatio + 1.1) : seedEntry - slDist * (p0.rrRatio + 1.1)).toFixed(2));
    const seedLot = 0.25;
    const isLong = confirmedP0.direction === 'LONG';
    const markPrice = isLong ? spot - 0.12 : spot + 0.12;
    const openComm = Number(((account.commissionPerLotRoundTurn / 2) * seedLot).toFixed(2));
    const grossPnl = Number(((isLong ? markPrice - seedEntry : seedEntry - markPrice) * seedLot * 100).toFixed(2));
    const marginUsed = calculateRequiredMargin(seedEntry, seedLot, account.leverage);
    const riskUsd = Number((Math.abs(seedEntry - seedSl) * seedLot * 100).toFixed(2));
    const openedAtMs = Date.now() - 22 * 60_000;

    const basePos: ConfirmedPosition = {
      id: 'brk-seed-01',
      orderId: 'ORD-SEED01',
      proposalId: confirmedP0.id,
      setupType: confirmedP0.setupType,
      timeframe: confirmedP0.timeframe,
      executionType: 'MARKET',
      status: 'ACTIVE',
      direction: confirmedP0.direction,
      requestedEntry: seedEntry,
      entry: seedEntry,
      fillPrice: seedEntry,
      slippageUsd: 0.03,
      initialSl: seedSl,
      stopLoss: seedSl,
      tp1: seedTp1,
      tp2: seedTp2,
      initialLotSize: seedLot,
      lotSize: seedLot,
      spread: initialTick.spread,
      stage: 'OPEN',
      rrRatio: confirmedP0.rrRatio,
      unrealizedPnl: grossPnl,
      grossPnl,
      netPnl: grossPnl,
      realizedPnl: 0,
      commissionPaid: openComm,
      swapAccrued: 0,
      marginUsed,
      riskUsd,
      mfeUsd: Math.max(0, grossPnl),
      maeUsd: Math.min(0, grossPnl),
      trailingStopDistance: null,
      realizedPartial: false,
      openedAtMs,
      history: [{ timeMs: openedAtMs, event: `FILLED ${confirmedP0.direction} ${seedLot.toFixed(2)} lot @ ${seedEntry.toFixed(2)}`, price: seedEntry }],
      executionLog: [
        {
          id: 'ev-seed-fill',
          timeMs: openedAtMs,
          kind: 'FILL',
          message: `Market filled ${confirmedP0.direction} ${seedLot.toFixed(2)} lot @ $${seedEntry.toFixed(2)} (slip $0.03, comm $${openComm.toFixed(2)})`,
          price: seedEntry,
        },
      ],
      rMultiple: 0,
      urgency: 'NORMAL',
      actionTag: 'HOLD_RUNNER',
      adviceEn: '',
      adviceFa: '',
      lastReviewedMs: Date.now(),
    };
    const evaluated = {
      ...evaluateConfirmedPositionAdvice(basePos, markPrice, quant, newsGate, basis),
      grossPnl,
      netPnl: grossPnl,
      unrealizedPnl: grossPnl,
      mfeUsd: Math.max(0, grossPnl),
      maeUsd: Math.min(0, grossPnl),
    };
    confirmed.push(evaluated);
    account = reconcileSimAccount(
      {
        ...account,
        balance: Number((account.balance - openComm).toFixed(2)),
        realizedPnl: Number((account.realizedPnl - openComm).toFixed(2)),
        totalCommissionPaid: Number((account.totalCommissionPaid + openComm).toFixed(2)),
      },
      confirmed
    );
    equityHistory = appendSessionEquityPoint(equityHistory, account.equity, account.peakEquity, nowMs);
  }

  if (p1) proposals.push({ ...p1, id: 'prop-seed-02', createdAtMs: nowMs - 14 * 60_000 });
  if (p2) proposals.push({ ...p2, id: 'prop-seed-03', createdAtMs: nowMs - 7 * 60_000 });
  if (p3) proposals.push({ ...p3, id: 'prop-seed-04', createdAtMs: nowMs - 2 * 60_000 });

  return { proposals, confirmed, closedTrades: seedHistory.closedTrades, account, equityHistory };
}

const seeded = seedInitialProposals(initialTick.last, initialQuant, initialNewsGate, initialBasis);
const initialAgentConfig = loadPersistedAgentConfig();
const initialLiveNewsIntel = buildInitialNewsIntelligence(initialNews);
const initialCircuitBreakers = evaluateRiskCircuitBreakers({
  config: initialAgentConfig,
  simAccount: seeded.account,
  confirmedPositions: seeded.confirmed,
  closedTrades: seeded.closedTrades,
  spread: initialTick.spread,
  newsGate: initialNewsGate,
  liveNews: initialLiveNewsIntel,
});
const initialAuditLog: AgentAuditEntry[] = [
  createAuditEntry(
    'CONFIG',
    'INFO',
    'Payam Institutional Governance Booted',
    `7 Risk Circuit Breakers armed · Min Score ${initialAgentConfig.minConfluenceScore}/100 · Max DD ${initialAgentConfig.maxDailyDrawdownPct.toFixed(1)}% · 14 Core Gold News sources registered.`
  ),
];

export const useAurumStore = create<AurumStore>((set, get) => ({
  activeTab: 'deck',
  timeframe: 'M15',
  streaming: true,
  vectorModalOpen: false,
  candlesByTf: initialCandles,
  tick: initialTick,
  feedMode: 'REPLAY_SIM',
  basisDivergence: initialBasis,
  quant: initialQuant,
  position: null,
  pendingLimits: [
    {
      id: 'lim-101',
      direction: 'LONG',
      entry: 2736.5,
      stopLoss: 2731.0,
      tp1: 2746.5,
      tp2: 2756.0,
      lotSize: 0.2,
      status: 'PENDING_ENTRY',
    },
  ],
  newsEvents: initialNews,
  newsGate: initialNewsGate,
  advisory: initialAdvisory,
  pipeline: {
    activeTier: 1,
    sourceName: 'Interbank XAU/USD',
    ttlMs: 140,
    loopLagP99Ms: 1.45,
    failoverCount: 0,
    tripwireCount: 0,
    rejectedSpikes: 0,
    wsSequenceId: 1,
    lastEventNote: 'Tier 1 interbank spot reference nominal',
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
  agentScanCount: 1,
  lastAgentScanMs: Date.now(),
  activeTools: AGENT_TOOLS,
  proposals: seeded.proposals,
  confirmedPositions: seeded.confirmed,
  closedTrades: seeded.closedTrades,
  closedConfirmedCount: seeded.closedTrades.length,
  focusedPositionId: seeded.confirmed[0]?.id ?? null,
  simAccount: seeded.account,
  sessionEquityHistory: seeded.equityHistory,

  agentConfig: initialAgentConfig,
  circuitBreakers: initialCircuitBreakers,
  liveNewsIntel: initialLiveNewsIntel,
  newsRefreshing: false,
  manualNewsScenario: false,
  controlCenterOpen: false,
  cooldownBypassAfterMs: null,
  agentAuditLog: initialAuditLog,
  candleSourceMeta: {
    source: 'Local Seed (Syncing Online...)',
    rawFeed: 'SEED',
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

  hydrateRealCandles: async (force = false) => {
    const startState = get();
    if (startState.candleSourceMeta.hydrating && !force) return;
    set({
      candleSourceMeta: { ...startState.candleSourceMeta, hydrating: true },
    });

    try {
      const res = await fetch(`/api/candles/bundle?limit=240${force ? '&force=1' : ''}`);
      if (!res.ok) {
        set((s) => ({ candleSourceMeta: { ...s.candleSourceMeta, hydrating: false } }));
        return;
      }
      const data = await res.json();
      if (!data?.ok || !data?.candlesByTf) {
        set((s) => ({ candleSourceMeta: { ...s.candleSourceMeta, hydrating: false } }));
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
        set((s) => ({ candleSourceMeta: { ...s.candleSourceMeta, hydrating: false } }));
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

      const wasUnrebased = !state.candleSourceMeta.liveHistorical && Math.abs(spot - state.tick.last) > 25;
      const onlySeedPositions =
        state.confirmedPositions.length <= 1 &&
        (state.confirmedPositions.length === 0 || state.confirmedPositions[0].id === 'brk-seed-01');

      const rebasedPendingLimits = state.pendingLimits.map((lim) => {
        if (!wasUnrebased && Math.abs(lim.entry - spot) <= 120) return lim;
        const delta = spot - state.tick.last;
        return {
          ...lim,
          entry: Number((lim.entry + delta).toFixed(2)),
          stopLoss: Number((lim.stopLoss + delta).toFixed(2)),
          tp1: Number((lim.tp1 + delta).toFixed(2)),
          tp2: Number((lim.tp2 + delta).toFixed(2)),
        };
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

      if (wasUnrebased && onlySeedPositions) {
        const rebasedSeeds = seedInitialProposals(spot, nextQuant, state.newsGate, nextBasis, state.simAccount.initialBalance);
        const rebasedAdvisory = buildSystem2Advisory(
          'LIVE_CANDLES_HYDRATED',
          spot,
          spread,
          nextQuant,
          state.newsGate,
          rebasedSeeds.confirmed[0] ?? null
        );
        const nextBreakers = evaluateRiskCircuitBreakers({
          config: state.agentConfig,
          simAccount: rebasedSeeds.account,
          confirmedPositions: rebasedSeeds.confirmed,
          closedTrades: rebasedSeeds.closedTrades,
          spread,
          newsGate: state.newsGate,
          liveNews: state.liveNewsIntel,
          cooldownBypassAfterMs: state.cooldownBypassAfterMs,
        });
        set({
          feedMode: 'LIVE_INTERBANK',
          candlesByTf: mergedByTf,
          quant: nextQuant,
          basisDivergence: nextBasis,
          pendingLimits: rebasedPendingLimits,
          proposals: rebasedSeeds.proposals,
          confirmedPositions: rebasedSeeds.confirmed,
          closedTrades: rebasedSeeds.closedTrades,
          closedConfirmedCount: rebasedSeeds.closedTrades.length,
          simAccount: rebasedSeeds.account,
          sessionEquityHistory: rebasedSeeds.equityHistory,
          circuitBreakers: nextBreakers,
          advisory: rebasedAdvisory,
          focusedPositionId: rebasedSeeds.confirmed[0]?.id ?? null,
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
            lastEventNote: `Hydrated 240 real calibrated bars/TF (${nextMeta.source})`,
          },
        });
        return;
      }

      set({
        feedMode: 'LIVE_INTERBANK',
        candlesByTf: mergedByTf,
        quant: nextQuant,
        basisDivergence: nextBasis,
        pendingLimits: rebasedPendingLimits,
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
          lastEventNote: `Synced live multi-TF candles (${nextMeta.source})`,
        },
      });
    } catch {
      set((s) => ({ candleSourceMeta: { ...s.candleSourceMeta, hydrating: false } }));
    }
  },

  pollLiveMarket: async () => {
    try {
      const res = await fetch('/api/market/live');
      if (!res.ok) return;
      const data = await res.json();
      const spotObj = data?.spot ?? data?.interbank;
      const spotPrice = Number(spotObj?.mid ?? spotObj?.last);
      if (!data?.live || !Number.isFinite(spotPrice) || spotPrice <= 0) {
        if (get().feedMode !== 'REPLAY_SIM') {
          set({ feedMode: 'REPLAY_SIM' });
        }
        return;
      }

      const spot = Number(spotPrice.toFixed(2));
      const bid = Number((spotObj?.bid ?? spot - 0.14).toFixed(2));
      const ask = Number((spotObj?.ask ?? spot + 0.14).toFixed(2));
      const spread = Number((spotObj?.spread ?? Math.max(0.05, ask - bid)).toFixed(2));
      const paxgRaw = data?.paxg?.mid ?? data?.paxg?.last;
      const paxgLast = typeof paxgRaw === 'number' && Number.isFinite(paxgRaw) ? Number(paxgRaw.toFixed(2)) : spot;
      const sourceLabel = spotObj?.source || 'Swissquote Interbank BBO';
      const storageBackend = data?.storageBackend === 'timescaledb' ? 'timescaledb' : 'memory';

      const state = get();
      if (state.candleSourceMeta.storageBackend !== storageBackend) {
        set({ candleSourceMeta: { ...state.candleSourceMeta, storageBackend } });
      }

      // If first real live price differs significantly from bootstrap seed anchor and real candles haven't hydrated yet, rebase cleanly
      if (state.feedMode === 'REPLAY_SIM' && !state.candleSourceMeta.liveHistorical && Math.abs(spot - state.tick.last) > 25) {
        const rebasedCandles = buildInitialCandles(spot);
        const rebasedBasis = evaluateBasisDivergence(spot, paxgLast);
        const rebasedQuant = analyzeQuantSnapshot(state.timeframe, rebasedCandles, {
          newsGate: state.newsGate,
          basis: rebasedBasis,
          spread,
          agentConfig: state.agentConfig,
          newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
        });
        const rebasedSeeds = seedInitialProposals(spot, rebasedQuant, state.newsGate, rebasedBasis, state.simAccount.initialBalance);
        const delta = spot - state.tick.last;
        const rebasedPendingLimits = state.pendingLimits.map((lim) => ({
          ...lim,
          entry: Number((lim.entry + delta).toFixed(2)),
          stopLoss: Number((lim.stopLoss + delta).toFixed(2)),
          tp1: Number((lim.tp1 + delta).toFixed(2)),
          tp2: Number((lim.tp2 + delta).toFixed(2)),
        }));
        const rebasedAdvisory = buildSystem2Advisory(
          'LIVE_INTERBANK_REBASE',
          spot,
          spread,
          rebasedQuant,
          state.newsGate,
          rebasedSeeds.confirmed[0] ?? null
        );
        set({
          feedMode: 'LIVE_INTERBANK',
          candlesByTf: rebasedCandles,
          quant: rebasedQuant,
          basisDivergence: rebasedBasis,
          pendingLimits: rebasedPendingLimits,
          proposals: rebasedSeeds.proposals,
          confirmedPositions: rebasedSeeds.confirmed,
          closedTrades: rebasedSeeds.closedTrades,
          closedConfirmedCount: rebasedSeeds.closedTrades.length,
          simAccount: rebasedSeeds.account,
          sessionEquityHistory: rebasedSeeds.equityHistory,
          advisory: rebasedAdvisory,
          focusedPositionId: rebasedSeeds.confirmed[0]?.id ?? null,
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
            lastEventNote: `Live ${sourceLabel} synchronized with Binance PAXGUSDT basis monitor`,
          },
        });
        // Immediately trigger deep real historical candle hydration in parallel
        void get().hydrateRealCandles();
        return;
      }

      set({ feedMode: 'LIVE_INTERBANK' });
      get().applyTickUpdate(
        {
          last: spot,
          bid,
          ask,
          spread,
          tier: 1,
          source: sourceLabel,
        },
        paxgLast
      );
    } catch {
      // Offline / network restricted sandbox: stay gracefully in local replay simulation
    }
  },

  applyTickUpdate: (rawTick, paxgRefPrice) => {
    const state = get();
    const drift = (Math.random() - 0.485) * 0.55;
    const nextPrice = Number((rawTick?.last ?? state.tick.last + drift).toFixed(2));
    const nextBid = Number((rawTick?.bid ?? nextPrice - 0.12).toFixed(2));
    const nextAsk = Number((rawTick?.ask ?? nextPrice + 0.12).toFixed(2));
    const nextSeq = state.pipeline.wsSequenceId + 1;
    const nextTick = normalizeTick(
      {
        ...rawTick,
        last: nextPrice,
        bid: nextBid,
        ask: nextAsk,
        spread: rawTick?.spread ?? Number(Math.max(0.05, nextAsk - nextBid).toFixed(2)),
        tier: rawTick?.tier ?? state.pipeline.activeTier,
        source: rawTick?.source ?? state.pipeline.sourceName,
        seq: nextSeq,
        timestampMs: Date.now(),
      },
      state.tick.last
    );

    // Update live forming candle across all timeframes
    const nowSec = Math.floor(nextTick.timestampMs / 1000);
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
            volume: 12,
          })
        );
        if (series.length > 300) series.shift();
      } else {
        series[series.length - 1] = normalizeCandle({
          ...last,
          high: Math.max(last.high, nextTick.last),
          low: Math.min(last.low, nextTick.last),
          close: nextTick.last,
          volume: last.volume + Math.round(2 + Math.random() * 6),
        });
      }
      updatedByTf[tf] = series;
    });

    const simPaxg =
      typeof paxgRefPrice === 'number'
        ? paxgRefPrice
        : Number((nextTick.last - (state.pipeline.activeTier === 2 ? 4.8 : 1.35) + (Math.random() - 0.5) * 0.9).toFixed(2));
    const nextBasis = evaluateBasisDivergence(nextTick.last, simPaxg);
    const nextQuant = analyzeQuantSnapshot(state.timeframe, updatedByTf, {
      newsGate: state.newsGate,
      basis: nextBasis,
      spread: nextTick.spread,
      nowMs: nextTick.timestampMs,
      agentConfig: state.agentConfig,
      newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
    });

    let nextPos = state.position;
    let nextAdvisory = state.advisory;
    let banner = state.statusBanner;

    if (nextPos) {
      const hsm = stepHsmPosition(nextPos, nextTick.last, nextTick.timestampMs);
      nextPos = normalizePosition(hsm.position);
      if (hsm.event) {
        banner = `HSM transition: ${hsm.event} @ $${nextTick.last.toFixed(2)}`;
        nextAdvisory =
          normalizeAdvisory(
            buildSystem2Advisory(hsm.event, nextTick.last, nextTick.spread, nextQuant, state.newsGate, nextPos)
          ) ?? state.advisory;
      }
    }

    // Continuously simulate & monitor EVERY confirmed broker position on every live Bid/Ask tick
    const simStep = stepSimulatedPositions(
      state.confirmedPositions,
      state.simAccount,
      nextTick,
      nextQuant,
      state.newsGate,
      nextBasis,
      nextTick.timestampMs
    );

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
            nextTick.timestampMs
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
      nowMs: nextTick.timestampMs,
    });

    const jitterLag = Number((1.15 + Math.random() * 0.65).toFixed(2));
    set({
      tick: nextTick,
      candlesByTf: updatedByTf,
      quant: nextQuant,
      basisDivergence: nextBasis,
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
        sourceName: rawTick?.source ?? state.pipeline.sourceName,
        ttlMs: Math.round(85 + Math.random() * 130),
        loopLagP99Ms: jitterLag,
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

    set({ agentBusy: true, agentError: null, circuitBreakers: liveBreakers });
    const scanIdx = state.agentScanCount + 1;

    try {
      let createdProposal: AgentProposal | null = null;
      let standDownMessage: string | null = null;
      let apiNotice: string | null = null;
      let geminiCallSucceeded = false;

      // Refresh deterministic Payam Brain snapshot immediately before proposing
      const liveQuant = analyzeQuantSnapshot(state.timeframe, state.candlesByTf, {
        newsGate: state.newsGate,
        basis: state.basisDivergence,
        spread: state.tick.spread,
        agentConfig: state.agentConfig,
        newsShock: { detected: state.liveNewsIntel.shockDetected, headline: state.liveNewsIntel.shockHeadline },
      });

      // Attempt real server-side Gemini agentic tool reasoning when not explicitly quantOnly and not MCP-only
      if (!opts?.quantOnly && state.agentMode !== 'ANTIGRAVITY_MCP') {
        const res = await fetch('/api/agent/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
        if (res.ok && payload?.ok && payload.decision === 'STAND_DOWN') {
          geminiCallSucceeded = true;
          standDownMessage =
            payload.standDownReasonEn ||
            liveQuant.brain.summaryEn ||
            'Payam Brain enforced STAND DOWN — anti-emotion shield active.';
        } else if (res.ok && payload?.ok && payload.proposal) {
          geminiCallSucceeded = true;
          createdProposal = payload.proposal as AgentProposal;
        } else {
          apiNotice =
            payload?.error ||
            `Gemini API returned HTTP ${res.status}. Configure GEMINI_API_KEY in Secrets or use System 1 Quant Scan.`;
        }
      }

      // In HYBRID mode (default), gracefully fall back to deterministic Payam Brain Engine when Gemini API key is not configured or rate-limited
      const allowQuantFallback =
        !standDownMessage &&
        (Boolean(opts?.quantOnly) ||
          state.agentMode === 'ANTIGRAVITY_MCP' ||
          state.agentMode === 'HYBRID');

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

      // Apply circuit-breaker risk throttle multiplier onto proposal recommendation
      if (createdProposal && liveBreakers.effectiveRiskMultiplier < 1) {
        createdProposal = {
          ...createdProposal,
          recommendedRiskMultiplier: Number(
            Math.min(createdProposal.recommendedRiskMultiplier ?? 1, liveBreakers.effectiveRiskMultiplier).toFixed(2)
          ),
        };
      }

      // Also refresh Gemini monitoring advice on confirmed open broker positions ONLY when Gemini upstream succeeded
      let monitoredPositions = get().confirmedPositions.map((cp) =>
        evaluateConfirmedPositionAdvice(cp, get().tick.last, liveQuant, get().newsGate, get().basisDivergence)
      );

      if (!opts?.quantOnly && state.agentMode !== 'ANTIGRAVITY_MCP' && monitoredPositions.length > 0 && geminiCallSucceeded) {
        try {
          const monRes = await fetch('/api/agent/monitor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spotPrice: get().tick.last,
              quant: liveQuant,
              newsGate: get().newsGate,
              basis: get().basisDivergence,
              liveNews: {
                macroSentiment: get().liveNewsIntel.macroSentiment,
                shockHeadline: get().liveNewsIntel.shockHeadline,
              },
              positions: monitoredPositions.map((p) => ({
                id: p.id,
                direction: p.direction,
                entry: p.entry,
                stopLoss: p.stopLoss,
                tp1: p.tp1,
                tp2: p.tp2,
                stage: p.stage,
                rMultiple: p.rMultiple,
                unrealizedPnl: p.unrealizedPnl,
              })),
            }),
          });
          const monData = await monRes.json().catch(() => null);
          if (monRes.ok && monData?.ok && Array.isArray(monData.updates)) {
            const byId = new Map<string, any>(monData.updates.map((u: any) => [u.positionId, u]));
            monitoredPositions = monitoredPositions.map((pos) => {
              const upd = byId.get(pos.id);
              if (!upd) return pos;
              return {
                ...pos,
                actionTag: upd.actionTag || pos.actionTag,
                urgency: upd.urgency || pos.urgency,
                adviceEn: upd.adviceEn || pos.adviceEn,
                adviceFa: upd.adviceFa || pos.adviceFa,
                lastReviewedMs: Date.now(),
              };
            });
          }
        } catch {
          // Keep deterministic HSM monitoring advice if monitor call fails
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
            `${createdProposal.setupType} @ $${createdProposal.entry.toFixed(2)} · SL $${createdProposal.stopLoss.toFixed(2)} · TP1 $${createdProposal.tp1.toFixed(2)} (R:R 1:${createdProposal.rrRatio.toFixed(2)})`
          )
        : createAuditEntry(
            'STAND_DOWN',
            'INFO',
            `Disciplined STAND DOWN (${liveQuant.brain.totalScore}/100)`,
            standDownMessage || liveQuant.brain.summaryEn
          );

      set({
        agentBusy: false,
        agentScanCount: scanIdx,
        lastAgentScanMs: Date.now(),
        agentError: apiNotice,
        quant: liveQuant,
        proposals: nextProposals,
        confirmedPositions: monitoredPositions,
        agentAuditLog: [auditEntry, ...get().agentAuditLog].slice(0, 40),
        statusBanner: createdProposal
          ? `Payam Brain [${createdProposal.convictionGrade ?? 'A'} · ${createdProposal.confluenceScore ?? Math.round(createdProposal.confidence * 100)}/100] proposed ${createdProposal.direction} ${createdProposal.setupType} @ $${createdProposal.entry.toFixed(2)} (R:R 1:${createdProposal.rrRatio.toFixed(2)})`
          : standDownMessage
            ? `Payam Brain STAND DOWN (${liveQuant.brain.totalScore}/100): ${standDownMessage}`
            : apiNotice
              ? `Gemini scan notice: ${apiNotice}`
              : get().statusBanner,
      });
    } catch (err: any) {
      set({
        agentBusy: false,
        agentError: err?.message || 'Agentic scan request failed.',
      });
    }
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

    const rawLotSize = typeof optionsOrLot === 'number' ? optionsOrLot : (optionsOrLot.lotSize ?? 0.2);
    const lotSize = Number(Math.max(0.01, rawLotSize * breakers.effectiveRiskMultiplier).toFixed(2));
    const executionType: OrderExecutionType =
      typeof optionsOrLot === 'number' ? 'MARKET' : (optionsOrLot.executionType ?? 'MARKET');
    const trailingStopDistance =
      typeof optionsOrLot === 'number' ? null : (optionsOrLot.trailingStopDistance ?? null);

    const sim = simulateOpenTrade({
      proposal: target,
      lotSize,
      executionType,
      trailingStopDistance,
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

    const updatedProposals = state.proposals.map((p) =>
      p.id === proposalId ? { ...p, status: 'CONFIRMED' as const } : p
    );

    const pos = sim.position;
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
          `${pos.setupType} @ $${pos.fillPrice.toFixed(2)} · SL $${pos.stopLoss.toFixed(2)} · TP1 $${pos.tp1.toFixed(2)}`
        ),
        ...state.agentAuditLog,
      ].slice(0, 40),
      statusBanner:
        pos.status === 'PENDING_LIMIT'
          ? `Order ${pos.orderId} armed: ${pos.direction} LIMIT ${pos.lotSize.toFixed(2)} lot @ $${pos.entry.toFixed(2)} — awaiting touch`
          : `Executed ${pos.orderId}: ${pos.direction} ${pos.lotSize.toFixed(2)} lot @ $${pos.fillPrice.toFixed(2)} (Margin $${pos.marginUsed.toFixed(0)} · Slip $${pos.slippageUsd.toFixed(2)})`,
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
