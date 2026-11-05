/**
 * Cash-Flow Forecasting Engine
 * Computes deterministic, auditable, date-based cash projections over a 30 to 90 day window.
 * Strictly distinguishes confirmed vs estimated flows, enforces zero-credit liquidity,
 * and stress-tests against delayed salary, delayed receivables, and unexpected expenses.
 */

import {
  Holding,
  Liability,
  Bill,
  IncomeStream,
  Receivable,
  CashFlowEvent,
  DailyCashProjection,
  CashFlowForecastResult,
  Currency,
  AppSettings,
} from '../types';
import { convertToBase, evaluateCreditCard } from './calcEngine';
import { roundCurrency, safeAdd, safeSub } from './financialMath';

export type ForecastScenario =
  | 'normal'
  | 'delayed_salary'
  | 'delayed_receivables'
  | 'unexpected_expense'
  | 'income_shock';

export interface ForecastOptions {
  windowDays?: number; // 30, 60, or 90
  scenario?: ForecastScenario;
  scenarioParam?: number; // e.g. delay days or expense amount
  startDate?: string; // YYYY-MM-DD (defaults to today)
}

/**
 * Returns strictly immediate liquid cash available for paying bills (cash in hand + unencumbered bank balances).
 * Locked FDs, credit limits, stocks, and promised receivables are strictly EXCLUDED.
 */
export function getAvailableLiquidCashBase(
  holdings: Holding[],
  currencies: Record<string, Currency>
): number {
  let total = 0;
  for (const h of holdings) {
    // Only liquid accounts with immediate liquidity
    // Exclude locked FDs and non-liquid assets
    if (h.liquidityClass === 'Immediate') {
      const val = h.principalOrValue || 0;
      if (val > 0) {
        total = safeAdd(total, convertToBase(val, h.currency, currencies));
      }
    }
  }
  return roundCurrency(total);
}

/**
 * Generates date-based cash projection
 */
export function generateCashFlowForecast(
  holdings: Holding[],
  liabilities: Liability[],
  bills: Bill[],
  incomes: IncomeStream[],
  receivables: Receivable[] = [],
  currencies: Record<string, Currency>,
  settings: AppSettings,
  options: ForecastOptions = {}
): CashFlowForecastResult {
  const windowDays = options.windowDays || 30;
  const scenario = options.scenario || 'normal';
  const missingInputsWarnings: string[] = [];

  const start = options.startDate ? new Date(options.startDate) : new Date();
  start.setHours(0, 0, 0, 0);

  const initialLiquidCash = getAvailableLiquidCashBase(holdings, currencies);
  const safetyBuffer = settings.cashFlowBufferAmount ?? 25000;

  if (incomes.length === 0) {
    missingInputsWarnings.push('No active recurring income stream configured. Inflows may be understated.');
  }
  if (bills.length === 0) {
    missingInputsWarnings.push('No recurring bills logged. Outflows may only reflect credit card statements.');
  }

  // Pre-index dated events for the forecast window
  const eventMap: Record<string, CashFlowEvent[]> = {};

  const addEvent = (event: CashFlowEvent) => {
    if (!eventMap[event.date]) {
      eventMap[event.date] = [];
    }
    eventMap[event.date].push(event);
  };

  // 1. Project Incomes
  for (const inc of incomes) {
    const incAmountBase = convertToBase(inc.amountPerPeriod, inc.currency, currencies);
    if (incAmountBase <= 0) continue;

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
      const d = new Date(start);
      d.setDate(d.getDate() + dayOffset);
      const dayOfMonth = d.getDate();

      let isPayday = false;
      if (inc.payScheduleType === 'last_calendar_day') {
        const nextDay = new Date(d);
        nextDay.setDate(nextDay.getDate() + 1);
        isPayday = nextDay.getDate() === 1;
      } else {
        const targetDay = inc.payDay || 1;
        isPayday = dayOfMonth === targetDay;
      }

      if (isPayday) {
        let finalAmount = incAmountBase;
        let eventDateStr = d.toISOString().split('T')[0];

        // Scenario modifications
        if (scenario === 'delayed_salary') {
          const delayDays = options.scenarioParam || 7;
          const delayedDate = new Date(d);
          delayedDate.setDate(delayedDate.getDate() + delayDays);
          eventDateStr = delayedDate.toISOString().split('T')[0];
        } else if (scenario === 'income_shock') {
          finalAmount = safeSub(finalAmount, safeAdd(finalAmount * 0.5)); // 50% reduction
        }

        addEvent({
          id: `inc_${inc.id}_${eventDateStr}`,
          date: eventDateStr,
          type: 'inflow',
          category: 'salary',
          name: inc.name,
          amount: finalAmount,
          currency: settings.baseCurrency,
          isConfirmed: scenario === 'normal',
          notes: scenario === 'delayed_salary' ? 'Salary delayed by stress test scenario' : undefined,
        });
      }
    }
  }

  // 2. Project Recurring Bills & EMIs
  for (const bill of bills) {
    // If bill is for a credit card that has dynamic statement cycles, handle via card statement evaluation to prevent double count
    if (bill.liabilityKind === 'card' && bill.liabilityId) {
      continue;
    }

    const billAmtBase = convertToBase(bill.amount, bill.currency, currencies);
    if (billAmtBase <= 0) continue;

    for (let dayOffset = 0; dayOffset < windowDays; dayOffset++) {
      const d = new Date(start);
      d.setDate(d.getDate() + dayOffset);
      const dayOfMonth = d.getDate();

      if (dayOfMonth === bill.dueDay) {
        const dateStr = d.toISOString().split('T')[0];
        addEvent({
          id: `bill_${bill.id}_${dateStr}`,
          date: dateStr,
          type: 'outflow',
          category: bill.liabilityKind === 'loan' ? 'emi' : 'bill',
          name: bill.name,
          amount: billAmtBase,
          currency: settings.baseCurrency,
          isConfirmed: true,
          sourceOrTargetName: bill.category,
        });
      }
    }
  }

  // 3. Project Credit Card Due Payments (Avoid double-counting purchases and statement dues)
  for (const card of liabilities.filter((l) => l.kind === 'card')) {
    const cardState = evaluateCreditCard(card, start, settings, currencies);
    if (cardState.unpaidAmount > 0 && cardState.dueDate) {
      const dueDate = new Date(cardState.dueDate);
      const diffDays = Math.ceil((dueDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < windowDays) {
        const cardDueBase = convertToBase(cardState.unpaidAmount, card.currency, currencies);
        addEvent({
          id: `card_due_${card.id}_${cardState.dueDate}`,
          date: cardState.dueDate,
          type: 'outflow',
          category: 'card_payment',
          name: `${card.name} Statement Due`,
          amount: cardDueBase,
          currency: settings.baseCurrency,
          isConfirmed: true,
          notes: `Due after ${cardState.coolOffDays || 20}-day cool-off from statement`,
        });
      }
    }
  }

  // 4. Project Receivables (Money Lent to Others)
  for (const rec of receivables) {
    if (rec.status === 'collected' || rec.status === 'written_off') continue;
    if (rec.outstandingAmount <= 0) continue;

    if (rec.expectedDate) {
      const recDate = new Date(rec.expectedDate);
      const diffDays = Math.ceil((recDate.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays >= 0 && diffDays < windowDays) {
        // In delayed_receivables scenario, postpone collection beyond window
        if (scenario === 'delayed_receivables') {
          // Excluded from current window
          continue;
        }

        const amtBase = convertToBase(rec.outstandingAmount, rec.currency, currencies);
        // Receivables are inherently estimated unless confidence is 100%
        const isConfirmed = rec.confidencePct >= 95;
        const weightedAmt = isConfirmed ? amtBase : roundCurrency((amtBase * rec.confidencePct) / 100);

        addEvent({
          id: `rec_${rec.id}_${rec.expectedDate}`,
          date: rec.expectedDate,
          type: 'inflow',
          category: 'receivable',
          name: `Repayment from ${rec.debtorName}`,
          amount: weightedAmt,
          currency: settings.baseCurrency,
          isConfirmed,
          notes: `${rec.confidencePct}% collection confidence applied`,
        });
      }
    }
  }

  // 5. Stress Test Scenarios: Unexpected Emergency Outflow
  if (scenario === 'unexpected_expense') {
    const expenseAmt = options.scenarioParam || 25000;
    const expenseDate = new Date(start);
    expenseDate.setDate(expenseDate.getDate() + 5); // Hits in 5 days
    const dateStr = expenseDate.toISOString().split('T')[0];

    addEvent({
      id: `stress_expense_${dateStr}`,
      date: dateStr,
      type: 'outflow',
      category: 'expense_stress',
      name: 'Simulated Emergency Outflow',
      amount: expenseAmt,
      currency: settings.baseCurrency,
      isConfirmed: false,
      notes: 'Stress scenario: unpredicted health/vehicle emergency',
    });
  }

  // Simulate Day by Day
  const dailyTimeline: DailyCashProjection[] = [];
  const negativeCashDates: string[] = [];
  let currentBalance = initialLiquidCash;
  let minBalance = initialLiquidCash;
  let minBalanceDate = start.toISOString().split('T')[0];
  let daysBelowBuffer = 0;
  let totalInflows = 0;
  let totalOutflows = 0;

  for (let i = 0; i < windowDays; i++) {
    const curDate = new Date(start);
    curDate.setDate(curDate.getDate() + i);
    const dateStr = curDate.toISOString().split('T')[0];
    const dayOfWeek = curDate.toLocaleDateString('en-US', { weekday: 'short' });

    const events = eventMap[dateStr] || [];
    let dayInflows = 0;
    let dayOutflows = 0;

    for (const ev of events) {
      if (ev.type === 'inflow') {
        dayInflows = safeAdd(dayInflows, ev.amount);
        totalInflows = safeAdd(totalInflows, ev.amount);
      } else {
        dayOutflows = safeAdd(dayOutflows, ev.amount);
        totalOutflows = safeAdd(totalOutflows, ev.amount);
      }
    }

    const openingBalance = currentBalance;
    const closingBalance = safeSub(safeAdd(openingBalance, dayInflows), dayOutflows);
    currentBalance = closingBalance;

    if (closingBalance < minBalance) {
      minBalance = closingBalance;
      minBalanceDate = dateStr;
    }

    if (closingBalance < 0) {
      negativeCashDates.push(dateStr);
    }
    if (closingBalance < safetyBuffer) {
      daysBelowBuffer++;
    }

    dailyTimeline.push({
      date: dateStr,
      dayOfWeek,
      openingBalance,
      inflows: dayInflows,
      outflows: dayOutflows,
      closingBalance,
      events,
      isBelowBuffer: closingBalance < safetyBuffer,
      isNegative: closingBalance < 0,
    });
  }

  let scenarioDescription = 'Baseline cash-flow projection based on scheduled events.';
  if (scenario === 'delayed_salary') {
    scenarioDescription = `Stress Test: Payday delayed by ${options.scenarioParam || 7} days.`;
  } else if (scenario === 'delayed_receivables') {
    scenarioDescription = 'Stress Test: Expected money lent to others is not repaid this month.';
  } else if (scenario === 'unexpected_expense') {
    scenarioDescription = `Stress Test: Unexpected emergency bill of ${settings.baseCurrency} ${options.scenarioParam || 25000} logged on day 5.`;
  } else if (scenario === 'income_shock') {
    scenarioDescription = 'Stress Test: 50% temporary cut in monthly income streams.';
  }

  return {
    windowDays,
    startDate: start.toISOString().split('T')[0],
    endDate: dailyTimeline[dailyTimeline.length - 1]?.date || start.toISOString().split('T')[0],
    initialLiquidCash,
    totalProjectedInflows: roundCurrency(totalInflows),
    totalProjectedOutflows: roundCurrency(totalOutflows),
    finalProjectedBalance: roundCurrency(currentBalance),
    minProjectedBalance: roundCurrency(minBalance),
    minBalanceDate,
    negativeCashDates,
    daysBelowSafetyBuffer: daysBelowBuffer,
    dailyTimeline,
    scenarioApplied: scenario,
    scenarioDescription,
    missingInputsWarnings,
  };
}
