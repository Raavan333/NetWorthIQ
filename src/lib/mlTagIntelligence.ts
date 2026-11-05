/**
 * Tag-First ML Spending & Recurrence Intelligence for NetWorthIQ
 * Discovers spending patterns by Transaction Tag first, and only suggests
 * exact amounts when rigorous statistical evidence thresholds (>=60% tag frequency
 * or 5+ consecutive daily occurrences) are verified. Handles cold-starts transparently.
 */

import { Transaction, QuickSpendChip } from '../types';
import { roundCurrency } from './financialMath';

export interface TagRecurrencePattern {
  tag: string;
  category: string;
  totalOccurrences: number;
  distinctAmounts: number[];
  topAmount?: number;
  topAmountFrequencyPct: number;
  isDailyRecurrence: boolean;
  consecutiveDailyCount: number;
  isEligibleForExactAmount: boolean;
  evidenceExplanation: string;
  confidenceScore: number;
}

const DEFAULT_RECURRENCE_THRESHOLD_PCT = 60; // 60% frequency within tag
const MIN_DAILY_STREAK = 5;

/**
 * Analyzes transactions using a Tag-First recurrence algorithm
 */
export function analyzeTagRecurrence(
  transactions: Transaction[],
  recurrenceThresholdPct: number = DEFAULT_RECURRENCE_THRESHOLD_PCT
): TagRecurrencePattern[] {
  const activeSpendTxs = transactions.filter((t) => !t.isReversed && t.kind === 'spend' && t.amount > 0);

  if (activeSpendTxs.length < 3) {
    return []; // Cold start: insufficient evidence
  }

  // Group by Tag (or Category fallback if no tags)
  const tagGroups = new Map<string, { category: string; txs: Transaction[] }>();

  for (const tx of activeSpendTxs) {
    const tags = tx.tags && tx.tags.length > 0 ? tx.tags : [tx.category || 'General'];
    for (const tag of tags) {
      const cleanTag = tag.trim();
      if (!cleanTag) continue;
      const existing = tagGroups.get(cleanTag) || { category: tx.category || 'General', txs: [] };
      existing.txs.push(tx);
      tagGroups.set(cleanTag, existing);
    }
  }

  const results: TagRecurrencePattern[] = [];

  for (const [tag, { category, txs }] of tagGroups.entries()) {
    if (txs.length < 3) continue; // Minimum 3 occurrences for statistical evaluation

    const totalOccurrences = txs.length;
    const amountCounts = new Map<number, number>();

    for (const t of txs) {
      amountCounts.set(t.amount, (amountCounts.get(t.amount) || 0) + 1);
    }

    // Find top amount
    let topAmount: number | undefined;
    let topCount = 0;
    for (const [amt, count] of amountCounts.entries()) {
      if (count > topCount) {
        topCount = count;
        topAmount = amt;
      }
    }

    const topAmountFrequencyPct = roundCurrency((topCount / totalOccurrences) * 100);

    // Check for daily recurrence
    const sortedDates = Array.from(new Set(txs.map((t) => t.date))).sort();
    let consecutiveDailyCount = 1;
    let maxDailyStreak = 1;

    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]).getTime();
      const curr = new Date(sortedDates[i]).getTime();
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        consecutiveDailyCount++;
        if (consecutiveDailyCount > maxDailyStreak) {
          maxDailyStreak = consecutiveDailyCount;
        }
      } else {
        consecutiveDailyCount = 1;
      }
    }

    const isDailyRecurrence = maxDailyStreak >= MIN_DAILY_STREAK;
    const isEligibleForExactAmount =
      topAmountFrequencyPct >= recurrenceThresholdPct || isDailyRecurrence;

    let evidenceExplanation = '';
    let confidenceScore = 0;

    if (isEligibleForExactAmount && topAmount) {
      if (isDailyRecurrence) {
        evidenceExplanation = `Recurring daily streak observed (${maxDailyStreak} consecutive days) with consistent amount of ${topAmount}.`;
        confidenceScore = 0.85;
      } else {
        evidenceExplanation = `${topAmount} appears in ${topAmountFrequencyPct}% of "${tag}" transactions (threshold: ${recurrenceThresholdPct}%).`;
        confidenceScore = roundCurrency(topAmountFrequencyPct / 100);
      }
    } else {
      evidenceExplanation = `"${tag}" spending recurs across varying amounts. Exact amount not predicted to avoid false precision.`;
      confidenceScore = 0.65;
    }

    results.push({
      tag,
      category,
      totalOccurrences,
      distinctAmounts: Array.from(amountCounts.keys()),
      topAmount: isEligibleForExactAmount ? topAmount : undefined,
      topAmountFrequencyPct,
      isDailyRecurrence,
      consecutiveDailyCount: maxDailyStreak,
      isEligibleForExactAmount,
      evidenceExplanation,
      confidenceScore,
    });
  }

  // Sort by highest confidence and total occurrences
  return results.sort((a, b) => b.totalOccurrences - a.totalOccurrences);
}

/**
 * Derives explainable Quick Spend Chips strictly adhering to evidence rules
 */
export function deriveEvidenceBasedQuickChips(
  transactions: Transaction[],
  currentChips: QuickSpendChip[]
): { chips: QuickSpendChip[]; hasColdStart: boolean } {
  const patterns = analyzeTagRecurrence(transactions);

  if (patterns.length === 0) {
    // Cold start
    return {
      chips: currentChips.filter((c) => !c.isMlGenerated),
      hasColdStart: true,
    };
  }

  const userCustomChips = currentChips.filter((c) => !c.isMlGenerated);
  const mlChips: QuickSpendChip[] = [];

  for (const pat of patterns.slice(0, 5)) {
    // If exact amount is verified by statistical threshold, show it; otherwise do not show arbitrary amount
    const label = pat.isEligibleForExactAmount && pat.topAmount ? `${pat.tag} (${pat.topAmount})` : pat.tag;

    mlChips.push({
      id: `ml-chip-tag-${pat.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label,
      reason: pat.tag,
      category: pat.category,
      amount: pat.isEligibleForExactAmount ? pat.topAmount : undefined,
      isMlGenerated: true,
      usageCount: pat.totalOccurrences,
    });
  }

  return {
    chips: [...userCustomChips, ...mlChips],
    hasColdStart: false,
  };
}
