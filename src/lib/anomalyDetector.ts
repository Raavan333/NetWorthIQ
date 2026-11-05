/**
 * Financial Anomaly Detection Engine for NetWorthIQ
 * Identifies duplicate transactions, unusual amount spikes for categories/tags,
 * sudden balance drops, and recurring expense anomalies without mutating ledger data.
 */

import { Transaction, Holding, Liability, FinancialAnomaly, QuickSpendChip } from '../types';
import { roundCurrency } from './financialMath';

export interface DuplicateCandidateInput {
  id?: string;
  date: string;
  createdAt?: string;
  kind?: Transaction['kind'];
  amount: number;
  currency: string;
  sourceId?: string;
  fromId?: string;
  reason: string;
  category: string;
  chipId?: string;
  chipLabel?: string;
}

export interface DuplicateMatchResult {
  isDuplicate: boolean;
  matchedTransaction?: Transaction;
  elapsedMinutes: number;
  windowMinutes: number;
  resolvedChipSignature: string;
}

function normalizeToken(value?: string): string {
  return (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function formatDuplicateWindowLabel(minutes: number): string {
  const m = Math.max(1, Math.round(minutes || 60));
  if (m < 60) return `${m} min`;
  if (m % 1440 === 0) {
    const d = m / 1440;
    return d === 1 ? '24 hrs (1 day)' : `${d} days`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? '1 hr' : `${h} hrs`;
  }
  const hrs = Math.floor(m / 60);
  const rem = m % 60;
  return `${hrs}h ${rem}m`;
}

export function resolveChipSignature(
  item: { chipId?: string; chipLabel?: string; reason?: string; category?: string },
  quickChips: QuickSpendChip[] = []
): string {
  if (item.chipId && item.chipId.trim() !== '') {
    return `chip:${normalizeToken(item.chipId)}`;
  }
  const normReason = normalizeToken(item.reason);
  const normCategory = normalizeToken(item.category);
  if (quickChips.length > 0 && normReason) {
    const matchedChip = quickChips.find((c) => {
      const cReason = normalizeToken(c.reason || c.label);
      const cLabel = normalizeToken(c.label);
      const catMatches = !c.category || normalizeToken(c.category) === normCategory;
      return catMatches && (normReason === cReason || normReason === cLabel);
    });
    if (matchedChip) {
      return `chip:${normalizeToken(matchedChip.id)}`;
    }
  }
  if (item.chipLabel && item.chipLabel.trim() !== '') {
    return `label:${normalizeToken(item.chipLabel)}`;
  }
  return `reason:${normReason}`;
}

export function computeElapsedMinutesBetween(
  a: { date: string; createdAt?: string },
  b: { date: string; createdAt?: string }
): number {
  const dayMsA = new Date(`${a.date}T00:00:00`).getTime();
  const dayMsB = new Date(`${b.date}T00:00:00`).getTime();
  const calendarDiffMinutes =
    !isNaN(dayMsA) && !isNaN(dayMsB) ? Math.abs(dayMsA - dayMsB) / 60000 : 0;

  if (a.createdAt && b.createdAt) {
    const tsA = new Date(a.createdAt).getTime();
    const tsB = new Date(b.createdAt).getTime();
    if (!isNaN(tsA) && !isNaN(tsB)) {
      const exactMinutes = Math.abs(tsA - tsB) / 60000;
      // If user explicitly picked two different ledger calendar dates, respect at least calendar date distance
      if (a.date !== b.date && calendarDiffMinutes > exactMinutes + 720) {
        return calendarDiffMinutes;
      }
      return exactMinutes;
    }
  }

  return calendarDiffMinutes;
}

/**
 * Evaluates whether a candidate transaction is a predicted duplicate against existing transactions.
 * Strictly requires ALL 4 factors to match within `windowMinutes`:
 *   1. Same Source (`fromId` / `sourceId`)
 *   2. Same Amount (& Currency & Kind)
 *   3. Same Chip (or normalized chip/reason signature)
 *   4. Same Category
 * If elapsed time is strictly greater than `windowMinutes`, it is NOT predicted as a duplicate.
 */
export function evaluateDuplicateCandidate(
  candidate: DuplicateCandidateInput,
  existingTransactions: Transaction[],
  windowMinutes: number = 60,
  quickChips: QuickSpendChip[] = []
): DuplicateMatchResult {
  const safeWindow = Math.max(1, Number(windowMinutes) || 60);
  const candSource = normalizeToken(candidate.fromId || candidate.sourceId);
  const candCategory = normalizeToken(candidate.category || 'General');
  const candChipSig = resolveChipSignature(candidate, quickChips);
  const candKind = candidate.kind || 'spend';
  const candCreated = candidate.createdAt || new Date().toISOString();

  if (!candSource || candidate.amount <= 0 || !normalizeToken(candidate.reason)) {
    return {
      isDuplicate: false,
      elapsedMinutes: Infinity,
      windowMinutes: safeWindow,
      resolvedChipSignature: candChipSig,
    };
  }

  let closestMatch: Transaction | undefined;
  let closestMinutes = Infinity;

  for (const tx of existingTransactions) {
    if (tx.isReversed) continue;
    if (candidate.id && tx.id === candidate.id) continue;
    if (tx.kind !== candKind) continue;
    if (tx.currency !== candidate.currency) continue;
    if (Math.abs((tx.amount || 0) - candidate.amount) >= 0.005) continue;

    // 1. Same Source
    const txSource = normalizeToken(tx.fromId || tx.sourceId);
    if (!txSource || txSource !== candSource) continue;

    // 2. Same Category
    const txCategory = normalizeToken(tx.category || 'General');
    if (txCategory !== candCategory) continue;

    // 3. Same Chip (or matched chip/reason signature)
    const txChipSig = resolveChipSignature(tx, quickChips);
    if (txChipSig !== candChipSig) continue;

    // 4. Within configured minimum time range (beyond window = strictly NOT duplicate)
    const elapsed = computeElapsedMinutesBetween(
      { date: candidate.date, createdAt: candCreated },
      { date: tx.date, createdAt: tx.createdAt }
    );

    if (elapsed <= safeWindow && elapsed < closestMinutes) {
      closestMinutes = elapsed;
      closestMatch = tx;
    }
  }

  return {
    isDuplicate: Boolean(closestMatch && closestMinutes <= safeWindow),
    matchedTransaction: closestMatch,
    elapsedMinutes: closestMinutes,
    windowMinutes: safeWindow,
    resolvedChipSignature: candChipSig,
  };
}

/**
 * Scans transactions and accounts for financial anomalies
 */
export function detectFinancialAnomalies(
  transactions: Transaction[],
  holdings: Holding[],
  liabilities: Liability[],
  options?: {
    duplicateWindowMinutes?: number;
    quickChips?: QuickSpendChip[];
  }
): FinancialAnomaly[] {
  const anomalies: FinancialAnomaly[] = [];
  const activeTxs = transactions.filter((t) => !t.isReversed);
  const windowMinutes = Math.max(1, Number(options?.duplicateWindowMinutes) || 60);
  const quickChips = options?.quickChips || [];
  void liabilities;

  // 1. Detect Duplicate Transactions strictly using 4-factor signature + user-configured time window
  for (let i = 0; i < activeTxs.length; i++) {
    for (let j = i + 1; j < activeTxs.length; j++) {
      const a = activeTxs[i];
      const b = activeTxs[j];

      if (a.duplicateOverrideConfirmed || b.duplicateOverrideConfirmed) continue;

      const sourceA = normalizeToken(a.fromId || a.sourceId);
      const sourceB = normalizeToken(b.fromId || b.sourceId);
      if (!sourceA || sourceA !== sourceB) continue;

      if (
        Math.abs((a.amount || 0) - (b.amount || 0)) < 0.005 &&
        a.kind === b.kind &&
        a.currency === b.currency &&
        normalizeToken(a.category || 'General') === normalizeToken(b.category || 'General') &&
        resolveChipSignature(a, quickChips) === resolveChipSignature(b, quickChips)
      ) {
        const elapsedMinutes = computeElapsedMinutesBetween(a, b);

        // Strictly predict as duplicate ONLY within `windowMinutes`; beyond window is NOT duplicate
        if (elapsedMinutes <= windowMinutes) {
          const elapsedLabel =
            elapsedMinutes < 1
              ? 'under 1 min'
              : elapsedMinutes < 60
              ? `${Math.round(elapsedMinutes)} min`
              : `${(elapsedMinutes / 60).toFixed(1)} hrs`;

          anomalies.push({
            id: `anom-dup-${a.id}-${b.id}`,
            anomalyType: 'duplicate_transaction',
            severity: 'warning',
            title: 'Predicted Duplicate Transaction Within Guard Window',
            description: `Identical source, amount (${a.amount} ${a.currency}), chip/merchant ("${a.chipLabel || a.reason}"), and category (${a.category}) recorded ${elapsedLabel} apart (within your ${formatDuplicateWindowLabel(windowMinutes)} window).`,
            detectedAt: new Date().toISOString(),
            transactionId: a.id,
            amount: a.amount,
            suggestedAction: 'Reverse the unintended repeat entry or dismiss if both charges were deliberate.',
            confidenceScore: 0.93,
            status: 'active',
          });
        }
      }
    }
  }

  // 2. Detect Unusual Spending Spikes by Category/Tag (e.g. > 3.5x category median)
  const categoryAmounts = new Map<string, number[]>();
  for (const tx of activeTxs) {
    if (tx.kind === 'spend' && tx.amount > 0) {
      const cat = (tx.category || 'General').toLowerCase();
      const list = categoryAmounts.get(cat) || [];
      list.push(tx.amount);
      categoryAmounts.set(cat, list);
    }
  }

  for (const [cat, amounts] of categoryAmounts.entries()) {
    if (amounts.length >= 4) {
      const sorted = [...amounts].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const threshold = median * 3.5;

      for (const tx of activeTxs) {
        if (
          tx.kind === 'spend' &&
          (tx.category || 'General').toLowerCase() === cat &&
          tx.amount > threshold &&
          tx.amount > 2000
        ) {
          anomalies.push({
            id: `anom-spike-${tx.id}`,
            anomalyType: 'unusual_large_expense',
            severity: 'info',
            title: `Unusual Expense Spike in ${tx.category}`,
            description: `Expense of ${tx.amount} ${tx.currency} for "${tx.reason}" is ${roundCurrency(tx.amount / median)}x higher than typical ${cat} transactions (median: ${median}).`,
            detectedAt: new Date().toISOString(),
            transactionId: tx.id,
            amount: tx.amount,
            historicalBaseline: `Median ${cat} spend: ${median}`,
            suggestedAction: 'Verify this was an intentional one-time expense or ensure receipt is archived.',
            confidenceScore: 0.82,
            status: 'active',
          });
        }
      }
    }
  }

  // 3. Detect Sudden Bank Account Overdraft or Balance Drop
  for (const h of holdings) {
    if (h.typeId === 'type-bank' && (h.principalOrValue || 0) < 0) {
      anomalies.push({
        id: `anom-bal-${h.id}`,
        anomalyType: 'unexpected_balance_shift',
        severity: 'critical',
        title: `Negative Balance on ${h.name}`,
        description: `Account has fallen to ${h.principalOrValue} ${h.currency}. Sweep-in deposits or transfers may be required to prevent bank penalty fees.`,
        detectedAt: new Date().toISOString(),
        accountId: h.id,
        amount: Math.abs(h.principalOrValue || 0),
        suggestedAction: 'Top up this account or check if a recent payment should have come from another account.',
        confidenceScore: 0.99,
        status: 'active',
      });
    }
  }

  return anomalies;
}
