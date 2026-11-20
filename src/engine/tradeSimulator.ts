import { evaluateConfirmedPositionAdvice, validateTradeGuardrails } from './smcQuant';
import type {
  AgentProposal,
  BasisDivergence,
  ClosedTradeRecord,
  ConfirmedPosition,
  NewsGateStatus,
  OrderExecutionType,
  QuantSnapshot,
  SimAccountMetrics,
  SimAccountState,
  SimExecutionEvent,
  Tick,
} from './types';

export const GOLD_CONTRACT_OZ = 100;
export const DEFAULT_INITIAL_BALANCE = 25000;
export const DEFAULT_LEVERAGE = 100;
export const DEFAULT_COMMISSION_PER_LOT_RT = 7.0;
export const MARGIN_STOP_OUT_PCT = 20;

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function makeEvent(
  kind: SimExecutionEvent['kind'],
  message: string,
  price: number,
  timeMs: number,
  pnlDelta?: number
): SimExecutionEvent {
  return {
    id: `ev-${timeMs.toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`,
    timeMs,
    kind,
    message,
    price: round2(price),
    ...(pnlDelta !== undefined ? { pnlDelta: round2(pnlDelta) } : {}),
  };
}

export function createInitialSimAccount(
  initialBalance = DEFAULT_INITIAL_BALANCE,
  leverage = DEFAULT_LEVERAGE,
  commissionPerLotRoundTurn = DEFAULT_COMMISSION_PER_LOT_RT
): SimAccountState {
  const bal = round2(Math.max(1000, initialBalance));
  return {
    initialBalance: bal,
    balance: bal,
    equity: bal,
    usedMargin: 0,
    freeMargin: bal,
    marginLevelPct: null,
    leverage,
    commissionPerLotRoundTurn,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalCommissionPaid: 0,
    peakEquity: bal,
    maxDrawdownPct: 0,
    winCount: 0,
    lossCount: 0,
    grossProfit: 0,
    grossLoss: 0,
  };
}

/**
 * Exact institutional XAUUSD margin requirement:
 * 1.00 lot = 100 troy oz -> notional = price * lotSize * 100 -> margin = notional / leverage.
 */
export function calculateRequiredMargin(price: number, lotSize: number, leverage = DEFAULT_LEVERAGE): number {
  if (!Number.isFinite(price) || !Number.isFinite(lotSize) || price <= 0 || lotSize <= 0) return 0;
  return round2((price * lotSize * GOLD_CONTRACT_OZ) / Math.max(1, leverage));
}

/**
 * Risk-based position sizer: computes exact XAUUSD lot size for a target % equity risk.
 */
export function calculateRiskBasedLotSize(
  equity: number,
  riskPct: number,
  entry: number,
  stopLoss: number
): number {
  const riskUsd = Math.max(10, equity * (Math.max(0.1, Math.min(10, riskPct)) / 100));
  const stopDist = Math.abs(entry - stopLoss);
  if (!Number.isFinite(stopDist) || stopDist < 0.25) return 0.1;
  const rawLots = riskUsd / (stopDist * GOLD_CONTRACT_OZ);
  return round2(Math.max(0.01, Math.min(10, Math.floor(rawLots * 100) / 100)));
}

/**
 * Computes realistic broker execution fill price including Bid/Ask crossing & micro-slippage.
 * Market LONG fills at Ask + slippage; Market SHORT fills at Bid - slippage.
 * Limit orders fill cleanly at the requested limit price with zero slippage.
 */
export function calculateExecutionFill(
  direction: 'LONG' | 'SHORT',
  tick: Tick,
  executionType: OrderExecutionType,
  requestedEntry: number,
  lotSize: number,
  atr: number
): { fillPrice: number; slippageUsd: number } {
  if (executionType === 'LIMIT') {
    return { fillPrice: round2(requestedEntry), slippageUsd: 0 };
  }
  const volFactor = Math.min(0.05, Math.max(0.01, atr * 0.006));
  const sizeFactor = Math.min(0.04, lotSize * 0.02);
  const slippageUsd = round2(Math.min(0.09, volFactor + sizeFactor));
  const rawFill = direction === 'LONG' ? tick.ask + slippageUsd : tick.bid - slippageUsd;
  return { fillPrice: round2(rawFill), slippageUsd };
}

/**
 * Reconciles account equity, margin, margin level, and max drawdown against all open positions.
 */
export function reconcileSimAccount(
  account: SimAccountState,
  positions: ConfirmedPosition[]
): SimAccountState {
  let usedMargin = 0;
  let unrealizedPnl = 0;

  for (const pos of positions) {
    if (pos.status === 'ACTIVE') {
      usedMargin += pos.marginUsed;
      unrealizedPnl += pos.netPnl;
    }
  }

  usedMargin = round2(usedMargin);
  unrealizedPnl = round2(unrealizedPnl);
  const equity = round2(account.balance + unrealizedPnl);
  const freeMargin = round2(equity - usedMargin);
  const marginLevelPct = usedMargin > 0 ? round2((equity / usedMargin) * 100) : null;
  const peakEquity = round2(Math.max(account.peakEquity, equity));
  const currentDdPct = peakEquity > 0 ? round2(((peakEquity - equity) / peakEquity) * 100) : 0;
  const maxDrawdownPct = round2(Math.max(account.maxDrawdownPct, Math.max(0, currentDdPct)));

  return {
    ...account,
    usedMargin,
    unrealizedPnl,
    equity,
    freeMargin,
    marginLevelPct,
    peakEquity,
    maxDrawdownPct,
  };
}

export interface OpenSimulatedTradeInput {
  proposal: AgentProposal;
  lotSize: number;
  executionType: OrderExecutionType;
  trailingStopDistance?: number | null;
  tick: Tick;
  quant: QuantSnapshot;
  newsGate: NewsGateStatus;
  basis: BasisDivergence;
  account: SimAccountState;
  existingPositions: ConfirmedPosition[];
  nowMs?: number;
}

export interface OpenSimulatedTradeResult {
  ok: boolean;
  errors: string[];
  position: ConfirmedPosition | null;
  account: SimAccountState;
}

/**
 * Simulates full institutional broker trade confirmation:
 * - Enforces USD News Lockout & Caution 50% lot cap
 * - Calculates realistic Ask/Bid + slippage fill (Market) or resting order (Limit)
 * - Shifts SL/TP geometry cleanly around Market fill if spot moved since proposal creation
 * - Enforces System 1 R:R >= 1.50 & 0.25*ATR guardrails
 * - Validates Free Margin availability and deducts opening half of ECN round-turn commission
 */
export function simulateOpenTrade(input: OpenSimulatedTradeInput): OpenSimulatedTradeResult {
  const {
    proposal,
    lotSize,
    executionType,
    trailingStopDistance = null,
    tick,
    quant,
    newsGate,
    basis,
    account,
    existingPositions,
    nowMs = Date.now(),
  } = input;

  if (newsGate.vetoNewEntries) {
    return {
      ok: false,
      errors: [`اجرای معامله در زمان قفل خبر قرمز دلار (${newsGate.activeEvent?.title ?? 'رویداد کلان'}) وتو شد.`],
      position: null,
      account,
    };
  }

  const adjustedLot = round2(Math.max(0.01, lotSize * newsGate.lotMultiplier));
  const isLong = proposal.direction === 'LONG';
  const atr = Math.max(2.0, quant.regime.atr);

  const { fillPrice, slippageUsd } = calculateExecutionFill(
    proposal.direction,
    tick,
    executionType,
    proposal.entry,
    adjustedLot,
    atr
  );

  // Preserve original proposal stop/target distances anchored to actual Market fill price
  // so small live price drift never breaks geometry on immediate market execution.
  const origSlDist = Math.abs(proposal.entry - proposal.stopLoss);
  const origTp1Dist = Math.abs(proposal.tp1 - proposal.entry);
  const origTp2Dist = Math.abs(proposal.tp2 - proposal.entry);

  const entryPrice = executionType === 'MARKET' ? fillPrice : round2(proposal.entry);
  const stopLoss =
    executionType === 'MARKET'
      ? round2(isLong ? entryPrice - origSlDist : entryPrice + origSlDist)
      : round2(proposal.stopLoss);
  const tp1 =
    executionType === 'MARKET'
      ? round2(isLong ? entryPrice + origTp1Dist : entryPrice - origTp1Dist)
      : round2(proposal.tp1);
  const tp2 =
    executionType === 'MARKET'
      ? round2(isLong ? entryPrice + origTp2Dist : entryPrice - origTp2Dist)
      : round2(proposal.tp2);

  const guard = validateTradeGuardrails(proposal.direction, entryPrice, stopLoss, tp1, tp2, atr);
  if (!guard.valid) {
    return {
      ok: false,
      errors: guard.errors,
      position: null,
      account,
    };
  }

  const requiredMargin = calculateRequiredMargin(entryPrice, adjustedLot, account.leverage);
  if (requiredMargin > account.freeMargin) {
    return {
      ok: false,
      errors: [
        `مارجین آزاد کافی نیست: برای ${adjustedLot.toFixed(2)} لات مبلغ $${requiredMargin.toFixed(2)} نیاز است (مارجین آزاد: $${account.freeMargin.toFixed(2)}).`,
      ],
      position: null,
      account,
    };
  }

  const openCommission = round2((account.commissionPerLotRoundTurn / 2) * adjustedLot);
  const isImmediateFill =
    executionType === 'MARKET' ||
    (isLong && tick.ask <= entryPrice) ||
    (!isLong && tick.bid >= entryPrice);

  const status: ConfirmedPosition['status'] = isImmediateFill ? 'ACTIVE' : 'PENDING_LIMIT';
  const appliedCommission = status === 'ACTIVE' ? openCommission : 0;
  const appliedMargin = status === 'ACTIVE' ? requiredMargin : 0;

  const markPrice = isLong ? tick.bid : tick.ask;
  const initialGrossPnl =
    status === 'ACTIVE' ? round2((isLong ? markPrice - entryPrice : entryPrice - markPrice) * adjustedLot * GOLD_CONTRACT_OZ) : 0;
  const initialNetPnl = status === 'ACTIVE' ? round2(initialGrossPnl - appliedCommission) : 0;
  const riskUsd = round2(Math.abs(entryPrice - stopLoss) * adjustedLot * GOLD_CONTRACT_OZ);
  const orderId = `ORD-${nowMs.toString(36).toUpperCase().slice(-6)}`;
  const id = `brk-${nowMs.toString(36).slice(-5)}-${Math.floor(Math.random() * 90 + 10)}`;

  const initLog: SimExecutionEvent =
    status === 'ACTIVE'
      ? makeEvent(
          'FILL',
          `اجرای مارکت ${proposal.direction} با حجم ${adjustedLot.toFixed(2)} لات در $${entryPrice.toFixed(2)} (اسلیپیج $${slippageUsd.toFixed(2)}، کمیسیون $${appliedCommission.toFixed(2)})`,
          entryPrice,
          nowMs
        )
      : makeEvent(
          'LIMIT_PLACED',
          `ثبت سفارش لیمیت ${proposal.direction} با حجم ${adjustedLot.toFixed(2)} لات در $${entryPrice.toFixed(2)} در انتظار برخورد قیمت`,
          entryPrice,
          nowMs
        );

  const basePos: ConfirmedPosition = {
    id,
    orderId,
    proposalId: proposal.id,
    setupType: proposal.setupType,
    timeframe: proposal.timeframe,
    executionType,
    status,
    direction: proposal.direction,
    requestedEntry: round2(proposal.entry),
    entry: entryPrice,
    fillPrice: entryPrice,
    slippageUsd,
    initialSl: stopLoss,
    stopLoss,
    tp1,
    tp2,
    initialLotSize: adjustedLot,
    lotSize: adjustedLot,
    spread: tick.spread,
    stage: 'OPEN',
    rrRatio: guard.rrRatio,
    unrealizedPnl: initialNetPnl,
    grossPnl: initialGrossPnl,
    netPnl: initialNetPnl,
    realizedPnl: 0,
    commissionPaid: appliedCommission,
    swapAccrued: 0,
    marginUsed: appliedMargin,
    riskUsd,
    mfeUsd: Math.max(0, initialGrossPnl),
    maeUsd: Math.min(0, initialGrossPnl),
    trailingStopDistance: trailingStopDistance && trailingStopDistance > 0 ? round2(trailingStopDistance) : null,
    realizedPartial: false,
    openedAtMs: nowMs,
    history: [
      {
        timeMs: nowMs,
        event:
          status === 'ACTIVE'
            ? `اجرا شد ${proposal.direction} ${adjustedLot.toFixed(2)} لات @ ${entryPrice.toFixed(2)}`
            : `لیمیت ثبت شد ${proposal.direction} ${adjustedLot.toFixed(2)} لات @ ${entryPrice.toFixed(2)}`,
        price: entryPrice,
      },
    ],
    executionLog: [initLog],
    rMultiple: 0,
    urgency: 'NORMAL',
    actionTag: 'HOLD_RUNNER',
    adviceEn: '',
    adviceFa: '',
    lastReviewedMs: nowMs,
  };

  const evaluated =
    status === 'ACTIVE'
      ? {
          ...evaluateConfirmedPositionAdvice(basePos, markPrice, quant, newsGate, basis),
          grossPnl: initialGrossPnl,
          netPnl: initialNetPnl,
          unrealizedPnl: initialNetPnl,
          mfeUsd: Math.max(0, initialGrossPnl),
          maeUsd: Math.min(0, initialGrossPnl),
        }
      : {
          ...basePos,
          adviceEn: `Resting ${proposal.direction} Limit armed at ${entryPrice.toFixed(2)} (${adjustedLot.toFixed(2)} lot). Will auto-fill when live ${isLong ? 'Ask' : 'Bid'} reaches entry.`,
          adviceFa: `سفارش لیمیت ${proposal.direction} در نرخ ${entryPrice.toFixed(2)} ثبت شد و به محض برخورد قیمت به صورت خودکار فعال می‌شود.`,
        };

  const updatedAccountBase: SimAccountState = {
    ...account,
    balance: round2(account.balance - appliedCommission),
    realizedPnl: round2(account.realizedPnl - appliedCommission),
    totalCommissionPaid: round2(account.totalCommissionPaid + appliedCommission),
  };

  const nextAccount = reconcileSimAccount(updatedAccountBase, [evaluated, ...existingPositions]);

  return {
    ok: true,
    errors: [],
    position: evaluated,
    account: nextAccount,
  };
}

export interface StepSimulationResult {
  positions: ConfirmedPosition[];
  account: SimAccountState;
  newClosedTrades: ClosedTradeRecord[];
  events: string[];
}

/**
 * Advances ALL simulated positions on every live Bid/Ask tick:
 * 1. Triggers PENDING_LIMIT fills when Ask/Bid crosses requested limit entry.
 * 2. Evaluates realistic mark-to-market Bid/Ask Gross & Net P&L, MAE/MFE, and swap accrual.
 * 3. Ratchets optional ATR Trailing Stop monotonically in profit direction.
 * 4. Auto-executes Stop Loss, 50% TP1 Partial Scale-Out + Risk-Free BE SL, and TP2 Final Close.
 * 5. Enforces Margin Stop-Out (<20%) if account is severely over-leveraged.
 * 6. Reconciles live Account Balance, Equity, Margin, Drawdown, and Trade Journal.
 */
export function stepSimulatedPositions(
  positions: ConfirmedPosition[],
  account: SimAccountState,
  tick: Tick,
  quant: QuantSnapshot,
  newsGate: NewsGateStatus,
  basis: BasisDivergence,
  nowMs = Date.now()
): StepSimulationResult {
  let workingAccount: SimAccountState = { ...account };
  const surviving: ConfirmedPosition[] = [];
  const newClosedTrades: ClosedTradeRecord[] = [];
  const events: string[] = [];

  for (const original of positions) {
    let pos: ConfirmedPosition = {
      ...original,
      history: [...original.history],
      executionLog: [...original.executionLog],
    };
    const isLong = pos.direction === 'LONG';

    // 1. Check resting LIMIT order activation
    if (pos.status === 'PENDING_LIMIT') {
      const triggered = isLong ? tick.ask <= pos.entry : tick.bid >= pos.entry;
      if (!triggered) {
        surviving.push(pos);
        continue;
      }

      const marginReq = calculateRequiredMargin(pos.entry, pos.lotSize, workingAccount.leverage);
      const openComm = round2((workingAccount.commissionPerLotRoundTurn / 2) * pos.lotSize);
      pos.status = 'ACTIVE';
      pos.fillPrice = pos.entry;
      pos.marginUsed = marginReq;
      pos.commissionPaid = round2(pos.commissionPaid + openComm);
      pos.openedAtMs = nowMs;
      pos.executionLog.push(
        makeEvent(
          'LIMIT_FILLED',
          `سفارش لیمیت ${pos.direction} با حجم ${pos.lotSize.toFixed(2)} لات در $${pos.entry.toFixed(2)} اجرا شد (کمیسیون $${openComm.toFixed(2)})`,
          pos.entry,
          nowMs
        )
      );
      pos.history.push({ timeMs: nowMs, event: `اجرای لیمیت @ ${pos.entry.toFixed(2)}`, price: pos.entry });

      workingAccount = {
        ...workingAccount,
        balance: round2(workingAccount.balance - openComm),
        realizedPnl: round2(workingAccount.realizedPnl - openComm),
        totalCommissionPaid: round2(workingAccount.totalCommissionPaid + openComm),
      };
      events.push(`سفارش لیمیت اجرا شد: ${pos.direction} ${pos.setupType} در $${pos.entry.toFixed(2)}`);
    }

    // 2. Live Bid/Ask Mark-to-Market valuation
    const markPrice = isLong ? tick.bid : tick.ask;
    const riskDist = Math.max(0.1, Math.abs(pos.entry - pos.initialSl));
    const signedMove = isLong ? markPrice - pos.entry : pos.entry - markPrice;

    // Subtle realistic carry swap accrual on long-held positions (approx $0.002 per tick per lot)
    const swapTick = round3(pos.lotSize * 0.002);
    pos.swapAccrued = round2(pos.swapAccrued + swapTick);

    // 3. Optional Trailing Stop Ratchet (only tightens in profit direction)
    if (pos.trailingStopDistance && pos.trailingStopDistance > 0) {
      const candidateSl = isLong
        ? round2(markPrice - pos.trailingStopDistance)
        : round2(markPrice + pos.trailingStopDistance);
      const improves = isLong ? candidateSl > pos.stopLoss + 0.05 : candidateSl < pos.stopLoss - 0.05;
      if (improves) {
        pos.stopLoss = candidateSl;
        pos.executionLog.push(
          makeEvent('TRAILING_SL', `تریلینگ استاپ (SL) به $${candidateSl.toFixed(2)} منتقل شد`, markPrice, nowMs)
        );
      }
    }

    // 4. Stop-Loss Trigger Check (with tiny realistic stop slippage $0.03)
    const slHit = (isLong && markPrice <= pos.stopLoss) || (!isLong && markPrice >= pos.stopLoss);
    if (slHit) {
      const slSlip = 0.03;
      const exitPrice = round2(isLong ? pos.stopLoss - slSlip : pos.stopLoss + slSlip);
      const grossPnl = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) * pos.lotSize * GOLD_CONTRACT_OZ);
      const closeComm = round2((workingAccount.commissionPerLotRoundTurn / 2) * pos.lotSize);
      const netClosePnl = round2(grossPnl - closeComm - pos.swapAccrued);
      const rMultiple = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) / riskDist);

      workingAccount = bookClosedTradeIntoAccount(workingAccount, netClosePnl, closeComm);
      newClosedTrades.push({
        id: `trd-${nowMs.toString(36)}-${pos.id.slice(-3)}`,
        orderId: pos.orderId,
        proposalId: pos.proposalId,
        setupType: pos.setupType,
        direction: pos.direction,
        timeframe: pos.timeframe,
        lotSize: pos.lotSize,
        entryPrice: pos.entry,
        exitPrice,
        openedAtMs: pos.openedAtMs,
        closedAtMs: nowMs,
        exitReason: 'STOP_LOSS',
        grossPnl,
        commission: round2(pos.commissionPaid + closeComm),
        swap: pos.swapAccrued,
        netPnl: netClosePnl,
        rMultiple,
        mfeUsd: Math.max(pos.mfeUsd, grossPnl),
        maeUsd: Math.min(pos.maeUsd, grossPnl),
        slippageUsd: round2(pos.slippageUsd + slSlip),
      });
      events.push(
        `حد ضرر فعال شد (${pos.orderId}): پوزیشن ${pos.direction} در $${exitPrice.toFixed(2)} بسته شد (${netClosePnl >= 0 ? '+' : ''}$${netClosePnl.toFixed(2)})`
      );
      continue;
    }

    // 5. TP2 Final Target Trigger Check
    const tp2Hit = (isLong && markPrice >= pos.tp2) || (!isLong && markPrice <= pos.tp2);
    if (tp2Hit) {
      const exitPrice = round2(pos.tp2);
      const grossPnl = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) * pos.lotSize * GOLD_CONTRACT_OZ);
      const closeComm = round2((workingAccount.commissionPerLotRoundTurn / 2) * pos.lotSize);
      const netClosePnl = round2(grossPnl - closeComm - pos.swapAccrued);
      const rMultiple = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) / riskDist);

      workingAccount = bookClosedTradeIntoAccount(workingAccount, netClosePnl, closeComm);
      newClosedTrades.push({
        id: `trd-${nowMs.toString(36)}-${pos.id.slice(-3)}`,
        orderId: pos.orderId,
        proposalId: pos.proposalId,
        setupType: pos.setupType,
        direction: pos.direction,
        timeframe: pos.timeframe,
        lotSize: pos.lotSize,
        entryPrice: pos.entry,
        exitPrice,
        openedAtMs: pos.openedAtMs,
        closedAtMs: nowMs,
        exitReason: 'TP2_TARGET',
        grossPnl,
        commission: round2(pos.commissionPaid + closeComm),
        swap: pos.swapAccrued,
        netPnl: netClosePnl,
        rMultiple,
        mfeUsd: Math.max(pos.mfeUsd, grossPnl),
        maeUsd: Math.min(pos.maeUsd, grossPnl),
        slippageUsd: pos.slippageUsd,
      });
      events.push(
        `هدف TP2 محقق شد (${pos.orderId}): پوزیشن ${pos.direction} در $${exitPrice.toFixed(2)} بسته شد (+$${netClosePnl.toFixed(2)})`
      );
      continue;
    }

    // 6. TP1 Auto 50% Partial Scale-Out + Risk-Free Break-Even Lock
    const tp1Hit = !pos.realizedPartial && ((isLong && markPrice >= pos.tp1) || (!isLong && markPrice <= pos.tp1));
    if (tp1Hit) {
      const partialLot = round2(Math.max(0.01, pos.lotSize * 0.5));
      const remainingLot = round2(Math.max(0.01, pos.lotSize - partialLot));
      const exitPrice = round2(pos.tp1);
      const partialGross = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) * partialLot * GOLD_CONTRACT_OZ);
      const closeComm = round2((workingAccount.commissionPerLotRoundTurn / 2) * partialLot);
      const partialNet = round2(partialGross - closeComm);
      const beSl = round2(isLong ? pos.entry + pos.spread : pos.entry - pos.spread);
      const rMultiple = round2((isLong ? exitPrice - pos.entry : pos.entry - exitPrice) / riskDist);

      workingAccount = bookClosedTradeIntoAccount(workingAccount, partialNet, closeComm);
      newClosedTrades.push({
        id: `trd-p1-${nowMs.toString(36)}-${pos.id.slice(-3)}`,
        orderId: pos.orderId,
        proposalId: pos.proposalId,
        setupType: `${pos.setupType} (۵۰٪ TP1)`,
        direction: pos.direction,
        timeframe: pos.timeframe,
        lotSize: partialLot,
        entryPrice: pos.entry,
        exitPrice,
        openedAtMs: pos.openedAtMs,
        closedAtMs: nowMs,
        exitReason: 'TP1_PARTIAL',
        grossPnl: partialGross,
        commission: closeComm,
        swap: 0,
        netPnl: partialNet,
        rMultiple,
        mfeUsd: Math.max(pos.mfeUsd, partialGross),
        maeUsd: pos.maeUsd,
        slippageUsd: 0,
      });

      pos.lotSize = remainingLot;
      pos.marginUsed = calculateRequiredMargin(pos.entry, remainingLot, workingAccount.leverage);
      pos.stopLoss = beSl;
      pos.stage = 'RISK_FREE_TP1';
      pos.realizedPartial = true;
      pos.realizedPnl = round2(pos.realizedPnl + partialNet);
      pos.executionLog.push(
        makeEvent(
          'PARTIAL_TP1',
          `لمس TP1 در $${exitPrice.toFixed(2)}: سیو ۵۰٪ حجم (${partialLot.toFixed(2)} لات) با سود +$${partialNet.toFixed(2)}`,
          exitPrice,
          nowMs,
          partialNet
        ),
        makeEvent('BE_LOCK', `قفل ریسک‌فری SL در $${beSl.toFixed(2)} (ورود ± اسپرد)`, beSl, nowMs)
      );
      events.push(
        `سیو سود ۵۰٪ در TP1 (${pos.orderId}): +$${partialNet.toFixed(2)} قطعی شد · SL در $${beSl.toFixed(2)} ریسک‌فری شد`
      );
    }

    // 7. Update live Gross/Net PnL, MFE/MAE & System 2 HSM/AI tactical advice
    const grossPnl = round2(signedMove * pos.lotSize * GOLD_CONTRACT_OZ);
    const netPnl = round2(grossPnl - pos.swapAccrued);
    pos.grossPnl = grossPnl;
    pos.netPnl = netPnl;
    pos.unrealizedPnl = netPnl;
    pos.mfeUsd = round2(Math.max(pos.mfeUsd, grossPnl));
    pos.maeUsd = round2(Math.min(pos.maeUsd, grossPnl));

    const advised = evaluateConfirmedPositionAdvice(pos, markPrice, quant, newsGate, basis);
    surviving.push({
      ...advised,
      grossPnl,
      netPnl,
      unrealizedPnl: netPnl,
      mfeUsd: pos.mfeUsd,
      maeUsd: pos.maeUsd,
      executionLog: pos.executionLog.slice(-16),
    });
  }

  let reconciledAccount = reconcileSimAccount(workingAccount, surviving);

  // 8. Institutional Margin Stop-Out Protection (< 20% margin level liquidates worst loser)
  if (
    reconciledAccount.marginLevelPct !== null &&
    reconciledAccount.marginLevelPct < MARGIN_STOP_OUT_PCT &&
    surviving.length > 0
  ) {
    const activeOnly = surviving.filter((p) => p.status === 'ACTIVE');
    if (activeOnly.length > 0) {
      activeOnly.sort((a, b) => a.netPnl - b.netPnl);
      const worst = activeOnly[0];
      const closed = executePartialClose(worst, 1, tick, reconciledAccount, nowMs, 'MARGIN_STOP_OUT');
      reconciledAccount = closed.account;
      if (closed.closedRecord) newClosedTrades.push(closed.closedRecord);
      const idx = surviving.findIndex((p) => p.id === worst.id);
      if (idx !== -1) surviving.splice(idx, 1);
      reconciledAccount = reconcileSimAccount(reconciledAccount, surviving);
      events.push(`استاپ‌اوت مارجین برای ${worst.orderId} فعال شد (سطح مارجین < ${MARGIN_STOP_OUT_PCT}%)`);
    }
  }

  return {
    positions: surviving,
    account: reconciledAccount,
    newClosedTrades,
    events,
  };
}

function bookClosedTradeIntoAccount(
  account: SimAccountState,
  netPnlDelta: number,
  closeCommission: number
): SimAccountState {
  const isWin = netPnlDelta >= 0;
  return {
    ...account,
    balance: round2(account.balance + netPnlDelta),
    realizedPnl: round2(account.realizedPnl + netPnlDelta),
    totalCommissionPaid: round2(account.totalCommissionPaid + closeCommission),
    winCount: account.winCount + (isWin ? 1 : 0),
    lossCount: account.lossCount + (isWin ? 0 : 1),
    grossProfit: round2(account.grossProfit + (isWin ? netPnlDelta : 0)),
    grossLoss: round2(account.grossLoss + (isWin ? 0 : Math.abs(netPnlDelta))),
  };
}

/**
 * Executes a manual partial (e.g. 25% / 50%) or full (100%) close at current live Bid/Ask.
 */
export function executePartialClose(
  position: ConfirmedPosition,
  closeFraction: number,
  tick: Tick,
  account: SimAccountState,
  nowMs = Date.now(),
  reasonOverride?: ClosedTradeRecord['exitReason']
): {
  remainingPosition: ConfirmedPosition | null;
  closedRecord: ClosedTradeRecord | null;
  account: SimAccountState;
} {
  // Cancelling an unfilled resting limit order incurs zero P&L and zero commission
  if (position.status === 'PENDING_LIMIT') {
    return {
      remainingPosition: null,
      closedRecord: null,
      account,
    };
  }

  const clampedFraction = Math.max(0.1, Math.min(1, closeFraction));
  const isFullClose = clampedFraction >= 0.99 || position.lotSize <= 0.01;
  const closeLot = isFullClose ? position.lotSize : round2(Math.max(0.01, position.lotSize * clampedFraction));
  const remainingLot = isFullClose ? 0 : round2(Math.max(0, position.lotSize - closeLot));
  const actualFull = remainingLot < 0.01;
  const effectiveCloseLot = actualFull ? position.lotSize : closeLot;

  const isLong = position.direction === 'LONG';
  const exitPrice = round2(isLong ? tick.bid : tick.ask);
  const riskDist = Math.max(0.1, Math.abs(position.entry - position.initialSl));
  const grossPnl = round2((isLong ? exitPrice - position.entry : position.entry - exitPrice) * effectiveCloseLot * GOLD_CONTRACT_OZ);
  const closeComm = round2((account.commissionPerLotRoundTurn / 2) * effectiveCloseLot);
  const swapShare = actualFull ? position.swapAccrued : round2(position.swapAccrued * clampedFraction);
  const netPnl = round2(grossPnl - closeComm - swapShare);
  const rMultiple = round2((isLong ? exitPrice - position.entry : position.entry - exitPrice) / riskDist);

  const nextAccount = bookClosedTradeIntoAccount(account, netPnl, closeComm);

  const closedRecord: ClosedTradeRecord = {
    id: `trd-${nowMs.toString(36)}-${Math.floor(Math.random() * 900 + 100)}`,
    orderId: position.orderId,
    proposalId: position.proposalId,
    setupType: actualFull ? position.setupType : `${position.setupType} (خروج ${Math.round(clampedFraction * 100)}%)`,
    direction: position.direction,
    timeframe: position.timeframe,
    lotSize: effectiveCloseLot,
    entryPrice: position.entry,
    exitPrice,
    openedAtMs: position.openedAtMs,
    closedAtMs: nowMs,
    exitReason: reasonOverride ?? (actualFull ? 'MANUAL_CLOSE' : 'MANUAL_PARTIAL'),
    grossPnl,
    commission: round2(closeComm + (actualFull ? position.commissionPaid : 0)),
    swap: swapShare,
    netPnl,
    rMultiple,
    mfeUsd: position.mfeUsd,
    maeUsd: position.maeUsd,
    slippageUsd: position.slippageUsd,
  };

  if (actualFull) {
    return {
      remainingPosition: null,
      closedRecord,
      account: nextAccount,
    };
  }

  const nextPos: ConfirmedPosition = {
    ...position,
    lotSize: remainingLot,
    marginUsed: calculateRequiredMargin(position.entry, remainingLot, nextAccount.leverage),
    realizedPnl: round2(position.realizedPnl + netPnl),
    realizedPartial: true,
    swapAccrued: round2(Math.max(0, position.swapAccrued - swapShare)),
    executionLog: [
      ...position.executionLog,
      makeEvent(
        'MANUAL_PARTIAL',
        `خروج جزئی ${effectiveCloseLot.toFixed(2)} لات در $${exitPrice.toFixed(2)} (${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)})`,
        exitPrice,
        nowMs,
        netPnl
      ),
    ].slice(-16),
    history: [
      ...position.history,
      { timeMs: nowMs, event: `خروج جزئی ${effectiveCloseLot.toFixed(2)} لات`, price: exitPrice },
    ],
  };

  return {
    remainingPosition: nextPos,
    closedRecord,
    account: nextAccount,
  };
}

/**
 * Modifies live Stop Loss, TP1, TP2, or Trailing Stop on an open simulated position with geometry checks.
 */
export function modifyPositionLevels(
  position: ConfirmedPosition,
  updates: {
    stopLoss?: number;
    tp1?: number;
    tp2?: number;
    trailingStopDistance?: number | null;
  },
  currentPrice: number,
  nowMs = Date.now()
): { ok: boolean; error?: string; position: ConfirmedPosition } {
  const isLong = position.direction === 'LONG';
  const nextSl = updates.stopLoss !== undefined ? round2(updates.stopLoss) : position.stopLoss;
  const nextTp1 = updates.tp1 !== undefined ? round2(updates.tp1) : position.tp1;
  const nextTp2 = updates.tp2 !== undefined ? round2(updates.tp2) : position.tp2;
  const nextTrail =
    updates.trailingStopDistance !== undefined ? updates.trailingStopDistance : position.trailingStopDistance;

  if (![nextSl, nextTp1, nextTp2].every((n) => Number.isFinite(n) && n > 0)) {
    return { ok: false, error: 'تمام سطوح ویرایش‌شده باید قیمت‌های مثبت و معتبر باشند.', position };
  }

  if (isLong) {
    if (nextTp1 <= position.entry || nextTp2 <= nextTp1) {
      return { ok: false, error: 'اهداف LONG باید شرط Entry < TP1 < TP2 را رعایت کنند.', position };
    }
    if (nextSl >= currentPrice) {
      return { ok: false, error: `حد ضرر LONG ($${nextSl.toFixed(2)}) باید پایین‌تر از قیمت فعلی ($${currentPrice.toFixed(2)}) باشد.`, position };
    }
  } else {
    if (nextTp1 >= position.entry || nextTp2 >= nextTp1) {
      return { ok: false, error: 'اهداف SHORT باید شرط Entry > TP1 > TP2 را رعایت کنند.', position };
    }
    if (nextSl <= currentPrice) {
      return { ok: false, error: `حد ضرر SHORT ($${nextSl.toFixed(2)}) باید بالاتر از قیمت فعلی ($${currentPrice.toFixed(2)}) باشد.`, position };
    }
  }

  const nextPos: ConfirmedPosition = {
    ...position,
    stopLoss: nextSl,
    tp1: nextTp1,
    tp2: nextTp2,
    trailingStopDistance: nextTrail && nextTrail > 0 ? round2(nextTrail) : null,
    executionLog: [
      ...position.executionLog,
      makeEvent(
        'SL_MODIFIED',
        `بروزرسانی سطوح ← SL $${nextSl.toFixed(2)} · TP1 $${nextTp1.toFixed(2)} · TP2 $${nextTp2.toFixed(2)}${nextTrail ? ` · تریل $${nextTrail.toFixed(2)}` : ''}`,
        currentPrice,
        nowMs
      ),
    ].slice(-16),
  };

  return { ok: true, position: nextPos };
}

export function computeAccountMetrics(
  account: SimAccountState,
  closedTrades: ClosedTradeRecord[]
): SimAccountMetrics {
  const totalClosed = account.winCount + account.lossCount;
  const winRatePct = totalClosed > 0 ? round2((account.winCount / totalClosed) * 100) : 0;
  const returnPct =
    account.initialBalance > 0
      ? round2(((account.equity - account.initialBalance) / account.initialBalance) * 100)
      : 0;
  const profitFactor =
    account.grossLoss > 0
      ? round2(account.grossProfit / account.grossLoss)
      : account.grossProfit > 0
        ? 9.99
        : null;
  const avgRMultiple =
    closedTrades.length > 0
      ? round2(closedTrades.reduce((acc, t) => acc + t.rMultiple, 0) / closedTrades.length)
      : 0;

  return {
    returnPct,
    winRatePct,
    profitFactor,
    avgRMultiple,
    totalClosedTrades: closedTrades.length,
  };
}

interface SeedTradeBlueprint {
  offsetMin: number;
  durationMin: number;
  direction: 'LONG' | 'SHORT';
  timeframe: ClosedTradeRecord['timeframe'];
  setupType: string;
  lotSize: number;
  priceOffset: number;
  moveUsd: number;
  riskUsdDist: number;
  exitReason: ClosedTradeRecord['exitReason'];
}

const SEED_TRADE_BLUEPRINTS: SeedTradeBlueprint[] = [
  { offsetMin: 342, durationMin: 14, direction: 'LONG', timeframe: 'M15', setupType: 'شکار SSL لندن + OB', lotSize: 0.25, priceOffset: -11.4, moveUsd: 6.2, riskUsdDist: 4.0, exitReason: 'TP1_PARTIAL' },
  { offsetMin: 324, durationMin: 19, direction: 'LONG', timeframe: 'M15', setupType: 'ری‌تست FVG CE صعودی', lotSize: 0.25, priceOffset: -8.6, moveUsd: 9.4, riskUsdDist: 4.2, exitReason: 'TP2_TARGET' },
  { offsetMin: 302, durationMin: 11, direction: 'SHORT', timeframe: 'M5', setupType: 'ریجکشن شکار BSL', lotSize: 0.2, priceOffset: -2.1, moveUsd: -4.1, riskUsdDist: 4.1, exitReason: 'STOP_LOSS' },
  { offsetMin: 285, durationMin: 16, direction: 'LONG', timeframe: 'M15', setupType: 'پولبک OB پس از BOS در H1', lotSize: 0.3, priceOffset: -6.8, moveUsd: 7.4, riskUsdDist: 4.5, exitReason: 'TP1_PARTIAL' },
  { offsetMin: 263, durationMin: 22, direction: 'LONG', timeframe: 'H1', setupType: 'واکنش به تقاضای نهادی', lotSize: 0.25, priceOffset: -3.2, moveUsd: 10.6, riskUsdDist: 4.8, exitReason: 'TP2_TARGET' },
  // Mid-session realistic drawdown cluster (trades 6-10)
  { offsetMin: 241, durationMin: 9, direction: 'LONG', timeframe: 'M5', setupType: 'ادامه روند FVG در M5', lotSize: 0.3, priceOffset: 4.4, moveUsd: -4.8, riskUsdDist: 4.8, exitReason: 'STOP_LOSS' },
  { offsetMin: 224, durationMin: 12, direction: 'SHORT', timeframe: 'M15', setupType: 'ری‌تست بریکر نزولی', lotSize: 0.3, priceOffset: 1.8, moveUsd: -5.1, riskUsdDist: 5.1, exitReason: 'STOP_LOSS' },
  { offsetMin: 206, durationMin: 15, direction: 'LONG', timeframe: 'M15', setupType: 'بازپس‌گیری Tether (TFS)', lotSize: 0.2, priceOffset: -1.4, moveUsd: 3.4, riskUsdDist: 4.2, exitReason: 'MANUAL_CLOSE' },
  { offsetMin: 188, durationMin: 10, direction: 'SHORT', timeframe: 'M5', setupType: 'تله نقدینگی سشن نیویورک', lotSize: 0.35, priceOffset: 2.6, moveUsd: -5.4, riskUsdDist: 5.4, exitReason: 'STOP_LOSS' },
  { offsetMin: 171, durationMin: 8, direction: 'LONG', timeframe: 'M5', setupType: 'شکار خرد نقدینگی SSL', lotSize: 0.25, priceOffset: -2.9, moveUsd: -3.9, riskUsdDist: 3.9, exitReason: 'STOP_LOSS' },
  // Strong institutional recovery & new equity high (trades 11-16)
  { offsetMin: 154, durationMin: 17, direction: 'LONG', timeframe: 'M15', setupType: 'OB صعودی + FVG CE', lotSize: 0.3, priceOffset: -5.8, moveUsd: 8.6, riskUsdDist: 4.3, exitReason: 'TP1_PARTIAL' },
  { offsetMin: 136, durationMin: 21, direction: 'LONG', timeframe: 'H1', setupType: 'تکمیل تقاضای CHoCH در M15', lotSize: 0.3, priceOffset: -1.5, moveUsd: 11.2, riskUsdDist: 4.6, exitReason: 'TP2_TARGET' },
  { offsetMin: 118, durationMin: 13, direction: 'SHORT', timeframe: 'M15', setupType: 'واکنش عرضه در پرمیوم', lotSize: 0.25, priceOffset: 5.2, moveUsd: 6.8, riskUsdDist: 4.0, exitReason: 'TP1_PARTIAL' },
  { offsetMin: 102, durationMin: 11, direction: 'LONG', timeframe: 'M5', setupType: 'میانه FVG در تخفیف', lotSize: 0.25, priceOffset: 0.6, moveUsd: -3.6, riskUsdDist: 3.6, exitReason: 'STOP_LOSS' },
  { offsetMin: 86, durationMin: 18, direction: 'LONG', timeframe: 'M15', setupType: 'ری‌تست OB سشن نیویورک', lotSize: 0.3, priceOffset: -2.4, moveUsd: 9.8, riskUsdDist: 4.4, exitReason: 'TP2_TARGET' },
  { offsetMin: 68, durationMin: 15, direction: 'SHORT', timeframe: 'M15', setupType: 'شکار BSL سقف‌های برابر', lotSize: 0.25, priceOffset: 4.1, moveUsd: 7.2, riskUsdDist: 4.1, exitReason: 'TP1_PARTIAL' },
  // Minor late-session pullback + stabilization into active live trade #20
  { offsetMin: 53, durationMin: 9, direction: 'SHORT', timeframe: 'M5', setupType: 'پر شدن FVG نزولی M5', lotSize: 0.25, priceOffset: 1.9, moveUsd: -4.2, riskUsdDist: 4.2, exitReason: 'STOP_LOSS' },
  { offsetMin: 40, durationMin: 12, direction: 'LONG', timeframe: 'M15', setupType: 'می‌تیگیشن بلاک صعودی', lotSize: 0.25, priceOffset: -1.8, moveUsd: 6.4, riskUsdDist: 3.9, exitReason: 'TP1_PARTIAL' },
  { offsetMin: 27, durationMin: 10, direction: 'LONG', timeframe: 'M5', setupType: 'ایمپالس همگرای TPI', lotSize: 0.2, priceOffset: -0.9, moveUsd: -2.9, riskUsdDist: 3.8, exitReason: 'MANUAL_CLOSE' },
];

/**
 * Generates 19 deterministic, reconciled historical simulation trades anchored to live spot
 * so the 20-trade D3 equity/drawdown/Sharpe curve (19 closed + 1 active live) renders with
 * realistic institutional performance immediately on boot.
 */
export function generateSeedClosedTrades(
  spotPrice: number,
  initialBalance = DEFAULT_INITIAL_BALANCE,
  nowMs = Date.now(),
  commissionPerLotRT = DEFAULT_COMMISSION_PER_LOT_RT
): {
  closedTrades: ClosedTradeRecord[];
  account: SimAccountState;
  equityTrail: Array<{ timeMs: number; equity: number; peakEquity: number }>;
} {
  const anchor = Number.isFinite(spotPrice) && spotPrice > 100 ? spotPrice : 2742.6;
  let account = createInitialSimAccount(initialBalance, DEFAULT_LEVERAGE, commissionPerLotRT);
  const chronological: ClosedTradeRecord[] = [];
  const equityTrail: Array<{ timeMs: number; equity: number; peakEquity: number }> = [
    {
      timeMs: nowMs - (SEED_TRADE_BLUEPRINTS[0].offsetMin + 15) * 60_000,
      equity: account.balance,
      peakEquity: account.peakEquity,
    },
  ];

  SEED_TRADE_BLUEPRINTS.forEach((bp, idx) => {
    const isLong = bp.direction === 'LONG';
    const entryPrice = round2(anchor + bp.priceOffset);
    const exitPrice = round2(isLong ? entryPrice + bp.moveUsd : entryPrice - bp.moveUsd);
    const closedAtMs = nowMs - bp.offsetMin * 60_000;
    const openedAtMs = closedAtMs - bp.durationMin * 60_000;
    const grossPnl = round2(bp.moveUsd * bp.lotSize * GOLD_CONTRACT_OZ);
    const commission = round2(commissionPerLotRT * bp.lotSize);
    const swap = round2(bp.lotSize * 0.12);
    const netPnl = round2(grossPnl - commission - swap);
    const rMultiple = round2(bp.moveUsd / Math.max(0.5, bp.riskUsdDist));
    const isWin = netPnl >= 0;

    const mfeUsd = round2(
      isWin ? Math.max(grossPnl * 1.12, grossPnl + 14) : Math.max(12, Math.abs(grossPnl) * 0.28)
    );
    const maeUsd = round2(
      isWin ? -Math.max(15, grossPnl * 0.24) : Math.min(grossPnl, grossPnl * 1.05)
    );

    const record: ClosedTradeRecord = {
      id: `trd-seed-${String(idx + 1).padStart(2, '0')}`,
      orderId: `ORD-S${String(idx + 1).padStart(3, '0')}`,
      proposalId: `prop-hist-${String(idx + 1).padStart(2, '0')}`,
      setupType: bp.setupType,
      direction: bp.direction,
      timeframe: bp.timeframe,
      lotSize: bp.lotSize,
      entryPrice,
      exitPrice,
      openedAtMs,
      closedAtMs,
      exitReason: bp.exitReason,
      grossPnl,
      commission,
      swap,
      netPnl,
      rMultiple,
      mfeUsd,
      maeUsd,
      slippageUsd: bp.exitReason === 'STOP_LOSS' ? 0.06 : 0.03,
    };

    chronological.push(record);

    const nextBalance = round2(account.balance + netPnl);
    const nextPeak = round2(Math.max(account.peakEquity, nextBalance));
    const ddPct = nextPeak > 0 ? round2(((nextPeak - nextBalance) / nextPeak) * 100) : 0;

    account = {
      ...account,
      balance: nextBalance,
      equity: nextBalance,
      freeMargin: nextBalance,
      realizedPnl: round2(account.realizedPnl + netPnl),
      totalCommissionPaid: round2(account.totalCommissionPaid + commission),
      peakEquity: nextPeak,
      maxDrawdownPct: round2(Math.max(account.maxDrawdownPct, Math.max(0, ddPct))),
      winCount: account.winCount + (isWin ? 1 : 0),
      lossCount: account.lossCount + (isWin ? 0 : 1),
      grossProfit: round2(account.grossProfit + (isWin ? netPnl : 0)),
      grossLoss: round2(account.grossLoss + (isWin ? 0 : Math.abs(netPnl))),
    };

    equityTrail.push({
      timeMs: closedAtMs,
      equity: nextBalance,
      peakEquity: nextPeak,
    });
  });

  // Store keeps closedTrades newest-first
  return {
    closedTrades: chronological.reverse(),
    account,
    equityTrail,
  };
}

