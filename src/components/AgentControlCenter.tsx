import {
  AlertOctagon,
  CheckCircle2,
  ClipboardList,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';

function formatClock(tsMs: number): string {
  const d = new Date(tsMs);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AgentControlCenter() {
  const open = useAurumStore((s) => s.controlCenterOpen);
  const setOpen = useAurumStore((s) => s.setControlCenterOpen);
  const config = useAurumStore((s) => s.agentConfig);
  const breakers = useAurumStore((s) => s.circuitBreakers);
  const auditLog = useAurumStore((s) => s.agentAuditLog);
  const toggleKillSwitch = useAurumStore((s) => s.toggleKillSwitch);
  const updateAgentConfig = useAurumStore((s) => s.updateAgentConfig);
  const resetAgentConfig = useAurumStore((s) => s.resetAgentConfig);
  const resetLossCooldown = useAurumStore((s) => s.resetLossCooldown);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Payam Agent Governance, Risk Circuit Breakers and Settings"
      data-testid="agent-control-center"
    >
      <div
        dir="ltr"
        className="w-full max-w-2xl bg-[#0B0F17] border-l border-white/10 h-full overflow-y-auto flex flex-col"
      >
        {/* Top Bar */}
        <div className="sticky top-0 z-10 px-5 py-3.5 bg-[#101624] border-b border-white/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="w-4 h-4 text-[#D4A853]" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Payam Agent Governance &amp; Risk Circuit Breakers
              </h2>
              <p className="text-[11px] font-fa text-slate-400" dir="rtl">
                تنظیمات اتمیک مغز معامله‌گر، فیوزهای حفاظت سرمایه و گزارش ممیزی تصمیمات
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close governance center"
            data-testid="close-control-center-btn"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-white/8"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {/* 1. Emergency Out-of-Band Kill Switch */}
          <div
            className={`rounded-lg border p-4 flex flex-wrap items-center justify-between gap-4 ${
              config.killSwitchEngaged
                ? 'border-red-500/50 bg-red-500/10'
                : 'border-white/10 bg-[#111827]'
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertOctagon
                  className={`w-4 h-4 ${config.killSwitchEngaged ? 'text-red-400' : 'text-slate-400'}`}
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-100">
                  Emergency Out-of-Band Kill Switch
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-md">
                {config.killSwitchEngaged
                  ? 'ENGAGED: Autonomous scanning halted, pending limit orders cancelled, and all new entries hard-locked.'
                  : 'Instantly halts Payam autonomous scanning, cancels pending limit orders, and blocks all new trade entries.'}
              </p>
            </div>

            <button
              type="button"
              onClick={toggleKillSwitch}
              data-testid="modal-kill-switch-btn"
              className={`px-3.5 py-2 rounded-md text-xs font-mono font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                config.killSwitchEngaged
                  ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200 hover:bg-emerald-500/25'
                  : 'bg-red-500/15 border-red-400/50 text-red-200 hover:bg-red-500/25'
              }`}
            >
              {config.killSwitchEngaged ? 'DISARM KILL SWITCH' : 'ENGAGE KILL SWITCH'}
            </button>
          </div>

          {/* 2. 7-Breaker Live Portfolio Risk Matrix */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {breakers.canOpenNewTrades ? (
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                )}
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  7 Deterministic Risk Circuit Breakers
                </h3>
              </div>
              <span
                className={`font-mono text-xs font-semibold ${
                  breakers.canOpenNewTrades
                    ? breakers.effectiveRiskMultiplier < 1
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                    : 'text-red-400'
                }`}
                data-testid="circuit-breaker-verdict"
              >
                {breakers.canOpenNewTrades
                  ? `AUTHORIZED · ${(breakers.effectiveRiskMultiplier * 100).toFixed(0)}% RISK`
                  : 'HARD HALT ACTIVE'}
              </span>
            </div>

            <p className="text-xs font-fa text-slate-400" dir="rtl">
              {breakers.summaryFa}
            </p>

            <div className="rounded-lg border border-white/8 bg-[#111827] divide-y divide-white/6">
              {breakers.breakers.map((b) => {
                const tone =
                  b.status === 'TRIPPED'
                    ? 'text-red-400'
                    : b.status === 'WARNING'
                      ? 'text-amber-300'
                      : 'text-emerald-400';
                return (
                  <div key={b.id} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        {b.status === 'OK' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${tone}`} />
                        )}
                        <span className="font-medium text-slate-100">{b.label}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 pl-5">{b.detail}</p>
                    </div>
                    <div className="text-right font-mono tabular-nums text-[11px] shrink-0">
                      <div className={`font-semibold ${tone}`}>{b.currentValue}</div>
                      <div className="text-slate-500">Limit {b.limitValue}</div>
                      {b.id === 'CONSECUTIVE_LOSS_COOLDOWN' && breakers.cooldownRemainingMin > 0 && (
                        <button
                          type="button"
                          onClick={resetLossCooldown}
                          className="mt-1 text-[10px] text-[#E5BF70] hover:underline"
                        >
                          Reset Timer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Atomic Agent Constitution & Risk Parameters */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                Atomic Strategy &amp; Risk Thresholds
              </h3>
              <button
                type="button"
                onClick={resetAgentConfig}
                data-testid="reset-agent-config-btn"
                className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-[#E5BF70]"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Defaults</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-white/8 bg-[#111827] p-4">
              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Min Brain Confluence Score</span>
                  <strong className="font-mono text-[#E5BF70]">{config.minConfluenceScore}/100</strong>
                </span>
                <input
                  type="range"
                  min={55}
                  max={85}
                  step={1}
                  value={config.minConfluenceScore}
                  data-testid="cfg-min-score"
                  onChange={(e) => updateAgentConfig({ minConfluenceScore: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Min Institutional R:R Floor</span>
                  <strong className="font-mono text-[#E5BF70]">1:{config.minRrRatio.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={1.5}
                  max={3.0}
                  step={0.05}
                  value={config.minRrRatio}
                  data-testid="cfg-min-rr"
                  onChange={(e) => updateAgentConfig({ minRrRatio: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Max Daily Drawdown Hard Cap</span>
                  <strong className="font-mono text-red-300">{config.maxDailyDrawdownPct.toFixed(1)}%</strong>
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={10.0}
                  step={0.5}
                  value={config.maxDailyDrawdownPct}
                  data-testid="cfg-max-dd"
                  onChange={(e) => updateAgentConfig({ maxDailyDrawdownPct: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Max Open Portfolio Risk Heat</span>
                  <strong className="font-mono text-amber-300">{config.maxPortfolioHeatPct.toFixed(1)}%</strong>
                </span>
                <input
                  type="range"
                  min={1.0}
                  max={6.0}
                  step={0.25}
                  value={config.maxPortfolioHeatPct}
                  data-testid="cfg-max-heat"
                  onChange={(e) => updateAgentConfig({ maxPortfolioHeatPct: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Consecutive Loss Cooldown Limit</span>
                  <strong className="font-mono text-slate-100">
                    {config.maxConsecutiveLosses} losses ({config.cooldownMinutesAfterLossStreak}m)
                  </strong>
                </span>
                <input
                  type="range"
                  min={2}
                  max={6}
                  step={1}
                  value={config.maxConsecutiveLosses}
                  onChange={(e) => updateAgentConfig({ maxConsecutiveLosses: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Max Concurrent Open Positions</span>
                  <strong className="font-mono text-slate-100">{config.maxConcurrentPositions}</strong>
                </span>
                <input
                  type="range"
                  min={1}
                  max={6}
                  step={1}
                  value={config.maxConcurrentPositions}
                  onChange={(e) => updateAgentConfig({ maxConcurrentPositions: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Max Allowed XAU/USD Spread</span>
                  <strong className="font-mono text-slate-100">${config.maxAllowedSpreadUsd.toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min={0.4}
                  max={3.0}
                  step={0.1}
                  value={config.maxAllowedSpreadUsd}
                  onChange={(e) => updateAgentConfig({ maxAllowedSpreadUsd: Number(e.target.value) })}
                  className="w-full accent-[#D4A853]"
                />
              </label>

              <label className="space-y-1 text-xs">
                <span className="flex items-center justify-between text-slate-300">
                  <span>Red-Folder News Blackout</span>
                  <strong className="font-mono text-slate-100">
                    -{config.newsHighImpactPreMin}m / +{config.newsHighImpactPostMin}m
                  </strong>
                </span>
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={5}
                  value={config.newsHighImpactPreMin}
                  onChange={(e) =>
                    updateAgentConfig({
                      newsHighImpactPreMin: Number(e.target.value),
                      newsHighImpactPostMin: Math.min(60, Number(e.target.value) * 2),
                    })
                  }
                  className="w-full accent-[#D4A853]"
                />
              </label>

              {/* Boolean Discipline Toggles */}
              <div className="sm:col-span-2 pt-2 border-t border-white/8 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <label className="flex items-center justify-between gap-2 p-2 rounded bg-[#0B0F17] border border-white/8 cursor-pointer">
                  <span className="text-slate-300">Counter-4H Scalps</span>
                  <input
                    type="checkbox"
                    checked={config.allowCounterH4Scalps}
                    data-testid="cfg-counter-h4"
                    onChange={(e) => updateAgentConfig({ allowCounterH4Scalps: e.target.checked })}
                    className="accent-[#D4A853]"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 p-2 rounded bg-[#0B0F17] border border-white/8 cursor-pointer">
                  <span className="text-slate-300">Asian Session Entries</span>
                  <input
                    type="checkbox"
                    checked={config.allowAsianSessionEntries}
                    data-testid="cfg-asian-session"
                    onChange={(e) => updateAgentConfig({ allowAsianSessionEntries: e.target.checked })}
                    className="accent-[#D4A853]"
                  />
                </label>

                <label className="flex items-center justify-between gap-2 p-2 rounded bg-[#0B0F17] border border-white/8 cursor-pointer">
                  <span className="text-slate-300">Live 14-Source Feeds</span>
                  <input
                    type="checkbox"
                    checked={config.enableLiveNewsFeeds}
                    onChange={(e) => updateAgentConfig({ enableLiveNewsFeeds: e.target.checked })}
                    className="accent-[#D4A853]"
                  />
                </label>
              </div>
            </div>
          </section>

          {/* 4. Immutable Agent Decision & Tool Audit Trail */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[#D4A853]" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  Immutable Agent Audit Log ({auditLog.length})
                </h3>
              </div>
              <span className="font-mono text-[11px] text-slate-500">Latest 40 events</span>
            </div>

            <div
              className="rounded-lg border border-white/8 bg-[#111827] max-h-60 overflow-y-auto divide-y divide-white/6"
              data-testid="agent-audit-log"
            >
              {auditLog.map((entry) => {
                const sevColor =
                  entry.severity === 'CRITICAL'
                    ? 'text-red-400'
                    : entry.severity === 'WARN'
                      ? 'text-amber-300'
                      : 'text-emerald-400';
                return (
                  <div key={entry.id} className="px-3.5 py-2 text-xs space-y-0.5">
                    <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                      <span className={`font-semibold ${sevColor}`}>
                        [{entry.category}] {entry.title}
                      </span>
                      <span className="text-slate-500 tabular-nums shrink-0">{formatClock(entry.timestampMs)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{entry.detail}</p>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
