/**
 * Unified Financial Simulation Engine for NetWorthIQ
 * Evaluates the complete financial balance sheet: liquid cash, emergency reserves,
 * mandatory monthly bills/EMIs, restricted/pledged assets, and calculates
 * true safe allocatable surplus for debt repayment, investments, or goal funding.
 */

import {
  Holding,
  Liability,
  Bill,
  IncomeStream,
  AppSettings,
  Currency,
} from '../types';
import { roundCurrency, safeAdd, safeSub } from './financialMath';
import { convertToBase, getHoldingLocalValue } from './calcEngine';

export interface ComprehensiveBalanceSheet {
  grossLiquidCashBase: number;
  emergencyReserveTargetBase: number;
  upcomingMandatoryObligationsBase: number;
  restrictedPledgedAssetsBase: number;
  trueAllocatableSurplusBase: number;
  totalDebtOutstandingBase: number;
  mandatoryMonthlyDebtPaymentsBase: number;
  isEmergencyReserveDeficit: boolean;
  emergencyReserveDeficitBase: number;
  liquidityBreakdown: {
    immediateCashAndBank: number;
    sweepInFdBalance: number;
    lockedInvestmentsAndFds: number;
    creditCardOutstanding: number;
    loanOutstanding: number;
  };
}

/**
 * Computes the unified financial balance sheet and true safe allocatable surplus
 */
export function computeUnifiedBalanceSheet(params: {
  holdings: Holding[];
  liabilities: Liability[];
  bills: Bill[];
  incomeStreams: IncomeStream[];
  settings: AppSettings;
  currencies: Record<string, Currency>;
}): ComprehensiveBalanceSheet {
  const { holdings, liabilities, bills, settings, currencies } = params;

  let immediateCashAndBank = 0;
  let sweepInFdBalance = 0;
  let lockedInvestmentsAndFds = 0;
  let restrictedPledgedAssets = 0;

  for (const h of holdings) {
    const valBase = convertToBase(getHoldingLocalValue(h), h.currency, currencies);
    if (valBase <= 0) continue;

    if (h.typeId === 'type-bank' || h.typeId === 'type-cash') {
      immediateCashAndBank = safeAdd(immediateCashAndBank, valBase);
    } else if (h.isSweepIn) {
      sweepInFdBalance = safeAdd(sweepInFdBalance, valBase);
    } else if (h.liquidityClass === 'Locked' || h.typeId === 'type-fd') {
      lockedInvestmentsAndFds = safeAdd(lockedInvestmentsAndFds, valBase);
    } else {
      // Market / mutual funds / gold
      lockedInvestmentsAndFds = safeAdd(lockedInvestmentsAndFds, valBase);
    }
  }

  // Debt balances
  let creditCardOutstanding = 0;
  let loanOutstanding = 0;
  let mandatoryMonthlyDebtPayments = 0;

  for (const l of liabilities) {
    const outBase = convertToBase(l.outstanding || 0, l.currency, currencies);
    if (outBase <= 0) continue;

    if (l.kind === 'card') {
      creditCardOutstanding = safeAdd(creditCardOutstanding, outBase);
      // Contractual 5% minimum payment
      const minDue = Math.max(500, roundCurrency(outBase * 0.05));
      mandatoryMonthlyDebtPayments = safeAdd(mandatoryMonthlyDebtPayments, minDue);
    } else {
      loanOutstanding = safeAdd(loanOutstanding, outBase);
      const emiBase = convertToBase(l.monthlyEmi || roundCurrency(outBase * 0.05), l.currency, currencies);
      mandatoryMonthlyDebtPayments = safeAdd(mandatoryMonthlyDebtPayments, emiBase);
    }
  }

  // Unpaid mandatory recurring bills this month
  let upcomingMandatoryObligations = 0;
  for (const b of bills) {
    if (!b.isOverriddenPaid && !b.isAutoLiabilityBill) {
      const billBase = convertToBase(b.amount || 0, b.currency, currencies);
      upcomingMandatoryObligations = safeAdd(upcomingMandatoryObligations, billBase);
    }
  }
  // Add mandatory debt payments to monthly obligations
  upcomingMandatoryObligations = safeAdd(upcomingMandatoryObligations, mandatoryMonthlyDebtPayments);

  // Configured emergency reserve target
  let emergencyReserveTarget = settings.cashFlowBufferAmount || 50000;
  if (settings.minCashThresholdMode === 'custom' && settings.minCashCustom > 0) {
    emergencyReserveTarget = settings.minCashCustom;
  }

  const grossLiquidCash = safeAdd(immediateCashAndBank, sweepInFdBalance);

  // Emergency reserve deficit check
  const isEmergencyReserveDeficit = grossLiquidCash < emergencyReserveTarget;
  const emergencyReserveDeficit = isEmergencyReserveDeficit
    ? safeSub(emergencyReserveTarget, grossLiquidCash)
    : 0;

  // True Allocatable Surplus = Liquid Cash - Emergency Reserve - Mandatory Monthly Obligations
  const committedBuffer = safeAdd(emergencyReserveTarget, upcomingMandatoryObligations);
  const trueAllocatableSurplus = Math.max(0, safeSub(grossLiquidCash, committedBuffer));

  return {
    grossLiquidCashBase: grossLiquidCash,
    emergencyReserveTargetBase: emergencyReserveTarget,
    upcomingMandatoryObligationsBase: upcomingMandatoryObligations,
    restrictedPledgedAssetsBase: restrictedPledgedAssets,
    trueAllocatableSurplusBase: trueAllocatableSurplus,
    totalDebtOutstandingBase: safeAdd(creditCardOutstanding, loanOutstanding),
    mandatoryMonthlyDebtPaymentsBase: mandatoryMonthlyDebtPayments,
    isEmergencyReserveDeficit,
    emergencyReserveDeficitBase: emergencyReserveDeficit,
    liquidityBreakdown: {
      immediateCashAndBank,
      sweepInFdBalance,
      lockedInvestmentsAndFds,
      creditCardOutstanding,
      loanOutstanding,
    },
  };
}
