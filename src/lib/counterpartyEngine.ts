/**
 * Counterparty Offsetting, Interest-Rate Tranche Grouping & Silent Archiving Engine
 *
 * Groups multiple transactions with the same person (`debtorName`) into summed tranches
 * organized by interest rate (`0%` vs growing `% p.a.`), computes exact accrued interest,
 * performs reciprocal offsetting across lent & borrowed entries, and archives settled (`0`)
 * records out of active frontend sight while keeping them preserved for file exports.
 */

import {
  Receivable,
  ReceivableRepayment,
  GroupedCounterparty,
  CounterpartyRateBucket,
  Holding,
  Transaction,
} from '../types';
import { safeAdd, safeSub, roundCurrency, createProvenance } from './financialMath';

/**
 * Calculates accrued interest on an active receivable/payable from issueDate to referenceDate.
 */
export function calculateAccruedInterest(
  rec: Receivable,
  referenceDate: Date = new Date()
): number {
  const ratePct = rec.interestRatePct || 0;
  if (
    ratePct <= 0 ||
    rec.outstandingAmount <= 0 ||
    rec.status === 'collected' ||
    rec.status === 'written_off' ||
    rec.isArchived
  ) {
    return 0;
  }

  const startMs = new Date(rec.issueDate).getTime();
  if (isNaN(startMs)) return 0;

  const elapsedDays = Math.max(0, (referenceDate.getTime() - startMs) / (1000 * 60 * 60 * 24));
  const years = elapsedDays / 365;
  const accrued = rec.outstandingAmount * (ratePct / 100) * years;
  return roundCurrency(accrued);
}

/**
 * Normalizes counterparty name for reliable matching (case-insensitive, trimmed).
 */
export function normalizeCounterpartyName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Returns true if a receivable/payable record still carries an active unsettled balance.
 */
export function isActiveCounterpartyRecord(rec: Receivable): boolean {
  return (
    !rec.isArchived &&
    rec.status !== 'collected' &&
    rec.status !== 'written_off' &&
    (rec.outstandingAmount || 0) > 0.005
  );
}

/**
 * Groups receivables and payables by Counterparty Name (`debtorName`), summing active entries
 * by their interest rates (`rateBuckets`) and computing the net offset balance per person.
 */
export function groupReceivablesByCounterparty(
  receivables: Receivable[],
  referenceDate: Date = new Date()
): GroupedCounterparty[] {
  const map = new Map<string, Receivable[]>();
  const displayNameMap = new Map<string, string>();

  for (const r of receivables) {
    const rawName = (r.debtorName || 'Unnamed Counterparty').trim();
    const norm = normalizeCounterpartyName(rawName);
    if (!map.has(norm)) {
      map.set(norm, []);
      displayNameMap.set(norm, rawName);
    }
    map.get(norm)!.push(r);
  }

  const groups: GroupedCounterparty[] = [];

  for (const [normKey, records] of map.entries()) {
    let totalPrincipalOwedToUser = 0;
    let totalPrincipalUserOwes = 0;
    let totalAccruedLentInterest = 0;
    let totalAccruedBorrowedInterest = 0;
    let weightedRateNumerator = 0;
    let totalActivePrincipal = 0;
    let activeCount = 0;
    let settledCount = 0;

    const bucketMap = new Map<string, CounterpartyRateBucket>();

    for (const r of records) {
      const isSettled = !isActiveCounterpartyRecord(r);

      if (isSettled) {
        settledCount++;
        continue;
      }

      activeCount++;
      const dir: 'lent' | 'borrowed' = r.direction === 'borrowed' ? 'borrowed' : 'lent';
      const rate = roundCurrency(r.interestRatePct || 0);
      const accrued = calculateAccruedInterest(r, referenceDate);

      if (dir === 'lent') {
        totalPrincipalOwedToUser = safeAdd(totalPrincipalOwedToUser, r.outstandingAmount);
        totalAccruedLentInterest = safeAdd(totalAccruedLentInterest, accrued);
      } else {
        totalPrincipalUserOwes = safeAdd(totalPrincipalUserOwes, r.outstandingAmount);
        totalAccruedBorrowedInterest = safeAdd(totalAccruedBorrowedInterest, accrued);
      }

      if (rate > 0) {
        weightedRateNumerator += r.outstandingAmount * rate;
      }
      totalActivePrincipal = safeAdd(totalActivePrincipal, r.outstandingAmount);

      const bucketKey = `${dir}:${rate.toFixed(2)}`;
      const existingBucket = bucketMap.get(bucketKey);
      if (existingBucket) {
        existingBucket.principalTotal = safeAdd(existingBucket.principalTotal, r.outstandingAmount);
        existingBucket.accruedInterest = safeAdd(existingBucket.accruedInterest, accrued);
        existingBucket.totalWithInterest = safeAdd(
          existingBucket.principalTotal,
          existingBucket.accruedInterest
        );
        existingBucket.count += 1;
        existingBucket.recordIds.push(r.id);
      } else {
        bucketMap.set(bucketKey, {
          direction: dir,
          interestRatePct: rate,
          principalTotal: roundCurrency(r.outstandingAmount),
          accruedInterest: accrued,
          totalWithInterest: safeAdd(r.outstandingAmount, accrued),
          count: 1,
          recordIds: [r.id],
        });
      }
    }

    const rateBuckets = Array.from(bucketMap.values()).sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'lent' ? -1 : 1;
      return b.interestRatePct - a.interestRatePct;
    });

    const netAccruedInterest = safeSub(totalAccruedLentInterest, totalAccruedBorrowedInterest);
    const totalLentWithInterest = safeAdd(totalPrincipalOwedToUser, totalAccruedLentInterest);
    const totalBorrowedWithInterest = safeAdd(totalPrincipalUserOwes, totalAccruedBorrowedInterest);
    const netBalance = roundCurrency(safeSub(totalLentWithInterest, totalBorrowedWithInterest));

    const effectiveInterestRatePct =
      totalActivePrincipal > 0 ? roundCurrency(weightedRateNumerator / totalActivePrincipal) : 0;

    const allWrittenOff = records.length > 0 && records.every((r) => r.status === 'written_off');
    const isEffectivelySettled = activeCount === 0 || Math.abs(netBalance) <= 0.01;
    const status: GroupedCounterparty['status'] = allWrittenOff
      ? 'written_off'
      : isEffectivelySettled
      ? 'settled'
      : 'active';

    groups.push({
      name: displayNameMap.get(normKey) || normKey,
      totalPrincipalOwedToUser,
      totalPrincipalUserOwes,
      totalAccruedInterest: netAccruedInterest,
      totalAccruedLentInterest,
      totalAccruedBorrowedInterest,
      netBalance: isEffectivelySettled ? 0 : netBalance,
      activeCount,
      settledCount,
      records: [...records].sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '')),
      rateBuckets,
      effectiveInterestRatePct,
      status,
    });
  }

  return groups.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return Math.abs(b.netBalance) - Math.abs(a.netBalance);
  });
}

/**
 * Automatically offsets opposing (lent vs borrowed) active records for the same counterparty.
 * Prioritizes highest-interest obligations first so interest drag is retired immediately.
 * Settled entries (`outstanding <= 0`) are marked `collected` and `isArchived: true` so they
 * stay preserved in Vault/CSV/JSON exports while archived out of active frontend sight.
 */
export function autoOffsetCounterpartyBalances(
  records: Receivable[],
  referenceDateInput: Date | string = new Date(),
  onlyDebtorName?: string
): { updatedRecords: Receivable[]; totalOffsetAmount: number } {
  const referenceDate =
    typeof referenceDateInput === 'string' ? new Date(referenceDateInput) : referenceDateInput;
  const todayStr =
    typeof referenceDateInput === 'string' && /^\d{4}-\d{2}-\d{2}/.test(referenceDateInput)
      ? referenceDateInput.slice(0, 10)
      : referenceDate.toISOString().split('T')[0];

  const targetKey = onlyDebtorName ? normalizeCounterpartyName(onlyDebtorName) : null;

  const updatedMap = new Map<string, Receivable>();
  const byPeer = new Map<string, Receivable[]>();

  for (const r of records) {
    updatedMap.set(r.id, { ...r });
    const key = normalizeCounterpartyName(r.debtorName);
    if (!key) continue;
    if (targetKey && key !== targetKey) continue;
    if (!byPeer.has(key)) byPeer.set(key, []);
    byPeer.get(key)!.push(r);
  }

  let grandTotalOffset = 0;

  for (const [, peerRecords] of byPeer.entries()) {
    const lentActive = peerRecords
      .filter((r) => (r.direction || 'lent') === 'lent' && isActiveCounterpartyRecord(r))
      .sort(
        (a, b) =>
          (b.interestRatePct || 0) - (a.interestRatePct || 0) ||
          (a.issueDate || '').localeCompare(b.issueDate || '')
      );

    const borrowedActive = peerRecords
      .filter((r) => r.direction === 'borrowed' && isActiveCounterpartyRecord(r))
      .sort(
        (a, b) =>
          (b.interestRatePct || 0) - (a.interestRatePct || 0) ||
          (a.issueDate || '').localeCompare(b.issueDate || '')
      );

    if (lentActive.length === 0 || borrowedActive.length === 0) continue;

    const lentBalances = new Map<string, number>();
    for (const l of lentActive) {
      lentBalances.set(
        l.id,
        safeAdd(l.outstandingAmount, calculateAccruedInterest(l, referenceDate))
      );
    }

    const borrowedBalances = new Map<string, number>();
    for (const b of borrowedActive) {
      borrowedBalances.set(
        b.id,
        safeAdd(b.outstandingAmount, calculateAccruedInterest(b, referenceDate))
      );
    }

    const totalLent = Array.from(lentBalances.values()).reduce((s, v) => safeAdd(s, v), 0);
    const totalBorrowed = Array.from(borrowedBalances.values()).reduce((s, v) => safeAdd(s, v), 0);
    const offsetPool = Math.min(totalLent, totalBorrowed);

    if (offsetPool <= 0.005) continue;

    grandTotalOffset = safeAdd(grandTotalOffset, offsetPool);

    let remLentToReduce = offsetPool;
    let remBorrowedToReduce = offsetPool;

    for (const l of lentActive) {
      if (remLentToReduce <= 0.005) break;
      const cur = updatedMap.get(l.id)!;
      const effectiveDue = lentBalances.get(l.id) || cur.outstandingAmount;
      const reduceAmt = roundCurrency(Math.min(effectiveDue, remLentToReduce));
      const newOut = roundCurrency(Math.max(0, safeSub(effectiveDue, reduceAmt)));
      const isSettled = newOut <= 0.01;

      updatedMap.set(l.id, {
        ...cur,
        outstandingAmount: isSettled ? 0 : newOut,
        issueDate: !isSettled && (cur.interestRatePct || 0) > 0 ? todayStr : cur.issueDate,
        status: isSettled ? 'collected' : 'partially_collected',
        actualDate: isSettled ? todayStr : cur.actualDate,
        isArchived: isSettled ? true : cur.isArchived,
        archivedAt: isSettled ? todayStr : cur.archivedAt,
        repayments: [
          ...(cur.repayments || []),
          {
            id: `rep-offset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            date: todayStr,
            amount: reduceAmt,
            notes: `Offset against payable balance with ${cur.debtorName}`,
          },
        ],
      });
      remLentToReduce = safeSub(remLentToReduce, reduceAmt);
    }

    for (const b of borrowedActive) {
      if (remBorrowedToReduce <= 0.005) break;
      const cur = updatedMap.get(b.id)!;
      const effectiveDue = borrowedBalances.get(b.id) || cur.outstandingAmount;
      const reduceAmt = roundCurrency(Math.min(effectiveDue, remBorrowedToReduce));
      const newOut = roundCurrency(Math.max(0, safeSub(effectiveDue, reduceAmt)));
      const isSettled = newOut <= 0.01;

      updatedMap.set(b.id, {
        ...cur,
        outstandingAmount: isSettled ? 0 : newOut,
        issueDate: !isSettled && (cur.interestRatePct || 0) > 0 ? todayStr : cur.issueDate,
        status: isSettled ? 'collected' : 'partially_collected',
        actualDate: isSettled ? todayStr : cur.actualDate,
        isArchived: isSettled ? true : cur.isArchived,
        archivedAt: isSettled ? todayStr : cur.archivedAt,
        repayments: [
          ...(cur.repayments || []),
          {
            id: `rep-offset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            date: todayStr,
            amount: reduceAmt,
            notes: `Offset against receivable balance from ${cur.debtorName}`,
          },
        ],
      });
      remBorrowedToReduce = safeSub(remBorrowedToReduce, reduceAmt);
    }
  }

  return {
    updatedRecords: records.map((r) => updatedMap.get(r.id) || r),
    totalOffsetAmount: roundCurrency(grandTotalOffset),
  };
}

export interface DebtorReconciliationParams {
  receivables: Receivable[];
  holdings: Holding[];
  transactions: Transaction[];
  receivableId?: string;
  debtorName?: string;
  paidAmount: number;
  mode?: 'cash_deposit' | 'expense_offset';
  depositAccountId?: string;
  expenseDescription?: string;
  linkedBillId?: string;
  date?: string; // YYYY-MM-DD
  currency?: string;
  notes?: string;
}

export interface DebtorReconciliationResult {
  success: boolean;
  error?: string;
  updatedReceivables: Receivable[];
  updatedHoldings: Holding[];
  updatedTransactions: Transaction[];
  newLedgerTransaction?: Transaction;
  excessCreditAdvance?: Receivable;
  principalReducedTotal: number;
  excessAdvanceAmount: number;
  settledReceivableIds: string[];
}

/**
 * MODULE 3: Bi-directional Debt Offset & Principal Reconciliation Pipeline.
 *
 * 1. Principal Reduction: Subtracts paid/offset amount from debtor's `outstandingAmount` inside `receivables`.
 * 2. Main Ledger Cash Flow: Generates a corresponding `Transaction` (`kind: 'income'` when deposited into
 *    a target asset, or `'adjustment'` when offsetting an expense/bill directly) in `transactions`.
 * 3. Referential Integrity: Stamps `repayments[].txId = newLedgerTransaction.id` on every updated receivable
 *    and prepares atomic state snapshots so multi-store commit succeeds or rolls back together.
 * 4. Over-repayment Protection: Caps principal debt reduction strictly at `outstandingAmount` (`>= 0`) and
 *    automatically records any excess payment as a flagged Credit Advance (`direction: 'borrowed'`, `isCreditAdvance: true`).
 */
export function reconcileDebtorPaymentOrOffset(
  params: DebtorReconciliationParams
): DebtorReconciliationResult {
  const {
    receivables,
    holdings,
    transactions,
    receivableId,
    paidAmount,
    mode = 'cash_deposit',
    depositAccountId,
    expenseDescription,
    linkedBillId,
    notes,
  } = params;

  const cleanAmount = roundCurrency(Number(paidAmount) || 0);
  if (cleanAmount <= 0) {
    return {
      success: false,
      error: 'Reconciliation amount must be greater than zero.',
      updatedReceivables: receivables,
      updatedHoldings: holdings,
      updatedTransactions: transactions,
      principalReducedTotal: 0,
      excessAdvanceAmount: 0,
      settledReceivableIds: [],
    };
  }

  const primaryRec = receivableId ? receivables.find((r) => r.id === receivableId) : undefined;
  if (receivableId && !primaryRec) {
    return {
      success: false,
      error: `Receivable record (${receivableId}) not found.`,
      updatedReceivables: receivables,
      updatedHoldings: holdings,
      updatedTransactions: transactions,
      principalReducedTotal: 0,
      excessAdvanceAmount: 0,
      settledReceivableIds: [],
    };
  }

  const resolvedDebtorName = (primaryRec?.debtorName || params.debtorName || '').trim();
  if (!resolvedDebtorName) {
    return {
      success: false,
      error: 'Counterparty / debtor name is required for reconciliation.',
      updatedReceivables: receivables,
      updatedHoldings: holdings,
      updatedTransactions: transactions,
      principalReducedTotal: 0,
      excessAdvanceAmount: 0,
      settledReceivableIds: [],
    };
  }

  const workingHoldings = holdings.map((h) => ({ ...h }));
  const targetHolding = depositAccountId
    ? workingHoldings.find((h) => h.id === depositAccountId)
    : undefined;

  if (depositAccountId && mode === 'cash_deposit' && !targetHolding) {
    return {
      success: false,
      error: `Target deposit account (${depositAccountId}) not found.`,
      updatedReceivables: receivables,
      updatedHoldings: holdings,
      updatedTransactions: transactions,
      principalReducedTotal: 0,
      excessAdvanceAmount: 0,
      settledReceivableIds: [],
    };
  }

  const payDate = params.date || new Date().toISOString().split('T')[0];
  const refDateObj = new Date(payDate);
  const safeRefDate = isNaN(refDateObj.getTime()) ? new Date() : refDateObj;
  const currency =
    primaryRec?.currency || targetHolding?.currency || params.currency || 'INR';

  // Candidate active 'lent' receivables for this debtor (primaryRec first if explicitly targeted, then highest interest rate first)
  const normDebtor = normalizeCounterpartyName(resolvedDebtorName);
  const otherActiveLent = receivables
    .filter(
      (r) =>
        r.id !== primaryRec?.id &&
        normalizeCounterpartyName(r.debtorName) === normDebtor &&
        (r.direction || 'lent') === 'lent' &&
        isActiveCounterpartyRecord(r)
    )
    .sort((a, b) => (b.interestRatePct || 0) - (a.interestRatePct || 0));

  const orderedTargets: Receivable[] = [
    ...(primaryRec && (primaryRec.direction || 'lent') === 'lent' ? [primaryRec] : []),
    ...otherActiveLent,
  ];

  // Generate unique main ledger Transaction ID up front so `repayments[].txId` references it directly
  const txId = `tx-rec-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const isCashDeposit = Boolean(targetHolding) && mode === 'cash_deposit';
  const txKind: Transaction['kind'] = isCashDeposit ? 'income' : 'adjustment';

  if (isCashDeposit && targetHolding) {
    targetHolding.principalOrValue = roundCurrency(
      safeAdd(targetHolding.principalOrValue || 0, cleanAmount)
    );
  }

  const workingRecs = receivables.map((r) => ({
    ...r,
    repayments: [...(r.repayments || [])],
  }));

  let remainingToApply = cleanAmount;
  let principalReducedTotal = 0;
  const settledReceivableIds: string[] = [];
  const touchedRepaymentRefs: { recId: string; repaymentId: string }[] = [];

  for (const target of orderedTargets) {
    if (remainingToApply <= 0.005) break;
    const recIdx = workingRecs.findIndex((r) => r.id === target.id);
    if (recIdx === -1) continue;

    const currentRec = workingRecs[recIdx];
    const accrued = calculateAccruedInterest(currentRec, safeRefDate);
    const maxReducible = roundCurrency(safeAdd(currentRec.outstandingAmount || 0, accrued));
    if (maxReducible <= 0) continue;

    // Strictly cap principal reduction at maxReducible so outstandingAmount NEVER drops below 0
    const appliedSlice = roundCurrency(Math.min(maxReducible, remainingToApply));
    const nextOutstanding = roundCurrency(Math.max(0, safeSub(maxReducible, appliedSlice)));
    const isSettled = nextOutstanding <= 0.01;
    const repaymentId = `rep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const newRepayment: ReceivableRepayment = {
      id: repaymentId,
      date: payDate,
      amount: appliedSlice,
      depositAccountId: isCashDeposit ? depositAccountId : linkedBillId || undefined,
      txId,
      isExpenseOffset: mode === 'expense_offset' || !isCashDeposit,
      notes:
        notes ||
        (expenseDescription
          ? `${resolvedDebtorName} paid ${expenseDescription} (debt offset)`
          : `Principal reconciliation from ${resolvedDebtorName}`),
    };

    workingRecs[recIdx] = {
      ...currentRec,
      outstandingAmount: isSettled ? 0 : nextOutstanding,
      issueDate:
        !isSettled && (currentRec.interestRatePct || 0) > 0 ? payDate : currentRec.issueDate,
      status: isSettled ? 'collected' : 'partially_collected',
      actualDate: isSettled ? payDate : currentRec.actualDate,
      isArchived: isSettled ? true : currentRec.isArchived,
      archivedAt: isSettled ? payDate : currentRec.archivedAt,
      repayments: [...currentRec.repayments, newRepayment],
    };

    if (isSettled) {
      settledReceivableIds.push(currentRec.id);
    }
    touchedRepaymentRefs.push({ recId: currentRec.id, repaymentId });
    principalReducedTotal = safeAdd(principalReducedTotal, appliedSlice);
    remainingToApply = roundCurrency(safeSub(remainingToApply, appliedSlice));
  }

  // Over-repayment Protection: Any excess above total owed is recorded as a Credit Advance ('borrowed')
  let excessCreditAdvance: Receivable | undefined;
  const excessAdvanceAmount = remainingToApply > 0.01 ? roundCurrency(remainingToApply) : 0;

  if (excessAdvanceAmount > 0) {
    const advanceId = `rec-advance-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    excessCreditAdvance = {
      id: advanceId,
      debtorName: resolvedDebtorName,
      currency,
      principalAmount: excessAdvanceAmount,
      outstandingAmount: excessAdvanceAmount,
      interestRatePct: 0,
      issueDate: payDate,
      confidencePct: 100,
      direction: 'borrowed',
      isCreditAdvance: true,
      sourceOverpaymentTxId: txId,
      linkedBillId,
      status: 'active',
      isArchived: false,
      notes:
        notes ||
        `Credit advance from ${resolvedDebtorName} (excess payment of ${excessAdvanceAmount} beyond receivable principal)`,
      repayments: [],
      provenance: createProvenance(
        'user_entered',
        'Over-repayment excess recorded as credit advance'
      ),
    };
    workingRecs.unshift(excessCreditAdvance);

    // Link excessCreditAdvanceId on the last repayment record for complete auditability
    const lastRef = touchedRepaymentRefs[touchedRepaymentRefs.length - 1];
    if (lastRef) {
      const rIdx = workingRecs.findIndex((r) => r.id === lastRef.recId);
      if (rIdx >= 0) {
        workingRecs[rIdx] = {
          ...workingRecs[rIdx],
          repayments: workingRecs[rIdx].repayments.map((rep) =>
            rep.id === lastRef.repaymentId
              ? { ...rep, excessCreditAdvanceId: advanceId }
              : rep
          ),
        };
      }
    }
  }

  const primaryLinkedId =
    primaryRec?.id || orderedTargets[0]?.id || excessCreditAdvance?.id;

  const newLedgerTransaction: Transaction = {
    id: txId,
    date: payDate,
    createdAt: new Date().toISOString(),
    kind: txKind,
    amount: cleanAmount,
    currency,
    toId: isCashDeposit
      ? depositAccountId
      : depositAccountId || linkedBillId || primaryLinkedId,
    linkedReceivableId: primaryLinkedId,
    reason:
      mode === 'expense_offset' || expenseDescription
        ? `Debt Offset (${resolvedDebtorName}): ${expenseDescription || 'Expense Paid on Behalf'}`
        : `Repayment from ${resolvedDebtorName}`,
    category: 'Receivables & Loans',
    tags: [
      isCashDeposit ? 'Loan Repayment' : 'Debt Offset',
      ...(excessAdvanceAmount > 0 ? ['Credit Advance'] : []),
    ],
    fxRateUsed: 1.0,
    reconciled: true,
    notes:
      notes ||
      `Principal reduced: ${principalReducedTotal}${
        excessAdvanceAmount > 0 ? `, Credit advance logged: ${excessAdvanceAmount}` : ''
      }`,
    provenance: createProvenance(
      'user_entered',
      isCashDeposit
        ? 'Debtor repayment deposited into holding'
        : 'Bi-directional debtor expense offset'
    ),
  };

  return {
    success: true,
    updatedReceivables: workingRecs,
    updatedHoldings: workingHoldings,
    updatedTransactions: [newLedgerTransaction, ...transactions],
    newLedgerTransaction,
    excessCreditAdvance,
    principalReducedTotal,
    excessAdvanceAmount,
    settledReceivableIds,
  };
}

