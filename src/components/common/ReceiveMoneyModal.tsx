import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { ExternalInflowCategory, ExternalInflowParams } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { getSafeAssetName, getSafeLiabilityName } from '../../lib/assetRules';
import { Modal } from './Modal';
import {
  Gift,
  HeartHandshake,
  ArrowDownLeft,
  Building2,
  Receipt,
  CreditCard,
  Target,
  Check,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Calendar,
  FileText,
} from 'lucide-react';

interface ReceiveMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDestinationType?: 'account' | 'direct_bill' | 'direct_liability';
  preselectedBillId?: string;
  preselectedLiabilityId?: string;
  preselectedGoalId?: string;
  preselectedAccountId?: string;
  onSuccess?: (msg: string) => void;
}

const QUICK_SPONSORS = [
  'Loved One',
  'Parents / Family',
  'Friend',
  'Employer',
  'Client / Customer',
  'Relative',
];

const CATEGORIES: { id: ExternalInflowCategory; label: string; icon: string }[] = [
  { id: 'Gift', label: 'Gift', icon: '🎁' },
  { id: 'Family Support', label: 'Family Support', icon: '❤️' },
  { id: 'Reimbursement', label: 'Reimbursement', icon: '💼' },
  { id: 'Bonus', label: 'Bonus / Reward', icon: '⭐' },
  { id: 'Side Income', label: 'Side Income', icon: '⚡' },
  { id: 'Loan Returned', label: 'Loan Returned', icon: '🤝' },
  { id: 'Other', label: 'Other Inflow', icon: '💵' },
];

export const ReceiveMoneyModal: React.FC<ReceiveMoneyModalProps> = ({
  isOpen,
  onClose,
  initialDestinationType = 'account',
  preselectedBillId,
  preselectedLiabilityId,
  preselectedGoalId,
  preselectedAccountId,
  onSuccess,
}) => {
  const {
    holdings,
    liabilities,
    bills,
    goals,
    currencies,
    settings,
    recordExternalInflow,
  } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';

  // Form State
  const [destinationType, setDestinationType] = useState<'account' | 'direct_bill' | 'direct_liability'>(
    initialDestinationType
  );
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(baseCurr);
  const [sourceName, setSourceName] = useState('Loved One');
  const [category, setCategory] = useState<ExternalInflowCategory>('Gift');
  const [targetAccountId, setTargetAccountId] = useState('');
  const [targetBillId, setTargetBillId] = useState('');
  const [targetLiabilityId, setTargetLiabilityId] = useState('');
  const [earmarkedGoalId, setEarmarkedGoalId] = useState('');
  const [isGoalEarmarked, setIsGoalEarmarked] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Eligible accounts for deposit: Bank accounts, Hand Cash, Savings
  const eligibleAccounts = useMemo(() => {
    return holdings.filter(
      (h) => h.liquidityClass === 'Immediate' || h.typeId === 'type-bank' || h.typeId === 'type-cash'
    );
  }, [holdings]);

  // Active debt liabilities: Loans & Cards with outstanding balances
  const activeDebts = useMemo(() => {
    return liabilities.filter((l) => (l.outstanding || 0) > 0);
  }, [liabilities]);

  // Active goals available for earmarking
  const activeGoals = useMemo(() => {
    return goals.filter((g) => !g.isCompleted);
  }, [goals]);

  // Sync initial state when modal opens
  useEffect(() => {
    if (!isOpen) return;

    setDestinationType(initialDestinationType);
    setError('');
    setIsSubmitting(false);

    if (preselectedAccountId && eligibleAccounts.some((a) => a.id === preselectedAccountId)) {
      setTargetAccountId(preselectedAccountId);
    } else if (eligibleAccounts.length > 0) {
      setTargetAccountId(eligibleAccounts[0].id);
    }

    if (preselectedBillId && bills.some((b) => b.id === preselectedBillId)) {
      setTargetBillId(preselectedBillId);
      const b = bills.find((x) => x.id === preselectedBillId);
      if (b && !amount) setAmount(b.amount.toString());
      setDestinationType('direct_bill');
    } else if (bills.length > 0) {
      setTargetBillId(bills[0].id);
    }

    if (preselectedLiabilityId && activeDebts.some((l) => l.id === preselectedLiabilityId)) {
      setTargetLiabilityId(preselectedLiabilityId);
      const l = activeDebts.find((x) => x.id === preselectedLiabilityId);
      if (l && !amount) setAmount((l.outstanding || 0).toString());
      setDestinationType('direct_liability');
    } else if (activeDebts.length > 0) {
      setTargetLiabilityId(activeDebts[0].id);
    }

    if (preselectedGoalId) {
      setEarmarkedGoalId(preselectedGoalId);
      setIsGoalEarmarked(true);
    }
  }, [
    isOpen,
    initialDestinationType,
    preselectedAccountId,
    preselectedBillId,
    preselectedLiabilityId,
    preselectedGoalId,
    eligibleAccounts,
    bills,
    activeDebts,
  ]);

  // Auto-fill bill amount when target bill changes
  const handleBillSelect = (billId: string) => {
    setTargetBillId(billId);
    const b = bills.find((x) => x.id === billId);
    if (b) {
      setAmount(b.amount.toString());
      setCurrency(b.currency);
    }
  };

  // Auto-fill debt currency when target debt changes
  const handleLiabilitySelect = (liabilityId: string) => {
    setTargetLiabilityId(liabilityId);
    const l = activeDebts.find((x) => x.id === liabilityId);
    if (l) {
      setCurrency(l.currency);
    }
  };

  const parsedAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid positive monetary amount.');
      return;
    }

    if (!sourceName.trim()) {
      setError('Please specify who sent or paid this money (e.g. Loved One, Parents, Friend).');
      return;
    }

    if (destinationType === 'account' && !targetAccountId) {
      setError('Please select a destination account to credit.');
      return;
    }

    if (destinationType === 'direct_bill' && !targetBillId) {
      setError('Please select the bill that was settled.');
      return;
    }

    if (destinationType === 'direct_liability' && !targetLiabilityId) {
      setError('Please select the loan or card that was paid down.');
      return;
    }

    setIsSubmitting(true);

    try {
      const params: ExternalInflowParams = {
        sourceName: sourceName.trim(),
        category,
        amount: parsedAmount,
        currency,
        destinationType,
        targetAccountId: destinationType === 'account' ? targetAccountId : undefined,
        targetBillId: destinationType === 'direct_bill' ? targetBillId : undefined,
        targetLiabilityId: destinationType === 'direct_liability' ? targetLiabilityId : undefined,
        earmarkedGoalId: isGoalEarmarked && earmarkedGoalId ? earmarkedGoalId : undefined,
        date,
        notes: notes.trim() || undefined,
      };

      const res = await recordExternalInflow(params);

      if (!res.success) {
        setError(res.error || 'Failed to record external inflow.');
        setIsSubmitting(false);
      } else {
        if (onSuccess) onSuccess(res.summary || 'Inflow recorded successfully.');
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || 'Unexpected error occurred.');
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Receive Money / External Inflow"
      subtitle="Log cash gifts, support from loved ones, reimbursements, or outside bill settlements"
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
            <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-semibold">Validation Notice</strong>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* 3 Destination Scenarios: Segmented Control */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            How was this money received or applied?
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1 bg-slate-950 rounded-2xl border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setDestinationType('account')}
              className={`p-2.5 rounded-xl font-medium transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                destinationType === 'account'
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ArrowDownLeft size={16} />
              <span className="font-semibold text-white">Deposit to Account</span>
              <span className="text-[10px] text-slate-400">Cash in hand or bank</span>
            </button>

            <button
              type="button"
              onClick={() => setDestinationType('direct_bill')}
              className={`p-2.5 rounded-xl font-medium transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                destinationType === 'direct_bill'
                  ? 'bg-slate-800 text-amber-400 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Receipt size={16} />
              <span className="font-semibold text-white">Direct Bill Payment</span>
              <span className="text-[10px] text-slate-400">Paid directly for you</span>
            </button>

            <button
              type="button"
              onClick={() => setDestinationType('direct_liability')}
              className={`p-2.5 rounded-xl font-medium transition-all flex flex-col items-center justify-center gap-1 cursor-pointer text-center ${
                destinationType === 'direct_liability'
                  ? 'bg-slate-800 text-cyan-400 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <CreditCard size={16} />
              <span className="font-semibold text-white">Direct Debt Paydown</span>
              <span className="text-[10px] text-slate-400">Loan or card relief</span>
            </button>
          </div>
        </div>

        {/* Amount & Currency */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-300 mb-1">
              Amount Received / Settled <span className="text-emerald-400">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-500">
                {currencies.find((c) => c.code === currency)?.symbol || currency}
              </span>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white font-mono text-base font-bold focus:border-emerald-500 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-semibold focus:border-emerald-500 focus:outline-none"
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Received From / Sponsor Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-semibold text-slate-300">
              Received From / Paid By <span className="text-emerald-400">*</span>
            </label>
            <span className="text-[10px] text-slate-400">e.g. Loved One, Mom & Dad, Friend</span>
          </div>
          <input
            type="text"
            placeholder="e.g. Mom & Dad / Loved One"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
            required
          />

          {/* Quick Sponsor Chips */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[10px] text-slate-500">Quick fill:</span>
            {QUICK_SPONSORS.map((sp) => (
              <button
                key={sp}
                type="button"
                onClick={() => setSourceName(sp)}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-medium border transition-colors cursor-pointer ${
                  sourceName === sp
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {sp}
              </button>
            ))}
          </div>
        </div>

        {/* Category Pills */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">Nature of Inflow</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategory(cat.id)}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  category === cat.id
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 shadow-xs'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Context-Specific Target Selectors */}
        {destinationType === 'account' && (
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Deposit Into Account <span className="text-emerald-400">*</span>
              </label>
              {eligibleAccounts.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  No bank or cash holdings found. Please add a bank account first.
                </div>
              ) : (
                <select
                  value={targetAccountId}
                  onChange={(e) => setTargetAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
                  required
                >
                  {eligibleAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {getSafeAssetName(acc)} ({formatMoney(acc.principalOrValue || 0, acc.currency)})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Earmark for Goal Option */}
            {activeGoals.length > 0 && (
              <div className="pt-2 border-t border-slate-850">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                  <input
                    type="checkbox"
                    checked={isGoalEarmarked}
                    onChange={(e) => {
                      setIsGoalEarmarked(e.target.checked);
                      if (e.target.checked && !earmarkedGoalId && activeGoals[0]) {
                        setEarmarkedGoalId(activeGoals[0].id);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span>Earmark this gift directly towards an active Goal</span>
                </label>

                {isGoalEarmarked && (
                  <div className="mt-2 pl-6">
                    <select
                      value={earmarkedGoalId}
                      onChange={(e) => setEarmarkedGoalId(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
                    >
                      {activeGoals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name} (Target: {formatMoney(g.cost, g.currency)}, Saved:{' '}
                          {formatMoney(g.accumulatedTotal || 0, g.currency)})
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Increases your saved goal progress and records an audited gift contribution in the goal's ledger.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {destinationType === 'direct_bill' && (
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">
                  Select Bill Settled by Outside Party <span className="text-amber-400">*</span>
                </label>
                <span className="text-[10px] text-amber-400 font-medium">No personal account debited</span>
              </div>
              {bills.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                  No active bills or commitments found.
                </div>
              ) : (
                <select
                  value={targetBillId}
                  onChange={(e) => handleBillSelect(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-amber-500 focus:outline-none"
                  required
                >
                  {bills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — {formatMoney(b.amount, b.currency)} ({b.category})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              When an outside person pays your bill directly, the bill is marked paid in your schedule and ledger,
              while your personal bank balances stay 100% untouched.
            </p>
          </div>
        )}

        {destinationType === 'direct_liability' && (
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">
                  Select Debt to Pay Down <span className="text-cyan-400">*</span>
                </label>
                <span className="text-[10px] text-cyan-400 font-medium">Direct debt relief</span>
              </div>
              {activeDebts.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  No active loans or credit cards with outstanding balances.
                </div>
              ) : (
                <select
                  value={targetLiabilityId}
                  onChange={(e) => handleLiabilitySelect(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-cyan-500 focus:outline-none"
                  required
                >
                  {activeDebts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {getSafeLiabilityName(l)} — Outstanding: {formatMoney(l.outstanding || 0, l.currency)} ({l.kind.toUpperCase()})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Reduces your contractual loan or card balance directly. Net worth increases immediately without requiring
              any cash outflow from your bank.
            </p>
          </div>
        )}

        {/* Date & Notes */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Date</label>
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Notes (Optional)</label>
            <div className="relative">
              <FileText size={14} className="absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="e.g. Birthday gift, medical reimbursement"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white text-xs font-medium focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Live Accounting Impact Preview */}
        {parsedAmount > 0 && (
          <div className="p-3.5 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <Sparkles size={14} />
              <span>Real Financial Impact</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-300 pt-1">
              <div>
                <span className="text-slate-400 block">Net Worth Impact:</span>
                <span className="font-bold text-emerald-400">
                  +{formatMoney(parsedAmount, currency)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Personal Cash Debited:</span>
                <span className="font-bold text-slate-200">
                  {destinationType === 'account' ? '₹0 (+Inflow)' : '₹0 (Untouched)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Status:</span>
                <span className="font-bold text-emerald-400">Audited Inflow</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || parsedAmount <= 0}
            className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            <Check size={14} />
            <span>{isSubmitting ? 'Recording...' : 'Record Inflow'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
