import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightToLine,
  Compass,
  Layers,
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAurumStore } from '../store/useStore';
import type { Candle, ConfirmedPosition, Position, Timeframe } from '../engine/types';
import { computeEmaSeries, computeWilderRsiSeries } from '../engine/payamBrain';
import {
  DEFAULT_CHART_SETTINGS,
  computePreviousDayLevels,
  computeRulerMetrics,
  computeSessionVwap,
  computeZoneSpanX,
  formatAxisTimestamp,
  formatCandleCountdown,
  formatFullUtcTimestamp,
  getKillzoneForTimestamp,
  loadChartSettings,
  resolveLabelCollisions,
  sanitizeChartSettings,
  saveChartSettings,
  toHeikinAshiCandles,
  type ChartSettings,
} from '../engine/chartEngine';
import { ChartSettingsPopover } from './ChartSettingsPopover';
import { AgentNeuralHud } from './AgentNeuralHud';

const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];

interface SessionLiquidityLevels {
  asianHigh: number | null;
  asianLow: number | null;
  londonHigh: number | null;
  londonLow: number | null;
  nyHigh: number | null;
  nyLow: number | null;
}

function computeSessionLiquidityLevels(candles: Candle[]): SessionLiquidityLevels {
  const res: SessionLiquidityLevels = {
    asianHigh: null,
    asianLow: null,
    londonHigh: null,
    londonLow: null,
    nyHigh: null,
    nyLow: null,
  };
  if (candles.length < 4) return res;
  const latestDay = Math.floor(candles[candles.length - 1].time / 86400);
  // Look over current UTC day (or prior day if early Asian session has no London/NY bars yet)
  const updateRange = (
    hiKey: 'asianHigh' | 'londonHigh' | 'nyHigh',
    loKey: 'asianLow' | 'londonLow' | 'nyLow',
    c: Candle
  ) => {
    res[hiKey] = res[hiKey] === null ? c.high : Math.max(res[hiKey]!, c.high);
    res[loKey] = res[loKey] === null ? c.low : Math.min(res[loKey]!, c.low);
  };

  for (const c of candles) {
    const day = Math.floor(c.time / 86400);
    if (day < latestDay - 1) continue;
    const hr = new Date(c.time * 1000).getUTCHours();
    if (day === latestDay) {
      if (hr >= 0 && hr < 5) updateRange('asianHigh', 'asianLow', c);
      else if (hr >= 7 && hr < 12) updateRange('londonHigh', 'londonLow', c);
      else if (hr >= 12 && hr < 17) updateRange('nyHigh', 'nyLow', c);
    }
  }
  // If today hasn't reached London or NY yet, seed from previous session for liquidity draw targets
  if (res.londonHigh === null || res.nyHigh === null) {
    for (const c of candles) {
      const day = Math.floor(c.time / 86400);
      if (day !== latestDay - 1) continue;
      const hr = new Date(c.time * 1000).getUTCHours();
      if (res.londonHigh === null && hr >= 7 && hr < 12) updateRange('londonHigh', 'londonLow', c);
      if (res.nyHigh === null && hr >= 12 && hr < 17) updateRange('nyHigh', 'nyLow', c);
    }
  }
  return res;
}

interface ChartGeometryRef {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  chartW: number;
  chartH: number;
  rsiTop: number;
  rsiPaneH: number;
  showRsiPane: boolean;
  minP: number;
  maxP: number;
  stepX: number;
  totalSlots: number;
  visibleCount: number;
}

interface RulerAnchor {
  idx: number;
  price: number;
}

export function SmcChart() {
  const timeframe = useAurumStore((s) => s.timeframe);
  const candlesByTf = useAurumStore((s) => s.candlesByTf);
  const quant = useAurumStore((s) => s.quant);
  const tick = useAurumStore((s) => s.tick);
  const manualPosition = useAurumStore((s) => s.position);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);
  const pendingLimits = useAurumStore((s) => s.pendingLimits);
  const focusedPositionId = useAurumStore((s) => s.focusedPositionId);
  const candleSourceMeta = useAurumStore((s) => s.candleSourceMeta);
  const layers = useAurumStore((s) => s.layers);
  const streaming = useAurumStore((s) => s.streaming);
  const agentEnabled = useAurumStore((s) => s.agentEnabled);
  const agentBusy = useAurumStore((s) => s.agentBusy);
  const proposals = useAurumStore((s) => s.proposals);
  const setTimeframe = useAurumStore((s) => s.setTimeframe);
  const toggleLayer = useAurumStore((s) => s.toggleLayer);
  const toggleStreaming = useAurumStore((s) => s.toggleStreaming);
  const setVectorModalOpen = useAurumStore((s) => s.setVectorModalOpen);
  const hydrateRealCandles = useAurumStore((s) => s.hydrateRealCandles);

  const focusedPosition =
    confirmedPositions.find((p) => p.id === focusedPositionId) ?? manualPosition ?? confirmedPositions[0] ?? null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const geomRef = useRef<ChartGeometryRef | null>(null);
  const canvasSizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 0 });
  const hoverStateRef = useRef<{ x: number; y: number; idx: number | null } | null>(null);
  const rafOverlayRef = useRef<number | null>(null);

  const [settings, setSettings] = useState<ChartSettings>(() => loadChartSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hudEnabled, setHudEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [rulerMode, setRulerMode] = useState(false);
  const [rulerStart, setRulerStart] = useState<RulerAnchor | null>(null);
  const [rulerEnd, setRulerEnd] = useState<RulerAnchor | null>(null);

  const [visibleCount, setVisibleCount] = useState(84);
  const [panOffset, setPanOffset] = useState(0);
  const [yScaleFactor, setYScaleFactor] = useState(1.0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 920, height: 540 });
  const [nowMs, setNowMs] = useState(() => Date.now());

  const dragRef = useRef<{
    mode: 'NONE' | 'PAN' | 'Y_SCALE' | 'RULER';
    startX: number;
    startY: number;
    startPan: number;
    startYScale: number;
  }>({
    mode: 'NONE',
    startX: 0,
    startY: 0,
    startPan: 0,
    startYScale: 1,
  });

  const rawCandles = candlesByTf[timeframe] ?? [];

  // 1-second candle countdown heartbeat (pauses cleanly when live stream is paused)
  useEffect(() => {
    if (!settings.showCountdown || !streaming) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [settings.showCountdown, streaming]);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const updateSettings = useCallback((partial: Partial<ChartSettings>) => {
    setSettings((prev) => {
      const next = sanitizeChartSettings(partial, prev);
      saveChartSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    const next = { ...DEFAULT_CHART_SETTINGS };
    saveChartSettings(next);
    setSettings(next);
    setYScaleFactor(1.0);
  }, []);

  // Measure chart viewport container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        const h = Math.max(fullscreen ? 520 : 480, Math.floor(entry.contentRect.height));
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fullscreen]);

  // Precompute indicator series once per candle/settings change (never on mouse hover!)
  const indicatorSeries = useMemo(() => {
    const displayCandles =
      settings.chartStyle === 'HEIKIN_ASHI' ? toHeikinAshiCandles(rawCandles) : rawCandles;
    const closes = rawCandles.map((c) => c.close);
    const ema20 = settings.showEma20 ? computeEmaSeries(closes, 20) : [];
    const ema50 = settings.showEma50 ? computeEmaSeries(closes, 50) : [];
    const vwap = settings.showVwap ? computeSessionVwap(rawCandles) : [];
    const prevDay = settings.showPdhPdl ? computePreviousDayLevels(rawCandles) : null;
    const sessionLevels = computeSessionLiquidityLevels(rawCandles);
    const rsiFull =
      settings.rsiPeriod === 14 && quant.rsi.activeSeries.length === rawCandles.length
        ? quant.rsi.activeSeries
        : computeWilderRsiSeries(rawCandles, settings.rsiPeriod);

    return { displayCandles, ema20, ema50, vwap, prevDay, sessionLevels, rsiFull };
  }, [
    rawCandles,
    settings.chartStyle,
    settings.showEma20,
    settings.showEma50,
    settings.showVwap,
    settings.showPdhPdl,
    settings.rsiPeriod,
    quant.rsi.activeSeries,
  ]);

  const maxPan = Math.max(0, rawCandles.length - Math.min(visibleCount, rawCandles.length));
  const clampedPan = Math.max(0, Math.min(maxPan, panOffset));

  const visibleData = useMemo(() => {
    const len = rawCandles.length;
    const effCount = Math.min(visibleCount, Math.max(1, len));
    const end = Math.max(effCount, len - clampedPan);
    const start = Math.max(0, end - effCount);
    return {
      startIdx: start,
      raw: rawCandles.slice(start, end),
      display: indicatorSeries.displayCandles.slice(start, end),
      ema20: indicatorSeries.ema20.slice(start, end),
      ema50: indicatorSeries.ema50.slice(start, end),
      vwap: indicatorSeries.vwap.slice(start, end),
      rsi: indicatorSeries.rsiFull.slice(start, end),
    };
  }, [rawCandles, indicatorSeries, visibleCount, clampedPan]);

  const visibleRaw = visibleData.raw;
  const visibleDisplay = visibleData.display;
  const visibleRsi = visibleData.rsi;

  // Hovered candle readout (falls back to latest bar)
  const activeIdx =
    hoverIdx !== null && visibleRaw[hoverIdx] ? hoverIdx : Math.max(0, visibleRaw.length - 1);
  const hoveredCandle = visibleRaw[activeIdx];
  const hoveredGlobalIdx = visibleData.startIdx + activeIdx;
  const hoveredRsi =
    hoveredGlobalIdx >= settings.rsiPeriod && Number.isFinite(visibleRsi[activeIdx])
      ? visibleRsi[activeIdx]
      : quant.rsi.active.value;
  const hoveredEma20 = visibleData.ema20[activeIdx];
  const hoveredEma50 = visibleData.ema50[activeIdx];
  const hoveredVwap = visibleData.vwap[activeIdx];

  // Collect positions to render
  const positionsToDraw = useMemo<Array<Position | ConfirmedPosition>>(() => {
    if (!settings.showAllPositions) {
      return focusedPosition ? [focusedPosition] : [];
    }
    const list: Array<Position | ConfirmedPosition> = [];
    for (const p of confirmedPositions) {
      if (p.status === 'ACTIVE' || p.status === 'PENDING_LIMIT') list.push(p);
    }
    if (manualPosition && !list.some((x) => x.id === manualPosition.id)) {
      list.push(manualPosition);
    }
    return list;
  }, [settings.showAllPositions, focusedPosition, confirmedPositions, manualPosition]);

  // Native non-passive wheel zoom anchored to cursor X
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const geom = geomRef.current;
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const relRatio = geom
        ? Math.max(0, Math.min(1, (mouseX - geom.padLeft) / Math.max(1, geom.chartW)))
        : 0.75;

      setVisibleCount((prevCount) => {
        const delta = e.deltaY > 0 ? Math.max(4, Math.round(prevCount * 0.14)) : -Math.max(4, Math.round(prevCount * 0.14));
        const maxBars = Math.max(60, Math.min(260, rawCandles.length));
        const nextCount = Math.max(22, Math.min(maxBars, prevCount + delta));
        const countDiff = nextCount - prevCount;
        if (countDiff !== 0) {
          setPanOffset((prevPan) => {
            const anchorShift = Math.round(countDiff * (1 - relRatio));
            const nextMaxPan = Math.max(0, rawCandles.length - Math.min(nextCount, rawCandles.length));
            return Math.max(0, Math.min(nextMaxPan, prevPan - anchorShift));
          });
        }
        return nextCount;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [rawCandles.length]);

  // Global mouseup to prevent stuck drag outside canvas
  useEffect(() => {
    const onWinUp = () => {
      if (dragRef.current.mode === 'RULER') {
        dragRef.current.mode = 'NONE';
      } else if (dragRef.current.mode !== 'NONE') {
        dragRef.current.mode = 'NONE';
      }
    };
    window.addEventListener('mouseup', onWinUp);
    return () => window.removeEventListener('mouseup', onWinUp);
  }, []);

  // =========================================================================
  // LAYER 1: BASE CANVAS RENDER (Data, SMC, Indicators, Positions, RSI)
  // Does NOT depend on hoverIdx -> zero lag on mouse move!
  // =========================================================================
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!canvas || visibleRaw.length === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = size;

    // Resize canvas backing buffers ONLY when dimensions or DPR actually changed
    if (
      canvasSizeRef.current.w !== width ||
      canvasSizeRef.current.h !== height ||
      canvasSizeRef.current.dpr !== dpr
    ) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (overlay) {
        overlay.width = Math.floor(width * dpr);
        overlay.height = Math.floor(height * dpr);
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
      }
      canvasSizeRef.current = { w: width, h: height, dpr };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // CRITICAL P0 FIX: Enforce explicit LTR text geometry regardless of <html dir="rtl">
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const padLeft = 10;
    const padRight = 82;
    const padTop = 18;
    const padBottom = 26;
    const showRsiPane = Boolean(layers.rsi) && visibleRsi.length > 0;
    const rsiPaneH = showRsiPane ? 90 : 0;
    const paneGap = showRsiPane ? 10 : 0;
    const chartW = Math.max(120, width - padLeft - padRight);
    const plotRight = padLeft + chartW;
    const chartH = Math.max(220, height - padTop - padBottom - rsiPaneH - paneGap);
    const rsiTop = padTop + chartH + paneGap;

    // Background fill
    ctx.fillStyle = '#0B0F17';
    ctx.fillRect(0, 0, width, height);

    // Price scale domain (candles-only by default so M1/M5 never squash; optional include SL/TP2)
    let minP = Infinity;
    let maxP = -Infinity;
    for (const c of visibleDisplay) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    if (clampedPan === 0 && Number.isFinite(tick.last) && tick.last > 0) {
      minP = Math.min(minP, tick.bid || tick.last);
      maxP = Math.max(maxP, tick.ask || tick.last);
    }
    if (settings.autoFitIncludeLevels && focusedPosition) {
      minP = Math.min(minP, focusedPosition.stopLoss, focusedPosition.entry, focusedPosition.tp1, focusedPosition.tp2);
      maxP = Math.max(maxP, focusedPosition.stopLoss, focusedPosition.entry, focusedPosition.tp1, focusedPosition.tp2);
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || maxP <= minP) {
      minP = (tick.last || 3500) - 10;
      maxP = (tick.last || 3500) + 10;
    }

    const baseSpan = Math.max(1.2, maxP - minP);
    const midP = (minP + maxP) / 2;
    const scaledSpan = (baseSpan * 1.2) / Math.max(0.25, Math.min(4.0, yScaleFactor));
    minP = midP - scaledSpan / 2;
    maxP = midP + scaledSpan / 2;

    const rightMarginSlots = clampedPan === 0 ? settings.rightMarginBars : 0;
    const totalSlots = Math.max(1, visibleRaw.length + rightMarginSlots);
    const stepX = chartW / totalSlots;

    const priceToY = (p: number) => padTop + ((maxP - p) / (maxP - minP)) * chartH;
    const indexToX = (i: number) => padLeft + i * stepX + stepX * 0.5;
    const firstVisibleTime = visibleRaw[0].time;
    const lastVisibleTime = visibleRaw[visibleRaw.length - 1].time;

    const timeToX = (t: number): number | null => {
      if (t > lastVisibleTime) return null;
      if (t < firstVisibleTime) return padLeft;
      const idx = visibleRaw.findIndex((c) => c.time >= t);
      return idx === -1 ? null : indexToX(idx);
    };

    geomRef.current = {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      chartW,
      chartH,
      rsiTop,
      rsiPaneH,
      showRsiPane,
      minP,
      maxP,
      stepX,
      totalSlots,
      visibleCount: visibleRaw.length,
    };

    // Subtle right-axis divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotRight + 0.5, padTop);
    ctx.lineTo(plotRight + 0.5, showRsiPane ? rsiTop + rsiPaneH : padTop + chartH);
    ctx.stroke();

    // Horizontal price grid + Right-axis labels (strictly LTR inside right margin)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
    ctx.lineWidth = 1;
    ctx.font = '10.5px "JetBrains Mono", monospace';
    ctx.fillStyle = '#64748b';
    const gridSteps = 6;
    for (let g = 0; g <= gridSteps; g++) {
      const ratio = g / gridSteps;
      const y = Math.round(padTop + ratio * chartH) + 0.5;
      const pVal = maxP - ratio * (maxP - minP);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      ctx.fillText(pVal.toFixed(2), plotRight + 8, y + 3.5);
    }

    // =======================================================================
    // CLIPPED MAIN PLOT AREA — Guarantees ZERO bleed into axes or RSI pane
    // =======================================================================
    ctx.save();
    ctx.beginPath();
    ctx.rect(padLeft, padTop, chartW, chartH);
    ctx.clip();

    // 1. Institutional Killzone Session Background Shading
    if (settings.showKillzones && timeframe !== 'H4') {
      const kzColors: Record<string, { fill: string; label: string; text: string }> = {
        LONDON_OPEN: { fill: 'rgba(56, 189, 248, 0.045)', label: 'LDN', text: 'rgba(56, 189, 248, 0.45)' },
        NY_OVERLAP: { fill: 'rgba(212, 168, 83, 0.055)', label: 'NY-OVL', text: 'rgba(212, 168, 83, 0.50)' },
        NY_AM: { fill: 'rgba(129, 140, 248, 0.04)', label: 'NY', text: 'rgba(129, 140, 248, 0.45)' },
        ASIAN_ACCUMULATION: { fill: 'rgba(148, 163, 184, 0.03)', label: 'ASIA', text: 'rgba(148, 163, 184, 0.35)' },
      };
      let runStart = -1;
      let runKz = 'OFF_SESSION';
      const flushKz = (endIdx: number) => {
        const cfg = kzColors[runKz];
        if (!cfg || runStart < 0 || endIdx <= runStart) return;
        const x0 = Math.max(padLeft, indexToX(runStart) - stepX * 0.5);
        const x1 = Math.min(plotRight, indexToX(endIdx - 1) + stepX * 0.5);
        if (x1 - x0 < 6) return;
        ctx.fillStyle = cfg.fill;
        ctx.fillRect(x0, padTop, x1 - x0, chartH);
        if (x1 - x0 >= 28) {
          ctx.font = '600 9px "JetBrains Mono", monospace';
          ctx.fillStyle = cfg.text;
          ctx.fillText(cfg.label, x0 + 4, padTop + 10);
        }
      };
      for (let i = 0; i < visibleRaw.length; i++) {
        const kz = getKillzoneForTimestamp(visibleRaw[i].time);
        if (kz !== runKz) {
          flushKz(i);
          runKz = kz;
          runStart = i;
        }
      }
      flushKz(visibleRaw.length);
    }

    // Collect right-side / left-side horizontal level labels for collision resolution
    const levelLabelCandidates: Array<{
      id: string;
      desiredY: number;
      priority: number;
      text: string;
      color: string;
      side: 'LEFT' | 'RIGHT';
      bg?: string;
    }> = [];

    // 2. Impulse-Anchored OTE Golden Corridor (0.618 - 0.705 - 0.790) & Equilibrium 50%
    if (layers.ote && quant.dealingRange) {
      const dr = quant.dealingRange;
      const isBearCompass = quant.brain.h4Bias === 'BEARISH' || quant.brain.candidateDirection === 'SHORT';
      const oteHigh = isBearCompass ? dr.oteShortHigh : dr.oteLongHigh;
      const oteLow = isBearCompass ? dr.oteShortLow : dr.oteLongLow;
      const oteSweet = isBearCompass ? dr.oteShortSweetSpot : dr.oteLongSweetSpot;

      if (oteHigh >= minP && oteLow <= maxP) {
        const yTop = Math.max(padTop, priceToY(oteHigh));
        const yBot = Math.min(padTop + chartH, priceToY(oteLow));
        if (yBot > yTop) {
          // Translucent Golden Corridor Gradient (0.618 - 0.705 - 0.790)
          const oteGrad = ctx.createLinearGradient(0, yTop, 0, yBot);
          if (isBearCompass) {
            oteGrad.addColorStop(0, 'rgba(212, 168, 83, 0.05)');
            oteGrad.addColorStop(0.5, 'rgba(248, 113, 113, 0.13)');
            oteGrad.addColorStop(1, 'rgba(212, 168, 83, 0.05)');
          } else {
            oteGrad.addColorStop(0, 'rgba(212, 168, 83, 0.05)');
            oteGrad.addColorStop(0.5, 'rgba(212, 168, 83, 0.16)');
            oteGrad.addColorStop(1, 'rgba(16, 185, 129, 0.07)');
          }
          ctx.fillStyle = oteGrad;
          ctx.fillRect(padLeft, yTop, chartW, yBot - yTop);

          // Crisp 0.618 & 0.790 boundary hairlines
          ctx.save();
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = 'rgba(229, 191, 112, 0.34)';
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(padLeft, yTop);
          ctx.lineTo(plotRight, yTop);
          ctx.moveTo(padLeft, yBot);
          ctx.lineTo(plotRight, yBot);
          ctx.stroke();
          ctx.restore();
        }
        if (oteSweet >= minP && oteSweet <= maxP) {
          const ySweet = priceToY(oteSweet);
          // Sharp 0.705 Sweet Spot Golden Laser
          ctx.save();
          ctx.setLineDash([6, 3]);
          ctx.strokeStyle = isBearCompass ? 'rgba(248, 113, 113, 0.80)' : 'rgba(229, 191, 112, 0.88)';
          ctx.lineWidth = 1.35;
          ctx.beginPath();
          ctx.moveTo(padLeft, ySweet);
          ctx.lineTo(plotRight, ySweet);
          ctx.stroke();
          ctx.restore();
          levelLabelCandidates.push({
            id: 'ote-sweet',
            desiredY: ySweet - 4,
            priority: 7,
            text: `OTE 0.705 SWEET ${oteSweet.toFixed(2)}`,
            color: isBearCompass ? '#fca5a5' : '#E5BF70',
            side: 'LEFT',
            bg: 'rgba(11, 15, 23, 0.88)',
          });
        }
      }

      if (dr.equilibrium50 >= minP && dr.equilibrium50 <= maxP) {
        const yEq = priceToY(dr.equilibrium50);
        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(212, 168, 83, 0.42)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, yEq);
        ctx.lineTo(plotRight, yEq);
        ctx.stroke();
        ctx.restore();
        levelLabelCandidates.push({
          id: 'eq-50',
          desiredY: yEq - 4,
          priority: 3,
          text: `EQ 50% ${dr.equilibrium50.toFixed(2)}`,
          color: '#D4A853',
          side: 'RIGHT',
        });
      }
    }

    // 3. Previous Day High / Low (PDH / PDL) + Session Liquidity Laser Lines (Asian / London / NY)
    if (settings.showPdhPdl && indicatorSeries.prevDay) {
      const { pdh, pdl } = indicatorSeries.prevDay;
      for (const [id, lbl, val] of [
        ['pdh', `PDH ${pdh.toFixed(2)}`, pdh],
        ['pdl', `PDL ${pdl.toFixed(2)}`, pdl],
      ] as const) {
        if (val < minP || val > maxP) continue;
        const y = priceToY(val);
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.48)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
        levelLabelCandidates.push({
          id,
          desiredY: y - 4,
          priority: 5,
          text: lbl,
          color: '#22d3ee',
          side: 'RIGHT',
        });
      }
    }

    if (layers.liquidity && timeframe !== 'H4') {
      const sl = indicatorSeries.sessionLevels;
      const sessionDefs: Array<{ id: string; label: string; val: number | null; color: string; stroke: string }> = [
        { id: 'asia-h', label: 'ASIA H', val: sl.asianHigh, color: '#94a3b8', stroke: 'rgba(148, 163, 184, 0.36)' },
        { id: 'asia-l', label: 'ASIA L', val: sl.asianLow, color: '#94a3b8', stroke: 'rgba(148, 163, 184, 0.36)' },
        { id: 'ldn-h', label: 'LDN H', val: sl.londonHigh, color: '#38bdf8', stroke: 'rgba(56, 189, 248, 0.38)' },
        { id: 'ldn-l', label: 'LDN L', val: sl.londonLow, color: '#38bdf8', stroke: 'rgba(56, 189, 248, 0.38)' },
        { id: 'ny-h', label: 'NY H', val: sl.nyHigh, color: '#c084fc', stroke: 'rgba(192, 132, 252, 0.38)' },
        { id: 'ny-l', label: 'NY L', val: sl.nyLow, color: '#c084fc', stroke: 'rgba(192, 132, 252, 0.38)' },
      ];
      for (const sDef of sessionDefs) {
        if (sDef.val === null || sDef.val < minP || sDef.val > maxP) continue;
        const y = priceToY(sDef.val);
        ctx.save();
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = sDef.stroke;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
        levelLabelCandidates.push({
          id: sDef.id,
          desiredY: y - 4,
          priority: 2,
          text: `${sDef.label} ${sDef.val.toFixed(1)}`,
          color: sDef.color,
          side: 'RIGHT',
        });
      }
    }

    // Shared vertical collision tracker for OB & FVG text pills so labels never stack on top of each other
    const placedZoneLabels: Array<{ x0: number; x1: number; y: number }> = [];
    const pickNonOverlappingZoneY = (x0: number, x1: number, desiredY: number): number => {
      let y = Math.max(padTop + 12, Math.min(padTop + chartH - 4, desiredY));
      const overlaps = (candY: number) =>
        placedZoneLabels.some(
          (r) => !(x1 + 4 < r.x0 || x0 - 4 > r.x1) && Math.abs(candY - r.y) < 14
        );
      if (overlaps(y)) {
        for (let step = 1; step <= 6; step++) {
          const down = Math.min(padTop + chartH - 4, y + step * 14);
          if (!overlaps(down)) {
            y = down;
            break;
          }
          const up = Math.max(padTop + 12, y - step * 14);
          if (!overlaps(up)) {
            y = up;
            break;
          }
        }
      }
      placedZoneLabels.push({ x0, x1, y });
      return y;
    };

    // 4. Volume-Pivot Order Blocks (MT 50% + Golden OB+FVG + Breaker + Mitigation Span Fix)
    if (layers.ob) {
      for (const ob of quant.orderBlocks) {
        const span = computeZoneSpanX({
          startTime: ob.startTime,
          mitigated: ob.mitigated,
          mitigatedTime: ob.mitigatedTime,
          firstVisibleTime,
          lastVisibleTime,
          timeToX,
          padLeft,
          plotRight,
          showMitigated: settings.showMitigatedZones,
        });
        if (!span) continue;

        const yTop = priceToY(ob.high);
        const yBot = priceToY(ob.low);
        const yMt = priceToY(ob.mt50);
        const rectW = Math.max(4, span.x1 - span.x0);
        const rectH = Math.max(3, yBot - yTop);
        const isBull = ob.direction === 'BULLISH';

        if (ob.isBreaker) {
          ctx.fillStyle = 'rgba(168, 85, 247, 0.11)';
        } else if (isBull) {
          ctx.fillStyle = ob.mitigated ? 'rgba(16, 185, 129, 0.05)' : 'rgba(16, 185, 129, 0.13)';
        } else {
          ctx.fillStyle = ob.mitigated ? 'rgba(239, 68, 68, 0.05)' : 'rgba(239, 68, 68, 0.13)';
        }
        ctx.fillRect(span.x0, yTop, rectW, rectH);

        ctx.save();
        if (ob.isBreaker) ctx.setLineDash([4, 3]);
        ctx.strokeStyle = ob.isBreaker
          ? 'rgba(192, 132, 252, 0.72)'
          : ob.hasFvgConfluence && !ob.mitigated
            ? 'rgba(229, 191, 112, 0.78)'
            : isBull
              ? 'rgba(16, 185, 129, 0.45)'
              : 'rgba(239, 68, 68, 0.45)';
        ctx.lineWidth = ob.hasFvgConfluence && !ob.mitigated ? 1.35 : 1;
        ctx.strokeRect(span.x0, yTop, rectW, rectH);
        ctx.restore();

        // 50% Mean Threshold dashed line
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = ob.isBreaker
          ? 'rgba(192, 132, 252, 0.65)'
          : isBull
            ? 'rgba(52, 211, 153, 0.65)'
            : 'rgba(248, 113, 113, 0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(span.x0, yMt);
        ctx.lineTo(span.x1, yMt);
        ctx.stroke();
        ctx.restore();

        if (settings.showZoneLabels && rectW >= 42) {
          const qTag = ob.qualityScore ? ` Q${Math.round(ob.qualityScore)}` : '';
          const goldenTag = ob.hasFvgConfluence && !ob.mitigated ? ' ★OB+FVG' : '';
          const prefix = ob.isBreaker ? 'BRK' : isBull ? 'OB+' : 'OB-';
          const obLabel = `${prefix} ${ob.mt50.toFixed(1)}${qTag}${goldenTag}${ob.mitigated ? ' MIT' : ''}`;
          ctx.font = '10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(obLabel).width;
          const labelX = Math.max(padLeft + 4, Math.min(span.x0 + 4, plotRight - tw - 110));
          const labelY = pickNonOverlappingZoneY(labelX - 3, labelX + tw + 3, yTop + 11);
          ctx.fillStyle = 'rgba(11, 15, 23, 0.84)';
          ctx.fillRect(labelX - 3, labelY - 10, tw + 6, 13);
          ctx.fillStyle = ob.isBreaker
            ? '#d8b4fe'
            : ob.hasFvgConfluence && !ob.mitigated
              ? '#E5BF70'
              : isBull
                ? '#34d399'
                : '#f87171';
          ctx.fillText(obLabel, labelX, labelY);
        }
      }
    }

    // 5. LuxAlgo True FVGs & Inversion FVGs (Distinct Bull/Bear/iFVG Colors + Mitigation Span Fix)
    if (layers.fvg) {
      for (const fvg of quant.fvgs) {
        const span = computeZoneSpanX({
          startTime: fvg.startTime,
          mitigated: fvg.mitigated,
          mitigatedTime: fvg.mitigatedTime,
          firstVisibleTime,
          lastVisibleTime,
          timeToX,
          padLeft,
          plotRight,
          showMitigated: settings.showMitigatedZones,
        });
        if (!span) continue;

        const yTop = priceToY(fvg.top);
        const yBot = priceToY(fvg.bottom);
        const yCe = priceToY(fvg.ce50);
        const rectW = Math.max(4, span.x1 - span.x0);
        const rectH = Math.max(3, yBot - yTop);
        const isBull = fvg.direction === 'BULLISH';

        if (fvg.isInversion) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
        } else if (isBull) {
          ctx.fillStyle = fvg.mitigated ? 'rgba(212, 168, 83, 0.05)' : 'rgba(212, 168, 83, 0.16)';
        } else {
          ctx.fillStyle = fvg.mitigated ? 'rgba(251, 146, 60, 0.05)' : 'rgba(251, 146, 60, 0.15)';
        }
        ctx.fillRect(span.x0, yTop, rectW, rectH);

        ctx.save();
        ctx.setLineDash(fvg.isInversion ? [2, 2] : [3, 3]);
        ctx.strokeStyle = fvg.isInversion
          ? 'rgba(56, 189, 248, 0.78)'
          : isBull
            ? fvg.mitigated
              ? 'rgba(212, 168, 83, 0.35)'
              : 'rgba(229, 191, 112, 0.85)'
            : fvg.mitigated
              ? 'rgba(251, 146, 60, 0.35)'
              : 'rgba(251, 146, 60, 0.85)';
        ctx.beginPath();
        ctx.moveTo(span.x0, yCe);
        ctx.lineTo(span.x1, yCe);
        ctx.stroke();
        ctx.restore();

        if (settings.showZoneLabels && rectW >= 36) {
          const fvgLabel = `${fvg.isInversion ? 'iFVG' : isBull ? 'FVG+' : 'FVG-'} ${fvg.ce50.toFixed(1)}`;
          ctx.font = '10px "JetBrains Mono", monospace';
          const tw = ctx.measureText(fvgLabel).width;
          const labelX = Math.max(padLeft + 4, Math.min(span.x0 + 4, plotRight - tw - 110));
          const labelY = pickNonOverlappingZoneY(labelX - 3, labelX + tw + 3, yCe - 3);
          ctx.fillStyle = 'rgba(11, 15, 23, 0.80)';
          ctx.fillRect(labelX - 3, labelY - 10, tw + 6, 13);
          ctx.fillStyle = fvg.isInversion ? '#38bdf8' : isBull ? '#E5BF70' : '#fb923c';
          ctx.fillText(fvgLabel, labelX, labelY);
        }
      }
    }

    // 6. TFS Macro Tether Line
    if (layers.tether && quant.tfs.tetherPrice >= minP && quant.tfs.tetherPrice <= maxP) {
      const yT = priceToY(quant.tfs.tetherPrice);
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
      ctx.beginPath();
      ctx.moveTo(padLeft, yT);
      ctx.lineTo(plotRight, yT);
      ctx.stroke();
      ctx.restore();
      levelLabelCandidates.push({
        id: 'tfs-tether',
        desiredY: yT - 4,
        priority: 3,
        text: `TFS Tether ${quant.tfs.tetherPrice.toFixed(2)}`,
        color: '#94a3b8',
        side: 'LEFT',
      });
    }

    // 7. Liquidity Pools (BSL / SSL + EQH/EQL Touches + Sweep Rejected)
    if (layers.liquidity) {
      for (const liq of quant.liquidity) {
        if (liq.level < minP || liq.level > maxP) continue;
        const yL = priceToY(liq.level);
        const startX = liq.time <= lastVisibleTime ? Math.max(padLeft, timeToX(liq.time) ?? padLeft) : padLeft;
        ctx.save();
        ctx.setLineDash(liq.sweepRejected ? [] : [2, 3]);
        ctx.strokeStyle =
          liq.side === 'BSL'
            ? liq.sweepRejected
              ? 'rgba(56, 189, 248, 0.9)'
              : 'rgba(56, 189, 248, 0.6)'
            : liq.sweepRejected
              ? 'rgba(251, 146, 60, 0.9)'
              : 'rgba(251, 146, 60, 0.6)';
        ctx.lineWidth = liq.sweepRejected ? 1.3 : 1;
        ctx.beginPath();
        ctx.moveTo(startX, yL);
        ctx.lineTo(plotRight, yL);
        ctx.stroke();
        ctx.restore();

        const eqTag = (liq.touches ?? 0) >= 2 ? (liq.side === 'BSL' ? ` EQH×${liq.touches}` : ` EQL×${liq.touches}`) : '';
        const sweepTag = liq.sweepRejected ? ' SWEPT & RECLAIMED ⚡' : liq.swept ? ' SWEPT' : '';
        levelLabelCandidates.push({
          id: liq.id,
          desiredY: yL - 4,
          priority: liq.sweepRejected ? 10 : 6,
          text: `${liq.side}${eqTag} ${liq.level.toFixed(2)}${sweepTag}`,
          color: liq.sweepRejected ? '#fde68a' : liq.side === 'BSL' ? '#38bdf8' : '#fb923c',
          side: 'RIGHT',
          bg: liq.sweepRejected ? 'rgba(180, 83, 9, 0.42)' : undefined,
        });

        // Glowing "SWEPT & RECLAIMED ⚡" callout directly on the sweep wick candle
        if (liq.sweepRejected && visibleRaw.length > 0) {
          let sweepCandleIdx = -1;
          for (let ci = visibleRaw.length - 1; ci >= 0; ci--) {
            const c = visibleRaw[ci];
            if (liq.side === 'BSL' && c.high >= liq.level && c.close < liq.level) {
              sweepCandleIdx = ci;
              break;
            }
            if (liq.side === 'SSL' && c.low <= liq.level && c.close > liq.level) {
              sweepCandleIdx = ci;
              break;
            }
          }
          if (sweepCandleIdx >= 0) {
            const sx = indexToX(sweepCandleIdx);
            const sc = visibleRaw[sweepCandleIdx];
            const sy = liq.side === 'BSL' ? priceToY(sc.high) - 10 : priceToY(sc.low) + 18;
            const badgeText = 'SWEPT & RECLAIMED ⚡';
            ctx.font = '700 9px "JetBrains Mono", monospace';
            const bw = ctx.measureText(badgeText).width + 10;
            const bx = Math.max(padLeft + 4, Math.min(plotRight - bw - 4, sx - bw / 2));
            const by = Math.max(padTop + 14, Math.min(padTop + chartH - 8, sy));
            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.fillRect(bx, by - 10, bw, 14);
            ctx.strokeStyle = liq.side === 'BSL' ? '#38bdf8' : '#f59e0b';
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by - 10, bw, 14);
            ctx.fillStyle = '#fde68a';
            ctx.fillText(badgeText, bx + 5, by);
          }
        }
      }
    }

    // 8. Volume Histogram (bottom 12% of main chart)
    if (settings.showVolume) {
      const maxVol = Math.max(1, ...visibleRaw.map((c) => c.volume));
      const volH = chartH * 0.12;
      const barW = Math.max(1.5, Math.min(10, stepX * 0.58));
      for (let i = 0; i < visibleRaw.length; i++) {
        const c = visibleRaw[i];
        const x = indexToX(i);
        const h = (c.volume / maxVol) * volH;
        ctx.fillStyle = c.close >= c.open ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)';
        ctx.fillRect(x - barW / 2, padTop + chartH - h, barW, h);
      }
    }

    // 9. Price Series (Candles / Hollow / Heikin-Ashi / Line)
    if (settings.chartStyle === 'LINE') {
      ctx.beginPath();
      for (let i = 0; i < visibleDisplay.length; i++) {
        const x = indexToX(i);
        const y = priceToY(visibleDisplay[i].close);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#E5BF70';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Subtle gold gradient under line
      const lastX = indexToX(visibleDisplay.length - 1);
      const firstX = indexToX(0);
      ctx.lineTo(lastX, padTop + chartH);
      ctx.lineTo(firstX, padTop + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padTop, 0, padTop + chartH);
      grad.addColorStop(0, 'rgba(212, 168, 83, 0.22)');
      grad.addColorStop(1, 'rgba(212, 168, 83, 0.0)');
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      const candleW = Math.max(2.5, Math.min(13, stepX * 0.66));
      for (let i = 0; i < visibleDisplay.length; i++) {
        const c = visibleDisplay[i];
        const x = Math.round(indexToX(i));
        const yO = priceToY(c.open);
        const yC = priceToY(c.close);
        const yH = priceToY(c.high);
        const yL = priceToY(c.low);
        const bullish = c.close >= c.open;
        const color = bullish ? '#10B981' : '#EF4444';

        // Wick
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, yH);
        ctx.lineTo(x + 0.5, yL);
        ctx.stroke();

        // Body
        const bodyTop = Math.min(yO, yC);
        const bodyH = Math.max(1.5, Math.abs(yC - yO));
        if (settings.chartStyle === 'HOLLOW' && bullish) {
          ctx.fillStyle = '#0B0F17';
          ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(x - candleW / 2 + 0.5, bodyTop + 0.5, Math.max(1, candleW - 1), Math.max(1, bodyH - 1));
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
        }
      }
    }

    // 10. Scalper Moving Averages & Session VWAP Overlays
    const drawCurve = (vals: number[], color: string, widthPx = 1.35, dash: number[] = []) => {
      if (vals.length === 0) return;
      ctx.save();
      if (dash.length) ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (!Number.isFinite(v)) continue;
        const x = indexToX(i);
        const y = priceToY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    if (settings.showEma50) drawCurve(visibleData.ema50, 'rgba(245, 158, 11, 0.85)', 1.35);
    if (settings.showEma20) drawCurve(visibleData.ema20, 'rgba(56, 189, 248, 0.90)', 1.45);
    if (settings.showVwap) drawCurve(visibleData.vwap, 'rgba(192, 132, 252, 0.88)', 1.45, [4, 2]);

    // 11. BOS / CHoCH Structural Markers (Anchored accurately from swingTime -> breakout time)
    if (layers.structure) {
      for (const st of quant.structures) {
        if (st.time < firstVisibleTime || st.swingTime > lastVisibleTime) continue;
        const x0 = st.swingTime < firstVisibleTime ? padLeft : (timeToX(st.swingTime) ?? padLeft);
        const x1 = st.time > lastVisibleTime ? plotRight : (timeToX(st.time) ?? plotRight);
        if (x1 <= x0 + 3) continue;
        const y = priceToY(st.level);
        const color = st.direction === 'BULLISH' ? '#34d399' : '#f87171';
        ctx.save();
        ctx.setLineDash(st.kind === 'CHoCH' ? [3, 2] : []);
        ctx.strokeStyle = color;
        ctx.lineWidth = st.kind === 'CHoCH' ? 1.35 : 1.05;
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        ctx.restore();

        // Tiny breakout node dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x1, y, 2.2, 0, Math.PI * 2);
        ctx.fill();

        const midX = Math.max(padLeft + 4, Math.min(plotRight - 36, (x0 + x1) / 2 - 12));
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        const tw = ctx.measureText(st.kind).width;
        const lblY = st.direction === 'BULLISH' ? y - 4 : y + 11;
        ctx.fillStyle = 'rgba(11, 15, 23, 0.78)';
        ctx.fillRect(midX - 2, lblY - 9, tw + 4, 11);
        ctx.fillStyle = color;
        ctx.fillText(st.kind, midX, lblY);
      }
    }

    // 12. Active Positions & Interactive Risk/Reward Projection Box
    for (const pos of positionsToDraw) {
      const isFocused = focusedPosition?.id === pos.id;
      const alpha = isFocused ? 1 : 0.45;
      const yEntry = priceToY(pos.entry);
      const ySl = priceToY(pos.stopLoss);
      const yTp1 = priceToY(pos.tp1);
      const yTp2 = priceToY(pos.tp2);

      // Institutional RR Projection Box anchored from position entry bar (or right 30% of plot) to live edge
      if (isFocused) {
        const openTimeSec = Math.floor(pos.openedAtMs / 1000);
        const anchorX = Math.max(
          padLeft + chartW * 0.45,
          Math.min(plotRight - 130, timeToX(openTimeSec) ?? plotRight - Math.max(150, chartW * 0.28))
        );
        const boxW = Math.max(96, plotRight - anchorX);

        // Crimson Risk Box (Entry -> SL)
        const riskTop = Math.min(yEntry, ySl);
        const riskH = Math.max(2, Math.abs(ySl - yEntry));
        const riskGrad = ctx.createLinearGradient(anchorX, riskTop, anchorX, riskTop + riskH);
        riskGrad.addColorStop(0, 'rgba(239, 68, 68, 0.14)');
        riskGrad.addColorStop(1, 'rgba(239, 68, 68, 0.06)');
        ctx.fillStyle = riskGrad;
        ctx.fillRect(anchorX, riskTop, boxW, riskH);
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.42)';
        ctx.lineWidth = 1;
        ctx.strokeRect(anchorX, riskTop, boxW, riskH);

        // Emerald Reward Box (Entry -> TP1 -> TP2)
        const tp1Top = Math.min(yEntry, yTp1);
        const tp1H = Math.max(2, Math.abs(yTp1 - yEntry));
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
        ctx.fillRect(anchorX, tp1Top, boxW, tp1H);

        const rewTop = Math.min(yEntry, yTp2);
        const rewH = Math.max(2, Math.abs(yTp2 - yEntry));
        const rewGrad = ctx.createLinearGradient(anchorX, rewTop, anchorX, rewTop + rewH);
        rewGrad.addColorStop(0, 'rgba(16, 185, 129, 0.14)');
        rewGrad.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
        ctx.fillStyle = rewGrad;
        ctx.fillRect(anchorX, rewTop, boxW, rewH);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(anchorX, rewTop, boxW, rewH);

        // Live R-Multiple Tag inside the projection box
        const riskDist = Math.max(0.01, Math.abs(pos.entry - pos.initialSl));
        const liveDelta = pos.direction === 'LONG' ? tick.last - pos.entry : pos.entry - tick.last;
        const liveR = 'rMultiple' in pos && Number.isFinite(pos.rMultiple) ? pos.rMultiple : liveDelta / riskDist;
        const tp1R = Math.abs(pos.tp1 - pos.entry) / riskDist;
        const tp2R = Math.abs(pos.tp2 - pos.entry) / riskDist;
        const pnlLive = 'netPnl' in pos ? pos.netPnl : pos.unrealizedPnl;
        const rTag = `${pos.direction} ${liveR >= 0 ? '+' : ''}${liveR.toFixed(2)}R (${pnlLive >= 0 ? '+' : ''}$${pnlLive.toFixed(0)}) · 1:${tp1R.toFixed(1)}/${tp2R.toFixed(1)}`;
        ctx.font = '700 9px "JetBrains Mono", monospace';
        const rtw = ctx.measureText(rTag).width + 10;
        const rbx = Math.max(padLeft + 4, Math.min(plotRight - rtw - 102, anchorX + 4));
        const rby = Math.max(padTop + 14, Math.min(padTop + chartH - 8, yEntry - 6));
        ctx.fillStyle = liveR >= 0 ? 'rgba(6, 78, 59, 0.92)' : 'rgba(127, 29, 29, 0.92)';
        ctx.fillRect(rbx, rby - 11, rtw, 15);
        ctx.strokeStyle = liveR >= 0 ? '#10B981' : '#EF4444';
        ctx.lineWidth = 1;
        ctx.strokeRect(rbx, rby - 11, rtw, 15);
        ctx.fillStyle = liveR >= 0 ? '#a7f3d0' : '#fecaca';
        ctx.fillText(rTag, rbx + 5, rby);
      }

      const pnlVal = 'netPnl' in pos ? pos.netPnl : pos.unrealizedPnl;
      const pnlStr = `${pnlVal >= 0 ? '+' : ''}$${pnlVal.toFixed(0)}`;
      const tagPrefix = isFocused ? '' : `[${pos.direction[0]}] `;
      const isBeOrTrail =
        pos.stage === 'BREAK_EVEN_ARMED' ||
        pos.stage === 'RISK_FREE_TP1' ||
        ('trailingStopDistance' in pos && pos.trailingStopDistance !== null);
      const lines = [
        { id: `${pos.id}-tp2`, label: `${tagPrefix}TP2 ${pos.tp2.toFixed(2)}`, price: pos.tp2, color: '#10B981', prio: isFocused ? 10 : 6 },
        { id: `${pos.id}-tp1`, label: `${tagPrefix}TP1 ${pos.tp1.toFixed(2)}`, price: pos.tp1, color: '#34d399', prio: isFocused ? 11 : 6 },
        {
          id: `${pos.id}-ent`,
          label: `${tagPrefix}${pos.direction} ${pos.entry.toFixed(2)} (${pnlStr})`,
          price: pos.entry,
          color: '#E5BF70',
          prio: isFocused ? 14 : 8,
        },
        {
          id: `${pos.id}-sl`,
          label: `${tagPrefix}${isBeOrTrail ? 'BE/TRAIL SL' : 'SL'} ${pos.stopLoss.toFixed(2)}`,
          price: pos.stopLoss,
          color: isBeOrTrail ? '#38bdf8' : '#EF4444',
          prio: isFocused ? 12 : 6,
        },
      ];

      for (const ln of lines) {
        if (ln.price < minP || ln.price > maxP) continue;
        const y = priceToY(ln.price);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.setLineDash(ln.id.endsWith('-ent') ? [] : [5, 3]);
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = isFocused ? 1.45 : 1;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();

        levelLabelCandidates.push({
          id: ln.id,
          desiredY: y - 3,
          priority: ln.prio,
          text: ln.label,
          color: ln.color,
          side: 'LEFT',
          bg: 'rgba(11, 15, 23, 0.90)',
        });
      }
    }

    // 13. Pending Limit Orders
    if (settings.showPendingLimits) {
      for (const lim of pendingLimits) {
        if (lim.status !== 'PENDING_ENTRY') continue;
        if (lim.entry < minP || lim.entry > maxP) continue;
        const y = priceToY(lim.entry);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.78)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(plotRight, y);
        ctx.stroke();
        ctx.restore();
        levelLabelCandidates.push({
          id: `lim-${lim.id}`,
          desiredY: y - 3,
          priority: 9,
          text: `LIMIT ${lim.direction} ${lim.entry.toFixed(2)} (${lim.lotSize}L)`,
          color: '#38bdf8',
          side: 'LEFT',
          bg: 'rgba(11, 15, 23, 0.88)',
        });
      }
    }

    // 14. Live Bid / Ask Spread Corridor + Spot Line
    const spotY = priceToY(tick.last);
    if (settings.showBidAsk && tick.bid > 0 && tick.ask > tick.bid) {
      const yAsk = priceToY(tick.ask);
      const yBid = priceToY(tick.bid);
      ctx.fillStyle = 'rgba(212, 168, 83, 0.10)';
      ctx.fillRect(padLeft, Math.min(yAsk, yBid), chartW, Math.max(1.5, Math.abs(yBid - yAsk)));

      ctx.strokeStyle = 'rgba(248, 113, 113, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(padLeft, yAsk);
      ctx.lineTo(plotRight, yAsk);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(52, 211, 153, 0.55)';
      ctx.beginPath();
      ctx.moveTo(padLeft, yBid);
      ctx.lineTo(plotRight, yBid);
      ctx.stroke();
    }

    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#D4A853';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(padLeft, spotY);
    ctx.lineTo(plotRight, spotY);
    ctx.stroke();
    ctx.restore();

    // Draw de-conflicted LEFT and RIGHT level pills inside clipped plot
    const leftItems = levelLabelCandidates.filter((x) => x.side === 'LEFT');
    const rightItems = levelLabelCandidates.filter((x) => x.side === 'RIGHT');
    const leftResolved = resolveLabelCollisions(
      leftItems.map((x) => ({ id: x.id, desiredY: x.desiredY, priority: x.priority })),
      15,
      padTop + 14,
      padTop + chartH - 6
    );
    const rightResolved = resolveLabelCollisions(
      rightItems.map((x) => ({ id: x.id, desiredY: x.desiredY, priority: x.priority })),
      15,
      padTop + 14,
      padTop + chartH - 6
    );

    ctx.font = '600 10px "JetBrains Mono", monospace';
    for (const item of leftItems) {
      const y = leftResolved.get(item.id) ?? item.desiredY;
      const tw = ctx.measureText(item.text).width;
      ctx.fillStyle = item.bg ?? 'rgba(11, 15, 23, 0.82)';
      ctx.fillRect(padLeft + 4, y - 10, tw + 8, 13);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, padLeft + 8, y);
    }
    for (const item of rightItems) {
      const y = rightResolved.get(item.id) ?? item.desiredY;
      const tw = ctx.measureText(item.text).width;
      const x = plotRight - tw - 10;
      ctx.fillStyle = item.bg ?? 'rgba(11, 15, 23, 0.82)';
      ctx.fillRect(x - 3, y - 10, tw + 8, 13);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, x + 1, y);
    }

    // End main plot clip
    ctx.restore();

    // Right-Axis Spot Price + Bar Countdown Tag (clamped inside main chart Y range)
    const clampedSpotY = Math.max(padTop + 12, Math.min(padTop + chartH - 14, spotY));
    const countdownStr = settings.showCountdown ? formatCandleCountdown(nowMs, timeframe) : '';
    const spotBoxH = countdownStr ? 28 : 18;
    const spotBoxTop = Math.max(padTop, Math.min(padTop + chartH - spotBoxH, clampedSpotY - spotBoxH / 2));

    ctx.fillStyle = '#D4A853';
    ctx.fillRect(plotRight + 2, spotBoxTop, padRight - 6, spotBoxH);
    ctx.fillStyle = '#0B0F17';
    ctx.font = '700 10.5px "JetBrains Mono", monospace';
    ctx.fillText(tick.last.toFixed(2), plotRight + 7, spotBoxTop + 12);
    if (countdownStr) {
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#1e293b';
      ctx.fillText(countdownStr, plotRight + 7, spotBoxTop + 23);
    }

    // =======================================================================
    // WILDER RSI SUB-PANE (Skips Warmup < rsiPeriod so no flat-50 artifact)
    // =======================================================================
    if (showRsiPane) {
      const rsiToY = (val: number) => {
        const clamped = Math.max(0, Math.min(100, val));
        return rsiTop + ((100 - clamped) / 100) * rsiPaneH;
      };

      // Separator line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, rsiTop - paneGap * 0.5);
      ctx.lineTo(width - 4, rsiTop - paneGap * 0.5);
      ctx.stroke();

      // Clipped RSI plot
      ctx.save();
      ctx.beginPath();
      ctx.rect(padLeft, rsiTop, chartW, rsiPaneH);
      ctx.clip();

      // Cardwell 40-60 band
      const y60 = rsiToY(60);
      const y40 = rsiToY(40);
      ctx.fillStyle = 'rgba(212, 168, 83, 0.055)';
      ctx.fillRect(padLeft, y60, chartW, y40 - y60);

      for (const lvl of [70, 50, 30]) {
        const yLvl = Math.round(rsiToY(lvl)) + 0.5;
        ctx.save();
        ctx.setLineDash(lvl === 50 ? [2, 3] : [4, 4]);
        ctx.strokeStyle =
          lvl === 70
            ? 'rgba(248, 113, 113, 0.35)'
            : lvl === 30
              ? 'rgba(52, 211, 153, 0.35)'
              : 'rgba(148, 163, 184, 0.25)';
        ctx.beginPath();
        ctx.moveTo(padLeft, yLvl);
        ctx.lineTo(plotRight, yLvl);
        ctx.stroke();
        ctx.restore();
      }

      // RSI Line (strictly skip warmup indices < settings.rsiPeriod)
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < visibleRsi.length; i++) {
        const globalIdx = visibleData.startIdx + i;
        if (globalIdx < settings.rsiPeriod) continue;
        const v = visibleRsi[i];
        if (!Number.isFinite(v)) continue;
        const x = indexToX(i);
        const y = rsiToY(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = '#E5BF70';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // RSI Title inside left edge (strictly LTR)
      const lastRsi = visibleRsi[visibleRsi.length - 1] ?? quant.rsi.active.value;
      const divTag = quant.rsi.active.divergence !== 'NONE' ? ` · ${quant.rsi.active.divergence.replace(/_/g, ' ')}` : '';
      const regimeTag =
        quant.rsi.active.regime === 'BULLISH_REGIME'
          ? 'Cardwell Bull (40-80)'
          : quant.rsi.active.regime === 'BEARISH_REGIME'
            ? 'Cardwell Bear (20-60)'
            : 'Neutral';
      const rsiTitle = `Wilder RSI(${settings.rsiPeriod}) ${lastRsi.toFixed(1)} · ${regimeTag}${divTag}`;
      ctx.font = '10px "JetBrains Mono", monospace';
      const titleW = ctx.measureText(rsiTitle).width;
      ctx.fillStyle = 'rgba(11, 15, 23, 0.78)';
      ctx.fillRect(padLeft + 3, rsiTop + 2, titleW + 6, 13);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(rsiTitle, padLeft + 6, rsiTop + 12);

      ctx.restore();

      // RSI right-axis levels & current badge
      ctx.font = '9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = '#64748b';
      for (const lvl of [70, 50, 30]) {
        const yLvl = Math.round(rsiToY(lvl)) + 0.5;
        ctx.fillText(String(lvl), plotRight + 8, yLvl + 3);
      }

      const lastRsiVal = visibleRsi[visibleRsi.length - 1] ?? quant.rsi.active.value;
      const yLastRsi = Math.max(rsiTop + 8, Math.min(rsiTop + rsiPaneH - 8, rsiToY(lastRsiVal)));
      ctx.fillStyle = lastRsiVal >= 60 ? '#10B981' : lastRsiVal <= 40 ? '#EF4444' : '#D4A853';
      ctx.fillRect(plotRight + 2, yLastRsi - 7.5, 48, 15);
      ctx.fillStyle = '#0B0F17';
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.fillText(lastRsiVal.toFixed(1), plotRight + 7, yLastRsi + 3.5);
    }

    // =======================================================================
    // DATE-AWARE UTC X-AXIS LABELS
    // =======================================================================
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    const maxLabels = Math.max(3, Math.floor(chartW / 108));
    const labelEvery = Math.max(1, Math.ceil(visibleRaw.length / maxLabels));
    let prevLabelTime: number | null = null;
    for (let i = 0; i < visibleRaw.length; i += labelEvery) {
      const c = visibleRaw[i];
      const lbl = formatAxisTimestamp(c.time, timeframe, prevLabelTime);
      prevLabelTime = c.time;
      const tw = ctx.measureText(lbl).width;
      const x = Math.max(padLeft, Math.min(plotRight - tw, indexToX(i) - tw / 2));
      ctx.fillText(lbl, x, height - 8);
    }
  }, [
    visibleRaw,
    visibleDisplay,
    visibleRsi,
    visibleData,
    indicatorSeries.prevDay,
    indicatorSeries.sessionLevels,
    quant,
    tick,
    focusedPosition,
    positionsToDraw,
    pendingLimits,
    layers,
    settings,
    size,
    clampedPan,
    yScaleFactor,
    timeframe,
    nowMs,
  ]);

  // =========================================================================
  // LAYER 2: 60-FPS OVERLAY CANVAS (Holographic Scan Wave + Target Reticles +
  // Pulsing BE/Trailing SL + Crosshair + Ruler)
  // =========================================================================
  const drawOverlay = useCallback(
    (frameMs = performance.now()) => {
      const overlay = overlayCanvasRef.current;
      const geom = geomRef.current;
      if (!overlay || !geom) return;
      const ctx = overlay.getContext('2d');
      if (!ctx) return;

      const dpr = canvasSizeRef.current.dpr || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.clearRect(0, 0, geom.width, geom.height);

      const plotRight = geom.padLeft + geom.chartW;
      const bottomEdge = geom.showRsiPane ? geom.rsiTop + geom.rsiPaneH : geom.padTop + geom.chartH;
      const priceToY = (p: number) => geom.padTop + ((geom.maxP - p) / (geom.maxP - geom.minP)) * geom.chartH;
      const yToPrice = (y: number) => geom.maxP - ((y - geom.padTop) / geom.chartH) * (geom.maxP - geom.minP);
      const indexToX = (i: number) => geom.padLeft + i * geom.stepX + geom.stepX * 0.5;

      // 0. Holographic Agentic HUD Animations (Clipped strictly inside main price plot)
      if (hudEnabled && visibleRaw.length > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(geom.padLeft, geom.padTop, geom.chartW, geom.chartH);
        ctx.clip();

        const highConfluence = quant.brain.totalScore >= 65 || quant.brain.goldenConfluence || proposals.some((p) => p.status === 'PROPOSED');
        const scanActive = agentBusy || agentEnabled || highConfluence;
        const pulse = 0.5 + 0.5 * Math.sin(frameMs * 0.0045);

        // 0A. Subtle Holographic Vertical Laser Scan Wave across recent candles
        if (scanActive) {
          const sweepSpanStart = geom.padLeft + geom.chartW * 0.56;
          const sweepSpanW = geom.chartW * 0.44;
          const periodMs = agentBusy ? 1800 : 4600;
          const phase = (frameMs % periodMs) / periodMs;
          const beamX = sweepSpanStart + phase * sweepSpanW;
          const beamTrailW = agentBusy ? 64 : 42;

          const grad = ctx.createLinearGradient(beamX - beamTrailW, 0, beamX + 6, 0);
          if (agentBusy) {
            grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
            grad.addColorStop(0.75, 'rgba(212, 168, 83, 0.13)');
            grad.addColorStop(1, 'rgba(229, 191, 112, 0.28)');
          } else {
            grad.addColorStop(0, 'rgba(212, 168, 83, 0)');
            grad.addColorStop(0.8, 'rgba(212, 168, 83, 0.05)');
            grad.addColorStop(1, 'rgba(229, 191, 112, 0.14)');
          }
          ctx.fillStyle = grad;
          ctx.fillRect(beamX - beamTrailW, geom.padTop, beamTrailW + 6, geom.chartH);

          ctx.strokeStyle = agentBusy ? 'rgba(229, 191, 112, 0.58)' : 'rgba(212, 168, 83, 0.25)';
          ctx.lineWidth = agentBusy ? 1.4 : 1;
          ctx.beginPath();
          ctx.moveTo(beamX, geom.padTop);
          ctx.lineTo(beamX, geom.padTop + geom.chartH);
          ctx.stroke();
        }

        // Helper: Draw a tactical sniper reticle ring with corner brackets
        const drawReticle = (cx: number, cy: number, color: string, label: string, phaseShift = 0) => {
          if (cy < geom.padTop + 6 || cy > geom.padTop + geom.chartH - 6) return;
          const p = 0.5 + 0.5 * Math.sin(frameMs * 0.005 + phaseShift);
          const outerR = 11 + p * 5;
          const innerR = 4.5;

          ctx.save();
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.32 + p * 0.48;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
          ctx.stroke();

          ctx.globalAlpha = 0.88;
          ctx.lineWidth = 1.35;
          ctx.beginPath();
          ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
          ctx.stroke();

          // Crosshair ticks
          const tickLen = 4;
          ctx.beginPath();
          ctx.moveTo(cx - outerR - tickLen, cy);
          ctx.lineTo(cx - innerR - 2, cy);
          ctx.moveTo(cx + innerR + 2, cy);
          ctx.lineTo(cx + outerR + tickLen, cy);
          ctx.moveTo(cx, cy - outerR - tickLen);
          ctx.lineTo(cx, cy - innerR - 2);
          ctx.moveTo(cx, cy + innerR + 2);
          ctx.lineTo(cx, cy + outerR + tickLen);
          ctx.stroke();

          // Compact HUD label placed cleanly to the left of reticle to avoid right-edge session labels
          ctx.font = '700 8.8px "JetBrains Mono", monospace';
          const tw = ctx.measureText(label).width + 8;
          const lx = Math.max(geom.padLeft + 4, Math.min(plotRight - tw - 104, cx - outerR - tw - 6));
          const ly = Math.max(geom.padTop + 14, Math.min(geom.padTop + geom.chartH - 6, cy + 3));
          ctx.fillStyle = 'rgba(11, 15, 23, 0.88)';
          ctx.fillRect(lx, ly - 10, tw, 13);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 0.8;
          ctx.strokeRect(lx, ly - 10, tw, 13);
          ctx.globalAlpha = 1;
          ctx.fillStyle = color;
          ctx.fillText(label, lx + 4, ly);
          ctx.restore();
        };

        // 0B. Pulsing Sniper Reticle on Swept Liquidity Wick
        const sweptPool = quant.liquidity.find((l) => l.sweepRejected);
        if (sweptPool) {
          for (let ci = visibleRaw.length - 1; ci >= 0; ci--) {
            const c = visibleRaw[ci];
            const isBslSweep = sweptPool.side === 'BSL' && c.high >= sweptPool.level && c.close < sweptPool.level;
            const isSslSweep = sweptPool.side === 'SSL' && c.low <= sweptPool.level && c.close > sweptPool.level;
            if (isBslSweep || isSslSweep) {
              const sx = indexToX(ci);
              const sy = priceToY(isBslSweep ? c.high : c.low);
              drawReticle(sx, sy, isBslSweep ? '#38bdf8' : '#fb923c', `${sweptPool.side} SWEEP`, 0);
              break;
            }
          }
        }

        // 0C. Pulsing Golden Sniper Entry Reticle on OTE 0.705 / FVG CE50 Intersection
        const dr = quant.dealingRange;
        const isBear = quant.brain.h4Bias === 'BEARISH' || quant.brain.candidateDirection === 'SHORT';
        const oteSweet = isBear ? dr.oteShortSweetSpot : dr.oteLongSweetSpot;
        const goldenFvg = quant.fvgs.find((f) => !f.mitigated && (isBear ? f.direction === 'BEARISH' : f.direction === 'BULLISH'));
        const sniperPrice = quant.brain.watchlistZone?.optimalEntry ?? goldenFvg?.ce50 ?? oteSweet;
        if (Number.isFinite(sniperPrice) && sniperPrice >= geom.minP && sniperPrice <= geom.maxP) {
          const rx = Math.min(plotRight - 58, indexToX(visibleRaw.length - 1) + geom.stepX * 1.5);
          const ry = priceToY(sniperPrice);
          drawReticle(
            rx,
            ry,
            '#E5BF70',
            goldenFvg ? `SNIPER CE50 ${sniperPrice.toFixed(1)}` : `OTE 70.5% ${sniperPrice.toFixed(1)}`,
            Math.PI * 0.65
          );
        }

        // 0D. Pulsing Breakeven / Trailing Stop Beacon on Focused Broker Position
        if (focusedPosition) {
          const isBeOrTrail =
            focusedPosition.stage === 'BREAK_EVEN_ARMED' ||
            focusedPosition.stage === 'RISK_FREE_TP1' ||
            ('trailingStopDistance' in focusedPosition && focusedPosition.trailingStopDistance !== null);
          if (isBeOrTrail && focusedPosition.stopLoss >= geom.minP && focusedPosition.stopLoss <= geom.maxP) {
            const ySl = priceToY(focusedPosition.stopLoss);
            const bx = plotRight - 14;
            ctx.save();
            ctx.strokeStyle = '#38bdf8';
            ctx.globalAlpha = 0.3 + pulse * 0.65;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(bx, ySl, 4 + pulse * 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#38bdf8';
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            ctx.arc(bx, ySl, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        ctx.restore();
      }

      // 1. Draw Interactive Measure / Ruler Tool Box if active
      if (rulerStart && rulerEnd) {
        const x1 = Math.max(geom.padLeft, Math.min(plotRight, indexToX(rulerStart.idx)));
        const x2 = Math.max(geom.padLeft, Math.min(plotRight, indexToX(rulerEnd.idx)));
        const y1 = Math.max(geom.padTop, Math.min(geom.padTop + geom.chartH, priceToY(rulerStart.price)));
        const y2 = Math.max(geom.padTop, Math.min(geom.padTop + geom.chartH, priceToY(rulerEnd.price)));

        const metrics = computeRulerMetrics(rulerStart.price, rulerEnd.price, rulerStart.idx, rulerEnd.idx, timeframe);
        const isUp = metrics.deltaUsd >= 0;

        ctx.fillStyle = isUp ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.14)';
        ctx.strokeStyle = isUp ? 'rgba(52, 211, 153, 0.85)' : 'rgba(248, 113, 113, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));

        const sign = isUp ? '+' : '';
        const line1 = `${sign}$${metrics.deltaUsd.toFixed(2)} (${sign}${metrics.deltaPct.toFixed(2)}%) · ${sign}${metrics.pips} pips`;
        const line2 = `${metrics.bars} bars · ${metrics.durationLabel}`;
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const boxW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 14;
        const boxH = 30;
        const bx = Math.max(geom.padLeft + 4, Math.min(plotRight - boxW - 4, (x1 + x2) / 2 - boxW / 2));
        const by = Math.max(geom.padTop + 4, Math.min(geom.padTop + geom.chartH - boxH - 4, Math.min(y1, y2) - boxH - 6));

        ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
        ctx.fillRect(bx, by, boxW, boxH);
        ctx.strokeStyle = isUp ? '#10B981' : '#EF4444';
        ctx.strokeRect(bx, by, boxW, boxH);
        ctx.fillStyle = isUp ? '#6ee7b7' : '#fca5a5';
        ctx.fillText(line1, bx + 7, by + 12);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(line2, bx + 7, by + 24);
      }

      // 2. Draw Free-Moving Crosshair + Right-Axis Price Tag + Bottom Time Tag
      const hover = hoverStateRef.current;
      if (!hover || hover.x < geom.padLeft || hover.x > plotRight || hover.y < geom.padTop || hover.y > bottomEdge) {
        return;
      }

      const snappedX =
        hover.idx !== null && visibleRaw[hover.idx] ? indexToX(hover.idx) : hover.x;
      const crossY = hover.y;

      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.36)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(snappedX, geom.padTop);
      ctx.lineTo(snappedX, bottomEdge);
      ctx.moveTo(geom.padLeft, crossY);
      ctx.lineTo(plotRight, crossY);
      ctx.stroke();
      ctx.restore();

      // Right-axis price / RSI tag
      if (crossY >= geom.padTop && crossY <= geom.padTop + geom.chartH) {
        const hoverPrice = yToPrice(crossY);
        ctx.fillStyle = '#334155';
        ctx.fillRect(plotRight + 2, crossY - 9, geom.padRight - 6, 18);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        ctx.fillText(hoverPrice.toFixed(2), plotRight + 7, crossY + 3.5);
      } else if (geom.showRsiPane && crossY >= geom.rsiTop && crossY <= geom.rsiTop + geom.rsiPaneH) {
        const rsiVal = Math.max(0, Math.min(100, 100 - ((crossY - geom.rsiTop) / geom.rsiPaneH) * 100));
        ctx.fillStyle = '#334155';
        ctx.fillRect(plotRight + 2, crossY - 8, 48, 16);
        ctx.fillStyle = '#f8fafc';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillText(rsiVal.toFixed(1), plotRight + 7, crossY + 3.5);
      }

      // Bottom-axis exact timestamp pill
      if (hover.idx !== null && visibleRaw[hover.idx]) {
        const tsLabel = formatFullUtcTimestamp(visibleRaw[hover.idx].time);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const tw = ctx.measureText(tsLabel).width + 10;
        const bx = Math.max(geom.padLeft, Math.min(plotRight - tw, snappedX - tw / 2));
        ctx.fillStyle = '#334155';
        ctx.fillRect(bx, geom.height - 20, tw, 16);
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(tsLabel, bx + 5, geom.height - 9);
      }
    },
    [visibleRaw, rulerStart, rulerEnd, timeframe, hudEnabled, quant, agentBusy, agentEnabled, proposals, focusedPosition]
  );

  // Smooth, CPU-conscious overlay animation loop (respects prefers-reduced-motion, zero React setState)
  useEffect(() => {
    drawOverlay(performance.now());
    if (!hudEnabled) return;
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    let rafId = 0;
    let lastDrawMs = 0;
    const minFrameGapMs = agentBusy ? 24 : 55; // Smooth 40-60fps during scan, calm low-CPU ambient pulse

    const step = (ts: number) => {
      const modalOpen = Boolean(document.querySelector('[role="dialog"]'));
      if (!document.hidden && !modalOpen && ts - lastDrawMs >= minFrameGapMs) {
        lastDrawMs = ts;
        drawOverlay(ts);
      }
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [drawOverlay, size, visibleRaw, hudEnabled, agentBusy]);

  const scheduleOverlayDraw = useCallback(() => {
    if (rafOverlayRef.current !== null) return;
    rafOverlayRef.current = window.requestAnimationFrame((ts) => {
      rafOverlayRef.current = null;
      drawOverlay(ts);
    });
  }, [drawOverlay]);

  useEffect(() => {
    return () => {
      if (rafOverlayRef.current !== null) {
        window.cancelAnimationFrame(rafOverlayRef.current);
      }
    };
  }, []);

  const handlePointerMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = geomRef.current;
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const plotRight = geom.padLeft + geom.chartW;

    if (dragRef.current.mode === 'PAN') {
      const dx = e.clientX - dragRef.current.startX;
      const shift = Math.round(dx / Math.max(3, geom.stepX));
      setPanOffset(Math.max(0, Math.min(maxPan, dragRef.current.startPan + shift)));
      return;
    }

    if (dragRef.current.mode === 'Y_SCALE') {
      const dy = e.clientY - dragRef.current.startY;
      const nextScale = Math.max(0.3, Math.min(3.5, dragRef.current.startYScale * Math.exp(-dy / 160)));
      setYScaleFactor(nextScale);
      return;
    }

    const rawIdx = Math.floor((x - geom.padLeft) / Math.max(1, geom.stepX));
    const clampedIdx =
      x >= geom.padLeft && x <= plotRight && rawIdx >= 0 && rawIdx < visibleRaw.length ? rawIdx : null;

    if (dragRef.current.mode === 'RULER' && rulerStart) {
      const idx = Math.max(0, Math.min(visibleRaw.length - 1, rawIdx));
      const price = geom.maxP - ((y - geom.padTop) / geom.chartH) * (geom.maxP - geom.minP);
      setRulerEnd({ idx, price });
    }

    hoverStateRef.current = { x, y, idx: clampedIdx };
    if (clampedIdx !== hoverIdx) {
      setHoverIdx(clampedIdx);
    }
    scheduleOverlayDraw();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = geomRef.current;
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const plotRight = geom.padLeft + geom.chartW;

    // Right price-axis drag -> manual vertical Y-scale zoom
    if (x > plotRight) {
      dragRef.current = {
        mode: 'Y_SCALE',
        startX: e.clientX,
        startY: e.clientY,
        startPan: clampedPan,
        startYScale: yScaleFactor,
      };
      return;
    }

    // Ruler tool (Shift+Drag or Ruler button armed)
    if (rulerMode || e.shiftKey) {
      const rawIdx = Math.floor((x - geom.padLeft) / Math.max(1, geom.stepX));
      const idx = Math.max(0, Math.min(visibleRaw.length - 1, rawIdx));
      const price = geom.maxP - ((y - geom.padTop) / geom.chartH) * (geom.maxP - geom.minP);
      setRulerStart({ idx, price });
      setRulerEnd({ idx, price });
      dragRef.current = {
        mode: 'RULER',
        startX: e.clientX,
        startY: e.clientY,
        startPan: clampedPan,
        startYScale: yScaleFactor,
      };
      return;
    }

    // Clear existing ruler on normal click
    if (rulerStart || rulerEnd) {
      setRulerStart(null);
      setRulerEnd(null);
    }

    dragRef.current = {
      mode: 'PAN',
      startX: e.clientX,
      startY: e.clientY,
      startPan: clampedPan,
      startYScale: yScaleFactor,
    };
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const geom = geomRef.current;
    if (!geom) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > geom.padLeft + geom.chartW) {
      setYScaleFactor(1.0);
    }
  };

  const candleDelta = hoveredCandle ? hoveredCandle.close - hoveredCandle.open : 0;
  const candleDeltaPct = hoveredCandle && hoveredCandle.open > 0 ? (candleDelta / hoveredCandle.open) * 100 : 0;

  return (
    <section
      dir="ltr"
      aria-label="XAUUSD SMC Candlestick Chart"
      className={
        fullscreen
          ? 'fixed inset-0 z-50 bg-[#111827] flex flex-col overflow-hidden'
          : 'relative rounded-lg border border-white/8 bg-[#111827] overflow-hidden flex flex-col'
      }
    >
      {/* Embedded Multi-Agent Neural Pulse Pipeline + 5-Stage Sniper Bar + Cognitive Stream */}
      {hudEnabled && <AgentNeuralHud />}

      {/* Chart Toolbar — Strict LTR, Single-Row Desktop & Mobile-Safe Wrapping */}
      <div className="px-2.5 py-1.5 border-b border-white/8 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {/* Timeframe Selector */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B0F17] border border-white/8"
            role="group"
            aria-label="Timeframe selector"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  setPanOffset(0);
                  setRulerStart(null);
                  setRulerEnd(null);
                }}
                className={`px-1.5 py-0.5 text-[10.5px] font-mono font-medium rounded transition-colors whitespace-nowrap ${
                  timeframe === tf
                    ? 'bg-[#D4A853] text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-100'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* SMC Layer Toggles (flex-wrap prevents 390px horizontal overflow) */}
          <div
            className="flex flex-wrap items-center gap-1 text-xs"
            role="group"
            aria-label="SMC Overlay Layers"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500 hidden xl:inline shrink-0" aria-hidden="true" />
            {(
              [
                ['ob', 'OB/MT'],
                ['fvg', 'FVG/CE'],
                ['ote', 'OTE'],
                ['rsi', `RSI(${settings.rsiPeriod})`],
                ['structure', 'BOS'],
                ['liquidity', 'Liq'],
                ['tether', 'Tether'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => toggleLayer(key)}
                aria-pressed={layers[key]}
                data-testid={`chart-layer-${key}`}
                className={`px-1.5 py-0.5 rounded font-mono text-[10.5px] border transition-colors whitespace-nowrap ${
                  layers[key]
                    ? 'border-[#D4A853]/40 bg-[#D4A853]/12 text-[#E5BF70]'
                    : 'border-white/8 text-slate-500 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHudEnabled((v) => !v)}
              aria-pressed={hudEnabled}
              data-testid="chart-hud-toggle"
              title="Toggle Agentic Neural HUD, Scan Wave & Sniper Reticles"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10.5px] border transition-colors whitespace-nowrap ${
                hudEnabled
                  ? 'border-sky-400/50 bg-sky-500/14 text-sky-300'
                  : 'border-white/8 text-slate-500 hover:text-slate-300'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>HUD</span>
            </button>
          </div>
        </div>

        {/* Right Scalper Tools & Settings */}
        <div className="flex flex-wrap items-center gap-1 shrink-0">
          {(() => {
            const isDetached = clampedPan > 0 || Math.abs(yScaleFactor - 1.0) >= 0.02;
            const isLiveActive = streaming && !isDetached;
            const handleLiveClick = () => {
              if (!isLiveActive) {
                setPanOffset(0);
                setYScaleFactor(1.0);
                setHoverIdx(null);
                if (!streaming) {
                  toggleStreaming();
                }
              } else {
                toggleStreaming();
              }
            };
            return (
              <button
                type="button"
                onClick={handleLiveClick}
                aria-pressed={isLiveActive}
                aria-label={
                  isLiveActive
                    ? 'Live auto-follow active — click to pause live stream'
                    : 'Return to live edge and resume live stream'
                }
                title={
                  isLiveActive
                    ? 'Live Active (Click to Pause)'
                    : !streaming
                      ? 'Stream Paused — Click to Return to Live'
                      : 'History / Manual Scale — Click to Jump Back to Live'
                }
                data-testid="chart-live-toggle"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10.5px] font-mono font-medium border transition-colors whitespace-nowrap ${
                  isLiveActive
                    ? 'bg-emerald-500/14 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/22'
                    : 'bg-[#D4A853]/22 text-[#E5BF70] border-[#D4A853]/55 hover:bg-[#D4A853]/32'
                }`}
              >
                {isLiveActive ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                    <span>Live</span>
                  </>
                ) : !streaming ? (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Go Live</span>
                  </>
                ) : (
                  <>
                    <ArrowRightToLine className="w-3 h-3" />
                    <span>Go Live</span>
                  </>
                )}
              </button>
            );
          })()}

          <button
            type="button"
            onClick={() => {
              setRulerMode((v) => !v);
              if (rulerMode) {
                setRulerStart(null);
                setRulerEnd(null);
              }
            }}
            aria-pressed={rulerMode}
            aria-label="Measure price and bars (Shift+Drag)"
            title="Ruler Tool (or Shift+Drag)"
            data-testid="chart-ruler-btn"
            className={`p-1 rounded border transition-colors ${
              rulerMode
                ? 'border-[#D4A853]/60 bg-[#D4A853]/18 text-[#E5BF70]'
                : 'border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setVisibleCount((v) => Math.max(22, v - 16))}
            aria-label="Zoom in chart"
            className="p-1 rounded border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setVisibleCount((v) => Math.min(Math.max(120, rawCandles.length), v + 16))}
            aria-label="Zoom out chart"
            className="p-1 rounded border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setVisibleCount(84);
              setPanOffset(0);
              setYScaleFactor(1.0);
              setRulerStart(null);
              setRulerEnd(null);
            }}
            aria-label="Reset chart zoom and scale"
            title="Reset Zoom & Auto-Fit"
            className="p-1 rounded border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            aria-label="Chart settings and indicators"
            title="Chart & Indicator Settings"
            data-testid="chart-settings-btn"
            className={`p-1 rounded border transition-colors ${
              settingsOpen
                ? 'border-[#D4A853]/60 bg-[#D4A853]/18 text-[#E5BF70]'
                : 'border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            aria-label={fullscreen ? 'Exit fullscreen chart' : 'Expand chart fullscreen'}
            title={fullscreen ? 'Exit Fullscreen (Esc)' : 'Expand Fullscreen'}
            data-testid="chart-fullscreen-btn"
            className="p-1 rounded border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/5"
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setVectorModalOpen(true)}
            aria-label="Institutional SMC Vector Setup"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/6 hover:bg-white/10 text-[#E5BF70] border border-[#D4A853]/30 transition-colors whitespace-nowrap shrink-0"
          >
            <Compass className="w-3.5 h-3.5" />
            Vector
          </button>
        </div>
      </div>

      {/* Institutional Chart Settings Popover */}
      <ChartSettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
        onForceResync={() => void hydrateRealCandles(true)}
        candleSourceMeta={candleSourceMeta}
        barCount={rawCandles.length}
      />

      {/* OHLCV + Indicator Legend + Real Feed Badge (Strict LTR) */}
      {hoveredCandle && (
        <div
          dir="ltr"
          className="px-3 py-1 bg-[#0B0F17] border-b border-white/6 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[10.5px] font-mono tabular-nums text-slate-400"
        >
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="text-slate-100 font-semibold">XAUUSD · {timeframe}</span>
            <span>O {hoveredCandle.open.toFixed(2)}</span>
            <span>H {hoveredCandle.high.toFixed(2)}</span>
            <span>L {hoveredCandle.low.toFixed(2)}</span>
            <span className={candleDelta >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
              C {hoveredCandle.close.toFixed(2)} ({candleDelta >= 0 ? '+' : ''}
              {candleDelta.toFixed(2)} / {candleDelta >= 0 ? '+' : ''}
              {candleDeltaPct.toFixed(2)}%)
            </span>
            <span>Vol {hoveredCandle.volume}</span>
            {settings.showEma20 && Number.isFinite(hoveredEma20) && (
              <span className="text-sky-400">E20 {hoveredEma20.toFixed(1)}</span>
            )}
            {settings.showEma50 && Number.isFinite(hoveredEma50) && (
              <span className="text-amber-400">E50 {hoveredEma50.toFixed(1)}</span>
            )}
            {settings.showVwap && Number.isFinite(hoveredVwap) && (
              <span className="text-purple-400">VWAP {hoveredVwap.toFixed(1)}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px]">
            <span>
              RSI({settings.rsiPeriod}) {hoveredRsi.toFixed(1)}
            </span>
            <span>·</span>
            <span>ATR ${quant.regime.atr.toFixed(2)}</span>
            <span>·</span>
            <span>
              {quant.orderBlocks.length} OB / {quant.fvgs.length} FVG
            </span>
            <span>·</span>
            <span
              data-testid="chart-feed-badge"
              className={candleSourceMeta.liveHistorical ? 'text-emerald-400' : 'text-amber-400'}
              title={candleSourceMeta.source}
            >
              {candleSourceMeta.liveHistorical
                ? `${candleSourceMeta.storageBackend === 'timescaledb' ? 'TimescaleDB' : 'Live Calibrated'} · ${rawCandles.length}b`
                : 'Syncing Feed...'}
            </span>
          </div>
        </div>
      )}

      {/* Dual-Canvas 2D Viewport */}
      <div
        ref={containerRef}
        className={`relative w-full select-none cursor-crosshair touch-pan-y ${
          fullscreen ? 'flex-1 min-h-0' : 'min-h-[490px] lg:min-h-[515px]'
        }`}
        data-testid="smc-chart-container"
      >
        <canvas
          ref={baseCanvasRef}
          data-testid="smc-chart-canvas"
          className="block w-full h-full pointer-events-none"
        />
        <canvas
          ref={overlayCanvasRef}
          data-testid="smc-chart-overlay"
          onMouseMove={handlePointerMove}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              dragRef.current = {
                mode: 'PAN',
                startX: e.touches[0].clientX,
                startY: e.touches[0].clientY,
                startPan: clampedPan,
                startYScale: yScaleFactor,
              };
            }
          }}
          onTouchMove={(e) => {
            const geom = geomRef.current;
            if (e.touches.length === 1 && dragRef.current.mode === 'PAN' && geom) {
              const dx = e.touches[0].clientX - dragRef.current.startX;
              const shift = Math.round(dx / Math.max(3, geom.stepX));
              setPanOffset(Math.max(0, Math.min(maxPan, dragRef.current.startPan + shift)));
            }
          }}
          onTouchEnd={() => {
            dragRef.current.mode = 'NONE';
          }}
          onMouseLeave={() => {
            hoverStateRef.current = null;
            setHoverIdx(null);
            if (dragRef.current.mode !== 'RULER') {
              dragRef.current.mode = 'NONE';
            }
            scheduleOverlayDraw();
          }}
          className="absolute inset-0 block w-full h-full"
        />

        {clampedPan > 0 && (
          <button
            type="button"
            onClick={() => {
              setPanOffset(0);
              setYScaleFactor(1.0);
              setHoverIdx(null);
              if (!streaming) toggleStreaming();
            }}
            data-testid="chart-jump-live"
            aria-label="Jump back to live candle"
            className="absolute right-[84px] bottom-[34px] z-20 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-[#111827]/95 text-[#E5BF70] border border-[#D4A853]/50 shadow-lg hover:bg-[#D4A853]/20 transition-colors"
          >
            <ArrowRightToLine className="w-3.5 h-3.5" />
            <span>Back to Live</span>
          </button>
        )}
      </div>
    </section>
  );
}
