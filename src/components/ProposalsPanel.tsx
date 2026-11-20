import { useState } from 'react';
import { Check, X, Sparkles, ArrowUpRight, ArrowDownRight, ShieldCheck } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type { ProposalStatus } from '../engine/types';

export function ProposalsPanel() {
  const proposals = useAurumStore((s) => s.proposals);
  const quant = useAurumStore((s) => s.quant);
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const confirmProposal = useAurumStore((s) => s.confirmProposal);
  const dismissProposal = useAurumStore((s) => s.dismissProposal);
  const runAgentScanCycle = useAurumStore((s) => s.runAgentScanCycle);
  const brain = quant.brain;

  const [filter, setFilter] = useState<'ALL' | ProposalStatus>('PROPOSED');
  const [lotSize, setLotSize] = useState<number>(0.2);

  const activeCount = proposals.filter((p) => p.status === 'PROPOSED').length;
  const confirmedCount = proposals.filter((p) => p.status === 'CONFIRMED').length;

  const filtered = proposals.filter((p) => (filter === 'ALL' ? true : p.status === filter));

  return (
    <section
      aria-label="Agentic Position Proposals"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden flex flex-col"
      data-testid="proposals-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-[#D4A853] shrink-0" />
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>Agentic Signal Proposals</span>
              <span className="font-fa text-xs font-normal text-[#E5BF70]" dir="rtl">
                پیشنهادهای پوزیشن مدل
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Review tool-verified setups and confirm the ones you execute in your broker for live monitoring.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Default Lot Size Picker for Confirmations */}
          <label className="flex items-center gap-1.5 font-mono text-slate-400">
            <span>Broker Lot:</span>
            <select
              value={lotSize}
              onChange={(e) => setLotSize(Number(e.target.value))}
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

      {/* Disciplined Stand-Down Banner when 7-Gate Shield blocks new entries */}
      {brain.decision === 'STAND_DOWN' && (
        <div
          data-testid="proposals-stand-down-banner"
          className="px-4 py-2.5 border-b border-amber-400/20 bg-amber-950/20 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div className="space-y-0.5 min-w-0">
            <div className="font-mono text-[11px] font-semibold text-amber-300">
              PAYAM BRAIN STAND DOWN ({brain.totalScore}/100) · {brain.hardVetoes.length > 0 ? brain.hardVetoes.join(', ') : 'Score below 62 threshold'}
            </div>
            <p className="font-fa text-[11px] text-slate-200" dir="rtl">
              {brain.summaryFa}
            </p>
          </div>
          {brain.watchlistZone && (
            <span className="font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap">
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
              {filter === 'PROPOSED'
                ? 'No unreviewed proposals in queue.'
                : 'No proposals match this filter yet.'}
            </p>
            <button
              type="button"
              disabled={agentBusy}
              onClick={() => void runAgentScanCycle({ quantOnly: !agentEnabled })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#D4A853]/35 text-[#E5BF70] hover:bg-[#D4A853]/10 transition-colors"
            >
              Generate Fresh Tool-Verified Proposal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto pr-1">
            {filtered.map((prop) => {
              const isLong = prop.direction === 'LONG';
              const isConfirmed = prop.status === 'CONFIRMED';
              const isDismissed = prop.status === 'DISMISSED';

              return (
                <article
                  key={prop.id}
                  data-testid={`proposal-card-${prop.id}`}
                  className={`rounded-md border p-3.5 space-y-3 transition-colors ${
                    isConfirmed
                      ? 'border-emerald-500/35 bg-emerald-500/[0.04]'
                      : isDismissed
                        ? 'border-white/6 bg-[#0B0F17]/60 opacity-65'
                        : 'border-white/10 bg-[#0B0F17] hover:border-[#D4A853]/40'
                  }`}
                >
                  {/* Top Meta Row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs tabular-nums">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            isLong ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                          {prop.direction}
                        </span>
                        <span className="text-slate-500">·</span>
                        <span className="text-slate-300">{prop.timeframe}</span>
                        {prop.convictionGrade && prop.convictionGrade !== 'STAND_DOWN' && (
                          <>
                            <span className="text-slate-500">·</span>
                            <span className="text-emerald-300 font-semibold">Grade {prop.convictionGrade}</span>
                          </>
                        )}
                        <span className="text-slate-500">·</span>
                        <span className="text-[#E5BF70]">
                          {prop.confluenceScore !== undefined ? `${prop.confluenceScore}/100` : `${Math.round(prop.confidence * 100)}%`}
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

                    <div className="text-right font-mono text-[10px] shrink-0">
                      <div
                        className={
                          prop.engineSource === 'GEMINI_AGENT' ? 'text-sky-300 font-semibold' : 'text-slate-400'
                        }
                      >
                        {prop.engineSource === 'GEMINI_AGENT' ? 'GEMINI AGENT' : 'PAYAM BRAIN'}
                      </div>
                      <div className="text-slate-500 tabular-nums">
                        {new Date(prop.createdAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  {/* Tabular Price Geometry */}
                  <div className="grid grid-cols-4 gap-2 px-2.5 py-2 rounded bg-[#111827] border border-white/6 font-mono text-[11px] tabular-nums">
                    <div>
                      <div className="text-slate-500 text-[10px]">ENTRY</div>
                      <div className="text-slate-100 font-medium">{prop.entry.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">SL</div>
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

                  {/* Concise Bilingual Rationale */}
                  <div className="space-y-1.5 text-xs leading-relaxed">
                    <p className="font-fa text-slate-200 text-right" dir="rtl">
                      {prop.rationaleFa}
                    </p>
                    <p className="text-[11px] text-slate-400">{prop.rationaleEn}</p>
                  </div>

                  {/* Footer Actions */}
                  <div className="pt-2 border-t border-white/6 flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      {prop.toolsUsed.length} tools verified
                    </span>

                    {prop.status === 'PROPOSED' ? (
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
                          onClick={() => confirmProposal(prop.id, { lotSize, executionType: 'MARKET' })}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/40 hover:bg-emerald-500/30 transition-colors whitespace-nowrap"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Confirm Trade</span>
                        </button>
                      </div>
                    ) : (
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          isConfirmed ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {isConfirmed ? 'CONFIRMED · LIVE MONITORED' : 'DISMISSED'}
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
