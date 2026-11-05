/**
 * On-Device Statistical and ML Insights Engine
 * Pure TypeScript: Linear Regression, EMA, Robust Z-Score (Median + MAD),
 * Change-point analysis, spending signature detection.
 * 100% offline, zero network, zero LLM.
 */

import {
  InsightCardData,
  Transaction,
  Holding,
  Liability,
  Goal,
  Currency,
  AppSettings,
  Receivable,
  ClosedLoopMLState,
  BrokerUsageForecast,
} from '../types';
import { EngineCalculationResult, getHoldingLocalValue } from './calcEngine';
import { TaxEngineResult } from './taxEngine';
import { formatCompactMoney } from './formatters';
import { isPositiveLiquidHolding } from './assetRules';
import { ENGAGEMENT_STRATEGY_LABELS } from './mlEngine';

export function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMAD(numbers: number[], median: number): number {
  if (numbers.length === 0) return 0;
  const deviations = numbers.map((n) => Math.abs(n - median));
  return calculateMedian(deviations);
}

export function calculateRobustZScore(value: number, median: number, mad: number): number {
  if (mad === 0) return 0;
  return (0.6745 * (value - median)) / mad;
}

export function calculateLinearRegressionSlope(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function calculateEMA(values: number[], period: number = 5): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaArray: number[] = [values[0]];

  for (let i = 1; i < values.length; i++) {
    const nextEma = values[i] * k + emaArray[i - 1] * (1 - k);
    emaArray.push(nextEma);
  }
  return emaArray;
}

export function generateInsightsFeed(
  engineResult: EngineCalculationResult,
  taxResult: TaxEngineResult,
  transactions: Transaction[],
  holdings: Holding[],
  liabilities: Liability[],
  goals: Goal[],
  currenciesList: Currency[],
  settings: AppSettings,
  currentDate: Date = new Date(),
  extra?: {
    receivables?: Receivable[];
    closedLoopMLState?: ClosedLoopMLState;
    brokerUsageForecast?: BrokerUsageForecast;
  }
): InsightCardData[] {
  const cards: InsightCardData[] = [];
  const timestamp = currentDate.toISOString();
  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currenciesList.find((c) => c.code === baseCurr)?.symbol || '₹';

  const spendTx = transactions.filter((t) => !t.isReversed && t.kind === 'spend');
  const hasSufficientData = spendTx.length >= 10;

  // 1. Free Cash Below Floor
  if (engineResult.isFreeCashAlert) {
    cards.push({
      id: 'ins-freecash-low',
      type: 'warning',
      category: 'loss',
      headline: 'Free Cash Below Floor',
      evidence: `Free cash ${formatCompactMoney(engineResult.freeCashBase, baseCurr, currSym)} vs ${formatCompactMoney(
        engineResult.minCashThreshold,
        baseCurr,
        currSym
      )} floor (${formatCompactMoney(engineResult.cardDues30dBase + engineResult.emis30dBase, baseCurr, currSym)} 30d dues).`,
      suggestedAction: 'Pause discretionary spends until bank reserve recovers.',
      actionPayload: { type: 'navigate', tab: 'spend' },
      confidence: 0.98,
      timestamp,
    });
  }

  // 2. Credit Card Overdue / Due Soon
  for (const card of engineResult.cardStates) {
    if (card.status === 'Overdue') {
      cards.push({
        id: `ins-card-overdue-${card.id}`,
        type: 'warning',
        category: 'loss',
        headline: `${card.name} Is Overdue`,
        evidence: `${formatCompactMoney(card.unpaidAmount, baseCurr, currSym)} unpaid — costing roughly ${formatCompactMoney(
          card.annualPenaltyCost,
          baseCurr,
          currSym
        )}/yr in late charges.`,
        suggestedAction: 'Clear this card bill now to stop late interest.',
        actionPayload: { type: 'payCard', targetId: card.id, tab: 'liabilities' },
        confidence: 1.0,
        timestamp,
      });
    } else if (card.status === 'DueSoon') {
      cards.push({
        id: `ins-card-duesoon-${card.id}`,
        type: 'warning',
        category: 'pattern',
        headline: `${card.name} Due in ${card.daysRemaining}d`,
        evidence: `${formatCompactMoney(card.unpaidAmount, baseCurr, currSym)} due on ${card.dueDate} (${card.utilizationPct.toFixed(0)}% of card limit used).`,
        suggestedAction: 'Pay before the due date so you pay zero interest.',
        actionPayload: { type: 'payCard', targetId: card.id, tab: 'liabilities' },
        confidence: 0.95,
        timestamp,
      });
    }
  }

  // 2b. Debit Card ATM Quota
  const currentMonthStr = currentDate.toISOString().substring(0, 7);
  const debitCards = liabilities.filter((l) => l.kind === 'card' && l.cardType === 'debit');
  for (const card of debitCards) {
    const isCurrentMonth = card.lastAtmUsageMonth === currentMonthStr;
    const metroUsage = isCurrentMonth ? (card.metroAtmUsageThisMonth || 0) : 0;
    const nonMetroUsage = isCurrentMonth ? (card.nonMetroAtmUsageThisMonth || 0) : 0;
    const totalUsage = metroUsage + nonMetroUsage;
    const metroLimit = card.metroAtmFreeLimit ?? settings.debitCardMetroAtmLimit ?? 5;
    const nonMetroLimit = card.nonMetroAtmFreeLimit ?? settings.debitCardNonMetroAtmLimit ?? 3;
    const extraFee = card.atmExtraFeeAmount ?? settings.debitCardExtraFeePerWithdrawal ?? 21;

    if (nonMetroUsage >= nonMetroLimit) {
      cards.push({
        id: `ins-debit-atm-nonmetro-${card.id}`,
        type: 'warning',
        category: 'loss',
        headline: `${card.name} Non-Metro ATM Maxed`,
        evidence: `${nonMetroUsage}/${nonMetroLimit} free used; next withdrawal costs ${extraFee} ${card.currency}.`,
        suggestedAction: 'Use UPI or POS instead of ATM withdrawals.',
        actionPayload: { type: 'navigate', tab: 'liabilities' },
        confidence: 0.96,
        timestamp,
      });
    } else if (metroUsage >= metroLimit) {
      cards.push({
        id: `ins-debit-atm-metro-${card.id}`,
        type: 'warning',
        category: 'loss',
        headline: `${card.name} Metro ATM Maxed`,
        evidence: `${metroUsage}/${metroLimit} free used; next withdrawal costs ${extraFee} ${card.currency}.`,
        suggestedAction: 'Route payments via UPI/POS to avoid ATM fees.',
        actionPayload: { type: 'navigate', tab: 'liabilities' },
        confidence: 0.96,
        timestamp,
      });
    } else if (totalUsage >= 3) {
      cards.push({
        id: `ins-debit-atm-usage3-${card.id}`,
        type: 'warning',
        category: 'pattern',
        headline: `${card.name} ATM Quota Near Cap`,
        evidence: `${totalUsage} ATM uses this month (${nonMetroUsage}/${nonMetroLimit} non-metro, ${metroUsage}/${metroLimit} metro).`,
        suggestedAction: 'Batch cash withdrawals to avoid extra ATM fees.',
        actionPayload: { type: 'navigate', tab: 'liabilities' },
        confidence: 0.91,
        timestamp,
      });
    }
  }

  // 2c. Credit Utilization Smart Routing
  const creditCards = liabilities.filter((l) => l.kind === 'card' && (l.cardType === 'credit' || !l.cardType));
  const avgCreditUtil =
    creditCards.length > 0
      ? creditCards.reduce((acc, c) => acc + ((c.outstanding || 0) / Math.max(1, c.limit || 100000)) * 100, 0) /
        creditCards.length
      : 0;

  if (avgCreditUtil > 30 && debitCards.length > 0) {
    const linkedBanks = holdings.filter((h) => h.typeId === 'type-bank' && (h.principalOrValue || 0) > 10000);
    if (linkedBanks.length > 0) {
      cards.push({
        id: 'ins-card-smart-routing',
        type: 'neutral',
        category: 'pattern',
        headline: 'Credit Utilization Above 30%',
        evidence: `Average card utilization is ${avgCreditUtil.toFixed(0)}% (>30% safe ceiling).`,
        suggestedAction: `Shift routine spends to ${debitCards[0].name}.`,
        confidence: 0.89,
        timestamp,
      });
    }
  }

  // 3. Tax LTCG Window
  const nowMs = currentDate.getTime();
  for (const h of holdings) {
    if (h.startDate && (h.typeId === 'type-stock-in' || h.typeId === 'type-mf')) {
      const startMs = new Date(h.startDate).getTime();
      const heldDays = (nowMs - startMs) / (1000 * 60 * 60 * 24);
      const remainingDays = 365 - heldDays;
      if (remainingDays > 0 && remainingDays <= 45) {
        const ltcgDate = new Date(startMs + 365 * 86400000).toISOString().split('T')[0];
        cards.push({
          id: `ins-tax-ltcg-holding-${h.id}`,
          type: 'positive',
          category: 'tax',
          headline: `${h.name}: LTCG in ${Math.ceil(remainingDays)}d`,
          evidence: `Selling now triggers 20% STCG vs 12.5% LTCG after ${ltcgDate}.`,
          suggestedAction: `Hold until ${ltcgDate} to cut tax by 7.5%.`,
          confidence: 0.92,
          timestamp,
        });
      }
    }
  }

  const currentFy = 'FY26-27';
  const fyTax = taxResult.byFinancialYear[currentFy];
  if (fyTax) {
    const ltcgGains = fyTax.equityLtcgTotal;
    if (ltcgGains > 0 && ltcgGains < 125000) {
      const remainingExemption = 125000 - ltcgGains;
      cards.push({
        id: 'ins-tax-exemption-space',
        type: 'neutral',
        category: 'tax',
        headline: `${formatCompactMoney(remainingExemption, baseCurr, currSym)} Tax-Free LTCG Left`,
        evidence: `Used ${formatCompactMoney(ltcgGains, baseCurr, currSym)} of ₹1.25L Sec 112A exemption.`,
        suggestedAction: `Harvest up to ${formatCompactMoney(remainingExemption, baseCurr, currSym)} LTCG at 0% tax before Mar 31.`,
        confidence: 0.88,
        timestamp,
      });
    }
  }

  // 4. Unusually Large Spend
  if (spendTx.length >= 5) {
    const amounts = spendTx.map((t) => t.amount * (t.fxRateUsed || 1));
    const median = calculateMedian(amounts);
    const mad = calculateMAD(amounts, median);

    for (const t of spendTx.slice(-5)) {
      const val = t.amount * (t.fxRateUsed || 1);
      const z = calculateRobustZScore(val, median, mad);
      if (z > 2.5) {
        cards.push({
          id: `ins-anomaly-${t.id}`,
          type: 'warning',
          category: 'anomaly',
          headline: `Unusually High Spend: ${t.reason}`,
          evidence: `${formatCompactMoney(val, baseCurr, currSym)} on ${t.date} — well above your usual ${formatCompactMoney(median, baseCurr, currSym)} spend.`,
          suggestedAction: 'Double-check that this wasn’t charged twice or mark it as one-time.',
          confidence: 0.85,
          timestamp,
        });
        break;
      }
    }
  }

  // 5. Category Spend Creeping Up
  const spendsByCategory: Record<string, number[]> = {};
  for (const t of spendTx) {
    const cat = t.category || 'General';
    if (!spendsByCategory[cat]) spendsByCategory[cat] = [];
    spendsByCategory[cat].push(t.amount * (t.fxRateUsed || 1));
  }

  for (const [category, values] of Object.entries(spendsByCategory)) {
    if (values.length >= 4) {
      const { slope } = calculateLinearRegressionSlope(values);
      const total = values.reduce((a, b) => a + b, 0);
      if (slope > 100 && total > 2000) {
        cards.push({
          id: `ins-trend-up-${category}`,
          type: 'warning',
          category: 'trend',
          headline: `${category} Spending Creeping Up`,
          evidence: `Each recent ${category} spend has grown by roughly ${formatCompactMoney(slope, baseCurr, currSym)} (${formatCompactMoney(total, baseCurr, currSym)} total).`,
          suggestedAction: `Trim ${category} spends for the rest of this month.`,
          confidence: 0.82,
          timestamp,
        });
      }
    }
  }

  // 6. Weekend Overspend Pattern
  const daySpends: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const dayCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

  for (const t of spendTx) {
    const d = new Date(t.date).getDay();
    daySpends[d] += t.amount * (t.fxRateUsed || 1);
    dayCounts[d] += 1;
  }

  const weekendAvg = ((daySpends[0] || 0) + (daySpends[6] || 0)) / ((dayCounts[0] || 1) + (dayCounts[6] || 1));
  const weekdayAvg =
    ((daySpends[1] || 0) + (daySpends[2] || 0) + (daySpends[3] || 0) + (daySpends[4] || 0) + (daySpends[5] || 0)) /
    Math.max(1, (dayCounts[1] || 0) + (dayCounts[2] || 0) + (dayCounts[3] || 0) + (dayCounts[4] || 0) + (dayCounts[5] || 0));

  if (weekendAvg > weekdayAvg * 1.75 && weekendAvg > 1000) {
    cards.push({
      id: 'ins-pattern-weekend',
      type: 'neutral',
      category: 'pattern',
      headline: `Weekend Spending Is ${(weekendAvg / weekdayAvg).toFixed(1)}x Higher`,
      evidence: `You average ${formatCompactMoney(weekendAvg, baseCurr, currSym)}/day on weekends vs ${formatCompactMoney(weekdayAvg, baseCurr, currSym)}/day on weekdays.`,
      suggestedAction: 'Pick a simple weekend spending limit before Friday.',
      confidence: 0.79,
      timestamp,
    });
  }

  // 7. Realistic Net Worth Rate (Assets Compounding vs Liabilities Growth Rate)
  const debtGrowthYear = engineResult.liabilitiesYearlyCostBase + engineResult.annualOverduePenaltyBase;
  if (engineResult.finalRateAmountPerYear > 0) {
    cards.push({
      id: 'ins-positive-momentum',
      type: 'positive',
      category: 'trend',
      headline: `Good Work: Money Growing at +${engineResult.finalRatePct.toFixed(2)}%/yr`,
      evidence: `Your investments earn ${formatCompactMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}/yr, beating ${formatCompactMoney(debtGrowthYear, baseCurr, currSym)}/yr in loan interest.`,
      suggestedAction: 'Move idle extra bank cash into earning assets when safe.',
      confidence: 0.94,
      timestamp,
    });
  } else if (engineResult.finalRateAmountPerYear < 0) {
    cards.push({
      id: 'ins-negative-momentum',
      type: 'warning',
      category: 'trend',
      headline: `Loan Interest Exceeds Earnings (${engineResult.finalRatePct.toFixed(2)}%/yr)`,
      evidence: `Loans cost ${formatCompactMoney(debtGrowthYear, baseCurr, currSym)}/yr while assets earn ${formatCompactMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}/yr.`,
      suggestedAction: 'Use spare bank cash to pay down your highest-interest debt.',
      confidence: 0.95,
      timestamp,
    });
  }

  // 8. Goals Proximity (Strictly Positive Liquid Assets)
  const evaluatedGoals = goals.map((goal) => {
    const isDebt = goal.goalType === 'debt_payoff';
    const matchedLiab = isDebt && goal.targetLiabilityId ? liabilities.find((l) => l.id === goal.targetLiabilityId) : undefined;

    let currentGoalValue = goal.accumulatedTotal || 0;
    if (currentGoalValue <= 0) {
      for (const src of goal.sources || []) {
        const h = holdings.find((x) => x.id === src.sourceId);
        if (h && isPositiveLiquidHolding(h)) {
          const val = getHoldingLocalValue(h);
          if (src.allocationMode === 'fixed_amount' && src.allocationAmount !== undefined && src.allocationAmount > 0) {
            currentGoalValue += Math.min(val, src.allocationAmount);
          } else {
            currentGoalValue += val * ((src.allocationPct || 0) / 100);
          }
        }
      }
    }

    const targetCost = isDebt ? (goal.startingDebtAmount || goal.cost) : goal.cost;
    let pct = 0;
    let remainingGap = 0;

    if (isDebt) {
      const currentOutstanding = matchedLiab ? matchedLiab.outstanding : 0;
      const debtPaid = Math.max(0, targetCost - currentOutstanding);
      pct = targetCost > 0 ? (debtPaid / targetCost) * 100 : 0;
      remainingGap = currentOutstanding;
    } else {
      pct = targetCost > 0 ? (currentGoalValue / targetCost) * 100 : 0;
      remainingGap = Math.max(0, targetCost - currentGoalValue);
    }

    return { goal, isDebt, pct, remainingGap, currentGoalValue, targetCost };
  });

  const inProgressGoals = evaluatedGoals
    .filter((item) => !item.goal.isCompleted && !item.goal.paymentVerified && item.pct < 99.9 && item.remainingGap > 0)
    .sort((a, b) => b.pct - a.pct);

  if (inProgressGoals.length > 0) {
    const nearest = inProgressGoals[0];
    cards.push({
      id: `ins-goal-proximity-${nearest.goal.id}`,
      type: 'positive',
      category: 'goal',
      headline: `${nearest.goal.name} at ${nearest.pct.toFixed(0)}%`,
      evidence: `${formatCompactMoney(nearest.remainingGap, baseCurr, currSym)} remaining on ${formatCompactMoney(nearest.targetCost, baseCurr, currSym)} target.`,
      suggestedAction: `Allocate verified liquid surplus in Goals.`,
      actionPayload: { type: 'navigate', tab: 'goals' },
      confidence: 0.95,
      timestamp,
    });
  }

  if (engineResult.isFreeCashAlert && inProgressGoals.length > 1) {
    cards.unshift({
      id: 'ins-low-cashflow-goal-alert',
      type: 'warning',
      category: 'goal',
      headline: 'Multiple Goals Under Low Buffer',
      evidence: `Free cash (${formatCompactMoney(engineResult.freeCashBase, baseCurr, currSym)}) is below ${formatCompactMoney(engineResult.minCashThreshold, baseCurr, currSym)} safety floor.`,
      suggestedAction: 'Pause secondary goals until cash buffer recovers.',
      actionPayload: { type: 'navigate', tab: 'goals' },
      confidence: 0.98,
      timestamp,
    });
  }

  // 9. Loan EMI Shortfall
  if (engineResult.emis30dBase > 0 && engineResult.immediateCashBase < engineResult.emis30dBase) {
    cards.unshift({
      id: 'ins-critical-emi-risk',
      type: 'warning',
      category: 'pattern',
      headline: 'EMI Cash Shortfall',
      evidence: `${formatCompactMoney(engineResult.immediateCashBase, baseCurr, currSym)} bank cash vs ${formatCompactMoney(engineResult.emis30dBase, baseCurr, currSym)} 30d EMIs.`,
      suggestedAction: 'Replenish liquid bank balance before EMI due date.',
      actionPayload: { type: 'navigate', tab: 'spend' },
      confidence: 1.0,
      timestamp,
    });
  }

  // 10. Broker Fee Forecast (Notify-Only)
  const brokerForecast = extra?.brokerUsageForecast;
  if (brokerForecast && brokerForecast.hasPattern) {
    const typStr = formatCompactMoney(brokerForecast.typicalAmount, baseCurr, currSym);
    const saveStr = formatCompactMoney(brokerForecast.potentialFeeSaved, baseCurr, currSym);
    const recFeeStr = formatCompactMoney(brokerForecast.recommendedProjectedFee, baseCurr, currSym);
    const recCardLabel = brokerForecast.recommendedCardName || 'lowest-fee card';
    const brokerLabel = brokerForecast.predictedBrokerName || 'broker';

    cards.unshift({
      id: `ins-broker-pattern-${brokerForecast.expectedNextDateStr}`,
      type: brokerForecast.potentialFeeSaved > 0 ? 'warning' : 'neutral',
      category: 'pattern',
      headline: `${brokerLabel} Cycle (~${brokerForecast.expectedNextDateStr})`,
      evidence: `~${typStr} pattern; ${recCardLabel} costs ${recFeeStr}${brokerForecast.potentialFeeSaved > 0 ? ` (saves ${saveStr})` : ''}.`,
      suggestedAction: `Compare ${recCardLabel} fee before transacting.`,
      actionPayload: { type: 'navigate', tab: 'assets' },
      confidence: Math.min(0.96, 0.72 + brokerForecast.sampleCount * 0.06),
      timestamp,
    });
  }

  // 11. Closed-Loop Reality Recalibration
  const closedLoop = extra?.closedLoopMLState;
  if (closedLoop && closedLoop.recentOutcomes.length > 0) {
    const latestFailure = closedLoop.recentOutcomes.find((o) => o.outcome === 'fail');
    if (latestFailure) {
      cards.unshift({
        id: `ins-closed-loop-recal-${latestFailure.id}`,
        type: 'warning',
        category: 'pattern',
        headline: `Guidance Adapted: ${ENGAGEMENT_STRATEGY_LABELS[closedLoop.activeStrategy]}`,
        evidence: `${latestFailure.actualRealitySummary}.`,
        suggestedAction: 'Review personalized recommendations above.',
        actionPayload: { type: 'navigate', tab: 'insights' },
        confidence: 0.94,
        timestamp,
      });
    }
  }

  if (!hasSufficientData) {
    cards.unshift({
      id: 'ins-sample-learning',
      type: 'neutral',
      category: 'sample',
      headline: `Learning Your Habits (${spendTx.length}/10 Spends)`,
      evidence: `${spendTx.length} of 10 everyday spends recorded so far.`,
      suggestedAction: 'Log a few more spends to unlock personalized habit tips.',
      confidence: 1.0,
      timestamp,
    });
  }

  return cards;
}
