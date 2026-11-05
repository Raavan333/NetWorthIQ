import {
  Currency,
  Holding,
  Liability,
  IncomeStream,
  Transaction,
  AssetType,
  AppSettings,
  CreditCardStatement,
  Receivable,
} from '../types';
import { calculateAccruedInterest, isActiveCounterpartyRecord } from './counterpartyEngine';

export interface CardStateInfo {
  id: string;
  name: string;
  status: 'Normal' | 'DueSoon' | 'Overdue';
  dueDate: string;
  statementDate?: string;
  isStatementGenerated?: boolean;
  coolOffDays?: number;
  unbilledAmount?: number;
  unpaidAmount: number;
  daysRemaining: number;
  utilizationPct: number;
  annualPenaltyCost: number;
}

export interface EngineCalculationResult {
  totalAssetsBase: number;
  totalLiabilitiesBase: number;
  estimatedTaxOwedBase: number;
  netWorthBase: number;
  assetsYearlyReturnBase: number;
  assetsYearlyInformationalReturnBase: number;
  liabilitiesYearlyCostBase: number;
  salaryYearlyIncomeBase: number;
  annualOverduePenaltyBase: number;
  averageYearlySpendBase: number;
  finalRateAmountPerYear: number;
  finalRatePct: number;
  denominatorWarning: boolean;
  // Liquidity
  immediateCashBase: number;
  shortTermCashBase: number;
  lockedAssetsBase: number;
  cardDues30dBase: number;
  emis30dBase: number;
  freeCashBase: number;
  minCashThreshold: number;
  isFreeCashAlert: boolean;
  // Card statuses
  cardStates: CardStateInfo[];
  hasCardAlert: boolean; // true if any card is DueSoon or Overdue
  hasCardOverdue: boolean;
}

export interface FinalRateResult {
  finalRatePct: number;
  effectiveDenominator: number;
  denominatorWarning: boolean;
  usedFallbackGrossCapital: boolean;
}

/**
 * Robust Rate Denominator calculation with negative net worth guardrails.
 * When net worth <= 0, falls back to gross capital footprint (assets + liabilities)
 * to prevent asymptotic inversion and UI crashes, clamped to [-100%, +500%].
 */
export function calculateFinalRate(
  assets: number,
  liabilities: number,
  netWorth: number,
  denominatorMode: 'totalAssets' | 'netWorth' = 'netWorth',
  annualNetGrowthOrCost: number = 0
): FinalRateResult {
  const hasAnyFinancialData = assets > 0 || liabilities > 0;
  let denominatorWarning = false;
  let usedFallbackGrossCapital = false;
  let effectiveDenominator = 0;

  if (denominatorMode === 'totalAssets') {
    effectiveDenominator = assets > 0 ? assets : 0;
    if (assets <= 0 && hasAnyFinancialData) {
      denominatorWarning = true;
    }
  } else {
    // netWorth mode
    if (netWorth <= 0) {
      if (hasAnyFinancialData) {
        denominatorWarning = true;
      }
      // Fallback to gross capital footprint (assets + liabilities)
      const grossCapital = Math.abs(assets) + Math.abs(liabilities);
      if (grossCapital > 0) {
        effectiveDenominator = grossCapital;
        usedFallbackGrossCapital = true;
      } else {
        effectiveDenominator = 0;
      }
    } else {
      effectiveDenominator = netWorth;
    }
  }

  let finalRatePct = 0;
  if (effectiveDenominator > 0) {
    const rawPct = (annualNetGrowthOrCost / effectiveDenominator) * 100;
    // Boundary clamping: [-100%, +500%]
    finalRatePct = Math.max(-100, Math.min(500, rawPct));
  }

  return {
    finalRatePct,
    effectiveDenominator,
    denominatorWarning,
    usedFallbackGrossCapital,
  };
}

/**
 * Converts any currency amount to base currency using user-defined exchange rates.
 */
export function convertToBase(
  amount: number,
  currencyCode: string,
  currencies: Record<string, Currency>
): number {
  if (!amount || isNaN(amount)) return 0;
  const curr = currencies[currencyCode.toUpperCase()];
  if (!curr) return amount; // safe fallback
  return amount * (curr.rateToBase || 1.0);
}

/**
 * Calculates current value of a holding in its local currency.
 */
export function getHoldingLocalValue(holding: Holding): number {
  if (holding.units !== undefined && holding.currentPrice !== undefined && holding.units > 0) {
    return holding.units * holding.currentPrice;
  }
  return holding.principalOrValue || 0;
}

/**
 * Evaluates the status of a credit card against current date, statement cycles, and cool-off periods.
 * Per business requirements: Once spent, credit card outstandings are UNBILLED and NOT due until
 * statement generation. Once the statement generates, user has a configured cool-off period before
 * the final payment due date.
 */
export function evaluateCreditCard(
  card: Liability,
  currentDate: Date = new Date(),
  settings: AppSettings,
  currencies: Record<string, Currency>
): CardStateInfo {
  const limit = card.creditLimit || card.limit || 100000;
  const utilizationPct = limit > 0 ? (card.outstanding / limit) * 100 : 0;
  const alertLeadDays = card.alertLeadDays ?? settings.defaultAlertLeadDays ?? 5;
  const penaltyMonthlyPct = card.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5;
  const coolOffDays = card.coolOffDays ?? card.interestFreeDays ?? settings.defaultCardInterestFreeDays ?? 20;

  let activeDueDate = '';
  let activeStatementDate = '';
  let unpaidAmount = 0;
  let unbilledAmount = 0;
  let isStatementGenerated = false;
  let status: 'Normal' | 'DueSoon' | 'Overdue' = 'Normal';
  let daysRemaining = 999;
  let annualPenaltyCost = 0;

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const statementDay = card.statementDay || 20;

  let stmtDate: Date;
  if (card.nextStatementDate && card.nextStatementDate.trim() !== '') {
    stmtDate = new Date(card.nextStatementDate);
  } else {
    stmtDate = new Date(currentYear, currentMonth, statementDay);
  }
  activeStatementDate = stmtDate.toISOString().split('T')[0];

  const computedDueDate = new Date(stmtDate);
  computedDueDate.setDate(computedDueDate.getDate() + coolOffDays);
  activeDueDate = computedDueDate.toISOString().split('T')[0];

  isStatementGenerated = currentDate.getTime() >= stmtDate.getTime();

  // Check statements if present
  if (card.statements && card.statements.length > 0) {
    const unpaidStatements = card.statements.filter(
      (s) => s.amount - s.paidAmount > 0.01
    );

    if (unpaidStatements.length > 0) {
      unpaidStatements.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
      const currentStmt = unpaidStatements[0];
      activeDueDate = currentStmt.dueDate;
      activeStatementDate = currentStmt.statementDate;
      isStatementGenerated = true;
      unpaidAmount = currentStmt.amount - currentStmt.paidAmount;

      const dueDateTime = new Date(currentStmt.dueDate).setHours(23, 59, 59, 999);
      const currentTime = currentDate.getTime();
      const msDiff = dueDateTime - currentTime;
      daysRemaining = Math.ceil(msDiff / (1000 * 60 * 60 * 24));

      if (currentTime > dueDateTime) {
        status = 'Overdue';
        const rateFactor = settings.cardCompoundingPenalty
          ? Math.pow(1 + penaltyMonthlyPct / 100, 12) - 1
          : (penaltyMonthlyPct / 100) * 12;
        annualPenaltyCost = convertToBase(unpaidAmount * rateFactor, card.currency, currencies);
      } else if (daysRemaining <= alertLeadDays) {
        status = 'DueSoon';
      }
    }
  } else if (card.outstanding > 0) {
    if (!isStatementGenerated) {
      // Unbilled Spends: Amount spent is NOT due yet because statement is not generated!
      // Even if user spends, payment is not due until statement generation date.
      status = 'Normal';
      unpaidAmount = 0; // Not due yet
      unbilledAmount = card.outstanding;
      const dueDateTime = computedDueDate.setHours(23, 59, 59, 999);
      const currentTime = currentDate.getTime();
      daysRemaining = Math.ceil((dueDateTime - currentTime) / (1000 * 60 * 60 * 24));
    } else {
      // Statement has been generated! Balance is now billed and due by activeDueDate
      unpaidAmount = card.outstanding;
      unbilledAmount = 0;

      const dueDateTime = computedDueDate.setHours(23, 59, 59, 999);
      const currentTime = currentDate.getTime();
      daysRemaining = Math.ceil((dueDateTime - currentTime) / (1000 * 60 * 60 * 24));

      if (currentTime > dueDateTime) {
        status = 'Overdue';
        const rateFactor = (penaltyMonthlyPct / 100) * 12;
        annualPenaltyCost = convertToBase(unpaidAmount * rateFactor, card.currency, currencies);
      } else if (daysRemaining <= alertLeadDays && daysRemaining >= 0) {
        status = 'DueSoon';
      }
    }
  }

  return {
    id: card.id,
    name: card.name,
    status,
    dueDate: activeDueDate,
    statementDate: activeStatementDate,
    isStatementGenerated,
    coolOffDays,
    unbilledAmount,
    unpaidAmount,
    daysRemaining,
    utilizationPct: Math.min(100, Math.max(0, utilizationPct)),
    annualPenaltyCost,
  };
}

/**
 * Master calculation engine that computes total net worth, yearly rates,
 * liquidity strip, card alerts, and live ticker anchor.
 */
export function calculateFinancialEngine(
  holdings: Holding[],
  assetTypes: AssetType[],
  liabilities: Liability[],
  incomeStreams: IncomeStream[],
  transactions: Transaction[],
  currenciesList: Currency[],
  settings: AppSettings,
  estimatedTaxOwedBase: number = 0,
  referenceDate: Date = new Date(),
  receivables: Receivable[] = []
): EngineCalculationResult {
  const currencies: Record<string, Currency> = {};
  for (const c of currenciesList) {
    currencies[c.code.toUpperCase()] = c;
  }

  const assetTypeMap: Record<string, AssetType> = {};
  for (const t of assetTypes) {
    assetTypeMap[t.id] = t;
  }

  // 1. Assets calculation
  let totalAssetsBase = 0;
  let assetsYearlyReturnBase = 0;
  let assetsYearlyInformationalReturnBase = 0;
  let immediateCashBase = 0;
  let shortTermCashBase = 0;
  let lockedAssetsBase = 0;

  for (const h of holdings) {
    const localVal = getHoldingLocalValue(h);
    const valBase = convertToBase(localVal, h.currency, currencies);
    totalAssetsBase += valBase;

    // Liquidity classification
    // If asset has sweep-in enabled (e.g. sweep-in Fixed Deposit), it is immediately cashable on demand and adds up to free cash
    const isSweepInFd = Boolean(h.isSweepIn);
    const liqClass = isSweepInFd ? 'Immediate' : (h.liquidityClass || assetTypeMap[h.typeId]?.defaultLiquidity || 'Immediate');
    if (liqClass === 'Immediate') immediateCashBase += valBase;
    else if (liqClass === 'Short') shortTermCashBase += valBase;
    else lockedAssetsBase += valBase;

    // Return calculations
    const type = assetTypeMap[h.typeId];
    const isFixed = type ? type.returnMode === 'fixed' : true;

    if (isFixed) {
      const fixedRate = h.fixedRatePct || 0;
      assetsYearlyReturnBase += valBase * (fixedRate / 100);
    } else {
      // Realised-only type: unrealised/expected returns contribute 0 to the actual calculation.
      if (h.expectedRatePct) {
        assetsYearlyInformationalReturnBase += valBase * (h.expectedRatePct / 100);
      }
    }
  }

  // 1b. Active Peer Receivables (Lent to others: non-liquid until collected, earns interest if rate > 0)
  for (const r of receivables) {
    if (!isActiveCounterpartyRecord(r)) continue;
    const dir = r.direction === 'borrowed' ? 'borrowed' : 'lent';
    if (dir === 'lent') {
      const accrued = calculateAccruedInterest(r, referenceDate);
      const localDue = (r.outstandingAmount || 0) + accrued;
      const valBase = convertToBase(localDue, r.currency || settings.baseCurrency, currencies);
      totalAssetsBase += valBase;
      // Uncollected peer balances are NEVER immediate spendable cash
      lockedAssetsBase += valBase;
      if ((r.interestRatePct || 0) > 0) {
        assetsYearlyReturnBase += valBase * ((r.interestRatePct || 0) / 100);
      }
    }
  }

  // Add realised gains and dividends from transactions within the last 365 days
  const oneYearAgo = new Date(referenceDate);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  let realisedGainsPastYearBase = 0;
  let pastYearSpendsBase = 0;

  for (const tx of transactions) {
    const txDate = new Date(tx.date);
    if (txDate >= oneYearAgo && txDate <= referenceDate) {
      const txAmtBase = tx.amount * (tx.fxRateUsed || 1.0);
      if (tx.kind === 'dividend' || tx.kind === 'saleProceeds') {
        realisedGainsPastYearBase += txAmtBase;
      } else if (tx.kind === 'spend') {
        pastYearSpendsBase += txAmtBase;
      }
    }
  }
  assetsYearlyReturnBase += realisedGainsPastYearBase;

  // 2. Liabilities calculation
  let totalLiabilitiesBase = 0;
  let liabilitiesYearlyCostBase = 0;
  let annualOverduePenaltyBase = 0;
  let cardDues30dBase = 0;
  let emis30dBase = 0;

  // 2a. Active Peer Payables (Borrowed from others: reduces net worth until paid/offset, accrues cost if rate > 0)
  for (const r of receivables) {
    if (!isActiveCounterpartyRecord(r)) continue;
    if (r.direction === 'borrowed') {
      const accrued = calculateAccruedInterest(r, referenceDate);
      const localOwed = (r.outstandingAmount || 0) + accrued;
      const valBase = convertToBase(localOwed, r.currency || settings.baseCurrency, currencies);
      totalLiabilitiesBase += valBase;
      if ((r.interestRatePct || 0) > 0) {
        liabilitiesYearlyCostBase += valBase * ((r.interestRatePct || 0) / 100);
      }
    }
  }

  const cardStates: CardStateInfo[] = [];

  for (const liab of liabilities) {
    const outBase = convertToBase(liab.outstanding, liab.currency, currencies);
    totalLiabilitiesBase += outBase;

    if (liab.kind === 'loan') {
      const rate = liab.ratePct || 0;
      liabilitiesYearlyCostBase += outBase * (rate / 100);

      // EMI in next 30 days
      if (liab.monthlyEmi && liab.monthlyEmi > 0) {
        emis30dBase += convertToBase(liab.monthlyEmi, liab.currency, currencies);
      }
    } else if (liab.kind === 'card' && liab.cardType !== 'debit') {
      const state = evaluateCreditCard(liab, referenceDate, settings, currencies);
      cardStates.push(state);

      if (state.status === 'Overdue') {
        annualOverduePenaltyBase += state.annualPenaltyCost;
      }

      if (state.unpaidAmount > 0 && state.daysRemaining <= 30) {
        cardDues30dBase += convertToBase(state.unpaidAmount, liab.currency, currencies);
      }
    }
  }

  // 3. Salary and income stream calculation
  let salaryYearlyIncomeBase = 0;
  for (const inc of incomeStreams) {
    let multiplier = 12;
    if (inc.period === 'weekly') multiplier = 52;
    else if (inc.period === 'biweekly') multiplier = 26;
    else if (inc.period === 'quarterly') multiplier = 4;
    else if (inc.period === 'yearly') multiplier = 1;

    const annualIncomeLocal = inc.amountPerPeriod * multiplier;
    salaryYearlyIncomeBase += convertToBase(annualIncomeLocal, inc.currency, currencies);
  }

  // 4. Net Worth calculation
  // "Net worth = assets - liabilities (- estimated tax owed if the include tax in liabilities setting is on, default on)"
  const taxToDeduct = settings.includeTaxInLiabilities ? estimatedTaxOwedBase : 0;
  const netWorthBase = totalAssetsBase - totalLiabilitiesBase - taxToDeduct;

  // 5. Final Rate calculation
  // Calculated INDEPENDENT of salary earning rate:
  // Salary is an incoming cash flow promise, not physically present capital until it exists
  // inside the bank account or as an asset. Net worth rate strictly reflects the true
  // compounding and interest drag of physically present money and active debt.
  let finalRateAmountPerYear =
    assetsYearlyReturnBase - (liabilitiesYearlyCostBase + annualOverduePenaltyBase);

  if (settings.showAfterExpensesRate) {
    finalRateAmountPerYear -= pastYearSpendsBase;
  }

  // Final Rate (%) = final amount / denominator with robust guardrails
  const { finalRatePct, denominatorWarning } = calculateFinalRate(
    totalAssetsBase,
    totalLiabilitiesBase,
    netWorthBase,
    settings.finalRateDenominator,
    finalRateAmountPerYear
  );

  // 6. Free cash & Liquidity
  // "Free cash" = immediate cash - card dues and EMIs due in the next 30 days.
  const freeCashBase = immediateCashBase - (cardDues30dBase + emis30dBase);

  // Minimum cash threshold
  let minCashThreshold = 25000;
  if (settings.minCashThresholdMode === 'custom') {
    minCashThreshold = settings.minCashCustom;
  } else {
    // 3 months of average spending; if no data, default 25000
    if (pastYearSpendsBase > 0) {
      const monthlySpend = pastYearSpendsBase / 12;
      minCashThreshold = monthlySpend * (settings.minCashMonths || 3);
    } else {
      minCashThreshold = settings.minCashCustom || 25000;
    }
  }

  const hasAnyFinancialData = totalAssetsBase > 0 || totalLiabilitiesBase > 0;
  const isFreeCashAlert = hasAnyFinancialData && freeCashBase < minCashThreshold;
  const hasCardAlert = cardStates.some((c) => c.status === 'DueSoon' || c.status === 'Overdue');
  const hasCardOverdue = cardStates.some((c) => c.status === 'Overdue');

  return {
    totalAssetsBase,
    totalLiabilitiesBase,
    estimatedTaxOwedBase,
    netWorthBase,
    assetsYearlyReturnBase,
    assetsYearlyInformationalReturnBase,
    liabilitiesYearlyCostBase,
    salaryYearlyIncomeBase,
    annualOverduePenaltyBase,
    averageYearlySpendBase: pastYearSpendsBase,
    finalRateAmountPerYear,
    finalRatePct,
    denominatorWarning,
    immediateCashBase,
    shortTermCashBase,
    lockedAssetsBase,
    cardDues30dBase,
    emis30dBase,
    freeCashBase,
    minCashThreshold,
    isFreeCashAlert,
    cardStates,
    hasCardAlert,
    hasCardOverdue,
  };
}

/**
 * Calculates current live ticker value given anchor net worth and yearly pace.
 * 31,536,000 = seconds in 365 days.
 */
export function getLiveTickerValue(
  anchorNetWorth: number,
  finalRateAmountPerYear: number,
  secondsElapsed: number
): number {
  return anchorNetWorth + (finalRateAmountPerYear / 31536000) * secondsElapsed;
}
