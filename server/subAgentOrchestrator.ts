/**
 * Zero-Latency 5-Sub-Agent Parallel Orchestrator (Squad 2)
 *
 * Implements the mandatory `+++Reasoning` System-2 cognitive pipeline across 5 specialized sub-agents:
 *   1. Macro & News Sentinel Sub-Agent (Background 45s loop -> zero-latency cached MacroRegimeBrief)
 *   2. SMC & Orderflow Sniper Analyst Sub-Agent (Full 5-stage ICT payload -> LIMIT/MARKET proposal)
 *   3. Adversarial Red-Team Challenger Sub-Agent (Runs IN PARALLEL with Sub-Agent 2 via Promise.all)
 *   4. Chief Execution Judge Sub-Agent (Synthesizes SA1 + SA2 + SA3 + System-1 pillars -> Fact Ledger)
 *   5. Live Position Guardian Sub-Agent (Powers POST /api/agent/monitor with structured directives)
 */

import { EventEmitter } from 'events';
import { Type } from '@google/genai';
import {
  aiProviderHub,
  type AiProviderMode,
  type SubAgentId,
} from './aiProviderHub.ts';
import {
  computeMinStopDistance,
  verifyProposalAgainstFactLedger,
  type FactLedgerContext,
  type FactLedgerVerificationResult,
} from './factLedger.ts';
import type {
  LiveNewsIntelligence,
  NewsGateStatus,
  ScoredNewsHeadline,
} from '../src/engine/types.ts';

export type MacroRegimeLabel =
  | 'CLEAR_TAILWIND'
  | 'NEUTRAL'
  | 'MACRO_HEADWIND'
  | 'SHOCK_LOCKOUT';

export interface MacroRegimeBrief {
  regime: MacroRegimeLabel;
  goldBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  keyDrivers: string[];
  riskWarningEn: string;
  riskWarningFa: string;
  thinkingTrace: string;
  source: 'AI_SUB_AGENT' | 'DETERMINISTIC_CACHE';
  modelUsed?: string;
  providerMode?: AiProviderMode;
  latencyMs: number;
  updatedAtMs: number;
}

export interface SniperAnalystOutput {
  decision: 'PROPOSE' | 'STAND_DOWN';
  direction: 'LONG' | 'SHORT';
  orderType: 'LIMIT' | 'MARKET';
  setupType: string;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  invalidationPrice: number;
  ttlBars: number;
  confidence: number;
  rationaleEn: string;
  rationaleFa: string;
  toolsUsed: string[];
  thinkingTrace: string;
  latencyMs: number;
  modelUsed?: string;
  providerMode?: AiProviderMode;
  skipped?: boolean;
}

export interface RedTeamChallengerOutput {
  vetoRecommended: boolean;
  trapRiskScore: number; // 0..100
  fatalFlaws: string[];
  summaryEn: string;
  summaryFa: string;
  thinkingTrace: string;
  latencyMs: number;
  modelUsed?: string;
  providerMode?: AiProviderMode;
  skipped?: boolean;
}

export interface ChiefJudgeOutput {
  decision: 'PROPOSE' | 'STAND_DOWN';
  direction: 'LONG' | 'SHORT';
  orderType: 'LIMIT' | 'MARKET';
  setupType: string;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  invalidationPrice: number;
  ttlBars: number;
  confidence: number;
  rationaleEn: string;
  rationaleFa: string;
  standDownReasonEn: string;
  standDownReasonFa: string;
  toolsUsed: string[];
  thinkingTrace: string;
  latencyMs: number;
  modelUsed?: string;
  providerMode?: AiProviderMode;
  skipped?: boolean;
}

export type GuardianDirectiveKind =
  | 'HOLD_STEADY'
  | 'MOVE_SL_TO_BREAKEVEN'
  | 'PARTIAL_TAKE_PROFIT_TP1'
  | 'TRAIL_STOP_STRUCTURAL'
  | 'EMERGENCY_EXIT_NOW';

export type LegacyActionTag =
  | 'HOLD_RUNNER'
  | 'ARM_BE'
  | 'MOVE_SL_RF'
  | 'SCALE_PARTIAL'
  | 'PROTECT_NEWS'
  | 'EXIT_WARNING';

export interface PositionGuardianDirective {
  positionId: string;
  directive: GuardianDirectiveKind;
  recommendedSl: number | null;
  recommendedScaleOutPct: number;
  urgency: 'NORMAL' | 'ATTENTION' | 'CRITICAL';
  rationaleEn: string;
  rationaleFa: string;
  thinkingTrace: string;
  // Backward-compatible aliases for existing frontend store
  actionTag: LegacyActionTag;
  adviceEn: string;
  adviceFa: string;
}

export interface SubAgentTelemetryEvent {
  eventType:
    | 'PIPELINE_START'
    | 'SUB_AGENT_START'
    | 'SUB_AGENT_DONE'
    | 'SUB_AGENT_SKIPPED'
    | 'SUB_AGENT_ERROR'
    | 'FACT_LEDGER_CHECK'
    | 'PIPELINE_COMPLETE'
    | 'MACRO_CACHE_UPDATED';
  pipelineId: string;
  subAgentId: SubAgentId | 'factLedger' | 'orchestrator';
  subAgentStatus: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'ERROR';
  activeStage: string;
  latencyMs: number;
  modelUsed?: string;
  providerMode?: AiProviderMode;
  thinkingTrace?: string;
  summary?: string;
  timestampMs: number;
}

export interface ProposalPipelineInput {
  spotPrice: number;
  spread: number;
  timeframe: string;
  quant: Record<string, any>;
  newsGate?: NewsGateStatus | Record<string, any> | null;
  basis?: Record<string, any> | null;
  agentConfig?: Record<string, any> | null;
  circuitBreakers?: Record<string, any> | null;
  liveNews?: Partial<LiveNewsIntelligence> | Record<string, any> | null;
  forceDeepAudit?: boolean;
}

export interface ProposalPipelineResult {
  pipelineId: string;
  decision: 'PROPOSE' | 'STAND_DOWN';
  totalLatencyMs: number;
  macroBrief: MacroRegimeBrief;
  sniper: SniperAnalystOutput;
  redTeam: RedTeamChallengerOutput;
  judge: ChiefJudgeOutput;
  factLedger: FactLedgerVerificationResult | null;
  standDownReasonEn?: string;
  standDownReasonFa?: string;
  proposal?: {
    id: string;
    direction: 'LONG' | 'SHORT';
    orderType: 'LIMIT' | 'MARKET';
    setupType: string;
    timeframe: string;
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    invalidationPrice: number;
    ttlBars: number;
    rrRatio: number;
    confidence: number;
    rationaleEn: string;
    rationaleFa: string;
    thinkingTrace: string;
    toolsUsed: string[];
    engineSource: 'GEMINI_AGENT';
    status: 'PROPOSED';
    createdAtMs: number;
    confluenceScore?: number;
    convictionGrade?: string;
    h4Bias?: string;
    rsiSummary?: string;
    recommendedRiskMultiplier?: number;
    pillarBreakdown?: Array<{ label: string; score: number; maxScore: number }>;
    goldenConfluence?: boolean;
    counterTrendFlag?: boolean;
    factLedgerAudit?: {
      snapped: boolean;
      originalEntry: number;
      matchedAnchor: string | null;
      anchorDeltaUsd: number;
      auditSummary: string;
    };
    subAgentAudit?: {
      macroRegime: MacroRegimeLabel;
      redTeamTrapRiskScore: number;
      redTeamVetoRecommended: boolean;
      redTeamFatalFlaws: string[];
      pipelineLatencyMs: number;
    };
  };
}

export interface PositionMonitorInput {
  spotPrice: number;
  positions: Array<Record<string, any>>;
  quant?: Record<string, any> | null;
  newsGate?: Record<string, any> | null;
  basis?: Record<string, any> | null;
  liveNews?: Record<string, any> | null;
}

export interface PositionMonitorResult {
  pipelineId: string;
  directives: PositionGuardianDirective[];
  latencyMs: number;
  modelUsed?: string;
  providerMode?: AiProviderMode;
  macroBrief: MacroRegimeBrief;
}

/**
 * Mandatory System-2 `+++Reasoning` Cognitive Pipeline directive embedded into EVERY sub-agent prompt.
 */
export const SYSTEM2_REASONING_DIRECTIVE = [
  '+++Reasoning',
  '[MANDATORY SYSTEM-2 COGNITIVE PIPELINE]',
  'Before emitting any trade decision, numeric price level, veto, or management directive, you MUST execute slow, deterministic, mathematical System-2 verification and place your structured reasoning inside the JSON `thinkingTrace` field using ALL four XML stages:',
  '<thinking_process>',
  '  <triage>Classify active market regime, timeframe hierarchy, and hard constraints.</triage>',
  '  <blast_radius_assessment>Quantify downside risk, trap exposure, spread/ATR bounds, and invalidation failure modes.</blast_radius_assessment>',
  '  <resource_gathering>Cite exact numeric values from the provided deterministic JSON ledger (spotPrice, ATR, OB MT50, FVG CE50, OTE 0.618/0.705/0.790, RSI, liquidity pools, basis, news).</resource_gathering>',
  '  <surgical_strategy>Derive the exact execution plan or STAND_DOWN verdict with verified mathematical invariants.</surgical_strategy>',
  '</thinking_process>',
  'NEVER hallucinate prices not grounded in the provided ledger. NEVER violate LONG (SL < Entry < TP1 < TP2) or SHORT (SL > Entry > TP1 > TP2).',
].join('\n');

function normalizeThinkingTrace(
  rawTrace: unknown,
  rawReasoning: string | undefined,
  stageContext: {
    agentName: string;
    triage: string;
    blastRadius: string;
    resources: string;
    strategy: string;
  }
): string {
  const candidate = [typeof rawTrace === 'string' ? rawTrace.trim() : '', rawReasoning?.trim() ?? '']
    .filter(Boolean)
    .join('\n')
    .trim();

  if (
    candidate.includes('<thinking_process>') &&
    candidate.includes('<triage>') &&
    candidate.includes('<blast_radius_assessment>') &&
    candidate.includes('<resource_gathering>') &&
    candidate.includes('<surgical_strategy>')
  ) {
    return candidate;
  }

  const supplemental = candidate ? `\n  <!-- Raw model trace (${stageContext.agentName}): ${candidate.slice(0, 600)} -->` : '';
  return [
    '<thinking_process>',
    `  <triage>${stageContext.triage}</triage>`,
    `  <blast_radius_assessment>${stageContext.blastRadius}</blast_radius_assessment>`,
    `  <resource_gathering>${stageContext.resources}</resource_gathering>`,
    `  <surgical_strategy>${stageContext.strategy}</surgical_strategy>${supplemental}`,
    '</thinking_process>',
  ].join('\n');
}

function mapDirectiveToLegacyActionTag(directive: GuardianDirectiveKind, newsState?: string): LegacyActionTag {
  switch (directive) {
    case 'MOVE_SL_TO_BREAKEVEN':
      return 'ARM_BE';
    case 'PARTIAL_TAKE_PROFIT_TP1':
      return 'SCALE_PARTIAL';
    case 'TRAIL_STOP_STRUCTURAL':
      return 'MOVE_SL_RF';
    case 'EMERGENCY_EXIT_NOW':
      return newsState === 'LOCKOUT' ? 'PROTECT_NEWS' : 'EXIT_WARNING';
    case 'HOLD_STEADY':
    default:
      return 'HOLD_RUNNER';
  }
}

function normalizeGuardianDirective(raw: unknown): GuardianDirectiveKind {
  const upper = String(raw ?? '').toUpperCase().trim();
  const valid: GuardianDirectiveKind[] = [
    'HOLD_STEADY',
    'MOVE_SL_TO_BREAKEVEN',
    'PARTIAL_TAKE_PROFIT_TP1',
    'TRAIL_STOP_STRUCTURAL',
    'EMERGENCY_EXIT_NOW',
  ];
  if (valid.includes(upper as GuardianDirectiveKind)) return upper as GuardianDirectiveKind;
  if (upper.includes('EXIT') || upper.includes('EMERGENCY')) return 'EMERGENCY_EXIT_NOW';
  if (upper.includes('BREAKEVEN') || upper.includes('ARM_BE')) return 'MOVE_SL_TO_BREAKEVEN';
  if (upper.includes('PARTIAL') || upper.includes('TP1') || upper.includes('SCALE')) return 'PARTIAL_TAKE_PROFIT_TP1';
  if (upper.includes('TRAIL') || upper.includes('RF')) return 'TRAIL_STOP_STRUCTURAL';
  return 'HOLD_STEADY';
}

function normalizeUrgency(raw: unknown): 'NORMAL' | 'ATTENTION' | 'CRITICAL' {
  const upper = String(raw ?? '').toUpperCase().trim();
  if (upper === 'CRITICAL') return 'CRITICAL';
  if (upper === 'ATTENTION') return 'ATTENTION';
  return 'NORMAL';
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export class SubAgentOrchestrator extends EventEmitter {
  private macroBrief: MacroRegimeBrief;
  private macroTimer: NodeJS.Timeout | null = null;
  private macroRefreshing = false;
  private subAgentStates: Record<
    SubAgentId,
    { status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'SKIPPED' | 'ERROR'; latencyMs: number; lastRunMs: number | null; lastStage: string }
  >;

  constructor() {
    super();
    this.macroBrief = this.buildDeterministicMacroBrief(null, null);
    this.subAgentStates = {
      macroNewsSentinel: { status: 'IDLE', latencyMs: 0, lastRunMs: null, lastStage: 'WARM_CACHE' },
      smcSniperAnalyst: { status: 'IDLE', latencyMs: 0, lastRunMs: null, lastStage: 'STANDBY' },
      adversarialChallenger: { status: 'IDLE', latencyMs: 0, lastRunMs: null, lastStage: 'STANDBY' },
      chiefExecutionJudge: { status: 'IDLE', latencyMs: 0, lastRunMs: null, lastStage: 'STANDBY' },
      livePositionGuardian: { status: 'IDLE', latencyMs: 0, lastRunMs: null, lastStage: 'STANDBY' },
    };
  }

  public getCachedMacroBrief(): MacroRegimeBrief {
    return this.macroBrief;
  }

  public getSubAgentStatesSnapshot() {
    return {
      subAgents: { ...this.subAgentStates },
      macroBrief: this.macroBrief,
      timestampMs: Date.now(),
    };
  }

  private emitTelemetry(event: Omit<SubAgentTelemetryEvent, 'timestampMs'>): void {
    const full: SubAgentTelemetryEvent = {
      ...event,
      timestampMs: Date.now(),
    };
    if (event.subAgentId !== 'factLedger' && event.subAgentId !== 'orchestrator') {
      this.subAgentStates[event.subAgentId] = {
        status: event.subAgentStatus,
        latencyMs: event.latencyMs,
        lastRunMs: full.timestampMs,
        lastStage: event.activeStage,
      };
    }
    this.emit('telemetry', full);
  }

  /**
   * Starts Sub-Agent 1 (Macro & News Sentinel) background loop every 45s
   * so MacroRegimeBrief is always pre-warmed with ZERO latency at scalping trigger time.
   */
  public startMacroBackgroundLoop(
    newsFetcher: () => Promise<LiveNewsIntelligence>,
    intervalSecOverride?: number
  ): void {
    if (this.macroTimer) {
      clearInterval(this.macroTimer);
      this.macroTimer = null;
    }

    const sec = Math.max(
      15,
      intervalSecOverride ?? aiProviderHub.getRawConfig().macroPollIntervalSec ?? 45
    );

    const tick = async () => {
      try {
        const intel = await newsFetcher();
        await this.refreshMacroRegimeBrief(intel, null);
      } catch {
        // Keep last warm MacroRegimeBrief on transient network failure
      }
    };

    // Non-blocking warm-up shortly after boot
    setTimeout(() => {
      void tick();
    }, 1500);

    this.macroTimer = setInterval(() => {
      void tick();
    }, sec * 1000);
    this.macroTimer.unref?.();
  }

  public buildDeterministicMacroBrief(
    liveNews: Partial<LiveNewsIntelligence> | Record<string, any> | null,
    newsGate: NewsGateStatus | Record<string, any> | null
  ): MacroRegimeBrief {
    const nowMs = Date.now();
    const shock = Boolean(liveNews?.shockDetected) || newsGate?.state === 'LOCKOUT' || Boolean(newsGate?.vetoNewEntries);
    const sentiment = String(liveNews?.macroSentiment ?? 'NEUTRAL').toUpperCase();
    const score = Number(liveNews?.sentimentScore ?? 0);
    const headlines: ScoredNewsHeadline[] = Array.isArray(liveNews?.headlines) ? liveNews.headlines : [];

    let regime: MacroRegimeLabel = 'NEUTRAL';
    let goldBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';

    if (shock || sentiment === 'GEOPOLITICAL_SHOCK') {
      regime = 'SHOCK_LOCKOUT';
      goldBias = score > 10 ? 'BULLISH' : score < -10 ? 'BEARISH' : 'NEUTRAL';
    } else if (Math.abs(score) >= 28 || sentiment === 'BULLISH_GOLD' || sentiment === 'BEARISH_GOLD') {
      regime = newsGate?.state === 'CAUTION' ? 'MACRO_HEADWIND' : 'CLEAR_TAILWIND';
      goldBias = score >= 12 || sentiment === 'BULLISH_GOLD' ? 'BULLISH' : score <= -12 || sentiment === 'BEARISH_GOLD' ? 'BEARISH' : 'NEUTRAL';
    } else if (newsGate?.state === 'CAUTION') {
      regime = 'MACRO_HEADWIND';
    }

    const drivers = headlines.slice(0, 4).map((h) => `${h.sourceName}: ${h.title.slice(0, 90)}`);
    if (drivers.length === 0) {
      drivers.push('14-source macro wire nominal; no high-impact USD shock active.');
    }

    const riskWarningEn =
      regime === 'SHOCK_LOCKOUT'
        ? `MACRO SHOCK / LOCKOUT: ${liveNews?.shockHeadline || newsGate?.activeEvent?.title || 'High-impact event active — halt new entries.'}`
        : regime === 'MACRO_HEADWIND'
          ? 'Macro caution window active: tighten sizing and demand clean liquidity sweep before execution.'
          : `Macro wire ${regime} (${goldBias} Gold bias, score ${score}).`;

    const riskWarningFa =
      regime === 'SHOCK_LOCKOUT'
        ? 'قفل خبری و شوک کلان فعال است؛ ورود به معامله جدید ممنوع می‌باشد.'
        : regime === 'MACRO_HEADWIND'
          ? 'هشدار خبری کلان فعال است؛ حجم معامله کاهش یابد و تنها با تایید کامل ساختاری وارد شوید.'
          : `وضعیت کلان ${regime} با تمایل ${goldBias} برای طلا ثبت شد.`;

    return {
      regime,
      goldBias,
      confidence: shock ? 0.92 : 0.72,
      keyDrivers: drivers,
      riskWarningEn,
      riskWarningFa,
      thinkingTrace: normalizeThinkingTrace('', undefined, {
        agentName: 'MacroNewsSentinel',
        triage: `Macro wire sentiment=${sentiment}, score=${score}, newsGate=${newsGate?.state ?? 'CLEAR'}.`,
        blastRadius: shock ? 'High-impact shock/lockout detected; severe slippage & spread spike risk.' : 'Normal macro volatility envelope.',
        resources: `Headlines=${headlines.length}, shockDetected=${String(shock)}.`,
        strategy: `Emit cached MacroRegimeBrief=${regime} (${goldBias}) with zero scalping latency.`,
      }),
      source: 'DETERMINISTIC_CACHE',
      latencyMs: 1,
      updatedAtMs: nowMs,
    };
  }

  /**
   * Sub-Agent 1: Macro & News Sentinel
   * Runs asynchronously in background (45s loop or on news update) and updates cached `MacroRegimeBrief`.
   */
  public async refreshMacroRegimeBrief(
    liveNews: Partial<LiveNewsIntelligence> | Record<string, any> | null,
    newsGate: NewsGateStatus | Record<string, any> | null
  ): Promise<MacroRegimeBrief> {
    if (this.macroRefreshing) return this.macroBrief;
    this.macroRefreshing = true;
    const pipelineId = `macro-${Date.now().toString(36)}`;
    const startedMs = Date.now();

    try {
      const deterministic = this.buildDeterministicMacroBrief(liveNews, newsGate);

      // If Sub-Agent 1 is disabled or no AI provider is configured (or Mode D MCP), keep fast deterministic cache
      const route = aiProviderHub.resolveEffectiveRoute('macroNewsSentinel');
      if (
        !aiProviderHub.isSubAgentEnabled('macroNewsSentinel') ||
        !aiProviderHub.hasAnyUsableAiProvider() ||
        route.mode === 'ANTIGRAVITY_MCP_BRIDGE'
      ) {
        this.macroBrief = deterministic;
        this.emitTelemetry({
          eventType: 'MACRO_CACHE_UPDATED',
          pipelineId,
          subAgentId: 'macroNewsSentinel',
          subAgentStatus: aiProviderHub.isSubAgentEnabled('macroNewsSentinel') ? 'COMPLETED' : 'SKIPPED',
          activeStage: `MACRO_CACHE:${deterministic.regime}`,
          latencyMs: Date.now() - startedMs,
          thinkingTrace: deterministic.thinkingTrace,
          summary: deterministic.riskWarningEn,
        });
        return this.macroBrief;
      }

      this.emitTelemetry({
        eventType: 'SUB_AGENT_START',
        pipelineId,
        subAgentId: 'macroNewsSentinel',
        subAgentStatus: 'RUNNING',
        activeStage: 'MACRO_SENTINEL_SYNTHESIS',
        latencyMs: 0,
      });

      const headlines = Array.isArray(liveNews?.headlines)
        ? liveNews.headlines.slice(0, 8).map((h: ScoredNewsHeadline) => ({
            source: h.sourceName,
            tier: h.tier,
            title: h.title,
            goldBias: h.goldBias,
            impactScore: h.impactScore,
            isEmergencyShock: h.isEmergencyShock,
          }))
        : [];

      const systemInstruction = [
        SYSTEM2_REASONING_DIRECTIVE,
        'ROLE: Sub-Agent 1 — Institutional XAU/USD Macro & News Sentinel.',
        'Classify current Gold macroeconomic environment into exactly ONE regime: CLEAR_TAILWIND, NEUTRAL, MACRO_HEADWIND, or SHOCK_LOCKOUT.',
        'Output strict JSON matching the schema.',
      ].join('\n\n');

      const prompt = JSON.stringify({
        macroSentiment: liveNews?.macroSentiment ?? 'NEUTRAL',
        sentimentScore: liveNews?.sentimentScore ?? 0,
        shockDetected: Boolean(liveNews?.shockDetected),
        shockHeadline: liveNews?.shockHeadline ?? null,
        newsGate: newsGate ?? { state: 'CLEAR' },
        topHeadlines: headlines,
      });

      const completion = await aiProviderHub.generateStructuredCompletion({
        subAgentId: 'macroNewsSentinel',
        systemInstruction,
        prompt,
        timeoutMs: 14_000,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            regime: { type: Type.STRING, description: 'CLEAR_TAILWIND, NEUTRAL, MACRO_HEADWIND, or SHOCK_LOCKOUT' },
            goldBias: { type: Type.STRING, description: 'BULLISH, BEARISH, or NEUTRAL' },
            confidence: { type: Type.NUMBER },
            keyDrivers: { type: Type.ARRAY, items: { type: Type.STRING } },
            riskWarningEn: { type: Type.STRING },
            riskWarningFa: { type: Type.STRING },
            thinkingTrace: { type: Type.STRING },
          },
          required: ['regime', 'goldBias', 'confidence', 'keyDrivers', 'riskWarningEn', 'riskWarningFa', 'thinkingTrace'],
        },
      });

      const parsed = safeJsonParse<Record<string, any>>(completion.text, {});
      const validRegimes: MacroRegimeLabel[] = ['CLEAR_TAILWIND', 'NEUTRAL', 'MACRO_HEADWIND', 'SHOCK_LOCKOUT'];
      let regime: MacroRegimeLabel = validRegimes.includes(String(parsed.regime).toUpperCase() as MacroRegimeLabel)
        ? (String(parsed.regime).toUpperCase() as MacroRegimeLabel)
        : deterministic.regime;

      // Deterministic shock safety override: AI can NEVER downgrade a hard SHOCK_LOCKOUT
      if (deterministic.regime === 'SHOCK_LOCKOUT') {
        regime = 'SHOCK_LOCKOUT';
      }

      const rawBias = String(parsed.goldBias ?? deterministic.goldBias).toUpperCase();
      const goldBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
        rawBias === 'BULLISH' || rawBias === 'BEARISH' ? rawBias : 'NEUTRAL';

      const thinkingTrace = normalizeThinkingTrace(parsed.thinkingTrace, completion.rawReasoning, {
        agentName: 'MacroNewsSentinel',
        triage: `Evaluated ${headlines.length} live macro headlines and newsGate=${newsGate?.state ?? 'CLEAR'}.`,
        blastRadius: `Shock=${String(Boolean(liveNews?.shockDetected))}, classified regime=${regime}.`,
        resources: `sentimentScore=${liveNews?.sentimentScore ?? 0}, goldBias=${goldBias}.`,
        strategy: `Cached MacroRegimeBrief (${regime}) for zero-latency scalping pipeline.`,
      });

      this.macroBrief = {
        regime,
        goldBias,
        confidence: clamp(Number(parsed.confidence ?? 0.78), 0.5, 0.99),
        keyDrivers:
          Array.isArray(parsed.keyDrivers) && parsed.keyDrivers.length > 0
            ? parsed.keyDrivers.map(String).slice(0, 5)
            : deterministic.keyDrivers,
        riskWarningEn: String(parsed.riskWarningEn || deterministic.riskWarningEn),
        riskWarningFa: String(parsed.riskWarningFa || deterministic.riskWarningFa),
        thinkingTrace,
        source: 'AI_SUB_AGENT',
        modelUsed: completion.modelUsed,
        providerMode: completion.providerMode,
        latencyMs: completion.latencyMs,
        updatedAtMs: Date.now(),
      };

      this.emitTelemetry({
        eventType: 'MACRO_CACHE_UPDATED',
        pipelineId,
        subAgentId: 'macroNewsSentinel',
        subAgentStatus: 'COMPLETED',
        activeStage: `MACRO_CACHE:${this.macroBrief.regime}`,
        latencyMs: completion.latencyMs,
        modelUsed: completion.modelUsed,
        providerMode: completion.providerMode,
        thinkingTrace,
        summary: this.macroBrief.riskWarningEn,
      });

      return this.macroBrief;
    } catch (err) {
      // Never crash background loop — fall back to deterministic brief
      const deterministic = this.buildDeterministicMacroBrief(liveNews, newsGate);
      this.macroBrief = deterministic;
      this.emitTelemetry({
        eventType: 'SUB_AGENT_ERROR',
        pipelineId,
        subAgentId: 'macroNewsSentinel',
        subAgentStatus: 'ERROR',
        activeStage: 'MACRO_FALLBACK_DETERMINISTIC',
        latencyMs: Date.now() - startedMs,
        summary: err instanceof Error ? err.message : 'Macro sub-agent fallback to deterministic cache',
      });
      return this.macroBrief;
    } finally {
      this.macroRefreshing = false;
    }
  }

  /**
   * Builds the full 5-Stage ICT Snapshot sent to Sub-Agent 2, Sub-Agent 3, and Sub-Agent 4.
   */
  private buildFullIctPayload(input: ProposalPipelineInput) {
    const quant = input.quant ?? {};
    const brain = quant.brain ?? {};
    const atr = Number(quant.regime?.atr ?? 3.5);
    const minRr = Number(input.agentConfig?.minRrRatio ?? 1.75);
    const minScore = Number(input.agentConfig?.minConfluenceScore ?? 62);
    const minStopDist = computeMinStopDistance(atr, Number(input.spread ?? 0.24));

    return {
      spotPrice: Number(input.spotPrice),
      spread: Number(input.spread ?? 0.24),
      timeframe: input.timeframe || quant.timeframe || 'M15',
      constraints: {
        minConfluenceScore: minScore,
        minRrRatio: minRr,
        minStopDist,
        anchorToleranceUsd: round2(Math.max(0.25, atr * 0.35)),
        allowCounterH4Scalps: Boolean(input.agentConfig?.allowCounterH4Scalps),
        maxPortfolioHeatPct: input.agentConfig?.maxPortfolioHeatPct ?? 3.0,
      },
      // Complete 5-stage ICT structures
      structures: Array.isArray(quant.structures) ? quant.structures.slice(-10) : [],
      liquidity: Array.isArray(quant.liquidity) ? quant.liquidity.slice(-10) : [],
      tfs: quant.tfs ?? null,
      tpi: quant.tpi ?? null,
      dealingRange: quant.dealingRange ?? null,
      fvgs: Array.isArray(quant.fvgs) ? quant.fvgs.slice(-8) : [],
      orderBlocks: Array.isArray(quant.orderBlocks) ? quant.orderBlocks.slice(-8) : [],
      rsi: quant.rsi
        ? {
            active: quant.rsi.active,
            byTimeframe: quant.rsi.byTimeframe,
          }
        : null,
      regime: quant.regime ?? null,
      mtfMatrix: Array.isArray(brain.mtfMatrix) ? brain.mtfMatrix : [],
      brain: {
        decision: brain.decision,
        convictionGrade: brain.convictionGrade,
        totalScore: brain.totalScore,
        longScore: brain.longScore,
        shortScore: brain.shortScore,
        candidateDirection: brain.candidateDirection,
        h4Bias: brain.h4Bias,
        h4Strength: brain.h4Strength,
        h1Bias: brain.h1Bias,
        killzone: brain.killzone,
        atrExtension: brain.atrExtension,
        kaufmanEfficiency: brain.kaufmanEfficiency,
        goldenConfluence: brain.goldenConfluence,
        sweepDetected: brain.sweepDetected,
        pillars: brain.pillars,
        defenseGates: brain.defenseGates,
        hardVetoes: brain.hardVetoes,
        watchlistZone: brain.watchlistZone,
        recommendedRiskMultiplier: brain.recommendedRiskMultiplier,
      },
      basis: input.basis ?? null,
      newsGate: input.newsGate ?? null,
      circuitBreakers: input.circuitBreakers ?? null,
      cachedMacroBrief: {
        regime: this.macroBrief.regime,
        goldBias: this.macroBrief.goldBias,
        confidence: this.macroBrief.confidence,
        keyDrivers: this.macroBrief.keyDrivers,
        riskWarningEn: this.macroBrief.riskWarningEn,
        updatedAtMs: this.macroBrief.updatedAtMs,
      },
    };
  }

  /**
   * Sub-Agent 2: SMC & Orderflow Sniper Analyst
   */
  private async runSniperAnalyst(
    pipelineId: string,
    ictPayload: ReturnType<SubAgentOrchestrator['buildFullIctPayload']>
  ): Promise<SniperAnalystOutput> {
    const startedMs = Date.now();

    if (!aiProviderHub.isSubAgentEnabled('smcSniperAnalyst')) {
      const fallbackDir: 'LONG' | 'SHORT' =
        ictPayload.brain.candidateDirection === 'SHORT' ? 'SHORT' : 'LONG';
      const wl = ictPayload.brain.watchlistZone;
      const spot = ictPayload.spotPrice;
      const stopDist = Math.max(ictPayload.constraints.minStopDist, (ictPayload.regime?.atr ?? 3.5) * 1.0);
      const entry = Number(wl?.optimalEntry ?? spot);
      const stopLoss =
        fallbackDir === 'LONG' ? round2(entry - stopDist) : round2(entry + stopDist);
      const tp1 =
        fallbackDir === 'LONG'
          ? round2(entry + stopDist * Math.max(2.0, ictPayload.constraints.minRrRatio))
          : round2(entry - stopDist * Math.max(2.0, ictPayload.constraints.minRrRatio));
      const tp2 =
        fallbackDir === 'LONG' ? round2(entry + stopDist * 3.1) : round2(entry - stopDist * 3.1);

      this.emitTelemetry({
        eventType: 'SUB_AGENT_SKIPPED',
        pipelineId,
        subAgentId: 'smcSniperAnalyst',
        subAgentStatus: 'SKIPPED',
        activeStage: 'SNIPER_DISABLED_FALLBACK',
        latencyMs: 0,
        summary: 'Sub-Agent 2 disabled by user toggle; using System-1 watchlist coordinates.',
      });

      return {
        decision: ictPayload.brain.decision === 'STAND_DOWN' ? 'STAND_DOWN' : 'PROPOSE',
        direction: fallbackDir,
        orderType: Math.abs(entry - spot) > ictPayload.spread * 2 ? 'LIMIT' : 'MARKET',
        setupType: 'System-1 Deterministic SMC Watchlist Setup',
        entry: round2(entry),
        stopLoss,
        tp1,
        tp2,
        invalidationPrice: stopLoss,
        ttlBars: 6,
        confidence: clamp((ictPayload.brain.totalScore ?? 70) / 100, 0.6, 0.92),
        rationaleEn: 'Sniper sub-agent bypassed by toggle; coordinates inherited from System-1 deterministic Payam Brain.',
        rationaleFa: 'زیرعامل تک‌تیرانداز SMC غیرفعال است؛ مختصات از موتور قطعی سیستم ۱ دریافت شد.',
        toolsUsed: ['system1_watchlist_anchor'],
        thinkingTrace: normalizeThinkingTrace('', undefined, {
          agentName: 'SmcSniperAnalyst',
          triage: 'Sub-Agent 2 toggled OFF.',
          blastRadius: 'Delegated directly to Fact Ledger + Chief Judge.',
          resources: `Spot=${spot}, WatchlistOptimal=${entry}.`,
          strategy: 'Pass deterministic levels downstream.',
        }),
        latencyMs: 0,
        skipped: true,
      };
    }

    this.emitTelemetry({
      eventType: 'SUB_AGENT_START',
      pipelineId,
      subAgentId: 'smcSniperAnalyst',
      subAgentStatus: 'RUNNING',
      activeStage: 'SMC_ORDERFLOW_SNIPER_ANALYSIS',
      latencyMs: 0,
    });

    const systemInstruction = [
      SYSTEM2_REASONING_DIRECTIVE,
      'ROLE: Sub-Agent 2 — SMC & Orderflow Sniper Analyst (XAU/USD Institutional Desk).',
      'Evaluate the COMPLETE 5-stage ICT payload: structures (BOS/CHoCH), liquidity (BSL/SSL sweeps), TFS/TPI orderflow, Dealing Range OTE (0.618/0.705/0.790), FVGs (CE50/top/bottom), Order Blocks (MT50), Wilder RSI(14) multi-timeframe regime & divergences, and mtfMatrix.',
      `STRICT EXECUTION RULES:`,
      `- Anchor entry STRICTLY within ±$${ictPayload.constraints.anchorToleranceUsd.toFixed(2)} (±0.35×ATR) of a genuine ledger price (spotPrice ${ictPayload.spotPrice.toFixed(2)}, FVG CE50/top/bottom, OB MT50, or OTE 0.618/0.705/0.790).`,
      `- Choose orderType="LIMIT" when targeting a resting OB/FVG/OTE retracement away from spot, or orderType="MARKET" only when price is already inside the POI.`,
      `- Enforce LONG: stopLoss < entry < tp1 < tp2 | SHORT: stopLoss > entry > tp1 > tp2.`,
      `- Enforce |entry - stopLoss| >= $${ictPayload.constraints.minStopDist.toFixed(2)} and R:R |tp1 - entry| / |entry - stopLoss| >= ${ictPayload.constraints.minRrRatio.toFixed(2)}.`,
      `- Specify exact invalidationPrice (structural break level) and ttlBars (integer 2..16 bars before limit expires).`,
      `- If confluence is weak or price is overextended, emit decision="STAND_DOWN".`,
    ].join('\n\n');

    const completion = await aiProviderHub.generateStructuredCompletion({
      subAgentId: 'smcSniperAnalyst',
      systemInstruction,
      prompt: `Analyze this complete 5-Stage XAU/USD ICT Payload and return JSON:\n${JSON.stringify(ictPayload)}`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING, description: 'PROPOSE or STAND_DOWN' },
          direction: { type: Type.STRING, description: 'LONG or SHORT' },
          orderType: { type: Type.STRING, description: 'LIMIT or MARKET' },
          setupType: { type: Type.STRING },
          entry: { type: Type.NUMBER },
          stopLoss: { type: Type.NUMBER },
          tp1: { type: Type.NUMBER },
          tp2: { type: Type.NUMBER },
          invalidationPrice: { type: Type.NUMBER },
          ttlBars: { type: Type.INTEGER },
          confidence: { type: Type.NUMBER },
          rationaleEn: { type: Type.STRING },
          rationaleFa: { type: Type.STRING },
          toolsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
          thinkingTrace: { type: Type.STRING },
        },
        required: [
          'decision',
          'direction',
          'orderType',
          'setupType',
          'entry',
          'stopLoss',
          'tp1',
          'tp2',
          'invalidationPrice',
          'ttlBars',
          'confidence',
          'rationaleEn',
          'rationaleFa',
          'toolsUsed',
          'thinkingTrace',
        ],
      },
    });

    const parsed = safeJsonParse<Record<string, any>>(completion.text, {});
    const direction: 'LONG' | 'SHORT' = String(parsed.direction ?? '').toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const orderType: 'LIMIT' | 'MARKET' = String(parsed.orderType ?? '').toUpperCase() === 'MARKET' ? 'MARKET' : 'LIMIT';
    const decision: 'PROPOSE' | 'STAND_DOWN' =
      String(parsed.decision ?? '').toUpperCase() === 'STAND_DOWN' ? 'STAND_DOWN' : 'PROPOSE';

    const thinkingTrace = normalizeThinkingTrace(parsed.thinkingTrace, completion.rawReasoning, {
      agentName: 'SmcSniperAnalyst',
      triage: `TF=${ictPayload.timeframe}, H4=${ictPayload.brain.h4Bias}, H1=${ictPayload.brain.h1Bias}, Score=${ictPayload.brain.totalScore}.`,
      blastRadius: `ATR=${ictPayload.regime?.atr}, minStop=$${ictPayload.constraints.minStopDist}, minRR=1:${ictPayload.constraints.minRrRatio}.`,
      resources: `Spot=${ictPayload.spotPrice}, FVGs=${ictPayload.fvgs.length}, OBs=${ictPayload.orderBlocks.length}, Liquidity=${ictPayload.liquidity.length}.`,
      strategy: `${decision} ${direction} (${orderType}) @ ${Number(parsed.entry || ictPayload.spotPrice).toFixed(2)}.`,
    });

    const output: SniperAnalystOutput = {
      decision,
      direction,
      orderType,
      setupType: String(parsed.setupType || 'ICT 5-Stage OB+FVG Sniper Setup'),
      entry: round2(Number(parsed.entry || ictPayload.spotPrice)),
      stopLoss: round2(Number(parsed.stopLoss || 0)),
      tp1: round2(Number(parsed.tp1 || 0)),
      tp2: round2(Number(parsed.tp2 || 0)),
      invalidationPrice: round2(Number(parsed.invalidationPrice || parsed.stopLoss || 0)),
      ttlBars: Math.max(2, Math.min(20, Math.round(Number(parsed.ttlBars || 6)))),
      confidence: clamp(Number(parsed.confidence ?? 0.78), 0.5, 0.97),
      rationaleEn: String(parsed.rationaleEn || ''),
      rationaleFa: String(parsed.rationaleFa || ''),
      toolsUsed:
        Array.isArray(parsed.toolsUsed) && parsed.toolsUsed.length > 0
          ? parsed.toolsUsed.map(String)
          : ['ict_structures', 'liquidity_sweeps', 'ob_mt50', 'fvg_ce50', 'ote_dealing_range', 'wilder_rsi14'],
      thinkingTrace,
      latencyMs: Date.now() - startedMs,
      modelUsed: completion.modelUsed,
      providerMode: completion.providerMode,
    };

    this.emitTelemetry({
      eventType: 'SUB_AGENT_DONE',
      pipelineId,
      subAgentId: 'smcSniperAnalyst',
      subAgentStatus: 'COMPLETED',
      activeStage: `SNIPER:${output.decision}_${output.direction}_${output.orderType}`,
      latencyMs: output.latencyMs,
      modelUsed: output.modelUsed,
      providerMode: output.providerMode,
      thinkingTrace: output.thinkingTrace,
      summary: `${output.decision} ${output.direction} ${output.orderType} @ $${output.entry.toFixed(2)}`,
    });

    return output;
  }

  /**
   * Sub-Agent 3: Adversarial Red-Team Challenger (runs IN PARALLEL with Sub-Agent 2 via Promise.all)
   */
  private async runRedTeamChallenger(
    pipelineId: string,
    ictPayload: ReturnType<SubAgentOrchestrator['buildFullIctPayload']>
  ): Promise<RedTeamChallengerOutput> {
    const startedMs = Date.now();

    if (!aiProviderHub.isSubAgentEnabled('adversarialChallenger')) {
      this.emitTelemetry({
        eventType: 'SUB_AGENT_SKIPPED',
        pipelineId,
        subAgentId: 'adversarialChallenger',
        subAgentStatus: 'SKIPPED',
        activeStage: 'RED_TEAM_DISABLED',
        latencyMs: 0,
        summary: 'Adversarial Red-Team Challenger disabled by user toggle.',
      });
      return {
        vetoRecommended: false,
        trapRiskScore: 0,
        fatalFlaws: [],
        summaryEn: 'Red-Team Challenger skipped (disabled in configuration).',
        summaryFa: 'زیرعامل چالشگر قرمز غیرفعال شده است.',
        thinkingTrace: normalizeThinkingTrace('', undefined, {
          agentName: 'AdversarialChallenger',
          triage: 'Sub-Agent 3 disabled.',
          blastRadius: 'No adversarial audit applied.',
          resources: 'Skipped.',
          strategy: 'Defer directly to Chief Judge & Fact Ledger.',
        }),
        latencyMs: 0,
        skipped: true,
      };
    }

    this.emitTelemetry({
      eventType: 'SUB_AGENT_START',
      pipelineId,
      subAgentId: 'adversarialChallenger',
      subAgentStatus: 'RUNNING',
      activeStage: 'ADVERSARIAL_TRAP_AUDIT',
      latencyMs: 0,
    });

    const systemInstruction = [
      SYSTEM2_REASONING_DIRECTIVE,
      'ROLE: Sub-Agent 3 — Adversarial Red-Team Challenger (XAU/USD Liquidity Trap Hunter).',
      'YOUR SOLE MANDATE: Try to BREAK and DISPROVE the candidate trade setup. Hunt ruthlessly for:',
      '1. Inducement traps (fake BOS/CHoCH without displacement or before true liquidity sweep).',
      '2. Unswept nearby BSL/SSL liquidity pools sitting right behind the likely Stop Loss (magnet stop-hunt risk).',
      '3. Opposing Wilder RSI(14) Regular Divergence or extreme RSI exhaustion (>72 on LONG, <28 on SHORT).',
      '4. PAXG/XAUUSD crypto basis divergence / crypto inducement warnings.',
      '5. Session exhaustion (OFF_SESSION / ASIAN_ACCUMULATION chop, low Kaufman efficiency, overextended ATR).',
      '6. Macro headwinds or SHOCK_LOCKOUT from cached MacroRegimeBrief.',
      'Return JSON with `vetoRecommended` (boolean), `trapRiskScore` (0..100), `fatalFlaws` (string[]), `summaryEn`, `summaryFa`, and `thinkingTrace`.',
    ].join('\n\n');

    const completion = await aiProviderHub.generateStructuredCompletion({
      subAgentId: 'adversarialChallenger',
      systemInstruction,
      prompt: `Red-Team audit this XAU/USD market snapshot for liquidity traps and fatal flaws:\n${JSON.stringify(ictPayload)}`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          vetoRecommended: { type: Type.BOOLEAN },
          trapRiskScore: { type: Type.NUMBER, description: '0 to 100' },
          fatalFlaws: { type: Type.ARRAY, items: { type: Type.STRING } },
          summaryEn: { type: Type.STRING },
          summaryFa: { type: Type.STRING },
          thinkingTrace: { type: Type.STRING },
        },
        required: ['vetoRecommended', 'trapRiskScore', 'fatalFlaws', 'summaryEn', 'summaryFa', 'thinkingTrace'],
      },
    });

    const parsed = safeJsonParse<Record<string, any>>(completion.text, {});
    const trapRiskScore = Math.round(clamp(Number(parsed.trapRiskScore ?? 35), 0, 100));
    const fatalFlaws = Array.isArray(parsed.fatalFlaws)
      ? parsed.fatalFlaws.map(String).filter(Boolean).slice(0, 8)
      : [];
    const vetoRecommended = Boolean(parsed.vetoRecommended) || trapRiskScore >= 78;

    const thinkingTrace = normalizeThinkingTrace(parsed.thinkingTrace, completion.rawReasoning, {
      agentName: 'AdversarialChallenger',
      triage: `Auditing candidate ${ictPayload.brain.candidateDirection} in ${ictPayload.brain.killzone} session.`,
      blastRadius: `Trap risk score=${trapRiskScore}/100, basis=${ictPayload.basis?.status ?? 'ALIGNED'}, atrExt=${ictPayload.brain.atrExtension}.`,
      resources: `Liquidity pools=${ictPayload.liquidity.length}, RSI=${ictPayload.rsi?.active?.value ?? 'n/a'} (${ictPayload.rsi?.active?.divergence ?? 'NONE'}).`,
      strategy: vetoRecommended ? `RECOMMEND VETO (${fatalFlaws.length} fatal flaws).` : 'No fatal liquidity trap detected; clear for Chief Judge.',
    });

    const output: RedTeamChallengerOutput = {
      vetoRecommended,
      trapRiskScore,
      fatalFlaws,
      summaryEn: String(parsed.summaryEn || (vetoRecommended ? 'Red-Team flagged severe trap risk.' : 'No fatal trap flaw detected.')),
      summaryFa: String(parsed.summaryFa || (vetoRecommended ? 'تیم قرمز ریسک تله نقدینگی بالا شناسایی کرد.' : 'تله نقدینگی بحرانی مشاهده نشد.')),
      thinkingTrace,
      latencyMs: Date.now() - startedMs,
      modelUsed: completion.modelUsed,
      providerMode: completion.providerMode,
    };

    this.emitTelemetry({
      eventType: 'SUB_AGENT_DONE',
      pipelineId,
      subAgentId: 'adversarialChallenger',
      subAgentStatus: 'COMPLETED',
      activeStage: `RED_TEAM:RISK_${output.trapRiskScore}${output.vetoRecommended ? '_VETO' : '_CLEAR'}`,
      latencyMs: output.latencyMs,
      modelUsed: output.modelUsed,
      providerMode: output.providerMode,
      thinkingTrace: output.thinkingTrace,
      summary: `TrapRisk=${output.trapRiskScore}/100 · Veto=${output.vetoRecommended} · Flaws=${output.fatalFlaws.length}`,
    });

    return output;
  }

  /**
   * Sub-Agent 4: Chief Execution Judge
   * Synthesizes SA1 (cached Macro) + SA2 (Sniper) + SA3 (Red-Team) + System-1 pillars.
   */
  private async runChiefExecutionJudge(
    pipelineId: string,
    ictPayload: ReturnType<SubAgentOrchestrator['buildFullIctPayload']>,
    macroBrief: MacroRegimeBrief,
    sniper: SniperAnalystOutput,
    redTeam: RedTeamChallengerOutput
  ): Promise<ChiefJudgeOutput> {
    const startedMs = Date.now();

    // Deterministic fast-reject if Macro is SHOCK_LOCKOUT
    if (macroBrief.regime === 'SHOCK_LOCKOUT') {
      const reasonEn = `Chief Judge enforced STAND_DOWN: Sub-Agent 1 Macro Sentinel reports SHOCK_LOCKOUT (${macroBrief.riskWarningEn}).`;
      const reasonFa = `قاضی ارشد دستور توقف صادر کرد: زیرعامل کلان وضعیت قفل شوک خبری را گزارش داده است.`;
      return {
        decision: 'STAND_DOWN',
        direction: sniper.direction,
        orderType: sniper.orderType,
        setupType: sniper.setupType,
        entry: sniper.entry,
        stopLoss: sniper.stopLoss,
        tp1: sniper.tp1,
        tp2: sniper.tp2,
        invalidationPrice: sniper.invalidationPrice,
        ttlBars: sniper.ttlBars,
        confidence: 0,
        rationaleEn: reasonEn,
        rationaleFa: reasonFa,
        standDownReasonEn: reasonEn,
        standDownReasonFa: reasonFa,
        toolsUsed: ['macro_sentinel_shock_lockout'],
        thinkingTrace: normalizeThinkingTrace('', undefined, {
          agentName: 'ChiefExecutionJudge',
          triage: 'Macro Sentinel reported SHOCK_LOCKOUT.',
          blastRadius: 'Extreme macro shock invalidates technical SMC execution.',
          resources: `MacroRegime=${macroBrief.regime}.`,
          strategy: 'Immediate deterministic STAND_DOWN.',
        }),
        latencyMs: 0,
      };
    }

    if (!aiProviderHub.isSubAgentEnabled('chiefExecutionJudge')) {
      const rejectByRedTeam = redTeam.vetoRecommended && redTeam.trapRiskScore >= 75;
      const finalDecision: 'PROPOSE' | 'STAND_DOWN' =
        sniper.decision === 'STAND_DOWN' || rejectByRedTeam ? 'STAND_DOWN' : 'PROPOSE';

      this.emitTelemetry({
        eventType: 'SUB_AGENT_SKIPPED',
        pipelineId,
        subAgentId: 'chiefExecutionJudge',
        subAgentStatus: 'SKIPPED',
        activeStage: `JUDGE_BYPASSED:${finalDecision}`,
        latencyMs: 0,
        summary: 'Chief Execution Judge disabled; deterministically merged Sniper + Red-Team.',
      });

      return {
        decision: finalDecision,
        direction: sniper.direction,
        orderType: sniper.orderType,
        setupType: sniper.setupType,
        entry: sniper.entry,
        stopLoss: sniper.stopLoss,
        tp1: sniper.tp1,
        tp2: sniper.tp2,
        invalidationPrice: sniper.invalidationPrice,
        ttlBars: sniper.ttlBars,
        confidence: sniper.confidence,
        rationaleEn: sniper.rationaleEn,
        rationaleFa: sniper.rationaleFa,
        standDownReasonEn: rejectByRedTeam
          ? `Red-Team Challenger vetoed setup (Trap Risk ${redTeam.trapRiskScore}/100): ${redTeam.fatalFlaws.join('; ')}`
          : sniper.rationaleEn || 'Sniper Analyst stood down.',
        standDownReasonFa: rejectByRedTeam
          ? `تیم قرمز معامله را وتو کرد (ریسک تله ${redTeam.trapRiskScore}/100).`
          : sniper.rationaleFa || 'زیرعامل SMC دستور ایست صادر کرد.',
        toolsUsed: [...new Set([...sniper.toolsUsed, 'red_team_deterministic_merge'])],
        thinkingTrace: sniper.thinkingTrace,
        latencyMs: 0,
        skipped: true,
      };
    }

    this.emitTelemetry({
      eventType: 'SUB_AGENT_START',
      pipelineId,
      subAgentId: 'chiefExecutionJudge',
      subAgentStatus: 'RUNNING',
      activeStage: 'CHIEF_EXECUTION_JUDGE_SYNTHESIS',
      latencyMs: 0,
    });

    const systemInstruction = [
      SYSTEM2_REASONING_DIRECTIVE,
      'ROLE: Sub-Agent 4 — Chief Execution Judge (Final Institutional Authority for XAU/USD).',
      'Synthesize ALL 4 inputs:',
      '  1. Sub-Agent 1 (Cached MacroRegimeBrief)',
      '  2. Sub-Agent 2 (SMC & Orderflow Sniper Proposal)',
      '  3. Sub-Agent 3 (Adversarial Red-Team Challenger Audit)',
      '  4. System-1 Deterministic Pillars & Payam Brain scores',
      'DECISION CONSTITUTION:',
      '- If Red-Team recommends veto with severe fatal flaws (trapRiskScore >= 72) OR Sniper stood down without strong System-1 override, you MUST rule decision="STAND_DOWN".',
      '- If ruling decision="PROPOSE", verify that entry is anchored within ±0.35×ATR of a genuine ledger price (spot, FVG CE50/top/bottom, OB MT50, OTE 0.618/0.705/0.790), SL/TP geometry is strictly valid, stop distance >= minStopDist, and R:R >= minRrRatio.',
      '- Return crisp English (`rationaleEn`) and Persian (`rationaleFa`) explanations, plus complete System-2 `thinkingTrace`.',
    ].join('\n\n');

    const judgeContext = {
      spotPrice: ictPayload.spotPrice,
      spread: ictPayload.spread,
      timeframe: ictPayload.timeframe,
      constraints: ictPayload.constraints,
      system1Brain: ictPayload.brain,
      ledgerReference: {
        fvgs: ictPayload.fvgs.slice(-4),
        orderBlocks: ictPayload.orderBlocks.slice(-4),
        dealingRange: ictPayload.dealingRange,
      },
      subAgent1_MacroBrief: {
        regime: macroBrief.regime,
        goldBias: macroBrief.goldBias,
        confidence: macroBrief.confidence,
        keyDrivers: macroBrief.keyDrivers,
        riskWarningEn: macroBrief.riskWarningEn,
      },
      subAgent2_SniperProposal: {
        decision: sniper.decision,
        direction: sniper.direction,
        orderType: sniper.orderType,
        setupType: sniper.setupType,
        entry: sniper.entry,
        stopLoss: sniper.stopLoss,
        tp1: sniper.tp1,
        tp2: sniper.tp2,
        invalidationPrice: sniper.invalidationPrice,
        ttlBars: sniper.ttlBars,
        confidence: sniper.confidence,
        rationaleEn: sniper.rationaleEn,
      },
      subAgent3_RedTeamAudit: {
        vetoRecommended: redTeam.vetoRecommended,
        trapRiskScore: redTeam.trapRiskScore,
        fatalFlaws: redTeam.fatalFlaws,
        summaryEn: redTeam.summaryEn,
      },
    };

    const completion = await aiProviderHub.generateStructuredCompletion({
      subAgentId: 'chiefExecutionJudge',
      systemInstruction,
      prompt: `Deliver the final Chief Execution Judge verdict in strict JSON:\n${JSON.stringify(judgeContext)}`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          decision: { type: Type.STRING, description: 'PROPOSE or STAND_DOWN' },
          direction: { type: Type.STRING, description: 'LONG or SHORT' },
          orderType: { type: Type.STRING, description: 'LIMIT or MARKET' },
          setupType: { type: Type.STRING },
          entry: { type: Type.NUMBER },
          stopLoss: { type: Type.NUMBER },
          tp1: { type: Type.NUMBER },
          tp2: { type: Type.NUMBER },
          invalidationPrice: { type: Type.NUMBER },
          ttlBars: { type: Type.INTEGER },
          confidence: { type: Type.NUMBER },
          rationaleEn: { type: Type.STRING },
          rationaleFa: { type: Type.STRING },
          standDownReasonEn: { type: Type.STRING },
          standDownReasonFa: { type: Type.STRING },
          toolsUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
          thinkingTrace: { type: Type.STRING },
        },
        required: [
          'decision',
          'direction',
          'orderType',
          'setupType',
          'entry',
          'stopLoss',
          'tp1',
          'tp2',
          'invalidationPrice',
          'ttlBars',
          'confidence',
          'rationaleEn',
          'rationaleFa',
          'toolsUsed',
          'thinkingTrace',
        ],
      },
    });

    const parsed = safeJsonParse<Record<string, any>>(completion.text, {});
    const decision: 'PROPOSE' | 'STAND_DOWN' =
      String(parsed.decision ?? '').toUpperCase() === 'STAND_DOWN' ? 'STAND_DOWN' : 'PROPOSE';
    const direction: 'LONG' | 'SHORT' =
      String(parsed.direction ?? sniper.direction).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const orderType: 'LIMIT' | 'MARKET' =
      String(parsed.orderType ?? sniper.orderType).toUpperCase() === 'MARKET' ? 'MARKET' : 'LIMIT';

    const thinkingTrace = normalizeThinkingTrace(parsed.thinkingTrace, completion.rawReasoning, {
      agentName: 'ChiefExecutionJudge',
      triage: `Synthesizing SA1(${macroBrief.regime}) + SA2(${sniper.decision} ${sniper.direction}) + SA3(risk=${redTeam.trapRiskScore}) + Brain(${ictPayload.brain.totalScore}).`,
      blastRadius: `Red-Team veto=${redTeam.vetoRecommended}, flaws=${redTeam.fatalFlaws.length}.`,
      resources: `Entry=${Number(parsed.entry || sniper.entry).toFixed(2)}, SL=${Number(parsed.stopLoss || sniper.stopLoss).toFixed(2)}, TP1=${Number(parsed.tp1 || sniper.tp1).toFixed(2)}.`,
      strategy: `Final Judge ruling: ${decision}.`,
    });

    const output: ChiefJudgeOutput = {
      decision,
      direction,
      orderType,
      setupType: String(parsed.setupType || sniper.setupType),
      entry: round2(Number(parsed.entry || sniper.entry)),
      stopLoss: round2(Number(parsed.stopLoss || sniper.stopLoss)),
      tp1: round2(Number(parsed.tp1 || sniper.tp1)),
      tp2: round2(Number(parsed.tp2 || sniper.tp2)),
      invalidationPrice: round2(Number(parsed.invalidationPrice || sniper.invalidationPrice || parsed.stopLoss || sniper.stopLoss)),
      ttlBars: Math.max(2, Math.min(20, Math.round(Number(parsed.ttlBars || sniper.ttlBars || 6)))),
      confidence: clamp(Number(parsed.confidence ?? sniper.confidence), 0.55, 0.96),
      rationaleEn: String(parsed.rationaleEn || sniper.rationaleEn),
      rationaleFa: String(parsed.rationaleFa || sniper.rationaleFa),
      standDownReasonEn: String(parsed.standDownReasonEn || parsed.rationaleEn || redTeam.summaryEn || 'Chief Judge ruled STAND_DOWN.'),
      standDownReasonFa: String(parsed.standDownReasonFa || parsed.rationaleFa || redTeam.summaryFa || 'قاضی ارشد دستور ایست صادر کرد.'),
      toolsUsed:
        Array.isArray(parsed.toolsUsed) && parsed.toolsUsed.length > 0
          ? parsed.toolsUsed.map(String)
          : [...new Set([...sniper.toolsUsed, 'macro_sentinel', 'red_team_challenger', 'chief_execution_judge', 'fact_ledger_guard'])],
      thinkingTrace,
      latencyMs: Date.now() - startedMs,
      modelUsed: completion.modelUsed,
      providerMode: completion.providerMode,
    };

    this.emitTelemetry({
      eventType: 'SUB_AGENT_DONE',
      pipelineId,
      subAgentId: 'chiefExecutionJudge',
      subAgentStatus: 'COMPLETED',
      activeStage: `JUDGE:${output.decision}`,
      latencyMs: output.latencyMs,
      modelUsed: output.modelUsed,
      providerMode: output.providerMode,
      thinkingTrace: output.thinkingTrace,
      summary: `Chief Judge ruled ${output.decision}${output.decision === 'PROPOSE' ? ` (${output.direction} ${output.orderType} @ $${output.entry.toFixed(2)})` : ''}`,
    });

    return output;
  }

  /**
   * Full Zero-Latency Proposal Pipeline:
   * - Reads pre-warmed Sub-Agent 1 MacroRegimeBrief (0ms)
   * - Executes Sub-Agent 2 (Sniper) + Sub-Agent 3 (Red-Team) IN PARALLEL via Promise.all
   * - Executes Sub-Agent 4 (Chief Execution Judge)
   * - Validates final numbers deterministically via server/factLedger.ts
   */
  public async runProposalPipeline(input: ProposalPipelineInput): Promise<ProposalPipelineResult> {
    const pipelineId = `pipe-${Date.now().toString(36)}`;
    const startedMs = Date.now();

    // Update macro brief synchronously if shock is detected in live payload
    if (input.liveNews?.shockDetected || input.newsGate?.vetoNewEntries) {
      this.macroBrief = this.buildDeterministicMacroBrief(input.liveNews ?? null, input.newsGate ?? null);
    }
    const macroBrief = this.getCachedMacroBrief();
    const ictPayload = this.buildFullIctPayload(input);

    this.emitTelemetry({
      eventType: 'PIPELINE_START',
      pipelineId,
      subAgentId: 'orchestrator',
      subAgentStatus: 'RUNNING',
      activeStage: 'PARALLEL_SNIPER_AND_RED_TEAM',
      latencyMs: 0,
      summary: `Pipeline started on ${ictPayload.timeframe} @ $${ictPayload.spotPrice.toFixed(2)} (Macro=${macroBrief.regime})`,
    });

    // Execute Sub-Agent 2 & Sub-Agent 3 IN PARALLEL
    const [sniper, redTeam] = await Promise.all([
      this.runSniperAnalyst(pipelineId, ictPayload),
      this.runRedTeamChallenger(pipelineId, ictPayload),
    ]);

    // Synthesize via Sub-Agent 4 (Chief Execution Judge)
    const judge = await this.runChiefExecutionJudge(pipelineId, ictPayload, macroBrief, sniper, redTeam);

    if (judge.decision === 'STAND_DOWN') {
      const totalLatencyMs = Date.now() - startedMs;
      this.emitTelemetry({
        eventType: 'PIPELINE_COMPLETE',
        pipelineId,
        subAgentId: 'orchestrator',
        subAgentStatus: 'COMPLETED',
        activeStage: 'STAND_DOWN',
        latencyMs: totalLatencyMs,
        thinkingTrace: judge.thinkingTrace,
        summary: judge.standDownReasonEn,
      });

      return {
        pipelineId,
        decision: 'STAND_DOWN',
        totalLatencyMs,
        macroBrief,
        sniper,
        redTeam,
        judge,
        factLedger: null,
        standDownReasonEn: judge.standDownReasonEn,
        standDownReasonFa: judge.standDownReasonFa,
      };
    }

    // Mandatory Anti-Hallucination Fact Ledger Verification
    const ledgerCtx: FactLedgerContext = {
      spotPrice: ictPayload.spotPrice,
      spread: ictPayload.spread,
      atr: Number(ictPayload.regime?.atr ?? 3.5),
      minRrRatio: ictPayload.constraints.minRrRatio,
      minStopDist: ictPayload.constraints.minStopDist,
      fvgs: ictPayload.fvgs,
      orderBlocks: ictPayload.orderBlocks,
      dealingRange: ictPayload.dealingRange,
      watchlistZone: ictPayload.brain.watchlistZone,
    };

    const ledgerResult = verifyProposalAgainstFactLedger(
      {
        direction: judge.direction,
        entry: judge.entry,
        stopLoss: judge.stopLoss,
        tp1: judge.tp1,
        tp2: judge.tp2,
        invalidationPrice: judge.invalidationPrice,
      },
      ledgerCtx
    );

    this.emitTelemetry({
      eventType: 'FACT_LEDGER_CHECK',
      pipelineId,
      subAgentId: 'factLedger',
      subAgentStatus: ledgerResult.valid ? 'COMPLETED' : 'ERROR',
      activeStage: ledgerResult.valid
        ? ledgerResult.snapped
          ? 'FACT_LEDGER_SNAPPED_VERIFIED'
          : 'FACT_LEDGER_VERIFIED'
        : 'FACT_LEDGER_REJECTED_STAND_DOWN',
      latencyMs: 1,
      summary: ledgerResult.auditSummary,
    });

    if (!ledgerResult.valid || ledgerResult.decision === 'STAND_DOWN') {
      const totalLatencyMs = Date.now() - startedMs;
      const reasonEn = `Anti-Hallucination Fact Ledger rejected AI proposal -> STAND_DOWN: ${ledgerResult.errors.join(' ')}`;
      const reasonFa = `دفتر کل ضد توهم (Fact Ledger) قیمت‌های پیشنهادی هوش مصنوعی را رد کرد؛ وضعیت ایست (STAND_DOWN) فعال شد.`;

      this.emitTelemetry({
        eventType: 'PIPELINE_COMPLETE',
        pipelineId,
        subAgentId: 'orchestrator',
        subAgentStatus: 'COMPLETED',
        activeStage: 'FACT_LEDGER_STAND_DOWN',
        latencyMs: totalLatencyMs,
        summary: reasonEn,
      });

      return {
        pipelineId,
        decision: 'STAND_DOWN',
        totalLatencyMs,
        macroBrief,
        sniper,
        redTeam,
        judge,
        factLedger: ledgerResult,
        standDownReasonEn: reasonEn,
        standDownReasonFa: reasonFa,
      };
    }

    const totalLatencyMs = Date.now() - startedMs;
    const activeRsi = ictPayload.rsi?.active;
    const rsiSummary = activeRsi
      ? `RSI(14) ${Number(activeRsi.value).toFixed(1)} · ${String(activeRsi.regime).replace('_', ' ')}${activeRsi.divergence !== 'NONE' ? ` · ${String(activeRsi.divergence).replace('_', ' ')}` : ''}`
      : undefined;

    const brain = ictPayload.brain;
    const proposal = {
      id: `prop-ai-${Date.now().toString(36)}`,
      direction: judge.direction,
      orderType: judge.orderType,
      setupType: judge.setupType,
      timeframe: ictPayload.timeframe,
      entry: ledgerResult.entry,
      stopLoss: ledgerResult.stopLoss,
      tp1: ledgerResult.tp1,
      tp2: ledgerResult.tp2,
      invalidationPrice: ledgerResult.invalidationPrice,
      ttlBars: judge.ttlBars,
      rrRatio: ledgerResult.rrRatio,
      confidence: clamp(
        judge.confidence || (typeof brain.totalScore === 'number' ? brain.totalScore / 100 : 0.8),
        0.6,
        0.96
      ),
      rationaleEn: ledgerResult.snapped
        ? `${judge.rationaleEn} [FactLedger snapped entry $${ledgerResult.originalEntry.toFixed(2)} -> $${ledgerResult.entry.toFixed(2)} (${ledgerResult.matchedAnchor?.label ?? 'anchor'})]`
        : judge.rationaleEn,
      rationaleFa: judge.rationaleFa,
      thinkingTrace: judge.thinkingTrace,
      toolsUsed: judge.toolsUsed,
      engineSource: 'GEMINI_AGENT' as const,
      status: 'PROPOSED' as const,
      createdAtMs: Date.now(),
      confluenceScore: brain.totalScore,
      convictionGrade: brain.convictionGrade,
      h4Bias: brain.h4Bias,
      rsiSummary,
      recommendedRiskMultiplier: brain.recommendedRiskMultiplier,
      pillarBreakdown: Array.isArray(brain.pillars)
        ? brain.pillars.map((p: { label: string; score: number; maxScore: number }) => ({
            label: p.label,
            score: p.score,
            maxScore: p.maxScore,
          }))
        : undefined,
      goldenConfluence: Boolean(brain.goldenConfluence),
      counterTrendFlag:
        (brain.h4Bias === 'BULLISH' && judge.direction === 'SHORT') ||
        (brain.h4Bias === 'BEARISH' && judge.direction === 'LONG'),
      factLedgerAudit: {
        snapped: ledgerResult.snapped,
        originalEntry: ledgerResult.originalEntry,
        matchedAnchor: ledgerResult.matchedAnchor?.label ?? null,
        anchorDeltaUsd: ledgerResult.anchorDeltaUsd,
        auditSummary: ledgerResult.auditSummary,
      },
      subAgentAudit: {
        macroRegime: macroBrief.regime,
        redTeamTrapRiskScore: redTeam.trapRiskScore,
        redTeamVetoRecommended: redTeam.vetoRecommended,
        redTeamFatalFlaws: redTeam.fatalFlaws,
        pipelineLatencyMs: totalLatencyMs,
      },
    };

    this.emitTelemetry({
      eventType: 'PIPELINE_COMPLETE',
      pipelineId,
      subAgentId: 'orchestrator',
      subAgentStatus: 'COMPLETED',
      activeStage: `PROPOSE_${proposal.direction}_${proposal.orderType}`,
      latencyMs: totalLatencyMs,
      modelUsed: judge.modelUsed,
      providerMode: judge.providerMode,
      thinkingTrace: judge.thinkingTrace,
      summary: `Verified ${proposal.direction} ${proposal.orderType} @ $${proposal.entry.toFixed(2)} (R:R 1:${proposal.rrRatio.toFixed(2)})`,
    });

    return {
      pipelineId,
      decision: 'PROPOSE',
      totalLatencyMs,
      macroBrief,
      sniper,
      redTeam,
      judge,
      factLedger: ledgerResult,
      proposal,
    };
  }

  /**
   * Sub-Agent 5: Live Position Guardian Sub-Agent (Powers POST /api/agent/monitor)
   */
  public async runPositionGuardian(input: PositionMonitorInput): Promise<PositionMonitorResult> {
    const pipelineId = `guard-${Date.now().toString(36)}`;
    const startedMs = Date.now();
    const macroBrief = this.getCachedMacroBrief();
    const positions = Array.isArray(input.positions) ? input.positions : [];

    if (positions.length === 0) {
      return {
        pipelineId,
        directives: [],
        latencyMs: 0,
        macroBrief,
      };
    }

    if (!aiProviderHub.isSubAgentEnabled('livePositionGuardian')) {
      const directives: PositionGuardianDirective[] = positions.map((p) => {
        const positionId = String(p.id ?? p.positionId ?? '');
        const rMult = Number(p.rMultiple ?? 0);
        const newsLockout = input.newsGate?.state === 'LOCKOUT' || macroBrief.regime === 'SHOCK_LOCKOUT';
        let directive: GuardianDirectiveKind = 'HOLD_STEADY';
        let recommendedSl: number | null = null;
        let recommendedScaleOutPct = 0;
        let urgency: 'NORMAL' | 'ATTENTION' | 'CRITICAL' = 'NORMAL';

        if (newsLockout) {
          directive = 'EMERGENCY_EXIT_NOW';
          urgency = 'CRITICAL';
        } else if (rMult >= 1.5) {
          directive = 'PARTIAL_TAKE_PROFIT_TP1';
          recommendedScaleOutPct = 50;
          recommendedSl = Number(p.entry ?? null);
          urgency = 'ATTENTION';
        } else if (rMult >= 0.85) {
          directive = 'MOVE_SL_TO_BREAKEVEN';
          recommendedSl = Number(p.entry ?? null);
          urgency = 'ATTENTION';
        }

        const rationaleEn = `Deterministic Guardian fallback: ${directive} at R=${rMult.toFixed(2)}.`;
        const rationaleFa = `نگهبان قطعی پوزیشن: دستور ${directive} در نسبت R=${rMult.toFixed(2)}.`;
        return {
          positionId,
          directive,
          recommendedSl,
          recommendedScaleOutPct,
          urgency,
          rationaleEn,
          rationaleFa,
          thinkingTrace: normalizeThinkingTrace('', undefined, {
            agentName: 'LivePositionGuardian',
            triage: 'Sub-Agent 5 disabled; deterministic HSM fallback.',
            blastRadius: `NewsLockout=${newsLockout}, R=${rMult.toFixed(2)}.`,
            resources: `Spot=${input.spotPrice}, Pos=${positionId}.`,
            strategy: `Emit ${directive}.`,
          }),
          actionTag: mapDirectiveToLegacyActionTag(directive, input.newsGate?.state),
          adviceEn: rationaleEn,
          adviceFa: rationaleFa,
        };
      });

      this.emitTelemetry({
        eventType: 'SUB_AGENT_SKIPPED',
        pipelineId,
        subAgentId: 'livePositionGuardian',
        subAgentStatus: 'SKIPPED',
        activeStage: 'GUARDIAN_DISABLED_FALLBACK',
        latencyMs: Date.now() - startedMs,
      });

      return {
        pipelineId,
        directives,
        latencyMs: Date.now() - startedMs,
        macroBrief,
      };
    }

    this.emitTelemetry({
      eventType: 'SUB_AGENT_START',
      pipelineId,
      subAgentId: 'livePositionGuardian',
      subAgentStatus: 'RUNNING',
      activeStage: `GUARDIAN_REVIEW_${positions.length}_POSITIONS`,
      latencyMs: 0,
    });

    const systemInstruction = [
      SYSTEM2_REASONING_DIRECTIVE,
      'ROLE: Sub-Agent 5 — Live Position Guardian for Active User-Confirmed XAU/USD Broker Positions.',
      'For EACH open position, issue ONE structured management directive:',
      '  - HOLD_STEADY',
      '  - MOVE_SL_TO_BREAKEVEN',
      '  - PARTIAL_TAKE_PROFIT_TP1',
      '  - TRAIL_STOP_STRUCTURAL',
      '  - EMERGENCY_EXIT_NOW',
      'Also specify `recommendedSl` (number or null if unchanged), `recommendedScaleOutPct` (0..100), `urgency` (NORMAL | ATTENTION | CRITICAL), `rationaleEn`, `rationaleFa`, and full System-2 `thinkingTrace`.',
      'Prioritize capital preservation: flag opposing Regular RSI divergence, H4 bias flip, basis divergence, or Macro SHOCK_LOCKOUT immediately.',
      'Return JSON object: {"directives": [...]}.',
    ].join('\n\n');

    const promptPayload = {
      spotPrice: input.spotPrice,
      positions,
      h4Bias: input.quant?.brain?.h4Bias,
      h1Bias: input.quant?.brain?.h1Bias,
      brainScore: input.quant?.brain?.totalScore,
      hardVetoes: input.quant?.brain?.hardVetoes,
      structures: Array.isArray(input.quant?.structures) ? input.quant.structures.slice(-5) : [],
      liquidity: Array.isArray(input.quant?.liquidity) ? input.quant.liquidity.slice(-5) : [],
      rsiActive: input.quant?.rsi?.active,
      rsiH1: input.quant?.rsi?.byTimeframe?.H1,
      regime: input.quant?.regime,
      tpi: input.quant?.tpi,
      newsGate: input.newsGate,
      macroBrief: {
        regime: macroBrief.regime,
        goldBias: macroBrief.goldBias,
        riskWarningEn: macroBrief.riskWarningEn,
      },
      liveNews: input.liveNews,
      basis: input.basis,
    };

    const completion = await aiProviderHub.generateStructuredCompletion({
      subAgentId: 'livePositionGuardian',
      systemInstruction,
      prompt: `Review active broker positions and return strict JSON {"directives": [...]}:\n${JSON.stringify(promptPayload)}`,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          directives: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                positionId: { type: Type.STRING },
                directive: {
                  type: Type.STRING,
                  description:
                    'HOLD_STEADY, MOVE_SL_TO_BREAKEVEN, PARTIAL_TAKE_PROFIT_TP1, TRAIL_STOP_STRUCTURAL, or EMERGENCY_EXIT_NOW',
                },
                recommendedSl: { type: Type.NUMBER, nullable: true },
                recommendedScaleOutPct: { type: Type.NUMBER },
                urgency: { type: Type.STRING, description: 'NORMAL, ATTENTION, or CRITICAL' },
                rationaleEn: { type: Type.STRING },
                rationaleFa: { type: Type.STRING },
                thinkingTrace: { type: Type.STRING },
              },
              required: [
                'positionId',
                'directive',
                'recommendedScaleOutPct',
                'urgency',
                'rationaleEn',
                'rationaleFa',
                'thinkingTrace',
              ],
            },
          },
        },
        required: ['directives'],
      },
    });

    const parsed = safeJsonParse<any>(completion.text, { directives: [] });
    const rawList: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.directives)
        ? parsed.directives
        : [];

    const directives: PositionGuardianDirective[] = rawList.map((item, idx) => {
      const fallbackPos = positions[idx];
      const positionId = String(item?.positionId ?? fallbackPos?.id ?? `pos-${idx}`);
      const directive = normalizeGuardianDirective(item?.directive ?? item?.actionTag);
      const urgency = normalizeUrgency(item?.urgency);
      const slNum = Number(item?.recommendedSl);
      const recommendedSl = Number.isFinite(slNum) && slNum > 0 ? round2(slNum) : null;
      const recommendedScaleOutPct = Math.round(clamp(Number(item?.recommendedScaleOutPct ?? 0), 0, 100));
      const rationaleEn = String(item?.rationaleEn ?? item?.adviceEn ?? '');
      const rationaleFa = String(item?.rationaleFa ?? item?.adviceFa ?? '');
      const thinkingTrace = normalizeThinkingTrace(item?.thinkingTrace, completion.rawReasoning, {
        agentName: 'LivePositionGuardian',
        triage: `Reviewing position ${positionId} @ spot $${Number(input.spotPrice).toFixed(2)}.`,
        blastRadius: `Macro=${macroBrief.regime}, newsGate=${input.newsGate?.state ?? 'CLEAR'}, urgency=${urgency}.`,
        resources: `H4=${input.quant?.brain?.h4Bias ?? 'n/a'}, RSI=${input.quant?.rsi?.active?.value ?? 'n/a'}.`,
        strategy: `Directive=${directive}, recommendedSl=${recommendedSl ?? 'unchanged'}, scaleOut=${recommendedScaleOutPct}%.`,
      });

      return {
        positionId,
        directive,
        recommendedSl,
        recommendedScaleOutPct,
        urgency,
        rationaleEn,
        rationaleFa,
        thinkingTrace,
        actionTag: mapDirectiveToLegacyActionTag(directive, input.newsGate?.state),
        adviceEn: rationaleEn,
        adviceFa: rationaleFa,
      };
    });

    const latencyMs = Date.now() - startedMs;
    this.emitTelemetry({
      eventType: 'SUB_AGENT_DONE',
      pipelineId,
      subAgentId: 'livePositionGuardian',
      subAgentStatus: 'COMPLETED',
      activeStage: `GUARDIAN_DONE:${directives.map((d) => d.directive).join(',') || 'NONE'}`,
      latencyMs,
      modelUsed: completion.modelUsed,
      providerMode: completion.providerMode,
      thinkingTrace: directives[0]?.thinkingTrace,
      summary: `Reviewed ${directives.length} confirmed broker position(s) in ${latencyMs}ms.`,
    });

    return {
      pipelineId,
      directives,
      latencyMs,
      modelUsed: completion.modelUsed,
      providerMode: completion.providerMode,
      macroBrief,
    };
  }
}

export const subAgentOrchestrator = new SubAgentOrchestrator();
