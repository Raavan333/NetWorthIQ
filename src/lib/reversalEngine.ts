/**
 * Transaction Ledger & Reversal Engine for NetWorthIQ
 * Enforces atomic, idempotent, auditable, and mathematically sound reversals
 * of transactions across Bank Accounts, Fixed Deposits, Cash, and Credit Cards/Loans.
 */

import { Holding, Liability, Transaction, ReversalAuditRecord } from '../types';
import { roundCurrency, safeAdd, safeSub } from './financialMath';

export interface ReversalResult {
  success: boolean;
  error?: string;
  updatedHoldings: Holding[];
  updatedLiabilities: Liability[];
  updatedTransactions: Transaction[];
  auditRecord: ReversalAuditRecord;
  reversalTx: Transaction;
}

/**
 * Validates whether a transaction can be reversed safely without violating integrity
 */
export function validateReversalEligibility(
  txToReverse: Transaction,
  allTransactions: Transaction[],
  holdings: Holding[],
  liabilities: Liability[]
): { canReverse: boolean; reason?: string; dependentTxCount: number } {
  if (!txToReverse) {
    return { canReverse: false, reason: 'Transaction not found', dependentTxCount: 0 };
  }

  if (txToReverse.isReversed) {
    return { canReverse: false, reason: 'Transaction has already been reversed (Idempotency protected)', dependentTxCount: 0 };
  }

  // Check dependent transactions:
  // If this was a transfer to Account B, check if Account B currently has enough balance to reverse
  // without dropping below zero, or if subsequent transactions depend on it.
  let dependentTxCount = 0;
  if (txToReverse.kind === 'transfer' && txToReverse.toId) {
    const destHolding = holdings.find((h) => h.id === txToReverse.toId);
    if (destHolding) {
      const receiveAmount = txToReverse.toAmount !== undefined ? txToReverse.toAmount : txToReverse.amount;
      const currentDestBal = destHolding.principalOrValue || 0;
      if (currentDestBal < receiveAmount) {
        return {
          canReverse: false,
          reason: `Cannot reverse transfer: destination account "${destHolding.name}" has balance of ${currentDestBal}, which is less than the reversal deduction of ${receiveAmount}. Funds were subsequently spent.`,
          dependentTxCount: 1,
        };
      }
    }
  }

  // Count transactions created chronologically after this one on the same accounts
  const txDate = new Date(txToReverse.date).getTime();
  dependentTxCount = allTransactions.filter(
    (t) =>
      !t.isReversed &&
      t.id !== txToReverse.id &&
      new Date(t.date).getTime() >= txDate &&
      (t.fromId === txToReverse.fromId ||
        t.toId === txToReverse.fromId ||
        t.fromId === txToReverse.toId ||
        t.toId === txToReverse.toId)
  ).length;

  return { canReverse: true, dependentTxCount };
}

/**
 * Executes an atomic, idempotent reversal of any completed financial transaction
 */
export function executeTransactionReversal(
  txToReverse: Transaction,
  currentHoldings: Holding[],
  currentLiabilities: Liability[],
  currentTransactions: Transaction[],
  reversalReason: string = 'User requested deletion'
): ReversalResult {
  const eligibility = validateReversalEligibility(txToReverse, currentTransactions, currentHoldings, currentLiabilities);
  if (!eligibility.canReverse) {
    throw new Error(eligibility.reason || 'Transaction is not eligible for reversal');
  }

  const updatedHoldings = currentHoldings.map((h) => ({ ...h }));
  const updatedLiabilities = currentLiabilities.map((l) => ({ ...l }));
  const timestamp = new Date().toISOString();
  const reversalTxId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  let previousBalanceSource: number | undefined;
  let restoredBalanceSource: number | undefined;
  let previousBalanceDestination: number | undefined;
  let restoredBalanceDestination: number | undefined;

  const sourceHolding = updatedHoldings.find((h) => h.id === (txToReverse.fromId || txToReverse.sourceId));
  const sourceLiability = updatedLiabilities.find((l) => l.id === (txToReverse.fromId || txToReverse.sourceId));
  const destHolding = updatedHoldings.find((h) => h.id === txToReverse.toId);
  const destLiability = updatedLiabilities.find((l) => l.id === txToReverse.toId);

  const amount = txToReverse.amount;

  switch (txToReverse.kind) {
    case 'spend': {
      // Original Spend: Money was deducted from Source (Holding or Card)
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      } else if (sourceLiability && sourceLiability.kind === 'card') {
        previousBalanceSource = sourceLiability.outstanding || 0;
        restoredBalanceSource = Math.max(0, safeSub(previousBalanceSource, amount));
        sourceLiability.outstanding = restoredBalanceSource;
        if (txToReverse.isDebitCardPayment) {
          sourceLiability.debitUsageCount = Math.max(0, (sourceLiability.debitUsageCount || 1) - 1);
        }
      }
      break;
    }

    case 'income': {
      // Original Income: Money was added to Destination (Holding)
      if (destHolding) {
        previousBalanceDestination = destHolding.principalOrValue || 0;
        restoredBalanceDestination = safeSub(previousBalanceDestination, amount);
        destHolding.principalOrValue = restoredBalanceDestination;
      }
      break;
    }

    case 'transfer': {
      // Original Transfer: Deducted from Source, Added to Destination
      // Reversal: Add back to Source, Deduct from Destination
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      }
      if (destHolding) {
        const receiveAmount = txToReverse.toAmount !== undefined ? txToReverse.toAmount : amount;
        previousBalanceDestination = destHolding.principalOrValue || 0;
        restoredBalanceDestination = safeSub(previousBalanceDestination, receiveAmount);
        destHolding.principalOrValue = restoredBalanceDestination;
      }
      break;
    }

    case 'cardPayment': {
      // Original Card Payment: Deducted from Bank (Source), Reduced Card Outstanding (Dest)
      // Reversal: Restore Bank balance (+amount), Restore Card Outstanding (+amount)
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      }
      if (destLiability) {
        previousBalanceDestination = destLiability.outstanding || 0;
        restoredBalanceDestination = safeAdd(previousBalanceDestination, amount);
        destLiability.outstanding = restoredBalanceDestination;
      }
      break;
    }

    case 'emi': {
      // Original EMI Payment: Deducted from Bank (Source), Reduced Loan Outstanding (Dest)
      // Reversal: Restore Bank balance (+amount), Restore Loan Outstanding (+amount)
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      }
      if (destLiability) {
        previousBalanceDestination = destLiability.outstanding || 0;
        restoredBalanceDestination = safeAdd(previousBalanceDestination, amount);
        destLiability.outstanding = restoredBalanceDestination;
      }
      break;
    }

    case 'adjustment': {
      // Directional adjustment
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      }
      break;
    }

    default: {
      // General fallback
      if (sourceHolding) {
        previousBalanceSource = sourceHolding.principalOrValue || 0;
        restoredBalanceSource = safeAdd(previousBalanceSource, amount);
        sourceHolding.principalOrValue = restoredBalanceSource;
      }
    }
  }

  // Create audit record
  const auditRecord: ReversalAuditRecord = {
    id: `audit-${Date.now()}`,
    originalTxId: txToReverse.id,
    reversalTxId,
    timestamp,
    amount,
    currency: txToReverse.currency,
    transactionKind: txToReverse.kind,
    sourceId: txToReverse.fromId || txToReverse.sourceId,
    destinationId: txToReverse.toId,
    sourceName: sourceHolding?.name || sourceLiability?.name,
    destinationName: destHolding?.name || destLiability?.name,
    reason: reversalReason,
    previousBalanceSource,
    restoredBalanceSource,
    previousBalanceDestination,
    restoredBalanceDestination,
    dependentTxCount: eligibility.dependentTxCount,
  };

  // Reversal ledger entry
  const reversalTx: Transaction = {
    id: reversalTxId,
    date: new Date().toISOString().split('T')[0],
    kind: 'adjustment',
    amount,
    currency: txToReverse.currency,
    fromId: txToReverse.toId, // inverted
    toId: txToReverse.fromId || txToReverse.sourceId, // inverted
    reason: `Reversal of: ${txToReverse.reason} (${reversalReason})`,
    category: 'Reversals & Corrections',
    tags: ['Reversal', 'Audit Ledger'],
    fxRateUsed: txToReverse.fxRateUsed || 1,
    reversalOfTxId: txToReverse.id,
    reversalRecordId: auditRecord.id,
  };

  // Mark original transaction as reversed
  const updatedTransactions = currentTransactions.map((t) =>
    t.id === txToReverse.id
      ? {
          ...t,
          isReversed: true,
          reversedAt: timestamp,
          reversalReason,
          reversalRecordId: auditRecord.id,
        }
      : t
  );

  return {
    success: true,
    updatedHoldings,
    updatedLiabilities,
    updatedTransactions,
    auditRecord,
    reversalTx,
  };
}
