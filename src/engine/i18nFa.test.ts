import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatActionTagFa,
  formatAgentModeFa,
  formatAgentToolFa,
  formatBasisStatusFa,
  formatExecutionTypeFa,
  formatExitReasonFa,
  formatHsmStageFa,
  formatNewsGateFa,
  formatNewsImpactFa,
  formatPendingLimitStatusFa,
  formatRegimeFa,
  formatSharpeRatingFa,
  formatTfsBiasFa,
  formatTpiAlignmentFa,
  formatVerdictFa,
} from './i18nFa';

const HAS_PERSIAN = /[\u0600-\u06FF]/;

test('All market regime, news gate, basis, and HSM formatters output natural Persian labels', () => {
  for (const r of ['TRENDING_BULLISH', 'TRENDING_BEARISH', 'RANGING', 'VOLATILE_EXPANSION'] as const) {
    assert.match(formatRegimeFa(r), HAS_PERSIAN);
  }
  for (const g of ['CLEAR', 'CAUTION', 'LOCKOUT'] as const) {
    assert.match(formatNewsGateFa(g), HAS_PERSIAN);
  }
  for (const i of ['HIGH', 'MEDIUM', 'LOW'] as const) {
    assert.match(formatNewsImpactFa(i), HAS_PERSIAN);
  }
  for (const b of ['ALIGNED', 'BASIS_DRIFT', 'CRYPTO_INDUCEMENT'] as const) {
    assert.match(formatBasisStatusFa(b), HAS_PERSIAN);
  }
  for (const s of ['OPEN', 'BREAK_EVEN_ARMED', 'RISK_FREE_TP1', 'CLOSED_TP2', 'STOPPED_OUT'] as const) {
    assert.match(formatHsmStageFa(s), HAS_PERSIAN);
  }
});

test('All action tags, exit reasons, verdicts, Sharpe ratings, and agent tools map to Persian', () => {
  for (const t of ['HOLD_RUNNER', 'ARM_BE', 'MOVE_SL_RF', 'SCALE_PARTIAL', 'PROTECT_NEWS', 'EXIT_WARNING'] as const) {
    assert.match(formatActionTagFa(t), HAS_PERSIAN);
  }
  for (const e of ['LIVE_OPEN', 'TP1_PARTIAL', 'TP2_TARGET', 'STOP_LOSS', 'MANUAL_PARTIAL', 'MANUAL_CLOSE', 'MARGIN_STOP_OUT'] as const) {
    assert.match(formatExitReasonFa(e), HAS_PERSIAN);
  }
  for (const v of ['HOLD', 'SCALE', 'PROTECT', 'EXIT', 'VETO'] as const) {
    assert.match(formatVerdictFa(v), HAS_PERSIAN);
  }
  for (const r of ['EXCELLENT', 'GOOD', 'NEUTRAL', 'WEAK', 'PENDING'] as const) {
    assert.match(formatSharpeRatingFa(r), HAS_PERSIAN);
  }
  for (const bias of ['BULLISH', 'BEARISH', 'NEUTRAL'] as const) {
    assert.match(formatTfsBiasFa(bias), HAS_PERSIAN);
  }
  for (const align of ['STRONG_BULLISH_ALIGNMENT', 'STRONG_BEARISH_ALIGNMENT', 'MIXED_CONSOLIDATION'] as const) {
    assert.match(formatTpiAlignmentFa(align), HAS_PERSIAN);
  }
  assert.match(formatPendingLimitStatusFa('PENDING_ENTRY'), HAS_PERSIAN);
  assert.match(formatPendingLimitStatusFa('EXPIRED_OR_VETOED'), HAS_PERSIAN);
  assert.match(formatExecutionTypeFa('MARKET'), HAS_PERSIAN);
  assert.match(formatExecutionTypeFa('LIMIT'), HAS_PERSIAN);
  assert.match(formatAgentModeFa('HYBRID'), HAS_PERSIAN);
  for (const tool of [
    'scan_smc_zones',
    'check_tpi_matrix',
    'verify_basis_divergence',
    'inspect_news_gate',
    'validate_rr_guardrails',
    'monitor_broker_trades',
  ]) {
    assert.match(formatAgentToolFa(tool), HAS_PERSIAN);
  }
});
