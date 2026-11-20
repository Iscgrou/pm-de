import { CheckCircle2, XCircle, Play, ShieldAlert, Zap, RefreshCw } from 'lucide-react';
import { useAurumStore } from '../store/useStore';

export function Audit18GatesView() {
  const auditResults = useAurumStore((s) => s.auditResults);
  const pipeline = useAurumStore((s) => s.pipeline);
  const run18GateVerification = useAurumStore((s) => s.run18GateVerification);
  const triggerTripwireTest = useAurumStore((s) => s.triggerTripwireTest);
  const triggerToxicSpikeTest = useAurumStore((s) => s.triggerToxicSpikeTest);
  const restoreTier1 = useAurumStore((s) => s.restoreTier1);

  const passedCount = auditResults.filter((g) => g.passed).length;
  const totalLatency = auditResults.reduce((s, g) => s + g.latencyMs, 0);

  return (
    <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-6 space-y-6">
      {/* Header & Summary */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-white/8">
        <div>
          <h1 className="font-display text-2xl font-semibold text-slate-100">
            18-Gate Institutional Verification Harness
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Mirrors <span className="font-mono text-slate-300">self_verify_10gates.py</span> across all 8 subsystems, strict guardrails, HSM lifecycle, CrashRecovery & loop-lag benchmarks.
          </p>
        </div>
        <button
          type="button"
          onClick={run18GateVerification}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          Run 18-Gate Audit
        </button>
      </div>

      {/* Live Pipeline Adversarial Stress Controls */}
      <section
        aria-label="Live pipeline failover and cleansing tests"
        className="rounded-lg border border-white/8 bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Live Data Pipeline Defense Stress Tests
          </h2>
          <p className="text-xs font-mono text-slate-400 tabular-nums">
            Active Tier {pipeline.activeTier} ({pipeline.sourceName}) · Tripwires blocked {pipeline.tripwireCount} · Toxic spikes dropped {pipeline.rejectedSpikes} · Last note: {pipeline.lastEventNote}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => triggerTripwireTest('BINANCE:BTCUSDT')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 transition-colors whitespace-nowrap"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Inject BTCUSDT (Tripwire)
          </button>
          <button
            type="button"
            onClick={triggerToxicSpikeTest}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors whitespace-nowrap"
          >
            <Zap className="w-3.5 h-3.5" />
            Inject +4.1% Toxic Spike
          </button>
          <button
            type="button"
            onClick={restoreTier1}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-white/10 text-slate-200 hover:bg-white/6 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Restore Tier 1 CDP
          </button>
        </div>
      </section>

      {/* Summary Metrics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 font-mono tabular-nums">
        <div className="rounded-lg border border-white/8 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Gates Passed</div>
          <div className="text-2xl font-semibold text-emerald-400 mt-1" data-testid="gates-passed-count">
            {passedCount} / {auditResults.length}
          </div>
        </div>
        <div className="rounded-lg border border-white/8 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Event Loop P99 Lag</div>
          <div className="text-2xl font-semibold text-slate-100 mt-1">
            {pipeline.loopLagP99Ms.toFixed(2)}ms
          </div>
        </div>
        <div className="rounded-lg border border-white/8 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">Total Audit Runtime</div>
          <div className="text-2xl font-semibold text-slate-100 mt-1">
            {totalLatency.toFixed(2)}ms
          </div>
        </div>
        <div className="rounded-lg border border-white/8 bg-[#111827] p-4">
          <div className="text-xs text-slate-400">WS Sequence ID</div>
          <div className="text-2xl font-semibold text-[#E5BF70] mt-1">
            #{pipeline.wsSequenceId}
          </div>
        </div>
      </div>

      {/* 18-Gate Results Table */}
      <div className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/8 bg-[#0E1420] text-slate-400 font-mono">
                <th className="py-2.5 px-4 font-medium w-16">Gate</th>
                <th className="py-2.5 px-4 font-medium">Verification Check</th>
                <th className="py-2.5 px-4 font-medium">Subsystem</th>
                <th className="py-2.5 px-4 font-medium">Evidence</th>
                <th className="py-2.5 px-4 font-medium text-right w-24">Latency</th>
                <th className="py-2.5 px-4 font-medium text-right w-24">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {auditResults.map((g) => (
                <tr key={g.gate} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-4 font-mono text-slate-400 tabular-nums">
                    {String(g.gate).padStart(2, '0')}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-100">{g.name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-400">{g.subsystem}</td>
                  <td className="py-2.5 px-4 text-slate-300">{g.detail}</td>
                  <td className="py-2.5 px-4 font-mono text-right text-slate-400 tabular-nums">
                    {g.latencyMs.toFixed(2)}ms
                  </td>
                  <td className="py-2.5 px-4 font-mono text-right">
                    <span
                      className={`inline-flex items-center gap-1 font-semibold ${
                        g.passed ? 'text-emerald-400' : 'text-red-400'
                      }`}
                    >
                      {g.passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {g.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
