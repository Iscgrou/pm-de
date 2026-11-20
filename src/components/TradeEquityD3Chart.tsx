import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useAurumStore } from '../store/useStore';
import {
  buildTradePerformanceSeries,
  TRADE_EQUITY_WINDOW_SIZE,
} from '../engine/sessionRisk';
import { formatExitReasonFa } from '../engine/i18nFa';
import type { TradeEquityCurvePoint } from '../engine/types';

function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(0)}`;
}

function formatSignedUsd(value: number): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${value >= 0 ? '+' : '-'}$${abs}`;
}

export function TradeEquityD3Chart() {
  const simAccount = useAurumStore((s) => s.simAccount);
  const closedTrades = useAurumStore((s) => s.closedTrades);
  const confirmedPositions = useAurumStore((s) => s.confirmedPositions);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(400);
  const [showDrawdown, setShowDrawdown] = useState<boolean>(true);
  const [showSharpe, setShowSharpe] = useState<boolean>(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const series = useMemo(
    () =>
      buildTradePerformanceSeries({
        initialBalance: simAccount.initialBalance,
        closedTrades,
        confirmedPositions,
        maxEntries: TRADE_EQUITY_WINDOW_SIZE,
      }),
    [simAccount.initialBalance, closedTrades, confirmedPositions]
  );

  // Measure responsive container width cleanly via ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateWidth = () => {
      const next = Math.max(260, Math.floor(el.getBoundingClientRect().width));
      setChartWidth(next);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep hovered index in bounds if trade count shrinks (e.g. account reset)
  const clampedHoverIdx =
    hoveredIdx !== null && hoveredIdx >= 0 && hoveredIdx < series.points.length
      ? hoveredIdx
      : null;

  const inspectedPoint: TradeEquityCurvePoint | null =
    series.points.length > 0
      ? series.points[clampedHoverIdx ?? series.points.length - 1]
      : null;

  const showLowerTier = showDrawdown || showSharpe;
  const upperHeight = 114;
  const panelGap = showLowerTier ? 16 : 0;
  const lowerHeight = showLowerTier ? 66 : 0;
  const margin = {
    top: 10,
    right: showDrawdown && showLowerTier ? 38 : 14,
    bottom: 22,
    left: 46,
  };
  const svgHeight = margin.top + upperHeight + panelGap + lowerHeight + margin.bottom;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const pts = series.points;
    if (pts.length === 0) return;

    const innerWidth = Math.max(120, chartWidth - margin.left - margin.right);
    const lowerTop = upperHeight + panelGap;

    // Plot domain starts at 0 (window baseline anchor) through max(pts.length, 2)
    // so even a 1-trade session renders a clear directional line segment.
    const xMax = Math.max(pts.length, 2);
    const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerWidth]);

    // Equity scale includes baseline, all equity points, and peak equity markers
    const eqValues = [
      series.baselineEquity,
      ...pts.flatMap((p) => [p.equity, p.peakEquity]),
    ];
    let eqMin = d3.min(eqValues) ?? series.baselineEquity;
    let eqMax = d3.max(eqValues) ?? series.baselineEquity;
    const eqSpan = eqMax - eqMin;
    const eqPad = eqSpan < 10 ? 40 : eqSpan * 0.1;
    eqMin -= eqPad;
    eqMax += eqPad;

    const yEq = d3.scaleLinear().domain([eqMin, eqMax]).range([upperHeight, 0]);

    // SVG Definitions: gradients & clip paths
    const defs = svg.append('defs');

    const eqGrad = defs
      .append('linearGradient')
      .attr('id', 'aurum-d3-eq-fill')
      .attr('x1', '0')
      .attr('y1', '0')
      .attr('x2', '0')
      .attr('y2', '1');
    eqGrad.append('stop').attr('offset', '0%').attr('stop-color', '#D4A853').attr('stop-opacity', 0.2);
    eqGrad.append('stop').attr('offset', '100%').attr('stop-color', '#D4A853').attr('stop-opacity', 0.0);

    const ddGrad = defs
      .append('linearGradient')
      .attr('id', 'aurum-d3-dd-fill')
      .attr('x1', '0')
      .attr('y1', '0')
      .attr('x2', '0')
      .attr('y2', '1');
    ddGrad.append('stop').attr('offset', '0%').attr('stop-color', '#EF4444').attr('stop-opacity', 0.3);
    ddGrad.append('stop').attr('offset', '100%').attr('stop-color', '#EF4444').attr('stop-opacity', 0.08);

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // -------------------------------------------------------------------------
    // UPPER TIER: Equity Curve + Peak High-Water Mark + Underwater Drawdown Fill
    // -------------------------------------------------------------------------
    const upperGroup = root.append('g').attr('class', 'd3-equity-tier');

    // Horizontal gridlines
    upperGroup
      .append('g')
      .attr('class', 'd3-eq-grid')
      .call(
        d3
          .axisLeft(yEq)
          .ticks(4)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('line')
          .attr('stroke', 'rgba(255,255,255,0.05)')
          .attr('stroke-dasharray', '2 3')
      );

    // Left Equity Y-Axis
    upperGroup
      .append('g')
      .attr('class', 'd3-eq-axis')
      .call(
        d3
          .axisLeft(yEq)
          .ticks(4)
          .tickSize(0)
          .tickPadding(6)
          .tickFormat((d) => formatCurrencyCompact(Number(d)))
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('text')
          .attr('fill', '#94A3B8')
          .attr('font-size', '9px')
          .attr('font-family', 'var(--font-mono)')
      );

    // Baseline starting-equity reference line
    upperGroup
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yEq(series.baselineEquity))
      .attr('y2', yEq(series.baselineEquity))
      .attr('stroke', 'rgba(226, 232, 240, 0.18)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3');

    // Prepend baseline anchor (x = 0) for continuous line geometry
    interface PlotEqNode {
      x: number;
      equity: number;
      peakEquity: number;
    }
    const eqNodes: PlotEqNode[] = [
      { x: 0, equity: series.baselineEquity, peakEquity: series.baselineEquity },
      ...pts.map((p) => ({
        x: p.slotIndex,
        equity: p.equity,
        peakEquity: p.peakEquity,
      })),
    ];

    // Subtle gold gradient fill under equity curve
    const eqAreaGen = d3
      .area<PlotEqNode>()
      .x((d) => xScale(d.x))
      .y0(upperHeight)
      .y1((d) => yEq(d.equity))
      .curve(d3.curveLinear);

    upperGroup
      .append('path')
      .datum(eqNodes)
      .attr('fill', 'url(#aurum-d3-eq-fill)')
      .attr('d', eqAreaGen);

    // Underwater Drawdown Shaded Zone + High-Water Mark dashed line (exact matching linear geometry)
    if (showDrawdown) {
      const underwaterAreaGen = d3
        .area<PlotEqNode>()
        .x((d) => xScale(d.x))
        .y0((d) => yEq(d.peakEquity))
        .y1((d) => yEq(d.equity))
        .curve(d3.curveLinear);

      upperGroup
        .append('path')
        .datum(eqNodes)
        .attr('data-series', 'underwater-drawdown-area')
        .attr('fill', 'url(#aurum-d3-dd-fill)')
        .attr('d', underwaterAreaGen);

      const peakLineGen = d3
        .line<PlotEqNode>()
        .x((d) => xScale(d.x))
        .y((d) => yEq(d.peakEquity))
        .curve(d3.curveLinear);

      upperGroup
        .append('path')
        .datum(eqNodes)
        .attr('data-series', 'peak-equity-line')
        .attr('fill', 'none')
        .attr('stroke', 'rgba(148, 163, 184, 0.42)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '2 2')
        .attr('d', peakLineGen);
    }

    // Primary D3 Equity Line (crisp institutional trade-by-trade segments)
    const eqLineGen = d3
      .line<PlotEqNode>()
      .x((d) => xScale(d.x))
      .y((d) => yEq(d.equity))
      .curve(d3.curveLinear);

    upperGroup
      .append('path')
      .datum(eqNodes)
      .attr('data-series', 'equity-curve-line')
      .attr('fill', 'none')
      .attr('stroke', '#D4A853')
      .attr('stroke-width', 1.9)
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('d', eqLineGen);

    // Trade Entry Dots along the Equity Curve
    upperGroup
      .selectAll<SVGCircleElement, TradeEquityCurvePoint>('circle.d3-trade-dot')
      .data(pts)
      .join('circle')
      .attr('class', 'd3-trade-dot')
      .attr('cx', (d) => xScale(d.slotIndex))
      .attr('cy', (d) => yEq(d.equity))
      .attr('r', (d) => (d.isLive ? 3.5 : 2.3))
      .attr('fill', (d) =>
        d.isLive ? '#E5BF70' : d.netPnl >= 0 ? '#10B981' : '#EF4444'
      )
      .attr('stroke', '#0B0F17')
      .attr('stroke-width', 1);

    // -------------------------------------------------------------------------
    // LOWER SYNCHRONIZED TIER: Rolling Sharpe Ratio Line + Drawdown % Depth
    // -------------------------------------------------------------------------
    let ySharpe: d3.ScaleLinear<number, number> | null = null;
    let yDd: d3.ScaleLinear<number, number> | null = null;

    if (showLowerTier) {
      // Hairline tier divider
      root
        .append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', upperHeight + panelGap / 2)
        .attr('y2', upperHeight + panelGap / 2)
        .attr('stroke', 'rgba(255,255,255,0.08)')
        .attr('stroke-width', 1);

      const lowerGroup = root
        .append('g')
        .attr('class', 'd3-sub-tier')
        .attr('transform', `translate(0,${lowerTop})`);

      // Drawdown % scale (inverted: 0% at top, maxDD% at bottom)
      const ddCeiling = Math.max(1.0, Math.ceil(series.maxDrawdownPct * 1.2 * 10) / 10);
      yDd = d3.scaleLinear().domain([0, ddCeiling]).range([0, lowerHeight]);

      // Rolling Sharpe scale: ignore isolated n=2 warm-up spike when >=4 trades exist
      // so steady-state Sharpe trajectory across trades #3..#20 has crisp vertical clarity.
      const validSharpes = pts
        .map((p) => p.rollingSharpe)
        .filter((v): v is number => v !== null && Number.isFinite(v));
      const steadySharpes =
        pts.length >= 4
          ? pts
              .slice(2)
              .map((p) => p.rollingSharpe)
              .filter((v): v is number => v !== null && Number.isFinite(v))
          : validSharpes;
      const scaleSource = steadySharpes.length > 0 ? steadySharpes : validSharpes;
      const rawMinS = scaleSource.length > 0 ? Math.min(-0.2, ...scaleSource) : -0.5;
      const rawMaxS = scaleSource.length > 0 ? Math.max(1.0, ...scaleSource) : 1.5;
      const sSpan = Math.max(0.6, rawMaxS - rawMinS);
      const sPad = sSpan * 0.18;
      ySharpe = d3
        .scaleLinear()
        .domain([rawMinS - sPad, rawMaxS + sPad])
        .range([lowerHeight, 0])
        .clamp(true);

      // Drawdown % underwater area + right axis
      if (showDrawdown) {
        const ddSubArea = d3
          .area<TradeEquityCurvePoint>()
          .x((d) => xScale(d.slotIndex))
          .y0(yDd(0))
          .y1((d) => yDd!(d.drawdownPct))
          .curve(d3.curveLinear);

        const ddSubLine = d3
          .line<TradeEquityCurvePoint>()
          .x((d) => xScale(d.slotIndex))
          .y((d) => yDd!(d.drawdownPct))
          .curve(d3.curveLinear);

        lowerGroup
          .append('path')
          .datum(pts)
          .attr('data-series', 'drawdown-pct-area')
          .attr('fill', 'rgba(239, 68, 68, 0.18)')
          .attr('d', ddSubArea);

        lowerGroup
          .append('path')
          .datum(pts)
          .attr('data-series', 'drawdown-pct-line')
          .attr('fill', 'none')
          .attr('stroke', 'rgba(248, 113, 113, 0.8)')
          .attr('stroke-width', 1.2)
          .attr('d', ddSubLine);

        lowerGroup
          .append('g')
          .attr('class', 'd3-dd-axis')
          .attr('transform', `translate(${innerWidth},0)`)
          .call(
            d3
              .axisRight(yDd)
              .tickValues([0, ddCeiling / 2, ddCeiling])
              .tickSize(0)
              .tickPadding(5)
              .tickFormat((d) => {
                const v = Number(d);
                return v === 0 ? '0%' : `-${v.toFixed(1)}%`;
              })
          )
          .call((g) => g.select('.domain').remove())
          .call((g) =>
            g
              .selectAll('text')
              .attr('fill', '#F87171')
              .attr('font-size', '8.5px')
              .attr('font-family', 'var(--font-mono)')
          );
      }

      // Rolling Sharpe Ratio Line + left axis + 0.0 baseline
      if (showSharpe) {
        const zeroY = ySharpe(0);
        if (zeroY >= 0 && zeroY <= lowerHeight) {
          lowerGroup
            .append('line')
            .attr('x1', 0)
            .attr('x2', innerWidth)
            .attr('y1', zeroY)
            .attr('y2', zeroY)
            .attr('stroke', 'rgba(56, 189, 248, 0.26)')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2 3');
        }

        const [sDomMin, sDomMax] = ySharpe.domain();
        const sMid = Math.round(((sDomMin + sDomMax) / 2) * 10) / 10;
        const sharpeTicks = Array.from(
          new Set([
            Number(sDomMin.toFixed(1)),
            0,
            sMid,
            Number(sDomMax.toFixed(1)),
          ])
        )
          .filter((v) => v >= sDomMin - 0.01 && v <= sDomMax + 0.01)
          .sort((a, b) => a - b);

        lowerGroup
          .append('g')
          .attr('class', 'd3-sharpe-axis')
          .call(
            d3
              .axisLeft(ySharpe)
              .tickValues(
                sharpeTicks.length > 3
                  ? [sharpeTicks[0], 0, sharpeTicks[sharpeTicks.length - 1]]
                  : sharpeTicks
              )
              .tickSize(0)
              .tickPadding(6)
              .tickFormat((d) => {
                const v = Number(d);
                return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
              })
          )
          .call((g) => g.select('.domain').remove())
          .call((g) =>
            g
              .selectAll('text')
              .attr('fill', '#7DD3FC')
              .attr('font-size', '8.5px')
              .attr('font-family', 'var(--font-mono)')
          );

        if (validSharpes.length >= 2) {
          const sharpeLineGen = d3
            .line<TradeEquityCurvePoint>()
            .defined((d) => d.rollingSharpe !== null && Number.isFinite(d.rollingSharpe))
            .x((d) => xScale(d.slotIndex))
            .y((d) => ySharpe!(d.rollingSharpe as number))
            .curve(d3.curveMonotoneX);

          lowerGroup
            .append('path')
            .datum(pts)
            .attr('data-series', 'sharpe-ratio-line')
            .attr('fill', 'none')
            .attr('stroke', '#38BDF8')
            .attr('stroke-width', 1.75)
            .attr('stroke-linecap', 'round')
            .attr('d', sharpeLineGen);
        } else if (validSharpes.length === 1) {
          const onlyPt = pts.find((p) => p.rollingSharpe !== null);
          if (onlyPt) {
            lowerGroup
              .append('circle')
              .attr('data-series', 'sharpe-ratio-dot')
              .attr('cx', xScale(onlyPt.slotIndex))
              .attr('cy', ySharpe(onlyPt.rollingSharpe as number))
              .attr('r', 3)
              .attr('fill', '#38BDF8');
          }
        } else {
          lowerGroup
            .append('text')
            .attr('x', innerWidth / 2)
            .attr('y', lowerHeight / 2 + 3)
            .attr('text-anchor', 'middle')
            .attr('fill', '#64748B')
            .attr('font-size', '9.5px')
            .attr('font-family', 'var(--font-fa)')
            .text('نسبت شارپ متحرک از ۲ معامله به بالا فعال می‌شود');
        }
      }
    }

    // -------------------------------------------------------------------------
    // SHARED BOTTOM X-AXIS (Trade Entry Numbers across Last 20 Window)
    // -------------------------------------------------------------------------
    const axisY = showLowerTier ? lowerTop + lowerHeight : upperHeight;
    const desiredTicks =
      pts.length <= 5
        ? pts.map((p) => p.slotIndex)
        : [
            1,
            Math.round(pts.length * 0.25),
            Math.round(pts.length * 0.5),
            Math.round(pts.length * 0.75),
            pts.length,
          ].filter((v, i, arr) => v >= 1 && arr.indexOf(v) === i);

    root
      .append('g')
      .attr('class', 'd3-x-axis')
      .attr('transform', `translate(0,${axisY})`)
      .call(
        d3
          .axisBottom(xScale)
          .tickValues(desiredTicks)
          .tickSize(3)
          .tickPadding(5)
          .tickFormat((d) => {
            const slot = Number(d);
            const match = pts[slot - 1];
            return match ? `#${match.globalIndex}` : `T${slot}`;
          })
      )
      .call((g) => g.select('.domain').attr('stroke', 'rgba(255,255,255,0.12)'))
      .call((g) => g.selectAll('line').attr('stroke', 'rgba(255,255,255,0.18)'))
      .call((g) =>
        g
          .selectAll('text')
          .attr('fill', '#94A3B8')
          .attr('font-size', '9px')
          .attr('font-family', 'var(--font-mono)')
      );

    // -------------------------------------------------------------------------
    // SYNCHRONIZED ACTIVE CROSSHAIR & FOCUS MARKERS
    // -------------------------------------------------------------------------
    const focusIdx = clampedHoverIdx ?? pts.length - 1;
    const focusPt = pts[focusIdx];
    if (focusPt) {
      const fx = xScale(focusPt.slotIndex);
      const fyEq = yEq(focusPt.equity);

      const crosshairGroup = root.append('g').attr('class', 'd3-crosshair');

      if (clampedHoverIdx !== null) {
        crosshairGroup
          .append('line')
          .attr('x1', fx)
          .attr('x2', fx)
          .attr('y1', 0)
          .attr('y2', axisY)
          .attr('stroke', 'rgba(229, 191, 112, 0.45)')
          .attr('stroke-width', 1)
          .attr('stroke-dasharray', '2 2');
      }

      // Equity focus ring
      crosshairGroup
        .append('circle')
        .attr('cx', fx)
        .attr('cy', fyEq)
        .attr('r', clampedHoverIdx !== null ? 5 : 4.2)
        .attr('fill', 'none')
        .attr('stroke', '#E5BF70')
        .attr('stroke-width', 1.4);

      if (showLowerTier && showSharpe && ySharpe && focusPt.rollingSharpe !== null) {
        crosshairGroup
          .append('circle')
          .attr('cx', fx)
          .attr('cy', lowerTop + ySharpe(focusPt.rollingSharpe))
          .attr('r', 3.4)
          .attr('fill', '#38BDF8')
          .attr('stroke', '#0B0F17')
          .attr('stroke-width', 1.2);
      }

      if (showLowerTier && showDrawdown && yDd) {
        crosshairGroup
          .append('circle')
          .attr('cx', fx)
          .attr('cy', lowerTop + yDd(focusPt.drawdownPct))
          .attr('r', 2.8)
          .attr('fill', '#F87171')
          .attr('stroke', '#0B0F17')
          .attr('stroke-width', 1);
      }
    }

    // Full-plot transparent interaction overlay for smooth pointer tracking
    root
      .append('rect')
      .attr('x', 0)
      .attr('y', 0)
      .attr('width', innerWidth)
      .attr('height', axisY)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointermove', (event: PointerEvent) => {
        const [mx] = d3.pointer(event);
        const rawSlot = Math.round(xScale.invert(mx));
        const idx = Math.max(0, Math.min(pts.length - 1, rawSlot - 1));
        setHoveredIdx(idx);
      })
      .on('pointerleave', () => {
        setHoveredIdx(null);
      });
  }, [
    series,
    chartWidth,
    showDrawdown,
    showSharpe,
    showLowerTier,
    clampedHoverIdx,
    margin.left,
    margin.right,
    margin.top,
    panelGap,
    lowerHeight,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (series.points.length === 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoveredIdx((prev) => {
        const cur = prev ?? series.points.length - 1;
        return Math.max(0, cur - 1);
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoveredIdx((prev) => {
        const cur = prev ?? series.points.length - 1;
        return Math.min(series.points.length - 1, cur + 1);
      });
    } else if (e.key === 'Escape') {
      setHoveredIdx(null);
    }
  };

  return (
    <div
      data-testid="trade-equity-d3-chart"
      aria-label="نمودار D3 منحنی اکوئیتی، دراوداون و نسبت شارپ معاملات شبیه‌ساز"
      className="px-4 py-3 border-b border-white/8 bg-[#0B0F17]/95 space-y-2"
    >
      {/* Header Row: Title + Window Context + Interactive Series Toggles */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5 text-[11px]">
          <span className="font-medium text-slate-200 whitespace-nowrap">
            منحنی اکوئیتی
          </span>
          <span className="text-slate-600" aria-hidden="true">
            ·
          </span>
          <span
            className="text-[10px] text-slate-400 tabular-nums truncate"
            data-testid="d3-window-counter"
          >
            آخرین {series.points.length} از {series.windowLimit} معامله
          </span>
        </div>

        <div
          role="group"
          aria-label="لایه‌های نمودار عملکرد"
          className="flex items-center gap-1 text-[10px] shrink-0"
        >
          <button
            type="button"
            aria-pressed={showDrawdown}
            data-testid="d3-toggle-drawdown"
            onClick={() => setShowDrawdown((v) => !v)}
            className={`px-2 py-0.5 rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showDrawdown
                ? 'border-red-500/40 bg-red-500/12 text-red-300'
                : 'border-white/10 text-slate-500 hover:text-slate-300'
            }`}
          >
            دراوداون
          </button>
          <button
            type="button"
            aria-pressed={showSharpe}
            data-testid="d3-toggle-sharpe"
            onClick={() => setShowSharpe((v) => !v)}
            className={`px-2 py-0.5 rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showSharpe
                ? 'border-sky-400/40 bg-sky-400/12 text-sky-300'
                : 'border-white/10 text-slate-500 hover:text-slate-300'
            }`}
          >
            نسبت شارپ
          </button>
        </div>
      </div>

      {/* Empty State vs Populated D3 Chart */}
      {series.points.length === 0 ? (
        <div
          data-testid="d3-equity-empty"
          className="py-6 px-3 text-center rounded border border-dashed border-white/10 bg-[#111827]/50 space-y-1"
        >
          <p className="text-xs text-slate-300">هنوز معامله شبیه‌سازی‌شده‌ای ثبت نشده است.</p>
          <p className="text-[11px] text-slate-500">
            برای رسم زنده منحنی اکوئیتی، دراوداون و نسبت شارپ متحرک در ۲۰ معامله اخیر، یک پیشنهاد را تایید کنید.
          </p>
        </div>
      ) : (
        <>
          {/* Fixed-Height Synchronized Trade Inspection Strip (Zero Layout Shift / Zero Clipping) */}
          {inspectedPoint && (
            <div
              data-testid="d3-trade-readout"
              className="rounded bg-[#111827]/90 border border-white/6 px-2.5 py-1.5 text-[10px] tabular-nums space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex items-center gap-1.5 truncate">
                  <span className="font-mono text-[#E5BF70] font-semibold" dir="ltr">
                    #{inspectedPoint.globalIndex}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      inspectedPoint.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {inspectedPoint.direction}
                  </span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-300 truncate">{inspectedPoint.setupType}</span>
                </div>
                <span className="text-slate-400 shrink-0">
                  {formatExitReasonFa(inspectedPoint.exitReason)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-slate-200">
                  اکوئیتی{' '}
                  <strong className="font-mono text-[#E5BF70] font-semibold" dir="ltr">
                    $
                    {inspectedPoint.equity.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                </span>
                <span
                  dir="ltr"
                  className={`font-mono ${
                    inspectedPoint.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {formatSignedUsd(inspectedPoint.netPnl)} ({inspectedPoint.rMultiple >= 0 ? '+' : ''}
                  {inspectedPoint.rMultiple.toFixed(2)}R)
                </span>
                <span
                  dir="ltr"
                  className={`font-mono ${
                    inspectedPoint.drawdownPct > 0 ? 'text-red-400' : 'text-emerald-400'
                  }`}
                >
                  DD {inspectedPoint.drawdownPct > 0 ? `-${inspectedPoint.drawdownPct.toFixed(2)}%` : '0.00%'}
                </span>
                <span className="text-sky-300">
                  شارپ{' '}
                  <span className="font-mono" dir="ltr">
                    {inspectedPoint.rollingSharpe !== null
                      ? `${inspectedPoint.rollingSharpe >= 0 ? '+' : ''}${inspectedPoint.rollingSharpe.toFixed(2)}`
                      : '—'}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Responsive D3.js SVG Container (Keyboard & Pointer Accessible) */}
          <div
            ref={containerRef}
            dir="ltr"
            tabIndex={0}
            role="region"
            aria-label={`نمودار تعاملی D3 منحنی اکوئیتی در ${series.points.length} معامله اخیر. از کلیدهای چپ و راست برای بررسی هر معامله استفاده کنید.`}
            onKeyDown={handleKeyDown}
            className="w-full focus:outline-none focus-visible:ring-1 focus-visible:ring-[#D4A853]/60 rounded"
          >
            <svg
              ref={svgRef}
              width={chartWidth}
              height={svgHeight}
              data-testid="d3-equity-svg"
              className="w-full block select-none overflow-visible"
            />
          </div>

          {/* Unboxed Legend & Window Summary Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[10px] text-slate-400 tabular-nums">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 bg-[#D4A853] inline-block" aria-hidden="true" />
                <span>اکوئیتی</span>
              </span>
              {showDrawdown && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-red-400 inline-block" aria-hidden="true" />
                  <span>
                    حداکثر DD{' '}
                    <span className="font-mono" dir="ltr">
                      -{series.maxDrawdownPct.toFixed(2)}%
                    </span>
                  </span>
                </span>
              )}
              {showSharpe && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-0.5 bg-sky-400 inline-block" aria-hidden="true" />
                  <span>
                    شارپ{' '}
                    <span className="font-mono" dir="ltr">
                      {series.latestSharpe !== null
                        ? `${series.latestSharpe >= 0 ? '+' : ''}${series.latestSharpe.toFixed(2)}`
                        : '—'}
                    </span>
                  </span>
                </span>
              )}
            </div>

            <span className={series.windowNetPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              <span className="font-mono" dir="ltr">
                {series.windowReturnPct >= 0 ? '+' : ''}
                {series.windowReturnPct.toFixed(2)}%
              </span>{' '}
              · نرخ برد{' '}
              <span className="font-mono" dir="ltr">
                {series.winRatePct.toFixed(0)}%
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
