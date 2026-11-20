import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Brain,
  ChevronDown,
  ChevronUp,
  Cpu,
  ShieldCheck,
  Terminal,
  Zap,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { loadLocalAiSettings, type AiEngineSettings, type SubAgentId } from './AiSettingsModal';

interface SubAgentNodeView {
  id: SubAgentId;
  shortName: string;
  subLabel: string;
  enabled: boolean;
  state: 'SCANNING' | 'LOCKED' | 'GUARDING' | 'VETO' | 'STANDBY' | 'OFF';
  metric: string;
  latencyMs: number | null;
}

interface SniperStageView {
  stage: number;
  title: string;
  detail: string;
  status: 'COMPLETE' | 'ACTIVE' | 'PENDING';
  accent: string;
}

interface CognitiveBlock {
  tag: 'triage' | 'blast_radius_assessment' | 'resource_gathering' | 'surgical_strategy';
  title: string;
  lines: string[];
  tone: string;
}

export function AgentNeuralHud() {
  const quant = useAurumStore((s) => s.quant);
  const tick = useAurumStore((s) => s.tick);
  const timeframe = useAurumStore((s) => s.timeframe);
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const agentScanCount = useAurumStore((s) => s.agentScanCount);
  const basisDivergence = useAurumStore((s) => s.basisDivergence);
  const newsGate = useAurumStore((s) => s.newsGate);
  const liveNewsIntel = useAurumStore((s) => s.liveNewsIntel);
  const circuitBreakers = useAurumStore((s) => s.circuitBreakers);
  const advisory = useAurumStore((s) => s.advisory);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const proposals = useAurumStore((s) => s.proposals);

  // Defensive optional reads for Squad 3 store extensions (compile-safe pre & post merge)
  const rawStore = useAurumStore((s) => s as unknown as Record<string, unknown>);
  const aiTelemetry = rawStore?.aiTelemetry as
    | {
        activeSubAgent?: string;
        subAgents?: Record<string, { status?: string; latencyMs?: number; metric?: string }>;
        sniperStage?: number;
        thinkingProcess?: {
          triage?: string;
          blast_radius_assessment?: string;
          resource_gathering?: string;
          surgical_strategy?: string;
        };
        cognitiveStream?: string;
      }
    | undefined;

  const [streamOpen, setStreamOpen] = useState(false);
  const [aiSettings, setAiSettings] = useState<AiEngineSettings>(() => loadLocalAiSettings());
  const [pulsePhase, setPulsePhase] = useState(0);

  // Keep synced with AI Settings Modal updates
  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<AiEngineSettings>).detail;
      if (detail) setAiSettings(detail);
      else setAiSettings(loadLocalAiSettings());
    };
    window.addEventListener('payam:ai-config-updated', onUpdated);
    return () => window.removeEventListener('payam:ai-config-updated', onUpdated);
  }, []);

  // Smooth, low-overhead neural packet heartbeat while scanning or monitoring
  useEffect(() => {
    const active = agentBusy || agentEnabled || confirmedPositions.length > 0;
    if (!active) return;
    const intervalMs = agentBusy ? 360 : 1200;
    const id = window.setInterval(() => {
      setPulsePhase((p) => (p + 1) % 5);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [agentBusy, agentEnabled, confirmedPositions.length]);

  const brain = quant.brain;
  const rsi = quant.rsi.active;
  const dr = quant.dealingRange;
  const activePositions = confirmedPositions.filter((p) => p.status === 'ACTIVE');
  const openProposals = proposals.filter((p) => p.status === 'PROPOSED');

  // Compute the 5-Stage ICT Sniper State Pipeline deterministically (or accept Squad 3 override)
  const sniperStages = useMemo<SniperStageView[]>(() => {
    const hasLiquidityMapped = quant.liquidity.length > 0 && Number.isFinite(dr.equilibrium50);
    const hasSweep =
      brain.sweepDetected.active || quant.liquidity.some((l) => l.sweepRejected || l.swept);
    const hasMssDisplacement =
      quant.structures.some((st) => st.kind === 'CHoCH' || st.kind === 'BOS') &&
      quant.orderBlocks.some((ob) => !ob.mitigated && (ob.displacementAtr ?? 0) >= 0.9);
    const inOteOrGolden =
      brain.goldenConfluence ||
      dr.zone === 'DISCOUNT_OTE' ||
      dr.zone === 'PREMIUM_OTE' ||
      quant.fvgs.some((f) => !f.mitigated);
    const momentumTrigger =
      brain.decision !== 'STAND_DOWN' &&
      brain.hardVetoes.length === 0 &&
      ((brain.candidateDirection === 'LONG' && quant.tfs.bias !== 'BEARISH' && rsi.value < 72) ||
        (brain.candidateDirection === 'SHORT' && quant.tfs.bias !== 'BULLISH' && rsi.value > 28));

    const overrideStage = typeof aiTelemetry?.sniperStage === 'number' ? aiTelemetry.sniperStage : null;
    const stageFlags = [
      overrideStage !== null ? overrideStage >= 1 : hasLiquidityMapped,
      overrideStage !== null ? overrideStage >= 2 : hasSweep,
      overrideStage !== null ? overrideStage >= 3 : hasMssDisplacement,
      overrideStage !== null ? overrideStage >= 4 : inOteOrGolden,
      overrideStage !== null ? overrideStage >= 5 : momentumTrigger,
    ];

    let activeAssigned = false;
    const resolveStatus = (i: number): 'COMPLETE' | 'ACTIVE' | 'PENDING' => {
      if (stageFlags[i]) {
        const nextReady = i < 4 ? stageFlags[i + 1] : false;
        if (!nextReady && !activeAssigned) {
          activeAssigned = true;
          return 'ACTIVE';
        }
        return 'COMPLETE';
      }
      if (!activeAssigned) {
        activeAssigned = true;
        return 'ACTIVE';
      }
      return 'PENDING';
    };

    const sweepText = brain.sweepDetected.active && brain.sweepDetected.level
      ? `${brain.sweepDetected.side.startsWith('SSL') ? 'SSL' : 'BSL'} ${brain.sweepDetected.level.toFixed(1)}`
      : `${quant.liquidity.filter((l) => l.sweepRejected || l.swept).length}/${quant.liquidity.length} swept`;

    const latestStruct = quant.structures[quant.structures.length - 1];
    const mssText = latestStruct ? `${latestStruct.kind} ${latestStruct.direction === 'BULLISH' ? '↑' : '↓'}` : 'Scanning M5/M15';

    const oteSweet =
      brain.candidateDirection === 'SHORT' || brain.h4Bias === 'BEARISH'
        ? dr.oteShortSweetSpot
        : dr.oteLongSweetSpot;
    const fvgUnmit = quant.fvgs.filter((f) => !f.mitigated).length;

    return [
      {
        stage: 1,
        title: 'Session/EQ Liq',
        detail: `EQ ${dr.equilibrium50.toFixed(1)} · ${quant.liquidity.length} pools`,
        status: resolveStatus(0),
        accent: 'sky',
      },
      {
        stage: 2,
        title: 'BSL/SSL Sweep ⚡',
        detail: sweepText,
        status: resolveStatus(1),
        accent: 'amber',
      },
      {
        stage: 3,
        title: 'M5 MSS + Displ. 🔥',
        detail: mssText,
        status: resolveStatus(2),
        accent: 'orange',
      },
      {
        stage: 4,
        title: 'OTE + FVG CE50 🎯',
        detail: `70.5% ${oteSweet.toFixed(1)} · ${fvgUnmit} FVG`,
        status: resolveStatus(3),
        accent: 'gold',
      },
      {
        stage: 5,
        title: 'RSI + Tether 🚀',
        detail: `RSI ${rsi.value.toFixed(1)} · ${quant.tfs.bias === 'BULLISH' ? 'TFS↑' : quant.tfs.bias === 'BEARISH' ? 'TFS↓' : 'TFS·'}`,
        status: resolveStatus(4),
        accent: 'emerald',
      },
    ];
  }, [quant, brain, dr, rsi, aiTelemetry?.sniperStage]);

  const completedStages = sniperStages.filter((s) => s.status === 'COMPLETE').length;

  // Build 5-Sub-Agent Neural Circuit Nodes
  const subAgentNodes = useMemo<SubAgentNodeView[]>(() => {
    const enabledMap = new Map(aiSettings.subAgents.map((s) => [s.id, s.enabled]));
    const isEnabled = (id: SubAgentId) => enabledMap.get(id) ?? true;
    const tMap = aiTelemetry?.subAgents ?? {};

    const newsVeto = newsGate.vetoNewEntries || liveNewsIntel.shockDetected;
    const redTeamWarning =
      basisDivergence.cryptoInducementWarning ||
      brain.hardVetoes.length > 0 ||
      !circuitBreakers.canOpenNewTrades;

    const nodes: SubAgentNodeView[] = [
      {
        id: 'macro_news_sentinel',
        shortName: 'Macro News',
        subLabel: '45s Wire',
        enabled: isEnabled('macro_news_sentinel'),
        state: !isEnabled('macro_news_sentinel')
          ? 'OFF'
          : newsVeto
            ? 'VETO'
            : agentBusy && pulsePhase === 0
              ? 'SCANNING'
              : 'LOCKED',
        metric: tMap.macro_news_sentinel?.metric ?? `${newsGate.state} · ${liveNewsIntel.liveSourceCount}/${liveNewsIntel.totalSourceCount}`,
        latencyMs: tMap.macro_news_sentinel?.latencyMs ?? null,
      },
      {
        id: 'smc_orderflow_sniper',
        shortName: 'SMC Sniper',
        subLabel: `${timeframe} ICT`,
        enabled: isEnabled('smc_orderflow_sniper'),
        state: !isEnabled('smc_orderflow_sniper')
          ? 'OFF'
          : agentBusy && pulsePhase === 1
            ? 'SCANNING'
            : brain.goldenConfluence || brain.sweepDetected.active
              ? 'LOCKED'
              : 'STANDBY',
        metric: tMap.smc_orderflow_sniper?.metric ?? `${brain.totalScore}/100 · ${brain.convictionGrade}`,
        latencyMs: tMap.smc_orderflow_sniper?.latencyMs ?? Math.round(quant.computeMs),
      },
      {
        id: 'adversarial_red_team',
        shortName: 'Red-Team',
        subLabel: "Devil's Adv.",
        enabled: isEnabled('adversarial_red_team'),
        state: !isEnabled('adversarial_red_team')
          ? 'OFF'
          : redTeamWarning
            ? 'VETO'
            : agentBusy && pulsePhase === 2
              ? 'SCANNING'
              : 'LOCKED',
        metric: tMap.adversarial_red_team?.metric ?? (redTeamWarning ? `${Math.max(1, brain.hardVetoes.length)} Veto` : 'No Trap'),
        latencyMs: tMap.adversarial_red_team?.latencyMs ?? null,
      },
      {
        id: 'chief_execution_judge',
        shortName: 'Chief Judge',
        subLabel: 'System-2',
        enabled: isEnabled('chief_execution_judge'),
        state: !isEnabled('chief_execution_judge')
          ? 'OFF'
          : agentBusy && pulsePhase >= 3
            ? 'SCANNING'
            : brain.decision === 'STAND_DOWN'
              ? 'STANDBY'
              : 'LOCKED',
        metric:
          tMap.chief_execution_judge?.metric ??
          (brain.decision === 'STAND_DOWN'
            ? 'STAND DOWN'
            : `${brain.decision.replace('PROPOSE_', '')} (${openProposals.length})`),
        latencyMs: tMap.chief_execution_judge?.latencyMs ?? null,
      },
      {
        id: 'live_position_guardian',
        shortName: 'Pos. Guardian',
        subLabel: 'Co-Pilot',
        enabled: isEnabled('live_position_guardian'),
        state: !isEnabled('live_position_guardian')
          ? 'OFF'
          : activePositions.length > 0
            ? 'GUARDING'
            : 'STANDBY',
        metric:
          tMap.live_position_guardian?.metric ??
          (activePositions.length > 0
            ? `${activePositions.length} Live · ${activePositions[0].actionTag.replace(/_/g, ' ')}`
            : '0 Open'),
        latencyMs: tMap.live_position_guardian?.latencyMs ?? null,
      },
    ];

    return nodes;
  }, [
    aiSettings.subAgents,
    aiTelemetry?.subAgents,
    newsGate.vetoNewEntries,
    newsGate.state,
    liveNewsIntel.shockDetected,
    liveNewsIntel.liveSourceCount,
    liveNewsIntel.totalSourceCount,
    basisDivergence.cryptoInducementWarning,
    brain,
    circuitBreakers.canOpenNewTrades,
    agentBusy,
    pulsePhase,
    timeframe,
    quant.computeMs,
    openProposals.length,
    activePositions,
  ]);

  // Real-time System-2 <thinking_process> Cognitive Stream blocks
  const cognitiveBlocks = useMemo<CognitiveBlock[]>(() => {
    const tp = aiTelemetry?.thinkingProcess;
    const watch = brain.watchlistZone;
    const unmitObs = quant.orderBlocks.filter((o) => !o.mitigated);
    const unmitFvgs = quant.fvgs.filter((f) => !f.mitigated);

    return [
      {
        tag: 'triage',
        title: 'Triage & Macro Alignment',
        tone: 'text-sky-300',
        lines: tp?.triage
          ? [tp.triage]
          : [
              `H4 Macro Compass: ${brain.h4Bias} (strength ${(brain.h4Strength * 100).toFixed(0)}%) | H1 Bias: ${brain.h1Bias} | Active TF: ${timeframe}`,
              `Killzone: ${brain.killzone.replace(/_/g, ' ')} | Spot: $${tick.last.toFixed(2)} | Spread: $${tick.spread.toFixed(2)} | Basis: ${basisDivergence.basisUsd >= 0 ? '+' : ''}${basisDivergence.basisUsd.toFixed(2)}$ (${basisDivergence.status})`,
            ],
      },
      {
        tag: 'blast_radius_assessment',
        title: 'Blast Radius & Risk Governance',
        tone: 'text-amber-300',
        lines: tp?.blast_radius_assessment
          ? [tp.blast_radius_assessment]
          : [
              `News Shield: ${newsGate.state} (Lot mult ${newsGate.lotMultiplier.toFixed(2)}x) | Macro Wire: ${liveNewsIntel.macroSentiment} (${liveNewsIntel.sentimentScore}) | Shock: ${liveNewsIntel.shockDetected ? 'ACTIVE VETO' : 'Clear'}`,
              `7-Breaker Matrix: ${circuitBreakers.canOpenNewTrades ? 'AUTHORIZED' : 'HALTED'} | ATR Ext: ${brain.atrExtension.toFixed(2)}x | Kaufman ER: ${brain.kaufmanEfficiency.toFixed(2)} | Hard Vetoes: ${brain.hardVetoes.length > 0 ? brain.hardVetoes.join(', ') : 'NONE'}`,
            ],
      },
      {
        tag: 'resource_gathering',
        title: 'ICT Liquidity, OTE & Confluence Harvest',
        tone: 'text-[#E5BF70]',
        lines: tp?.resource_gathering
          ? [tp.resource_gathering]
          : [
              `Liquidity Sweep: ${brain.sweepDetected.active ? `${brain.sweepDetected.side} @ $${brain.sweepDetected.level?.toFixed(2)} (wick ${(brain.sweepDetected.wickRejectionRatio * 100).toFixed(0)}%)` : 'No fresh rejection wick'} | Pools tracked: ${quant.liquidity.length}`,
              `Unmitigated Zones: ${unmitObs.length} OB / ${unmitFvgs.length} FVG | Golden OB+FVG: ${brain.goldenConfluence ? 'LOCKED' : 'Pending'} | Dealing Range: ${dr.zone.replace(/_/g, ' ')} (${dr.positionPct.toFixed(1)}%)`,
              `Wilder RSI(14): ${rsi.value.toFixed(1)} (${rsi.regime.replace(/_/g, ' ')}${rsi.divergence !== 'NONE' ? ` · ${rsi.divergence}` : ''}) | TFS Tether: $${quant.tfs.tetherPrice.toFixed(2)} (${quant.tfs.bias})`,
            ],
      },
      {
        tag: 'surgical_strategy',
        title: 'Chief Judge Surgical Strategy',
        tone: brain.decision === 'PROPOSE_LONG' ? 'text-emerald-300' : brain.decision === 'PROPOSE_SHORT' ? 'text-red-300' : 'text-slate-200',
        lines: tp?.surgical_strategy
          ? [tp.surgical_strategy]
          : [
              `Verdict: ${brain.decision} | Weighted Score: ${brain.totalScore}/100 (Grade ${brain.convictionGrade}) | Risk Mult: ${(brain.recommendedRiskMultiplier * 100).toFixed(0)}%`,
              watch
                ? `Sniper Corridor (${watch.direction}): Entry $${watch.entryLow.toFixed(2)}–$${watch.entryHigh.toFixed(2)} (Optimal $${watch.optimalEntry.toFixed(2)}) | Invalidation $${watch.invalidationLevel.toFixed(2)} | Target $${watch.targetLiquidity.toFixed(2)}`
                : `Advisory (${advisory.verdict}): ${advisory.rationaleEn}`,
            ],
      },
    ];
  }, [
    aiTelemetry?.thinkingProcess,
    brain,
    timeframe,
    tick.last,
    tick.spread,
    basisDivergence,
    newsGate,
    liveNewsIntel,
    circuitBreakers,
    quant.orderBlocks,
    quant.fvgs,
    quant.liquidity.length,
    quant.tfs,
    dr,
    rsi,
    advisory,
  ]);

  const nodeColor = (state: SubAgentNodeView['state']) => {
    switch (state) {
      case 'SCANNING':
        return { stroke: '#E5BF70', fill: 'rgba(212, 168, 83, 0.16)', text: '#FDE68A', dot: '#E5BF70' };
      case 'LOCKED':
        return { stroke: '#10B981', fill: 'rgba(16, 185, 129, 0.13)', text: '#6EE7B7', dot: '#10B981' };
      case 'GUARDING':
        return { stroke: '#38BDF8', fill: 'rgba(56, 189, 248, 0.14)', text: '#7DD3FC', dot: '#38BDF8' };
      case 'VETO':
        return { stroke: '#EF4444', fill: 'rgba(239, 68, 68, 0.14)', text: '#FCA5A5', dot: '#EF4444' };
      case 'OFF':
        return { stroke: 'rgba(148,163,184,0.22)', fill: 'rgba(15,23,42,0.55)', text: '#64748B', dot: '#475569' };
      default:
        return { stroke: 'rgba(148,163,184,0.35)', fill: 'rgba(15,23,42,0.75)', text: '#CBD5E1', dot: '#94A3B8' };
    }
  };

  const isFlowActive = agentBusy || agentEnabled || activePositions.length > 0;

  return (
    <div
      dir="ltr"
      data-testid="agent-neural-hud"
      className="border-b border-white/8 bg-[#0C1220] px-3 py-2.5 space-y-2"
    >
      {/* Row 1: Multi-Agent Neural Pulse Pipeline (SVG Circuit Header) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] font-mono">
          <div className="flex items-center gap-2 text-slate-200">
            <Brain className="w-3.5 h-3.5 text-[#E5BF70] shrink-0" />
            <span className="font-semibold text-slate-100">5-Sub-Agent Neural Pipeline</span>
            <span className="text-slate-600">·</span>
            <span className={agentBusy ? 'text-[#E5BF70]' : agentEnabled ? 'text-emerald-400' : 'text-slate-400'}>
              {agentBusy ? 'ACTIVE SCAN WAVE' : agentEnabled ? 'AUTONOMOUS GUARD' : 'ON-DEMAND TELEMETRY'}
            </span>
            <span className="text-slate-600 hidden sm:inline">·</span>
            <span className="text-slate-400 hidden sm:inline tabular-nums">
              Cycles #{agentScanCount}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setStreamOpen((v) => !v)}
            aria-expanded={streamOpen}
            data-testid="toggle-cognitive-stream"
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10.5px] font-mono border transition-colors whitespace-nowrap cursor-pointer ${
              streamOpen
                ? 'bg-[#D4A853]/18 border-[#D4A853]/50 text-[#E5BF70]'
                : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:border-white/25 hover:text-slate-100'
            }`}
          >
            <Terminal className="w-3 h-3 text-[#E5BF70]" />
            <span>System-2 Cognitive Stream (&lt;thinking_process&gt;)</span>
            {streamOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* SVG Neural Circuit Bus */}
        <div className="w-full overflow-x-auto">
          <svg
            viewBox="0 0 960 56"
            className="w-full min-w-[680px] h-[54px] block"
            role="img"
            aria-label="5-Sub-Agent Neural Pulse Pipeline"
          >
            <defs>
              <linearGradient id="payam-bus-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
                <stop offset="45%" stopColor="#D4A853" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#10B981" stopOpacity="0.55" />
              </linearGradient>
            </defs>

            {/* Connecting neural traces between the 5 agent nodes */}
            {[0, 1, 2, 3].map((edgeIdx) => {
              const x1 = 172 + edgeIdx * 194;
              const x2 = 200 + edgeIdx * 194;
              const y = 28;
              const isEdgeHot = isFlowActive && (agentBusy || pulsePhase === edgeIdx || pulsePhase === edgeIdx + 1);
              const packetX = x1 + ((pulsePhase + edgeIdx) % 4) * ((x2 - x1 - 4) / 3);
              return (
                <g key={edgeIdx}>
                  <line
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y}
                    stroke={isEdgeHot ? 'url(#payam-bus-grad)' : 'rgba(148,163,184,0.22)'}
                    strokeWidth={isEdgeHot ? 2 : 1.2}
                    strokeDasharray={isEdgeHot ? 'none' : '3 3'}
                  />
                  {/* Arrow head */}
                  <polygon
                    points={`${x2 - 5},${y - 3.5} ${x2},${y} ${x2 - 5},${y + 3.5}`}
                    fill={isEdgeHot ? '#E5BF70' : 'rgba(148,163,184,0.35)'}
                  />
                  {/* Crisp dual-ring data packet along neural bus (zero SMIL/blur overhead) */}
                  {isFlowActive && (
                    <g style={{ transition: 'transform 300ms ease-out' }}>
                      <circle cx={packetX} cy={y} r="5.5" fill={edgeIdx === 3 ? '#38BDF8' : '#E5BF70'} opacity="0.22" />
                      <circle cx={packetX} cy={y} r="2.6" fill={edgeIdx === 3 ? '#7DD3FC' : '#FDE68A'} />
                    </g>
                  )}
                </g>
              );
            })}

            {/* 5 Sub-Agent Nodes */}
            {subAgentNodes.map((node, i) => {
              const x = 6 + i * 194;
              const y = 5;
              const w = 166;
              const h = 46;
              const pal = nodeColor(node.state);
              const isHighlighted = isFlowActive && pulsePhase === i && node.enabled;

              return (
                <g key={node.id}>
                  <rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    rx="7"
                    fill={pal.fill}
                    stroke={isHighlighted ? '#E5BF70' : pal.stroke}
                    strokeWidth={isHighlighted ? 1.5 : 1}
                  />
                  {/* Left telemetry state bar */}
                  <rect x={x + 6} y={y + 10} width="3" height="26" rx="1.5" fill={pal.dot} opacity={node.enabled ? 0.9 : 0.35} />
                  {/* Agent title */}
                  <text
                    x={x + 15}
                    y={y + 19}
                    fill="#F1F5F9"
                    fontSize="10.5"
                    fontWeight="600"
                    fontFamily="Plus Jakarta Sans, DM Sans, system-ui, sans-serif"
                  >
                    {node.shortName}
                  </text>
                  {/* State label top-right */}
                  <text
                    x={x + w - 8}
                    y={y + 18}
                    textAnchor="end"
                    fill={pal.text}
                    fontSize="8.8"
                    fontWeight="700"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {node.state}
                  </text>
                  {/* Metric readout bottom */}
                  <text
                    x={x + 15}
                    y={y + 36}
                    fill="#94A3B8"
                    fontSize="9.2"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {node.metric.slice(0, 21)}
                  </text>
                  {node.latencyMs !== null && (
                    <text
                      x={x + w - 8}
                      y={y + 36}
                      textAnchor="end"
                      fill="#64748B"
                      fontSize="8.5"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {node.latencyMs}ms
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Row 2: 5-Stage ICT Sniper State Progress Bar */}
      <div
        className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-1 border-t border-white/6"
        aria-label="5-Stage ICT Sniper State Progress Bar"
        data-testid="ict-sniper-progress-bar"
      >
        {sniperStages.map((st) => {
          const isComplete = st.status === 'COMPLETE';
          const isActive = st.status === 'ACTIVE';
          return (
            <div
              key={st.stage}
              className={`px-2 py-1.5 rounded border transition-colors min-w-0 ${
                isComplete
                  ? 'bg-emerald-500/10 border-emerald-500/35'
                  : isActive
                    ? 'bg-[#D4A853]/12 border-[#D4A853]/55'
                    : 'bg-[#0B0F17] border-white/6 opacity-70'
              }`}
            >
              <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                <span
                  className={
                    isComplete
                      ? 'text-emerald-300 font-semibold truncate'
                      : isActive
                        ? 'text-[#E5BF70] font-semibold truncate'
                        : 'text-slate-400 truncate'
                  }
                >
                  S{st.stage}: {st.title}
                </span>
                {isComplete ? (
                  <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : isActive ? (
                  <Zap className="w-3 h-3 text-[#E5BF70] shrink-0" />
                ) : (
                  <Activity className="w-3 h-3 text-slate-600 shrink-0" />
                )}
              </div>
              <div className="text-[9.5px] font-mono tabular-nums text-slate-400 truncate mt-0.5">
                {st.detail}
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 3: Collapsible Live System-2 Cognitive Stream (<thinking_process>) Drawer */}
      {streamOpen && (
        <div
          data-testid="cognitive-stream-drawer"
          className="rounded-md border border-[#D4A853]/30 bg-[#070B12] p-3 space-y-2.5 font-mono text-[11px]"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-white/8 text-[10.5px]">
            <div className="flex items-center gap-2 text-[#E5BF70]">
              <Cpu className="w-3.5 h-3.5 shrink-0" />
              <span className="font-semibold">&lt;thinking_process&gt; Live System-2 Cognitive Trace</span>
            </div>
            <div className="text-slate-400 tabular-nums">
              Sniper Stage {completedStages}/5 · Brain {brain.totalScore}/100 ({brain.convictionGrade}) · XAU ${tick.last.toFixed(2)}
            </div>
          </div>

          {aiTelemetry?.cognitiveStream ? (
            <pre className="text-[11px] text-slate-300 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
              {aiTelemetry.cognitiveStream}
            </pre>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {cognitiveBlocks.map((block) => (
                <div key={block.tag} className="space-y-0.5">
                  <div className={`text-[10.5px] font-semibold ${block.tone}`}>
                    &lt;{block.tag}&gt; <span className="text-slate-500 font-normal">— {block.title}</span>
                  </div>
                  {block.lines.map((ln, idx) => (
                    <div key={idx} className="pl-3 text-slate-300 leading-relaxed">
                      {ln}
                    </div>
                  ))}
                  <div className="text-[10px] text-slate-600">&lt;/{block.tag}&gt;</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
