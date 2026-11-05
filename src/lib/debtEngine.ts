/**
 * Explainable Debt Intelligence Engine for NetWorthIQ
 * Evaluates debt portfolios across Mandatory-First, Avalanche (Highest Rate), and Snowball (Smallest Balance).
 * Strictly preserves contractual minimum payments to prevent defaults, distinguishes contractual
 * due dates from user-desired payoff deadlines, and computes exact interest savings.
 */

import {
  Liability,
  DebtRepaymentStrategy,
  DebtPlanItem,
  DebtStrategyComparison,
  Currency,
  AppSettings,
} from '../types';
import { convertToBase } from './calcEngine';
import { roundCurrency, safeAdd, safeSub } from './financialMath';
import {
  getLoanLockInStatus,
  calculateLoanPrepaymentCharge,
  resolveRemainingTenureMonths,
  resolveUserPrepaymentPolicy,
  getPolicyRateForRemainingTenure,
} from './loanPrepaymentEngine';

/**
 * Calculates standard monthly EMI using annuity formula:
 * P * r * (1 + r)^n / ((1 + r)^n - 1)
 */
export function calculateContractualEmi(
  principal: number,
  annualRatePct: number,
  tenureMonths: number
): number {
  if (principal <= 0 || tenureMonths <= 0) return 0;
  if (annualRatePct <= 0) {
    return roundCurrency(principal / tenureMonths);
  }
  const monthlyRate = annualRatePct / 12 / 100;
  const factor = Math.pow(1 + monthlyRate, tenureMonths);
  const emi = (principal * monthlyRate * factor) / (factor - 1);
  return roundCurrency(emi);
}

/**
 * Evaluates and compares repayment strategies for all active liabilities,
 * explicitly accounting for loan prepayment lock-in windows and automatic prepayment charges
 * derived from existing principal and remaining tenure so users never follow a suboptimal strategy.
 */
export function evaluateDebtStrategies(
  liabilities: Liability[],
  monthlySurplusForDebt: number,
  currencies: Record<string, Currency>,
  settings: AppSettings
): {
  strategies: Record<DebtRepaymentStrategy, DebtStrategyComparison>;
  recommendedStrategy: DebtRepaymentStrategy;
  totalOutstandingBase: number;
  mandatoryMonthlyObligationBase: number;
  highestInterestRate: number;
} {
  // Filter active debts with outstanding balance > 0
  const activeDebts = liabilities.filter((l) => (l.outstanding || 0) > 0);
  const now = new Date();

  let totalOutstandingBase = 0;
  let mandatoryMonthlyObligationBase = 0;
  let highestInterestRate = 0;

  const baseItems: DebtPlanItem[] = activeDebts.map((l) => {
    const outstandingBase = convertToBase(l.outstanding, l.currency, currencies);
    totalOutstandingBase = safeAdd(totalOutstandingBase, outstandingBase);

    const ratePct =
      l.kind === 'card'
        ? (l.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5) * 12
        : (l.ratePct || 0);

    if (ratePct > highestInterestRate) {
      highestInterestRate = ratePct;
    }

    let minPayment = 0;
    if (l.kind === 'loan') {
      const remMonths = resolveRemainingTenureMonths(l, now);
      minPayment =
        l.monthlyEmi ||
        calculateContractualEmi(l.outstanding, ratePct, Math.max(1, remMonths));
    } else {
      minPayment = Math.max(500, roundCurrency(l.outstanding * 0.05));
    }
    const minPaymentBase = convertToBase(minPayment, l.currency, currencies);
    mandatoryMonthlyObligationBase = safeAdd(mandatoryMonthlyObligationBase, minPaymentBase);

    const lockInfo = l.kind === 'loan' ? getLoanLockInStatus(l, now) : { remainingLockInMonths: 0 };
    const feeEval =
      l.kind === 'loan'
        ? calculateLoanPrepaymentCharge(l, l.outstanding || 0, { referenceDate: now })
        : { penaltyPct: 0, feeBasis: 'existing_principal' as const };
    const penaltyPct = feeEval.penaltyPct;
    const feeBasis: 'existing_principal' | 'prepaid_amount' = feeEval.feeBasis;

    return {
      liabilityId: l.id,
      name: l.name,
      kind: l.kind,
      outstanding: outstandingBase,
      interestRatePct: ratePct,
      contractualDueDay: l.dueDay ?? l.emiDay ?? 5,
      contractualDueDate: l.endDate,
      userDesiredPayoffDate: l.userDesiredPayoffDate,
      minMonthlyPayment: minPaymentBase,
      recommendedPayment: minPaymentBase,
      priorityRank: 1,
      estimatedMonthsToPayoff: 0,
      estimatedTotalInterest: 0,
      lockInMonthsRemaining: lockInfo.remainingLockInMonths,
      prepaymentPenaltyPct: penaltyPct,
      prepaymentFeeBasis: feeBasis,
      estimatedPrepaymentPenalties: 0,
      status: 'current',
    };
  });

  const discretionarySurplus = Math.max(0, monthlySurplusForDebt);
  const totalRepaymentBudget = safeAdd(mandatoryMonthlyObligationBase, discretionarySurplus);

  // Estimate baseline contractual interest per loan (without extra prepayments) so penalty-heavy loans aren't prepaid at a loss
  const estimateStandaloneInterest = (item: DebtPlanItem): number => {
    let bal = item.outstanding;
    let totInt = 0;
    let m = 0;
    const mRate = item.interestRatePct / 12 / 100;
    while (bal > 1 && m < 360) {
      m++;
      const interest = bal * mRate;
      totInt += interest;
      bal += interest;
      const pay = Math.min(bal, Math.max(1, item.minMonthlyPayment));
      bal -= pay;
    }
    return totInt;
  };

  const standaloneInterests = new Map<string, number>();
  baseItems.forEach((it) => standaloneInterests.set(it.liabilityId, estimateStandaloneInterest(it)));

  const runSimulation = (
    strategy: DebtRepaymentStrategy,
    strategyName: string,
    sortFn: (a: DebtPlanItem, b: DebtPlanItem) => number,
    baseRationale: string
  ): DebtStrategyComparison => {
    if (baseItems.length === 0) {
      return {
        strategy,
        strategyName,
        totalMonthlyAllocation: 0,
        totalInterestProjected: 0,
        totalPrepaymentPenaltiesProjected: 0,
        totalOutOfPocketCost: 0,
        debtFreeMonths: 0,
        interestSavedComparedToMin: 0,
        netSavingsComparedToMin: 0,
        items: [],
        rationale: 'No active debts found in portfolio.',
      };
    }

    const sorted = baseItems.map((it) => ({ ...it })).sort(sortFn);
    sorted.forEach((item, idx) => {
      item.priorityRank = idx + 1;
    });

    const isMinimumOnly = strategy === 'mandatory_first';
    const monthlyBudget = isMinimumOnly ? mandatoryMonthlyObligationBase : totalRepaymentBudget;

    let totalInterest = 0;
    let totalPenalties = 0;
    let months = 0;
    let heldReserveForLockedOrLumpSum = 0;
    const balances = sorted.map((item) => item.outstanding);
    const itemInterest = sorted.map(() => 0);
    const itemPenalties = sorted.map(() => 0);
    const itemPayoffMonth = sorted.map(() => 0);
    const maxMonths = 360;

    while (balances.some((b) => b > 1) && months < maxMonths) {
      months++;
      let extraBudget = isMinimumOnly
        ? 0
        : safeAdd(discretionarySurplus, heldReserveForLockedOrLumpSum);
      heldReserveForLockedOrLumpSum = 0;

      // Step 1: Accrue monthly interest and pay contractual minimums on every active debt
      for (let i = 0; i < sorted.length; i++) {
        if (balances[i] <= 0.01) continue;
        const monthlyRate = sorted[i].interestRatePct / 12 / 100;
        const interest = balances[i] * monthlyRate;
        totalInterest = safeAdd(totalInterest, interest);
        itemInterest[i] = safeAdd(itemInterest[i], interest);
        balances[i] = safeAdd(balances[i], interest);

        const minPay = Math.min(balances[i], sorted[i].minMonthlyPayment);
        balances[i] = safeSub(balances[i], minPay);

        if (balances[i] <= 0.01) {
          balances[i] = 0;
          if (itemPayoffMonth[i] === 0) itemPayoffMonth[i] = months;
          if (!isMinimumOnly) {
            const unusedMin = Math.max(0, safeSub(sorted[i].minMonthlyPayment, minPay));
            extraBudget = safeAdd(extraBudget, unusedMin);
          }
        }
      }

      // Also roll freed-up minimums from already-settled debts into extraBudget for Avalanche/Snowball
      if (!isMinimumOnly) {
        for (let i = 0; i < sorted.length; i++) {
          if (balances[i] <= 0.01 && itemPayoffMonth[i] > 0 && itemPayoffMonth[i] < months) {
            extraBudget = safeAdd(extraBudget, sorted[i].minMonthlyPayment);
          }
        }
      }

      // Step 2: Channel extra surplus according to priority, respecting lock-in months & prepayment charges
      if (!isMinimumOnly && extraBudget > 0.01) {
        for (let i = 0; i < sorted.length; i++) {
          if (balances[i] <= 0.01 || extraBudget <= 0.01) continue;

          const lockRemaining = sorted[i].lockInMonthsRemaining || 0;
          // Cannot prepay this loan until its lock-in period has elapsed; surplus routes to next unlocked debt
          if (months <= lockRemaining) {
            continue;
          }

          // Resolve live user-defined policy rate for current remaining tenure during simulation
          const origLiab = activeDebts.find((d) => d.id === sorted[i].liabilityId);
          const livePolicy = origLiab && origLiab.kind === 'loan' ? resolveUserPrepaymentPolicy(origLiab) : null;
          const approxRemMonths = Math.max(
            1,
            Math.ceil(balances[i] / Math.max(1, sorted[i].minMonthlyPayment))
          );
          const dynamicRatePct = livePolicy
            ? getPolicyRateForRemainingTenure(
                livePolicy,
                approxRemMonths,
                extraBudget >= balances[i]
              ).penaltyPct
            : (sorted[i].prepaymentPenaltyPct || 0);
          const taxMultiplier = livePolicy && livePolicy.applicableTaxPct > 0
            ? 1 + livePolicy.applicableTaxPct / 100
            : 1;
          const effectivePenPct = dynamicRatePct * taxMultiplier;
          const basis = livePolicy ? livePolicy.feeBasis : (sorted[i].prepaymentFeeBasis || 'existing_principal');

          if (effectivePenPct > 0 && basis === 'existing_principal') {
            const lumpPenalty = balances[i] * (effectivePenPct / 100);
            const totalToClear = safeAdd(balances[i], lumpPenalty);

            const remMonthlyRate = sorted[i].interestRatePct / 12 / 100;
            let estRemInt = 0;
            let simB = balances[i];
            let simM = 0;
            while (simB > 1 && simM < 360) {
              simM++;
              const intSlice = simB * remMonthlyRate;
              estRemInt += intSlice;
              simB = Math.max(0, simB + intSlice - Math.max(1, sorted[i].minMonthlyPayment));
            }

            const hasOtherUnlockedDebts = sorted.some(
              (other, idx) => idx !== i && balances[idx] > 0.01 && months > (other.lockInMonthsRemaining || 0)
            );
            if (strategy === 'avalanche' && lumpPenalty >= estRemInt && hasOtherUnlockedDebts) {
              continue;
            }

            if (extraBudget >= totalToClear) {
              balances[i] = 0;
              itemPenalties[i] = safeAdd(itemPenalties[i], lumpPenalty);
              totalPenalties = safeAdd(totalPenalties, lumpPenalty);
              extraBudget = safeSub(extraBudget, totalToClear);
              if (itemPayoffMonth[i] === 0) itemPayoffMonth[i] = months;
            } else {
              heldReserveForLockedOrLumpSum = safeAdd(heldReserveForLockedOrLumpSum, extraBudget);
              extraBudget = 0;
            }
          } else if (effectivePenPct > 0 && basis === 'prepaid_amount') {
            const multiplier = 1 + effectivePenPct / 100;
            const maxPrincipalAffordable = extraBudget / multiplier;
            const principalPaid = Math.min(balances[i], maxPrincipalAffordable);
            const feePaid = principalPaid * (effectivePenPct / 100);

            balances[i] = safeSub(balances[i], principalPaid);
            itemPenalties[i] = safeAdd(itemPenalties[i], feePaid);
            totalPenalties = safeAdd(totalPenalties, feePaid);
            extraBudget = safeSub(extraBudget, safeAdd(principalPaid, feePaid));

            if (balances[i] <= 0.01) {
              balances[i] = 0;
              if (itemPayoffMonth[i] === 0) itemPayoffMonth[i] = months;
            }
          } else {
            const extraPay = Math.min(balances[i], extraBudget);
            balances[i] = safeSub(balances[i], extraPay);
            extraBudget = safeSub(extraBudget, extraPay);
            if (balances[i] <= 0.01) {
              balances[i] = 0;
              if (itemPayoffMonth[i] === 0) itemPayoffMonth[i] = months;
            }
          }
        }

        // If all remaining debts are currently in lock-in, carry unused surplus forward in reserve until unlock month
        if (extraBudget > 0.01 && balances.some((b) => b > 0.01)) {
          heldReserveForLockedOrLumpSum = safeAdd(heldReserveForLockedOrLumpSum, extraBudget);
        }
      }
    }

    // Immediate Month-1 recommended payment: direct surplus to first unlocked target debt
    const firstUnlockedIdx = sorted.findIndex((it) => (it.lockInMonthsRemaining || 0) === 0);
    const targetIdxForMonth1 = firstUnlockedIdx >= 0 ? firstUnlockedIdx : -1;

    const itemsWithEstimates: DebtPlanItem[] = sorted.map((item, idx) => {
      const extraAlloc = !isMinimumOnly && idx === targetIdxForMonth1 ? discretionarySurplus : 0;
      return {
        ...item,
        recommendedPayment: safeAdd(item.minMonthlyPayment, extraAlloc),
        estimatedMonthsToPayoff: itemPayoffMonth[idx] || months,
        estimatedTotalInterest: roundCurrency(itemInterest[idx]),
        estimatedPrepaymentPenalties: roundCurrency(itemPenalties[idx]),
      };
    });

    const roundedInterest = roundCurrency(totalInterest);
    const roundedPenalties = roundCurrency(totalPenalties);

    return {
      strategy,
      strategyName,
      totalMonthlyAllocation: monthlyBudget,
      totalInterestProjected: roundedInterest,
      totalPrepaymentPenaltiesProjected: roundedPenalties,
      totalOutOfPocketCost: safeAdd(roundedInterest, roundedPenalties),
      debtFreeMonths: months,
      interestSavedComparedToMin: 0,
      netSavingsComparedToMin: 0,
      items: itemsWithEstimates,
      rationale: baseRationale,
    };
  };

  // Effective net rate helper for Charge-Aware Avalanche ranking
  const getEffectiveNetRate = (item: DebtPlanItem): number => {
    const penPct = item.prepaymentPenaltyPct || 0;
    const lockMo = item.lockInMonthsRemaining || 0;
    const estTotalInt = standaloneInterests.get(item.liabilityId) || 0;
    const estPenCost = item.outstanding * (penPct / 100);
    if (penPct > 0 && estPenCost >= estTotalInt) {
      // Prepaying loses money vs regular EMI; push to bottom of prepayment queue
      return -100 + item.interestRatePct;
    }
    const approxYears = Math.max(0.75, item.outstanding / Math.max(1, item.minMonthlyPayment * 12));
    const annualizedPenDrag = penPct / approxYears;
    const lockDrag = lockMo > 0 ? lockMo * 0.25 : 0;
    return item.interestRatePct - annualizedPenDrag - lockDrag;
  };

  // 1. Minimum Only: Pays contractual minimums only (0 prepayment penalties)
  const mandatoryStrategy = runSimulation(
    'mandatory_first',
    'Minimum Only (Scheduled EMIs)',
    (a, b) => (a.contractualDueDay || 0) - (b.contractualDueDay || 0),
    discretionarySurplus <= 0
      ? 'Recommended now: pay scheduled EMIs and minimum card dues on time so your bank cash buffer stays safe.'
      : 'Pays scheduled EMIs and statement minimums with zero early prepayment charges, keeping extra cash in your bank reserve.'
  );

  // 2. Avalanche: Penalty- & Lock-In-Adjusted Highest Effective Rate First
  const avalancheStrategy = runSimulation(
    'avalanche',
    'Avalanche (Highest Interest First)',
    (a, b) => getEffectiveNetRate(b) - getEffectiveNetRate(a),
    'Puts extra cash toward your highest-interest unlocked loan or card first so you lose the least money to interest.'
  );

  // 3. Snowball: Smallest balance first (skipping locked loans until lock-in ends)
  const snowballStrategy = runSimulation(
    'snowball',
    'Snowball (Smallest Balance First)',
    (a, b) => a.outstanding - b.outstanding,
    'Clears your smallest unlocked debt balance first so whole monthly EMI obligations disappear sooner.'
  );

  const baselineInterest = mandatoryStrategy.totalInterestProjected;
  const baselineTotalCost = mandatoryStrategy.totalOutOfPocketCost || baselineInterest;

  for (const strat of [mandatoryStrategy, avalancheStrategy, snowballStrategy]) {
    strat.interestSavedComparedToMin = Math.max(0, safeSub(baselineInterest, strat.totalInterestProjected));
    strat.netSavingsComparedToMin = roundCurrency(
      safeSub(baselineTotalCost, strat.totalOutOfPocketCost ?? strat.totalInterestProjected)
    );
  }

  // Choose the best loan clearance method across Avalanche, Snowball, and Minimum Only:
  // - If verified liquid surplus is 0 (or prepayment fees wipe out any savings), Minimum Only is genuinely best.
  // - If Snowball saves more after fees OR closes the first debt faster while retaining >=96% of Avalanche's net savings, Snowball wins.
  // - Otherwise Avalanche wins for maximum net money saved.
  const avaNet = avalancheStrategy.netSavingsComparedToMin ?? 0;
  const snowNet = snowballStrategy.netSavingsComparedToMin ?? 0;

  let recommendedStrategy: DebtRepaymentStrategy = 'mandatory_first';
  if (discretionarySurplus <= 0 || (avaNet <= 0 && snowNet <= 0)) {
    recommendedStrategy = 'mandatory_first';
  } else if (
    snowNet > avaNet + 1 ||
    (baseItems.length > 1 &&
      snowNet >= avaNet * 0.96 &&
      (snowballStrategy.items[0]?.estimatedMonthsToPayoff || 999) <
        (avalancheStrategy.items[0]?.estimatedMonthsToPayoff || 999))
  ) {
    recommendedStrategy = 'snowball';
  } else {
    recommendedStrategy = 'avalanche';
  }

  mandatoryStrategy.isRecommendedBest = recommendedStrategy === 'mandatory_first';
  avalancheStrategy.isRecommendedBest = recommendedStrategy === 'avalanche';
  snowballStrategy.isRecommendedBest = recommendedStrategy === 'snowball';

  const anyLocked = baseItems.some((i) => (i.lockInMonthsRemaining || 0) > 0);
  const anyPenalties = baseItems.some((i) => (i.prepaymentPenaltyPct || 0) > 0);

  if (recommendedStrategy === 'mandatory_first' && discretionarySurplus > 0 && (anyLocked || anyPenalties)) {
    mandatoryStrategy.rationale =
      'Best choice right now: prepayment fees or lock-in rules cost more than the interest you would save by paying early.';
  } else if (recommendedStrategy === 'snowball') {
    snowballStrategy.rationale =
      anyLocked || anyPenalties
        ? 'Best choice right now: clears your smallest unlocked balance fastest while avoiding costly prepayment fees.'
        : 'Best choice right now: closes your smallest loan fastest to free up monthly cash flow with strong interest savings.';
  } else if (recommendedStrategy === 'avalanche') {
    avalancheStrategy.rationale =
      anyLocked || anyPenalties
        ? 'Best choice right now: targets your costliest unlocked debt first after factoring in prepayment fees and lock-in periods.'
        : 'Best choice right now: attacks your highest interest rate first, saving you the most money overall.';
  }

  return {
    strategies: {
      mandatory_first: mandatoryStrategy,
      avalanche: avalancheStrategy,
      snowball: snowballStrategy,
    },
    recommendedStrategy,
    totalOutstandingBase: roundCurrency(totalOutstandingBase),
    mandatoryMonthlyObligationBase: roundCurrency(mandatoryMonthlyObligationBase),
    highestInterestRate,
  };
}

