/**
 * What-If Financial Simulator Engine for NetWorthIQ
 * Runs read-only hypothetical balance sheet and debt simulations without mutating ledger data.
 */

import { Holding, Liability, Bill, AppSettings, Currency, WhatIfScenario } from '../types';
import { roundCurrency, safeAdd, safeSub } from './financialMath';
import { generateAmortizationSchedule } from './loanPrepaymentEngine';
import { computeUnifiedBalanceSheet } from './unifiedSimulationEngine';
import { calculateContractualEmi } from './debtEngine';

export interface WhatIfSimulationInput {
  name: string;
  monthlyExtraLoanPayment?: number;
  targetLoanId?: string;
  monthlySpendCutPct?: number; // e.g. 10 for 10% reduction in discretionary spending
  additionalMonthlySavings?: number;
  creditCardLumpSumPayment?: number;
  targetCardId?: string;
  emergencyReserveAdjustment?: number; // increase/decrease target reserve
}

/**
 * Runs a hypothetical simulation against the user's current financial profile
 */
export function runWhatIfSimulation(
  input: WhatIfSimulationInput,
  currentHoldings: Holding[],
  currentLiabilities: Liability[],
  currentBills: Bill[],
  settings: AppSettings,
  currencies: Record<string, Currency>
): WhatIfScenario {
  const balanceSheet = computeUnifiedBalanceSheet({
    holdings: currentHoldings,
    liabilities: currentLiabilities,
    bills: currentBills,
    incomeStreams: [],
    settings,
    currencies,
  });

  // 1. Baseline debt payoff analysis
  let baselineTotalInterest = 0;
  let baselineMaxMonths = 0;

  for (const l of currentLiabilities) {
    if ((l.outstanding || 0) <= 0) continue;
    const rate = l.kind === 'card' ? (l.penaltyRateMonthlyPct ? l.penaltyRateMonthlyPct * 12 : 36) : l.ratePct || 12;
    const emi = l.monthlyEmi || (l.tenureMonths ? calculateContractualEmi(l.outstanding, rate, l.tenureMonths) : roundCurrency(l.outstanding * 0.05));
    const sched = generateAmortizationSchedule(l.outstanding, rate, emi);
    baselineTotalInterest = safeAdd(baselineTotalInterest, sched.totalInterest);
    if (sched.monthsCount > baselineMaxMonths) {
      baselineMaxMonths = sched.monthsCount;
    }
  }

  // 2. Projected scenario calculations
  let projectedTotalInterest = 0;
  let projectedMaxMonths = 0;
  const extraMonthly = input.monthlyExtraLoanPayment || 0;

  for (const l of currentLiabilities) {
    let out = l.outstanding || 0;
    if (out <= 0) continue;

    // Lump sum credit card payment scenario
    if (input.targetCardId === l.id && input.creditCardLumpSumPayment && input.creditCardLumpSumPayment > 0) {
      out = Math.max(0, safeSub(out, input.creditCardLumpSumPayment));
    }

    const rate = l.kind === 'card' ? (l.penaltyRateMonthlyPct ? l.penaltyRateMonthlyPct * 12 : 36) : l.ratePct || 12;
    let emi = l.monthlyEmi || (l.tenureMonths ? calculateContractualEmi(out, rate, l.tenureMonths) : roundCurrency(out * 0.05));

    // Additional payment to target loan or highest interest liability
    if ((input.targetLoanId === l.id || (!input.targetLoanId && extraMonthly > 0)) && extraMonthly > 0) {
      emi = safeAdd(emi, extraMonthly);
    }

    const sched = generateAmortizationSchedule(out, rate, emi);
    projectedTotalInterest = safeAdd(projectedTotalInterest, sched.totalInterest);
    if (sched.monthsCount > projectedMaxMonths) {
      projectedMaxMonths = sched.monthsCount;
    }
  }

  const interestSaved = Math.max(0, safeSub(baselineTotalInterest, projectedTotalInterest));
  const debtMonthsSaved = Math.max(0, safeSub(baselineMaxMonths, projectedMaxMonths));

  // Monthly cash flow impact
  const monthlyCashFlowImpact = safeAdd(
    extraMonthly,
    input.additionalMonthlySavings || 0
  );

  // 1-Year Net Worth Projection Comparison
  const baselineNetWorth1Yr = safeSub(
    balanceSheet.grossLiquidCashBase,
    safeSub(balanceSheet.totalDebtOutstandingBase, (baselineTotalInterest / Math.max(1, baselineMaxMonths)) * 12)
  );
  const projectedNetWorth1Yr = safeAdd(
    baselineNetWorth1Yr,
    safeAdd(interestSaved / 2, (input.additionalMonthlySavings || 0) * 12)
  );

  return {
    id: `whatif-${Date.now()}`,
    name: input.name || 'Hypothetical Plan',
    description: `Simulating ${extraMonthly > 0 ? `+${extraMonthly}/mo extra debt payoff` : ''} ${input.additionalMonthlySavings ? `+${input.additionalMonthlySavings}/mo savings` : ''}`,
    changes: {
      monthlyExtraLoanPayment: input.monthlyExtraLoanPayment,
      targetLoanId: input.targetLoanId,
      monthlySpendCutPct: input.monthlySpendCutPct,
      additionalMonthlySavings: input.additionalMonthlySavings,
      creditCardLumpSumPayment: input.creditCardLumpSumPayment,
      targetCardId: input.targetCardId,
      emergencyReserveAdjustment: input.emergencyReserveAdjustment,
    },
    results: {
      baselineDebtFreeMonths: baselineMaxMonths,
      projectedDebtFreeMonths: projectedMaxMonths,
      debtMonthsSaved,
      baselineTotalInterest,
      projectedTotalInterest,
      interestSaved,
      baselineNetWorth1Yr: roundCurrency(baselineNetWorth1Yr),
      projectedNetWorth1Yr: roundCurrency(projectedNetWorth1Yr),
      monthlyCashFlowImpact: roundCurrency(monthlyCashFlowImpact),
      emergencyReserveProtected: balanceSheet.trueAllocatableSurplusBase >= (input.creditCardLumpSumPayment || 0),
    },
  };
}
