import { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Crosshair,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  X,
  XCircle,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type {
  AgentProposal,
  ConfirmedPosition,
  PositionCoPilotDirective,
  ProposalLifecycleStatus,
  ProposalStatus,
} from '../engine/types';

type ProposalFilter = 'ALL' | ProposalStatus | 'TERMINATED';

interface BrokerConfirmDraft {
  mode: 'LIMIT' | 'MARKET';
  fillPriceStr: string;
  lotSizeStr: string;
}

function getDirectivePresentation(directive: PositionCoPilotDirective | undefined): {
  label: string;
  toneClasses: string;
  badgeClasses: string;
  actionButtonLabel: string;
} {
  switch (directive) {
    case 'EMERGENCY_EXIT_NOW':
      return {
        label: 'EMERGENCY EXIT NOW 🚨',
        toneClasses: 'border-red-500/60 bg-red-950/35',
        badgeClasses: 'bg-red-500/25 text-red-200 border-red-400/50',
        actionButtonLabel: 'I Exited in My Broker ✓',
      };
    case 'PARTIAL_TAKE_PROFIT_TP1':
      return {
        label: 'PARTIAL CLOSE AT TP1 💰',
        toneClasses: 'border-emerald-400/50 bg-emerald-950/25',
        badgeClasses: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/45',
        actionButtonLabel: 'I Applied This in My Broker ✓',
      };
    case 'MOVE_SL_TO_BREAKEVEN':
      return {
        label: 'MOVE SL TO BREAKEVEN ⚡',
        toneClasses: 'border-amber-400/55 bg-amber-950/25',
        badgeClasses: 'bg-amber-500/20 text-amber-200 border-amber-400/45',
        actionButtonLabel: 'I Applied This in My Broker ✓',
      };
    case 'TRAIL_STOP_STRUCTURAL':
      return {
        label: 'TRAIL SL BEHIND M5 SWING 🛡️',
        toneClasses: 'border-sky-400/50 bg-sky-950/25',
        badgeClasses: 'bg-sky-500/20 text-sky-200 border-sky-400/45',
        actionButtonLabel: 'I Applied This in My Broker ✓',
      };
    case 'HOLD_STEADY':
    default:
      return {
        label: 'HOLD STEADY',
        toneClasses: 'border-white/10 bg-[#111827]/90',
        badgeClasses: 'bg-white/6 text-slate-200 border-white/15',
        actionButtonLabel: 'I Applied This in My Broker ✓',
      };
  }
}

function getLifecyclePresentation(status: ProposalLifecycleStatus | undefined): {
  label: string;
  labelFa: string;
  classes: string;
  terminated: boolean;
} {
  switch (status) {
    case 'PENDING_LIMIT_IN_BROKER':
      return {
        label: 'PENDING LIMIT IN BROKER',
        labelFa: 'لیمیت ثبت‌شده در بروکر',
        classes: 'text-sky-300 border-sky-400/35 bg-sky-500/10',
        terminated: false,
      };
    case 'FILLED_IN_BROKER':
      return {
        label: 'FILLED · LIVE MONITORED',
        labelFa: 'فعال در بروکر · تحت پایش',
        classes: 'text-emerald-300 border-emerald-400/35 bg-emerald-500/10',
        terminated: false,
      };
    case 'EXPIRED_TTL':
      return {
        label: 'EXPIRED (TTL)',
        labelFa: 'منقضی شد (پایان عمر کندلی)',
        classes: 'text-slate-400 border-white/15 bg-white/5',
        terminated: true,
      };
    case 'INVALIDATED_STRUCTURE':
      return {
        label: 'INVALIDATED (SL BREACHED)',
        labelFa: 'ساختار پیش از ورود نقض شد',
        classes: 'text-red-300 border-red-500/35 bg-red-500/10',
        terminated: true,
      };
    case 'CANCELLED_FRONT_RUN':
      return {
        label: 'CANCELLED · TARGET HIT BEFORE FILL',
        labelFa: 'هدف قبل از ورود لمس شد — دیر وارد نشوید!',
        classes: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
        terminated: true,
      };
    case 'ACTIVE':
    default:
      return {
        label: 'ACTIVE',
        labelFa: 'معتبر',
        classes: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
        terminated: false,
      };
  }
}

function isProposalTerminated(prop: AgentProposal): boolean {
  const lc = prop.proposalLifecycleStatus;
  return lc === 'EXPIRED_TTL' || lc === 'INVALIDATED_STRUCTURE' || lc === 'CANCELLED_FRONT_RUN';
}

export function ProposalsPanel() {
  const proposals = useAurumStore((s) => s.proposals);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const focusedPositionId = useAurumStore((s) => s.focusedPositionId);
  const tick = useAurumStore((s) => s.tick);
  const feedMode = useAurumStore((s) => s.feedMode);
  const ticksPerMinute = useAurumStore((s) => s.ticksPerMinute);
  const quant = useAurumStore((s) => s.quant);
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const confirmProposal = useAurumStore((s) => s.confirmProposal);
  const dismissProposal = useAurumStore((s) => s.dismissProposal);
  const runAgentScanCycle = useAurumStore((s) => s.runAgentScanCycle);
  const monitorOpenPositions = useAurumStore((s) => s.monitorOpenPositions);
  const applyPositionDirective = useAurumStore((s) => s.applyPositionDirective);
  const markLimitFilledInBroker = useAurumStore((s) => s.markLimitFilledInBroker);
  const closeConfirmedPosition = useAurumStore((s) => s.closeConfirmedPosition);
  const focusPosition = useAurumStore((s) => s.focusPosition);
  const brain = quant.brain;

  const [filter, setFilter] = useState<ProposalFilter>('PROPOSED');
  const [defaultLotSize, setDefaultLotSize] = useState<number>(0.2);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrokerConfirmDraft | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeCount = proposals.filter((p) => p.status === 'PROPOSED' && !isProposalTerminated(p)).length;
  const confirmedCount = proposals.filter((p) => p.status === 'CONFIRMED').length;
  const terminatedCount = proposals.filter((p) => isProposalTerminated(p)).length;

  const filtered = proposals.filter((p) => {
    if (filter === 'ALL') return true;
    if (filter === 'TERMINATED') return isProposalTerminated(p);
    if (filter === 'PROPOSED') return p.status === 'PROPOSED' && !isProposalTerminated(p);
    return p.status === filter;
  });

  const handleCopyPrice = (key: string, value: number) => {
    const formatted = value.toFixed(2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(formatted).catch(() => {});
    }
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const openConfirmDrawer = (prop: AgentProposal) => {
    const isLong = prop.direction === 'LONG';
    const liveDefaultFill =
      tick.last > 0 ? (isLong ? tick.ask : tick.bid) : prop.entry;
    setConfirmingId(prop.id);
    setConfirmError(null);
    setDraft({
      mode: prop.orderType === 'MARKET' ? 'MARKET' : 'LIMIT',
      fillPriceStr: liveDefaultFill.toFixed(2),
      lotSizeStr: defaultLotSize.toFixed(2),
    });
  };

  const submitManualBrokerConfirmation = (prop: AgentProposal) => {
    if (!draft) return;
    setConfirmError(null);
    const parsedLot = Number(draft.lotSizeStr);
    if (!Number.isFinite(parsedLot) || parsedLot < 0.01 || parsedLot > 50) {
      setConfirmError('Enter a valid broker lot size between 0.01 and 50.00.');
      return;
    }

    if (draft.mode === 'LIMIT') {
      const res = confirmProposal(prop.id, {
        lotSize: parsedLot,
        executionType: 'LIMIT',
      });
      if (!res.ok) {
        setConfirmError(res.errors[0] ?? 'Unable to track pending LIMIT order.');
        return;
      }
      setConfirmingId(null);
      setDraft(null);
      return;
    }

    const parsedFill = Number(draft.fillPriceStr);
    if (!Number.isFinite(parsedFill) || parsedFill <= 0) {
      setConfirmError('Enter your exact broker fill price from MT4/MT5/cTrader.');
      return;
    }

    const res = confirmProposal(prop.id, {
      lotSize: parsedLot,
      executionType: 'MARKET',
      actualFillPrice: parsedFill,
    });
    if (!res.ok) {
      setConfirmError(res.errors[0] ?? 'Unable to confirm broker fill.');
      return;
    }
    setConfirmingId(null);
    setDraft(null);
  };

  const renderPositionGuardianCard = (pos: ConfirmedPosition) => {
    const isLong = pos.direction === 'LONG';
    const isPending = pos.status === 'PENDING_LIMIT';
    const isFocused = focusedPositionId === pos.id;
    const directive = pos.latestDirective ?? 'HOLD_STEADY';
    const pres = getDirectivePresentation(directive);
    const recPrice =
      typeof pos.recommendedActionPrice === 'number' && Number.isFinite(pos.recommendedActionPrice)
        ? pos.recommendedActionPrice
        : pos.stopLoss;
    const copyId = `dir-${pos.id}`;
    const priceLabel =
      isPending
        ? 'Pending Limit Entry'
        : directive === 'PARTIAL_TAKE_PROFIT_TP1'
          ? `Scale-Out ${Math.round(pos.recommendedScaleOutPct ?? 50)}% @ TP1`
          : directive === 'EMERGENCY_EXIT_NOW'
            ? 'Market Exit Near'
            : directive === 'MOVE_SL_TO_BREAKEVEN'
              ? 'Move Broker SL To (BE)'
              : directive === 'TRAIL_STOP_STRUCTURAL'
                ? 'Trail Broker SL To (M5)'
                : 'Anchored Structural SL';

    return (
      <article
        key={pos.id}
        data-testid={`copilot-position-card-${pos.id}`}
        className={`rounded-md border p-3.5 space-y-3 transition-colors ${pres.toneClasses} ${
          isFocused ? 'ring-1 ring-[#D4A853]/60' : ''
        }`}
      >
        {/* Top Row: Identity + Live P&L / R-Multiple */}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className={`font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                {pos.direction}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-200">{pos.lotSize.toFixed(2)} lot</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-300">{pos.timeframe}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">{pos.orderId}</span>
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${
                  isPending
                    ? 'border-sky-400/40 bg-sky-500/10 text-sky-300'
                    : 'border-emerald-400/35 bg-emerald-500/10 text-emerald-300'
                }`}
              >
                {isPending ? 'PENDING LIMIT IN BROKER' : 'LIVE IN BROKER'}
              </span>
            </div>
            <h4 className="font-display text-sm font-semibold text-slate-100 truncate">
              {pos.setupType}
            </h4>
          </div>

          <div className="text-right font-mono tabular-nums shrink-0" dir="ltr">
            <div
              className={`text-sm font-semibold ${
                isPending ? 'text-sky-300' : pos.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {isPending ? 'AWAITING FILL' : `${pos.netPnl >= 0 ? '+' : ''}$${pos.netPnl.toFixed(2)}`}
            </div>
            <div className="text-[11px] text-slate-400">
              {isPending
                ? `Target $${pos.entry.toFixed(2)}`
                : `${pos.rMultiple >= 0 ? '+' : ''}${pos.rMultiple.toFixed(2)}R · R:R 1:${pos.rrRatio.toFixed(2)}`}
            </div>
          </div>
        </div>

        {/* Live Broker Co-Pilot Directive Banner */}
        <div
          data-testid={`copilot-directive-banner-${pos.id}`}
          className="rounded-md border border-white/10 bg-[#0B0F17]/90 p-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid={`copilot-directive-badge-${pos.id}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border font-mono text-[11px] font-bold tracking-wide ${pres.badgeClasses}`}
              >
                {pres.label}
              </span>
              {pos.directiveUrgency && pos.directiveUrgency !== 'NORMAL' && (
                <span
                  className={`font-mono text-[10px] font-semibold uppercase ${
                    pos.directiveUrgency === 'CRITICAL' ? 'text-red-300' : 'text-amber-300'
                  }`}
                >
                  {pos.directiveUrgency} URGENCY
                </span>
              )}
            </div>

            {/* Exact Copyable Price Level for MT4/MT5/cTrader */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-[#111827] border border-white/10 font-mono text-xs tabular-nums">
              <span className="text-slate-400 text-[10px]">{priceLabel}:</span>
              <span className="text-[#E5BF70] font-semibold" dir="ltr">
                ${recPrice.toFixed(2)}
              </span>
              <button
                type="button"
                onClick={() => handleCopyPrice(copyId, recPrice)}
                aria-label={`Copy recommended price ${recPrice.toFixed(2)} for ${pos.orderId}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/8 hover:bg-white/15 text-slate-200 text-[10px] transition-colors"
              >
                {copiedKey === copyId ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span className="text-emerald-300">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Bilingual Co-Pilot Rationale */}
          <div className="space-y-1 text-xs leading-relaxed">
            {(pos.directiveRationaleFa || pos.adviceFa) && (
              <p className="font-fa text-slate-100 text-right" dir="rtl">
                {pos.directiveRationaleFa || pos.adviceFa}
              </p>
            )}
            {(pos.directiveRationaleEn || pos.adviceEn) && (
              <p className="text-[11px] text-slate-400" dir="ltr">
                {pos.directiveRationaleEn || pos.adviceEn}
              </p>
            )}
          </div>

          {pos.thinkingTrace && (
            <details className="text-[11px] text-slate-400 pt-1 border-t border-white/6">
              <summary className="cursor-pointer font-mono text-[10px] text-sky-300 hover:text-sky-200">
                Co-Pilot Thinking Trace
              </summary>
              <p className="mt-1 font-mono text-[10px] whitespace-pre-wrap text-slate-300" dir="ltr">
                {pos.thinkingTrace}
              </p>
            </details>
          )}
        </div>

        {/* Anchored Structural Geometry Strip */}
        <div
          className="grid grid-cols-4 gap-2 px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/6 font-mono text-[11px] tabular-nums"
          dir="ltr"
        >
          <div>
            <div className="text-slate-500 text-[10px]">FILL / ENTRY</div>
            <div className="text-slate-100 font-medium">{pos.entry.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px]">CURRENT SL</div>
            <div className="text-red-400 font-medium">{pos.stopLoss.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px]">TP1</div>
            <div className="text-emerald-400 font-medium">{pos.tp1.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-slate-500 text-[10px]">TP2</div>
            <div className="text-emerald-300 font-medium">{pos.tp2.toFixed(2)}</div>
          </div>
        </div>

        {/* 1-Click Broker Synchronization & Close Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => focusPosition(pos.id)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-colors ${
                isFocused
                  ? 'border-[#D4A853]/50 bg-[#D4A853]/15 text-[#E5BF70]'
                  : 'border-white/10 text-slate-300 hover:bg-white/5'
              }`}
            >
              <Crosshair className="w-3 h-3" />
              {isFocused ? 'On Chart' : 'Focus'}
            </button>

            {isPending ? (
              <button
                type="button"
                data-testid={`mark-limit-filled-${pos.id}`}
                onClick={() => markLimitFilledInBroker(pos.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-sky-500/20 text-sky-200 border border-sky-400/45 hover:bg-sky-500/30 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Mark Filled in Broker ✓</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid={`apply-directive-${pos.id}`}
                onClick={() => applyPositionDirective(pos.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/45 hover:bg-emerald-500/30 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{pres.actionButtonLabel}</span>
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid={`close-broker-pos-${pos.id}`}
            onClick={() => closeConfirmedPosition(pos.id)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-red-500/15 text-red-200 border border-red-500/35 hover:bg-red-500/25 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>{isPending ? 'Cancel Pending Limit ✕' : 'Position Closed in Broker ✕'}</span>
          </button>
        </div>
      </article>
    );
  };

  return (
    <section
      aria-label="Agentic Position Proposals & Live Broker Co-Pilot"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden flex flex-col"
      data-testid="proposals-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-[#D4A853] shrink-0" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>Agentic Signal Proposals &amp; Broker Co-Pilot</span>
              <span className="font-fa text-xs font-normal text-[#E5BF70]" dir="rtl">
                پیشنهادهای پوزیشن و دستیار زنده بروکر
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Confirm manually placed MT4/MT5/cTrader trades (Pending LIMIT or Live Fill) with zero structural SL/TP shift.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Live Tick Velocity Indicator */}
          <span
            className="font-mono text-[11px] text-slate-400 tabular-nums px-2 py-1 rounded bg-[#0B0F17] border border-white/8"
            dir="ltr"
            title="Real price-change ticks observed in rolling 60s window"
          >
            {ticksPerMinute} ticks/min
          </span>

          {/* Default Lot Size Picker */}
          <label className="flex items-center gap-1.5 font-mono text-slate-400">
            <span>Default Lot:</span>
            <select
              value={defaultLotSize}
              onChange={(e) => setDefaultLotSize(Number(e.target.value))}
              aria-label="Default broker confirmation lot size"
              className="bg-[#0B0F17] border border-white/10 rounded px-2 py-1 text-slate-100 font-mono text-xs"
            >
              <option value={0.1}>0.10</option>
              <option value={0.2}>0.20</option>
              <option value={0.25}>0.25</option>
              <option value={0.5}>0.50</option>
              <option value={1.0}>1.00</option>
            </select>
          </label>

          {/* Filter Tabs */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0F17] border border-white/8 font-mono text-[11px]">
            {(
              [
                ['PROPOSED', `Active (${activeCount})`],
                ['CONFIRMED', `Confirmed (${confirmedCount})`],
                ['TERMINATED', `Expired (${terminatedCount})`],
                ['ALL', `All (${proposals.length})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                  filter === key ? 'bg-[#D4A853] text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ACTIVE CONFIRMED POSITIONS — RELENTLESS LIVE BROKER CO-PILOT GUARDIAN */}
      {confirmedPositions.length > 0 && (
        <div
          data-testid="active-positions-copilot-section"
          className="px-4 py-3.5 border-b border-[#D4A853]/25 bg-[#0D1422] space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-100">
                Active Broker Positions — Live Co-Pilot Guardian ({confirmedPositions.length})
              </h3>
              <span className="font-mono text-[10px] text-emerald-300">Auto-Sync 12s</span>
            </div>

            <button
              type="button"
              onClick={() => void monitorOpenPositions()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 font-mono text-[11px] text-slate-200 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Co-Pilot</span>
            </button>
          </div>

          <div className="space-y-3">{confirmedPositions.map(renderPositionGuardianCard)}</div>
        </div>
      )}

      {/* Disciplined Stand-Down Banner when 7-Gate Shield blocks new entries */}
      {brain.decision === 'STAND_DOWN' && feedMode === 'LIVE_INTERBANK' && (
        <div
          data-testid="proposals-stand-down-banner"
          className="px-4 py-2.5 border-b border-amber-400/20 bg-amber-950/20 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="font-mono text-[11px] font-semibold text-amber-300">
              PAYAM BRAIN STAND DOWN ({brain.totalScore}/100) ·{' '}
              {brain.hardVetoes.length > 0 ? brain.hardVetoes.join(', ') : 'Score below threshold'}
            </div>
            <p className="font-fa text-[11px] text-slate-200" dir="rtl">
              {brain.summaryFa}
            </p>
          </div>
          {brain.watchlistZone && (
            <span className="font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap" dir="ltr">
              Wait Zone: ${brain.watchlistZone.entryLow.toFixed(2)}–${brain.watchlistZone.entryHigh.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Proposal Cards Grid */}
      <div className="p-4">
        {filtered.length === 0 ? (
          <div className="py-8 text-center space-y-2.5 text-xs text-slate-400">
            <p>
              {feedMode !== 'LIVE_INTERBANK'
                ? 'Awaiting live interbank XAU/USD feed connection. Signal generation is paused until real spot data arrives.'
                : filter === 'PROPOSED'
                  ? 'No active proposals in queue. Run a live scan when market structure aligns.'
                  : 'No proposals match this filter yet.'}
            </p>
            <button
              type="button"
              disabled={agentBusy || feedMode !== 'LIVE_INTERBANK'}
              onClick={() => void runAgentScanCycle({ quantOnly: !agentEnabled })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#D4A853]/35 text-[#E5BF70] hover:bg-[#D4A853]/10 disabled:opacity-40 transition-colors"
            >
              Generate Fresh Tool-Verified Proposal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[620px] overflow-y-auto pr-1">
            {filtered.map((prop) => {
              const isLong = prop.direction === 'LONG';
              const isConfirmed = prop.status === 'CONFIRMED';
              const isDismissed = prop.status === 'DISMISSED';
              const terminated = isProposalTerminated(prop);
              const lifecyclePres = getLifecyclePresentation(prop.proposalLifecycleStatus);
              const isDrawerOpen = confirmingId === prop.id && draft !== null;

              // Live R:R recalculation for Option B (Opened Live in Broker — Market / Filled)
              let liveFillMetrics: {
                valid: boolean;
                error?: string;
                fillPrice: number;
                slippageUsd: number;
                liveRr: number;
                rrDegraded: boolean;
                rrCritical: boolean;
                riskUsd: number;
              } | null = null;

              if (isDrawerOpen && draft.mode === 'MARKET') {
                const fPrice = Number(draft.fillPriceStr);
                const fLot = Number(draft.lotSizeStr);
                if (!Number.isFinite(fPrice) || fPrice <= 0) {
                  liveFillMetrics = {
                    valid: false,
                    error: 'Enter a valid numeric fill price.',
                    fillPrice: 0,
                    slippageUsd: 0,
                    liveRr: 0,
                    rrDegraded: false,
                    rrCritical: false,
                    riskUsd: 0,
                  };
                } else {
                  const geomOk = isLong
                    ? prop.stopLoss < fPrice && fPrice < prop.tp1
                    : prop.stopLoss > fPrice && fPrice > prop.tp1;
                  const stopDist = Math.abs(fPrice - prop.stopLoss);
                  const rewardDist = Math.abs(prop.tp1 - fPrice);
                  const liveRr = stopDist > 0.01 ? Number((rewardDist / stopDist).toFixed(2)) : 0;
                  const slippageUsd = Number((isLong ? fPrice - prop.entry : prop.entry - fPrice).toFixed(2));
                  const riskUsd = Number((stopDist * (Number.isFinite(fLot) ? fLot : 0) * 100).toFixed(2));
                  liveFillMetrics = {
                    valid: geomOk,
                    error: geomOk
                      ? undefined
                      : isLong
                        ? `Fill price ($${fPrice.toFixed(2)}) is outside structural SL ($${prop.stopLoss.toFixed(2)}) and TP1 ($${prop.tp1.toFixed(2)}).`
                        : `Fill price ($${fPrice.toFixed(2)}) is outside structural TP1 ($${prop.tp1.toFixed(2)}) and SL ($${prop.stopLoss.toFixed(2)}).`,
                    fillPrice: fPrice,
                    slippageUsd,
                    liveRr,
                    rrDegraded: liveRr < prop.rrRatio - 0.05,
                    rrCritical: liveRr < 1.5,
                    riskUsd,
                  };
                }
              }

              const minsRemaining =
                prop.expiresAtTime !== undefined
                  ? Math.max(0, Math.ceil((prop.expiresAtTime - Date.now()) / 60_000))
                  : null;

              return (
                <article
                  key={prop.id}
                  data-testid={`proposal-card-${prop.id}`}
                  className={`rounded-md border p-3.5 space-y-3 transition-colors ${
                    isConfirmed
                      ? 'border-emerald-500/35 bg-emerald-500/[0.04]'
                      : terminated || isDismissed
                        ? 'border-white/6 bg-[#0B0F17]/60 opacity-75'
                        : 'border-white/10 bg-[#0B0F17] hover:border-[#D4A853]/40'
                  }`}
                >
                  {/* Top Meta Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isLong ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                          {prop.direction}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-white/6 border border-white/10 text-[10px] font-semibold text-slate-200">
                          {prop.orderType ?? 'LIMIT'}
                        </span>
                        <span className="text-slate-300">{prop.timeframe}</span>
                        {prop.convictionGrade && prop.convictionGrade !== 'STAND_DOWN' && (
                          <>
                            <span className="text-slate-500">·</span>
                            <span className="text-emerald-300 font-semibold">Grade {prop.convictionGrade}</span>
                          </>
                        )}
                        <span className="text-slate-500">·</span>
                        <span className="text-[#E5BF70]">
                          {prop.confluenceScore !== undefined
                            ? `${prop.confluenceScore}/100`
                            : `${Math.round(prop.confidence * 100)}%`}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-300">R:R 1:{prop.rrRatio.toFixed(2)}</span>
                      </div>
                      <h3 className="font-display text-sm font-semibold text-slate-100 mt-0.5 truncate">
                        {prop.setupType}
                      </h3>
                      {(prop.h4Bias || prop.rsiSummary || prop.goldenConfluence) && (
                        <div className="mt-0.5 font-mono text-[10px] text-slate-400 truncate tabular-nums">
                          {prop.h4Bias && <span>H4 {prop.h4Bias}</span>}
                          {prop.rsiSummary && (
                            <>
                              {prop.h4Bias && <span className="mx-1.5 text-slate-600">·</span>}
                              <span>{prop.rsiSummary}</span>
                            </>
                          )}
                          {prop.goldenConfluence && (
                            <>
                              <span className="mx-1.5 text-slate-600">·</span>
                              <span className="text-[#E5BF70]">Golden OB+FVG</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="text-right font-mono text-[10px] shrink-0 space-y-0.5">
                      <div
                        className={
                          prop.engineSource === 'GEMINI_AGENT' ? 'text-sky-300 font-semibold' : 'text-slate-400'
                        }
                      >
                        {prop.engineSource === 'GEMINI_AGENT' ? 'GEMINI AGENT' : 'PAYAM BRAIN'}
                      </div>
                      {!terminated && prop.status === 'PROPOSED' && prop.ttlBarsRemaining !== undefined && (
                        <div
                          data-testid={`proposal-ttl-${prop.id}`}
                          className="inline-flex items-center gap-1 text-amber-300 tabular-nums"
                        >
                          <Clock className="w-3 h-3" />
                          <span>
                            TTL {prop.ttlBarsRemaining}b{minsRemaining !== null ? ` · ${minsRemaining}m` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Terminated / Lifecycle Alert Banner */}
                  {terminated && (
                    <div
                      data-testid={`proposal-terminated-${prop.id}`}
                      className={`rounded border px-2.5 py-1.5 text-[11px] space-y-0.5 ${lifecyclePres.classes}`}
                    >
                      <div className="font-mono font-semibold">{lifecyclePres.label}</div>
                      <div className="font-fa text-right" dir="rtl">
                        {lifecyclePres.labelFa}
                      </div>
                    </div>
                  )}

                  {/* Tabular Price Geometry (Strictly Anchored Structural Levels) */}
                  <div
                    className="grid grid-cols-4 gap-2 px-2.5 py-2 rounded bg-[#111827] border border-white/6 font-mono text-[11px] tabular-nums"
                    dir="ltr"
                  >
                    <div>
                      <div className="text-slate-500 text-[10px]">ENTRY</div>
                      <div className="text-slate-100 font-medium">{prop.entry.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">SL (ANCHOR)</div>
                      <div className="text-red-400 font-medium">{prop.stopLoss.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">TP1</div>
                      <div className="text-emerald-400 font-medium">{prop.tp1.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">TP2</div>
                      <div className="text-emerald-300 font-medium">{prop.tp2.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Sniper Zone + Red-Team Risk Notes (if present) */}
                  {(prop.sniperZone || prop.redTeamRiskScore !== undefined) && (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#111827]/70 border border-white/6 font-mono text-[10px] text-slate-300 tabular-nums"
                      dir="ltr"
                    >
                      {prop.sniperZone && (
                        <span className="inline-flex items-center gap-1">
                          <Target className="w-3 h-3 text-[#D4A853]" />
                          Sniper Zone: ${prop.sniperZone.low.toFixed(2)}–${prop.sniperZone.high.toFixed(2)}
                        </span>
                      )}
                      {prop.redTeamRiskScore !== undefined && (
                        <span
                          className={`inline-flex items-center gap-1 ${
                            prop.redTeamRiskScore >= 60 ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          <ShieldAlert className="w-3 h-3" />
                          Red-Team Risk: {prop.redTeamRiskScore}/100
                        </span>
                      )}
                    </div>
                  )}

                  {prop.redTeamNotes && prop.redTeamNotes.length > 0 && (
                    <ul className="text-[11px] text-amber-200/90 space-y-0.5 pl-4 list-disc">
                      {prop.redTeamNotes.slice(0, 3).map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  )}

                  {/* Concise Bilingual Rationale */}
                  <div className="space-y-1.5 text-xs leading-relaxed">
                    <p className="font-fa text-slate-200 text-right" dir="rtl">
                      {prop.rationaleFa}
                    </p>
                    <p className="text-[11px] text-slate-400" dir="ltr">
                      {prop.rationaleEn}
                    </p>
                  </div>

                  {prop.thinkingTrace && (
                    <details className="text-[11px] text-slate-400">
                      <summary className="cursor-pointer font-mono text-[10px] text-sky-300 hover:text-sky-200">
                        System 2 Thinking Trace
                      </summary>
                      <p className="mt-1 font-mono text-[10px] whitespace-pre-wrap text-slate-300" dir="ltr">
                        {prop.thinkingTrace}
                      </p>
                    </details>
                  )}

                  {/* Rich Manual Broker Execution Confirmation Drawer */}
                  {isDrawerOpen && prop.status === 'PROPOSED' && !terminated && (
                    <div
                      data-testid={`broker-confirm-drawer-${prop.id}`}
                      className="rounded-md border border-[#D4A853]/40 bg-[#111827] p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-semibold text-[#E5BF70]">
                          Confirm Manual Broker Execution
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingId(null);
                            setDraft(null);
                            setConfirmError(null);
                          }}
                          aria-label="Close broker confirmation form"
                          className="text-slate-400 hover:text-slate-200"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Option A vs Option B Selector */}
                      <div className="grid grid-cols-2 gap-1.5 p-1 rounded bg-[#0B0F17] border border-white/8 text-[11px]">
                        <button
                          type="button"
                          data-testid={`confirm-mode-limit-${prop.id}`}
                          onClick={() => {
                            setConfirmError(null);
                            setDraft((prev) => (prev ? { ...prev, mode: 'LIMIT' } : prev));
                          }}
                          className={`px-2 py-1.5 rounded font-medium transition-colors text-center ${
                            draft.mode === 'LIMIT'
                              ? 'bg-sky-500/20 text-sky-200 border border-sky-400/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Option A: Pending LIMIT
                        </button>
                        <button
                          type="button"
                          data-testid={`confirm-mode-market-${prop.id}`}
                          onClick={() => {
                            setConfirmError(null);
                            setDraft((prev) => (prev ? { ...prev, mode: 'MARKET' } : prev));
                          }}
                          className={`px-2 py-1.5 rounded font-medium transition-colors text-center ${
                            draft.mode === 'MARKET'
                              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          Option B: Opened Live (Filled)
                        </button>
                      </div>

                      {draft.mode === 'LIMIT' ? (
                        <div className="space-y-2 text-[11px]">
                          <p className="text-slate-300">
                            Tracks your resting LIMIT order at <strong className="font-mono text-slate-100">${prop.entry.toFixed(2)}</strong>
                            {prop.sniperZone
                              ? ` (Sniper Zone $${prop.sniperZone.low.toFixed(2)}–$${prop.sniperZone.high.toFixed(2)})`
                              : ''}
                            {' '}and alerts when live spot touches entry.
                          </p>
                          <label className="block space-y-1">
                            <span className="font-mono text-[10px] text-slate-400">Broker Lot Size</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              max="50"
                              value={draft.lotSizeStr}
                              onChange={(e) =>
                                setDraft((prev) => (prev ? { ...prev, lotSizeStr: e.target.value } : prev))
                              }
                              aria-label="Pending limit broker lot size"
                              className="w-full rounded bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                              dir="ltr"
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="space-y-2.5 text-[11px]">
                          <p className="text-slate-300">
                            Enter your exact fill from MT4/MT5/cTrader. Structural SL (<span className="font-mono text-red-400">${prop.stopLoss.toFixed(2)}</span>) and TP1 (<span className="font-mono text-emerald-400">${prop.tp1.toFixed(2)}</span>) stay strictly anchored.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block space-y-1">
                              <span className="font-mono text-[10px] text-slate-400">Actual Broker Fill Price ($)</span>
                              <input
                                type="number"
                                step="0.01"
                                value={draft.fillPriceStr}
                                onChange={(e) =>
                                  setDraft((prev) => (prev ? { ...prev, fillPriceStr: e.target.value } : prev))
                                }
                                data-testid={`actual-fill-input-${prop.id}`}
                                aria-label="Actual broker fill price"
                                className="w-full rounded bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                                dir="ltr"
                              />
                            </label>
                            <label className="block space-y-1">
                              <span className="font-mono text-[10px] text-slate-400">Lot Size</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                max="50"
                                value={draft.lotSizeStr}
                                onChange={(e) =>
                                  setDraft((prev) => (prev ? { ...prev, lotSizeStr: e.target.value } : prev))
                                }
                                data-testid={`actual-lot-input-${prop.id}`}
                                aria-label="Actual broker lot size"
                                className="w-full rounded bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                                dir="ltr"
                              />
                            </label>
                          </div>

                          {/* Live Recalculated R:R & Slippage Warning */}
                          {liveFillMetrics && (
                            <div
                              data-testid={`live-rr-preview-${prop.id}`}
                              className={`rounded border px-2.5 py-2 font-mono text-[11px] space-y-1 tabular-nums ${
                                !liveFillMetrics.valid
                                  ? 'border-red-500/45 bg-red-950/30 text-red-200'
                                  : liveFillMetrics.rrCritical
                                    ? 'border-red-400/45 bg-red-950/25 text-red-200'
                                    : liveFillMetrics.rrDegraded
                                      ? 'border-amber-400/45 bg-amber-950/25 text-amber-200'
                                      : 'border-emerald-400/35 bg-emerald-950/20 text-emerald-200'
                              }`}
                              dir="ltr"
                            >
                              {!liveFillMetrics.valid ? (
                                <div className="flex items-start gap-1.5">
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                                  <span>{liveFillMetrics.error}</span>
                                </div>
                              ) : (
                                <>
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span>
                                      Live R:R: <strong>1:{liveFillMetrics.liveRr.toFixed(2)}</strong>{' '}
                                      <span className="opacity-75">(Plan 1:{prop.rrRatio.toFixed(2)})</span>
                                    </span>
                                    <span>
                                      Slippage: {liveFillMetrics.slippageUsd >= 0 ? '+' : ''}
                                      ${liveFillMetrics.slippageUsd.toFixed(2)} · Risk ${liveFillMetrics.riskUsd.toFixed(0)}
                                    </span>
                                  </div>
                                  {(liveFillMetrics.rrDegraded || liveFillMetrics.rrCritical) && (
                                    <div className="flex items-center gap-1.5 text-[10px]">
                                      <AlertTriangle className="w-3 h-3 shrink-0" />
                                      <span>
                                        {liveFillMetrics.rrCritical
                                          ? 'WARNING: Slippage compressed R:R below 1.50 against anchored structural SL/TP1!'
                                          : 'Slippage reduced effective R:R against anchored structural SL/TP1.'}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {confirmError && (
                        <div className="text-[11px] text-red-300 font-mono" role="alert">
                          {confirmError}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmingId(null);
                            setDraft(null);
                          }}
                          className="px-2.5 py-1 rounded text-xs text-slate-400 border border-white/10 hover:text-slate-200"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid={`submit-broker-confirm-${prop.id}`}
                          disabled={draft.mode === 'MARKET' && liveFillMetrics !== null && !liveFillMetrics.valid}
                          onClick={() => submitManualBrokerConfirmation(prop)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] disabled:opacity-40 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>
                            {draft.mode === 'LIMIT'
                              ? 'Track as Pending LIMIT in Broker'
                              : 'Confirm Opened Live in Broker ✓'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Footer Actions */}
                  <div className="pt-2 border-t border-white/6 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      {prop.toolsUsed.length} tools verified
                    </span>

                    {prop.status === 'PROPOSED' && !terminated ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => dismissProposal(prop.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-slate-400 border border-white/10 hover:text-slate-200 hover:bg-white/5 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                          Dismiss
                        </button>
                        <button
                          type="button"
                          data-testid={`confirm-proposal-${prop.id}`}
                          onClick={() => openConfirmDrawer(prop)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm in Broker</span>
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          isConfirmed
                            ? 'text-emerald-400'
                            : terminated
                              ? 'text-amber-300'
                              : 'text-slate-500'
                        }`}
                      >
                        {isConfirmed
                          ? lifecyclePres.label
                          : terminated
                            ? lifecyclePres.label
                            : 'DISMISSED'}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
