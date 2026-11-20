import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { analyzeQuantSnapshot } from '../engine/smcQuant';
import type { Candle, Timeframe } from '../engine/types';

const VECTOR_TFS: Timeframe[] = ['M5', 'M15', 'H1', 'H4'];

function MiniVectorChart({ tf, candles }: { tf: Timeframe; candles: Candle[] }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const candlesByTf = useAurumStore((s) => s.candlesByTf);
  const quant = useMemo(() => analyzeQuantSnapshot(tf, candlesByTf), [tf, candlesByTf]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || candles.length === 0) return;
    const w = 520;
    const h = 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const slice = candles.slice(-60);
    let minP = Math.min(...slice.map((c) => c.low));
    let maxP = Math.max(...slice.map((c) => c.high));
    const pad = Math.max(0.8, (maxP - minP) * 0.14);
    minP -= pad;
    maxP += pad;

    const leftPad = 10;
    const rightEdge = w - 62;
    const firstTime = slice[0].time;
    const lastTime = slice[slice.length - 1].time;
    const p2y = (p: number) => 16 + ((maxP - p) / (maxP - minP)) * (h - 32);
    const step = (rightEdge - leftPad) / Math.max(1, slice.length);
    const idx2x = (i: number) => leftPad + i * step + step * 0.5;
    const time2x = (t: number): number | null => {
      if (t > lastTime) return null;
      if (t < firstTime) return leftPad;
      const idx = slice.findIndex((c) => c.time >= t);
      return idx === -1 ? null : idx2x(idx);
    };
    const spanFor = (startTime: number, mitigatedTime?: number): { x0: number; x1: number } | null => {
      if (startTime > lastTime) return null;
      if (mitigatedTime !== undefined && mitigatedTime < firstTime) return null;
      const x0 = startTime < firstTime ? leftPad : (time2x(startTime) ?? leftPad);
      const x1 =
        mitigatedTime !== undefined && mitigatedTime <= lastTime
          ? Math.max(x0 + 4, time2x(mitigatedTime) ?? rightEdge)
          : rightEdge;
      return { x0, x1: Math.min(rightEdge, x1) };
    };

    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, w, h);

    // Clip plot area strictly inside [leftPad, rightEdge]
    ctx.save();
    ctx.beginPath();
    ctx.rect(leftPad, 8, rightEdge - leftPad, h - 16);
    ctx.clip();

    // Draw FVG zones chronologically Left -> Right
    for (const fvg of quant.fvgs) {
      const sp = spanFor(fvg.startTime, fvg.mitigated ? fvg.mitigatedTime : undefined);
      if (!sp) continue;
      const isBull = fvg.direction === 'BULLISH';
      ctx.fillStyle = isBull
        ? fvg.mitigated
          ? 'rgba(212, 168, 83, 0.05)'
          : 'rgba(212, 168, 83, 0.16)'
        : fvg.mitigated
          ? 'rgba(251, 146, 60, 0.05)'
          : 'rgba(251, 146, 60, 0.16)';
      ctx.fillRect(sp.x0, p2y(fvg.top), Math.max(3, sp.x1 - sp.x0), Math.max(2, p2y(fvg.bottom) - p2y(fvg.top)));
    }

    // Draw OB zones chronologically Left -> Right
    for (const ob of quant.orderBlocks) {
      const sp = spanFor(ob.startTime, ob.mitigated ? ob.mitigatedTime : undefined);
      if (!sp) continue;
      ctx.fillStyle =
        ob.direction === 'BULLISH'
          ? ob.mitigated
            ? 'rgba(16, 185, 129, 0.05)'
            : 'rgba(16, 185, 129, 0.15)'
          : ob.mitigated
            ? 'rgba(239, 68, 68, 0.05)'
            : 'rgba(239, 68, 68, 0.15)';
      ctx.fillRect(sp.x0, p2y(ob.high), Math.max(3, sp.x1 - sp.x0), Math.max(2, p2y(ob.low) - p2y(ob.high)));
    }

    // Vector candlesticks (strictly Left -> Right)
    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      const x = idx2x(i);
      const bull = c.close >= c.open;
      ctx.strokeStyle = bull ? '#10B981' : '#EF4444';
      ctx.beginPath();
      ctx.moveTo(x, p2y(c.high));
      ctx.lineTo(x, p2y(c.low));
      ctx.stroke();

      ctx.fillStyle = bull ? '#10B981' : '#EF4444';
      const top = Math.min(p2y(c.open), p2y(c.close));
      const bh = Math.max(1.5, Math.abs(p2y(c.close) - p2y(c.open)));
      ctx.fillRect(x - Math.max(1.5, step * 0.3), top, Math.max(3, step * 0.6), bh);
    }

    // BOS / CHoCH markers (Left swingTime -> Right breakout time)
    for (const st of quant.structures.slice(-4)) {
      if (st.time < firstTime || st.swingTime > lastTime) continue;
      const x0 = st.swingTime < firstTime ? leftPad : (time2x(st.swingTime) ?? leftPad);
      const x1 = st.time > lastTime ? rightEdge : (time2x(st.time) ?? rightEdge);
      if (x1 <= x0 + 2) continue;
      const y = p2y(st.level);
      ctx.strokeStyle = st.direction === 'BULLISH' ? '#34d399' : '#f87171';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }

    ctx.restore();

    // Divider + Price scale right edge (strictly LTR)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(rightEdge + 0.5, 8);
    ctx.lineTo(rightEdge + 0.5, h - 8);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillText(maxP.toFixed(1), rightEdge + 6, 22);
    ctx.fillStyle = '#E5BF70';
    ctx.fillText(slice[slice.length - 1].close.toFixed(1), rightEdge + 6, h / 2 + 3);
    ctx.fillStyle = '#64748b';
    ctx.fillText(minP.toFixed(1), rightEdge + 6, h - 14);
  }, [candles, quant]);

  return (
    <div dir="ltr" className="rounded-lg border border-white/8 bg-[#0B0F17] p-3 space-y-2">
      <div className="flex items-center justify-between text-xs font-mono tabular-nums">
        <span className="font-semibold text-slate-100">XAUUSD · {tf}</span>
        <span className="text-slate-400">
          {quant.regime.label.replace(/_/g, ' ')} · {quant.fvgs.length} FVG · {quant.orderBlocks.length} OB
        </span>
      </div>
      <canvas ref={ref} className="w-full h-[190px] rounded block" />
    </div>
  );
}

export function VectorViewModal() {
  const open = useAurumStore((s) => s.vectorModalOpen);
  const setOpen = useAurumStore((s) => s.setVectorModalOpen);
  const candlesByTf = useAurumStore((s) => s.candlesByTf);
  const quant = useAurumStore((s) => s.quant);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      dir="ltr"
      role="dialog"
      aria-modal="true"
      aria-label="Institutional SMC Vector Setup"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 lg:p-8"
    >
      <div className="w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-lg border border-white/12 bg-[#111827] p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/8">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Institutional SMC Multi-Timeframe Vector Setup
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
              Synchronized M5 / M15 / H1 / H4 structural vectors · TPI Composite{' '}
              {quant.tpi.compositeScore >= 0 ? '+' : ''}
              {quant.tpi.compositeScore.toFixed(2)} · TFS Bias {quant.tfs.bias}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close vector setup modal"
            className="p-2 rounded border border-white/10 text-slate-400 hover:text-slate-100 hover:bg-white/6"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {VECTOR_TFS.map((tf) => (
            <MiniVectorChart key={tf} tf={tf} candles={candlesByTf[tf]} />
          ))}
        </div>
      </div>
    </div>
  );
}
