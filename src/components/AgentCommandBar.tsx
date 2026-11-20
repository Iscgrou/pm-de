import { useEffect, useState } from 'react';
import {
  Power,
  Radar,
  Cpu,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  ShieldAlert,
  SlidersHorizontal,
  OctagonX,
  Settings2,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type { AgentEngineMode } from '../engine/types';
import {
  AiSettingsModal,
  getModeShortLabel,
  loadLocalAiSettings,
  type AiEngineSettings,
} from './AiSettingsModal';

export function AgentCommandBar() {
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentMode = useAurumStore((s) => s.agentMode);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const agentError = useAurumStore((s) => s.agentError);
  const activeTools = useAurumStore((s) => s.activeTools);
  const basisDivergence = useAurumStore((s) => s.basisDivergence);
  const quant = useAurumStore((s) => s.quant);
  const proposals = useAurumStore((s) => s.proposals);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const agentConfig = useAurumStore((s) => s.agentConfig);
  const circuitBreakers = useAurumStore((s) => s.circuitBreakers);
  const toggleAgentEnabled = useAurumStore((s) => s.toggleAgentEnabled);
  const setAgentMode = useAurumStore((s) => s.setAgentMode);
  const runAgentScanCycle = useAurumStore((s) => s.runAgentScanCycle);
  const toggleKillSwitch = useAurumStore((s) => s.toggleKillSwitch);
  const setControlCenterOpen = useAurumStore((s) => s.setControlCenterOpen);

  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiSettingsSummary, setAiSettingsSummary] = useState<AiEngineSettings>(() => loadLocalAiSettings());

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const detail = (e as CustomEvent<AiEngineSettings>).detail;
      if (detail) setAiSettingsSummary(detail);
      else setAiSettingsSummary(loadLocalAiSettings());
    };
    window.addEventListener('payam:ai-config-updated', onUpdated);
    return () => window.removeEventListener('payam:ai-config-updated', onUpdated);
  }, []);

  const enabledSubAgents = aiSettingsSummary.subAgents.filter((s) => s.enabled).length;

  const brain = quant.brain;
  const rsiActive = quant.rsi.active;
  const trippedCount = circuitBreakers.breakers.filter((b) => b.hardBlock).length;
  const killActive = agentConfig.killSwitchEngaged;

  const openProposalsCount = proposals.filter((p) => p.status === 'PROPOSED').length;
  const basisTone =
    basisDivergence.status === 'CRYPTO_INDUCEMENT'
      ? 'text-red-400'
      : basisDivergence.status === 'BASIS_DRIFT'
        ? 'text-amber-300'
        : 'text-emerald-400';

  return (
    <>
      <section
        aria-label="Payam Autonomous Agentic Command Bar"
        className="border-b border-white/8 bg-[#101624] px-4 lg:px-6 py-2.5"
      >
        <div dir="ltr" className="max-w-[1600px] mx-auto space-y-2">
          <div className="flex flex-wrap 2xl:flex-nowrap items-center justify-between gap-x-3 gap-y-2">
            {/* Left: Master Switch ("روشن کردن مدل") + Scan Controls + AI Settings + Risk Settings + Kill Switch */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={agentEnabled}
                onClick={toggleAgentEnabled}
                data-testid="agent-master-switch"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                  agentEnabled
                    ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200'
                    : 'bg-[#0B0F17] border-[#D4A853]/40 text-slate-200 hover:border-[#D4A853]'
                }`}
              >
                <Power className={`w-3.5 h-3.5 ${agentEnabled ? 'text-emerald-400' : 'text-[#D4A853]'}`} />
                <span className="font-fa" dir="rtl">
                  {agentEnabled ? 'مدل روشن' : 'روشن کردن مدل'}
                </span>
                <span className="font-mono text-[11px] opacity-80">
                  · {agentEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </button>

              <button
                type="button"
                disabled={agentBusy}
                onClick={() => void runAgentScanCycle()}
                data-testid="agent-scan-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/6 hover:bg-white/10 disabled:opacity-50 text-[#E5BF70] border border-[#D4A853]/30 transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{agentBusy ? 'Scanning...' : 'Scan (AI)'}</span>
              </button>

              <button
                type="button"
                disabled={agentBusy}
                onClick={() => void runAgentScanCycle({ quantOnly: true })}
                data-testid="quant-scan-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[#0B0F17] hover:bg-white/6 disabled:opacity-50 text-slate-300 border border-white/10 transition-colors whitespace-nowrap shrink-0"
              >
                <Radar className="w-3.5 h-3.5 text-sky-400" />
                <span>Quant</span>
              </button>

              {/* Engine Bridge Mode Selector */}
              <div
                className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0F17] border border-white/8 text-[11px] font-mono shrink-0"
                role="group"
                aria-label="Agentic Engine Mode"
              >
                {(
                  [
                    ['HYBRID', 'Hybrid'],
                    ['GEMINI_API', 'Gemini'],
                    ['ANTIGRAVITY_MCP', 'MCP'],
                  ] as [AgentEngineMode, string][]
                ).map(([modeKey, label]) => (
                  <button
                    key={modeKey}
                    type="button"
                    onClick={() => setAgentMode(modeKey)}
                    className={`px-2 py-1 rounded transition-colors whitespace-nowrap ${
                      agentMode === modeKey
                        ? 'bg-[#D4A853]/20 text-[#E5BF70]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Dedicated AI & Sub-Agents Settings Trigger */}
              <button
                type="button"
                onClick={() => setAiSettingsOpen(true)}
                data-testid="open-ai-settings-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold bg-[#D4A853]/14 hover:bg-[#D4A853]/22 text-[#E5BF70] border border-[#D4A853]/45 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Settings2 className="w-3.5 h-3.5 text-[#E5BF70]" />
                <span>AI &amp; Sub-Agents</span>
                <span className="font-mono text-[10px] text-amber-200/85 tabular-nums">
                  {getModeShortLabel(aiSettingsSummary.connectionMode)} · {enabledSubAgents}/5
                </span>
              </button>

              <button
                type="button"
                onClick={() => setControlCenterOpen(true)}
                data-testid="open-control-center-btn"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  trippedCount > 0
                    ? 'bg-red-500/15 border-red-400/50 text-red-200'
                    : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-slate-100 hover:border-white/20'
                }`}
              >
                {trippedCount > 0 ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                ) : (
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#D4A853]" />
                )}
                <span>Risk &amp; Config</span>
                <span className="font-mono text-[10px] opacity-85">
                  {trippedCount > 0 ? `(${trippedCount} HALT)` : '7/7'}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleKillSwitch}
                data-testid="toolbar-kill-switch-btn"
                aria-pressed={killActive}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono font-semibold border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  killActive
                    ? 'bg-red-600/30 border-red-400 text-red-100'
                    : 'bg-[#0B0F17] border-red-500/35 text-red-300 hover:bg-red-500/15'
                }`}
              >
                <OctagonX className="w-3.5 h-3.5" />
                <span>{killActive ? 'KILL ACTIVE' : 'Kill Switch'}</span>
              </button>
            </div>

            {/* Right: Basis Divergence Meter, Brain Score & Proposal/Monitor Counters */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono tabular-nums shrink-0">
              <div className="flex items-center gap-1 whitespace-nowrap" title={basisDivergence.note}>
                {basisDivergence.cryptoInducementWarning ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span className="text-slate-400">Basis:</span>
                <span className={`font-semibold ${basisTone}`} data-testid="basis-spread-value">
                  {basisDivergence.basisUsd >= 0 ? '+' : ''}
                  {basisDivergence.basisUsd.toFixed(2)}$
                </span>
              </div>

              <span className="hidden lg:inline text-white/15" aria-hidden="true">|</span>

              <div className="flex items-center gap-1.5 whitespace-nowrap text-slate-300" data-testid="command-brain-telemetry">
                <span className="text-slate-400">Brain:</span>
                <strong
                  className={
                    brain.decision === 'STAND_DOWN'
                      ? 'text-amber-300'
                      : brain.decision === 'PROPOSE_LONG'
                        ? 'text-emerald-400'
                        : 'text-red-400'
                  }
                >
                  {brain.totalScore}/100 ({brain.convictionGrade === 'STAND_DOWN' ? 'SD' : brain.convictionGrade})
                </strong>
                <span className="text-slate-600">·</span>
                <span>
                  H4{' '}
                  <strong
                    className={
                      brain.h4Bias === 'BULLISH'
                        ? 'text-emerald-400'
                        : brain.h4Bias === 'BEARISH'
                          ? 'text-red-400'
                          : 'text-slate-300'
                    }
                  >
                    {brain.h4Bias === 'BULLISH' ? 'BULL' : brain.h4Bias === 'BEARISH' ? 'BEAR' : 'NEUT'}
                  </strong>
                </span>
                <span className="text-slate-600">·</span>
                <span>
                  RSI <strong className="text-slate-100">{rsiActive.value.toFixed(1)}</strong>
                </span>
              </div>

              <span className="hidden lg:inline text-white/15" aria-hidden="true">|</span>

              <div className="flex items-center gap-2 whitespace-nowrap text-slate-300">
                <span>
                  Prop <strong className="text-[#E5BF70]" data-testid="open-proposals-count">{openProposalsCount}</strong>
                </span>
                <span>
                  Live{' '}
                  <strong className="text-emerald-400" data-testid="confirmed-positions-count">
                    {confirmedPositions.length}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          {/* Tool Chain Telemetry Strip + Honest API Error Surface */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/6 text-[11px] font-mono text-slate-400">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Cpu className="w-3.5 h-3.5 text-[#D4A853] shrink-0" />
              <span className="text-slate-300">Agent Tools:</span>
              <span>{activeTools.join(' · ')}</span>
            </div>
            {agentError && (
              <div className="text-amber-300 flex items-center gap-1.5" role="alert">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{agentError}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <AiSettingsModal
        open={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
        onSaved={(next) => setAiSettingsSummary(next)}
      />
    </>
  );
}

