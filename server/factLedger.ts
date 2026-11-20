/**
 * Deterministic Anti-Hallucination Fact Ledger (Squad 2)
 *
 * Validates every numeric trade price returned by any AI sub-agent or external MCP client:
 * 1. Enforces strict geometric invariants:
 *    - LONG:  stopLoss < entry < tp1 < tp2
 *    - SHORT: stopLoss > entry > tp1 > tp2
 * 2. Enforces dynamic agentConfig.minRrRatio and structural minimum stop distance.
 * 3. Verifies that `entry` is anchored within tolerance (+/- 0.35 * ATR) of a genuine
 *    market/ICT ledger price (`spotPrice`, `fvg.ce50`, `fvg.top`, `fvg.bottom`, `ob.mt50`,
 *    or `ote.0.618 / 0.705 / 0.790`).
 * 4. If the AI hallucinates an unanchored entry price:
 *    - Attempts deterministic snapping to the nearest valid sniper anchor that satisfies
 *      all geometric, stop-distance, and R:R invariants.
 *    - Otherwise rejects the proposal cleanly with `decision: 'STAND_DOWN'`.
 */

export type TradeDirection = 'LONG' | 'SHORT';

export type LedgerAnchorKind =
  | 'SPOT_PRICE'
  | 'FVG_CE50'
  | 'FVG_TOP'
  | 'FVG_BOTTOM'
  | 'OB_MT50'
  | 'OB_HIGH'
  | 'OB_LOW'
  | 'OTE_618'
  | 'OTE_705'
  | 'OTE_790'
  | 'WATCHLIST_OPTIMAL';

export interface LedgerAnchor {
  price: number;
  kind: LedgerAnchorKind;
  id?: string;
  direction?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  label: string;
  mitigated?: boolean;
}

export interface LedgerFvgInput {
  id?: string;
  direction?: string;
  top: number;
  bottom: number;
  ce50?: number;
  mitigated?: boolean;
}

export interface LedgerOrderBlockInput {
  id?: string;
  direction?: string;
  high: number;
  low: number;
  mt50?: number;
  mitigated?: boolean;
}

export interface LedgerDealingRangeInput {
  swingHigh?: number;
  swingLow?: number;
  equilibrium50?: number;
  oteLongLow?: number;
  oteLongHigh?: number;
  oteLongSweetSpot?: number;
  oteShortLow?: number;
  oteShortHigh?: number;
  oteShortSweetSpot?: number;
}

export interface LedgerWatchlistZoneInput {
  direction?: string;
  entryLow?: number;
  entryHigh?: number;
  optimalEntry?: number;
  invalidationLevel?: number;
  targetLiquidity?: number;
}

export interface FactLedgerContext {
  spotPrice: number;
  spread?: number;
  atr: number;
  minRrRatio?: number;
  minStopDist?: number;
  anchorToleranceAtrMult?: number;
  maxSnapDistanceAtrMult?: number;
  fvgs?: LedgerFvgInput[];
  orderBlocks?: LedgerOrderBlockInput[];
  dealingRange?: LedgerDealingRangeInput | null;
  watchlistZone?: LedgerWatchlistZoneInput | null;
}

export interface ProposalPriceInput {
  direction: TradeDirection;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  invalidationPrice?: number;
}

export interface FactLedgerVerificationResult {
  valid: boolean;
  decision: 'PROPOSE' | 'STAND_DOWN';
  snapped: boolean;
  originalEntry: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  invalidationPrice: number;
  rrRatio: number;
  tp2RrRatio: number;
  stopDistance: number;
  minStopRequired: number;
  minRrRequired: number;
  anchorToleranceUsd: number;
  matchedAnchor: LedgerAnchor | null;
  anchorDeltaUsd: number;
  anchorsConsidered: number;
  errors: string[];
  warnings: string[];
  auditSummary: string;
}

const DEFAULT_ANCHOR_TOLERANCE_ATR_MULT = 0.35;
const DEFAULT_MAX_SNAP_ATR_MULT = 1.35;
const DEFAULT_MIN_RR_RATIO = 1.75;
const ABSOLUTE_MIN_RR_FLOOR = 1.5;

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function normalizeDirectionTag(dir?: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const upper = String(dir ?? '').toUpperCase();
  if (upper === 'BULLISH' || upper === 'LONG') return 'BULLISH';
  if (upper === 'BEARISH' || upper === 'SHORT') return 'BEARISH';
  return 'NEUTRAL';
}

/**
 * Computes structural minimum stop distance for XAU/USD.
 * Guarantees stops are never inside spread noise or tighter than ATR minimum.
 */
export function computeMinStopDistance(atr: number, spread = 0.24, explicitMinStop?: number): number {
  const safeAtr = isPositiveFinite(atr) ? atr : 3.5;
  const safeSpread = Number.isFinite(spread) && spread >= 0 ? spread : 0.24;
  const baseline = Math.max(1.5, safeAtr * 0.65, safeSpread * 3.5, safeAtr * 0.25);
  if (isPositiveFinite(explicitMinStop)) {
    return round2(Math.max(explicitMinStop, safeAtr * 0.25, safeSpread * 2.5));
  }
  return round2(baseline);
}

/**
 * Builds the deterministic ledger of genuine market & ICT anchor prices
 * from the active snapshot: spotPrice, FVG (ce50, top, bottom), OB (mt50),
 * Dealing Range OTE (0.618, 0.705, 0.790 / 0.786), and Watchlist optimal entry.
 */
export function buildLedgerAnchors(ctx: FactLedgerContext): LedgerAnchor[] {
  const anchors: LedgerAnchor[] = [];

  const pushAnchor = (anchor: LedgerAnchor) => {
    if (!isPositiveFinite(anchor.price)) return;
    const roundedPrice = round2(anchor.price);
    const duplicate = anchors.find(
      (a) => a.kind === anchor.kind && Math.abs(a.price - roundedPrice) < 0.01
    );
    if (!duplicate) {
      anchors.push({ ...anchor, price: roundedPrice });
    }
  };

  // 1. Live Spot Price
  if (isPositiveFinite(ctx.spotPrice)) {
    pushAnchor({
      price: ctx.spotPrice,
      kind: 'SPOT_PRICE',
      direction: 'NEUTRAL',
      label: `Spot ${round2(ctx.spotPrice).toFixed(2)}`,
    });
  }

  // 2. Fair Value Gaps (ce50, top, bottom)
  if (Array.isArray(ctx.fvgs)) {
    for (const fvg of ctx.fvgs) {
      if (!fvg) continue;
      const dir = normalizeDirectionTag(fvg.direction);
      const ce50 = isPositiveFinite(fvg.ce50)
        ? fvg.ce50
        : isPositiveFinite(fvg.top) && isPositiveFinite(fvg.bottom)
          ? (fvg.top + fvg.bottom) / 2
          : NaN;

      if (isPositiveFinite(ce50)) {
        pushAnchor({
          price: ce50,
          kind: 'FVG_CE50',
          id: fvg.id,
          direction: dir,
          mitigated: Boolean(fvg.mitigated),
          label: `FVG CE50 (${dir}) ${round2(ce50).toFixed(2)}`,
        });
      }
      if (isPositiveFinite(fvg.top)) {
        pushAnchor({
          price: fvg.top,
          kind: 'FVG_TOP',
          id: fvg.id,
          direction: dir,
          mitigated: Boolean(fvg.mitigated),
          label: `FVG Top (${dir}) ${round2(fvg.top).toFixed(2)}`,
        });
      }
      if (isPositiveFinite(fvg.bottom)) {
        pushAnchor({
          price: fvg.bottom,
          kind: 'FVG_BOTTOM',
          id: fvg.id,
          direction: dir,
          mitigated: Boolean(fvg.mitigated),
          label: `FVG Bottom (${dir}) ${round2(fvg.bottom).toFixed(2)}`,
        });
      }
    }
  }

  // 3. Order Blocks (mt50 primary sniper anchor + structural bounds)
  if (Array.isArray(ctx.orderBlocks)) {
    for (const ob of ctx.orderBlocks) {
      if (!ob) continue;
      const dir = normalizeDirectionTag(ob.direction);
      const mt50 = isPositiveFinite(ob.mt50)
        ? ob.mt50
        : isPositiveFinite(ob.high) && isPositiveFinite(ob.low)
          ? (ob.high + ob.low) / 2
          : NaN;

      if (isPositiveFinite(mt50)) {
        pushAnchor({
          price: mt50,
          kind: 'OB_MT50',
          id: ob.id,
          direction: dir,
          mitigated: Boolean(ob.mitigated),
          label: `OB MT50 (${dir}) ${round2(mt50).toFixed(2)}`,
        });
      }
    }
  }

  // 4. Optimal Trade Entry (OTE 0.618, 0.705, 0.790 / 0.786)
  const dr = ctx.dealingRange;
  if (dr) {
    if (isPositiveFinite(dr.oteLongHigh)) {
      pushAnchor({
        price: dr.oteLongHigh,
        kind: 'OTE_618',
        direction: 'BULLISH',
        label: `OTE Long 0.618 ${round2(dr.oteLongHigh).toFixed(2)}`,
      });
    }
    if (isPositiveFinite(dr.oteLongSweetSpot)) {
      pushAnchor({
        price: dr.oteLongSweetSpot,
        kind: 'OTE_705',
        direction: 'BULLISH',
        label: `OTE Long 0.705 ${round2(dr.oteLongSweetSpot).toFixed(2)}`,
      });
    }
    if (isPositiveFinite(dr.oteLongLow)) {
      pushAnchor({
        price: dr.oteLongLow,
        kind: 'OTE_790',
        direction: 'BULLISH',
        label: `OTE Long 0.786/0.790 ${round2(dr.oteLongLow).toFixed(2)}`,
      });
    }

    if (isPositiveFinite(dr.oteShortLow)) {
      pushAnchor({
        price: dr.oteShortLow,
        kind: 'OTE_618',
        direction: 'BEARISH',
        label: `OTE Short 0.618 ${round2(dr.oteShortLow).toFixed(2)}`,
      });
    }
    if (isPositiveFinite(dr.oteShortSweetSpot)) {
      pushAnchor({
        price: dr.oteShortSweetSpot,
        kind: 'OTE_705',
        direction: 'BEARISH',
        label: `OTE Short 0.705 ${round2(dr.oteShortSweetSpot).toFixed(2)}`,
      });
    }
    if (isPositiveFinite(dr.oteShortHigh)) {
      pushAnchor({
        price: dr.oteShortHigh,
        kind: 'OTE_790',
        direction: 'BEARISH',
        label: `OTE Short 0.786/0.790 ${round2(dr.oteShortHigh).toFixed(2)}`,
      });
    }

    // Explicitly derive exact 0.618, 0.705, and 0.790 levels when swingHigh & swingLow exist
    if (isPositiveFinite(dr.swingHigh) && isPositiveFinite(dr.swingLow) && dr.swingHigh > dr.swingLow) {
      const span = dr.swingHigh - dr.swingLow;
      pushAnchor({
        price: dr.swingHigh - span * 0.618,
        kind: 'OTE_618',
        direction: 'BULLISH',
        label: `Derived OTE Long 0.618 ${round2(dr.swingHigh - span * 0.618).toFixed(2)}`,
      });
      pushAnchor({
        price: dr.swingHigh - span * 0.705,
        kind: 'OTE_705',
        direction: 'BULLISH',
        label: `Derived OTE Long 0.705 ${round2(dr.swingHigh - span * 0.705).toFixed(2)}`,
      });
      pushAnchor({
        price: dr.swingHigh - span * 0.79,
        kind: 'OTE_790',
        direction: 'BULLISH',
        label: `Derived OTE Long 0.790 ${round2(dr.swingHigh - span * 0.79).toFixed(2)}`,
      });
      pushAnchor({
        price: dr.swingLow + span * 0.618,
        kind: 'OTE_618',
        direction: 'BEARISH',
        label: `Derived OTE Short 0.618 ${round2(dr.swingLow + span * 0.618).toFixed(2)}`,
      });
      pushAnchor({
        price: dr.swingLow + span * 0.705,
        kind: 'OTE_705',
        direction: 'BEARISH',
        label: `Derived OTE Short 0.705 ${round2(dr.swingLow + span * 0.705).toFixed(2)}`,
      });
      pushAnchor({
        price: dr.swingLow + span * 0.79,
        kind: 'OTE_790',
        direction: 'BEARISH',
        label: `Derived OTE Short 0.790 ${round2(dr.swingLow + span * 0.79).toFixed(2)}`,
      });
    }
  }

  // 5. Payam Brain Watchlist Optimal Entry
  if (ctx.watchlistZone && isPositiveFinite(ctx.watchlistZone.optimalEntry)) {
    pushAnchor({
      price: ctx.watchlistZone.optimalEntry,
      kind: 'WATCHLIST_OPTIMAL',
      direction: normalizeDirectionTag(ctx.watchlistZone.direction),
      label: `Watchlist Optimal ${round2(ctx.watchlistZone.optimalEntry).toFixed(2)}`,
    });
  }

  return anchors;
}

function checkGeometryAndRisk(
  direction: TradeDirection,
  entry: number,
  stopLoss: number,
  tp1: number,
  tp2: number,
  minStopRequired: number,
  minRrRequired: number
): { valid: boolean; rrRatio: number; tp2RrRatio: number; stopDistance: number; errors: string[] } {
  const errors: string[] = [];

  if (![entry, stopLoss, tp1, tp2].every(isPositiveFinite)) {
    errors.push('All trade prices (entry, stopLoss, tp1, tp2) must be positive finite numbers.');
    return { valid: false, rrRatio: 0, tp2RrRatio: 0, stopDistance: 0, errors };
  }

  if (direction === 'LONG') {
    if (!(stopLoss < entry && entry < tp1 && tp1 < tp2)) {
      errors.push(
        `LONG geometry invariant violated: requires SL (${stopLoss.toFixed(2)}) < Entry (${entry.toFixed(2)}) < TP1 (${tp1.toFixed(2)}) < TP2 (${tp2.toFixed(2)}).`
      );
    }
  } else {
    if (!(stopLoss > entry && entry > tp1 && tp1 > tp2)) {
      errors.push(
        `SHORT geometry invariant violated: requires SL (${stopLoss.toFixed(2)}) > Entry (${entry.toFixed(2)}) > TP1 (${tp1.toFixed(2)}) > TP2 (${tp2.toFixed(2)}).`
      );
    }
  }

  const stopDistance = round2(Math.abs(entry - stopLoss));
  const reward1 = Math.abs(tp1 - entry);
  const reward2 = Math.abs(tp2 - entry);
  const rrRatio = stopDistance > 0 ? round3(reward1 / stopDistance) : 0;
  const tp2RrRatio = stopDistance > 0 ? round3(reward2 / stopDistance) : 0;

  if (stopDistance < minStopRequired) {
    errors.push(
      `Stop distance $${stopDistance.toFixed(2)} is tighter than minimum structural stop $${minStopRequired.toFixed(2)}.`
    );
  }

  if (rrRatio < minRrRequired) {
    errors.push(
      `Risk-Reward ratio 1:${rrRatio.toFixed(2)} is below required dynamic minimum 1:${minRrRequired.toFixed(2)}.`
    );
  }

  return {
    valid: errors.length === 0,
    rrRatio: round2(rrRatio),
    tp2RrRatio: round2(tp2RrRatio),
    stopDistance,
    errors,
  };
}

function isAnchorDirectionCompatible(anchor: LedgerAnchor, direction: TradeDirection): boolean {
  if (!anchor.direction || anchor.direction === 'NEUTRAL') return true;
  return direction === 'LONG' ? anchor.direction === 'BULLISH' : anchor.direction === 'BEARISH';
}

/**
 * Deterministic Anti-Hallucination Fact Ledger Validator.
 * Validates strict price geometry, minimum structural stop distance, dynamic R:R ratio,
 * and +/- 0.35 * ATR entry anchoring against genuine ICT/market ledger prices.
 *
 * If entry is unanchored (AI hallucination), attempts deterministic snapping to the nearest
 * valid sniper anchor within maxSnapDistance; otherwise returns `decision: 'STAND_DOWN'`.
 */
export function verifyProposalAgainstFactLedger(
  proposal: ProposalPriceInput,
  ctx: FactLedgerContext
): FactLedgerVerificationResult {
  const atr = isPositiveFinite(ctx.atr) ? ctx.atr : 3.5;
  const spread = Number.isFinite(ctx.spread) && (ctx.spread as number) >= 0 ? (ctx.spread as number) : 0.24;
  const minRrRequired = round2(
    Math.max(
      ABSOLUTE_MIN_RR_FLOOR,
      isPositiveFinite(ctx.minRrRatio) ? ctx.minRrRatio : DEFAULT_MIN_RR_RATIO
    )
  );
  const minStopRequired = computeMinStopDistance(atr, spread, ctx.minStopDist);
  const tolMult = isPositiveFinite(ctx.anchorToleranceAtrMult)
    ? ctx.anchorToleranceAtrMult
    : DEFAULT_ANCHOR_TOLERANCE_ATR_MULT;
  const snapMult = isPositiveFinite(ctx.maxSnapDistanceAtrMult)
    ? ctx.maxSnapDistanceAtrMult
    : DEFAULT_MAX_SNAP_ATR_MULT;

  const anchorToleranceUsd = round2(Math.max(0.25, atr * tolMult));
  const maxSnapDistanceUsd = round2(Math.max(anchorToleranceUsd, atr * snapMult));

  const originalEntry = isPositiveFinite(proposal.entry) ? round2(proposal.entry) : 0;
  const stopLoss = isPositiveFinite(proposal.stopLoss) ? round2(proposal.stopLoss) : 0;
  const tp1 = isPositiveFinite(proposal.tp1) ? round2(proposal.tp1) : 0;
  const tp2 = isPositiveFinite(proposal.tp2) ? round2(proposal.tp2) : 0;

  const anchors = buildLedgerAnchors(ctx);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (![originalEntry, stopLoss, tp1, tp2].every(isPositiveFinite)) {
    const err = 'FactLedger rejected proposal: non-finite or non-positive price(s) returned by model.';
    return {
      valid: false,
      decision: 'STAND_DOWN',
      snapped: false,
      originalEntry,
      entry: originalEntry,
      stopLoss,
      tp1,
      tp2,
      invalidationPrice: stopLoss,
      rrRatio: 0,
      tp2RrRatio: 0,
      stopDistance: 0,
      minStopRequired,
      minRrRequired,
      anchorToleranceUsd,
      matchedAnchor: null,
      anchorDeltaUsd: Infinity,
      anchorsConsidered: anchors.length,
      errors: [err],
      warnings,
      auditSummary: err,
    };
  }

  // Sort candidate anchors by distance to proposed entry, prioritizing direction-compatible & unmitigated sniper anchors
  const rankedAnchors = anchors
    .map((anchor) => ({
      anchor,
      delta: round2(Math.abs(originalEntry - anchor.price)),
      dirMatch: isAnchorDirectionCompatible(anchor, proposal.direction),
      unmitigatedBonus: anchor.mitigated ? 1 : 0,
    }))
    .sort((a, b) => {
      if (Math.abs(a.delta - b.delta) > 0.05) return a.delta - b.delta;
      if (a.dirMatch !== b.dirMatch) return a.dirMatch ? -1 : 1;
      return a.unmitigatedBonus - b.unmitigatedBonus;
    });

  // First check if proposed entry is directly anchored within +/- 0.35 * ATR of a direction-compatible genuine ledger anchor
  // (SPOT_PRICE and NEUTRAL anchors are always compatible; opposing OTE/OB/FVG anchors are excluded)
  const directMatch =
    rankedAnchors.find((r) => r.delta <= anchorToleranceUsd && r.dirMatch) ?? null;

  let finalEntry = originalEntry;
  let matchedAnchor: LedgerAnchor | null = directMatch?.anchor ?? null;
  let anchorDeltaUsd = directMatch ? directMatch.delta : (rankedAnchors[0]?.delta ?? Infinity);
  let snapped = false;

  if (directMatch) {
    // Entry is genuinely anchored — validate geometry, minStop, and dynamic R:R
    const check = checkGeometryAndRisk(
      proposal.direction,
      finalEntry,
      stopLoss,
      tp1,
      tp2,
      minStopRequired,
      minRrRequired
    );

    if (!check.valid) {
      errors.push(...check.errors);
    }

    const inv = resolveInvalidationPrice(proposal.direction, finalEntry, stopLoss, proposal.invalidationPrice);

    return {
      valid: errors.length === 0,
      decision: errors.length === 0 ? 'PROPOSE' : 'STAND_DOWN',
      snapped: false,
      originalEntry,
      entry: finalEntry,
      stopLoss,
      tp1,
      tp2,
      invalidationPrice: inv,
      rrRatio: check.rrRatio,
      tp2RrRatio: check.tp2RrRatio,
      stopDistance: check.stopDistance,
      minStopRequired,
      minRrRequired,
      anchorToleranceUsd,
      matchedAnchor,
      anchorDeltaUsd,
      anchorsConsidered: anchors.length,
      errors,
      warnings,
      auditSummary:
        errors.length === 0
          ? `VERIFIED: Entry $${finalEntry.toFixed(2)} anchored within $${anchorDeltaUsd.toFixed(2)} (<= $${anchorToleranceUsd.toFixed(2)}) of ${directMatch.anchor.label}; R:R 1:${check.rrRatio.toFixed(2)}, SL dist $${check.stopDistance.toFixed(2)}.`
          : `REJECTED (STAND_DOWN): ${errors.join(' | ')}`,
    };
  }

  // Unanchored entry detected! Attempt deterministic snapping to nearest valid sniper anchor
  // within maxSnapDistanceUsd whose snapped geometry passes ALL invariants (geometry + minStop + minRR).
  const snapCandidates = rankedAnchors.filter(
    (r) => r.delta <= maxSnapDistanceUsd && (r.dirMatch || r.anchor.kind === 'SPOT_PRICE')
  );

  for (const candidate of snapCandidates) {
    const candidateCheck = checkGeometryAndRisk(
      proposal.direction,
      candidate.anchor.price,
      stopLoss,
      tp1,
      tp2,
      minStopRequired,
      minRrRequired
    );
    if (candidateCheck.valid) {
      finalEntry = candidate.anchor.price;
      matchedAnchor = candidate.anchor;
      anchorDeltaUsd = candidate.delta;
      snapped = true;
      warnings.push(
        `AI entry $${originalEntry.toFixed(2)} exceeded ±0.35×ATR tolerance ($${anchorToleranceUsd.toFixed(2)}); deterministically snapped by $${candidate.delta.toFixed(2)} to genuine ledger anchor ${candidate.anchor.label}.`
      );
      const inv = resolveInvalidationPrice(proposal.direction, finalEntry, stopLoss, proposal.invalidationPrice);

      return {
        valid: true,
        decision: 'PROPOSE',
        snapped: true,
        originalEntry,
        entry: finalEntry,
        stopLoss,
        tp1,
        tp2,
        invalidationPrice: inv,
        rrRatio: candidateCheck.rrRatio,
        tp2RrRatio: candidateCheck.tp2RrRatio,
        stopDistance: candidateCheck.stopDistance,
        minStopRequired,
        minRrRequired,
        anchorToleranceUsd,
        matchedAnchor,
        anchorDeltaUsd,
        anchorsConsidered: anchors.length,
        errors: [],
        warnings,
        auditSummary: `SNAPPED & VERIFIED: Entry $${originalEntry.toFixed(2)} -> $${finalEntry.toFixed(2)} (${candidate.anchor.label}); R:R 1:${candidateCheck.rrRatio.toFixed(2)}, SL dist $${candidateCheck.stopDistance.toFixed(2)}.`,
      };
    }
  }

  // No valid snap candidate found — reject hallucinated / geometrically broken proposal
  const rawCheck = checkGeometryAndRisk(
    proposal.direction,
    originalEntry,
    stopLoss,
    tp1,
    tp2,
    minStopRequired,
    minRrRequired
  );
  const nearest = rankedAnchors[0];
  errors.push(
    nearest
      ? `Hallucinated/unanchored entry $${originalEntry.toFixed(2)} is $${nearest.delta.toFixed(2)} away from nearest ledger anchor (${nearest.anchor.label}), exceeding ±0.35×ATR tolerance ($${anchorToleranceUsd.toFixed(2)}), and no valid snap candidate satisfied R:R >= 1:${minRrRequired.toFixed(2)} & stop >= $${minStopRequired.toFixed(2)}.`
      : `Entry $${originalEntry.toFixed(2)} has no genuine ledger anchor available.`
  );
  for (const e of rawCheck.errors) {
    if (!errors.includes(e)) errors.push(e);
  }

  return {
    valid: false,
    decision: 'STAND_DOWN',
    snapped: false,
    originalEntry,
    entry: originalEntry,
    stopLoss,
    tp1,
    tp2,
    invalidationPrice: stopLoss,
    rrRatio: rawCheck.rrRatio,
    tp2RrRatio: rawCheck.tp2RrRatio,
    stopDistance: rawCheck.stopDistance,
    minStopRequired,
    minRrRequired,
    anchorToleranceUsd,
    matchedAnchor: nearest?.anchor ?? null,
    anchorDeltaUsd: nearest?.delta ?? Infinity,
    anchorsConsidered: anchors.length,
    errors,
    warnings,
    auditSummary: `REJECTED (STAND_DOWN): ${errors.join(' | ')}`,
  };
}

function resolveInvalidationPrice(
  direction: TradeDirection,
  entry: number,
  stopLoss: number,
  proposedInvalidation?: number
): number {
  if (!isPositiveFinite(proposedInvalidation)) return stopLoss;
  const rounded = round2(proposedInvalidation);
  if (direction === 'LONG' && rounded < entry) return rounded;
  if (direction === 'SHORT' && rounded > entry) return rounded;
  return stopLoss;
}
