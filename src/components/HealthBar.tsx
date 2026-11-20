import { Pause, Play, RefreshCw } from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import { formatNewsGateFa, formatRegimeFa } from '../engine/i18nFa';

export function HealthBar() {
  const tick = useAurumStore((s) => s.tick);
  const feedMode = useAurumStore((s) => s.feedMode);
  const quant = useAurumStore((s) => s.quant);
  const pipeline = useAurumStore((s) => s.pipeline);
  const newsGate = useAurumStore((s) => s.newsGate);
  const streaming = useAurumStore((s) => s.streaming);
  const toggleStreaming = useAurumStore((s) => s.toggleStreaming);
  const restoreTier1 = useAurumStore((s) => s.restoreTier1);

  const gateTone =
    newsGate.state === 'LOCKOUT'
      ? 'text-red-400'
      : newsGate.state === 'CAUTION'
        ? 'text-amber-400'
        : 'text-emerald-400';

  const regimeLabel = formatRegimeFa(quant.regime.label);

  return (
    <section
      aria-label="تله‌متری زنده بازار"
      className="border-b border-white/8 bg-[#0E1420] px-4 lg:px-6 py-2"
    >
      <div className="max-w-[1600px] mx-auto flex flex-wrap xl:flex-nowrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <div className="flex flex-wrap xl:flex-nowrap items-center gap-x-3.5 gap-y-1 min-w-0">
          <div className="flex items-baseline gap-2 shrink-0" dir="ltr">
            <span className="font-mono font-semibold text-slate-200">XAUUSD</span>
            <span className="font-mono text-sm font-semibold text-[#E5BF70] tabular-nums" data-testid="spot-price">
              {tick.last.toFixed(2)}
            </span>
            <span className="font-mono text-slate-400 tabular-nums whitespace-nowrap">
              {tick.bid.toFixed(2)} / {tick.ask.toFixed(2)}
            </span>
          </div>
          <span className="text-slate-400 tabular-nums whitespace-nowrap">
            اسپرد{' '}
            <span className="font-mono text-slate-300" dir="ltr">
              {tick.spread.toFixed(2)}
            </span>
          </span>

          <span className="hidden xl:inline text-white/15 shrink-0" aria-hidden="true">|</span>

          <div className="flex flex-wrap xl:flex-nowrap items-center gap-x-2.5 text-slate-400 tabular-nums whitespace-nowrap overflow-hidden">
            <span className={feedMode === 'LIVE_INTERBANK' ? 'text-emerald-300 font-medium' : 'text-slate-300'}>
              <span className="font-mono" dir="ltr">
                T{pipeline.activeTier} · {pipeline.sourceName}
              </span>{' '}
              {feedMode === 'LIVE_INTERBANK' ? '(زنده)' : '(شبیه‌ساز)'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">TTL {pipeline.ttlMs}ms</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">P99 {pipeline.loopLagP99Ms.toFixed(2)}ms</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono" dir="ltr">ATR {quant.regime.atr.toFixed(2)}</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-200 font-medium">{regimeLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-slate-400">گیت خبر:</span>
            <span className={`font-semibold ${gateTone}`} data-testid="news-gate-state">
              {formatNewsGateFa(newsGate.state)}
            </span>
          </div>

          {pipeline.activeTier !== 1 && (
            <button
              type="button"
              onClick={restoreTier1}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-amber-300 border border-amber-500/30 hover:bg-amber-500/10 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              بازیابی لایه ۱
            </button>
          )}

          <button
            type="button"
            onClick={toggleStreaming}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-200 border border-white/10 hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
            aria-label={streaming ? 'توقف جریان زنده قیمت' : 'ادامه جریان زنده قیمت'}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${streaming ? 'bg-emerald-400' : 'bg-slate-500'}`}
              aria-hidden="true"
            />
            {streaming ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{streaming ? 'جریان زنده' : 'متوقف'}</span>
          </button>
        </div>
      </div>
    </section>
  );
}
