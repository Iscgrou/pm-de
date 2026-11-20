import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shield, TrendingUp, TrendingDown, XCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { validateTradeGuardrails } from '../engine/smcQuant';

export function PositionCard() {
  const tick = useAurumStore((s) => s.tick);
  const quant = useAurumStore((s) => s.quant);
  const position = useAurumStore((s) => s.position);
  const pendingLimits = useAurumStore((s) => s.pendingLimits);
  const newsGate = useAurumStore((s) => s.newsGate);
  const lastGuardrailErrors = useAurumStore((s) => s.lastGuardrailErrors);
  const openPosition = useAurumStore((s) => s.openPosition);
  const closePosition = useAurumStore((s) => s.closePosition);
  const movePositionBreakEven = useAurumStore((s) => s.movePositionBreakEven);
  const simulatePositionStep = useAurumStore((s) => s.simulatePositionStep);

  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG');
  const [entry, setEntry] = useState(() => tick.last.toFixed(2));
  const [sl, setSl] = useState(() => (tick.last - 5.0).toFixed(2));
  const [tp1, setTp1] = useState(() => (tick.last + 10.0).toFixed(2));
  const [tp2, setTp2] = useState(() => (tick.last + 18.0).toFixed(2));
  const [lotSize, setLotSize] = useState('0.20');
  const userEditedRef = useRef(false);

  const syncPreset = (dir: 'LONG' | 'SHORT') => {
    userEditedRef.current = false;
    const p = tick.last;
    const step = Math.max(4.5, Number((quant.regime.atr * 1.1).toFixed(2)));
    setDirection(dir);
    setEntry(p.toFixed(2));
    if (dir === 'LONG') {
      setSl((p - step).toFixed(2));
      setTp1((p + step * 1.8).toFixed(2));
      setTp2((p + step * 3.0).toFixed(2));
    } else {
      setSl((p + step).toFixed(2));
      setTp1((p - step * 1.8).toFixed(2));
      setTp2((p - step * 3.0).toFixed(2));
    }
  };

  useEffect(() => {
    if (position || userEditedRef.current) return;
    const curEntry = Number(entry);
    if (!Number.isFinite(curEntry) || Math.abs(tick.last - curEntry) > 15) {
      const p = tick.last;
      const step = Math.max(4.5, Number((quant.regime.atr * 1.1).toFixed(2)));
      setEntry(p.toFixed(2));
      if (direction === 'LONG') {
        setSl((p - step).toFixed(2));
        setTp1((p + step * 1.8).toFixed(2));
        setTp2((p + step * 3.0).toFixed(2));
      } else {
        setSl((p + step).toFixed(2));
        setTp1((p - step * 1.8).toFixed(2));
        setTp2((p - step * 3.0).toFixed(2));
      }
    }
  }, [tick.last, position, direction, quant.regime.atr, entry]);

  const liveCheck = useMemo(() => {
    return validateTradeGuardrails(
      direction,
      Number(entry),
      Number(sl),
      Number(tp1),
      Number(tp2),
      quant.regime.atr
    );
  }, [direction, entry, sl, tp1, tp2, quant.regime.atr]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    openPosition({
      direction,
      entry: Number(entry),
      stopLoss: Number(sl),
      tp1: Number(tp1),
      tp2: Number(tp2),
      lotSize: Number(lotSize) || 0.1,
    });
  };

  return (
    <section
      aria-label="Position management and mathematical guardrails"
      className="rounded-lg border border-white/8 bg-[#111827] p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-slate-100">
          {position ? 'Active Position & HSM Defense' : 'Execution Ticket & Guardrails'}
        </h2>
        <div className="flex items-center gap-2 shrink-0">
          {!position && (
            <button
              type="button"
              onClick={() => syncPreset(direction)}
              title="Sync ticket levels to live spot price"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-white/10 text-[11px] font-mono text-slate-300 hover:text-[#E5BF70] hover:border-[#D4A853]/40 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Sync Spot
            </button>
          )}
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            Min R:R 1.50 · 0.25×ATR
          </span>
        </div>
      </div>

      {position ? (
        <div className="space-y-3" data-testid="active-position-card">
          <div className="flex items-baseline justify-between gap-2 pb-3 border-b border-white/8">
            <div className="flex items-center gap-2">
              {position.direction === 'LONG' ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-400" />
              )}
              <span className="font-mono font-semibold text-sm text-slate-100">
                {position.direction} {position.lotSize.toFixed(2)} lot
              </span>
              <span className="text-slate-500">·</span>
              <span className="font-mono text-xs text-[#E5BF70]" data-testid="hsm-stage">
                {position.stage}
              </span>
            </div>
            <span
              className={`font-mono text-base font-semibold tabular-nums ${
                position.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
              data-testid="position-pnl"
            >
              {position.unrealizedPnl >= 0 ? '+' : ''}${position.unrealizedPnl.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="text-slate-400">Entry</span>
              <span className="text-slate-100">{position.entry.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Active SL</span>
              <span className="text-red-400" data-testid="position-sl">{position.stopLoss.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">TP1 (Risk-Free)</span>
              <span className="text-emerald-400">{position.tp1.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">TP2 (Target)</span>
              <span className="text-emerald-300">{position.tp2.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">R:R Ratio</span>
              <span className="text-[#E5BF70]">1 : {position.rrRatio.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Partial Secured</span>
              <span className="text-slate-200">{position.realizedPartial ? 'Yes (50%)' : 'No'}</span>
            </div>
          </div>

          {/* HSM Interactive Progression Controls */}
          <div className="pt-2 border-t border-white/8 space-y-2">
            <p className="text-[11px] text-slate-400">HSM State Machine Controls</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => simulatePositionStep('HALF_TP1')}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-white/10 text-slate-200 hover:bg-white/6 transition-colors whitespace-nowrap"
              >
                Step 50% TP1 (BE Arm)
              </button>
              <button
                type="button"
                onClick={() => simulatePositionStep('TP1')}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 transition-colors whitespace-nowrap"
              >
                Touch TP1 (Risk-Free)
              </button>
              <button
                type="button"
                onClick={movePositionBreakEven}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-[#D4A853]/30 text-[#E5BF70] hover:bg-[#D4A853]/10 transition-colors whitespace-nowrap"
              >
                Lock Break-Even SL
              </button>
              <button
                type="button"
                onClick={closePosition}
                className="px-2.5 py-1.5 text-xs font-medium rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 transition-colors whitespace-nowrap"
              >
                Close Position
              </button>
            </div>
          </div>

          {position.history.length > 0 && (
            <div className="pt-2 border-t border-white/8 space-y-1 max-h-24 overflow-y-auto">
              {position.history.slice(-3).map((h, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                  <span className="truncate">{h.event}</span>
                  <span>${h.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3" data-testid="position-form">
          <div className="grid grid-cols-2 gap-1.5 p-0.5 rounded-md bg-[#0B0F17] border border-white/8">
            <button
              type="button"
              onClick={() => syncPreset('LONG')}
              className={`py-1.5 text-xs font-medium rounded transition-colors ${
                direction === 'LONG'
                  ? 'bg-emerald-600/25 text-emerald-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              LONG (Buy)
            </button>
            <button
              type="button"
              onClick={() => syncPreset('SHORT')}
              className={`py-1.5 text-xs font-medium rounded transition-colors ${
                direction === 'SHORT'
                  ? 'bg-red-600/25 text-red-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              SHORT (Sell)
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">Entry Price</span>
              <input
                type="number"
                step="0.01"
                value={entry}
                onChange={(e) => {
                  userEditedRef.current = true;
                  setEntry(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/10 font-mono text-xs text-slate-100 tabular-nums focus:outline-none focus:border-[#D4A853]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">Stop Loss (SL)</span>
              <input
                type="number"
                step="0.01"
                value={sl}
                onChange={(e) => {
                  userEditedRef.current = true;
                  setSl(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/10 font-mono text-xs text-slate-100 tabular-nums focus:outline-none focus:border-[#D4A853]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">TP1 (Risk-Free)</span>
              <input
                type="number"
                step="0.01"
                value={tp1}
                onChange={(e) => {
                  userEditedRef.current = true;
                  setTp1(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/10 font-mono text-xs text-slate-100 tabular-nums focus:outline-none focus:border-[#D4A853]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-400">TP2 (Final)</span>
              <input
                type="number"
                step="0.01"
                value={tp2}
                onChange={(e) => {
                  userEditedRef.current = true;
                  setTp2(e.target.value);
                }}
                className="w-full px-2.5 py-1.5 rounded bg-[#0B0F17] border border-white/10 font-mono text-xs text-slate-100 tabular-nums focus:outline-none focus:border-[#D4A853]"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <span>Lot</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={lotSize}
                onChange={(e) => setLotSize(e.target.value)}
                className="w-20 px-2 py-1 rounded bg-[#0B0F17] border border-white/10 font-mono text-xs text-slate-100 tabular-nums"
              />
            </label>
            <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums">
              {liveCheck.valid ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className={liveCheck.valid ? 'text-emerald-400' : 'text-red-400'}>
                R:R {liveCheck.rrRatio.toFixed(2)}
              </span>
            </div>
          </div>

          {(!liveCheck.valid || lastGuardrailErrors.length > 0) && (
            <div
              role="alert"
              data-testid="guardrail-errors"
              className="p-2.5 rounded bg-red-950/30 border border-red-500/30 text-xs text-red-300 space-y-1"
            >
              {(lastGuardrailErrors.length > 0 ? lastGuardrailErrors : liveCheck.errors).map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 px-4 rounded-md text-xs font-semibold bg-[#D4A853] text-slate-950 hover:bg-[#e1b968] transition-colors flex items-center justify-center gap-2"
          >
            <Shield className="w-3.5 h-3.5" />
            {newsGate.state === 'LOCKOUT'
              ? 'Validate (News Lockout Active)'
              : `Open ${direction} Position`}
          </button>
        </form>
      )}

      {/* Pending Limit Orders List */}
      <div className="pt-3 border-t border-white/8 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span>Pending Limit Queue</span>
          <span className="font-mono tabular-nums">
            {pendingLimits.filter((l) => l.status === 'PENDING_ENTRY').length} active
          </span>
        </div>
        {pendingLimits.slice(0, 2).map((lim) => (
          <div key={lim.id} className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-300">
            <span>
              {lim.id} · {lim.direction} @ {lim.entry.toFixed(2)}
            </span>
            <span className={lim.status === 'PENDING_ENTRY' ? 'text-amber-300' : 'text-red-400'}>
              {lim.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
