/**
 * Centralized Notification & Obligation Conflict Engine
 * Clear, everyday language with zero scientific formulas.
 * Celebrates good financial moves and flags genuine action items with smart snooze metadata.
 */

import {
  Holding,
  Liability,
  Bill,
  IncomeStream,
  Receivable,
  ScheduledTransfer,
  RLMovementRecommendation,
  Goal,
  Currency,
  AppSettings,
  CashFlowForecastResult,
  FinancialNotification,
  ObligationConflictDetails,
} from '../types';
import { convertToBase } from './calcEngine';
import { formatMoney } from './formatters';
import { isActiveCounterpartyRecord } from './counterpartyEngine';

export interface ConflictDetectionOptions {
  baseDate?: string;
  windowDays?: number;
}

export function detectObligationConflicts(
  cashFlowForecast: CashFlowForecastResult,
  _holdings: Holding[],
  liabilities: Liability[],
  bills: Bill[],
  _incomeStreams: IncomeStream[],
  receivables: Receivable[],
  scheduledTransfers: ScheduledTransfer[],
  rlRecommendations: RLMovementRecommendation[],
  goals: Goal[],
  currencies: Record<string, Currency>,
  settings: AppSettings,
  options: ConflictDetectionOptions = {}
): FinancialNotification[] {
  const notifications: FinancialNotification[] = [];
  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies[baseCurr]?.symbol || '₹';
  const safetyBuffer = settings.cashFlowBufferAmount ?? settings.minCashCustom ?? 25000;
  const now = options.baseDate ? new Date(options.baseDate) : new Date();
  const todayStr = now.toISOString().split('T')[0];

  const timeline = cashFlowForecast.dailyTimeline || [];

  // 1. Loan EMI Cash Shortfall or Buffer Warning
  const loans = liabilities.filter(
    (l) => l.kind === 'loan' && (l.monthlyEmi || 0) > 0 && (l.outstanding || 0) > 0
  );

  for (const loan of loans) {
    const emiDay = loan.emiDay || 5;
    const emiTimelineDays = timeline.filter((d) => new Date(d.date).getDate() === emiDay);

    for (const emiDayData of emiTimelineDays) {
      const emiDate = emiDayData.date;
      const closingBal = emiDayData.closingBalance;
      const isDeficit = closingBal < 0;
      const isBufferBreached = closingBal < safetyBuffer && !isDeficit;

      if (isDeficit || isBufferBreached) {
        const pendingPrepay = rlRecommendations.find(
          (r) => r.status === 'pending' && r.suggestedAmount > 0
        );
        const competingTransfers = scheduledTransfers.filter(
          (t) => t.isActive && (t.dayOfMonth <= emiDay || t.dayOfMonth >= 25)
        );
        const totalTransferAmt = competingTransfers.reduce(
          (sum, t) => sum + convertToBase(t.amount, t.currency, currencies),
          0
        );
        const goalContributions = goals.filter(
          (g) => !g.isCompleted && (g.monthlyContribution || 0) > 0 && g.accumulateMonthly
        );
        const totalGoalMonthly = goalContributions.reduce(
          (sum, g) => sum + convertToBase(g.monthlyContribution || 0, g.currency, currencies),
          0
        );

        let conflictingPlanName = 'Other planned payments';
        let conflictingAmount = 0;

        if (pendingPrepay && pendingPrepay.suggestedAmount > 0) {
          conflictingPlanName = `Extra Prepayment (${pendingPrepay.toAssetName})`;
          conflictingAmount = pendingPrepay.suggestedAmount;
        } else if (totalTransferAmt > 0) {
          conflictingPlanName = `Scheduled Transfers (${competingTransfers.map((t) => t.name).join(', ')})`;
          conflictingAmount = totalTransferAmt;
        } else if (totalGoalMonthly > 0) {
          conflictingPlanName = 'Monthly Goal Contributions';
          conflictingAmount = totalGoalMonthly;
        }

        const shortfall = isDeficit ? Math.abs(closingBal) : Math.max(0, safetyBuffer - closingBal);

        const mitigation = isDeficit
          ? `Hold off on ${conflictingPlanName} or add ${formatMoney(
              shortfall,
              baseCurr,
              currSym
            )} to your bank account before ${emiDate} so your ${loan.name} EMI goes through without bounce fees.`
          : `Paying ${conflictingPlanName} before ${emiDate} leaves ${formatMoney(
              closingBal,
              baseCurr,
              currSym
            )} in your bank, dipping below your ${formatMoney(safetyBuffer, baseCurr, currSym)} safety cushion.`;

        const conflictDetails: ObligationConflictDetails = {
          obligationName: `${loan.name} EMI`,
          obligationAmount: loan.monthlyEmi || 0,
          obligationDate: emiDate,
          obligationType: 'emi',
          conflictingPlanName,
          conflictingAmount,
          shortfallAmount: shortfall,
          projectedBalanceOnDueDate: closingBal,
          recommendedMitigation: mitigation,
        };

        notifications.push({
          id: `conflict-emi-${loan.id}-${emiDate}`,
          type: 'obligation_conflict',
          severity: isDeficit ? 'critical' : 'warning',
          requiresAction: isDeficit,
          title: isDeficit
            ? `Action Needed: Cash Short for ${loan.name} EMI`
            : `Heads Up: ${loan.name} EMI Dips Into Safety Cushion`,
          message: isDeficit
            ? `Your bank cash is short by ${formatMoney(
                shortfall,
                baseCurr,
                currSym
              )} for the ${formatMoney(
                loan.monthlyEmi || 0,
                loan.currency,
                currSym
              )} ${loan.name} EMI due on ${emiDate}. Top up your account or pause extra outflows.`
            : `After your ${loan.name} EMI on ${emiDate}, bank cash will sit at ${formatMoney(
                closingBal,
                baseCurr,
                currSym
              )}, below your ${formatMoney(safetyBuffer, baseCurr, currSym)} safety reserve.`,
          conflictDetails,
          actionLabel: isDeficit ? 'Protect EMI' : 'Review Bills',
          actionTab: 'spend',
          timestamp: todayStr,
        });
      }
    }
  }

  // 2. Upcoming Recurring Bills Cash Shortfall
  const nonLoanBills = bills.filter(
    (b) => !b.isArchived && !b.isOverriddenPaid && b.liabilityKind !== 'loan' && b.amount > 0
  );

  for (const bill of nonLoanBills) {
    const dueDay = bill.dueDay || 1;
    const billTimelineDays = timeline.filter((d) => new Date(d.date).getDate() === dueDay);

    for (const bDay of billTimelineDays) {
      if (bDay.closingBalance < 0) {
        const shortfall = Math.abs(bDay.closingBalance);
        const conflictDetails: ObligationConflictDetails = {
          obligationName: bill.name,
          obligationAmount: bill.amount,
          obligationDate: bDay.date,
          obligationType: 'bill',
          conflictingPlanName: 'Upcoming Outflows',
          shortfallAmount: shortfall,
          projectedBalanceOnDueDate: bDay.closingBalance,
          recommendedMitigation: `Add ${formatMoney(
            shortfall,
            baseCurr,
            currSym
          )} to your bank account or pause optional spends before ${bDay.date}.`,
        };

        notifications.push({
          id: `conflict-bill-${bill.id}-${bDay.date}`,
          type: 'obligation_conflict',
          severity: 'critical',
          requiresAction: true,
          title: `Action Needed: Short ${formatMoney(shortfall, baseCurr, currSym)} for ${bill.name}`,
          message: `Your bank balance won't cover ${bill.name} (${formatMoney(
            bill.amount,
            bill.currency,
            currSym
          )}) due on ${bDay.date}. Move funds or trim non-essential spends.`,
          conflictDetails,
          actionLabel: 'Review Bills',
          actionTab: 'spend',
          timestamp: todayStr,
        });
      }
    }
  }

  // 3. 30-Day Cash Shortfall Warning
  if (cashFlowForecast.negativeCashDates && cashFlowForecast.negativeCashDates.length > 0) {
    const firstNegDate = cashFlowForecast.negativeCashDates[0];
    const peakDeficit = Math.abs(cashFlowForecast.minProjectedBalance);

    notifications.push({
      id: 'alert-cash-deficit-30d',
      type: 'negative_balance',
      severity: 'critical',
      requiresAction: true,
      title: 'Action Needed: Bank Balance Running Short This Month',
      message: `Upcoming bills and dues exceed your current bank cash starting ${firstNegDate} by ${formatMoney(
        peakDeficit,
        baseCurr,
        currSym
      )}. Pause extra prepayments until fresh cash lands in your account.`,
      actionLabel: 'Check Cash Flow',
      actionTab: 'insights',
      timestamp: todayStr,
    });
  }

  // 4. Goal Ready Celebration
  for (const g of goals) {
    if (!g.isCompleted && g.cost > 0) {
      const accum = g.accumulatedTotal || 0;
      if (accum >= g.cost && !g.completionNotified) {
        notifications.push({
          id: `goal-ready-${g.id}`,
          type: 'goal_ready',
          severity: 'info',
          requiresAction: false,
          title: `Goal Reached: ${g.name}`,
          message: `Well done! You have saved the full ${formatMoney(
            accum,
            g.currency,
            currSym
          )} for "${g.name}". You can complete the payment whenever you're ready.`,
          actionLabel: 'Open Goals',
          actionTab: 'home',
          actionModal: 'goals',
          timestamp: todayStr,
        });
      }
    }
  }

  // 5. Positive Milestones — Tell User When They Did Something Good
  const creditCards = liabilities.filter(
    (l) => l.kind === 'card' && (l.cardType === 'credit' || !l.cardType)
  );
  if (creditCards.length > 0) {
    const highUtilCards = creditCards.filter((c) => {
      const limit = c.creditLimit || c.limit || 0;
      return limit > 0 && (c.outstanding || 0) / limit > 0.3;
    });
    if (highUtilCards.length === 0) {
      notifications.push({
        id: 'praise-card-discipline',
        type: 'positive_milestone',
        severity: 'info',
        requiresAction: false,
        title: 'Nice Move: Credit Card Usage Under 30%',
        message:
          'You kept all credit card balances comfortably low. That keeps your credit score strong and protects you from interest charges.',
        actionLabel: 'View Cards',
        actionTab: 'liabilities',
        timestamp: todayStr,
      });
    }
  }

  const paidOffLoansCount = liabilities.filter(
    (l) => l.kind === 'loan' && (l.outstanding || 0) <= 0
  ).length;
  if (paidOffLoansCount > 0) {
    notifications.push({
      id: `praise-loans-cleared-${paidOffLoansCount}`,
      type: 'positive_milestone',
      severity: 'info',
      requiresAction: false,
      title: `Milestone: ${paidOffLoansCount} Loan${paidOffLoansCount > 1 ? 's' : ''} Paid Off in Full`,
      message:
        'Cleared loans have been archived out of your active bills and kept safely in your backup files.',
      actionLabel: 'View Liabilities',
      actionTab: 'liabilities',
      timestamp: todayStr,
    });
  }

  const counterpartyNames = Array.from(
    new Set(receivables.map((r) => (r.debtorName || '').trim()).filter(Boolean))
  );
  for (const name of counterpartyNames) {
    const personRecords = receivables.filter(
      (r) => (r.debtorName || '').trim().toLowerCase() === name.toLowerCase()
    );
    const anyActive = personRecords.some((r) => isActiveCounterpartyRecord(r));
    const anyCollected = personRecords.some((r) => r.status === 'collected');
    if (!anyActive && anyCollected) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      notifications.push({
        id: `praise-settled-${slug}`,
        type: 'positive_milestone',
        severity: 'info',
        requiresAction: false,
        title: `All Squared Up with ${name}`,
        message: `Your shared bills and personal balances with ${name} are completely settled at zero and archived cleanly.`,
        timestamp: todayStr,
      });
    }
  }

  // 6. Overdue Peer Balances
  for (const rec of receivables) {
    if (
      isActiveCounterpartyRecord(rec) &&
      rec.expectedDate &&
      rec.expectedDate < todayStr
    ) {
      const isBorrowed = rec.direction === 'borrowed';
      notifications.push({
        id: `overdue-rec-${rec.id}`,
        type: 'overdue_receivable',
        severity: 'warning',
        requiresAction: true,
        title: isBorrowed
          ? `Reminder: Payment Due to ${rec.debtorName}`
          : `Follow Up: ${rec.debtorName} Balance Past Expected Date`,
        message: isBorrowed
          ? `You still owe ${rec.debtorName} ${formatMoney(
              rec.outstandingAmount,
              rec.currency,
              currSym
            )} (expected ${rec.expectedDate}). Pay them back or cover one of their bills to clear this.`
          : `${rec.debtorName} owes you ${formatMoney(
              rec.outstandingAmount,
              rec.currency,
              currSym
            )} (expected ${rec.expectedDate}). Record a collection or let them cover a bill to offset it.`,
        actionLabel: 'Settle Balance',
        actionTab: 'assets',
        timestamp: todayStr,
      });
    }
  }

  return notifications;
}

export function generateCentralizedNotifications(
  cashFlowForecast: CashFlowForecastResult,
  holdings: Holding[],
  liabilities: Liability[],
  bills: Bill[],
  incomeStreams: IncomeStream[],
  receivables: Receivable[],
  scheduledTransfers: ScheduledTransfer[],
  rlRecommendations: RLMovementRecommendation[],
  goals: Goal[],
  currencies: Record<string, Currency>,
  settings: AppSettings,
  options: ConflictDetectionOptions = {}
): FinancialNotification[] {
  const list = detectObligationConflicts(
    cashFlowForecast,
    holdings,
    liabilities,
    bills,
    incomeStreams,
    receivables,
    scheduledTransfers,
    rlRecommendations,
    goals,
    currencies,
    settings,
    options
  );

  const severityRank: Record<string, number> = {
    critical: 1,
    warning: 2,
    info: 3,
  };

  return list.sort((a, b) => (severityRank[a.severity] || 3) - (severityRank[b.severity] || 3));
}
