import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  XCircle,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { formatActionTagFa, formatExecutionTypeFa, formatHsmStageFa } from '../engine/i18nFa';
import type { ConfirmedPosition } from '../engine/types';

function computePriceProgressPct(pos: ConfirmedPosition, markPrice: number): number {
  const isLong = pos.direction === 'LONG';
  const low = isLong ? pos.stopLoss : pos.tp2;
  const high = isLong ? pos.tp2 : pos.stopLoss;
  const span = Math.max(0.1, high - low);
  const raw = isLong ? ((markPrice - low) / span) * 100 : ((high - markPrice) / span) * 100;
  return Math.max(0, Math.min(100, raw));
}

export function PayamLiveMonitorView() {
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const tick = useAurumStore((s) => s.tick);
  const focusedPositionId = useAurumStore((s) => s.focusedPositionId);
  const focusPosition = useAurumStore((s) => s.focusPosition);
  const moveConfirmedPositionBreakEven = useAurumStore((s) => s.moveConfirmedPositionBreakEven);
  const toggleTrailingStop = useAurumStore((s) => s.toggleTrailingStop);
  const modifyConfirmedPosition = useAurumStore((s) => s.modifyConfirmedPosition);
  const partialClosePosition = useAurumStore((s) => s.partialClosePosition);
  const simulateConfirmedPositionStep = useAurumStore((s) => s.simulateConfirmedPositionStep);
  const simulateMarketShock = useAurumStore((s) => s.simulateMarketShock);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp1, setEditTp1] = useState('');
  const [editTp2, setEditTp2] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const openEditor = (pos: ConfirmedPosition) => {
    if (editingId === pos.id) {
      setEditingId(null);
      setEditError(null);
      return;
    }
    setEditingId(pos.id);
    setEditSl(pos.stopLoss.toFixed(2));
    setEditTp1(pos.tp1.toFixed(2));
    setEditTp2(pos.tp2.toFixed(2));
    setEditError(null);
  };

  const saveEditor = (posId: string) => {
    const res = modifyConfirmedPosition(posId, {
      stopLoss: Number(editSl),
      tp1: Number(editTp1),
      tp2: Number(editTp2),
    });
    if (!res.ok) {
      setEditError(res.error ?? 'چیدمان قیمتی نامعتبر است');
      return;
    }
    setEditingId(null);
    setEditError(null);
  };

  return (
    <div className="p-3.5 space-y-3" data-testid="payam-live-monitor">
      {/* Live Market Impulse Simulator Strip */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/8 text-[11px] font-mono tabular-nums">
        <span className="text-slate-400" dir="ltr">
          Bid <strong className="text-slate-200">{tick.bid.toFixed(2)}</strong> / Ask{' '}
          <strong className="text-slate-200">{tick.ask.toFixed(2)}</strong>
        </span>
        <div className="flex items-center gap-1" dir="ltr">
          <button
            type="button"
            onClick={() => simulateMarketShock(-3.5)}
            className="px-1.5 py-0.5 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors"
            title="شبیه‌سازی شوک قیمتی -$3.50 طلا"
          >
            -$3.5
          </button>
          <button
            type="button"
            onClick={() => simulateMarketShock(3.5)}
            className="px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
            title="شبیه‌سازی شوک قیمتی +$3.50 طلا"
          >
            +$3.5
          </button>
        </div>
      </div>

      {confirmedPositions.length === 0 ? (
        <div className="py-7 px-3 text-center space-y-2 border border-dashed border-white/10 rounded-md bg-[#0B0F17]/70">
          <p className="text-xs text-slate-300">هیچ معامله شبیه‌سازی‌شده فعالی تحت پایش نیست.</p>
          <p className="text-[11px] text-slate-500">
            برای اجرای شبیه‌ساز بروکر و شروع پایش زنده، یکی از ستاپ‌ها را از تب پیشنهادها تایید کنید.
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[540px] overflow-y-auto pe-0.5">
          {confirmedPositions.map((pos) => {
            const isLong = pos.direction === 'LONG';
            const isFocused = focusedPositionId === pos.id;
            const isPending = pos.status === 'PENDING_LIMIT';
            const markPrice = isLong ? tick.bid : tick.ask;
            const progressPct = computePriceProgressPct(pos, markPrice);
            const entryPct = computePriceProgressPct(pos, pos.entry);
            const tp1Pct = computePriceProgressPct(pos, pos.tp1);
            const isEditing = editingId === pos.id;
            const isLogOpen = expandedLogId === pos.id;

            const borderTone =
              pos.urgency === 'CRITICAL'
                ? 'border-red-500/40 bg-red-500/[0.04]'
                : pos.urgency === 'ATTENTION'
                  ? 'border-amber-400/35 bg-amber-500/[0.03]'
                  : 'border-white/10 bg-[#0B0F17]';

            return (
              <article
                key={pos.id}
                data-testid={`payam-monitor-card-${pos.id}`}
                className={`rounded-md border p-3 space-y-2.5 transition-colors ${borderTone} ${
                  isFocused ? 'ring-1 ring-[#D4A853]/50' : ''
                }`}
              >
                {/* Header: Order Identity & Live Net P&L */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] tabular-nums">
                      <span className={`font-mono font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pos.direction}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-200">
                        <span className="font-mono" dir="ltr">{pos.lotSize.toFixed(2)}</span> لات
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className={isPending ? 'text-sky-300 font-semibold' : 'text-[#E5BF70]'}>
                        {isPending ? 'لیمیت در انتظار' : formatHsmStageFa(pos.stage)}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-100 truncate mt-0.5">
                      {pos.setupType}
                    </div>
                    <div className="text-[10px] text-slate-500 tabular-nums">
                      <span className="font-mono" dir="ltr">{pos.orderId}</span> · {formatExecutionTypeFa(pos.executionType)} · اجرا{' '}
                      <span className="font-mono" dir="ltr">${pos.fillPrice.toFixed(2)}</span>
                      {pos.slippageUsd > 0 ? (
                        <>
                          {' '}
                          (اسلیپیج <span className="font-mono" dir="ltr">${pos.slippageUsd.toFixed(2)}</span>)
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-end tabular-nums shrink-0">
                    <div
                      dir={isPending ? 'rtl' : 'ltr'}
                      data-testid={`monitor-pnl-${pos.id}`}
                      className={`font-mono text-sm font-semibold ${
                        isPending
                          ? 'text-slate-400'
                          : pos.netPnl >= 0
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {isPending ? 'در انتظار' : `${pos.netPnl >= 0 ? '+' : ''}$${pos.netPnl.toFixed(2)}`}
                    </div>
                    {!isPending && (
                      <div className={`text-[10px] ${pos.rMultiple >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        <span className="font-mono" dir="ltr">
                          {pos.rMultiple >= 0 ? '+' : ''}
                          {pos.rMultiple.toFixed(2)}R
                        </span>
                        {pos.realizedPnl !== 0 ? (
                          <>
                            {' '}
                            · سود قطعی{' '}
                            <span className="font-mono" dir="ltr">
                              {pos.realizedPnl >= 0 ? '+' : ''}${pos.realizedPnl.toFixed(0)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Price Progress Track (SL -> Entry -> TP1 -> TP2) */}
                {!isPending && (
                  <div className="space-y-1" dir="ltr">
                    <div className="relative h-2 rounded-full bg-[#111827] border border-white/8 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-200 ${
                          pos.netPnl >= 0 ? 'bg-emerald-500/45' : 'bg-red-500/45'
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-[#E5BF70]"
                        style={{ left: `${entryPct}%` }}
                        title={`ورود $${pos.entry.toFixed(2)}`}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-emerald-300/80"
                        style={{ left: `${tp1Pct}%` }}
                        title={`TP1 $${pos.tp1.toFixed(2)}`}
                      />
                    </div>
                    <div className="flex items-center justify-between font-mono text-[9px] text-slate-500 tabular-nums">
                      <span>SL {pos.stopLoss.toFixed(2)}</span>
                      <span>ENT {pos.entry.toFixed(2)}</span>
                      <span>TP1 {pos.tp1.toFixed(2)}</span>
                      <span>TP2 {pos.tp2.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Broker Financial Telemetry (Margin, Comm, MFE, MAE) */}
                <div className="grid grid-cols-4 gap-1.5 px-2 py-1.5 rounded bg-[#111827] border border-white/6 text-[10px] tabular-nums">
                  <div>
                    <span className="text-slate-500 block">مارجین</span>
                    <span className="text-slate-200 font-mono" dir="ltr">${pos.marginUsed.toFixed(0)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">کمیسیون/سواپ</span>
                    <span className="text-slate-300 font-mono" dir="ltr">
                      ${(pos.commissionPaid + pos.swapAccrued).toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-mono">MFE</span>
                    <span className="text-emerald-400 font-mono" dir="ltr">+${pos.mfeUsd.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block font-mono">MAE</span>
                    <span className="text-red-400 font-mono" dir="ltr">${pos.maeUsd.toFixed(1)}</span>
                  </div>
                </div>

                {/* Inline Live SL / TP Editor */}
                {isEditing && (
                  <div className="rounded bg-[#111827] border border-[#D4A853]/35 p-2.5 space-y-2 text-[11px]">
                    <div className="grid grid-cols-3 gap-2">
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400">حد ضرر (SL)</span>
                        <input
                          type="number"
                          step="0.1"
                          value={editSl}
                          onChange={(e) => setEditSl(e.target.value)}
                          dir="ltr"
                          className="w-full px-2 py-1 rounded bg-[#0B0F17] border border-white/10 font-mono text-slate-100 tabular-nums"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400 font-mono">TP1</span>
                        <input
                          type="number"
                          step="0.1"
                          value={editTp1}
                          onChange={(e) => setEditTp1(e.target.value)}
                          dir="ltr"
                          className="w-full px-2 py-1 rounded bg-[#0B0F17] border border-white/10 font-mono text-slate-100 tabular-nums"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] text-slate-400 font-mono">TP2</span>
                        <input
                          type="number"
                          step="0.1"
                          value={editTp2}
                          onChange={(e) => setEditTp2(e.target.value)}
                          dir="ltr"
                          className="w-full px-2 py-1 rounded bg-[#0B0F17] border border-white/10 font-mono text-slate-100 tabular-nums"
                        />
                      </label>
                    </div>
                    {editError && <p className="text-red-300 text-[10px]">{editError}</p>}
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-1 rounded border border-white/10 text-slate-400 hover:text-slate-200"
                      >
                        انصراف
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEditor(pos.id)}
                        className="px-2.5 py-1 rounded bg-[#D4A853] text-slate-950 font-semibold hover:bg-[#e1b968]"
                      >
                        اعمال سطوح
                      </button>
                    </div>
                  </div>
                )}

                {/* Ongoing Payam Agent Management Brief */}
                <div className="rounded bg-[#111827]/90 border border-white/6 p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="inline-flex items-center gap-1 text-[#E5BF70] font-semibold">
                      {pos.urgency === 'CRITICAL' ? (
                        <AlertTriangle className="w-3 h-3 text-red-400" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      )}
                      {formatActionTagFa(pos.actionTag)}
                    </span>
                    {pos.trailingStopDistance && (
                      <span className="text-emerald-300">
                        تریل <span className="font-mono" dir="ltr">${pos.trailingStopDistance.toFixed(2)}</span>
                      </span>
                    )}
                  </div>
                  <p className="font-fa text-[11px] text-slate-200 leading-relaxed">
                    {pos.adviceFa || pos.adviceEn}
                  </p>
                </div>

                {/* Broker Execution Controls */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1">
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

                    {!isPending && (
                      <>
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
                          onClick={() => toggleTrailingStop(pos.id)}
                          aria-pressed={Boolean(pos.trailingStopDistance)}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded border transition-colors ${
                            pos.trailingStopDistance
                              ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200'
                              : 'border-white/10 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <TrendingUp className="w-3 h-3" />
                          تریل SL
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditor(pos)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-slate-300 hover:bg-white/5 transition-colors"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          ویرایش
                        </button>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {!isPending && pos.lotSize >= 0.02 && (
                      <button
                        type="button"
                        onClick={() => partialClosePosition(pos.id, 0.5)}
                        className="px-2 py-1 rounded border border-amber-400/35 text-amber-200 hover:bg-amber-500/15 transition-colors"
                      >
                        بستن ۵۰٪
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid={`payam-close-${pos.id}`}
                      onClick={() => partialClosePosition(pos.id, 1)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/35 text-red-300 hover:bg-red-500/15 transition-colors"
                    >
                      <XCircle className="w-3 h-3" />
                      {isPending ? 'لغو' : 'بستن'}
                    </button>
                  </div>
                </div>

                {/* Price Path Stress Simulator & Audit Log Toggle */}
                <div className="pt-1.5 border-t border-white/6 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-slate-500">شبیه‌ساز:</span>
                    {isPending ? (
                      <button
                        type="button"
                        onClick={() => simulateConfirmedPositionStep(pos.id, 'FILL_LIMIT')}
                        className="px-1.5 py-0.5 rounded border border-sky-400/35 text-sky-300 hover:bg-sky-500/10"
                      >
                        اجرای لیمیت
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => simulateConfirmedPositionStep(pos.id, 'HALF_TP1')}
                          className="px-1.5 py-0.5 rounded border border-white/10 text-slate-300 hover:bg-white/5"
                        >
                          ۵۰٪ تا TP1
                        </button>
                        <button
                          type="button"
                          onClick={() => simulateConfirmedPositionStep(pos.id, 'TP1')}
                          className="px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                        >
                          لمس TP1
                        </button>
                        <button
                          type="button"
                          onClick={() => simulateConfirmedPositionStep(pos.id, 'TP2')}
                          className="px-1.5 py-0.5 rounded border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/15"
                        >
                          لمس TP2
                        </button>
                        <button
                          type="button"
                          onClick={() => simulateConfirmedPositionStep(pos.id, 'SL')}
                          className="px-1.5 py-0.5 rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
                        >
                          لمس SL
                        </button>
                      </>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedLogId(isLogOpen ? null : pos.id)}
                    className="inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-200"
                  >
                    <span>گزارش اجرا ({pos.executionLog.length})</span>
                    {isLogOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>

                {isLogOpen && pos.executionLog.length > 0 && (
                  <div className="rounded bg-[#111827] border border-white/6 p-2 space-y-1 max-h-28 overflow-y-auto text-[10px] tabular-nums">
                    {pos.executionLog
                      .slice()
                      .reverse()
                      .map((ev) => (
                        <div key={ev.id} className="flex items-start justify-between gap-2 text-slate-400">
                          <span className="leading-snug">{ev.message}</span>
                          <span className="font-mono text-slate-500 shrink-0" dir="ltr">
                            {new Date(ev.timeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
