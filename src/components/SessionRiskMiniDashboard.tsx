import { useMemo, useState } from 'react';
import { useAurumStore } from '../store/useStore';
import { computeSessionRiskMetrics } from '../engine/sessionRisk';
import { formatSharpeRatingFa } from '../engine/i18nFa';
import type { SharpeBasis } from '../engine/types';

function formatSigned(val: number, decimals = 2): string {
  return `${val >= 0 ? '+' : ''}${val.toFixed(decimals)}`;
}

function ratingTone(rating: ReturnType<typeof computeSessionRiskMetrics>['sharpeRating']): string {
  switch (rating) {
    case 'EXCELLENT':
      return 'text-emerald-400';
    case 'GOOD':
      return 'text-[#E5BF70]';
    case 'NEUTRAL':
      return 'text-slate-300';
    case 'WEAK':
      return 'text-red-400';
    default:
      return 'text-slate-500';
  }
}

export function SessionRiskMiniDashboard() {
  const simAccount = useAurumStore((s) => s.simAccount);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const closedTrades = useAurumStore((s) => s.closedTrades);
  const sessionEquityHistory = useAurumStore((s) => s.sessionEquityHistory);

  const [basis, setBasis] = useState<SharpeBasis>('TRADES');

  const risk = useMemo(
    () =>
      computeSessionRiskMetrics({
        account: simAccount,
        confirmedPositions,
        closedTrades,
        equityHistory: sessionEquityHistory,
        basis,
      }),
    [simAccount, confirmedPositions, closedTrades, sessionEquityHistory, basis]
  );

  // Visual gauge ceiling: scales up gracefully if intraday DD exceeds 5%
  const ddGaugeCeilingPct = Math.max(5, Math.ceil(risk.maxDrawdownPct));
  const currentDdBarPct = Math.min(100, (risk.currentDrawdownPct / ddGaugeCeilingPct) * 100);
  const maxDdMarkerPct = Math.min(100, (risk.maxDrawdownPct / ddGaugeCeilingPct) * 100);

  const ddTone = risk.isAtPeak
    ? 'text-emerald-400'
    : risk.currentDrawdownPct >= 2.0
      ? 'text-red-400'
      : 'text-amber-300';

  const ddStateLabel = risk.isAtPeak
    ? 'در سقف اکوئیتی'
    : risk.currentDrawdownPct >= 2.0
      ? 'ریسک بالا'
      : 'در افت سرمایه';

  const sharpeValueText =
    risk.activeSharpeRatio !== null ? formatSigned(risk.activeSharpeRatio, 2) : '—';

  const isSharpeStatNumeric =
    (basis === 'TRADES' && risk.tradeSharpeStatus === 'READY') ||
    (basis === 'MTM' && risk.mtmSharpeStatus === 'READY');

  const sharpeDetailText =
    basis === 'TRADES'
      ? risk.tradeSharpeStatus === 'READY'
        ? `μ ${formatSigned(risk.tradeMeanReturnPct, 2)}% · σ ${risk.tradeStdDevPct.toFixed(2)}%`
        : risk.tradeSharpeStatus === 'ZERO_VOLATILITY'
          ? `نوسان صفر در ${risk.totalTradeSamples} معامله`
          : risk.mtmSharpeRatio !== null
            ? `${risk.totalTradeSamples}/2 معامله · MTM ${formatSigned(risk.mtmSharpeRatio, 2)}`
            : `نیاز به حداقل ۲ معامله (${risk.totalTradeSamples}/2)`
      : risk.mtmSharpeStatus === 'READY'
        ? `μ ${formatSigned(risk.mtmMeanReturnPct, 3)}% · σ ${risk.mtmStdDevPct.toFixed(3)}%`
        : risk.mtmSharpeStatus === 'ZERO_VOLATILITY'
          ? 'واریانس MTM صفر'
          : `جمع‌آوری تیک (${risk.mtmReturnSamples}/2)`;

  return (
    <div
      aria-label="داشبورد تحلیل دراوداون و نسبت شارپ نشست"
      data-testid="session-risk-mini-dashboard"
      className="px-4 py-3 border-b border-white/8 bg-[#0B0F17]/80 space-y-2.5"
    >
      {/* Top Row: Title, Sample Context, and Sharpe Basis Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 text-[11px]">
          <span className="font-medium text-slate-200 whitespace-nowrap">
            تحلیل ریسک نشست معاملاتی
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span className="text-[10px] text-slate-400 tabular-nums truncate">
            {risk.closedTradeCount} بسته‌شده · {risk.activeTradeCount} باز
          </span>
        </div>

        <div
          role="group"
          aria-label="مبنای محاسبه نسبت شارپ"
          className="flex items-center gap-0.5 p-0.5 rounded bg-[#111827] border border-white/8 text-[10px] shrink-0"
        >
          <button
            type="button"
            aria-pressed={basis === 'TRADES'}
            data-testid="sharpe-basis-trades"
            onClick={() => setBasis('TRADES')}
            className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              basis === 'TRADES'
                ? 'bg-[#D4A853] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            معاملات
          </button>
          <button
            type="button"
            aria-pressed={basis === 'MTM'}
            data-testid="sharpe-basis-mtm"
            onClick={() => setBasis('MTM')}
            className={`px-2 py-0.5 rounded font-mono transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              basis === 'MTM'
                ? 'bg-[#D4A853] text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            MTM
          </button>
        </div>
      </div>

      {/* Primary 2-Column Quantitative Grid: Real-Time Drawdown | Session Sharpe Ratio */}
      <div className="grid grid-cols-2">
        {/* Column 1: Real-Time Drawdown */}
        <div className="pe-3 space-y-1.5">
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className="text-slate-400">دراوداون (DD)</span>
            <span className={ddTone} data-testid="session-dd-status">
              {ddStateLabel}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-1 font-mono tabular-nums" dir="ltr">
            <span
              className={`text-base font-semibold ${ddTone}`}
              data-testid="session-current-dd"
            >
              {risk.currentDrawdownPct > 0 ? `-${risk.currentDrawdownPct.toFixed(2)}%` : '0.00%'}
            </span>
            <span className="text-[11px] text-slate-400">
              {risk.currentDrawdownUsd > 0 ? `-$${risk.currentDrawdownUsd.toFixed(2)}` : '$0.00'}
            </span>
          </div>

          {/* Drawdown Meter (Current vs Session Max Marker) */}
          <div
            dir="ltr"
            className="relative h-1.5 rounded-full bg-white/6 overflow-hidden"
            title={`دراوداون فعلی ${risk.currentDrawdownPct.toFixed(2)}% · حداکثر ${risk.maxDrawdownPct.toFixed(2)}% (مقیاس 0-${ddGaugeCeilingPct}%)`}
          >
            <div
              className={`h-full transition-all duration-200 ${
                risk.currentDrawdownPct >= 2.0 ? 'bg-red-500/80' : 'bg-amber-400/75'
              }`}
              style={{ width: `${currentDdBarPct}%` }}
            />
            {risk.maxDrawdownPct > 0 && (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-400"
                style={{ left: `${maxDdMarkerPct}%` }}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500 tabular-nums">
            <span data-testid="session-max-dd">
              حداکثر{' '}
              <span className="font-mono" dir="ltr">
                {risk.maxDrawdownPct.toFixed(2)}% (${risk.maxDrawdownUsd.toFixed(0)})
              </span>
            </span>
            <span>
              سقف{' '}
              <span className="font-mono" dir="ltr">
                ${risk.peakEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
            </span>
          </div>
        </div>

        {/* Column 2: Session Sharpe Ratio */}
        <div className="border-s border-white/8 ps-3 space-y-1.5">
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className="text-slate-400">
              نسبت شارپ ({basis === 'TRADES' ? 'معاملات' : 'MTM'})
            </span>
            <span
              className={ratingTone(risk.sharpeRating)}
              data-testid="session-sharpe-rating"
            >
              {formatSharpeRatingFa(risk.sharpeRating)}
            </span>
          </div>

          <div className="flex items-baseline justify-between gap-1 font-mono tabular-nums" dir="ltr">
            <span
              className={`text-base font-semibold ${ratingTone(risk.sharpeRating)}`}
              data-testid="session-sharpe-value"
            >
              {sharpeValueText}
            </span>
            <span
              className={`text-[11px] ${
                risk.sessionReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
              data-testid="session-return-pct"
            >
              {formatSigned(risk.sessionReturnPct, 2)}%
            </span>
          </div>

          {/* Mean / Volatility Readout */}
          <div
            dir={isSharpeStatNumeric ? 'ltr' : 'rtl'}
            className={`${isSharpeStatNumeric ? 'font-mono text-end' : ''} text-[10px] text-slate-300 tabular-nums truncate`}
            data-testid="session-sharpe-detail"
          >
            {sharpeDetailText}
          </div>

          <div className="flex items-center justify-between gap-1 text-[10px] text-slate-500 tabular-nums">
            <span>
              {basis === 'TRADES'
                ? `${risk.totalTradeSamples} معامله`
                : `${risk.mtmReturnSamples} تیک`}
            </span>
            <span data-testid="session-recovery-factor">
              ضریب بازیابی{' '}
              <span className="font-mono" dir="ltr">
                {risk.recoveryFactor !== null ? `${formatSigned(risk.recoveryFactor, 2)}x` : '—'}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
