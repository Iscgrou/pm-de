import React, { useEffect, useRef } from 'react';
import { Database, RefreshCw, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { ChartSettings, ChartStyle } from '../engine/chartEngine';

interface ChartSettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  settings: ChartSettings;
  onUpdate: (partial: Partial<ChartSettings>) => void;
  onReset: () => void;
  onForceResync: () => void;
  candleSourceMeta: {
    source: string;
    calibratedToSpot: boolean;
    basisOffsetUsd: number;
    storageBackend: 'timescaledb' | 'memory';
    liveHistorical: boolean;
    hydrating: boolean;
  };
  barCount: number;
}

const STYLES: Array<{ id: ChartStyle; label: string }> = [
  { id: 'CANDLES', label: 'Candles' },
  { id: 'HOLLOW', label: 'Hollow' },
  { id: 'HEIKIN_ASHI', label: 'Heikin-Ashi' },
  { id: 'LINE', label: 'Line' },
];

export function ChartSettingsPopover({
  open,
  onClose,
  settings,
  onUpdate,
  onReset,
  onForceResync,
  candleSourceMeta,
  barCount,
}: ChartSettingsPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const timer = window.setTimeout(() => {
      window.addEventListener('mousedown', onClickOutside);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, onClose]);

  if (!open) return null;

  const ToggleRow = ({
    label,
    checked,
    onChange,
    accent,
  }: {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    accent?: string;
  }) => (
    <label className="flex items-center justify-between gap-2 py-1 px-1.5 rounded hover:bg-white/5 cursor-pointer text-[11px]">
      <span className="flex items-center gap-1.5 text-slate-300">
        {accent && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />}
        {label}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[#D4A853] w-3.5 h-3.5 rounded cursor-pointer"
      />
    </label>
  );

  return (
    <div
      ref={panelRef}
      dir="ltr"
      role="dialog"
      aria-label="Chart Display & Scalper Indicator Settings"
      data-testid="chart-settings-popover"
      className="absolute right-3 top-11 z-40 w-[320px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/15 bg-[#0F1624]/98 backdrop-blur-md shadow-2xl p-3 space-y-3 text-left"
    >
      <div className="flex items-center justify-between pb-2 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-100">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[#D4A853]" />
          <span>Chart &amp; Scalper Settings</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chart settings"
          className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-white/10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Candle Rendering Style */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Price Style</div>
        <div className="grid grid-cols-4 gap-1 bg-[#0B0F17] p-1 rounded border border-white/8">
          {STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => onUpdate({ chartStyle: st.id })}
              className={`px-1.5 py-1 rounded text-[10px] font-mono transition-colors ${
                settings.chartStyle === st.id
                  ? 'bg-[#D4A853] text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      {/* Institutional Scalper Indicators */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1 border-t border-white/8">
        <div className="col-span-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
          Indicators &amp; Sessions
        </div>
        <ToggleRow
          label="EMA 20"
          checked={settings.showEma20}
          onChange={(v) => onUpdate({ showEma20: v })}
          accent="#38bdf8"
        />
        <ToggleRow
          label="EMA 50"
          checked={settings.showEma50}
          onChange={(v) => onUpdate({ showEma50: v })}
          accent="#f59e0b"
        />
        <ToggleRow
          label="Session VWAP"
          checked={settings.showVwap}
          onChange={(v) => onUpdate({ showVwap: v })}
          accent="#c084fc"
        />
        <ToggleRow
          label="PDH / PDL"
          checked={settings.showPdhPdl}
          onChange={(v) => onUpdate({ showPdhPdl: v })}
          accent="#22d3ee"
        />
        <ToggleRow
          label="Killzones"
          checked={settings.showKillzones}
          onChange={(v) => onUpdate({ showKillzones: v })}
          accent="#818cf8"
        />
        <ToggleRow
          label="Volume Bars"
          checked={settings.showVolume}
          onChange={(v) => onUpdate({ showVolume: v })}
          accent="#10b981"
        />
      </div>

      {/* Execution & SMC Precision */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 pt-1 border-t border-white/8">
        <div className="col-span-2 text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-0.5">
          Execution &amp; SMC Display
        </div>
        <ToggleRow
          label="Bid/Ask Band"
          checked={settings.showBidAsk}
          onChange={(v) => onUpdate({ showBidAsk: v })}
        />
        <ToggleRow
          label="Bar Timer"
          checked={settings.showCountdown}
          onChange={(v) => onUpdate({ showCountdown: v })}
        />
        <ToggleRow
          label="Mitigated SMC"
          checked={settings.showMitigatedZones}
          onChange={(v) => onUpdate({ showMitigatedZones: v })}
        />
        <ToggleRow
          label="Zone Labels"
          checked={settings.showZoneLabels}
          onChange={(v) => onUpdate({ showZoneLabels: v })}
        />
        <ToggleRow
          label="All Positions"
          checked={settings.showAllPositions}
          onChange={(v) => onUpdate({ showAllPositions: v })}
        />
        <ToggleRow
          label="Pending Limits"
          checked={settings.showPendingLimits}
          onChange={(v) => onUpdate({ showPendingLimits: v })}
        />
        <div className="col-span-2">
          <ToggleRow
            label="Auto-Fit Include SL / TP2 Levels"
            checked={settings.autoFitIncludeLevels}
            onChange={(v) => onUpdate({ autoFitIncludeLevels: v })}
          />
        </div>
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-white/8 text-[11px] font-mono">
        <label className="space-y-1">
          <span className="text-[10px] text-slate-400 block">RSI Period ({settings.rsiPeriod})</span>
          <input
            type="range"
            min={5}
            max={34}
            value={settings.rsiPeriod}
            onChange={(e) => onUpdate({ rsiPeriod: Number(e.target.value) })}
            className="w-full accent-[#D4A853] cursor-pointer"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-slate-400 block">Right Margin ({settings.rightMarginBars} bars)</span>
          <input
            type="range"
            min={0}
            max={16}
            value={settings.rightMarginBars}
            onChange={(e) => onUpdate({ rightMarginBars: Number(e.target.value) })}
            className="w-full accent-[#D4A853] cursor-pointer"
          />
        </label>
      </div>

      {/* Data Feed & Storage Status */}
      <div className="rounded bg-[#0B0F17] border border-white/8 p-2 space-y-1 text-[10px] font-mono">
        <div className="flex items-center justify-between text-slate-300">
          <span className="flex items-center gap-1">
            <Database className="w-3 h-3 text-[#D4A853]" />
            Storage: {candleSourceMeta.storageBackend === 'timescaledb' ? 'TimescaleDB (PG16)' : 'Memory Ring Cache'}
          </span>
          <span className="text-emerald-400">{barCount} bars</span>
        </div>
        <div className="text-slate-400 truncate" title={candleSourceMeta.source}>
          Feed: {candleSourceMeta.source}
        </div>
        {candleSourceMeta.calibratedToSpot && (
          <div className="text-slate-500">
            Spot Basis Offset: {candleSourceMeta.basisOffsetUsd >= 0 ? '+' : ''}
            ${candleSourceMeta.basisOffsetUsd.toFixed(2)}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          onClick={onForceResync}
          disabled={candleSourceMeta.hydrating}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-mono bg-[#D4A853]/15 hover:bg-[#D4A853]/25 text-[#E5BF70] border border-[#D4A853]/35 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${candleSourceMeta.hydrating ? 'animate-spin' : ''}`} />
          Sync Live Bars
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-mono bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>
    </div>
  );
}
