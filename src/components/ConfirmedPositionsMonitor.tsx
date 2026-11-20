import { Activity, Shield, Crosshair, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { formatActionTagFa, formatHsmStageFa } from '../engine/i18nFa';
import { SessionRiskMiniDashboard } from './SessionRiskMiniDashboard';
import { TradeEquityD3Chart } from './TradeEquityD3Chart';

export function ConfirmedPositionsMonitor() {
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const closedConfirmedCount = useAurumStore((s) => s.closedConfirmedCount);
  const focusedPositionId = useAurumStore((s) => s.focusedPositionId);
  const focusPosition = useAurumStore((s) => s.focusPosition);
  const moveConfirmedPositionBreakEven = useAurumStore((s) => s.moveConfirmedPositionBreakEven);
  const simulateConfirmedPositionStep = useAurumStore((s) => s.simulateConfirmedPositionStep);
  const partialClosePosition = useAurumStore((s) => s.partialClosePosition);
  const closeConfirmedPosition = useAurumStore((s) => s.closeConfirmedPosition);

  const totalPnl = confirmedPositions.reduce((acc, p) => acc + p.netPnl, 0);
  const avgR =
    confirmedPositions.length > 0
      ? confirmedPositions.reduce((acc, p) => acc + p.rMultiple, 0) / confirmedPositions.length
      : 0;

  return (
    <section
      aria-label="پایشگر زنده پوزیشن‌های تاییدشده در بروکر"
      className="rounded-lg border border-white/8 bg-[#111827] overflow-hidden flex flex-col"
      data-testid="confirmed-positions-monitor"
    >
      {/* Header with Aggregate Portfolio Telemetry */}
      <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>پایشگر زنده پوزیشن‌های بروکر</span>
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            مانیتورینگ زنده پوزیشن‌های تایید شده شما در بروکر تا زمان بستن
          </p>
        </div>

        <div className="text-end tabular-nums shrink-0">
          <div
            dir="ltr"
            className={`font-mono text-sm font-semibold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </div>
          <div className="text-[10px] text-slate-400">
            {confirmedPositions.length} باز ·{' '}
            <span className="font-mono" dir="ltr">
              {avgR >= 0 ? '+' : ''}
              {avgR.toFixed(2)}R
            </span>{' '}
            · {closedConfirmedCount} بسته‌شده
          </div>
        </div>
      </div>

      {/* Real-Time Session Drawdown & Sharpe Ratio Mini-Dashboard */}
      <SessionRiskMiniDashboard />

      {/* D3.js Equity Curve, Underwater Drawdown & Rolling Sharpe Ratio (Last 20 Trades) */}
      <TradeEquityD3Chart />

      {/* Positions List */}
      <div className="p-3.5 space-y-3 max-h-[540px] overflow-y-auto">
        {confirmedPositions.length === 0 ? (
          <div className="py-8 px-4 text-center space-y-2 border border-dashed border-white/10 rounded-md bg-[#0B0F17]/60">
            <p className="text-xs text-slate-300">
              هنوز پوزیشنی از لیست پیشنهادها در بروکر تایید نشده است.
            </p>
            <p className="text-[11px] text-slate-500">
              برای شروع پایش مداوم HSM و مدیریت هوشمند، یکی از ستاپ‌ها را در بخش پیشنهادهای معاملاتی تایید کنید.
            </p>
          </div>
        ) : (
          confirmedPositions.map((pos) => {
            const isFocused = focusedPositionId === pos.id;
            const isLong = pos.direction === 'LONG';
            const urgencyTone =
              pos.urgency === 'CRITICAL'
                ? 'border-red-500/40 bg-red-500/[0.06]'
                : pos.urgency === 'ATTENTION'
                  ? 'border-amber-400/40 bg-amber-500/[0.05]'
                  : 'border-white/8 bg-[#0B0F17]';

            return (
              <article
                key={pos.id}
                data-testid={`confirmed-position-${pos.id}`}
                className={`rounded-md border p-3 space-y-2.5 transition-colors ${urgencyTone} ${
                  isFocused ? 'ring-1 ring-[#D4A853]/60' : ''
                }`}
              >
                {/* Position Identity & Live PnL */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className={`font-mono font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pos.direction}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300 tabular-nums">
                        <span className="font-mono" dir="ltr">{pos.lotSize.toFixed(2)}</span> لات
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-[#E5BF70]">{formatHsmStageFa(pos.stage)}</span>
                    </div>
                    <div className="text-xs font-medium text-slate-200 truncate mt-0.5">{pos.setupType}</div>
                  </div>

                  <div className="text-end tabular-nums shrink-0">
                    <div
                      dir={pos.status === 'PENDING_LIMIT' ? 'rtl' : 'ltr'}
                      className={`font-mono text-sm font-semibold ${pos.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {pos.status === 'PENDING_LIMIT'
                        ? 'در انتظار'
                        : `${pos.netPnl >= 0 ? '+' : ''}$${pos.netPnl.toFixed(2)}`}
                    </div>
                    <div className={`text-[10px] ${pos.rMultiple >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                      <span className="font-mono" dir="ltr">
                        {pos.rMultiple >= 0 ? '+' : ''}
                        {pos.rMultiple.toFixed(2)}R
                      </span>{' '}
                      · مارجین{' '}
                      <span className="font-mono" dir="ltr">
                        ${pos.marginUsed.toFixed(0)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Price Levels Row */}
                <div className="grid grid-cols-4 gap-1.5 px-2 py-1.5 rounded bg-[#111827] border border-white/6 text-[10px] tabular-nums">
                  <div>
                    <span className="text-slate-500 block">ورود</span>
                    <span className="text-slate-200 font-mono" dir="ltr">{pos.entry.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-mono">SL</span>
                    <span className="text-red-400 font-mono" dir="ltr">{pos.stopLoss.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-mono">TP1</span>
                    <span className="text-emerald-400 font-mono" dir="ltr">{pos.tp1.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-mono">TP2</span>
                    <span className="text-emerald-300 font-mono" dir="ltr">{pos.tp2.toFixed(2)}</span>
                  </div>
                </div>

                {/* Live Agent Tactical Advice */}
                <div className="rounded bg-[#111827]/90 border border-white/6 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="inline-flex items-center gap-1 text-[#E5BF70] font-semibold">
                      {pos.urgency === 'CRITICAL' ? (
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      )}
                      دستور عامل: {formatActionTagFa(pos.actionTag)}
                    </span>
                    <span className="text-slate-500">HSM زنده</span>
                  </div>
                  <p className="font-fa text-xs text-slate-100 leading-relaxed">
                    {pos.adviceFa || pos.adviceEn}
                  </p>
                </div>

                {/* Management Controls */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => focusPosition(pos.id)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
                        isFocused
                          ? 'border-[#D4A853]/50 bg-[#D4A853]/15 text-[#E5BF70]'
                          : 'border-white/10 text-slate-300 hover:bg-white/5'
                      }`}
                    >
                      <Crosshair className="w-3 h-3" />
                      {isFocused ? 'روی نمودار' : 'نمایش'}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveConfirmedPositionBreakEven(pos.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
                    >
                      <Shield className="w-3 h-3 text-emerald-400" />
                      قفل BE
                    </button>
                    <button
                      type="button"
                      onClick={() => simulateConfirmedPositionStep(pos.id, 'TP1')}
                      className="px-2 py-1 rounded border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
                    >
                      تست TP1
                    </button>
                    {pos.status === 'ACTIVE' && pos.lotSize >= 0.02 && (
                      <button
                        type="button"
                        onClick={() => partialClosePosition(pos.id, 0.5)}
                        className="px-2 py-1 rounded border border-amber-400/35 text-amber-200 hover:bg-amber-500/15 transition-colors"
                      >
                        بستن ۵۰٪
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    data-testid={`close-confirmed-${pos.id}`}
                    onClick={() => closeConfirmedPosition(pos.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-red-500/35 text-red-300 hover:bg-red-500/15 transition-colors"
                  >
                    <XCircle className="w-3 h-3" />
                    <span>بستن در بروکر</span>
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
