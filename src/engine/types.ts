export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4';

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Tick {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  spread: number;
  timestampMs: number;
  tier: 1 | 2 | 3;
  source: string;
  seq: number;
}

export interface FairValueGap {
  id: string;
  direction: 'BULLISH' | 'BEARISH';
  top: number;
  bottom: number;
  ce50: number;
  startTime: number;
  mitigated: boolean;
  mitigatedTime?: number;
  /** Gap size expressed as a multiple of timeframe ATR */
  atrMultiple?: number;
  /** 0..1 fraction of gap filled so far */
  fillPct?: number;
  /** True if a candle closed fully through the gap, flipping it into an Inversion FVG */
  isInversion?: boolean;
}

export interface OrderBlock {
  id: string;
  direction: 'BULLISH' | 'BEARISH';
  high: number;
  low: number;
  mt50: number;
  volume: number;
  startTime: number;
  mitigated: boolean;
  mitigatedTime?: number;
  /** Candle body / total range ratio (0..1); institutional XAUUSD OBs prefer >= 0.55 */
  bodyRatio?: number;
  /** Subsequent displacement candle strength in ATR multiples */
  displacementAtr?: number;
  /** True when an unmitigated FVG overlaps or sits directly adjacent ("Golden Confluence") */
  hasFvgConfluence?: boolean;
  /** True if swept prior swing liquidity before reversing */
  sweptLiquidity?: boolean;
  /** Composite OB institutional quality score (0..100) */
  qualityScore?: number;
  /** True if violated by close and flipped into a Breaker Block */
  isBreaker?: boolean;
}

export interface StructureEvent {
  id: string;
  kind: 'BOS' | 'CHoCH';
  direction: 'BULLISH' | 'BEARISH';
  level: number;
  time: number;
  swingTime: number;
}

export interface LiquidityPool {
  id: string;
  side: 'BSL' | 'SSL';
  level: number;
  time: number;
  swept: boolean;
  /** True if price pierced the pool with a wick and closed cleanly back inside (stop hunt rejection) */
  sweepRejected?: boolean;
  /** Number of equal touches (EQH / EQL cluster) */
  touches?: number;
}

export type RsiRegimeLabel = 'BULLISH_REGIME' | 'BEARISH_REGIME' | 'NEUTRAL_CHOP';

export type RsiDivergenceKind =
  | 'NONE'
  | 'BULLISH_REGULAR'
  | 'BEARISH_REGULAR'
  | 'BULLISH_HIDDEN'
  | 'BEARISH_HIDDEN';

export interface RsiTimeframeState {
  timeframe: Timeframe;
  value: number;
  prevValue: number;
  regime: RsiRegimeLabel;
  zone: 'OVERSOLD_EXTREME' | 'DISCOUNT_RESET' | 'NEUTRAL' | 'PREMIUM_RESET' | 'OVERBOUGHT_EXTREME';
  divergence: RsiDivergenceKind;
  slope: number;
}

export interface RsiSnapshot {
  period: number;
  activeSeries: number[];
  byTimeframe: Record<Timeframe, RsiTimeframeState>;
  active: RsiTimeframeState;
}

export interface DealingRangeSnapshot {
  timeframe: Timeframe;
  swingHigh: number;
  swingLow: number;
  equilibrium50: number;
  oteLongLow: number; // 78.6% retracement from high (deep discount)
  oteLongHigh: number; // 61.8% retracement from high
  oteLongSweetSpot: number; // 70.5% retracement
  oteShortLow: number; // 61.8% retracement from low
  oteShortHigh: number; // 78.6% retracement from low (deep premium)
  oteShortSweetSpot: number; // 70.5% retracement
  /** 0 = at swingLow, 100 = at swingHigh */
  positionPct: number;
  zone: 'DEEP_DISCOUNT' | 'DISCOUNT_OTE' | 'EQUILIBRIUM' | 'PREMIUM_OTE' | 'DEEP_PREMIUM';
}

export type KillzoneWindow = 'LONDON_OPEN' | 'NY_OVERLAP' | 'NY_AM' | 'ASIAN_ACCUMULATION' | 'OFF_SESSION';

export type ConvictionGrade = 'A+' | 'A' | 'B' | 'STAND_DOWN';

export interface ConfluencePillarScore {
  id: 'H4_COMPASS' | 'H1_SWEEP_STRUCT' | 'OB_QUALITY' | 'FVG_GOLDEN' | 'RSI_MOMENTUM' | 'OTE_SESSION_MACRO';
  label: string;
  labelFa: string;
  score: number;
  maxScore: number;
  status: 'STRONG' | 'MODERATE' | 'WEAK' | 'OPPOSING';
  detail: string;
}

export interface DefenseGateResult {
  id:
    | 'NEWS_SHIELD'
    | 'ANTI_CHASE_ATR'
    | 'FAKEOUT_TRAP_GUARD'
    | 'HTF_4H_COMPASS'
    | 'CHOP_EFFICIENCY_FILTER'
    | 'PD_DISCIPLINE'
    | 'HYSTERESIS_LOCK';
  label: string;
  status: 'PASS' | 'CAUTION' | 'BLOCKED';
  hardVeto: boolean;
  metric: string;
  detail: string;
}

export interface TimeframeAlignmentRow {
  timeframe: Timeframe;
  role: 'MACRO_COMPASS' | 'STRUCTURE_POI' | 'SETUP_CHOCH' | 'EXECUTION_TRIGGER';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  rsi: number;
  rsiRegime: RsiRegimeLabel;
  divergence: RsiDivergenceKind;
  lastStructure: string;
  unmitigatedObCount: number;
  unmitigatedFvgCount: number;
}

export interface PayamBrainReport {
  timestampMs: number;
  executionTimeframe: Timeframe;
  h4Bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  h4Strength: number; // -1..+1
  h1Bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  candidateDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  decision: 'PROPOSE_LONG' | 'PROPOSE_SHORT' | 'STAND_DOWN';
  convictionGrade: ConvictionGrade;
  totalScore: number; // 0..100
  longScore: number; // 0..100
  shortScore: number; // 0..100
  recommendedRiskMultiplier: number; // 0, 0.5, 0.75, 1.0
  killzone: KillzoneWindow;
  atrExtension: number; // distance from equilibrium in ATRs
  kaufmanEfficiency: number; // 0..1
  sweepDetected: {
    active: boolean;
    side: 'SSL_SWEEP_BULLISH' | 'BSL_SWEEP_BEARISH' | 'NONE';
    level: number | null;
    wickRejectionRatio: number;
  };
  goldenConfluence: boolean; // unmitigated OB + FVG overlap
  pillars: ConfluencePillarScore[];
  defenseGates: DefenseGateResult[];
  hardVetoes: string[];
  mtfMatrix: TimeframeAlignmentRow[];
  watchlistZone: {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    entryLow: number;
    entryHigh: number;
    optimalEntry: number;
    invalidationLevel: number;
    targetLiquidity: number;
  } | null;
  summaryEn: string;
  summaryFa: string;
}

export interface TfsSnapshot {
  tetherPrice: number;
  velocityOscillator: number;
  mboScore: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface TpiSnapshot {
  compositeScore: number;
  perTimeframe: Record<Timeframe, number>;
  alignmentLabel: 'STRONG_BULLISH_ALIGNMENT' | 'STRONG_BEARISH_ALIGNMENT' | 'MIXED_CONSOLIDATION';
}

export interface MarketRegime {
  label: 'TRENDING_BULLISH' | 'TRENDING_BEARISH' | 'RANGING' | 'VOLATILE_EXPANSION';
  atr: number;
  trendSlope: number;
}

export interface QuantSnapshot {
  timeframe: Timeframe;
  computeMs: number;
  fvgs: FairValueGap[];
  orderBlocks: OrderBlock[];
  structures: StructureEvent[];
  liquidity: LiquidityPool[];
  tfs: TfsSnapshot;
  tpi: TpiSnapshot;
  regime: MarketRegime;
  rsi: RsiSnapshot;
  dealingRange: DealingRangeSnapshot;
  brain: PayamBrainReport;
}

export interface GuardrailResult {
  valid: boolean;
  rrRatio: number;
  stopDistance: number;
  minStopRequired: number;
  errors: string[];
}

export type HsmStage = 'OPEN' | 'BREAK_EVEN_ARMED' | 'RISK_FREE_TP1' | 'CLOSED_TP2' | 'STOPPED_OUT';

export interface Position {
  id: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  initialSl: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  lotSize: number;
  spread: number;
  stage: HsmStage;
  rrRatio: number;
  unrealizedPnl: number;
  realizedPartial: boolean;
  openedAtMs: number;
  history: { timeMs: number; event: string; price: number }[];
}

export interface PendingLimitOrder {
  id: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  lotSize: number;
  status: 'PENDING_ENTRY' | 'EXPIRED_OR_VETOED';
}

export interface NewsEvent {
  id: string;
  title: string;
  currency: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  scheduledAtMs: number;
  forecast: string;
  previous: string;
}

export interface NewsGateStatus {
  state: 'CLEAR' | 'CAUTION' | 'LOCKOUT';
  lotMultiplier: number;
  vetoNewEntries: boolean;
  cancelPendingLimits: boolean;
  activeEvent: NewsEvent | null;
  minutesToEvent: number | null;
}

export interface FactLedger {
  jobId: string;
  triggerReason: string;
  spotPrice: number;
  spread: number;
  atr: number;
  regime: string;
  tpiComposite: number;
  newsGate: string;
  allowedNumbers: number[];
  createdAtMs: number;
}

export interface Advisory {
  id: string;
  jobId: string;
  verdict: 'HOLD' | 'SCALE' | 'PROTECT' | 'EXIT' | 'VETO';
  confidence: number;
  rationaleEn: string;
  rationaleFa: string;
  hallucinationChecked: boolean;
  factLedger: FactLedger;
  createdAtMs: number;
}

export interface PipelineStatus {
  activeTier: 1 | 2 | 3;
  sourceName: string;
  ttlMs: number;
  loopLagP99Ms: number;
  failoverCount: number;
  tripwireCount: number;
  rejectedSpikes: number;
  wsSequenceId: number;
  lastEventNote: string;
}

export interface GateAuditResult {
  gate: number;
  name: string;
  subsystem: string;
  passed: boolean;
  latencyMs: number;
  detail: string;
}

export interface DebFileEntry {
  path: string;
  name: string;
  subsystem: string;
  sizeBytes: number;
  lines: number;
  language: string;
}

export interface BasisDivergence {
  spotPrice: number;
  paxgPrice: number;
  basisUsd: number;
  basisBps: number;
  status: 'ALIGNED' | 'BASIS_DRIFT' | 'CRYPTO_INDUCEMENT';
  cryptoInducementWarning: boolean;
  note: string;
}

export type ProposalStatus = 'PROPOSED' | 'CONFIRMED' | 'DISMISSED';

export interface AgentProposal {
  id: string;
  direction: 'LONG' | 'SHORT';
  setupType: string;
  timeframe: Timeframe;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  rrRatio: number;
  confidence: number;
  rationaleEn: string;
  rationaleFa: string;
  toolsUsed: string[];
  engineSource: 'GEMINI_AGENT' | 'SYSTEM1_QUANT';
  status: ProposalStatus;
  createdAtMs: number;
  /** Payam Brain v3 weighted confluence score (0..100) */
  confluenceScore?: number;
  /** Institutional setup grade (A+, A, B) */
  convictionGrade?: ConvictionGrade;
  /** Dominant 4H directional anchor at proposal creation */
  h4Bias?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  /** Active RSI(14) & regime/divergence summary */
  rsiSummary?: string;
  /** Recommended risk sizing multiplier (0.5x to 1.0x) */
  recommendedRiskMultiplier?: number;
  /** Top contributing confluence pillars */
  pillarBreakdown?: Array<{ label: string; score: number; maxScore: number }>;
  /** True when setup combines unmitigated OB + overlapping FVG */
  goldenConfluence?: boolean;
  /** True when trading against H4 trend (capped risk scalp) */
  counterTrendFlag?: boolean;
}

export type OrderExecutionType = 'MARKET' | 'LIMIT';

export type SimExecutionEventKind =
  | 'FILL'
  | 'LIMIT_PLACED'
  | 'LIMIT_FILLED'
  | 'PARTIAL_TP1'
  | 'MANUAL_PARTIAL'
  | 'BE_LOCK'
  | 'TRAILING_SL'
  | 'SL_MODIFIED'
  | 'TP2_HIT'
  | 'SL_HIT'
  | 'MANUAL_CLOSE'
  | 'MARGIN_STOP_OUT'
  | 'NEWS_PROTECT';

export interface SimExecutionEvent {
  id: string;
  timeMs: number;
  kind: SimExecutionEventKind;
  message: string;
  price: number;
  pnlDelta?: number;
}

export interface ConfirmedPosition extends Position {
  orderId: string;
  proposalId: string;
  setupType: string;
  timeframe: Timeframe;
  executionType: OrderExecutionType;
  status: 'PENDING_LIMIT' | 'ACTIVE';
  requestedEntry: number;
  fillPrice: number;
  slippageUsd: number;
  initialLotSize: number;
  commissionPaid: number;
  swapAccrued: number;
  marginUsed: number;
  riskUsd: number;
  grossPnl: number;
  netPnl: number;
  realizedPnl: number;
  mfeUsd: number;
  maeUsd: number;
  trailingStopDistance: number | null;
  executionLog: SimExecutionEvent[];
  rMultiple: number;
  urgency: 'NORMAL' | 'ATTENTION' | 'CRITICAL';
  actionTag: 'HOLD_RUNNER' | 'ARM_BE' | 'MOVE_SL_RF' | 'SCALE_PARTIAL' | 'PROTECT_NEWS' | 'EXIT_WARNING';
  adviceEn: string;
  adviceFa: string;
  lastReviewedMs: number;
}

export interface ClosedTradeRecord {
  id: string;
  orderId: string;
  proposalId: string;
  setupType: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  lotSize: number;
  entryPrice: number;
  exitPrice: number;
  openedAtMs: number;
  closedAtMs: number;
  exitReason: 'TP1_PARTIAL' | 'MANUAL_PARTIAL' | 'TP2_TARGET' | 'STOP_LOSS' | 'MANUAL_CLOSE' | 'MARGIN_STOP_OUT';
  grossPnl: number;
  commission: number;
  swap: number;
  netPnl: number;
  rMultiple: number;
  mfeUsd: number;
  maeUsd: number;
  slippageUsd: number;
}

export interface SimAccountState {
  initialBalance: number;
  balance: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  marginLevelPct: number | null;
  leverage: number;
  commissionPerLotRoundTurn: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalCommissionPaid: number;
  peakEquity: number;
  maxDrawdownPct: number;
  winCount: number;
  lossCount: number;
  grossProfit: number;
  grossLoss: number;
}

export interface SimAccountMetrics {
  returnPct: number;
  winRatePct: number;
  profitFactor: number | null;
  avgRMultiple: number;
  totalClosedTrades: number;
}

export interface SessionEquityPoint {
  timeMs: number;
  equity: number;
  peakEquity: number;
  drawdownPct: number;
  drawdownUsd: number;
}

export type SharpeBasis = 'TRADES' | 'MTM';

export interface SessionRiskSnapshot {
  currentEquity: number;
  peakEquity: number;
  currentDrawdownUsd: number;
  currentDrawdownPct: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  isAtPeak: boolean;
  sessionNetPnlUsd: number;
  sessionReturnPct: number;
  closedTradeCount: number;
  activeTradeCount: number;
  totalTradeSamples: number;
  tradeSharpeRatio: number | null;
  tradeMeanReturnPct: number;
  tradeStdDevPct: number;
  tradeSharpeStatus: 'READY' | 'INSUFFICIENT_TRADES' | 'ZERO_VOLATILITY';
  mtmSharpeRatio: number | null;
  mtmMeanReturnPct: number;
  mtmStdDevPct: number;
  mtmReturnSamples: number;
  mtmSharpeStatus: 'READY' | 'INSUFFICIENT_SAMPLES' | 'ZERO_VOLATILITY';
  activeBasis: SharpeBasis;
  activeSharpeRatio: number | null;
  sharpeRating: 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WEAK' | 'PENDING';
  recoveryFactor: number | null;
}

export interface TradeEquityCurvePoint {
  slotIndex: number; // 1..20 within the last-20 window
  globalIndex: number; // 1..N across the session
  id: string;
  orderId: string;
  setupType: string;
  direction: 'LONG' | 'SHORT';
  timeframe: Timeframe;
  exitReason: ClosedTradeRecord['exitReason'] | 'LIVE_OPEN';
  isLive: boolean;
  timestampMs: number;
  lotSize: number;
  netPnl: number;
  rMultiple: number;
  returnPct: number;
  equity: number;
  peakEquity: number;
  drawdownUsd: number;
  drawdownPct: number;
  rollingSharpe: number | null;
}

export interface TradePerformanceSeries {
  points: TradeEquityCurvePoint[];
  baselineEquity: number;
  totalTradesRecorded: number;
  windowLimit: number;
  windowNetPnl: number;
  windowReturnPct: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  currentDrawdownUsd: number;
  currentDrawdownPct: number;
  latestSharpe: number | null;
  peakSharpe: number | null;
  minSharpe: number | null;
  winRatePct: number;
}

export type AgentEngineMode = 'GEMINI_API' | 'ANTIGRAVITY_MCP' | 'HYBRID';

export type NewsSourceTier =
  | 'CENTRAL_BANK'
  | 'MACRO_AGENCY'
  | 'CALENDAR_WIRE'
  | 'METALS_INSTITUTIONAL';

export interface CoreNewsSource {
  id: string;
  name: string;
  shortName: string;
  tier: NewsSourceTier;
  url: string;
  feedUrl: string | null;
  feedType: 'RSS' | 'JSON_CALENDAR' | 'PORTAL';
  impactWeight: number; // 1..10
  focus: string;
  status: 'ONLINE' | 'CACHED' | 'REFERENCE' | 'OFFLINE';
  lastFetchedMs?: number;
  headlineCount?: number;
}

export interface ScoredNewsHeadline {
  id: string;
  sourceId: string;
  sourceName: string;
  tier: NewsSourceTier;
  title: string;
  link: string;
  publishedAtMs: number;
  goldBias: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL';
  impactScore: number; // 0..100
  isEmergencyShock: boolean;
  matchedDrivers: string[];
}

export interface LiveNewsIntelligence {
  fetchedAtMs: number;
  liveSourceCount: number;
  totalSourceCount: number;
  calendarSource: 'FOREX_FACTORY_LIVE' | 'LOCAL_SCHEDULE';
  macroSentiment: 'BULLISH_GOLD' | 'BEARISH_GOLD' | 'NEUTRAL' | 'GEOPOLITICAL_SHOCK';
  sentimentScore: number; // -100..+100
  shockDetected: boolean;
  shockHeadline: string | null;
  headlines: ScoredNewsHeadline[];
  sources: CoreNewsSource[];
  calendarEvents: NewsEvent[];
}

export interface AgentConfig {
  minConfluenceScore: number; // 55..85
  minRrRatio: number; // 1.50..3.00
  maxDailyDrawdownPct: number; // 1.0..10.0
  maxConsecutiveLosses: number; // 2..6
  cooldownMinutesAfterLossStreak: number; // 15..240
  maxConcurrentPositions: number; // 1..6
  maxPortfolioHeatPct: number; // 1.0..6.0
  maxAllowedSpreadUsd: number; // 0.40..3.00
  allowCounterH4Scalps: boolean;
  allowAsianSessionEntries: boolean;
  autoScaleOutTp1Pct: number; // 25..75
  newsHighImpactPreMin: number; // 5..30
  newsHighImpactPostMin: number; // 10..60
  enableLiveNewsFeeds: boolean;
  killSwitchEngaged: boolean;
}

export type CircuitBreakerId =
  | 'KILL_SWITCH'
  | 'DAILY_DRAWDOWN_CAP'
  | 'CONSECUTIVE_LOSS_COOLDOWN'
  | 'MAX_OPEN_POSITIONS'
  | 'PORTFOLIO_HEAT_CAP'
  | 'SPREAD_ANOMALY_GUARD'
  | 'NEWS_SHOCK_GUARD';

export interface CircuitBreakerItem {
  id: CircuitBreakerId;
  label: string;
  status: 'OK' | 'WARNING' | 'TRIPPED';
  hardBlock: boolean;
  currentValue: string;
  limitValue: string;
  detail: string;
}

export interface CircuitBreakerSnapshot {
  canOpenNewTrades: boolean;
  effectiveRiskMultiplier: number; // 0, 0.5, 1.0
  consecutiveLosses: number;
  cooldownRemainingMin: number;
  dailyDrawdownPct: number;
  openPortfolioHeatPct: number;
  openPositionsCount: number;
  activeBreakers: string[];
  breakers: CircuitBreakerItem[];
  summaryEn: string;
  summaryFa: string;
}

export interface AgentAuditEntry {
  id: string;
  timestampMs: number;
  category:
    | 'SCAN'
    | 'PROPOSAL'
    | 'STAND_DOWN'
    | 'CIRCUIT_BREAKER'
    | 'KILL_SWITCH'
    | 'NEWS_SHOCK'
    | 'EXECUTION'
    | 'CONFIG';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  title: string;
  detail: string;
}




