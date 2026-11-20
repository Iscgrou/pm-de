import { useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Power,
  Radar,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import {
  calculateExecutionFill,
  calculateRequiredMargin,
  calculateRiskBasedLotSize,
  GOLD_CONTRACT_OZ,
} from '../engine/tradeSimulator';
import type { OrderExecutionType } from '../engine/types';

interface PayamSuggestionsViewProps {
  onTradeConfirmed: () => void;
}

export function PayamSuggestionsView({ onTradeConfirmed }: PayamSuggestionsViewProps) {
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const lastAgentScanMs = useAurumStore((s) => s.lastAgentScanMs);
  const proposals = useAurumStore((s) => s.proposals);
  const tick = useAurumStore((s) => s.tick);
  const quant = useAurumStore((s) => s.quant);
  const newsGate = useAurumStore((s) => s.newsGate);
  const simAccount = useAurumStore((s) => s.simAccount);
  const toggleAgentEnabled = useAurumStore((s) => s.toggleAgentEnabled);
  const runAgentScanCycle = useAurumStore((s) => s.runAgentScanCycle);
  const confirmProposal = useAurumStore((s) => s.confirmProposal);
  const dismissProposal = useAurumStore((s) => s.dismissProposal);

  const [executionType, setExecutionType] = useState<OrderExecutionType>('MARKET');
  const [sizingMode, setSizingMode] = useState<'RISK_PCT' | 'FIXED_LOT'>('RISK_PCT');
  const [riskPct, setRiskPct] = useState<number>(1.0);
  const [fixedLot, setFixedLot] = useState<number>(0.25);
  const [autoTrailSl, setAutoTrailSl] = useState<boolean>(false);
  const [execError, setExecError] = useState<string | null>(null);

  const activeSuggestions = proposals.filter((p) => p.status === 'PROPOSED');

  const handleConfirm = (proposalId: string, lotSize: number) => {
    setExecError(null);
    const atrTrail = autoTrailSl ? Number(Math.max(2.5, quant.regime.atr).toFixed(2)) : null;
    const res = confirmProposal(proposalId, {
      lotSize,
      executionType,
      trailingStopDistance: atrTrail,
    });
    if (!res.ok) {
      setExecError(res.errors[0] ?? 'Trade rejected by risk guardrails.');
      return;
    }
    onTradeConfirmed();
  };

  if (!agentEnabled) {
    return (
      <div className="p-4 space-y-3" data-testid="payam-agent-standby">
        <div className="rounded-md border border-white/8 bg-[#0B0F17] p-4 space-y-3">
          <div className="space-y-1">
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Payam Agentic Engine Standby
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Activate the master toggle above to stream real-time XAUUSD setups verified against Order Blocks,
              Fair Value Gaps, 6-Way MTF TPI, Interbank/PAXG Basis, and the USD News Gate.
            </p>
            <p className="font-fa text-xs text-slate-300 leading-relaxed text-right" dir="rtl">
              برای دریافت پیشنهادهای زنده پوزیشن با منطق کامل نهادی و اجرای شبیه‌ساز واقعی بروکر، کلید موتور هوشمند پیام را روشن کنید.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {activeSuggestions.length} queued setup{activeSuggestions.length === 1 ? '' : 's'} ready
            </span>
            <button
              type="button"
              onClick={toggleAgentEnabled}
              data-testid="payam-activate-cta"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors whitespace-nowrap"
            >
              <Power className="w-3.5 h-3.5" />
              Activate Payam Agent
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3.5 space-y-3" data-testid="payam-suggestions-list">
      {/* Execution Order Ticket Defaults Bar */}
      <div className="rounded-md border border-white/8 bg-[#0B0F17] p-2.5 space-y-2 text-[11px] font-mono">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Execution order type">
            {(['MARKET', 'LIMIT'] as OrderExecutionType[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setExecutionType(mode)}
                className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                  executionType === mode
                    ? 'bg-[#D4A853]/20 text-[#E5BF70] font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode === 'MARKET' ? 'Market Fill' : 'Limit Order'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setAutoTrailSl((v) => !v)}
            aria-pressed={autoTrailSl}
            className={`px-2 py-1 rounded border transition-colors whitespace-nowrap ${
              autoTrailSl
                ? 'border-emerald-400/40 bg-emerald-500/12 text-emerald-300'
                : 'border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            Auto Trail SL: {autoTrailSl ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-white/6">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSizingMode('RISK_PCT')}
              className={`px-1.5 py-0.5 rounded ${
                sizingMode === 'RISK_PCT' ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Risk %
            </button>
            <button
              type="button"
              onClick={() => setSizingMode('FIXED_LOT')}
              className={`px-1.5 py-0.5 rounded ${
                sizingMode === 'FIXED_LOT' ? 'bg-white/10 text-slate-100' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Fixed Lot
            </button>
          </div>

          {sizingMode === 'RISK_PCT' ? (
            <div className="flex items-center gap-1">
              {[0.5, 1.0, 2.0].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setRiskPct(pct)}
                  className={`px-2 py-0.5 rounded border tabular-nums transition-colors ${
                    riskPct === pct
                      ? 'border-[#D4A853]/50 bg-[#D4A853]/15 text-[#E5BF70]'
                      : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {pct.toFixed(1)}%
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {[0.1, 0.25, 0.5, 1.0].map((lot) => (
                <button
                  key={lot}
                  type="button"
                  onClick={() => setFixedLot(lot)}
                  className={`px-2 py-0.5 rounded border tabular-nums transition-colors ${
                    fixedLot === lot
                      ? 'border-[#D4A853]/50 bg-[#D4A853]/15 text-[#E5BF70]'
                      : 'border-white/10 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {lot.toFixed(2)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Live Scanner Telemetry Line */}
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
        <span>
          {agentBusy
            ? 'Scanning SMC / TPI / Basis...'
            : `Last scan ${lastAgentScanMs ? new Date(lastAgentScanMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'now'}`}
        </span>
        <button
          type="button"
          disabled={agentBusy}
          onClick={() => void runAgentScanCycle()}
          className="inline-flex items-center gap-1 text-[#E5BF70] hover:text-amber-200 disabled:opacity-50 whitespace-nowrap"
        >
          <Radar className="w-3 h-3" />
          Scan Setup
        </button>
      </div>

      {execError && (
        <div role="alert" className="rounded border border-red-500/35 bg-red-950/30 px-3 py-2 text-xs text-red-200">
          {execError}
        </div>
      )}

      {/* Payam Brain Anti-Emotion Stand-Down Banner */}
      {quant.brain.decision === 'STAND_DOWN' && (
        <div
          data-testid="suggestions-stand-down-alert"
          className="rounded-md border border-amber-400/25 bg-amber-950/20 px-3 py-2 space-y-1 text-[11px]"
        >
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-amber-300 font-semibold">
            <span>STAND DOWN ({quant.brain.totalScore}/100)</span>
            <span>{quant.brain.hardVetoes[0] ?? 'LOW EDGE'}</span>
          </div>
          <p className="font-fa text-slate-200 text-right leading-snug" dir="rtl">
            {quant.brain.summaryFa}
          </p>
        </div>
      )}

      {/* Real-Time Suggestions Stream */}
      {activeSuggestions.length === 0 ? (
        <div className="py-6 px-3 text-center space-y-2.5 border border-dashed border-white/10 rounded-md bg-[#0B0F17]/70">
          <p className="text-xs text-slate-300">All current Payam suggestions have been reviewed.</p>
          <button
            type="button"
            disabled={agentBusy}
            onClick={() => void runAgentScanCycle()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-[#D4A853]/40 text-[#E5BF70] hover:bg-[#D4A853]/10 transition-colors"
          >
            <Radar className="w-3.5 h-3.5" />
            Generate Fresh Suggestion
          </button>
        </div>
      ) : (
        <div className="space-y-3 max-h-[540px] overflow-y-auto pr-0.5">
          {activeSuggestions.slice(0, 6).map((prop) => {
            const isLong = prop.direction === 'LONG';
            const computedLot =
              sizingMode === 'RISK_PCT'
                ? calculateRiskBasedLotSize(simAccount.equity, riskPct, prop.entry, prop.stopLoss)
                : fixedLot;
            const effectiveLot = Number(Math.max(0.01, computedLot * newsGate.lotMultiplier).toFixed(2));
            const fillEst = calculateExecutionFill(
              prop.direction,
              tick,
              executionType,
              prop.entry,
              effectiveLot,
              quant.regime.atr
            );
            const marginEst = calculateRequiredMargin(fillEst.fillPrice, effectiveLot, simAccount.leverage);
            const riskUsdEst = Number((Math.abs(prop.entry - prop.stopLoss) * effectiveLot * GOLD_CONTRACT_OZ).toFixed(2));
            const rewardTp1Est = Number((Math.abs(prop.tp1 - prop.entry) * effectiveLot * GOLD_CONTRACT_OZ).toFixed(2));
            const openCommEst = Number(((simAccount.commissionPerLotRoundTurn / 2) * effectiveLot).toFixed(2));

            return (
              <article
                key={prop.id}
                data-testid={`payam-suggestion-${prop.id}`}
                className="rounded-md border border-white/10 bg-[#0B0F17] p-3 space-y-2.5 hover:border-[#D4A853]/40 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] tabular-nums">
                      <span
                        className={`inline-flex items-center gap-0.5 font-semibold ${
                          isLong ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {prop.direction}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">{prop.timeframe}</span>
                      {prop.convictionGrade && prop.convictionGrade !== 'STAND_DOWN' && (
                        <>
                          <span className="text-slate-600">·</span>
                          <span className="text-emerald-300 font-semibold">{prop.convictionGrade}</span>
                        </>
                      )}
                      <span className="text-slate-600">·</span>
                      <span className="text-[#E5BF70]">
                        {prop.confluenceScore !== undefined ? `${prop.confluenceScore}/100` : `${Math.round(prop.confidence * 100)}%`}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-300">1:{prop.rrRatio.toFixed(2)}</span>
                    </div>
                    <h3 className="font-display text-xs font-semibold text-slate-100 mt-0.5">
                      {prop.setupType}
                    </h3>
                    {(prop.h4Bias || prop.rsiSummary) && (
                      <div className="font-mono text-[10px] text-slate-400 truncate tabular-nums mt-0.5">
                        {prop.h4Bias && <span>H4 {prop.h4Bias}</span>}
                        {prop.rsiSummary && (
                          <>
                            {prop.h4Bias && <span className="mx-1 text-slate-600">·</span>}
                            <span>{prop.rsiSummary}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-slate-400 shrink-0">
                    {prop.engineSource === 'GEMINI_AGENT' ? 'Gemini' : 'Brain v3'}
                  </span>
                </div>

                {/* Price Geometry */}
                <div className="grid grid-cols-4 gap-1.5 px-2 py-1.5 rounded bg-[#111827] border border-white/6 font-mono text-[11px] tabular-nums">
                  <div>
                    <div className="text-[9px] text-slate-500">{executionType === 'MARKET' ? 'EST FILL' : 'LIMIT'}</div>
                    <div className="text-slate-100 font-medium">{fillEst.fillPrice.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">SL</div>
                    <div className="text-red-400 font-medium">{prop.stopLoss.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">TP1</div>
                    <div className="text-emerald-400 font-medium">{prop.tp1.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">TP2</div>
                    <div className="text-emerald-300 font-medium">{prop.tp2.toFixed(2)}</div>
                  </div>
                </div>

                {/* Pre-Trade Broker Execution Spec */}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-mono tabular-nums text-slate-400">
                  <span>
                    Lot <strong className="text-slate-200">{effectiveLot.toFixed(2)}</strong>
                  </span>
                  <span>
                    Risk <strong className="text-red-300">-${riskUsdEst.toFixed(0)}</strong>
                  </span>
                  <span>
                    TP1 <strong className="text-emerald-300">+${rewardTp1Est.toFixed(0)}</strong>
                  </span>
                  <span>
                    Margin <strong className="text-slate-200">${marginEst.toFixed(0)}</strong>
                  </span>
                  <span>
                    Comm <strong className="text-slate-300">${openCommEst.toFixed(2)}</strong>
                  </span>
                </div>

                {/* Full Bilingual Rationale */}
                <div className="space-y-1.5 text-xs leading-relaxed">
                  <p className="text-[11px] text-slate-300">{prop.rationaleEn}</p>
                  <p className="font-fa text-[11px] text-slate-200 text-right bg-[#111827]/70 rounded px-2 py-1.5 border border-white/5" dir="rtl">
                    {prop.rationaleFa}
                  </p>
                </div>

                {/* Footer Actions: Confirm Trade + Dismiss */}
                <div className="pt-2 border-t border-white/6 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    {prop.toolsUsed.length} tools
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => dismissProposal(prop.id)}
                      aria-label={`Dismiss ${prop.setupType}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-400 border border-white/10 hover:text-slate-200 hover:bg-white/5 transition-colors"
                    >
                      <X className="w-3 h-3" />
                      Dismiss
                    </button>
                    <button
                      type="button"
                      data-testid={`payam-confirm-trade-${prop.id}`}
                      onClick={() => handleConfirm(prop.id, effectiveLot)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors whitespace-nowrap"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Confirm Trade
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
