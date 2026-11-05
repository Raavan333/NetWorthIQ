/**
 * Loan Management, User-Defined Prepayment Policy & Full-Tenure Schedule Engine for NetWorthIQ
 * Strictly evaluates the user's one-time configured prepayment policy against live principal,
 * elapsed lock-in months, and remaining tenure — with ZERO hardcoded or assumed fee rates.
 */

import {
  Liability,
  LoanPrepaymentPolicy,
  LoanPrepaymentSimulation,
  AmortizationScheduleMonth,
  DebtRestructureComparison,
} from '../types';
import { roundCurrency, safeAdd, safeSub } from './financialMath';
import { calculateContractualEmi } from './debtEngine';

/**
 * Resolves exact remaining tenure in months for an active loan based on its
 * existing principal, interest rate, contractual EMI, or disbursement start date + tenure.
 */
export function resolveRemainingTenureMonths(
  loan: Pick<Liability, 'outstanding' | 'ratePct' | 'monthlyEmi' | 'tenureMonths' | 'startDate'>,
  referenceDate: Date = new Date()
): number {
  const principal = Math.max(0, loan.outstanding || 0);
  if (principal <= 0) return 0;

  const annualRate = Math.max(0, loan.ratePct || 0);
  const monthlyRate = annualRate / 12 / 100;

  if (loan.monthlyEmi && loan.monthlyEmi > 0) {
    if (monthlyRate <= 0) {
      return Math.max(1, Math.ceil(principal / loan.monthlyEmi));
    }
    const monthlyInterest = principal * monthlyRate;
    if (loan.monthlyEmi > monthlyInterest + 0.01) {
      const exactMonths =
        -Math.log(1 - monthlyInterest / loan.monthlyEmi) / Math.log(1 + monthlyRate);
      if (isFinite(exactMonths) && exactMonths > 0) {
        return Math.max(1, Math.ceil(exactMonths));
      }
    }
  }

  if (loan.tenureMonths && loan.tenureMonths > 0) {
    if (loan.startDate) {
      const start = new Date(loan.startDate);
      if (!isNaN(start.getTime()) && referenceDate.getTime() > start.getTime()) {
        let elapsed =
          (referenceDate.getFullYear() - start.getFullYear()) * 12 +
          (referenceDate.getMonth() - start.getMonth());
        if (referenceDate.getDate() < start.getDate()) {
          elapsed -= 1;
        }
        elapsed = Math.max(0, elapsed);
        if (elapsed < loan.tenureMonths) {
          return Math.max(1, loan.tenureMonths - elapsed);
        }
      }
    }
    return Math.max(1, Math.round(loan.tenureMonths));
  }

  return 12;
}

/**
 * Extracts the normalized LoanPrepaymentPolicy defined by the user on a loan.
 * NEVER assumes or fabricates rates, taxes, or lock-ins when none were configured.
 */
export function resolveUserPrepaymentPolicy(loan: Liability): LoanPrepaymentPolicy {
  if (loan.prepaymentPolicy) {
    return {
      mode: loan.prepaymentPolicy.mode || 'penalty_free',
      lockInMonths: Math.max(0, Math.floor(loan.prepaymentPolicy.lockInMonths || 0)),
      feeBasis: loan.prepaymentPolicy.feeBasis || 'existing_principal',
      flatPenaltyPct: Math.max(0, loan.prepaymentPolicy.flatPenaltyPct || 0),
      tenureTiers: loan.prepaymentPolicy.tenureTiers || [],
      foreclosureOverridePct: loan.prepaymentPolicy.foreclosureOverridePct,
      applicableTaxPct: Math.max(0, loan.prepaymentPolicy.applicableTaxPct || 0),
      isConfigured: loan.prepaymentPolicy.isConfigured !== false,
    };
  }

  const hasLegacyDefinition =
    loan.prepaymentPenaltyPct !== undefined ||
    loan.prepaymentLockInMonths !== undefined ||
    loan.prepaymentFeeBasis !== undefined ||
    loan.foreclosurePenaltyPct !== undefined;

  if (hasLegacyDefinition) {
    const flatPct = Math.max(0, loan.prepaymentPenaltyPct || 0);
    const foreclosePct = loan.foreclosurePenaltyPct;
    return {
      mode: flatPct > 0 || (foreclosePct !== undefined && foreclosePct > 0) ? 'flat_rate' : 'penalty_free',
      lockInMonths: Math.max(0, Math.floor(loan.prepaymentLockInMonths || 0)),
      feeBasis: loan.prepaymentFeeBasis || 'existing_principal',
      flatPenaltyPct: flatPct,
      foreclosureOverridePct: foreclosePct,
      applicableTaxPct: Math.max(0, loan.applicableGstPct || 0),
      isConfigured: true,
    };
  }

  return {
    mode: 'penalty_free',
    lockInMonths: 0,
    feeBasis: 'existing_principal',
    flatPenaltyPct: 0,
    applicableTaxPct: 0,
    isConfigured: false,
  };
}

/**
 * Resolves the exact penalty rate (%) for a given remaining tenure from the user's policy.
 * Returns 0 if penalty-free or if no tier matches — never assumes a rate.
 */
export function getPolicyRateForRemainingTenure(
  policy: LoanPrepaymentPolicy,
  remainingTenureMonths: number,
  isFullForeclosure: boolean = false
): { penaltyPct: number; ruleLabel: string } {
  if (!policy.isConfigured) {
    return { penaltyPct: 0, ruleLabel: 'No prepayment policy set (0%)' };
  }

  if (policy.mode === 'penalty_free') {
    return { penaltyPct: 0, ruleLabel: 'Penalty-free policy (0%)' };
  }

  if (isFullForeclosure && policy.foreclosureOverridePct !== undefined && policy.foreclosureOverridePct >= 0) {
    return {
      penaltyPct: policy.foreclosureOverridePct,
      ruleLabel: `Full foreclosure policy (${policy.foreclosureOverridePct}%)`,
    };
  }

  if (policy.mode === 'flat_rate') {
    return {
      penaltyPct: Math.max(0, policy.flatPenaltyPct || 0),
      ruleLabel:
        policy.flatPenaltyPct > 0
          ? `${policy.flatPenaltyPct}% on ${
              policy.feeBasis === 'existing_principal' ? 'existing principal' : 'prepaid amount'
            }`
          : 'Penalty-free (0%)',
    };
  }

  if (policy.mode === 'tenure_tiered' && policy.tenureTiers && policy.tenureTiers.length > 0) {
    const rem = Math.max(0, Math.round(remainingTenureMonths));
    const matched = policy.tenureTiers.find(
      (t) =>
        rem >= Math.max(0, t.minRemainingMonths) &&
        (t.maxRemainingMonths === null ||
          t.maxRemainingMonths === undefined ||
          rem <= t.maxRemainingMonths)
    );
    if (matched) {
      const rangeStr =
        matched.maxRemainingMonths === null || matched.maxRemainingMonths === undefined
          ? `${matched.minRemainingMonths}+ mo`
          : `${matched.minRemainingMonths}–${matched.maxRemainingMonths} mo`;
      return {
        penaltyPct: Math.max(0, matched.penaltyPct || 0),
        ruleLabel: `Tier ${rangeStr} (${matched.penaltyPct}%)`,
      };
    }
    return { penaltyPct: 0, ruleLabel: `Outside defined tiers (0%)` };
  }

  return { penaltyPct: 0, ruleLabel: '0%' };
}

/**
 * Computes whether a loan is currently within its user-defined prepayment lock-in window.
 */
export function getLoanLockInStatus(
  loan: Liability,
  referenceDate: Date = new Date()
): {
  lockInMonths: number;
  elapsedMonths: number;
  remainingLockInMonths: number;
  monthsRemaining: number;
  isLockedIn: boolean;
  unlockDateStr?: string;
} {
  const policy = resolveUserPrepaymentPolicy(loan);
  const lockInMonths = Math.max(0, Math.floor(policy.lockInMonths || 0));
  if (lockInMonths <= 0) {
    return {
      lockInMonths: 0,
      elapsedMonths: 0,
      remainingLockInMonths: 0,
      monthsRemaining: 0,
      isLockedIn: false,
    };
  }

  if (!loan.startDate) {
    return {
      lockInMonths,
      elapsedMonths: 0,
      remainingLockInMonths: lockInMonths,
      monthsRemaining: lockInMonths,
      isLockedIn: true,
    };
  }

  const start = new Date(loan.startDate);
  if (isNaN(start.getTime())) {
    return {
      lockInMonths,
      elapsedMonths: 0,
      remainingLockInMonths: lockInMonths,
      monthsRemaining: lockInMonths,
      isLockedIn: true,
    };
  }

  const unlockDate = new Date(start.getFullYear(), start.getMonth() + lockInMonths, start.getDate());
  const unlockDateStr = `${unlockDate.getFullYear()}-${String(unlockDate.getMonth() + 1).padStart(2, '0')}-${String(unlockDate.getDate()).padStart(2, '0')}`;

  let elapsedMonths =
    (referenceDate.getFullYear() - start.getFullYear()) * 12 +
    (referenceDate.getMonth() - start.getMonth());
  if (referenceDate.getDate() < start.getDate()) {
    elapsedMonths -= 1;
  }
  elapsedMonths = Math.max(0, elapsedMonths);

  const isLockedIn = referenceDate.getTime() < unlockDate.getTime();
  const remainingLockInMonths = isLockedIn ? Math.max(1, lockInMonths - elapsedMonths) : 0;

  return {
    lockInMonths,
    elapsedMonths,
    remainingLockInMonths,
    monthsRemaining: remainingLockInMonths,
    isLockedIn,
    unlockDateStr,
  };
}

/**
 * Computes exact prepayment penalty charges strictly from the user's saved prepayment policy,
 * live existing principal, and remaining tenure — never assuming unconfigured charges.
 */
export function calculateLoanPrepaymentCharge(
  loan: Liability,
  proposedPrepayment: number,
  options?: {
    currentOutstanding?: number;
    remainingTenureOverride?: number;
    customPrepaymentPenaltyPct?: number;
    customFeeBasis?: 'existing_principal' | 'prepaid_amount';
    customGstPct?: number;
    referenceDate?: Date;
  }
): {
  penaltyPct: number;
  feeBasis: 'existing_principal' | 'prepaid_amount';
  basisAmount: number;
  remainingTenureMonths: number;
  ruleLabel: string;
  isPolicyConfigured: boolean;
  penaltyCharge: number;
  applicableTax: number;
  totalPenaltyFeesAndTax: number;
  totalPenaltyWithTax: number;
} {
  const currentOutstanding = Math.max(0, options?.currentOutstanding ?? loan.outstanding ?? 0);
  const remainingTenureMonths =
    options?.remainingTenureOverride !== undefined
      ? Math.max(0, options.remainingTenureOverride)
      : resolveRemainingTenureMonths({ ...loan, outstanding: currentOutstanding }, options?.referenceDate);

  const policy = resolveUserPrepaymentPolicy(loan);
  const cappedPrepayment = Math.min(Math.max(0, proposedPrepayment), currentOutstanding);
  const isFullForeclosure =
    currentOutstanding > 0 && Math.abs(cappedPrepayment - currentOutstanding) <= 0.5;

  const resolvedRate = getPolicyRateForRemainingTenure(
    policy,
    remainingTenureMonths,
    isFullForeclosure
  );

  const penaltyPct =
    options?.customPrepaymentPenaltyPct !== undefined
      ? options.customPrepaymentPenaltyPct
      : resolvedRate.penaltyPct;
  const feeBasis: 'existing_principal' | 'prepaid_amount' =
    options?.customFeeBasis || policy.feeBasis;
  const taxPct =
    options?.customGstPct !== undefined ? options.customGstPct : policy.applicableTaxPct;

  if (cappedPrepayment <= 0 || penaltyPct <= 0) {
    return {
      penaltyPct,
      feeBasis,
      basisAmount: 0,
      remainingTenureMonths,
      ruleLabel: resolvedRate.ruleLabel,
      isPolicyConfigured: policy.isConfigured,
      penaltyCharge: 0,
      applicableTax: 0,
      totalPenaltyFeesAndTax: 0,
      totalPenaltyWithTax: 0,
    };
  }

  const basisAmount = feeBasis === 'existing_principal' ? currentOutstanding : cappedPrepayment;
  const penaltyCharge = roundCurrency((basisAmount * penaltyPct) / 100);
  const applicableTax = taxPct > 0 ? roundCurrency((penaltyCharge * taxPct) / 100) : 0;
  const totalPenaltyFeesAndTax = safeAdd(penaltyCharge, applicableTax);

  return {
    penaltyPct,
    feeBasis,
    basisAmount,
    remainingTenureMonths,
    ruleLabel: resolvedRate.ruleLabel,
    isPolicyConfigured: policy.isConfigured,
    penaltyCharge,
    applicableTax,
    totalPenaltyFeesAndTax,
    totalPenaltyWithTax: totalPenaltyFeesAndTax,
  };
}

/**
 * Generates an accurate month-by-month amortization schedule across the entire remaining tenure
 */
export function generateAmortizationSchedule(
  principal: number,
  annualRatePct: number,
  monthlyEmi: number,
  maxMonths: number = 600,
  prepaymentMonth?: number,
  prepaymentAmount?: number
): {
  schedule: AmortizationScheduleMonth[];
  totalInterest: number;
  totalRepayment: number;
  monthsCount: number;
} {
  const schedule: AmortizationScheduleMonth[] = [];
  if (principal <= 0) {
    return { schedule: [], totalInterest: 0, totalRepayment: 0, monthsCount: 0 };
  }

  const monthlyRate = Math.max(0, annualRatePct) / 12 / 100;
  const minAmortizingEmi =
    monthlyRate > 0
      ? calculateContractualEmi(principal, annualRatePct, Math.min(maxMonths, 360))
      : roundCurrency(principal / Math.min(maxMonths, 36));
  const effectiveMonthlyEmi =
    monthlyEmi > principal * monthlyRate + 0.01 ? monthlyEmi : Math.max(monthlyEmi, minAmortizingEmi);

  if (effectiveMonthlyEmi <= 0) {
    return { schedule: [], totalInterest: 0, totalRepayment: 0, monthsCount: 0 };
  }

  let remainingPrincipal = principal;
  let cumulativeInterest = 0;
  let totalRepayment = 0;
  let month = 0;

  const now = new Date();

  while (remainingPrincipal > 0.01 && month < maxMonths) {
    month++;
    const openingPrincipal = remainingPrincipal;
    const interestComponent = roundCurrency(remainingPrincipal * monthlyRate);
    let principalComponent = Math.max(0, roundCurrency(effectiveMonthlyEmi - interestComponent));

    let prepaymentApplied = 0;
    if (
      prepaymentMonth !== undefined &&
      month === prepaymentMonth &&
      prepaymentAmount &&
      prepaymentAmount > 0
    ) {
      prepaymentApplied = Math.min(prepaymentAmount, remainingPrincipal);
    }

    if (safeAdd(principalComponent, prepaymentApplied) >= remainingPrincipal) {
      const remainingAfterPrepay = Math.max(0, safeSub(remainingPrincipal, prepaymentApplied));
      principalComponent = remainingAfterPrepay;
      const actualEmi = safeAdd(principalComponent, interestComponent);
      remainingPrincipal = 0;
      cumulativeInterest = safeAdd(cumulativeInterest, interestComponent);
      totalRepayment = safeAdd(totalRepayment, safeAdd(actualEmi, prepaymentApplied));

      const d = new Date(now.getFullYear(), now.getMonth() + month, 1);
      schedule.push({
        monthIndex: month,
        dateStr: d.toISOString().split('T')[0],
        openingPrincipal,
        emi: actualEmi,
        principalComponent,
        interestComponent,
        prepaymentAmount: prepaymentApplied,
        closingPrincipal: 0,
        cumulativeInterest,
      });
      break;
    }

    remainingPrincipal = safeSub(remainingPrincipal, safeAdd(principalComponent, prepaymentApplied));
    cumulativeInterest = safeAdd(cumulativeInterest, interestComponent);
    totalRepayment = safeAdd(totalRepayment, safeAdd(effectiveMonthlyEmi, prepaymentApplied));

    const d = new Date(now.getFullYear(), now.getMonth() + month, 1);
    schedule.push({
      monthIndex: month,
      dateStr: d.toISOString().split('T')[0],
      openingPrincipal,
      emi: effectiveMonthlyEmi,
      principalComponent,
      interestComponent,
      prepaymentAmount: prepaymentApplied,
      closingPrincipal: remainingPrincipal,
      cumulativeInterest,
    });
  }

  return {
    schedule,
    totalInterest: cumulativeInterest,
    totalRepayment,
    monthsCount: month,
  };
}

/**
 * Computes the complete, un-truncated full-tenure amortization schedule for a loan
 */
export function getFullLoanAmortizationSchedule(loan: Liability): {
  schedule: AmortizationScheduleMonth[];
  effectiveEmi: number;
  totalInterest: number;
  totalRepayment: number;
  monthsCount: number;
} {
  const principal = Math.max(0, loan.outstanding || 0);
  const annualRate = Math.max(0, loan.ratePct || 0);
  const remTenure = resolveRemainingTenureMonths(loan);
  const monthlyRate = annualRate / 12 / 100;

  const contractualEmi = calculateContractualEmi(principal, annualRate, Math.max(1, remTenure));
  const effectiveEmi =
    loan.monthlyEmi && loan.monthlyEmi > principal * monthlyRate + 0.01
      ? loan.monthlyEmi
      : contractualEmi;

  const maxMonths = Math.max(600, remTenure + 60);
  const res = generateAmortizationSchedule(principal, annualRate, effectiveEmi, maxMonths);

  return {
    ...res,
    effectiveEmi,
  };
}

/**
 * Simulates a loan prepayment (partial or full foreclosure) strictly using the user's configured policy
 */
export function simulateLoanPrepayment(
  loan: Liability,
  proposedPrepayment: number,
  options?: {
    customPrepaymentPenaltyPct?: number;
    customFeeBasis?: 'existing_principal' | 'prepaid_amount';
    customGstPct?: number;
    maintainTenureReduceEmi?: boolean;
    referenceDate?: Date;
  }
): LoanPrepaymentSimulation {
  const currentOutstanding = loan.outstanding || 0;
  const annualRate = loan.ratePct || 0;
  const remTenure = resolveRemainingTenureMonths(loan, options?.referenceDate);

  const monthlyEmi =
    loan.monthlyEmi ||
    calculateContractualEmi(currentOutstanding, annualRate, Math.max(1, remTenure));

  const maxMonths = Math.max(600, remTenure + 60);
  const baseline = generateAmortizationSchedule(currentOutstanding, annualRate, monthlyEmi, maxMonths);
  const lockStatus = getLoanLockInStatus(loan, options?.referenceDate);

  const cappedPrepayment = Math.min(Math.max(0, proposedPrepayment), currentOutstanding);
  const feeInfo = calculateLoanPrepaymentCharge(loan, cappedPrepayment, {
    currentOutstanding,
    remainingTenureOverride: baseline.monthsCount || remTenure,
    customPrepaymentPenaltyPct: options?.customPrepaymentPenaltyPct,
    customFeeBasis: options?.customFeeBasis,
    customGstPct: options?.customGstPct,
    referenceDate: options?.referenceDate,
  });

  const totalPrepaymentOutflow = safeAdd(cappedPrepayment, feeInfo.totalPenaltyFeesAndTax);

  let revised: ReturnType<typeof generateAmortizationSchedule>;
  let revisedMonthlyEmi: number | undefined;
  const prepayMonth = lockStatus.isLockedIn ? lockStatus.remainingLockInMonths + 1 : 1;

  if (options?.maintainTenureReduceEmi && baseline.monthsCount > 0 && !lockStatus.isLockedIn) {
    const remainingPrincipalAfterPrepayment = safeSub(currentOutstanding, cappedPrepayment);
    revisedMonthlyEmi =
      remainingPrincipalAfterPrepayment > 0
        ? calculateContractualEmi(remainingPrincipalAfterPrepayment, annualRate, baseline.monthsCount)
        : 0;
    revised = generateAmortizationSchedule(
      remainingPrincipalAfterPrepayment,
      annualRate,
      revisedMonthlyEmi,
      maxMonths
    );
  } else {
    revised = generateAmortizationSchedule(
      currentOutstanding,
      annualRate,
      monthlyEmi,
      maxMonths,
      prepayMonth,
      cappedPrepayment
    );
  }

  const grossInterestSaved = safeSub(baseline.totalInterest, revised.totalInterest);
  const netFinancialBenefit = safeSub(grossInterestSaved, feeInfo.totalPenaltyFeesAndTax);
  const isFinanciallyBeneficial = !lockStatus.isLockedIn && netFinancialBenefit > 0;
  const monthsSaved = Math.max(0, safeSub(baseline.monthsCount, revised.monthsCount));

  return {
    loanId: loan.id,
    loanName: loan.name,
    currentOutstanding,
    proposedPrepayment: cappedPrepayment,
    prepaymentPenaltyPct: feeInfo.penaltyPct,
    prepaymentFeeBasis: feeInfo.feeBasis,
    isLockedIn: lockStatus.isLockedIn,
    remainingLockInMonths: lockStatus.remainingLockInMonths,
    unlockDateStr: lockStatus.unlockDateStr,
    penaltyCharge: feeInfo.penaltyCharge,
    applicableTax: feeInfo.applicableTax,
    totalPrepaymentOutflow,
    revisedPrincipal: Math.max(0, safeSub(currentOutstanding, cappedPrepayment)),
    originalRemainingMonths: baseline.monthsCount,
    revisedRemainingMonths: revised.monthsCount,
    monthsSaved,
    originalTotalInterest: baseline.totalInterest,
    revisedTotalInterest: revised.totalInterest,
    grossInterestSaved,
    netFinancialBenefit,
    isFinanciallyBeneficial,
    revisedMonthlyEmi,
    amortizationPreview: revised.schedule,
  };
}

/**
 * Compares Debt Restructuring, Balance Transfer, or Loan Refinancing vs. Existing Debts
 * Strictly respects user-configured foreclosure policies and never assumes GST unless specified.
 */
export function evaluateDebtRestructuring(params: {
  existingDebts: Liability[];
  proposedOfferName: string;
  proposedInterestRatePct: number;
  proposedTenureMonths: number;
  transferOrProcessingFeePct: number;
  applicableGstPct?: number;
}): DebtRestructureComparison {
  const gstPct = params.applicableGstPct ?? 0;

  let totalExistingOutstanding = 0;
  let totalExistingMonthlyEmi = 0;
  let totalExistingRemainingInterest = 0;
  let foreclosureChargesTotal = 0;
  let loanSpecificTaxTotal = 0;

  const debtItems = params.existingDebts.map((d) => {
    const outstanding = d.outstanding || 0;
    const rate = d.ratePct || 0;
    const remTenure = d.kind === 'loan' ? resolveRemainingTenureMonths(d) : 24;
    const emi =
      d.monthlyEmi ||
      calculateContractualEmi(outstanding, rate, Math.max(1, remTenure));
    const sched = generateAmortizationSchedule(outstanding, rate, emi, Math.max(600, remTenure + 60));

    totalExistingOutstanding = safeAdd(totalExistingOutstanding, outstanding);
    totalExistingMonthlyEmi = safeAdd(totalExistingMonthlyEmi, emi);
    totalExistingRemainingInterest = safeAdd(totalExistingRemainingInterest, sched.totalInterest);

    const feeCalc =
      d.kind === 'loan'
        ? calculateLoanPrepaymentCharge(d, outstanding, {
            currentOutstanding: outstanding,
            remainingTenureOverride: sched.monthsCount || remTenure,
          })
        : { penaltyPct: 0, penaltyCharge: 0, applicableTax: 0 };

    foreclosureChargesTotal = safeAdd(foreclosureChargesTotal, feeCalc.penaltyCharge);
    loanSpecificTaxTotal = safeAdd(loanSpecificTaxTotal, feeCalc.applicableTax);

    return {
      liabilityId: d.id,
      name: d.name,
      outstanding,
      interestRatePct: rate,
      monthlyEmi: emi,
      remainingMonths: sched.monthsCount,
      foreclosureChargePct: feeCalc.penaltyPct,
    };
  });

  const transferFeeAmount = roundCurrency(
    (totalExistingOutstanding * params.transferOrProcessingFeePct) / 100
  );
  const totalFees = safeAdd(foreclosureChargesTotal, transferFeeAmount);
  const transferTax = gstPct > 0 ? roundCurrency((transferFeeAmount * gstPct) / 100) : 0;
  const taxesOnFees = safeAdd(loanSpecificTaxTotal, transferTax);
  const totalUpfrontCost = safeAdd(totalFees, taxesOnFees);

  const proposedNewPrincipal = totalExistingOutstanding;
  const proposedMonthlyEmi = calculateContractualEmi(
    proposedNewPrincipal,
    params.proposedInterestRatePct,
    params.proposedTenureMonths
  );

  const proposedSched = generateAmortizationSchedule(
    proposedNewPrincipal,
    params.proposedInterestRatePct,
    proposedMonthlyEmi,
    Math.max(600, params.proposedTenureMonths + 60)
  );

  const proposedTotalCost = safeAdd(proposedSched.totalRepayment, totalUpfrontCost);
  const totalExistingTotalCost = safeAdd(totalExistingOutstanding, totalExistingRemainingInterest);
  const netFinancialSavings = safeSub(totalExistingTotalCost, proposedTotalCost);

  const isRecommended = netFinancialSavings > 0;
  const explanation = isRecommended
    ? `Restructuring saves a net total of ${netFinancialSavings} after accounting for ${totalUpfrontCost} in user-defined foreclosure charges and transfer fees.`
    : `Restructuring is not economically beneficial. It increases overall financial cost by ${Math.abs(netFinancialSavings)} due to upfront fees and extended tenure.`;

  return {
    id: `restruct-${Date.now()}`,
    existingDebts: debtItems,
    totalExistingOutstanding,
    totalExistingMonthlyEmi,
    totalExistingRemainingInterest,
    proposedOfferName: params.proposedOfferName,
    proposedInterestRatePct: params.proposedInterestRatePct,
    proposedTenureMonths: params.proposedTenureMonths,
    transferOrProcessingFeePct: params.transferOrProcessingFeePct,
    foreclosureChargesTotal,
    transferFeeAmount,
    taxesOnFees,
    proposedNewPrincipal,
    proposedMonthlyEmi,
    proposedTotalInterest: proposedSched.totalInterest,
    proposedTotalRepayment: proposedSched.totalRepayment,
    netFinancialSavings,
    isRecommended,
    explanation,
  };
}
