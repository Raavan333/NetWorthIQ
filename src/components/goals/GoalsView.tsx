import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Goal, GoalSource, GoalPriority } from '../../types';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { DatePickerField } from '../common/DatePickerField';
import { LoanKillerCalculator } from './LoanKillerCalculator';
import { ConfirmGoalPaymentModal } from './ConfirmGoalPaymentModal';
import {
  Target,
  Plus,
  Trash2,
  Edit2,
  Clock,
  CheckCircle2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
  Repeat,
  Banknote,
  Download,
  Landmark,
  Calendar,
  Layers,
  Coins,
  Lock,
} from 'lucide-react';
import { downloadFile } from '../../lib/downloadHelper';
import { ExportDownloadModal } from '../common/ExportDownloadModal';
import {
  isSpendableLiquidHolding,
  isPositiveLiquidHolding,
  isFixedOrRecurringDeposit,
  getSafeAssetName,
  getSafeLiabilityName,
  resolveAssetTypeLabel,
  formatAssetOptionLabel,
} from '../../lib/assetRules';

export const GoalsView: React.FC = () => {
  const {
    goals,
    holdings,
    liabilities,
    assetTypes,
    currencies,
    addGoal,
    updateGoal,
    deleteGoal,
    settings,
    goalLiquidPlan,
    predictedBills,
  } = useApp();

  const [isAddGoalOpen, setIsAddGoalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [goalForPayment, setGoalForPayment] = useState<Goal | null>(null);
  const [forecastWindow, setForecastWindow] = useState<'monthly_avg' | '3m' | '6m' | '12m'>('monthly_avg');
  const [downloadModal, setDownloadModal] = useState<{
    isOpen: boolean;
    title: string;
    filename: string;
    content: string;
    mimeType: string;
  } | null>(null);

  // Form states
  const [goalType, setGoalType] = useState<'asset_accumulation' | 'debt_payoff'>('asset_accumulation');
  const [priority, setPriority] = useState<GoalPriority>('mid');
  const [targetLiabilityId, setTargetLiabilityId] = useState('');
  const [startingDebtAmount, setStartingDebtAmount] = useState('');
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [currency, setCurrency] = useState(settings.baseCurrency || 'INR');
  const [deadline, setDeadline] = useState('');
  const [selectedSources, setSelectedSources] = useState<GoalSource[]>([]);
  const [extraMonthlyPayment, setExtraMonthlyPayment] = useState<number>(0);
  const [monthlyContribution, setMonthlyContribution] = useState<string>('');
  const [contributionFrequency, setContributionFrequency] = useState<'monthly' | 'biweekly' | 'weekly' | 'quarterly'>('monthly');
  const [contributionSourceId, setContributionSourceId] = useState<string>('');
  const [accumulateMonthly, setAccumulateMonthly] = useState<boolean>(true);
  const [syncToBills, setSyncToBills] = useState<boolean>(true);
  const [error, setError] = useState('');

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Liquid bank/cash accounts for default contribution fallback
  const bankHoldings = holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes));
  const positiveLiquidHoldings = holdings.filter((h) => isPositiveLiquidHolding(h, assetTypes));

  // All assets available to be set under goals: FDs, Stocks, Mutual Funds, Bank Accounts, Gold, etc.
  const allGoalFundingSources = holdings.map((h) => {
    const val = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    const unitPrice = h.currentPrice || (h.units && h.units > 0 ? val / h.units : undefined);
    const hasUnits = (h.units !== undefined && h.units > 0) || (h.typeId || '').includes('stock') || (h.typeId || '').includes('mf');
    const isBank = isSpendableLiquidHolding(h, assetTypes);
    const isFd = isFixedOrRecurringDeposit(h, assetTypes);
    const isStock = (h.typeId || '').includes('stock') || (h.typeId || '').includes('mf') || Boolean(h.units);
    const category = (assetTypes?.find((t) => t.id === h.typeId)?.category) || h.customCategory || (isBank ? 'Liquid Cash & Banking' : isFd ? 'Fixed Income & Term Deposits' : isStock ? 'Equities & Market Investments' : 'Other Assets');
    return {
      id: h.id,
      name: getSafeAssetName(h, assetTypes),
      currency: h.currency,
      isCard: false,
      isBank,
      isFd,
      isStock,
      hasUnits,
      units: h.units,
      unitPrice,
      category,
      typeLabel: resolveAssetTypeLabel(h, assetTypes),
      availableVal: val,
    };
  });

  const handleOpenAdd = (goal?: Goal) => {
    const validAssetIds = new Set(holdings.map((h) => h.id));
    const defaultSourceId = positiveLiquidHoldings[0]?.id || bankHoldings[0]?.id || holdings[0]?.id || '';
    if (goal) {
      setEditingGoal(goal);
      setGoalType(goal.goalType || 'asset_accumulation');
      setPriority(goal.priority || 'mid');
      setTargetLiabilityId(goal.targetLiabilityId || '');
      setStartingDebtAmount(goal.startingDebtAmount?.toString() || goal.cost.toString());
      setName(goal.name);
      setCost(goal.cost.toString());
      setCurrency(goal.currency);
      setDeadline(goal.deadline || '');
      // Retain all valid asset sources (FDs, stocks, bank accounts)
      const sanitizedSources = (goal.sources || []).filter(
        (s) => s.sourceType !== 'credit_card' && validAssetIds.has(s.sourceId)
      );
      setSelectedSources(sanitizedSources);
      setExtraMonthlyPayment(goal.extraMonthlyPayment || 0);
      setMonthlyContribution(goal.monthlyContribution?.toString() || '');
      setContributionFrequency(goal.contributionFrequency || 'monthly');
      setContributionSourceId(
        goal.contributionSourceId && validAssetIds.has(goal.contributionSourceId)
          ? goal.contributionSourceId
          : defaultSourceId
      );
      const isMonthly = goal.accumulateMonthly !== false && goal.syncToBills !== false;
      setAccumulateMonthly(isMonthly);
      setSyncToBills(isMonthly);
    } else {
      setEditingGoal(null);
      setGoalType('asset_accumulation');
      setPriority('mid');
      setTargetLiabilityId('');
      setStartingDebtAmount('');
      setName('');
      setCost('');
      setCurrency(settings.baseCurrency || 'INR');
      setDeadline('');
      setSelectedSources(
        holdings.length > 0
          ? [{ sourceId: holdings[0].id, sourceType: 'asset', allocationMode: 'percentage', allocationPct: 20 }]
          : []
      );
      setExtraMonthlyPayment(0);
      setMonthlyContribution('');
      setContributionFrequency('monthly');
      setContributionSourceId(defaultSourceId);
      setAccumulateMonthly(true);
      setSyncToBills(true);
    }
    setError('');
    setIsAddGoalOpen(true);
  };

  const handleTargetLiabilityChange = (liabilityId: string) => {
    setTargetLiabilityId(liabilityId);
    const liab = liabilities.find((l) => l.id === liabilityId);
    if (liab) {
      const liabName = getSafeLiabilityName(liab);
      if (!name || name.startsWith('Kill ') || name.startsWith('Pay Off ')) {
        setName(`Pay Off ${liabName}`);
      }
      setCost(liab.outstanding.toString());
      setStartingDebtAmount(liab.outstanding.toString());
      setCurrency(liab.currency);
      if (liab.monthlyEmi && liab.monthlyEmi > 0) {
        setMonthlyContribution(liab.monthlyEmi.toString());
      }
    }
  };

  const getSourceVal = (sourceId: string) => {
    const h = holdings.find((x) => x.id === sourceId);
    if (h) return (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    return 0;
  };

  const handleSourceAllocationModeToggle = (
    sourceId: string,
    newMode: 'percentage' | 'fixed_amount' | 'units'
  ) => {
    const h = holdings.find((x) => x.id === sourceId);
    if (!h) return;
    const assetVal = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    const unitPrice = h.currentPrice || (h.units && h.units > 0 ? assetVal / h.units : 1);

    setSelectedSources((prev) => {
      const exists = prev.find((s) => s.sourceId === sourceId);
      if (!exists) {
        let initialAmount = Math.round(assetVal * 0.5);
        let initialUnits = h.units ? Math.max(1, Math.round(h.units * 0.5)) : 1;
        let initialPct = 50;
        if (newMode === 'units') {
          initialAmount = initialUnits * unitPrice;
        }
        return [
          ...prev,
          {
            sourceId,
            sourceType: 'asset',
            allocationMode: newMode,
            allocationPct: initialPct,
            allocationAmount: initialAmount,
            allocationUnits: newMode === 'units' ? initialUnits : undefined,
            unitPriceAtAllocation: unitPrice,
            paymentMode: 'upi',
            atmZone: 'non_metro',
          },
        ];
      }

      return prev.map((s) => {
        if (s.sourceId !== sourceId) return s;
        if (newMode === 'units') {
          const currentVal = s.allocationAmount || (assetVal * (s.allocationPct || 50)) / 100;
          const u = Math.max(1, Math.min(h.units || 99999, Math.round(currentVal / unitPrice)));
          return {
            ...s,
            sourceType: 'asset',
            allocationMode: 'units',
            allocationUnits: u,
            allocationAmount: u * unitPrice,
            unitPriceAtAllocation: unitPrice,
            allocationPct: assetVal > 0 ? Math.min(100, Math.round(((u * unitPrice) / assetVal) * 100)) : 50,
          };
        } else if (newMode === 'percentage') {
          let pct = 50;
          if (s.allocationMode === 'units' && s.allocationUnits) {
            pct = assetVal > 0 ? Math.min(100, Math.round(((s.allocationUnits * unitPrice) / assetVal) * 100)) : 50;
          } else if (s.allocationAmount) {
            pct = assetVal > 0 ? Math.min(100, Math.round((s.allocationAmount / assetVal) * 100)) : 50;
          }
          return {
            ...s,
            sourceType: 'asset',
            allocationMode: 'percentage',
            allocationPct: pct,
            allocationAmount: Math.round(assetVal * (pct / 100)),
          };
        } else {
          // fixed_amount (per value)
          let amt = Math.round(assetVal * 0.5);
          if (s.allocationMode === 'units' && s.allocationUnits) {
            amt = Math.min(assetVal, s.allocationUnits * unitPrice);
          } else if (s.allocationPct) {
            amt = Math.min(assetVal, Math.round(assetVal * (s.allocationPct / 100)));
          }
          return {
            ...s,
            sourceType: 'asset',
            allocationMode: 'fixed_amount',
            allocationAmount: amt,
            monthlyIncrement: amt,
            allocationPct: assetVal > 0 ? Math.min(100, Math.round((amt / assetVal) * 100)) : 50,
          };
        }
      });
    });
  };

  const handleSourceUnitsChange = (sourceId: string, unitsCount: number) => {
    const h = holdings.find((x) => x.id === sourceId);
    if (!h) return;
    const assetVal = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    const unitPrice = h.currentPrice || (h.units && h.units > 0 ? assetVal / h.units : 1);
    const safeUnits = Math.max(0, unitsCount);
    const amt = Math.min(assetVal, safeUnits * unitPrice);

    setSelectedSources((prev) => {
      const exists = prev.find((s) => s.sourceId === sourceId);
      if (exists) {
        if (safeUnits <= 0) return prev.filter((s) => s.sourceId !== sourceId);
        return prev.map((s) =>
          s.sourceId === sourceId
            ? {
                ...s,
                sourceType: 'asset',
                allocationMode: 'units',
                allocationUnits: safeUnits,
                allocationAmount: amt,
                unitPriceAtAllocation: unitPrice,
                allocationPct: assetVal > 0 ? Math.min(100, (amt / assetVal) * 100) : 0,
              }
            : s
        );
      } else {
        if (safeUnits <= 0) return prev;
        return [
          ...prev,
          {
            sourceId,
            sourceType: 'asset',
            allocationMode: 'units',
            allocationUnits: safeUnits,
            allocationAmount: amt,
            unitPriceAtAllocation: unitPrice,
            allocationPct: assetVal > 0 ? Math.min(100, (amt / assetVal) * 100) : 0,
            paymentMode: 'upi',
            atmZone: 'non_metro',
          },
        ];
      }
    });
  };

  const handleSourceValueChange = (sourceId: string, val: number) => {
    const h = holdings.find((x) => x.id === sourceId);
    if (!h) return;
    const assetVal = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    const unitPrice = h.currentPrice || (h.units && h.units > 0 ? assetVal / h.units : 1);

    setSelectedSources((prev) => {
      const exists = prev.find((s) => s.sourceId === sourceId);
      if (exists) {
        if (val <= 0) return prev.filter((s) => s.sourceId !== sourceId);
        if (exists.allocationMode === 'fixed_amount') {
          const pct = assetVal > 0 ? (val / assetVal) * 100 : 0;
          return prev.map((s) =>
            s.sourceId === sourceId
              ? { ...s, sourceType: 'asset', allocationAmount: val, monthlyIncrement: val, allocationPct: pct }
              : s
          );
        } else if (exists.allocationMode === 'units') {
          const amt = Math.min(assetVal, val * unitPrice);
          return prev.map((s) =>
            s.sourceId === sourceId
              ? {
                  ...s,
                  sourceType: 'asset',
                  allocationUnits: val,
                  allocationAmount: amt,
                  unitPriceAtAllocation: unitPrice,
                  allocationPct: assetVal > 0 ? Math.min(100, (amt / assetVal) * 100) : 0,
                }
              : s
          );
        } else {
          // percentage
          const amt = Math.round(assetVal * (val / 100));
          return prev.map((s) =>
            s.sourceId === sourceId
              ? { ...s, sourceType: 'asset', allocationPct: val, allocationAmount: amt }
              : s
          );
        }
      } else {
        return [
          ...prev,
          {
            sourceId,
            sourceType: 'asset',
            allocationMode: 'percentage',
            allocationPct: val,
            allocationAmount: Math.round(assetVal * (val / 100)),
            paymentMode: 'upi',
            atmZone: 'non_metro',
          },
        ];
      }
    });
  };

  const handleSourceMonthlyIncrementChange = (sourceId: string, val: number) => {
    const h = holdings.find((x) => x.id === sourceId);
    if (!h) return;
    const assetVal = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);

    setSelectedSources((prev) => {
      const exists = prev.find((s) => s.sourceId === sourceId);
      if (exists) {
        return prev.map((s) =>
          s.sourceId === sourceId
            ? { ...s, sourceType: 'asset', monthlyIncrement: val, allocationAmount: val || s.allocationAmount }
            : s
        );
      } else {
        return [
          ...prev,
          {
            sourceId,
            sourceType: 'asset',
            allocationMode: 'fixed_amount',
            allocationPct: assetVal > 0 ? (val / assetVal) * 100 : 0,
            allocationAmount: val,
            monthlyIncrement: val,
            paymentMode: 'upi',
            atmZone: 'non_metro',
          },
        ];
      }
    });
  };

  const handleSourcePaymentModeChange = (
    sourceId: string,
    mode: 'upi' | 'debit_card' | 'neft' | 'imps'
  ) => {
    setSelectedSources((prev) =>
      prev.map((s) =>
        s.sourceId === sourceId
          ? { ...s, paymentMode: mode, atmZone: s.atmZone || 'non_metro' }
          : s
      )
    );
  };

  const handleSourceAtmZoneChange = (sourceId: string, zone: 'metro' | 'non_metro') => {
    setSelectedSources((prev) =>
      prev.map((s) => (s.sourceId === sourceId ? { ...s, atmZone: zone } : s))
    );
  };

  const handleDownloadGoalRecord = (goal: Goal) => {
    const headers = ['Goal Name', 'Target Cost', 'Currency', 'Accumulated Total', 'Status', 'Completed Date', 'Payment Tx ID'];
    const summaryRow = [
      goal.name,
      goal.cost,
      goal.currency,
      goal.accumulatedTotal ?? goal.cost,
      'Completed & Ledger Verified',
      goal.completedAt || '',
      goal.paymentTxId || '',
    ];

    const txHeaders = ['Transaction Date', 'Amount', 'Currency', 'Source Asset', 'Ledger Reference', 'Notes'];
    const txRows = (goal.transactions || []).map((t) => [
      t.date,
      t.amount,
      goal.currency,
      t.sourceAssetName,
      t.ledgerTxId || '',
      t.notes || '',
    ]);

    const csv = [
      headers.join(','),
      summaryRow.map((c) => `"${c}"`).join(','),
      '',
      '### CONTRIBUTIONS & PAYMENTS HISTORY',
      txHeaders.join(','),
      ...txRows.map((r) => r.map((c) => `"${c}"`).join(',')),
    ].join('\n');

    const filename = `goal_${goal.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_history.csv`;
    downloadFile(filename, csv, 'text/csv');
    setDownloadModal({
      isOpen: true,
      title: `Goal History: ${goal.name}`,
      filename,
      content: csv,
      mimeType: 'text/csv',
    });
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Goal name is required');
      return;
    }
    const costNum = parseFloat(cost);
    if (isNaN(costNum) || costNum <= 0) {
      setError('Please provide a valid target amount');
      return;
    }

    if (goalType === 'debt_payoff' && !targetLiabilityId) {
      setError('Please select the specific loan or card liability to pay off');
      return;
    }

    const baselineDebtNum = parseFloat(startingDebtAmount) || costNum;
    const monthlyContribNum = accumulateMonthly ? (parseFloat(monthlyContribution) || 0) : 0;
    const validAssetIds = new Set(holdings.map((h) => h.id));

    const finalSources = selectedSources
      .filter((s) => s.sourceType !== 'credit_card' && validAssetIds.has(s.sourceId))
      .map((s) => {
        let inc = accumulateMonthly ? s.monthlyIncrement : undefined;
        if (accumulateMonthly && !inc && monthlyContribNum > 0 && s.allocationPct) {
          inc = Math.round((monthlyContribNum * s.allocationPct) / 100);
        }
        return {
          ...s,
          sourceType: 'asset' as const,
          monthlyIncrement: inc,
        };
      });

    const goalData: Goal = {
      ...(editingGoal || {}),
      id: editingGoal?.id || `goal-${Date.now()}`,
      name: name.trim(),
      cost: costNum,
      currency,
      deadline: deadline || undefined,
      sources: finalSources,
      goalType,
      targetLiabilityId: goalType === 'debt_payoff' ? targetLiabilityId : undefined,
      startingDebtAmount: goalType === 'debt_payoff' ? baselineDebtNum : undefined,
      priority,
      extraMonthlyPayment: extraMonthlyPayment > 0 ? extraMonthlyPayment : undefined,
      monthlyContribution: accumulateMonthly && monthlyContribNum > 0 ? monthlyContribNum : undefined,
      contributionFrequency,
      contributionSourceId: accumulateMonthly && contributionSourceId ? contributionSourceId : undefined,
      accumulateMonthly,
      syncToBills: accumulateMonthly ? syncToBills : false,
      accumulatedTotal: editingGoal?.accumulatedTotal ?? 0,
      transactions: editingGoal?.transactions ?? [],
      isCompleted: editingGoal?.isCompleted ?? false,
    };

    if (editingGoal) {
      await updateGoal(goalData);
    } else {
      await addGoal(goalData);
    }
    setIsAddGoalOpen(false);
  };

  // One-time notification for 100% completed goal per user requirement
  // "when it reaches 100% i should be immediately notified that amount is ready to be used for whatever purpose defined by user.
  // and after completion of goals user should be informed only once and after the payment he should not be informed again."
  const unnotifiedGoal = goals.find(
    (g) =>
      ((g.cost > 0 && (g.accumulatedTotal || 0) >= g.cost) || g.isCompleted) &&
      !g.completionNotified &&
      !g.paymentVerified
  );

  const handleDismissCompletionNotice = async (goalId: string) => {
    const g = goals.find((x) => x.id === goalId);
    if (!g) return;
    const updated: Goal = { ...g, completionNotified: true };
    await updateGoal(updated);
  };

  // Active goals only — settled goals and zero-balance debt goals stay archived out of sight in frontend (preserved in exported files)
  const activeGoals = goals.filter((g) => {
    if (g.isCompleted || g.paymentVerified) return false;
    if (g.goalType === 'debt_payoff' && g.targetLiabilityId) {
      const targetLiab = liabilities.find((l) => l.id === g.targetLiabilityId);
      if (!targetLiab || (targetLiab.outstanding || 0) <= 0) return false;
    }
    return true;
  });

  // Aggregated Overall Goals Statistics (Active Goals)
  let totalTargetCost = 0;
  let totalFundedOrKilled = 0;
  let completedGoalsCount = 0;

  // Track remaining source balances across goals to prevent double-allocation of same holding capital
  const remainingHoldingBalances: Record<string, number> = {};
  for (const h of holdings) {
    const val = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
    remainingHoldingBalances[h.id] = val;
  }

  const goalCalculations = activeGoals.map((g) => {
    const isDebtGoal = g.goalType === 'debt_payoff';
    const matchedLiab = isDebtGoal && g.targetLiabilityId ? liabilities.find((l) => l.id === g.targetLiabilityId) : undefined;
    const targetRequired = isDebtGoal
      ? (g.startingDebtAmount || (matchedLiab ? matchedLiab.outstanding : g.cost) || g.cost)
      : g.cost;

    // 1. Calculate Allocated Eligible Funds (Backing Capital across non-credit assets)
    let allocatedEligibleFunds = g.accumulatedTotal || 0;
    for (const src of g.sources || []) {
      if (src.sourceType === 'credit_card') continue;
      const h = holdings.find((x) => x.id === src.sourceId);
      if (h) {
        const val = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
        const unitPrice = h.currentPrice || (h.units && h.units > 0 ? val / h.units : src.unitPriceAtAllocation || 1);
        const availInHolding = remainingHoldingBalances[h.id] !== undefined ? remainingHoldingBalances[h.id] : val;

        let requested = 0;
        if (src.allocationMode === 'units' && src.allocationUnits !== undefined && src.allocationUnits > 0) {
          requested = Math.min(val, src.allocationUnits * unitPrice);
        } else if (src.allocationMode === 'fixed_amount' && src.allocationAmount !== undefined && src.allocationAmount > 0) {
          requested = Math.min(val, src.allocationAmount);
        } else if (src.allocationPct && src.allocationPct > 0) {
          requested = val * ((src.allocationPct || 0) / 100);
        }

        const allocatedFromSource = Math.min(availInHolding, requested);
        if (allocatedFromSource > 0) {
          allocatedEligibleFunds += allocatedFromSource;
          // Deduct from pool so subsequent goals cannot double-allocate the same holding balance
          remainingHoldingBalances[h.id] = Math.max(0, availInHolding - allocatedFromSource);
        }
      }
    }

    const fundingPct = targetRequired > 0 ? Math.min(100, Math.max(0, (allocatedEligibleFunds / targetRequired) * 100)) : 0;

    // 2. Calculate Settlement Progress (Confirmed Repayments / Execution Status)
    const startingDebt = g.startingDebtAmount || g.cost;
    const currentOutstanding = matchedLiab ? matchedLiab.outstanding : 0;
    const debtKilled = Math.max(0, startingDebt - currentOutstanding);
    const confirmedSettled = isDebtGoal
      ? Math.min(startingDebt, debtKilled + (g.accumulatedTotal || 0))
      : (g.accumulatedTotal || 0);
    const settlementPct = targetRequired > 0 ? Math.min(100, Math.max(0, (confirmedSettled / targetRequired) * 100)) : 0;

    const isReadyToRepay = fundingPct >= 99.9 && settlementPct < 99.9;
    const isCompleted = settlementPct >= 99.9 || Boolean(g.isCompleted);
    const remaining = Math.max(0, targetRequired - confirmedSettled);

    if (isDebtGoal) {
      totalTargetCost += startingDebt;
      totalFundedOrKilled += debtKilled;
    } else {
      totalTargetCost += g.cost;
      totalFundedOrKilled += confirmedSettled;
    }

    if (isCompleted) {
      completedGoalsCount++;
    }

    let monthsLeft = 12;
    let reqMonthly = remaining / 12;
    if (g.deadline) {
      const dTime = new Date(g.deadline).getTime();
      const nowTime = Date.now();
      monthsLeft = Math.max(1, Math.ceil((dTime - nowTime) / (1000 * 60 * 60 * 24 * 30.4)));
      reqMonthly = remaining / monthsLeft;
    }

    return {
      goal: g,
      isDebtGoal,
      matchedLiab,
      funded: allocatedEligibleFunds,
      debtKilled,
      startingDebt,
      currentOutstanding,
      pct: settlementPct,
      fundingPct,
      settlementPct,
      isReadyToRepay,
      targetRequired,
      remaining,
      isCompleted,
      monthsLeft,
      reqMonthly,
    };
  });

  const overallTotalPercentage =
    totalTargetCost > 0 ? Math.min(100, (totalFundedOrKilled / totalTargetCost) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Financial Goals
          </h2>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            Active targets &amp; linked debt payoffs · {activeGoals.length} active
          </p>
        </div>

        <button
          onClick={() => handleOpenAdd()}
          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
        >
          <Plus size={15} />
          <span>New Goal</span>
        </button>
      </div>

      {/* 100% Goal Completion One-Time Notification Banner */}
      {unnotifiedGoal && (
        <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/40 shadow-lg space-y-3 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">
                  Goal Target Reached
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  <strong className="text-white font-semibold">{unnotifiedGoal.name}</strong> has reached its target of {formatMoney(unnotifiedGoal.cost, unnotifiedGoal.currency)}.
                </p>
              </div>
            </div>
            <button
              onClick={() => handleDismissCompletionNotice(unnotifiedGoal.id)}
              className="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer transition-colors shrink-0"
            >
              Dismiss
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs">
            <span className="text-[11px] text-slate-400">
              Confirm payment to deduct from linked liquid accounts and clear this goal.
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleDismissCompletionNotice(unnotifiedGoal.id)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer text-xs"
              >
                Keep in Reserve
              </button>
              <button
                onClick={() => {
                  handleDismissCompletionNotice(unnotifiedGoal.id);
                  setGoalForPayment(unnotifiedGoal);
                }}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/20"
              >
                <Banknote size={14} />
                <span>Confirm Payment</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Net Liquid Surplus & Goal Readiness Ledger Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
              <span>Net Allocatable Liquid Surplus</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Verified positive bank &amp; hand cash minus safety buffer and current-month bills. Future salary, credit limits, and locked assets excluded.
            </p>
          </div>
          <div className="text-right font-mono tabular-nums shrink-0">
            <span className="text-[11px] text-slate-400 font-sans block">Available for Goals</span>
            <span className="text-lg font-bold text-emerald-400">
              {formatMoney(goalLiquidPlan.netLiquidSurplusBase, baseCurr, currSym)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800 text-xs font-mono tabular-nums">
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Positive Liquid Cash</span>
            <span className="font-semibold text-slate-100 mt-0.5 block">
              {formatMoney(goalLiquidPlan.grossPositiveLiquidBase, baseCurr, currSym)}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Less Safety Buffer</span>
            <span className="font-semibold text-amber-300 mt-0.5 block">
              -{formatMoney(goalLiquidPlan.safetyBufferBase, baseCurr, currSym)}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">Less Unpaid Bills</span>
            <span className="font-semibold text-rose-300 mt-0.5 block">
              -{formatMoney(goalLiquidPlan.unpaidRecurringBillsBase, baseCurr, currSym)}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
            <span className="text-[10px] text-slate-400 uppercase font-sans block">
              Less ML Predicted Bills ({predictedBills.items.length})
            </span>
            <span className="font-semibold text-cyan-300 mt-0.5 block">
              -{formatMoney(goalLiquidPlan.predictedPossibleBillsBase, baseCurr, currSym)}
            </span>
          </div>
        </div>
      </div>

      {/* Total Aggregate Completion Card */}
      {activeGoals.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center font-bold">
                <Target size={18} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">
                  Active Goals Progress
                </h4>
                <p className="text-[11px] text-slate-400">
                  {overallTotalPercentage.toFixed(1)}% of active target capital settled in ledger
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs text-slate-400 font-sans block">Settled Capital</span>
              <span className="text-sm font-bold font-mono tabular-nums text-emerald-400">
                {formatMoney(totalFundedOrKilled, baseCurr, currSym)} / {formatMoney(totalTargetCost, baseCurr, currSym)}
              </span>
            </div>
          </div>

          <div className="relative w-full h-2.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${overallTotalPercentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Forecast Window Bar */}
      <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
        <span className="text-slate-400">Forecast Runway Window:</span>
        <select
          value={forecastWindow}
          onChange={(e) => setForecastWindow(e.target.value as any)}
          className="bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-100 font-medium"
        >
          <option value="monthly_avg">Monthly Average (Default)</option>
          <option value="3m">Last 3 Months Trend</option>
          <option value="6m">Last 6 Months Trend</option>
          <option value="12m">Last 12 Months Trend</option>
        </select>
      </div>

      {/* Goals Cards */}
      {activeGoals.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
          No active goals right now. Settled goals are archived and preserved in your exported files.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goalCalculations.map(({
            goal: g,
            isDebtGoal,
            matchedLiab,
            funded,
            debtKilled,
            startingDebt,
            currentOutstanding,
            pct,
            fundingPct,
            settlementPct,
            isReadyToRepay,
            targetRequired,
            remaining,
            isCompleted,
            monthsLeft,
            reqMonthly,
          }) => {
            const assessment = goalLiquidPlan.assessmentsByGoalId[g.id];
            const goalCurrSymbol = currencies.find((c) => c.code === g.currency)?.symbol || g.currency;
            const surplusPct = assessment ? assessment.achievableFromSurplusPct : 0;
            const combinedPct = assessment ? assessment.combinedReadinessPct : fundingPct;

            return (
              <div
                key={g.id}
                className={`p-4 rounded-2xl border transition-all shadow-sm space-y-3.5 relative overflow-hidden ${
                  isCompleted
                    ? 'bg-slate-900 border-emerald-500/40'
                    : isDebtGoal
                    ? 'bg-slate-900 border-rose-500/30 hover:border-rose-500/50'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header with Clean Unboxed Typographic Metadata */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-wrap mb-1">
                      <span className={isDebtGoal ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
                        {isDebtGoal ? 'Debt Payoff' : 'Capital Accumulation'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {g.priority === 'high'
                          ? 'High Priority'
                          : g.priority === 'low'
                          ? 'Low Priority'
                          : 'Mid Priority'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {g.accumulateMonthly === false
                          ? 'Surplus Tracking Only'
                          : 'Monthly Accumulation'}
                      </span>
                      {matchedLiab && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{matchedLiab.ratePct}% p.a.</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white break-words">{g.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5 break-words">
                      {isDebtGoal
                        ? matchedLiab
                          ? `Target liability: ${getSafeLiabilityName(matchedLiab)} (${matchedLiab.currency})`
                          : 'Target Debt Payoff'
                        : g.accumulateMonthly === false
                        ? 'Evaluated against net liquid cash surplus (no monthly recurring bill)'
                        : `${g.sources?.length || 0} linked liquid cash account${(g.sources?.length || 0) === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleOpenAdd(g)}
                      className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Edit Goal"
                    >
                      <Edit2 size={14} />
                    </button>
                    {g.transactions && g.transactions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDownloadGoalRecord(g)}
                        className="p-2 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition-colors cursor-pointer"
                        title="Export Goal Ledger CSV"
                      >
                        <Download size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => deleteGoal(g.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Delete Goal"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Separated Funding vs Settlement Progress Display */}
                <div className="space-y-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80">
                  <div className="flex items-center justify-between text-xs gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 font-medium">
                        Funding Backing:{' '}
                        <strong className="text-emerald-400 font-mono tabular-nums">
                          {fundingPct.toFixed(1)}%
                        </strong>
                      </span>
                      {fundingPct >= 99.9 && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                          100% Backed
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-slate-400 text-xs">
                        Settlement Progress:{' '}
                        <strong className="text-white font-mono tabular-nums">
                          {settlementPct.toFixed(1)}%
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Dual Segment Progress Bars: Funding vs Settlement */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Funded Reserve: {formatMoney(funded, g.currency)}</span>
                      <span>Target: {formatMoney(targetRequired, g.currency)}</span>
                    </div>
                    <div className="relative w-full h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(0, fundingPct))}%` }}
                        title="Allocated eligible funding"
                      />
                    </div>
                  </div>

                  {/* Ready to Settle / Repay Banner */}
                  {isReadyToRepay && (
                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 text-emerald-300 font-semibold text-[11px]">
                        <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                        <span>Eligible funds allocated ({fundingPct.toFixed(0)}%). Ready to repay or settle in full!</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setGoalForPayment(g)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shrink-0 cursor-pointer flex items-center gap-1 shadow-sm"
                      >
                        <Banknote size={13} />
                        <span>Settle Now</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Progress Metrics Grid */}
                {isDebtGoal ? (
                  <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans block">Baseline Debt</span>
                      <div className="font-semibold text-slate-300 mt-0.5 text-xs truncate">
                        {formatMoney(startingDebt, g.currency)}
                      </div>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans block">Principal Retired</span>
                      <div className="font-bold text-emerald-400 mt-0.5 text-xs truncate">
                        {formatMoney(debtKilled, g.currency)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-sans block">Remaining Balance</span>
                      <div className="font-bold text-rose-400 mt-0.5 text-xs truncate">
                        {formatMoney(currentOutstanding, g.currency)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-sans block">Accumulated Capital</span>
                      <div className="text-sm font-bold text-emerald-400 mt-0.5">
                        {formatMoney(funded, g.currency)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-sans block">Target Amount</span>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {formatMoney(g.cost, g.currency)}
                      </div>
                    </div>
                  </div>
                )}

                {/* Suggested Positive Liquid Contributors & Mature ML Proximity Guidance */}
                {assessment && !isCompleted && (
                  <div className="p-3 rounded-xl bg-slate-950/85 border border-slate-800 space-y-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-slate-100 leading-snug">
                        {assessment.mlMotivationHeadline}
                      </span>
                      {assessment.estimatedMonthsToComplete !== null && assessment.estimatedMonthsToComplete > 0 && (
                        <span className="text-[11px] font-mono tabular-nums text-cyan-300 shrink-0">
                          Est. {assessment.estimatedMonthsToComplete} mo
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {assessment.mlMotivationBody}
                    </p>

                    {assessment.contributors.length > 0 && (
                      <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                          Suggested Liquid Cash Contributors (Advisory Only)
                        </div>
                        <p className="text-[11px] text-cyan-200/90 leading-relaxed">
                          {assessment.contributorSummaryText}
                        </p>
                        <div className="space-y-1 pt-0.5">
                          {assessment.contributors.map((c) => {
                            const cSym = currencies.find((cur) => cur.code === c.currency)?.symbol || c.currency;
                            return (
                              <div
                                key={c.assetId}
                                className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-300 bg-slate-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800/70"
                              >
                                <span className="font-sans font-medium text-slate-200 truncate">
                                  {c.assetName}
                                </span>
                                <span className="text-emerald-300 shrink-0">
                                  {formatMoney(c.suggestedAmountLocal, c.currency, cSym)} ({c.pctOfAsset.toFixed(1)}% of balance)
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Recurring Contribution Bill Stream (If Monthly Accumulation Active) */}
                {g.accumulateMonthly !== false && g.syncToBills !== false && g.monthlyContribution && g.monthlyContribution > 0 && (
                  <div className="p-2.5 rounded-xl bg-cyan-950/25 border border-cyan-500/20 text-xs flex items-center justify-between text-cyan-200">
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <Repeat size={12} className="text-cyan-400 shrink-0" />
                      <span>
                        Recurring Bill: {formatMoney(g.monthlyContribution, g.currency, goalCurrSymbol)}/{g.contributionFrequency || 'mo'}
                      </span>
                    </span>
                    <span className="text-[11px] text-cyan-400 font-medium">Synced to Bills</span>
                  </div>
                )}

                {/* Linked Assets & Funding Allocations (FDs, Stocks, Units, Fixed Amounts, Cash) */}
                {g.sources && g.sources.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                        <Layers size={12} className="text-cyan-400" />
                        <span>Linked Assets & Funding Allocations ({g.sources.length})</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Stock No · % · Per Value
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                      {g.sources.map((src) => {
                        const h = holdings.find((x) => x.id === src.sourceId);
                        if (!h) return null;
                        const isFd = isFixedOrRecurringDeposit(h, assetTypes);
                        const isStock = Boolean(h.units) || (h.typeId || '').includes('stock') || (h.typeId || '').includes('mf');
                        const hVal = (h.units && h.currentPrice) ? h.units * h.currentPrice : Math.max(0, h.principalOrValue || 0);
                        const unitPrice = h.currentPrice || (h.units && h.units > 0 ? hVal / h.units : src.unitPriceAtAllocation || 1);

                        let allocLabel = '';
                        let allocVal = 0;
                        if (src.allocationMode === 'units' && src.allocationUnits) {
                          allocVal = src.allocationUnits * unitPrice;
                          allocLabel = `${src.allocationUnits} units @ ${formatMoney(unitPrice, h.currency)} = ${formatMoney(allocVal, h.currency)}`;
                        } else if (src.allocationMode === 'fixed_amount' && src.allocationAmount) {
                          allocVal = src.allocationAmount;
                          allocLabel = `${formatMoney(src.allocationAmount, h.currency)} fixed`;
                        } else {
                          allocVal = hVal * ((src.allocationPct || 0) / 100);
                          allocLabel = `${src.allocationPct || 0}% (${formatMoney(allocVal, h.currency)})`;
                        }

                        return (
                          <div
                            key={src.sourceId}
                            className="flex items-center justify-between gap-1.5 p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isStock ? (
                                <TrendingUp size={12} className="text-indigo-400 shrink-0" />
                              ) : isFd ? (
                                <Lock size={12} className="text-amber-400 shrink-0" />
                              ) : (
                                <Landmark size={12} className="text-emerald-400 shrink-0" />
                              )}
                              <span className="font-medium text-slate-200 truncate">{getSafeAssetName(h, assetTypes)}</span>
                            </div>
                            <span className="font-mono tabular-nums text-slate-300 text-[10px] shrink-0 font-medium">
                              {allocLabel}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Partial Payments History & Next Due Notice */}
                {g.partialPaymentsHistory && g.partialPaymentsHistory.length > 0 && !isCompleted && (
                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1.5 text-xs font-mono tabular-nums">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span className="font-sans font-semibold text-cyan-300 flex items-center gap-1">
                        <Calendar size={12} />
                        <span>Installments Settled ({g.partialPaymentsHistory.length})</span>
                      </span>
                      <span className="text-emerald-400 font-bold">
                        {formatMoney(g.accumulatedTotal || 0, g.currency)} / {formatMoney(g.cost, g.currency)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-sans leading-relaxed">
                      {g.partialPaymentsHistory
                        .map((h, i) => `M${i + 1}: ${formatMoney(h.amount, g.currency)} (${h.percentage}%)`)
                        .join(' · ')}
                    </div>
                    {g.nextInstallmentDueMonth && (
                      <div className="text-[11px] text-slate-400 pt-0.5 font-sans flex items-center gap-1">
                        <Clock size={11} className="text-amber-400" />
                        <span>Next installment scheduled: <strong className="text-amber-300">{g.nextInstallmentDueMonth}</strong></span>
                      </div>
                    )}
                  </div>
                )}

                {/* Make Payment / Increment Button for Active In-Progress Goals */}
                {!isCompleted && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setGoalForPayment(g)}
                      className="flex-1 min-h-[40px] py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all border border-slate-700"
                    >
                      <Banknote size={14} className="text-cyan-400" />
                      <span>Record Installment</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGoalForPayment(g)}
                      className="min-h-[40px] py-2 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                    >
                      <span>Settle in Full</span>
                    </button>
                  </div>
                )}

                {/* 100% Completion Payment Action */}
                {isCompleted && (
                  <div className="p-3 rounded-xl bg-emerald-950/35 border border-emerald-500/40 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-300 font-bold flex items-center gap-1.5">
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        <span>Target Capital Ready to Settle</span>
                      </span>
                      <span className="text-xs text-emerald-400 font-mono tabular-nums font-bold">
                        {formatMoney(g.cost, g.currency)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">
                      Target reached. Confirm settlement to debit linked liquid cash and clear this goal.
                    </p>
                    <button
                      type="button"
                      onClick={() => setGoalForPayment(g)}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all whitespace-nowrap"
                    >
                      <Banknote size={14} />
                      <span>Settle &amp; Clear Goal</span>
                    </button>
                  </div>
                )}

                {/* Pace Forecast & Timeline */}
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                  <span className="flex items-center gap-1 font-mono tabular-nums">
                    <Clock size={12} />
                    {remaining <= 0
                      ? 'Target satisfied'
                      : `${monthsLeft} mo window (${formatMoney(reqMonthly, g.currency)}/mo required)`}
                  </span>
                  <span>{g.deadline ? `Due ${g.deadline}` : 'Open Timeline'}</span>
                </div>

                {/* Embedded Debt Payoff Strategy Preview if debt goal */}
                {isDebtGoal && matchedLiab && (
                  <div className="pt-2 border-t border-slate-800">
                    <LoanKillerCalculator
                      loan={matchedLiab}
                      currencySymbol={currSym}
                      initialExtraPayment={g.extraMonthlyPayment || 0}
                      onSetExtraPayment={async (extra, sync) => {
                        await updateGoal({
                          ...g,
                          extraMonthlyPayment: extra,
                          monthlyContribution: extra,
                          accumulateMonthly: sync,
                          syncToBills: sync,
                        });
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


      {/* Add / Edit Goal Modal */}
      {isAddGoalOpen && (
        <Modal
          isOpen={isAddGoalOpen}
          onClose={() => setIsAddGoalOpen(false)}
          title={
            editingGoal
              ? 'Edit Financial Goal'
              : goalType === 'debt_payoff'
              ? 'Establish Debt Payoff Strategy'
              : 'Create Financial Goal'
          }
          subtitle="Goals are funded strictly from positive unlocked liquid cash — credit limits and locked investments are excluded"
        >
          <form onSubmit={handleSaveGoal} className="space-y-4">
            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs">{error}</div>
            )}

            {/* Goal Type Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Goal Objective</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setGoalType('asset_accumulation');
                    setError('');
                  }}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    goalType === 'asset_accumulation'
                      ? 'border-emerald-500 bg-emerald-950/30 text-emerald-200 font-bold shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <Target size={14} className="text-emerald-400" />
                    <span>Capital Accumulation</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Emergency reserve, down payment, major purchase</div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setGoalType('debt_payoff');
                    setError('');
                    if (!targetLiabilityId && liabilities.length > 0) {
                      const firstDebt = liabilities.find((l) => l.outstanding > 0);
                      if (firstDebt) handleTargetLiabilityChange(firstDebt.id);
                    }
                  }}
                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                    goalType === 'debt_payoff'
                      ? 'border-rose-500 bg-rose-950/30 text-rose-200 font-bold shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs">
                    <TrendingDown size={14} className="text-rose-400" />
                    <span>Debt Payoff</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Accelerate principal reduction on loans</div>
                </button>
              </div>
            </div>

            {/* Debt Target Selection */}
            {goalType === 'debt_payoff' && (
              <div className="p-3.5 rounded-2xl bg-rose-950/20 border border-rose-500/30 space-y-3">
                <label className="block text-xs font-bold text-rose-300">
                  Target Liability to Pay Off
                </label>
                <select
                  value={targetLiabilityId}
                  onChange={(e) => handleTargetLiabilityChange(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                  required
                >
                  <option value="">-- Select Loan or Liability --</option>
                  {liabilities
                    .filter((l) => (l.kind === 'loan' || l.cardType !== 'debit') && (l.outstanding || 0) > 0)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {getSafeLiabilityName(l)} — Outstanding: {formatMoney(l.outstanding, l.currency)} ({l.ratePct}% p.a.)
                      </option>
                    ))}
                </select>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Baseline Debt Amount</label>
                    <input
                      type="number"
                      step="any"
                      value={startingDebtAmount}
                      onChange={(e) => setStartingDebtAmount(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Target Payoff Balance</label>
                    <input
                      type="number"
                      step="any"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 font-mono"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Goal Name</label>
              <input
                type="text"
                placeholder={
                  goalType === 'debt_payoff'
                    ? 'e.g. Pay Off Home Loan Principal, Retire Car Loan'
                    : 'e.g. Emergency Reserve (6 Months), Property Down Payment'
                }
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                required
              />
            </div>

            {/* Goal Priority */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Goal Priority
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'high', label: 'High Priority', desc: 'Essential reserve / high-rate debt' },
                  { id: 'mid', label: 'Mid Priority', desc: 'Core capital & milestones' },
                  { id: 'low', label: 'Low Priority', desc: 'Discretionary / long-term' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPriority(p.id as GoalPriority)}
                    className={`p-2 rounded-xl border text-left cursor-pointer transition-all ${
                      priority === p.id
                        ? p.id === 'high'
                          ? 'border-rose-500 bg-rose-950/30 text-rose-200 font-bold shadow-sm'
                          : p.id === 'low'
                          ? 'border-emerald-500 bg-emerald-950/30 text-emerald-200 font-bold shadow-sm'
                          : 'border-amber-500 bg-amber-950/30 text-amber-200 font-bold shadow-sm'
                        : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs">{p.label}</div>
                    <div className="text-[10px] text-slate-500 line-clamp-1">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {goalType !== 'debt_payoff' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Target Amount</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="300000"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100"
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} ({c.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <DatePickerField
              label="Target Deadline (Optional)"
              value={deadline}
              onChange={(d) => setDeadline(d)}
              placeholder="Select date on calendar or type DD/MM/YYYY"
              helperText="Enables required monthly pace estimation"
            />

            {/* Accumulation Mode: Monthly Accumulation vs Liquid Surplus Tracking Only */}
            <div className="space-y-2">
              <label className="block text-xs font-medium text-slate-300">
                Accumulation Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAccumulateMonthly(true);
                    setSyncToBills(true);
                  }}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    accumulateMonthly
                      ? 'border-cyan-500 bg-cyan-950/30 text-white shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <Repeat size={13} className="text-cyan-400" />
                    <span>Monthly Accumulation</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Schedule recurring monthly contributions synced to your Bills ledger
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAccumulateMonthly(false);
                    setSyncToBills(false);
                  }}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    !accumulateMonthly
                      ? 'border-emerald-500 bg-emerald-950/30 text-white shadow-sm'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <Wallet size={13} className="text-emerald-400" />
                    <span>Do Not Accumulate Monthly</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    No recurring bill; evaluate readiness from net liquid cash surplus
                  </div>
                </button>
              </div>
            </div>

            {/* Linked Assets & Funding Sources (FDs, Stocks, Mutual Funds, Bank Cash) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-slate-300">
                  Linked Assets & Funding Sources (FDs, Stocks, Mutual Funds, Bank Cash)
                </label>
                <span className="text-[10px] text-slate-400">Stock No · % · Per Value</span>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto border border-slate-800 rounded-2xl p-2.5 bg-slate-950/70">
                {allGoalFundingSources.length === 0 ? (
                  <div className="text-center py-3 text-xs text-slate-400">
                    No assets found. Add an asset (Bank, FD, Stock, Mutual Fund) in Assets first.
                  </div>
                ) : (
                  allGoalFundingSources.map((item) => {
                    const src = selectedSources.find((s) => s.sourceId === item.id);
                    const mode = src?.allocationMode || 'percentage';
                    const isSelected = Boolean(
                      src &&
                        ((src.allocationUnits || 0) > 0 ||
                          (src.allocationAmount || 0) > 0 ||
                          (src.allocationPct || 0) > 0 ||
                          (src.monthlyIncrement || 0) > 0)
                    );

                    // Compute live display amount
                    let liveAllocatedAmount = 0;
                    if (mode === 'units') {
                      liveAllocatedAmount = (src?.allocationUnits || 0) * (item.unitPrice || 0);
                    } else if (mode === 'fixed_amount') {
                      liveAllocatedAmount = src?.allocationAmount || 0;
                    } else {
                      liveAllocatedAmount = Math.round(item.availableVal * ((src?.allocationPct || 0) / 100));
                    }

                    return (
                      <div
                        key={item.id}
                        className={`p-2.5 rounded-xl border transition-all text-xs space-y-2 ${
                          isSelected
                            ? 'bg-slate-900 border-slate-700 shadow-sm'
                            : 'bg-slate-950/60 border-slate-800/80'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {item.isStock ? (
                                <TrendingUp size={13} className="text-indigo-400 shrink-0" />
                              ) : item.isFd ? (
                                <Lock size={13} className="text-amber-400 shrink-0" />
                              ) : item.isBank ? (
                                <Landmark size={13} className="text-emerald-400 shrink-0" />
                              ) : (
                                <Layers size={13} className="text-cyan-400 shrink-0" />
                              )}
                              <span className="font-semibold text-slate-100 break-words">{item.name}</span>
                              <span className="text-[10px] text-slate-400">· {item.typeLabel}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono tabular-nums block mt-0.5">
                              {item.hasUnits && item.units ? (
                                <>
                                  Holding: {item.units} units @ {formatMoney(item.unitPrice || 0, item.currency)} = {formatMoney(item.availableVal, item.currency)}
                                </>
                              ) : (
                                <>Available Balance: {formatMoney(item.availableVal, item.currency)}</>
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* 3 Allocation Modes: Stock No (Units) | % | Value */}
                            <div className="flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-[10px]">
                              <button
                                type="button"
                                onClick={() => handleSourceAllocationModeToggle(item.id, 'percentage')}
                                className={`px-2 py-0.5 rounded cursor-pointer font-bold transition-colors ${
                                  mode === 'percentage'
                                    ? 'bg-emerald-600 text-white'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                                title="Percentage of asset value"
                              >
                                %
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSourceAllocationModeToggle(item.id, 'fixed_amount')}
                                className={`px-2 py-0.5 rounded cursor-pointer font-bold transition-colors ${
                                  mode === 'fixed_amount'
                                    ? 'bg-cyan-600 text-white'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                                title="Fixed currency amount (Per Value)"
                              >
                                Value
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSourceAllocationModeToggle(item.id, 'units')}
                                className={`px-2 py-0.5 rounded cursor-pointer font-bold transition-colors ${
                                  mode === 'units'
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-slate-400 hover:text-white'
                                }`}
                                title="Quantity of shares or units (Stock No)"
                              >
                                Stock No
                              </button>
                            </div>

                            {/* Appropriate input according to selected mode */}
                            {mode === 'units' ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={src?.allocationUnits ?? ''}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    handleSourceUnitsChange(item.id, v);
                                  }}
                                  className="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 font-mono text-xs text-right"
                                />
                                <span className="text-[11px] text-slate-400 w-9 font-mono">units</span>
                              </div>
                            ) : mode === 'fixed_amount' ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  step="500"
                                  value={src?.allocationAmount ?? ''}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    handleSourceValueChange(item.id, v);
                                  }}
                                  className="w-24 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 font-mono text-xs text-right"
                                />
                                <span className="text-[11px] text-slate-400 w-7 font-mono">{item.currency}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="5"
                                  value={src?.allocationPct ?? ''}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value) || 0;
                                    handleSourceValueChange(item.id, v);
                                  }}
                                  className="w-16 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 font-mono text-xs text-right"
                                />
                                <span className="text-[11px] text-slate-400 w-4 font-mono">%</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Live allocation summary banner */}
                        {isSelected && (
                          <div className="pt-1.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono tabular-nums">
                            <span className="text-slate-400 font-sans">
                              {mode === 'units'
                                ? `Allocated: ${src?.allocationUnits || 0} units @ ${formatMoney(item.unitPrice || 0, item.currency)}`
                                : mode === 'fixed_amount'
                                ? `Allocated Value: ${formatMoney(src?.allocationAmount || 0, item.currency)}`
                                : `Allocated: ${src?.allocationPct || 0}% of balance`}
                            </span>
                            <span className="text-emerald-400 font-bold">
                              = {formatMoney(liveAllocatedAmount, item.currency)}
                            </span>
                          </div>
                        )}

                        {/* Payment mode for spendable liquid bank accounts */}
                        {isSelected && item.isBank && (
                          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
                            <span className="text-slate-400 font-medium">Payment Mode:</span>
                            <div className="flex items-center gap-1">
                              {(['upi', 'debit_card', 'neft', 'imps'] as const).map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => handleSourcePaymentModeChange(item.id, m)}
                                  className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-colors ${
                                    (src?.paymentMode || 'upi') === m
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800'
                                  }`}
                                >
                                  {m === 'upi' ? 'UPI (Default)' : m === 'debit_card' ? 'Debit Card' : m === 'neft' ? 'NEFT' : 'IMPS (+₹5)'}
                                </button>
                              ))}
                            </div>
                            {src?.paymentMode === 'debit_card' && (
                              <div className="w-full flex items-center justify-between pt-1 text-[9px] text-slate-400 border-t border-slate-800/40">
                                <span>ATM/Card Zone:</span>
                                <div className="flex items-center gap-1">
                                  {(['non_metro', 'metro'] as const).map((z) => (
                                    <button
                                      key={z}
                                      type="button"
                                      onClick={() => handleSourceAtmZoneChange(item.id, z)}
                                      className={`px-1.5 py-0.5 rounded font-semibold cursor-pointer ${
                                        (src.atmZone || 'non_metro') === z
                                          ? 'bg-cyan-600 text-white'
                                          : 'bg-slate-950 text-slate-400 border border-slate-800'
                                      }`}
                                    >
                                      {z === 'non_metro' ? 'Non-Metro (Default)' : 'Metro'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Incremental Recurring Monthly Contribution Stream */}
            {accumulateMonthly && (
              <div className="p-3.5 rounded-2xl bg-slate-950 border border-cyan-500/30 space-y-3">
                <div className="flex items-center gap-2">
                  <Repeat size={15} className="text-cyan-400" />
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Recurring Monthly Contribution Schedule
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Contribution Amount
                    </label>
                    <input
                      type="number"
                      step="500"
                      placeholder="e.g. 5000"
                      value={monthlyContribution}
                      onChange={(e) => setMonthlyContribution(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Frequency
                    </label>
                    <select
                      value={contributionFrequency}
                      onChange={(e) => setContributionFrequency(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="biweekly">Bi-weekly</option>
                      <option value="weekly">Weekly</option>
                      <option value="quarterly">Quarterly</option>
                    </select>
                  </div>
                </div>

                {bankHoldings.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Primary Liquid Bank Account
                    </label>
                    <select
                      value={contributionSourceId || bankHoldings[0].id}
                      onChange={(e) => setContributionSourceId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                    >
                      {bankHoldings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {formatAssetOptionLabel(b, assetTypes)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <label className="flex items-center gap-2 pt-1 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncToBills}
                    onChange={(e) => setSyncToBills(e.target.checked)}
                    className="rounded accent-cyan-500 cursor-pointer"
                  />
                  <span>Sync recurring contribution to Bills ledger until target is reached</span>
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddGoalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`px-5 py-2 rounded-xl text-white text-xs font-bold shadow-md cursor-pointer transition-all ${
                  goalType === 'debt_payoff'
                    ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                    : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                }`}
              >
                {editingGoal ? 'Save Goal' : goalType === 'debt_payoff' ? 'Create Debt Payoff Goal' : 'Create Goal'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm Goal Payment Modal - Asks for user permission to debit linked assets */}
      {goalForPayment && (
        <ConfirmGoalPaymentModal
          isOpen={!!goalForPayment}
          onClose={() => setGoalForPayment(null)}
          goal={goalForPayment}
        />
      )}

      {/* Goal History CSV Download & Export Modal */}
      {downloadModal && (
        <ExportDownloadModal
          isOpen={downloadModal.isOpen}
          onClose={() => setDownloadModal(null)}
          title={downloadModal.title}
          filename={downloadModal.filename}
          content={downloadModal.content}
          mimeType={downloadModal.mimeType}
        />
      )}
    </div>
  );
};
