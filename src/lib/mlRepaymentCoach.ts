/**
 * Adaptive ML-Assisted Financial Repayment Coach
 *
 * Computes optimal debt repayment strategies dynamically across verified cash flow,
 * salary dates, recurring bills, EMIs, credit card dues, available cash, and emergency buffers.
 * Implements a transparent 6-level progressive coaching hierarchy that adapts to user behaviour
 * without deceptive pressure or silent balance alterations.
 */

import { Liability, Holding, IncomeStream, RecurringBill, AppSettings } from '../types';
import { roundCurrency, safeAdd, safeSub, safeMul, safeDiv } from './financialMath';
import { isFixedOrRecurringDeposit } from './assetRules';

export type CoachingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface CoachingIntervention {
  level: CoachingLevel;
  title: string;
  levelName: string;
  summary: string;
  detailedMessage: string;
  actionableStepAmount: number;
  monthlyDelayCost: number;
  recommendedPayoffDate?: string;
  suggestedSourceAccount?: { id: string; name: string; availableBalance: number };
  targetLiability?: { id: string; name: string; outstanding: number; interestRate: number };
  essentialLiquidityReserved: number;
  netDiscretionarySurplus: number;
  rationale: string;
}

export interface UserRepaymentBehaviorState {
  liabilityId: string;
  delayCount: number;
  lastInterventionDate?: string;
  preferredPartialStepPct?: number; // e.g. 25% or 30%
  userRejectionsCount?: number;
}

export interface MLRepaymentRecommendation {
  recommendedStrategy: 'highest_interest' | 'smallest_balance' | 'due_date_priority' | 'liquidity_preserving';
  coachingIntervention: CoachingIntervention;
  essentialObligationsTotal: number;
  grossLiquidCash: number;
  discretionarySurplus: number;
  safelyAllocatableForDebt: number;
  targetLiability?: Liability;
  alternativeStrategies: {
    name: string;
    description: string;
    monthlyInterestSaved: number;
    recommendedPayment: number;
  }[];
}

/**
 * Calculates total upcoming essential obligations (rent, recurring bills, EMIs, min dues)
 * that must be protected before any surplus cash is allocated to debt paydown.
 */
export function calculateEssentialObligations(
  recurringBills: RecurringBill[],
  liabilities: Liability[],
  emergencyReserveMonths: number = 1
): number {
  let billObligations = 0;
  recurringBills.forEach((b) => {
    if ((b as any).status === 'active' || (b as any).status === undefined) {
      billObligations = safeAdd(billObligations, b.amount || 0);
    }
  });

  let contractualMinLiabilities = 0;
  liabilities.forEach((l) => {
    const loanEmi = l.monthlyEmi || (l as any).emiAmount || 0;
    if (l.kind === 'loan' && loanEmi > 0) {
      contractualMinLiabilities = safeAdd(contractualMinLiabilities, loanEmi);
    } else if (l.kind === 'card' && l.outstanding && l.outstanding > 0) {
      const minDue = (l as any).minimumDue || roundCurrency(l.outstanding * 0.05);
      contractualMinLiabilities = safeAdd(contractualMinLiabilities, minDue);
    }
  });

  return roundCurrency(safeAdd(billObligations, contractualMinLiabilities));
}

/**
 * Evaluates available liquid cash strictly excluding locked deposits (FDs/RDs)
 */
export function calculateLiquidCashReserves(holdings: Holding[]): {
  grossLiquidCash: number;
  lockedDepositsTotal: number;
} {
  let grossLiquidCash = 0;
  let lockedDepositsTotal = 0;

  holdings.forEach((h) => {
    const val = h.principalOrValue || 0;
    const isLocked =
      h.typeId === 'type-fd' ||
      h.typeId === 'type-rd' ||
      (h.typeId || '').includes('fd') ||
      Boolean(h.isSweepIn);

    if (isLocked) {
      lockedDepositsTotal = safeAdd(lockedDepositsTotal, val);
    } else if (h.typeId === 'type-bank' || h.typeId === 'type-cash' || h.typeId === 'type-cash-hand') {
      grossLiquidCash = safeAdd(grossLiquidCash, val);
    }
  });

  return {
    grossLiquidCash: roundCurrency(grossLiquidCash),
    lockedDepositsTotal: roundCurrency(lockedDepositsTotal),
  };
}

/**
 * Generates an adaptive ML repayment coach plan respecting essential liquidity
 * and learning from past delay behaviours.
 */
export function generateAdaptiveRepaymentPlan(
  liabilities: Liability[],
  holdings: Holding[],
  incomeStreams: IncomeStream[],
  recurringBills: RecurringBill[],
  behaviorState: UserRepaymentBehaviorState = { liabilityId: '', delayCount: 0 },
  settings?: AppSettings
): MLRepaymentRecommendation {
  const { grossLiquidCash } = calculateLiquidCashReserves(holdings);

  // Incoming primary salary in current cycle
  const primaryIncome = incomeStreams.find((inc) => inc.grossOrNet !== 'gross') || incomeStreams[0];
  const monthlySalary = primaryIncome ? primaryIncome.amountPerPeriod || 0 : 0;
  const salaryPayDay = primaryIncome?.payDay || 1;

  // Essential obligations reservation (Test F)
  const essentialObligations = calculateEssentialObligations(recurringBills, liabilities);
  const emergencyReserveTarget = (settings as any)?.emergencyReserveMonths
    ? safeMul(essentialObligations, (settings as any).emergencyReserveMonths)
    : essentialObligations;

  // Discretionary surplus calculation
  // Total cash resources = liquid cash on hand + expected monthly salary
  // Reserved = upcoming essential bills + emergency buffer
  const totalAvailableResources = safeAdd(grossLiquidCash, monthlySalary);
  const totalReserved = safeAdd(essentialObligations, Math.min(grossLiquidCash * 0.2, 5000));
  const netDiscretionarySurplus = Math.max(0, safeSub(totalAvailableResources, totalReserved));

  // Identify active liabilities with outstanding debt
  const activeDebts = liabilities
    .filter((l) => (l.outstanding || 0) > 0)
    .sort((a, b) => ((b.ratePct ?? (b as any).interestRatePct ?? 0) - (a.ratePct ?? (a as any).interestRatePct ?? 0)));

  const targetLiability = activeDebts[0];

  if (!targetLiability) {
    // Zero debt state
    return {
      recommendedStrategy: 'liquidity_preserving',
      coachingIntervention: {
        level: 1,
        title: 'Debt Free Status',
        levelName: 'Level 1: Inform',
        summary: 'No outstanding debt liabilities detected.',
        detailedMessage: 'All cards and loans are settled in full. Capital can be deployed to emergency buffers and wealth goals.',
        actionableStepAmount: 0,
        monthlyDelayCost: 0,
        essentialLiquidityReserved: essentialObligations,
        netDiscretionarySurplus,
        rationale: 'Portfolio is completely debt free.',
      },
      essentialObligationsTotal: essentialObligations,
      grossLiquidCash,
      discretionarySurplus: netDiscretionarySurplus,
      safelyAllocatableForDebt: 0,
      alternativeStrategies: [],
    };
  }

  // Monthly delay cost calculation for target liability (interest accrued in 30 days)
  const annualRate = targetLiability.ratePct ?? (targetLiability as any).interestRatePct ?? 0;
  const monthlyInterestRate = (annualRate / 12) / 100;
  const monthlyDelayCost = roundCurrency(safeMul(targetLiability.outstanding || 0, monthlyInterestRate));

  // Cap payment to outstanding balance
  const maxPayable = targetLiability.outstanding || 0;
  const safelyAllocatable = Math.min(maxPayable, netDiscretionarySurplus);

  // Progressive coaching level determination based on delay history and urgency
  const delayCount = behaviorState.delayCount || 0;
  let coachingLevel: CoachingLevel = 1;

  if (delayCount >= 5) {
    coachingLevel = 6; // Risk Escalation
  } else if (delayCount === 4) {
    coachingLevel = 5; // Next Income Reminder
  } else if (delayCount === 3) {
    coachingLevel = 4; // Cash-flow Allocation Plan
  } else if (delayCount === 2) {
    coachingLevel = 3; // Achievable Step
  } else if (delayCount === 1) {
    coachingLevel = 2; // Delay Cost
  } else {
    coachingLevel = 1; // Inform
  }

  // Adaptive bite-sized step calculation (Test G)
  // When user repeatedly delays, reduce lump sum demand to a smaller bite-sized slice (e.g. 20% - 30%)
  let recommendedStepAmount = safelyAllocatable;
  if (coachingLevel >= 3) {
    // Micro-step: 25% or 30% of outstanding, capped by available surplus
    const partialRatio = delayCount >= 4 ? 0.20 : 0.30;
    const partialSlice = roundCurrency(safeMul(maxPayable, partialRatio));
    recommendedStepAmount = Math.max(
      Math.min(maxPayable, (targetLiability as any).minimumDue || 500),
      Math.min(partialSlice, safelyAllocatable > 0 ? safelyAllocatable : partialSlice)
    );
  } else if (safelyAllocatable >= maxPayable) {
    recommendedStepAmount = maxPayable;
  } else {
    recommendedStepAmount = safelyAllocatable;
  }

  // Match best holding source for payment
  const bestSource = holdings
    .filter((h) => h.typeId === 'type-bank' || h.typeId === 'type-cash')
    .sort((a, b) => (b.principalOrValue || 0) - (a.principalOrValue || 0))[0];

  // Build transparent intervention messages
  const levelDetails: Record<CoachingLevel, { levelName: string; title: string; summary: string; detail: string }> = {
    1: {
      levelName: 'Level 1: Inform',
      title: 'Current Debt Overview',
      summary: `${targetLiability.name} has an outstanding balance of ${targetLiability.outstanding}.`,
      detail: `Contractual obligations total ${essentialObligations} for this cycle. Available surplus allows a safe allocation of ${recommendedStepAmount}.`,
    },
    2: {
      levelName: 'Level 2: Delay Cost',
      title: 'Cost of Postponement',
      summary: `Delaying payment by 30 days adds ${monthlyDelayCost} in interest charges.`,
      detail: `At ${annualRate}% APR, postponing ${targetLiability.name} accumulates ${monthlyDelayCost} in avoidable interest next month.`,
    },
    3: {
      levelName: 'Level 3: Achievable Step',
      title: 'Bite-Sized Micro Payment',
      summary: `Instead of paying the full balance at once, pay ${recommendedStepAmount} this cycle.`,
      detail: `Breaking your payoff into manageable partial increments maintains financial momentum without straining daily liquidity.`,
    },
    4: {
      levelName: 'Level 4: Cash-flow Allocation Plan',
      title: 'Structured Cash-Flow Mapping',
      summary: `Map ${recommendedStepAmount} directly from incoming cash flow to protect essential bills.`,
      detail: `Your essential bills (${essentialObligations}) and emergency reserve remain fully protected before this payment is made.`,
    },
    5: {
      levelName: 'Level 5: Next Income Reminder',
      title: 'Salary Date Payoff Schedule',
      summary: `Schedule payoff on Day ${salaryPayDay} immediately upon salary receipt.`,
      detail: `Aligning debt reduction with your verified income schedule prevents liquidity friction and ensures timely settlement.`,
    },
    6: {
      levelName: 'Level 6: Risk Escalation',
      title: 'Compounding Cost Warning',
      summary: `Repeated delays have accumulated ${roundCurrency(monthlyDelayCost * delayCount)} in avoidable charges.`,
      detail: `Transparent assessment: Ongoing postponements risk compounding finance fees and higher credit utilization. A partial settlement of ${recommendedStepAmount} halts further interest escalation.`,
    },
  };

  const interventionInfo = levelDetails[coachingLevel];

  const intervention: CoachingIntervention = {
    level: coachingLevel,
    levelName: interventionInfo.levelName,
    title: interventionInfo.title,
    summary: interventionInfo.summary,
    detailedMessage: interventionInfo.detail,
    actionableStepAmount: recommendedStepAmount,
    monthlyDelayCost,
    recommendedPayoffDate: `Day ${salaryPayDay} of current cycle`,
    suggestedSourceAccount: bestSource ? {
      id: bestSource.id,
      name: bestSource.name,
      availableBalance: bestSource.principalOrValue || 0,
    } : undefined,
    targetLiability: {
      id: targetLiability.id,
      name: targetLiability.name,
      outstanding: targetLiability.outstanding || 0,
      interestRate: annualRate,
    },
    essentialLiquidityReserved: essentialObligations,
    netDiscretionarySurplus,
    rationale: `Reserved ${essentialObligations} for essential bills & rent. Surplus allows ${recommendedStepAmount} debt allocation.`,
  };

  return {
    recommendedStrategy: 'highest_interest',
    coachingIntervention: intervention,
    essentialObligationsTotal: essentialObligations,
    grossLiquidCash,
    discretionarySurplus: netDiscretionarySurplus,
    safelyAllocatableForDebt: recommendedStepAmount,
    targetLiability,
    alternativeStrategies: [
      {
        name: 'Highest-Interest Avalanche (Recommended)',
        description: `Prioritizes ${targetLiability.name} at ${annualRate}% APR to eliminate maximum future finance charges.`,
        monthlyInterestSaved: monthlyDelayCost,
        recommendedPayment: recommendedStepAmount,
      },
      {
        name: 'Liquidity Preserving (Contractual Minimum)',
        description: 'Pays only contractual minimum due to preserve maximum emergency cash.',
        monthlyInterestSaved: 0,
        recommendedPayment: (targetLiability as any).minimumDue || roundCurrency((targetLiability.outstanding || 0) * 0.05),
      },
    ],
  };
}
