import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { computeAccountMetrics } from '../engine/tradeSimulator';

export function PayamAccountBar() {
  const simAccount = useAurumStore((s) => s.simAccount);
  const closedTrades = useAurumStore((s) => s.closedTrades);
  const resetSimAccount = useAurumStore((s) => s.resetSimAccount);
  const [showResetPresets, setShowResetPresets] = useState(false);

  const metrics = computeAccountMetrics(simAccount, closedTrades);
  const totalNetPnl = Number((simAccount.equity - simAccount.initialBalance).toFixed(2));
  const marginTone =
    simAccount.marginLevelPct === null
      ? 'text-slate-400'
      : simAccount.marginLevelPct < 80
        ? 'text-red-400'
        : simAccount.marginLevelPct < 200
          ? 'text-amber-300'
          : 'text-emerald-400';

  return (
    <div
      className="px-3.5 py-2.5 bg-[#0B0F17] border-b border-white/8 space-y-2"
      data-testid="payam-sim-account"
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-slate-400">
          بروکر شبیه‌ساز · اهرم{' '}
          <span className="font-mono" dir="ltr">1:{simAccount.leverage}</span> · کمیسیون{' '}
          <span className="font-mono" dir="ltr">${simAccount.commissionPerLotRoundTurn.toFixed(0)}/لات</span>
        </span>
        <div className="flex items-center gap-2">
          <span
            dir="ltr"
            className={`font-mono font-semibold tabular-nums ${totalNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            data-testid="sim-account-return"
          >
            {totalNetPnl >= 0 ? '+' : ''}${totalNetPnl.toFixed(2)} ({metrics.returnPct >= 0 ? '+' : ''}
            {metrics.returnPct.toFixed(2)}%)
          </span>
          <button
            type="button"
            onClick={() => setShowResetPresets((v) => !v)}
            aria-label="بازنشانی موجودی حساب شبیه‌ساز"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>بازنشانی</span>
          </button>
        </div>
      </div>

      {showResetPresets && (
        <div className="flex items-center justify-between gap-2 pt-1.5 pb-1 border-t border-white/6 text-[11px]">
          <span className="text-slate-400">سرمایه اولیه:</span>
          <div className="flex items-center gap-1 font-mono" dir="ltr">
            {[10000, 25000, 50000, 100000].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => {
                  resetSimAccount(amt);
                  setShowResetPresets(false);
                }}
                className="px-2 py-0.5 rounded border border-white/10 text-slate-200 hover:border-[#D4A853]/50 hover:text-[#E5BF70] transition-colors"
              >
                ${amt / 1000}k
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 text-[11px] tabular-nums">
        <div>
          <div className="text-[10px] text-slate-500">موجودی</div>
          <div className="text-slate-100 font-mono font-semibold" dir="ltr" data-testid="sim-balance">
            ${simAccount.balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">اکوئیتی</div>
          <div className="text-[#E5BF70] font-mono font-semibold" dir="ltr" data-testid="sim-equity">
            ${simAccount.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">مارجین آزاد</div>
          <div className="text-slate-200 font-mono" dir="ltr" data-testid="sim-free-margin">
            ${simAccount.freeMargin.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-slate-500">سطح مارجین</div>
          <div
            dir={simAccount.marginLevelPct !== null ? 'ltr' : 'rtl'}
            className={`font-medium ${simAccount.marginLevelPct !== null ? 'font-mono' : ''} ${marginTone}`}
            data-testid="sim-margin-level"
          >
            {simAccount.marginLevelPct !== null ? `${simAccount.marginLevelPct.toFixed(0)}%` : 'بدون پوزیشن'}
          </div>
        </div>
      </div>
    </div>
  );
}
