import type {
  AgentAuditEntry,
  AgentConfig,
  CircuitBreakerItem,
  CircuitBreakerSnapshot,
  ClosedTradeRecord,
  ConfirmedPosition,
  LiveNewsIntelligence,
  NewsGateStatus,
  SimAccountState,
} from './types';

const round2 = (v: number) => Math.round(v * 100) / 100;

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  minConfluenceScore: 62,
  minRrRatio: 1.75,
  maxDailyDrawdownPct: 3.0,
  maxConsecutiveLosses: 3,
  cooldownMinutesAfterLossStreak: 60,
  maxConcurrentPositions: 3,
  maxPortfolioHeatPct: 2.5,
  maxAllowedSpreadUsd: 1.2,
  allowCounterH4Scalps: false,
  allowAsianSessionEntries: true,
  autoScaleOutTp1Pct: 50,
  newsHighImpactPreMin: 15,
  newsHighImpactPostMin: 30,
  enableLiveNewsFeeds: true,
  killSwitchEngaged: false,
};

export function sanitizeAgentConfig(partial: Partial<AgentConfig>, base: AgentConfig = DEFAULT_AGENT_CONFIG): AgentConfig {
  const clamp = (val: unknown, fallback: number, min: number, max: number) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  return {
    minConfluenceScore: Math.round(clamp(partial.minConfluenceScore, base.minConfluenceScore, 55, 85)),
    minRrRatio: round2(clamp(partial.minRrRatio, base.minRrRatio, 1.5, 3.0)),
    maxDailyDrawdownPct: round2(clamp(partial.maxDailyDrawdownPct, base.maxDailyDrawdownPct, 1.0, 10.0)),
    maxConsecutiveLosses: Math.round(clamp(partial.maxConsecutiveLosses, base.maxConsecutiveLosses, 2, 6)),
    cooldownMinutesAfterLossStreak: Math.round(
      clamp(partial.cooldownMinutesAfterLossStreak, base.cooldownMinutesAfterLossStreak, 15, 240)
    ),
    maxConcurrentPositions: Math.round(clamp(partial.maxConcurrentPositions, base.maxConcurrentPositions, 1, 6)),
    maxPortfolioHeatPct: round2(clamp(partial.maxPortfolioHeatPct, base.maxPortfolioHeatPct, 1.0, 6.0)),
    maxAllowedSpreadUsd: round2(clamp(partial.maxAllowedSpreadUsd, base.maxAllowedSpreadUsd, 0.4, 3.0)),
    allowCounterH4Scalps:
      typeof partial.allowCounterH4Scalps === 'boolean' ? partial.allowCounterH4Scalps : base.allowCounterH4Scalps,
    allowAsianSessionEntries:
      typeof partial.allowAsianSessionEntries === 'boolean'
        ? partial.allowAsianSessionEntries
        : base.allowAsianSessionEntries,
    autoScaleOutTp1Pct: Math.round(clamp(partial.autoScaleOutTp1Pct, base.autoScaleOutTp1Pct, 25, 75)),
    newsHighImpactPreMin: Math.round(clamp(partial.newsHighImpactPreMin, base.newsHighImpactPreMin, 5, 30)),
    newsHighImpactPostMin: Math.round(clamp(partial.newsHighImpactPostMin, base.newsHighImpactPostMin, 10, 60)),
    enableLiveNewsFeeds:
      typeof partial.enableLiveNewsFeeds === 'boolean' ? partial.enableLiveNewsFeeds : base.enableLiveNewsFeeds,
    killSwitchEngaged:
      typeof partial.killSwitchEngaged === 'boolean' ? partial.killSwitchEngaged : base.killSwitchEngaged,
  };
}

/**
 * Counts the current unbroken losing streak from the most recent closed trades (newest first).
 * Also returns the timestamp of the latest loss for automated cooldown calculation.
 */
export function computeLossStreak(closedTrades: ClosedTradeRecord[]): {
  consecutiveLosses: number;
  lastLossAtMs: number | null;
} {
  let consecutiveLosses = 0;
  let lastLossAtMs: number | null = null;

  const sorted = [...closedTrades].sort((a, b) => b.closedAtMs - a.closedAtMs);
  for (const t of sorted) {
    // Ignore partial scale-outs when measuring full trade outcomes
    if (t.exitReason === 'TP1_PARTIAL' || t.exitReason === 'MANUAL_PARTIAL') continue;
    if (t.netPnl < 0) {
      consecutiveLosses += 1;
      if (lastLossAtMs === null) lastLossAtMs = t.closedAtMs;
    } else {
      break;
    }
  }

  return { consecutiveLosses, lastLossAtMs };
}

/**
 * Deterministic Institutional Portfolio & Execution Risk Circuit Breaker.
 * Zero LLM override — hard mathematical & operational authority over whether Payam may open or propose trades.
 */
export function evaluateRiskCircuitBreakers(params: {
  config: AgentConfig;
  simAccount: SimAccountState;
  confirmedPositions: ConfirmedPosition[];
  closedTrades: ClosedTradeRecord[];
  spread: number;
  newsGate: NewsGateStatus;
  liveNews?: LiveNewsIntelligence | null;
  cooldownBypassAfterMs?: number | null;
  nowMs?: number;
}): CircuitBreakerSnapshot {
  const nowMs = params.nowMs ?? Date.now();
  const { config, simAccount, confirmedPositions, closedTrades, spread, newsGate, liveNews } = params;
  const breakers: CircuitBreakerItem[] = [];

  // 1. Emergency Out-of-Band Kill Switch
  if (config.killSwitchEngaged) {
    breakers.push({
      id: 'KILL_SWITCH',
      label: 'Emergency Kill Switch',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: 'ENGAGED',
      limitValue: 'DISARMED',
      detail: 'Master emergency kill switch is engaged — autonomous scans and all new entries are hard-locked.',
    });
  } else {
    breakers.push({
      id: 'KILL_SWITCH',
      label: 'Emergency Kill Switch',
      status: 'OK',
      hardBlock: false,
      currentValue: 'DISARMED',
      limitValue: 'DISARMED',
      detail: 'Normal operational authorization active.',
    });
  }

  // 2. Daily Drawdown Hard Cap
  const peak = Math.max(simAccount.initialBalance, simAccount.peakEquity, 1);
  const dailyDrawdownPct = round2(Math.max(0, ((peak - simAccount.equity) / peak) * 100));
  if (dailyDrawdownPct >= config.maxDailyDrawdownPct) {
    breakers.push({
      id: 'DAILY_DRAWDOWN_CAP',
      label: 'Daily Drawdown Cap',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: `${dailyDrawdownPct.toFixed(2)}%`,
      limitValue: `${config.maxDailyDrawdownPct.toFixed(1)}%`,
      detail: `Equity drawdown (${dailyDrawdownPct.toFixed(2)}%) breached daily hard stop (${config.maxDailyDrawdownPct.toFixed(1)}%). Capital preservation lock active.`,
    });
  } else if (dailyDrawdownPct >= config.maxDailyDrawdownPct * 0.72) {
    breakers.push({
      id: 'DAILY_DRAWDOWN_CAP',
      label: 'Daily Drawdown Cap',
      status: 'WARNING',
      hardBlock: false,
      currentValue: `${dailyDrawdownPct.toFixed(2)}%`,
      limitValue: `${config.maxDailyDrawdownPct.toFixed(1)}%`,
      detail: `Approaching daily drawdown limit — risk automatically throttled to 50%.`,
    });
  } else {
    breakers.push({
      id: 'DAILY_DRAWDOWN_CAP',
      label: 'Daily Drawdown Cap',
      status: 'OK',
      hardBlock: false,
      currentValue: `${dailyDrawdownPct.toFixed(2)}%`,
      limitValue: `${config.maxDailyDrawdownPct.toFixed(1)}%`,
      detail: 'Equity curve well inside daily drawdown budget.',
    });
  }

  // 3. Consecutive Loss Tilt-Prevention Cooldown
  const filteredTrades = params.cooldownBypassAfterMs
    ? closedTrades.filter((t) => t.closedAtMs > params.cooldownBypassAfterMs!)
    : closedTrades;
  const { consecutiveLosses, lastLossAtMs } = computeLossStreak(filteredTrades);
  const elapsedMin = lastLossAtMs ? (nowMs - lastLossAtMs) / 60_000 : Infinity;
  const cooldownRemainingMin =
    consecutiveLosses >= config.maxConsecutiveLosses && elapsedMin < config.cooldownMinutesAfterLossStreak
      ? Math.ceil(config.cooldownMinutesAfterLossStreak - elapsedMin)
      : 0;

  if (cooldownRemainingMin > 0) {
    breakers.push({
      id: 'CONSECUTIVE_LOSS_COOLDOWN',
      label: 'Loss Streak Cooldown',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: `${consecutiveLosses} losses (${cooldownRemainingMin}m left)`,
      limitValue: `Max ${config.maxConsecutiveLosses}`,
      detail: `${consecutiveLosses} consecutive losses hit — mandatory ${cooldownRemainingMin}m anti-revenge-trading cooldown enforced.`,
    });
  } else if (consecutiveLosses >= Math.max(2, config.maxConsecutiveLosses - 1)) {
    breakers.push({
      id: 'CONSECUTIVE_LOSS_COOLDOWN',
      label: 'Loss Streak Cooldown',
      status: 'WARNING',
      hardBlock: false,
      currentValue: `${consecutiveLosses} losses`,
      limitValue: `Max ${config.maxConsecutiveLosses}`,
      detail: `Elevated loss streak (${consecutiveLosses}) — position risk cut by 50% until next win.`,
    });
  } else {
    breakers.push({
      id: 'CONSECUTIVE_LOSS_COOLDOWN',
      label: 'Loss Streak Cooldown',
      status: 'OK',
      hardBlock: false,
      currentValue: `${consecutiveLosses} losses`,
      limitValue: `Max ${config.maxConsecutiveLosses}`,
      detail: 'No tilt or consecutive-loss lockout active.',
    });
  }

  // 4. Max Concurrent Open Positions
  const openPositionsCount = confirmedPositions.length;
  if (openPositionsCount >= config.maxConcurrentPositions) {
    breakers.push({
      id: 'MAX_OPEN_POSITIONS',
      label: 'Max Open Positions',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: `${openPositionsCount} open`,
      limitValue: `Max ${config.maxConcurrentPositions}`,
      detail: `Maximum concurrent gold exposure (${config.maxConcurrentPositions} positions) reached.`,
    });
  } else {
    breakers.push({
      id: 'MAX_OPEN_POSITIONS',
      label: 'Max Open Positions',
      status: 'OK',
      hardBlock: false,
      currentValue: `${openPositionsCount} open`,
      limitValue: `Max ${config.maxConcurrentPositions}`,
      detail: `${config.maxConcurrentPositions - openPositionsCount} position slot(s) available.`,
    });
  }

  // 5. Total Open Portfolio Risk Heat %
  const totalOpenRiskUsd = confirmedPositions.reduce((sum, p) => {
    // Risk-free Break-Even positions carry ~0 stop-loss risk
    if (p.stage === 'RISK_FREE_TP1') return sum;
    return sum + Math.max(0, p.riskUsd || Math.abs(p.entry - p.stopLoss) * p.lotSize * 100);
  }, 0);
  const openPortfolioHeatPct = round2((totalOpenRiskUsd / Math.max(100, simAccount.equity)) * 100);
  if (openPortfolioHeatPct >= config.maxPortfolioHeatPct) {
    breakers.push({
      id: 'PORTFOLIO_HEAT_CAP',
      label: 'Portfolio Risk Heat',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: `${openPortfolioHeatPct.toFixed(2)}%`,
      limitValue: `${config.maxPortfolioHeatPct.toFixed(1)}%`,
      detail: `Aggregate open stop-loss risk (${openPortfolioHeatPct.toFixed(2)}%) exceeded portfolio heat limit.`,
    });
  } else if (openPortfolioHeatPct >= config.maxPortfolioHeatPct * 0.75) {
    breakers.push({
      id: 'PORTFOLIO_HEAT_CAP',
      label: 'Portfolio Risk Heat',
      status: 'WARNING',
      hardBlock: false,
      currentValue: `${openPortfolioHeatPct.toFixed(2)}%`,
      limitValue: `${config.maxPortfolioHeatPct.toFixed(1)}%`,
      detail: `Portfolio heat near cap (${openPortfolioHeatPct.toFixed(2)}%); reduce next position size.`,
    });
  } else {
    breakers.push({
      id: 'PORTFOLIO_HEAT_CAP',
      label: 'Portfolio Risk Heat',
      status: 'OK',
      hardBlock: false,
      currentValue: `${openPortfolioHeatPct.toFixed(2)}%`,
      limitValue: `${config.maxPortfolioHeatPct.toFixed(1)}%`,
      detail: 'Open stop-loss risk well within institutional budget.',
    });
  }

  // 6. Spread Anomaly & Liquidity Thinness Guard
  if (spread > config.maxAllowedSpreadUsd) {
    breakers.push({
      id: 'SPREAD_ANOMALY_GUARD',
      label: 'Spread Anomaly Guard',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: `$${spread.toFixed(2)}`,
      limitValue: `≤ $${config.maxAllowedSpreadUsd.toFixed(2)}`,
      detail: `XAU/USD spread ($${spread.toFixed(2)}) exceeds execution safety threshold ($${config.maxAllowedSpreadUsd.toFixed(2)}).`,
    });
  } else {
    breakers.push({
      id: 'SPREAD_ANOMALY_GUARD',
      label: 'Spread Anomaly Guard',
      status: 'OK',
      hardBlock: false,
      currentValue: `$${spread.toFixed(2)}`,
      limitValue: `≤ $${config.maxAllowedSpreadUsd.toFixed(2)}`,
      detail: 'Interbank Gold spread nominal for clean execution.',
    });
  }

  // 7. Macro News Lockout & Breaking Geopolitical Shock Guard
  const shockActive = Boolean(liveNews?.shockDetected);
  if (newsGate.vetoNewEntries || shockActive) {
    breakers.push({
      id: 'NEWS_SHOCK_GUARD',
      label: 'Macro & Breaking Shock Shield',
      status: 'TRIPPED',
      hardBlock: true,
      currentValue: shockActive ? 'BREAKING SHOCK' : 'NEWS LOCKOUT',
      limitValue: 'CLEAR',
      detail: shockActive
        ? `Emergency breaking wire shock detected: "${liveNews?.shockHeadline ?? 'Macro Shock'}".`
        : `High-impact USD calendar blackout (${newsGate.activeEvent?.title ?? 'Macro Release'}).`,
    });
  } else if (newsGate.state === 'CAUTION') {
    breakers.push({
      id: 'NEWS_SHOCK_GUARD',
      label: 'Macro & Breaking Shock Shield',
      status: 'WARNING',
      hardBlock: false,
      currentValue: 'CAUTION 50%',
      limitValue: 'CLEAR',
      detail: `Medium-impact USD event (${newsGate.activeEvent?.title ?? 'Release'}) — sizing capped to 50%.`,
    });
  } else {
    breakers.push({
      id: 'NEWS_SHOCK_GUARD',
      label: 'Macro & Breaking Shock Shield',
      status: 'OK',
      hardBlock: false,
      currentValue: liveNews ? `${liveNews.macroSentiment.replace('_', ' ')}` : 'CLEAR',
      limitValue: 'CLEAR',
      detail: 'No imminent red-folder release or emergency breaking headline shock.',
    });
  }

  const tripped = breakers.filter((b) => b.hardBlock);
  const warnings = breakers.filter((b) => b.status === 'WARNING');
  const canOpenNewTrades = tripped.length === 0;
  const effectiveRiskMultiplier = !canOpenNewTrades ? 0 : warnings.length > 0 ? 0.5 : 1.0;

  const activeBreakers = tripped.map((b) => `${b.label} (${b.currentValue})`);
  const summaryEn = canOpenNewTrades
    ? warnings.length > 0
      ? `Governance THROTTLED (50% risk): ${warnings.map((w) => w.label).join(', ')}`
      : `All 7 Risk Circuit Breakers NOMINAL (100% Risk Budget · Heat ${openPortfolioHeatPct.toFixed(1)}%)`
    : `CIRCUIT BREAKER HALT: ${activeBreakers.join(' · ')}`;

  const summaryFa = canOpenNewTrades
    ? warnings.length > 0
      ? `محدودیت احتیاطی ۵۰٪ حجم فعال است (${warnings.map((w) => w.label).join('، ')})`
      : `هر ۷ فیوز ایمنی سرمایه سبز و نرمال است (ریسک باز پورتفو: ${openPortfolioHeatPct.toFixed(1)}٪)`
    : `توقف اضطراری توسط فیوزهای ایمنی: ${activeBreakers.join(' · ')}`;

  return {
    canOpenNewTrades,
    effectiveRiskMultiplier,
    consecutiveLosses,
    cooldownRemainingMin,
    dailyDrawdownPct,
    openPortfolioHeatPct,
    openPositionsCount,
    activeBreakers,
    breakers,
    summaryEn,
    summaryFa,
  };
}

export function createAuditEntry(
  category: AgentAuditEntry['category'],
  severity: AgentAuditEntry['severity'],
  title: string,
  detail: string,
  timestampMs = Date.now()
): AgentAuditEntry {
  return {
    id: `aud-${timestampMs.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestampMs,
    category,
    severity,
    title,
    detail,
  };
}
