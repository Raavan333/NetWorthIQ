import { Goal, Holding, Liability, AssetType, GoalSource } from '../types';
import { roundCurrency, safeAdd, safeSub, safeDiv, safeMul } from './financialMath';
import { isFixedOrRecurringDeposit } from './assetRules';

export interface EvaluatedGoalProgress {
  goalId: string;
  goalName: string;
  goalType: 'asset_accumulation' | 'debt_payoff';
  isDebtGoal: boolean;
  requiredAmount: number;
  allocatedEligibleFunds: number;
  fundingPercentage: number; // min(allocated_eligible_funds / required_amount, 1) * 100
  confirmedRepayments: number; // actual repayments confirmed
  settlementPercentage: number; // min(confirmed_repayments / required_amount, 1) * 100
  readyToRepayAmount: number; // min(allocatedEligibleFunds, remainingLiability)
  remainingLiability: number; // Math.max(0, requiredAmount - confirmedRepayments)
  isFullyFunded: boolean; // fundingPercentage >= 99.99
  isFullySettled: boolean; // settlementPercentage >= 99.99
  matchedLiability?: Liability;
  sourceAllocations: {
    sourceId: string;
    sourceName: string;
    requestedAmount: number;
    eligibleAllocatedAmount: number;
    isCapped: boolean;
    holdingBalance: number;
    mode: 'percentage' | 'fixed_amount' | 'units';
  }[];
}

export interface GoalAllocationReport {
  goals: EvaluatedGoalProgress[];
  sourceCapacities: Record<string, {
    holdingId: string;
    holdingName: string;
    totalBalance: number;
    totalAllocated: number;
    unallocatedBalance: number;
  }>;
  overallFundingPercentage: number;
  overallSettlementPercentage: number;
  totalRequired: number;
  totalAllocated: number;
  totalSettled: number;
}

/**
 * Calculates the requested monetary amount from a specific goal source based on holding valuation.
 */
export function calculateSourceRequestedAmount(
  src: GoalSource,
  holding: Holding | undefined,
  assetTypes: AssetType[] = []
): number {
  if (!holding) return src.allocationAmount || src.accumulatedAmount || 0;

  const currentVal = holding.principalOrValue || 0;
  const unitPrice =
    holding.currentPrice ||
    (holding.units && holding.units > 0 ? currentVal / holding.units : currentVal);

  if (src.allocationMode === 'units' && src.allocationUnits !== undefined && src.allocationUnits > 0) {
    return roundCurrency(src.allocationUnits * unitPrice);
  }

  if (
    src.allocationMode === 'fixed_amount' &&
    src.allocationAmount !== undefined &&
    src.allocationAmount > 0
  ) {
    return roundCurrency(src.allocationAmount);
  }

  if (src.allocationPct !== undefined && src.allocationPct > 0) {
    return roundCurrency((currentVal * src.allocationPct) / 100);
  }

  return roundCurrency(src.accumulatedAmount || 0);
}

/**
 * Evaluates all goals with cross-goal source capacity tracking to strictly prevent
 * double-allocation of the same underlying liquid buffer or asset holding.
 */
export function evaluateAllGoalsProgress(
  goals: Goal[],
  holdings: Holding[],
  liabilities: Liability[],
  assetTypes: AssetType[] = []
): GoalAllocationReport {
  // Initialize remaining balance ledger for each source holding
  const remainingLedger: Record<string, number> = {};
  const totalCapacityMap: Record<string, number> = {};
  const holdingNames: Record<string, string> = {};

  holdings.forEach((h) => {
    const val = roundCurrency(h.principalOrValue || 0);
    remainingLedger[h.id] = val;
    totalCapacityMap[h.id] = val;
    holdingNames[h.id] = h.name;
  });

  const evaluatedGoals: EvaluatedGoalProgress[] = [];

  let totalRequiredSum = 0;
  let totalAllocatedSum = 0;
  let totalSettledSum = 0;

  for (const g of goals) {
    const isDebt = g.goalType === 'debt_payoff' || Boolean(g.targetLiabilityId);
    const matchedLiab = isDebt && g.targetLiabilityId
      ? liabilities.find((l) => l.id === g.targetLiabilityId)
      : undefined;

    const startingDebt = isDebt
      ? roundCurrency(g.startingDebtAmount || g.cost || matchedLiab?.outstanding || 0)
      : roundCurrency(g.cost);

    const requiredAmount = startingDebt > 0 ? startingDebt : roundCurrency(g.cost);
    const currentOutstanding = matchedLiab ? roundCurrency(matchedLiab.outstanding || 0) : 0;

    let confirmedRepayments = 0;
    if (isDebt) {
      if (matchedLiab) {
        // Debt killed = baseline starting debt minus current remaining balance
        confirmedRepayments = Math.max(0, safeSub(startingDebt, currentOutstanding));
      } else if (g.partialPaymentsHistory && g.partialPaymentsHistory.length > 0) {
        confirmedRepayments = roundCurrency(
          g.partialPaymentsHistory.reduce((s, p) => safeAdd(s, p.amount), 0)
        );
      }
    } else {
      // For asset accumulation, confirmed repayments tracks accumulated deposits
      confirmedRepayments = roundCurrency(g.accumulatedTotal || 0);
    }

    // Allocate funds from sources with collision prevention
    let allocatedEligibleFunds = 0;
    const sourceAllocations: EvaluatedGoalProgress['sourceAllocations'] = [];

    const activeSources = g.sources || [];
    for (const src of activeSources) {
      const holding = holdings.find((h) => h.id === src.sourceId);
      const reqAmt = calculateSourceRequestedAmount(src, holding, assetTypes);

      let eligibleAmt = 0;
      let isCapped = false;

      if (holding) {
        const availableInLedger = Math.max(0, remainingLedger[holding.id] ?? 0);
        if (reqAmt <= availableInLedger) {
          eligibleAmt = reqAmt;
        } else {
          eligibleAmt = availableInLedger;
          isCapped = true;
        }
        remainingLedger[holding.id] = safeSub(availableInLedger, eligibleAmt);
      } else {
        // Non-holding cash stream (or virtual)
        eligibleAmt = reqAmt;
      }

      allocatedEligibleFunds = safeAdd(allocatedEligibleFunds, eligibleAmt);

      sourceAllocations.push({
        sourceId: src.sourceId,
        sourceName: holding?.name || src.sourceName || 'Funding Source',
        requestedAmount: reqAmt,
        eligibleAllocatedAmount: eligibleAmt,
        isCapped,
        holdingBalance: holding?.principalOrValue || 0,
        mode: src.allocationMode || (src.allocationPct ? 'percentage' : 'fixed_amount'),
      });
    }

    // Add standalone accumulatedTotal if it wasn't derived from holding sources
    if (!isDebt && g.accumulatedTotal && activeSources.length === 0) {
      allocatedEligibleFunds = safeAdd(allocatedEligibleFunds, g.accumulatedTotal);
    }

    allocatedEligibleFunds = roundCurrency(allocatedEligibleFunds);
    confirmedRepayments = roundCurrency(confirmedRepayments);

    const fundingPercentage =
      requiredAmount > 0
        ? Math.min(100, Math.max(0, roundCurrency((allocatedEligibleFunds / requiredAmount) * 100)))
        : 0;

    const settlementPercentage =
      requiredAmount > 0
        ? Math.min(100, Math.max(0, roundCurrency((confirmedRepayments / requiredAmount) * 100)))
        : 0;

    const remainingLiability = Math.max(0, safeSub(requiredAmount, confirmedRepayments));
    const readyToRepayAmount = isDebt
      ? Math.min(allocatedEligibleFunds, remainingLiability)
      : 0;

    const evaluated: EvaluatedGoalProgress = {
      goalId: g.id,
      goalName: g.name,
      goalType: isDebt ? 'debt_payoff' : 'asset_accumulation',
      isDebtGoal: isDebt,
      requiredAmount,
      allocatedEligibleFunds,
      fundingPercentage,
      confirmedRepayments,
      settlementPercentage,
      readyToRepayAmount,
      remainingLiability,
      isFullyFunded: fundingPercentage >= 99.99,
      isFullySettled: settlementPercentage >= 99.99,
      matchedLiability: matchedLiab,
      sourceAllocations,
    };

    evaluatedGoals.push(evaluated);

    totalRequiredSum = safeAdd(totalRequiredSum, requiredAmount);
    totalAllocatedSum = safeAdd(totalAllocatedSum, allocatedEligibleFunds);
    totalSettledSum = safeAdd(totalSettledSum, confirmedRepayments);
  }

  // Construct source capacities report
  const sourceCapacities: GoalAllocationReport['sourceCapacities'] = {};
  holdings.forEach((h) => {
    const total = totalCapacityMap[h.id] ?? 0;
    const remaining = remainingLedger[h.id] ?? 0;
    sourceCapacities[h.id] = {
      holdingId: h.id,
      holdingName: holdingNames[h.id] || h.name,
      totalBalance: total,
      totalAllocated: Math.max(0, safeSub(total, remaining)),
      unallocatedBalance: Math.max(0, remaining),
    };
  });

  const overallFundingPercentage =
    totalRequiredSum > 0
      ? Math.min(100, roundCurrency((totalAllocatedSum / totalRequiredSum) * 100))
      : 0;

  const overallSettlementPercentage =
    totalRequiredSum > 0
      ? Math.min(100, roundCurrency((totalSettledSum / totalRequiredSum) * 100))
      : 0;

  return {
    goals: evaluatedGoals,
    sourceCapacities,
    overallFundingPercentage,
    overallSettlementPercentage,
    totalRequired: totalRequiredSum,
    totalAllocated: totalAllocatedSum,
    totalSettled: totalSettledSum,
  };
}
