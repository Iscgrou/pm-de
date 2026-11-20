import { useState } from 'react';
import { BrainCircuit, CheckCircle2, Power, RefreshCw } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { computeAccountMetrics } from '../engine/tradeSimulator';
import { PayamAccountBar } from './PayamAccountBar';
import { PayamSuggestionsView } from './PayamSuggestionsView';
import { PayamLiveMonitorView } from './PayamLiveMonitorView';
import type { Timeframe } from '../engine/types';

const TFS_ORDER: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];

type PayamPanelTab = 'suggestions' | 'monitor' | 'ledger';

export function AdvisoryPanel() {
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const toggleAgentEnabled = useAurumStore((s) => s.toggleAgentEnabled);
  const proposals = useAurumStore((s) => s.proposals);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const closedTrades = useAurumStore((s) => s.closedTrades);
  const simAccount = useAurumStore((s) => s.simAccount);
  const advisory = useAurumStore((s) => s.advisory);
  const quant = useAurumStore((s) => s.quant);
  const runSystem2Reasoning = useAurumStore((s) => s.runSystem2Reasoning);

  const [panelTab, setPanelTab] = useState<PayamPanelTab>('suggestions');

  const openSuggestionsCount = proposals.filter((p) => p.status === 'PROPOSED').length;
  const metrics = computeAccountMetrics(simAccount, closedTrades);

  const verdictTone =
    advisory.verdict === 'VETO' || advisory.verdict === 'EXIT'
      ? 'text-red-400'
      : advisory.verdict === 'PROTECT'
        ? 'text-amber-400'
        : advisory.verdict === 'SCALE'
          ? 'text-emerald-400'
          : 'text-[#E5BF70]';

  const handleToggleMaster = () => {
    const turningOn = !agentEnabled;
    toggleAgentEnabled();
    if (turningOn) {
      setPanelTab('suggestions');
    }
  };

  return (
    <section
      aria-label="Payam Agentic Engine and Trade Simulator"
      data-testid="advisory-panel"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden flex flex-col"
    >
      {/* Master Header with Payam Agentic Engine Toggle */}
      <div className="px-3.5 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BrainCircuit className="w-4 h-4 text-[#D4A853] shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
              Payam Agentic Engine
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              Real-time suggestions · Simulated broker execution
            </p>
          </div>
        </div>

        {/* Master Toggle Switch inside AdvisoryPanel */}
        <button
          type="button"
          role="switch"
          aria-checked={agentEnabled}
          aria-label="Activate Payam Agentic Engine"
          data-testid="advisory-payam-toggle"
          onClick={handleToggleMaster}
          className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            agentEnabled
              ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
              : 'bg-[#0B0F17] border-[#D4A853]/40 text-slate-200 hover:border-[#D4A853]'
          }`}
        >
          <Power className={`w-3.5 h-3.5 ${agentEnabled ? 'text-emerald-400' : 'text-[#D4A853]'}`} />
          <span className="font-mono text-[11px]">{agentEnabled ? 'AGENT ON' : 'AGENT OFF'}</span>
        </button>
      </div>

      {/* Real-Broker Virtual Account Telemetry Strip */}
      <PayamAccountBar />

      {/* Specialized 3-Tab Interface */}
      <div
        role="tablist"
        aria-label="Payam Agentic Engine views"
        className="px-3.5 pt-2.5 pb-2 border-b border-white/8 bg-[#0E1420] flex items-center gap-1 font-mono text-[11px]"
      >
        {(
          [
            ['suggestions', `Suggestions (${openSuggestionsCount})`],
            ['monitor', `Monitor (${confirmedPositions.length})`],
            ['ledger', `Journal (${closedTrades.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={panelTab === key}
            data-testid={`payam-tab-${key}`}
            onClick={() => setPanelTab(key)}
            className={`flex-1 py-1.5 px-2 rounded text-center transition-colors whitespace-nowrap ${
              panelTab === key
                ? 'bg-[#D4A853] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab 1: Real-Time Position Suggestions + Rationale + Confirm Trade */}
      {panelTab === 'suggestions' && (
        <PayamSuggestionsView onTradeConfirmed={() => setPanelTab('monitor')} />
      )}

      {/* Tab 2: Ongoing Simulated Trade Monitoring */}
      {panelTab === 'monitor' && <PayamLiveMonitorView />}

      {/* Tab 3: Closed Trade Journal + System 2 Fact Ledger & 6-Way MTF TPI */}
      {panelTab === 'ledger' && (
        <div className="p-3.5 space-y-4 max-h-[580px] overflow-y-auto" data-testid="payam-journal-quant">
          {/* Performance Summary Strip */}
          <div className="grid grid-cols-4 gap-2 p-2.5 rounded-md bg-[#0B0F17] border border-white/8 font-mono text-[11px] tabular-nums">
            <div>
              <div className="text-[10px] text-slate-500">Win Rate</div>
              <div className="text-slate-100 font-semibold">{metrics.winRatePct.toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Profit Fct</div>
              <div className="text-[#E5BF70] font-semibold">
                {metrics.profitFactor !== null ? metrics.profitFactor.toFixed(2) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Avg R</div>
              <div className={metrics.avgRMultiple >= 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                {metrics.avgRMultiple >= 0 ? '+' : ''}
                {metrics.avgRMultiple.toFixed(2)}R
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500">Max DD</div>
              <div className="text-slate-200 font-semibold">{simAccount.maxDrawdownPct.toFixed(2)}%</div>
            </div>
          </div>

          {/* Closed Trade Ledger */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-200">Simulated Execution Journal</span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                Comm Paid ${simAccount.totalCommissionPaid.toFixed(2)}
              </span>
            </div>

            {closedTrades.length === 0 ? (
              <div className="py-4 px-3 text-center rounded border border-dashed border-white/10 bg-[#0B0F17]/60 text-[11px] text-slate-400">
                No completed executions yet. Partial TP1 scale-outs, SL hits, and closed positions log here with full slippage & commission accounting.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {closedTrades.slice(0, 12).map((trd) => (
                  <div
                    key={trd.id}
                    data-testid={`closed-trade-${trd.id}`}
                    className="rounded bg-[#0B0F17] border border-white/6 px-2.5 py-2 font-mono text-[10px] tabular-nums space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-200 font-medium truncate">
                        <span className={trd.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}>
                          {trd.direction}
                        </span>{' '}
                        {trd.lotSize.toFixed(2)} lot · {trd.exitReason.replace(/_/g, ' ')}
                      </span>
                      <span className={`font-semibold shrink-0 ${trd.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {trd.netPnl >= 0 ? '+' : ''}${trd.netPnl.toFixed(2)} ({trd.rMultiple >= 0 ? '+' : ''}
                        {trd.rMultiple.toFixed(2)}R)
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500">
                      <span>
                        {trd.entryPrice.toFixed(2)} → {trd.exitPrice.toFixed(2)}
                      </span>
                      <span>
                        MFE +${trd.mfeUsd.toFixed(0)} · MAE ${trd.maeUsd.toFixed(0)} · Comm ${trd.commission.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* System 2 Fact Ledger & Anti-Hallucination Grounding */}
          <div className="pt-3 border-t border-white/8 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className={`font-display text-base font-bold tracking-tight ${verdictTone}`} data-testid="advisory-verdict">
                  {advisory.verdict}
                </span>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {Math.round(advisory.confidence * 100)}% · {advisory.jobId}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {advisory.hallucinationChecked ? 'Grounded' : 'Check Failed'}
                </span>
                <button
                  type="button"
                  onClick={() => runSystem2Reasoning('MANUAL_DISPATCH')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-200 border border-white/10 hover:bg-white/6 transition-colors whitespace-nowrap"
                >
                  <RefreshCw className="w-3 h-3" />
                  Dispatch
                </button>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-300">{advisory.rationaleEn}</p>
            <p
              dir="rtl"
              className="font-fa text-[11px] leading-relaxed text-slate-200 bg-[#0B0F17] border border-white/6 rounded p-2"
            >
              {advisory.rationaleFa}
            </p>
          </div>

          {/* 6-Way Multi-Timeframe TPI Matrix */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">6-Way MTF TPI Matrix</span>
              <span className="font-mono tabular-nums text-slate-400">
                Composite {quant.tpi.compositeScore >= 0 ? '+' : ''}
                {quant.tpi.compositeScore.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 text-center font-mono text-[11px] tabular-nums">
              {TFS_ORDER.map((tf) => {
                const val = quant.tpi.perTimeframe[tf] ?? 0;
                const color = val > 0.15 ? 'text-emerald-400' : val < -0.15 ? 'text-red-400' : 'text-slate-400';
                return (
                  <div key={tf} className="bg-[#0B0F17] border border-white/6 rounded py-1.5 px-1">
                    <div className="text-[10px] text-slate-500">{tf}</div>
                    <div className={`font-semibold ${color}`}>
                      {val >= 0 ? '+' : ''}
                      {val.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Wilder RSI(14), Dealing Range & Payam Brain Quant Readout */}
          <div className="pt-2.5 border-t border-white/8 space-y-1.5 text-[11px] font-mono tabular-nums">
            <div className="flex items-center justify-between text-slate-300">
              <span>
                Brain <strong className="text-[#E5BF70]">{quant.brain.totalScore}/100 ({quant.brain.convictionGrade})</strong>
              </span>
              <span>
                RSI(14) <strong className="text-slate-100">{quant.rsi.active.value.toFixed(1)}</strong>
              </span>
              <span>
                P/D <strong className="text-slate-200">{quant.dealingRange.positionPct.toFixed(0)}%</strong>
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>TFS Tether {quant.tfs.tetherPrice.toFixed(2)}</span>
              <span>VO {quant.tfs.velocityOscillator.toFixed(2)}</span>
              <span>MBO {quant.tfs.mboScore.toFixed(2)}</span>
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              Whitelist ({advisory.factLedger.allowedNumbers.length} levels):{' '}
              {advisory.factLedger.allowedNumbers.slice(0, 6).map((n) => n.toFixed(2)).join(' · ')}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
