import type {
  Advisory,
  AgentEngineMode,
  BasisDivergence,
  ClosedTradeRecord,
  ConfirmedPosition,
  HsmStage,
  MarketRegime,
  NewsEvent,
  NewsGateStatus,
  OrderExecutionType,
  PendingLimitOrder,
  SessionRiskSnapshot,
  TfsSnapshot,
  TpiSnapshot,
} from './types';

/**
 * Wraps an LTR token (signed numbers, $ prices, inequalities, R:R ratios, arrows, code paths)
 * in Unicode Left-to-Right Isolate (LRI U+2066 ... PDI U+2069) so RTL Persian sentences
 * never invert signs (+0.60R), dollar symbols ($5.13), inequalities (< 20ms), or arrows.
 */
export function ltr(value: string | number): string {
  return `\u2066${String(value)}\u2069`;
}

export function formatUsd(value: number, decimals = 2, signed = false): string {
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = value < 0 ? '-' : signed ? '+' : '';
  return ltr(`${sign}$${abs}`);
}

export function formatRegimeFa(label: MarketRegime['label']): string {
  switch (label) {
    case 'TRENDING_BULLISH':
      return 'روند صعودی';
    case 'TRENDING_BEARISH':
      return 'روند نزولی';
    case 'VOLATILE_EXPANSION':
      return 'انبساط پرنوسان';
    case 'RANGING':
    default:
      return 'رنج / تراکم';
  }
}

export function formatNewsGateFa(state: NewsGateStatus['state']): string {
  switch (state) {
    case 'LOCKOUT':
      return 'قفل خبری';
    case 'CAUTION':
      return 'احتیاط (۵۰٪)';
    case 'CLEAR':
    default:
      return 'آزاد';
  }
}

export function formatNewsImpactFa(impact: NewsEvent['impact']): string {
  switch (impact) {
    case 'HIGH':
      return 'مهم (قرمز)';
    case 'MEDIUM':
      return 'متوسط';
    case 'LOW':
    default:
      return 'کم‌اهمیت';
  }
}

export function formatBasisStatusFa(status: BasisDivergence['status']): string {
  switch (status) {
    case 'CRYPTO_INDUCEMENT':
      return 'تله نقدینگی کریپتو';
    case 'BASIS_DRIFT':
      return 'انحراف Basis';
    case 'ALIGNED':
    default:
      return 'هم‌تراز';
  }
}

export function formatHsmStageFa(stage: HsmStage): string {
  switch (stage) {
    case 'OPEN':
      return 'باز';
    case 'BREAK_EVEN_ARMED':
      return 'آماده ریسک‌فری (BE)';
    case 'RISK_FREE_TP1':
      return 'ریسک‌فری (TP1)';
    case 'CLOSED_TP2':
      return 'بسته‌شده در TP2';
    case 'STOPPED_OUT':
      return 'خروج با SL';
    default:
      return stage;
  }
}

export function formatActionTagFa(tag: ConfirmedPosition['actionTag']): string {
  switch (tag) {
    case 'HOLD_RUNNER':
      return 'نگهداری معامله';
    case 'ARM_BE':
      return 'آماده‌سازی BE';
    case 'MOVE_SL_RF':
      return 'انتقال SL به ریسک‌فری';
    case 'SCALE_PARTIAL':
      return 'سیو سود جزئی';
    case 'PROTECT_NEWS':
      return 'محافظت خبری';
    case 'EXIT_WARNING':
      return 'هشدار خروج';
    default:
      return tag;
  }
}

export function formatExitReasonFa(reason: ClosedTradeRecord['exitReason'] | 'LIVE_OPEN'): string {
  switch (reason) {
    case 'LIVE_OPEN':
      return 'باز (MTM)';
    case 'TP1_PARTIAL':
      return 'سیو ۵۰٪ TP1';
    case 'TP2_TARGET':
      return 'هدف TP2';
    case 'STOP_LOSS':
      return 'حد ضرر (SL)';
    case 'MANUAL_PARTIAL':
      return 'خروج جزئی دستی';
    case 'MANUAL_CLOSE':
      return 'بستن دستی';
    case 'MARGIN_STOP_OUT':
      return 'استاپ‌اوت مارجین';
    default:
      return reason;
  }
}

export function formatVerdictFa(verdict: Advisory['verdict']): string {
  switch (verdict) {
    case 'HOLD':
      return 'نگهداری (HOLD)';
    case 'SCALE':
      return 'افزایش حجم (SCALE)';
    case 'PROTECT':
      return 'محافظت (PROTECT)';
    case 'EXIT':
      return 'خروج (EXIT)';
    case 'VETO':
      return 'وتو (VETO)';
    default:
      return verdict;
  }
}

export function formatSharpeRatingFa(rating: SessionRiskSnapshot['sharpeRating']): string {
  switch (rating) {
    case 'EXCELLENT':
      return 'عالی';
    case 'GOOD':
      return 'مطلوب';
    case 'NEUTRAL':
      return 'خنثی';
    case 'WEAK':
      return 'منفی';
    case 'PENDING':
    default:
      return 'در انتظار';
  }
}

export function formatTfsBiasFa(bias: TfsSnapshot['bias']): string {
  switch (bias) {
    case 'BULLISH':
      return 'صعودی';
    case 'BEARISH':
      return 'نزولی';
    case 'NEUTRAL':
    default:
      return 'خنثی';
  }
}

export function formatTpiAlignmentFa(alignment: TpiSnapshot['alignmentLabel']): string {
  switch (alignment) {
    case 'STRONG_BULLISH_ALIGNMENT':
      return 'هم‌جهتی قوی صعودی';
    case 'STRONG_BEARISH_ALIGNMENT':
      return 'هم‌جهتی قوی نزولی';
    case 'MIXED_CONSOLIDATION':
    default:
      return 'تراکم و نوسان ترکیبی';
  }
}

export function formatPendingLimitStatusFa(status: PendingLimitOrder['status']): string {
  return status === 'PENDING_ENTRY' ? 'در انتظار ورود' : 'منقضی / وتو شده';
}

export function formatExecutionTypeFa(type: OrderExecutionType): string {
  return type === 'MARKET' ? 'مارکت (Market)' : 'لیمیت (Limit)';
}

export function formatAgentModeFa(mode: AgentEngineMode): string {
  switch (mode) {
    case 'HYBRID':
      return 'ترکیبی (Hybrid)';
    case 'GEMINI_API':
      return 'Gemini API';
    case 'ANTIGRAVITY_MCP':
      return 'Antigravity MCP';
    default:
      return mode;
  }
}

export function formatAgentToolFa(toolId: string): string {
  switch (toolId) {
    case 'scan_smc_zones':
      return 'اسکن نواحی SMC';
    case 'check_tpi_matrix':
      return 'ماتریس TPI';
    case 'verify_basis_divergence':
      return 'بررسی واگرایی Basis';
    case 'inspect_news_gate':
      return 'گیت اخبار USD';
    case 'validate_rr_guardrails':
      return 'گاردریل‌های R:R';
    case 'monitor_broker_trades':
      return 'پایش معاملات بروکر';
    default:
      return toolId;
  }
}
