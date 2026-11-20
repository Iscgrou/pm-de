import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Compass,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type { ConfluencePillarScore, DefenseGateResult, TimeframeAlignmentRow } from '../engine/types';

function formatRoleLabel(role: TimeframeAlignmentRow['role']): string {
  switch (role) {
    case 'MACRO_COMPASS':
      return 'Macro Compass';
    case 'STRUCTURE_POI':
      return 'Structure / POI';
    case 'SETUP_CHOCH':
      return 'Setup / CHoCH';
    case 'EXECUTION_TRIGGER':
      return 'Execution';
  }
}

function formatKillzone(kz: string): string {
  return kz.replace(/_/g, ' ');
}

function formatDivergence(div: TimeframeAlignmentRow['divergence']): string {
  switch (div) {
    case 'BULLISH_REGULAR':
      return 'Bull Regular';
    case 'BEARISH_REGULAR':
      return 'Bear Regular';
    case 'BULLISH_HIDDEN':
      return 'Bull Hidden';
    case 'BEARISH_HIDDEN':
      return 'Bear Hidden';
    default:
      return 'None';
  }
}

function formatRsiRegime(regime: TimeframeAlignmentRow['rsiRegime']): string {
  if (regime === 'BULLISH_REGIME') return 'Bull 40-80';
  if (regime === 'BEARISH_REGIME') return 'Bear 20-60';
  return 'Neutral';
}

function pillarBarColor(status: ConfluencePillarScore['status']): string {
  if (status === 'STRONG') return 'bg-emerald-400';
  if (status === 'MODERATE') return 'bg-[#D4A853]';
  if (status === 'OPPOSING') return 'bg-red-400';
  return 'bg-slate-500';
}

function pillarTextColor(status: ConfluencePillarScore['status']): string {
  if (status === 'STRONG') return 'text-emerald-400';
  if (status === 'MODERATE') return 'text-[#E5BF70]';
  if (status === 'OPPOSING') return 'text-red-400';
  return 'text-slate-400';
}

function gateTone(status: DefenseGateResult['status']): { text: string; icon: typeof CheckCircle2 } {
  if (status === 'BLOCKED') return { text: 'text-red-400', icon: ShieldAlert };
  if (status === 'CAUTION') return { text: 'text-amber-300', icon: AlertTriangle };
  return { text: 'text-emerald-400', icon: CheckCircle2 };
}

export function PayamBrainMatrix() {
  const quant = useAurumStore((s) => s.quant);
  const setTimeframe = useAurumStore((s) => s.setTimeframe);
  const activeTf = useAurumStore((s) => s.timeframe);

  const brain = quant.brain;
  const dealing = quant.dealingRange;
  const rsiActive = quant.rsi.active;

  const isLong = brain.decision === 'PROPOSE_LONG';
  const isShort = brain.decision === 'PROPOSE_SHORT';
  const isStandDown = brain.decision === 'STAND_DOWN';

  const decisionColor = isLong
    ? 'text-emerald-400'
    : isShort
      ? 'text-red-400'
      : 'text-amber-300';

  const gradeColor =
    brain.convictionGrade === 'A+'
      ? 'text-emerald-400'
      : brain.convictionGrade === 'A'
        ? 'text-[#E5BF70]'
        : brain.convictionGrade === 'B'
          ? 'text-sky-300'
          : 'text-amber-300';

  const blockedCount = brain.defenseGates.filter((g) => g.status === 'BLOCKED').length;
  const cautionCount = brain.defenseGates.filter((g) => g.status === 'CAUTION').length;

  return (
    <section
      aria-label="Payam Institutional Brain Confluence Matrix and Anti-Emotion Shield"
      data-testid="payam-brain-matrix"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden"
    >
      {/* Top Executive Verdict Strip */}
      <div className="px-4 py-3 border-b border-white/8 flex flex-wrap xl:flex-nowrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <BrainCircuit className="w-4 h-4 text-[#D4A853] shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <h2 className="font-display text-sm font-semibold text-slate-100 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>Payam Institutional Brain</span>
              <span className="font-fa text-[11px] font-normal text-[#E5BF70]" dir="rtl">
                مغز تحلیلی پیام · ۶ ستون وزندهی + سپر ۷ لایه
              </span>
            </h2>
            <p className="text-[11px] font-mono text-slate-400 tabular-nums truncate">
              4H <strong className={brain.h4Bias === 'BULLISH' ? 'text-emerald-400' : brain.h4Bias === 'BEARISH' ? 'text-red-400' : 'text-slate-300'}>{brain.h4Bias}</strong>
              <span className="mx-1.5 text-slate-600">·</span>
              {formatKillzone(brain.killzone)}
              <span className="mx-1.5 text-slate-600">·</span>
              P/D <strong className="text-slate-200">{dealing.positionPct.toFixed(0)}%</strong>
              <span className="mx-1.5 text-slate-600">·</span>
              RSI <strong className="text-slate-200">{rsiActive.value.toFixed(1)}</strong>
            </p>
          </div>
        </div>

        {/* High-Signal Decision Readout (Unboxed Tabular Hierarchy) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs tabular-nums shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Verdict</div>
            <div className={`font-display font-bold text-sm flex items-center gap-1 whitespace-nowrap ${decisionColor}`} data-testid="brain-verdict">
              {isLong ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : isShort ? (
                <TrendingDown className="w-3.5 h-3.5" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5" />
              )}
              <span>{brain.decision.replace(/_/g, ' ')}</span>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Score</div>
            <div className="font-semibold text-slate-100 whitespace-nowrap" data-testid="brain-total-score">
              <span className={gradeColor}>{brain.totalScore}/100</span>
              <span className="text-slate-500 mx-1">·</span>
              <span className={gradeColor} data-testid="brain-grade">
                {brain.convictionGrade === 'STAND_DOWN' ? 'STAND DOWN' : `Grade ${brain.convictionGrade}`}
              </span>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">L / S</div>
            <div className="text-slate-300 whitespace-nowrap">
              <span className="text-emerald-400">L {brain.longScore}</span>
              <span className="text-slate-600 mx-1">/</span>
              <span className="text-red-400">S {brain.shortScore}</span>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Risk</div>
            <div className="text-slate-100 font-semibold whitespace-nowrap">
              {Math.round(brain.recommendedRiskMultiplier * 100)}%
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Analytical Core: 6-Pillar Matrix + 7-Gate Anti-Emotion Shield */}
      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-white/8">
        {/* Left: 6-Pillar 100-Point Confluence Matrix */}
        <div className="lg:col-span-6 p-4 space-y-3" data-testid="brain-pillars-section">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
              <Compass className="w-3.5 h-3.5 text-[#D4A853]" />
              <span>6-Pillar Weighted Confluence (100 pts)</span>
            </div>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {brain.goldenConfluence ? 'Golden OB+FVG Active' : 'Standard SMC Weighting'}
            </span>
          </div>

          <div className="space-y-2.5">
            {brain.pillars.map((pillar) => {
              const pct = Math.max(0, Math.min(100, (pillar.score / Math.max(1, pillar.maxScore)) * 100));
              return (
                <div key={pillar.id} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-slate-200 font-medium truncate">{pillar.label}</span>
                      <span className="font-fa text-[10px] text-slate-400 truncate hidden sm:inline" dir="rtl">
                        {pillar.labelFa}
                      </span>
                    </div>
                    <span className={`font-mono text-[11px] font-semibold tabular-nums shrink-0 ${pillarTextColor(pillar.status)}`}>
                      {pillar.score.toFixed(1)} / {pillar.maxScore}
                    </span>
                  </div>

                  <div className="h-1.5 w-full rounded-xs bg-[#0B0F17] overflow-hidden border border-white/5">
                    <div
                      className={`h-full transition-all duration-300 ${pillarBarColor(pillar.status)}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 truncate" title={pillar.detail}>
                    {pillar.detail}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: 7-Gate Anti-Emotion & Anti-Fakeout Shield */}
        <div className="lg:col-span-6 p-4 space-y-3" data-testid="brain-defense-gates">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>7-Gate Anti-Emotion & Fakeout Shield</span>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-slate-400">
              {blockedCount > 0 ? (
                <span className="text-red-400 font-semibold">{blockedCount} Hard Veto</span>
              ) : cautionCount > 0 ? (
                <span className="text-amber-300">{cautionCount} Caution</span>
              ) : (
                <span className="text-emerald-400">All 7 Clear</span>
              )}
            </span>
          </div>

          <div className="divide-y divide-white/6 rounded-md border border-white/8 bg-[#0B0F17]">
            {brain.defenseGates.map((gate) => {
              const tone = gateTone(gate.status);
              const Icon = tone.icon;
              return (
                <div
                  key={gate.id}
                  data-testid={`defense-gate-${gate.id}`}
                  className="px-3 py-2 flex items-start justify-between gap-3 text-[11px]"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 shrink-0 ${tone.text}`} />
                      <span className="font-medium text-slate-200 truncate">{gate.label}</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">{gate.detail}</p>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className={`font-semibold text-[10px] ${tone.text}`}>{gate.status}</div>
                    <div className="text-[10px] text-slate-500">{gate.metric}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Strip: Full-Width 4H -> 1H -> 15M -> 5M Alignment Table + 2-Col Pullback Zone & Bilingual Verdict */}
      <div className="border-t border-white/8 bg-[#0E1420] p-4 space-y-3">
        {/* Top-Down MTF Matrix Table (Full Width — zero horizontal clipping) */}
        <div className="overflow-x-auto rounded-md border border-white/8 bg-[#0B0F17] px-3 py-2">
          <table className="w-full text-left font-mono text-[11px] tabular-nums border-collapse">
            <thead>
              <tr className="border-b border-white/8 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-1.5 pr-3 font-medium">TF</th>
                <th className="py-1.5 px-2 font-medium">Role</th>
                <th className="py-1.5 px-2 font-medium">Bias</th>
                <th className="py-1.5 px-2 font-medium">RSI(14) / Cardwell Regime</th>
                <th className="py-1.5 px-2 font-medium">Divergence</th>
                <th className="py-1.5 px-2 font-medium">Last Structure</th>
                <th className="py-1.5 pl-2 text-right font-medium">Fresh POI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {brain.mtfMatrix.map((row) => {
                const biasColor =
                  row.bias === 'BULLISH'
                    ? 'text-emerald-400'
                    : row.bias === 'BEARISH'
                      ? 'text-red-400'
                      : 'text-slate-400';
                const divColor = row.divergence.startsWith('BULLISH')
                  ? 'text-emerald-300'
                  : row.divergence.startsWith('BEARISH')
                    ? 'text-red-300'
                    : 'text-slate-500';
                return (
                  <tr
                    key={row.timeframe}
                    onClick={() => setTimeframe(row.timeframe)}
                    className={`cursor-pointer transition-colors hover:bg-white/[0.03] ${
                      activeTf === row.timeframe ? 'bg-[#D4A853]/[0.07]' : ''
                    }`}
                  >
                    <td className="py-1.5 pr-3 font-semibold text-slate-100">{row.timeframe}</td>
                    <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{formatRoleLabel(row.role)}</td>
                    <td className={`py-1.5 px-2 font-semibold ${biasColor}`}>{row.bias}</td>
                    <td className="py-1.5 px-2 text-slate-300 whitespace-nowrap">
                      {row.rsi.toFixed(1)} · <span className="text-slate-400">{formatRsiRegime(row.rsiRegime)}</span>
                    </td>
                    <td className={`py-1.5 px-2 whitespace-nowrap ${divColor}`}>{formatDivergence(row.divergence)}</td>
                    <td className="py-1.5 px-2 text-slate-400 whitespace-nowrap">{row.lastStructure}</td>
                    <td className="py-1.5 pl-2 text-right text-slate-300 whitespace-nowrap">
                      {row.unmitigatedObCount} OB · {row.unmitigatedFvgCount} FVG
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Balanced 2-Column Institutional Pullback Zone & Disciplined Bilingual Verdict */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-stretch">
          {brain.watchlistZone && (
            <div className="md:col-span-5 rounded-md border border-white/8 bg-[#0B0F17] p-3 flex flex-col justify-between gap-2 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="inline-flex items-center gap-1 text-slate-300 font-medium whitespace-nowrap">
                  <Target className="w-3 h-3 text-[#D4A853]" />
                  Pullback Zone ({brain.watchlistZone.direction})
                </span>
                <span className="text-slate-400 whitespace-nowrap">
                  ER {(brain.kaufmanEfficiency * 100).toFixed(0)}% · {brain.atrExtension >= 0 ? '+' : ''}
                  {brain.atrExtension.toFixed(2)} ATR
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-white/6">
                <div>
                  <div className="text-[9px] text-slate-500">OPTIMAL ENTRY</div>
                  <div className="text-[#E5BF70] font-semibold">
                    {brain.watchlistZone.optimalEntry.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">INVALIDATION</div>
                  <div className="text-red-400 font-semibold">
                    {brain.watchlistZone.invalidationLevel.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">LIQ TARGET</div>
                  <div className="text-emerald-400 font-semibold">
                    {brain.watchlistZone.targetLiquidity.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bilingual Institutional Brain Verdict */}
          <div
            className={`${brain.watchlistZone ? 'md:col-span-7' : 'md:col-span-12'} rounded-md border px-3 py-2.5 flex flex-col justify-center space-y-1 text-[11px] leading-relaxed ${
              isStandDown
                ? 'border-amber-400/25 bg-amber-950/15'
                : 'border-white/8 bg-[#0B0F17]'
            }`}
          >
            <p className="font-fa text-slate-200 text-right" dir="rtl" data-testid="brain-summary-fa">
              {brain.summaryFa}
            </p>
            <p className="text-slate-400 text-[10px]" data-testid="brain-summary-en">
              {brain.summaryEn}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
