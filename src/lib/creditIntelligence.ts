/**
 * Credit-Card Intelligence & Proactive Utilization Engine for NetWorthIQ
 * Evaluates credit utilization across multiple cards, generates optimal pre-statement
 * repayment allocations protected by emergency funds, and calculates side-by-side
 * EMI Conversion vs. Full Payment cost comparisons.
 */

import {
  Liability,
  CreditCardEmiComparison,
  Holding,
  AssetType,
  Currency,
  AppSettings,
  CashFlowForecastResult,
  Goal,
  ClosedLoopMLState,
} from '../types';
import { roundCurrency, safeAdd, safeMul, safeSub } from './financialMath';
import { calculateContractualEmi } from './debtEngine';
import { isSpendableLiquidHolding, getSafeLiabilityName } from './assetRules';
import { formatMoney } from './formatters';

export interface CardUtilizationStatus {
  cardId: string;
  cardName: string;
  creditLimit: number;
  currentOutstanding: number;
  availableCredit: number;
  utilizationPct: number;
  thresholdPct: number;
  isExceedingThreshold: boolean;
  amountToReachThreshold: number; // Amount needed to bring utilization down to configured target
  nextStatementDate?: string;
  daysToStatement?: number;
}

export interface MultiCardRepaymentRecommendation {
  allocatableSurplus: number;
  totalShortfallToTargets: number;
  cards: {
    cardId: string;
    cardName: string;
    currentUtilizationPct: number;
    targetThresholdPct: number;
    recommendedPayment: number;
    projectedUtilizationAfterPayment: number;
    reasoning: string;
    isFullyFundedToTarget: boolean;
  }[];
  remainingSurplusAfterRepayments: number;
  emergencyFundProtected: boolean;
}

export interface CardCashFlowSettlementAssessment {
  cardId: string;
  cardName: string;
  currency: string;
  netStatementPayable: number;
  totalLiquidAvailable: number;
  safetyBufferLocal: number;
  projected30dMinCashLocal: number;
  postFullPaymentCashLocal: number;
  canAffordFullWithoutDeficit: boolean;
  canAffordFullComfortably: boolean;
  verdict: 'pay_full' | 'split_shield' | 'structured_emi';
  safeUpfrontAmount: number;
  residualEmiAmount: number;
  emiComparison: CreditCardEmiComparison;
  monthlyRevolvingLoss: number;
  avoidableEmiLoss: number;
  shouldGlowRedOnEmi: boolean;
  escalationLevel: number;
  headline: string;
  persuasionCopy: string;
  goalRewardNote?: string;
}

/**
 * Evaluates credit utilization status for all active credit cards
 */
export function evaluateCreditUtilization(
  cards: Liability[],
  defaultGlobalThresholdPct: number = 30
): CardUtilizationStatus[] {
  const now = new Date();

  return cards
    .filter((c) => c.kind === 'card' && c.cardType !== 'debit')
    .map((card) => {
      const limit = card.limit || card.creditLimit || 0;
      const outstanding = card.outstanding || 0;
      const availableCredit = Math.max(0, safeSub(limit, outstanding));
      const utilizationPct = limit > 0 ? roundCurrency((outstanding / limit) * 100) : 0;
      const thresholdPct = card.creditCardUtilThresholdPct ?? defaultGlobalThresholdPct;

      const isExceedingThreshold = utilizationPct > thresholdPct;

      // Calculate target outstanding balance to meet threshold
      const targetOutstanding = limit > 0 ? (limit * thresholdPct) / 100 : 0;
      const amountToReachThreshold = isExceedingThreshold
        ? Math.max(0, safeSub(outstanding, targetOutstanding))
        : 0;

      let daysToStatement: number | undefined;
      if (card.statementDay) {
        const thisMonthStatement = new Date(now.getFullYear(), now.getMonth(), card.statementDay);
        if (thisMonthStatement.getTime() < now.getTime()) {
          thisMonthStatement.setMonth(thisMonthStatement.getMonth() + 1);
        }
        daysToStatement = Math.ceil((thisMonthStatement.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }

      return {
        cardId: card.id,
        cardName: card.name,
        creditLimit: limit,
        currentOutstanding: outstanding,
        availableCredit,
        utilizationPct,
        thresholdPct,
        isExceedingThreshold,
        amountToReachThreshold: roundCurrency(amountToReachThreshold),
        nextStatementDate: card.nextStatementDate,
        daysToStatement,
      };
    });
}

/**
 * Calculates optimal pre-statement multi-card repayment allocations
 * strictly honoring emergency reserves and mandatory obligations
 */
export function allocateMultiCardRepayments(
  cardStatuses: CardUtilizationStatus[],
  allocatableSurplus: number,
  cardsRaw: Liability[]
): MultiCardRepaymentRecommendation {
  // Sort cards exceeding threshold by highest utilization % descending
  const exceedingCards = cardStatuses.filter((c) => c.isExceedingThreshold && c.amountToReachThreshold > 0);
  const totalShortfallToTargets = roundCurrency(
    exceedingCards.reduce((acc, c) => safeAdd(acc, c.amountToReachThreshold), 0)
  );

  let availableBudget = Math.max(0, allocatableSurplus);
  const recommendations: MultiCardRepaymentRecommendation['cards'] = [];

  // Prioritize cards with the highest APR / penalty rate first, then highest utilization
  const sortedExceeding = [...exceedingCards].sort((a, b) => {
    const rawA = cardsRaw.find((c) => c.id === a.cardId);
    const rawB = cardsRaw.find((c) => c.id === b.cardId);
    const aprA = rawA?.penaltyRateMonthlyPct ? rawA.penaltyRateMonthlyPct * 12 : rawA?.ratePct || 36;
    const aprB = rawB?.penaltyRateMonthlyPct ? rawB.penaltyRateMonthlyPct * 12 : rawB?.ratePct || 36;
    if (aprB !== aprA) return aprB - aprA;
    return b.utilizationPct - a.utilizationPct;
  });

  for (const card of sortedExceeding) {
    const needed = card.amountToReachThreshold;
    const allocated = roundCurrency(Math.min(needed, availableBudget));
    availableBudget = safeSub(availableBudget, allocated);

    const projectedOutstanding = safeSub(card.currentOutstanding, allocated);
    const projectedUtil = card.creditLimit > 0 ? roundCurrency((projectedOutstanding / card.creditLimit) * 100) : 0;
    const isFullyFundedToTarget = allocated >= needed;

    recommendations.push({
      cardId: card.cardId,
      cardName: card.cardName,
      currentUtilizationPct: card.utilizationPct,
      targetThresholdPct: card.thresholdPct,
      recommendedPayment: allocated,
      projectedUtilizationAfterPayment: projectedUtil,
      isFullyFundedToTarget,
      reasoning: isFullyFundedToTarget
        ? `Pre-statement payment of ${allocated} brings utilization from ${card.utilizationPct}% down to target ${card.thresholdPct}% before billing statement.`
        : `Allocated available surplus of ${allocated} towards target of ${needed}. Shortfall of ${safeSub(needed, allocated)} due to emergency reserve protection.`,
    });
  }

  return {
    allocatableSurplus,
    totalShortfallToTargets,
    cards: recommendations,
    remainingSurplusAfterRepayments: Math.max(0, availableBudget),
    emergencyFundProtected: true,
  };
}

/**
 * Computes side-by-side comparison between Full Payment and EMI Conversion for a credit card balance
 */
export function compareCreditCardEmiVsFullPayment(
  card: Liability,
  eligibleAmount: number,
  options?: {
    tenureMonths?: number;
    customAnnualRatePct?: number;
    customProcessingFee?: number;
    applicableGstPct?: number;
  }
): CreditCardEmiComparison {
  const tenure = options?.tenureMonths || 6;
  const ratePct = options?.customAnnualRatePct ?? card.emiConversionRatePct ?? (card.ratePct || 16.0);
  const processingFee = options?.customProcessingFee ?? card.emiConversionProcessingFee ?? 199;
  const gstPct = options?.applicableGstPct ?? 18;

  const processingFeeGst = roundCurrency((processingFee * gstPct) / 100);
  const totalUpfrontFee = safeAdd(processingFee, processingFeeGst);

  const monthlyEmi = calculateContractualEmi(eligibleAmount, ratePct, tenure);
  const totalEmiRepayment = roundCurrency(monthlyEmi * tenure);
  const totalEmiInterest = safeSub(totalEmiRepayment, eligibleAmount);
  const totalEmiCost = safeAdd(totalEmiRepayment, totalUpfrontFee);
  const additionalCostOfEmi = safeSub(totalEmiCost, eligibleAmount);

  return {
    cardId: card.id,
    cardName: card.name,
    eligibleOutstanding: eligibleAmount,
    fullPaymentAmount: eligibleAmount,
    fullPaymentTotalCost: eligibleAmount,
    emiConversionAvailable: card.emiConversionAvailable ?? true,
    tenureMonths: tenure,
    annualInterestRatePct: ratePct,
    processingFee,
    processingFeeGst,
    monthlyEmi,
    totalEmiInterest,
    totalEmiRepayment,
    totalEmiCost,
    additionalCostOfEmi,
  };
}

/**
 * Cash-Flow-Aware Card Settlement Assessor:
 * Determines strictly from the user's liquid balances, Sweep-In FDs, and 30-day CashFlowForecast
 * whether a credit card statement should be settled in Full, Split (upfront + minimal EMI), or EMI.
 * Escalates persuasion intensity when prior warnings failed (`escalationLevel` 1 -> 4) while tying
 * retained fee savings back to user goals and personal enjoyment.
 */
export function assessCardFullVsEmiByCashFlow(params: {
  card: Liability;
  holdings: Holding[];
  assetTypes: AssetType[];
  currencies: Currency[];
  settings: AppSettings;
  cashFlowForecast?: CashFlowForecastResult;
  goals?: Goal[];
  closedLoopState?: ClosedLoopMLState;
  overrideConversionAmount?: number;
  emiOptions?: {
    tenureMonths?: number;
    customAnnualRatePct?: number;
    customProcessingFee?: number;
    applicableGstPct?: number;
  };
}): CardCashFlowSettlementAssessment {
  const {
    card,
    holdings,
    assetTypes,
    currencies,
    settings,
    cashFlowForecast,
    goals = [],
    closedLoopState,
    overrideConversionAmount,
    emiOptions,
  } = params;

  const currObj = currencies.find((c) => c.code === card.currency);
  const currSymbol = currObj?.symbol || card.currency;
  const fxToBase = currObj?.rateToBase || 1;

  const grossOutstanding = Math.max(0, card.outstanding || 0);
  const cashbackAvail = Math.min(grossOutstanding, Math.max(0, card.accumulatedCashback || 0));
  const netStatementPayable =
    overrideConversionAmount !== undefined && overrideConversionAmount > 0
      ? Math.min(grossOutstanding, overrideConversionAmount)
      : Math.max(0, safeSub(grossOutstanding, cashbackAvail));

  // Sum spendable liquid holdings + linked Sweep-In FDs in card currency (or base-equivalent)
  const liquidHoldings = holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes));
  let totalLiquidBase = 0;
  for (const h of liquidHoldings) {
    const hRate = currencies.find((c) => c.code === h.currency)?.rateToBase || 1;
    const posBal = Math.max(0, h.principalOrValue || 0);
    totalLiquidBase += posBal * hRate;
  }
  for (const fd of holdings) {
    if (Boolean(fd.isSweepIn) && (fd.principalOrValue || 0) > 0 && !liquidHoldings.some((l) => l.id === fd.id)) {
      const fdRate = currencies.find((c) => c.code === fd.currency)?.rateToBase || 1;
      totalLiquidBase += (fd.principalOrValue || 0) * fdRate;
    }
  }

  const totalLiquidAvailable = fxToBase > 0 ? roundCurrency(totalLiquidBase / fxToBase) : totalLiquidBase;
  const safetyBufferBase = settings.cashFlowBufferAmount ?? settings.minCashCustom ?? 25000;
  const safetyBufferLocal = fxToBase > 0 ? roundCurrency(safetyBufferBase / fxToBase) : safetyBufferBase;

  const projected30dMinBase =
    cashFlowForecast?.minProjectedBalance !== undefined
      ? cashFlowForecast.minProjectedBalance
      : totalLiquidBase;
  const projected30dMinCashLocal =
    fxToBase > 0 ? roundCurrency(projected30dMinBase / fxToBase) : projected30dMinBase;

  // Note: CashFlowForecast already includes scheduled card bill outflows if due inside window;
  // check both raw liquid coverage and post-settlement buffer comfort.
  const postFullFromLiquid = safeSub(totalLiquidAvailable, netStatementPayable);
  const canAffordFullWithoutDeficit =
    netStatementPayable <= 0 ||
    (totalLiquidAvailable >= netStatementPayable && projected30dMinCashLocal >= -netStatementPayable * 0.15);
  const canAffordFullComfortably =
    netStatementPayable <= 0 ||
    (postFullFromLiquid >= safetyBufferLocal * 0.4 && projected30dMinCashLocal >= 0);

  const emiComparison = compareCreditCardEmiVsFullPayment(
    card,
    Math.max(0, netStatementPayable),
    emiOptions
  );

  const monthlyPenaltyPct =
    card.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5;
  const minDue = Math.min(netStatementPayable, Math.max(500, roundCurrency(netStatementPayable * 0.05)));
  const monthlyRevolvingLoss = roundCurrency(
    safeMul(Math.max(0, safeSub(netStatementPayable, minDue)), monthlyPenaltyPct / 100)
  );

  const escalationLevel = Math.max(1, Math.min(4, closedLoopState?.escalationLevel || 1));

  // Identify an active non-completed goal to connect fee retention with tangible user happiness
  const activeGoal = goals.find((g) => !g.isCompleted && g.cost > (g.accumulatedTotal || 0));

  let verdict: 'pay_full' | 'split_shield' | 'structured_emi' = 'pay_full';
  let safeUpfrontAmount = netStatementPayable;
  let residualEmiAmount = 0;

  if (canAffordFullComfortably || canAffordFullWithoutDeficit) {
    verdict = 'pay_full';
    safeUpfrontAmount = netStatementPayable;
    residualEmiAmount = 0;
  } else if (totalLiquidAvailable > minDue * 1.5) {
    verdict = 'split_shield';
    safeUpfrontAmount = Math.max(
      minDue,
      roundCurrency(Math.max(0, totalLiquidAvailable - safetyBufferLocal * 0.35))
    );
    safeUpfrontAmount = Math.min(netStatementPayable, safeUpfrontAmount);
    residualEmiAmount = Math.max(0, safeSub(netStatementPayable, safeUpfrontAmount));
  } else {
    verdict = 'structured_emi';
    safeUpfrontAmount = Math.min(netStatementPayable, Math.max(0, totalLiquidAvailable));
    residualEmiAmount = Math.max(0, safeSub(netStatementPayable, safeUpfrontAmount));
  }

  const feeLossFmt = formatMoney(
    emiComparison.additionalCostOfEmi,
    card.currency,
    currSymbol,
    settings.numberGrouping,
    0
  );
  const fullPayFmt = formatMoney(
    netStatementPayable,
    card.currency,
    currSymbol,
    settings.numberGrouping,
    0
  );

  // Red glow ONLY when converting to EMI loses avoidable money to bank fees/interest despite sufficient cash flow
  const shouldGlowRedOnEmi =
    canAffordFullWithoutDeficit && emiComparison.additionalCostOfEmi > 0 && netStatementPayable > 0;

  let headline = 'Cash Flow Supports Full Zero-Fee Settlement';
  let persuasionCopy = `Liquid reserves (${formatMoney(totalLiquidAvailable, card.currency, currSymbol, settings.numberGrouping, 0)}) cover ${fullPayFmt} in full. Converting to EMI surrenders ${feeLossFmt} to interest and processing charges with zero asset gain.`;
  let goalRewardNote: string | undefined;

  if (verdict === 'pay_full') {
    if (escalationLevel >= 3) {
      headline = `Capital Leak Alert · Retain ${feeLossFmt} Instead of Bank Fees`;
      persuasionCopy = `Your cash flow clears ${fullPayFmt} cleanly today. Paying EMI hands ${feeLossFmt} straight to ${getSafeLiabilityName(card)} in pure fee + interest drag — keep that ${feeLossFmt} working in your own pocket.`;
    } else if (escalationLevel === 2) {
      headline = `Zero-Fee Full Settlement Recommended · Save ${feeLossFmt}`;
      persuasionCopy = `30-day cash flow remains solvent after settling ${fullPayFmt}. Full payment eliminates ${feeLossFmt} in avoidable EMI conversion charges immediately.`;
    }
    if (activeGoal && emiComparison.additionalCostOfEmi > 0) {
      goalRewardNote = `Retaining ${feeLossFmt} instead of EMI fees can go straight toward "${activeGoal.name}" — guilt-free progress with zero extra effort.`;
    }
  } else if (verdict === 'split_shield') {
    const splitUpFmt = formatMoney(safeUpfrontAmount, card.currency, currSymbol, settings.numberGrouping, 0);
    const resFmt = formatMoney(residualEmiAmount, card.currency, currSymbol, settings.numberGrouping, 0);
    const splitComp = compareCreditCardEmiVsFullPayment(card, residualEmiAmount, emiOptions);
    const savedVsFullEmi = Math.max(0, safeSub(emiComparison.additionalCostOfEmi, splitComp.additionalCostOfEmi));
    headline = `Cash-Flow Split Shield · Pay ${splitUpFmt} Now, Convert ${resFmt}`;
    persuasionCopy = `Full payment would compress your 30-day cash buffer. Paying ${splitUpFmt} upfront and converting only ${resFmt} protects liquidity, avoids ${monthlyPenaltyPct}%/mo revolving charges, and saves ${formatMoney(savedVsFullEmi, card.currency, currSymbol, settings.numberGrouping, 0)} vs full EMI.`;
  } else {
    headline = `Cash-Flow Tight · Structured ${emiComparison.annualInterestRatePct}% EMI Beats ${(monthlyPenaltyPct * 12).toFixed(0)}% Revolving`;
    persuasionCopy = `Liquid cash (${formatMoney(totalLiquidAvailable, card.currency, currSymbol, settings.numberGrouping, 0)}) is below ${fullPayFmt}. Structured EMI prevents ${formatMoney(monthlyRevolvingLoss, card.currency, currSymbol, settings.numberGrouping, 0)}/mo in overdue revolving penalties while protecting essential cash flow.`;
  }

  return {
    cardId: card.id,
    cardName: getSafeLiabilityName(card),
    currency: card.currency,
    netStatementPayable,
    totalLiquidAvailable,
    safetyBufferLocal,
    projected30dMinCashLocal,
    postFullPaymentCashLocal: postFullFromLiquid,
    canAffordFullWithoutDeficit,
    canAffordFullComfortably,
    verdict,
    safeUpfrontAmount,
    residualEmiAmount,
    emiComparison,
    monthlyRevolvingLoss,
    avoidableEmiLoss: emiComparison.additionalCostOfEmi,
    shouldGlowRedOnEmi,
    escalationLevel,
    headline,
    persuasionCopy,
    goalRewardNote,
  };
}

