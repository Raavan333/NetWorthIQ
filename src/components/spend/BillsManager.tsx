import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Bill, Goal } from '../../types';
import { formatMoney } from '../../lib/formatters';
import {
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
  formatCardOptionLabel,
} from '../../lib/assetRules';
import { Modal } from '../common/Modal';
import { AuthorizeBillOverrideModal } from './AuthorizeBillOverrideModal';
import { ConfirmGoalPaymentModal } from '../goals/ConfirmGoalPaymentModal';
import { PayBillModal } from './PayBillModal';
import {
  Plus,
  Check,
  Trash2,
  Edit2,
  Clock,
  ShieldCheck,
  Undo2,
  Zap,
  AlertCircle,
  TrendingUp,
} from 'lucide-react';

export const BillsManager: React.FC = () => {
  const {
    bills,
    goals,
    holdings,
    liabilities,
    assetTypes,
    currencies,
    addBill,
    updateBill,
    deleteBill,
    undoBillOverride,
    settings,
    spendCategories,
    getAccountLiquidityWithSweepIn,
    getCardEffectiveMode,
    predictedBills,
  } = useApp();

  const [isAddBillOpen, setIsAddBillOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [overrideBillTarget, setOverrideBillTarget] = useState<Bill | null>(null);
  const [goalForPayment, setGoalForPayment] = useState<Goal | null>(null);

  // Strictly unlocked liquid holdings (blocks FD, Sweep-In FD, RD, Stocks, Bonds, Mutual Funds, P2P)
  const spendableHoldings = useMemo(
    () => holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  // Credit Cards & Hybrid Cards (eligible for custom non-debt recurring bills; loans are never sources)
  const creditAndHybridCards = useMemo(
    () => liabilities.filter((l) => l.kind === 'card' && l.cardType !== 'debit'),
    [liabilities]
  );

  const currMap = useMemo(() => {
    const m: Record<string, (typeof currencies)[0]> = {};
    for (const c of currencies) m[c.code] = c;
    return m;
  }, [currencies]);

  const baseCurr = settings.baseCurrency || 'INR';
  const baseSym = currMap[baseCurr]?.symbol || baseCurr;

  // Form states
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(baseCurr);
  const [frequency, setFrequency] = useState<'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'yearly'>('monthly');
  const [dueDay, setDueDay] = useState('5');
  const [sourceId, setSourceId] = useState(
    spendableHoldings[0]?.id || creditAndHybridCards[0]?.id || ''
  );
  const [category, setCategory] = useState(spendCategories[0]?.name || 'Utilities & Bills');
  const [error, setError] = useState('');

  useEffect(() => {
    const validIds = new Set([
      ...spendableHoldings.map((h) => h.id),
      ...creditAndHybridCards.map((c) => c.id),
    ]);
    if (!sourceId || !validIds.has(sourceId)) {
      const nextDefault = spendableHoldings[0]?.id || creditAndHybridCards[0]?.id || '';
      if (nextDefault) setSourceId(nextDefault);
    }
  }, [spendableHoldings, creditAndHybridCards, sourceId]);

  const handleOpenAdd = (bill?: Bill) => {
    if (bill) {
      setEditingBill(bill);
      setName(bill.name);
      setAmount(bill.amount.toString());
      setCurrency(bill.currency);
      setFrequency(bill.frequency);
      setDueDay(bill.dueDay.toString());
      setSourceId(bill.sourceId || spendableHoldings[0]?.id || creditAndHybridCards[0]?.id || '');
      setCategory(bill.category);
    } else {
      setEditingBill(null);
      setName('');
      setAmount('');
      setCurrency(baseCurr);
      setFrequency('monthly');
      setDueDay('5');
      setSourceId(spendableHoldings[0]?.id || creditAndHybridCards[0]?.id || '');
      setCategory(spendCategories[0]?.name || 'Utilities & Bills');
    }
    setError('');
    setIsAddBillOpen(true);
  };

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a bill name.');
      return;
    }
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setError('Please provide a valid positive bill amount.');
      return;
    }
    if (!sourceId) {
      setError('Please select a valid liquid account or card source.');
      return;
    }

    const billData: Bill = {
      id: editingBill?.id || `bill-${Date.now()}`,
      name: name.trim(),
      amount: amtNum,
      currency,
      frequency,
      dueDay: parseInt(dueDay, 10) || 1,
      sourceId,
      category: category.trim() || 'General',
      autoPostPrompt: true,
      lastPostedDate: editingBill?.lastPostedDate,
    };

    if (editingBill) {
      await updateBill(billData);
    } else {
      await addBill(billData);
    }
    setIsAddBillOpen(false);
  };

  const [selectedFilter, setSelectedFilter] = useState<'all' | 'loans' | 'cards' | 'goals' | 'subscriptions'>('all');
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [billForPayment, setBillForPayment] = useState<Bill | null>(null);

  const handlePostBill = async (bill: Bill) => {
    setPostError(null);
    setPostSuccess(null);

    if (bill.isCompletedGoalBill && bill.goalId) {
      const targetG = goals.find((g) => g.id === bill.goalId);
      if (targetG) {
        setGoalForPayment(targetG);
        return;
      }
    }

    setBillForPayment(bill);
  };

  const isBillSettled = (b: Bill) => {
    if (b.isArchived) return true;
    if (b.isCompletedGoalBill) return true;
    if (b.goalId) {
      const g = goals.find((item) => item.id === b.goalId);
      if (g && (g.isCompleted || g.paymentVerified || (g.accumulatedTotal || 0) >= g.cost)) return true;
    }
    if (b.isAutoLiabilityBill && b.liabilityKind === 'loan') {
      const l = liabilities.find((item) => item.id === b.liabilityId);
      if (l && (l.outstanding || 0) <= 0) return true;
    }
    return false;
  };

  const activeBillsList = useMemo(
    () => bills.filter((b) => !isBillSettled(b)),
    [bills, goals, liabilities]
  );

  const filteredBills = activeBillsList.filter((b) => {
    if (selectedFilter === 'loans') return b.isAutoLiabilityBill && b.liabilityKind === 'loan';
    if (selectedFilter === 'cards') return b.isAutoLiabilityBill && b.liabilityKind === 'card';
    if (selectedFilter === 'goals') return b.isGoalContributionBill || b.isCompletedGoalBill;
    if (selectedFilter === 'subscriptions')
      return !b.isAutoLiabilityBill && !b.isGoalContributionBill && !b.isCompletedGoalBill;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h3 className="text-base font-bold text-white">Scheduled Bills &amp; Debt Commitments</h3>
          <p className="text-xs text-slate-400">
            Loan EMIs and card statements require positive liquid cash; regular bills accept liquid cash or credit cards
          </p>
        </div>
        <button
          onClick={() => handleOpenAdd()}
          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
        >
          <Plus size={15} />
          <span>Add Custom Bill</span>
        </button>
      </div>

      {/* ML Predicted Possible Bills Summary (Estimated from Historical Spend Patterns) */}
      {predictedBills && predictedBills.items.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <TrendingUp size={14} className="text-cyan-400" />
                <span>Estimated Possible Monthly Outlays (Spend Pattern Forecast)</span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Derived from recurring spend history and reserved alongside scheduled bills before calculating goal surplus.
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-cyan-300 font-mono tabular-nums">
                {formatMoney(predictedBills.totalPredictedAmountBase, baseCurr, baseSym)}/mo
              </div>
              <div className="text-[10px] text-slate-500">
                {predictedBills.items.length} category pattern{predictedBills.items.length === 1 ? '' : 's'} detected
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
            {predictedBills.items.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-200 truncate">{item.label}</div>
                  <div className="text-[10px] text-slate-500 truncate">
                    {item.category} · {Math.round(item.confidencePct)}% consistency
                  </div>
                </div>
                <div className="font-mono font-semibold text-slate-200 tabular-nums shrink-0">
                  {formatMoney(item.estimatedAmountBase, baseCurr, baseSym)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notification Banners */}
      {postError && (
        <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start justify-between gap-2 shadow-md">
          <div>
            <strong className="block text-rose-300 font-bold mb-0.5">Payment Could Not Be Completed</strong>
            <span>{postError}</span>
          </div>
          <button
            onClick={() => setPostError(null)}
            className="p-1 rounded text-rose-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {postSuccess && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between gap-2 shadow-md">
          <div className="flex items-center gap-2">
            <Check size={16} className="text-emerald-400 shrink-0" />
            <span>{postSuccess}</span>
          </div>
          <button
            onClick={() => setPostSuccess(null)}
            className="p-1 rounded text-emerald-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Interactive Category Filter Controls */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        <button
          type="button"
          onClick={() => setSelectedFilter('all')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap ${
            selectedFilter === 'all'
              ? 'bg-slate-700 text-white font-bold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          All Active ({activeBillsList.length})
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('loans')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap ${
            selectedFilter === 'loans'
              ? 'bg-rose-600/30 text-rose-300 border border-rose-500/50 font-bold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Loan EMIs ({activeBillsList.filter((b) => b.isAutoLiabilityBill && b.liabilityKind === 'loan').length})
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('cards')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap ${
            selectedFilter === 'cards'
              ? 'bg-amber-600/30 text-amber-300 border border-amber-500/50 font-bold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Card Statements ({activeBillsList.filter((b) => b.isAutoLiabilityBill && b.liabilityKind === 'card').length})
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('goals')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap ${
            selectedFilter === 'goals'
              ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/50 font-bold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Goal Streams ({activeBillsList.filter((b) => b.isGoalContributionBill || b.isCompletedGoalBill).length})
        </button>
        <button
          type="button"
          onClick={() => setSelectedFilter('subscriptions')}
          className={`px-3 py-1.5 rounded-xl font-medium transition-colors cursor-pointer whitespace-nowrap ${
            selectedFilter === 'subscriptions'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 font-bold'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Bills &amp; Payables ({activeBillsList.filter((b) => !b.isAutoLiabilityBill && !b.isGoalContributionBill && !b.isCompletedGoalBill).length})
        </button>
      </div>

      {filteredBills.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
          No scheduled bills match the selected category.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredBills.map((bill) => {
            const sym = currMap[bill.currency]?.symbol || bill.currency;
            const canUseCard =
              !bill.isAutoLiabilityBill &&
              !bill.isGoalContributionBill &&
              !bill.isCompletedGoalBill &&
              !bill.isPeerBorrowBill;

            const directCard = canUseCard
              ? creditAndHybridCards.find((c) => c.id === bill.sourceId)
              : undefined;
            const sourceAsset = !directCard
              ? spendableHoldings.find((h) => h.id === bill.sourceId) || spendableHoldings[0]
              : undefined;

            const cardLimit = directCard ? directCard.creditLimit || directCard.limit || 100000 : 0;
            const cardAvailCredit = directCard
              ? Math.max(0, cardLimit - (directCard.outstanding || 0))
              : 0;
            const cardEffectiveMode = directCard ? getCardEffectiveMode(directCard) : null;

            const sourceName = directCard
              ? getSafeLiabilityName(directCard)
              : sourceAsset
              ? getSafeAssetName(sourceAsset, assetTypes)
              : 'No Eligible Liquid Account';

            const availableCash = sourceAsset ? sourceAsset.principalOrValue || 0 : 0;
            const liquidityInfo = sourceAsset ? getAccountLiquidityWithSweepIn(sourceAsset.id) : null;
            const totalSweepIn = liquidityInfo?.totalSweepIn || 0;
            const totalAvailable = liquidityInfo?.totalAvailable ?? Math.max(0, availableCash);
            const sweepInFds = liquidityInfo?.sweepInFds || [];

            const isCoveredBySweepIn =
              !directCard && availableCash < bill.amount && totalSweepIn > 0 && totalAvailable >= bill.amount;
            const isInsufficientCash = directCard
              ? cardAvailCredit < bill.amount
              : totalAvailable < bill.amount || (availableCash <= 0 && totalSweepIn <= 0);
            const shortfall = directCard
              ? Math.max(0, bill.amount - cardAvailCredit)
              : Math.max(0, bill.amount - totalAvailable);
            const extraFromFd = Math.max(0, bill.amount - Math.max(0, availableCash));

            const isLoanBill = bill.isAutoLiabilityBill && bill.liabilityKind === 'loan';
            const isCardBill = bill.isAutoLiabilityBill && bill.liabilityKind === 'card';
            const isGoalBill = bill.isGoalContributionBill;
            const isOverridden = Boolean(bill.isOverriddenPaid);

            const priorityLevel = bill.repaymentPriority || (isLoanBill ? 1 : isCardBill ? 2 : isGoalBill ? 4 : 3);

            return (
              <div
                key={bill.id}
                className={`p-4 rounded-2xl border transition-colors shadow-sm flex flex-col justify-between ${
                  isOverridden
                    ? 'bg-slate-900 border-cyan-500/40'
                    : isCoveredBySweepIn
                    ? 'bg-slate-900 border-emerald-500/40'
                    : isInsufficientCash
                    ? 'bg-slate-900 border-rose-500/30'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 text-[11px] text-slate-400 flex-wrap">
                        <span className="font-medium text-slate-300">
                          {bill.isPeerBorrowBill
                            ? 'Peer Payable'
                            : priorityLevel === 1
                            ? 'Loan EMI'
                            : priorityLevel === 2
                            ? 'Card Statement'
                            : bill.isCompletedGoalBill
                            ? 'Goal Ready'
                            : priorityLevel === 4
                            ? 'Goal Contribution'
                            : bill.category}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="capitalize">{bill.frequency}</span>
                        {bill.liabilityKind === 'card' && bill.isStatementGenerated === false && (
                          <>
                            <span className="text-slate-600">·</span>
                            <span className="text-indigo-300">Unbilled (Stmt {bill.statementDateStr})</span>
                          </>
                        )}
                      </div>
                      <h4 className="text-sm font-semibold text-white break-words">{bill.name}</h4>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold text-white font-mono tabular-nums">
                        {formatMoney(bill.amount, bill.currency, sym)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {bill.dueDateStr ? `Due: ${bill.dueDateStr}` : `Due ${bill.dueDay}th of month`}
                        {bill.coolOffDays && (
                          <span className="block text-[9px] text-slate-500">
                            {bill.coolOffDays}d grace period
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Payment Account / Card Sufficiency Status */}
                  <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-slate-400">
                      <span className="truncate max-w-full">
                        Source: <strong className="text-slate-200">{sourceName}</strong>
                        {directCard && (
                          <span className="text-slate-400">
                            {' '}·{' '}
                            {directCard.cardType === 'hybrid'
                              ? cardEffectiveMode === 'debit'
                                ? 'Hybrid (Debit Active)'
                                : 'Hybrid (Credit Mode)'
                              : 'Credit Card'}
                          </span>
                        )}
                      </span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {directCard
                          ? `Avail Credit: ${formatMoney(cardAvailCredit, directCard.currency, sym)}`
                          : `Cash: ${formatMoney(availableCash, bill.currency, sym)}`}
                      </span>
                    </div>

                    {isOverridden ? (
                      <div className="text-cyan-300 font-medium flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                        <span className="flex items-center gap-1">
                          <ShieldCheck size={12} className="text-cyan-400" />
                          <span>Cleared For This Month (Authorized Override)</span>
                        </span>
                        <span className="text-cyan-400/80">No cash deducted</span>
                      </div>
                    ) : isCoveredBySweepIn ? (
                      <div className="pt-1.5 border-t border-slate-800/60 text-[10px] space-y-1">
                        <div className="flex items-center justify-between text-emerald-400 font-medium">
                          <span className="flex items-center gap-1">
                            <Zap size={11} className="text-emerald-400" />
                            <span>Backed by Sweep-In (+{formatMoney(totalSweepIn, bill.currency, sym)})</span>
                          </span>
                          <span className="text-slate-300 font-mono tabular-nums">
                            Total: {formatMoney(totalAvailable, bill.currency, sym)}
                          </span>
                        </div>
                        <div className="text-[10px] text-cyan-300 flex items-center justify-between gap-1">
                          <span>Deficit {formatMoney(extraFromFd, bill.currency, sym)} from newest FD:</span>
                          <strong className="text-white truncate">{getSafeAssetName(sweepInFds[0], assetTypes)}</strong>
                        </div>
                      </div>
                    ) : isInsufficientCash ? (
                      <div className="text-rose-400 font-medium flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                        <span className="flex items-center gap-1">
                          <AlertCircle size={11} />
                          <span>{directCard ? 'Insufficient Credit Limit' : 'Insufficient Positive Cash'}</span>
                        </span>
                        <span className="font-mono tabular-nums text-rose-300 font-bold">
                          Short by {formatMoney(shortfall, bill.currency, sym)}
                        </span>
                      </div>
                    ) : (
                      <div className="text-emerald-400 font-medium flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px]">
                        <span className="flex items-center gap-1">
                          <Check size={11} />
                          <span>{directCard ? 'Credit Facility Available' : 'Positive Liquidity Available'}</span>
                        </span>
                        <span>Ready to settle</span>
                      </div>
                    )}
                  </div>

                  {/* Virtual Override Active Notice & Undo */}
                  {isOverridden && (
                    <div className="mt-2 p-2 rounded-xl bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-between text-[11px] text-cyan-200">
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck size={13} className="text-cyan-400 shrink-0" />
                        <span>Authorized as settled externally.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => undoBillOverride(bill.id)}
                        className="px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                        title="Restore this bill to active cash flow"
                      >
                        <Undo2 size={11} />
                        <span>Undo</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 mt-3 flex-wrap gap-2">
                  <div className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock size={12} />
                    <span>
                      {isOverridden
                        ? 'Authorized Override'
                        : bill.lastPostedDate
                        ? `Settled: ${bill.lastPostedDate}`
                        : 'Pending'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => handlePostBill(bill)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                        isOverridden
                          ? 'bg-slate-800/80 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                          : isCoveredBySweepIn
                          ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-600/35'
                          : isInsufficientCash
                          ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20'
                          : bill.liabilityKind === 'card' && bill.isStatementGenerated === false
                          ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30'
                          : 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30'
                      }`}
                    >
                      {isCoveredBySweepIn ? (
                        <Zap size={13} className="text-emerald-400" />
                      ) : (
                        <Check size={13} />
                      )}
                      <span>
                        {isOverridden
                          ? 'Pay Anyway'
                          : isCoveredBySweepIn
                          ? 'Pay with Sweep-In'
                          : isInsufficientCash
                          ? 'Review & Pay'
                          : bill.liabilityKind === 'card' && bill.isStatementGenerated === false
                          ? 'Pay Early'
                          : 'Pay Now'}
                      </span>
                    </button>

                    {!isOverridden && (
                      <button
                        type="button"
                        onClick={() => setOverrideBillTarget(bill)}
                        className="px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700 hover:border-cyan-500/50 cursor-pointer transition-all"
                        title="Already settled outside? Authorize override with PIN."
                      >
                        <ShieldCheck size={13} className="text-cyan-400" />
                        <span className="hidden sm:inline">Already Paid?</span>
                        <span className="sm:hidden">Override</span>
                      </button>
                    )}

                    {!bill.isAutoLiabilityBill && !bill.isGoalContributionBill && !bill.isCompletedGoalBill && (
                      <>
                        <button
                          onClick={() => handleOpenAdd(bill)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => deleteBill(bill.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Delete bill"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Custom Bill Modal */}
      {isAddBillOpen && (
        <Modal
          isOpen={isAddBillOpen}
          onClose={() => setIsAddBillOpen(false)}
          title={editingBill ? 'Edit Recurring Bill' : 'Add Recurring Bill'}
          subtitle="Configure recurring outlays, monthly due day, and eligible settlement source"
        >
          <form onSubmit={handleSaveBill} className="space-y-4">
            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs">{error}</div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Bill Name</label>
              <input
                type="text"
                placeholder="e.g. Apartment Rent, Fiber Broadband, Electricity"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Amount</label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Frequency</label>
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as Bill['frequency'])}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Due Day of Month</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDay}
                  onChange={(e) => setDueDay(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono tabular-nums"
                  required
                />
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Default Payment Source (Liquid Cash / Bank or Card)
                </label>
                <select
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                >
                  {spendableHoldings.length > 0 && (
                    <optgroup label="Liquid Bank & Cash Accounts">
                      {spendableHoldings.map((h) => {
                        const hSym = currMap[h.currency]?.symbol || `${h.currency} `;
                        const { totalSweepIn: swp } = getAccountLiquidityWithSweepIn(h.id);
                        return (
                          <option key={h.id} value={h.id}>
                            {formatAssetOptionLabel(h, assetTypes, {
                              currSymbol: hSym,
                              sweepInAmount: swp,
                            })}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                  {creditAndHybridCards.length > 0 && (
                    <optgroup label="Credit & Hybrid Cards">
                      {creditAndHybridCards.map((c) => {
                        const cSym = currMap[c.currency]?.symbol || `${c.currency} `;
                        return (
                          <option key={c.id} value={c.id}>
                            {formatCardOptionLabel(c, getCardEffectiveMode(c), cSym)}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Locked holdings (FD, RD, Stocks, Bonds, Mutual Funds) and term loans are excluded from bill payment sources.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  {spendCategories.map((c, idx) => (
                    <option key={`${c.id || 'cat'}-${idx}`} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm pt-3 pb-1 border-t border-slate-800 -mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5 flex justify-end gap-2 z-10">
              <button
                type="button"
                onClick={() => setIsAddBillOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                {editingBill ? 'Save Changes' : 'Add Bill'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {overrideBillTarget && (
        <AuthorizeBillOverrideModal
          isOpen={Boolean(overrideBillTarget)}
          onClose={() => setOverrideBillTarget(null)}
          bill={overrideBillTarget}
        />
      )}

      {goalForPayment && (
        <ConfirmGoalPaymentModal
          isOpen={Boolean(goalForPayment)}
          onClose={() => setGoalForPayment(null)}
          goal={goalForPayment}
          onSuccess={() => {
            setPostSuccess(`Payment for goal "${goalForPayment.name}" verified from ledger and debited from linked liquid assets.`);
            setTimeout(() => setPostSuccess(null), 4000);
          }}
        />
      )}

      {billForPayment && (
        <PayBillModal
          isOpen={Boolean(billForPayment)}
          onClose={() => setBillForPayment(null)}
          bill={billForPayment}
          onSuccess={(msg) => {
            setPostSuccess(msg);
            setTimeout(() => setPostSuccess(null), 5000);
          }}
          onError={(err) => setPostError(err)}
        />
      )}
    </div>
  );
};
