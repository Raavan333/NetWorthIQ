import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Receivable } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { X, CheckCircle2, Landmark, AlertCircle, Handshake, Layers, Sparkles } from 'lucide-react';

interface RecordRepaymentModalProps {
  receivable: Receivable;
  onClose: () => void;
}

export const RecordRepaymentModal: React.FC<RecordRepaymentModalProps> = ({
  receivable,
  onClose,
}) => {
  const { recordReceivableRepayment, holdings, receivables, currencies, settings } = useApp();

  const [mode, setMode] = useState<'cash_deposit' | 'expense_offset'>('cash_deposit');
  const [amount, setAmount] = useState<number | ''>(receivable.outstandingAmount);
  const [depositAccountId, setDepositAccountId] = useState(
    holdings.find((h) => h.liquidityClass === 'Immediate')?.id || ''
  );
  const [expenseDescription, setExpenseDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const bankAccounts = holdings.filter((h) => h.liquidityClass === 'Immediate');
  const currSym = currencies.find((c) => c.code === receivable.currency)?.symbol || '₹';

  // Find all active lent loans for this person
  const debtorActiveLoans = useMemo(() => {
    const normName = receivable.debtorName.trim().toLowerCase();
    const otherActive = receivables.filter(
      (r) =>
        r.id !== receivable.id &&
        !r.isArchived &&
        (r.direction || 'lent') === 'lent' &&
        r.debtorName.trim().toLowerCase() === normName &&
        (r.outstandingAmount || 0) > 0.005
    );
    return [receivable, ...otherActive];
  }, [receivables, receivable]);

  const numericAmt = Number(amount) || 0;

  // Simulate cascading loan paydown across debtor's obligations
  const cascadeSimulation = useMemo(() => {
    let unallocated = numericAmt;
    const slices: {
      loanId: string;
      label: string;
      currentBalance: number;
      appliedSlice: number;
      nextBalance: number;
      isSettled: boolean;
    }[] = [];

    for (let i = 0; i < debtorActiveLoans.length; i++) {
      const loan = debtorActiveLoans[i];
      const bal = loan.outstandingAmount || 0;
      const applied = Math.min(bal, unallocated);
      const remaining = Math.max(0, bal - applied);
      slices.push({
        loanId: loan.id,
        label: i === 0 ? `Target Loan (${loan.notes || 'Primary'})` : `Next Loan ${i + 1} (${loan.notes || loan.id.slice(-4)})`,
        currentBalance: bal,
        appliedSlice: applied,
        nextBalance: remaining,
        isSettled: remaining <= 0.005,
      });
      unallocated = Math.max(0, unallocated - applied);
    }

    const totalDebtorBalance = debtorActiveLoans.reduce((sum, l) => sum + (l.outstandingAmount || 0), 0);
    const totalReduced = Math.min(totalDebtorBalance, numericAmt);
    const totalRemaining = Math.max(0, totalDebtorBalance - totalReduced);
    const excessSurplus = Math.max(0, numericAmt - totalDebtorBalance);
    const allDebtsSettled = totalRemaining <= 0.005;

    return {
      slices,
      totalDebtorBalance,
      totalReduced,
      totalRemaining,
      excessSurplus,
      allDebtsSettled,
    };
  }, [debtorActiveLoans, numericAmt]);

  const selectedHolding = holdings.find((h) => h.id === depositAccountId) || holdings.find((h) => h.liquidityClass === 'Immediate');


  const handleRepay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!numericAmt || numericAmt <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    if (mode === 'expense_offset' && !expenseDescription.trim()) {
      setError('Enter what expense or bill they paid for you.');
      return;
    }

    setIsSubmitting(true);
    const res = await recordReceivableRepayment(
      receivable.id,
      numericAmt,
      mode === 'cash_deposit' ? depositAccountId || undefined : undefined,
      date,
      notes.trim() || undefined,
      {
        mode,
        expenseDescription: mode === 'expense_offset' ? expenseDescription.trim() : undefined,
      }
    );
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to reconcile payment.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              {mode === 'cash_deposit' ? <CheckCircle2 size={18} /> : <Handshake size={18} />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Reconcile Payment or Offset
              </h2>
              <p className="text-xs text-slate-400">
                From {receivable.debtorName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleRepay} className="p-4 space-y-3.5 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800 font-semibold">
            <button
              type="button"
              onClick={() => setMode('cash_deposit')}
              className={`py-1.5 rounded-md transition-colors cursor-pointer ${
                mode === 'cash_deposit'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cash / Bank Deposit
            </button>
            <button
              type="button"
              onClick={() => setMode('expense_offset')}
              className={`py-1.5 rounded-md transition-colors cursor-pointer ${
                mode === 'expense_offset'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Paid Expense for Me
            </button>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Target Loan Balance:</span>
              <span className="font-bold font-mono tabular-nums text-slate-200">
                {formatMoney(
                  receivable.outstandingAmount,
                  receivable.currency,
                  currSym,
                  settings.numberGrouping
                )}
              </span>
            </div>
            {debtorActiveLoans.length > 1 && (
              <div className="flex justify-between items-center text-[11px] text-slate-400 border-t border-slate-750 pt-1">
                <span>Total Owed Across All {debtorActiveLoans.length} Loans:</span>
                <span className="font-semibold font-mono tabular-nums text-emerald-400">
                  {formatMoney(
                    cascadeSimulation.totalDebtorBalance,
                    receivable.currency,
                    currSym,
                    settings.numberGrouping
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Repayment / Offset Amount */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">
              {mode === 'cash_deposit' ? 'Amount Received *' : 'Expense Amount Paid for You *'}
            </label>
            <input
              type="number"
              required
              min={0.01}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 font-mono tabular-nums font-semibold focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {mode === 'cash_deposit' ? (
            <div className="space-y-1">
              <label className="font-medium text-slate-300 flex items-center gap-1.5">
                <Landmark size={13} className="text-indigo-400" />
                Deposit To Bank Account
              </label>
              <select
                value={depositAccountId}
                onChange={(e) => setDepositAccountId(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-200"
              >
                <option value="">Clearing ledger only (no bank deposit)</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} (Balance: {(b.principalOrValue || 0).toLocaleString()} {b.currency})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500">
                Records a linked main ledger transaction and updates the receivable atomically.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <label className="font-medium text-slate-300">
                Expense / Item Paid on Your Behalf *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Lunch, Cab fare, Shared utility"
                value={expenseDescription}
                onChange={(e) => setExpenseDescription(e.target.value)}
                className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
              />
            </div>
          )}

          {/* Cascading Reconciliation & Settlement Preview */}
          {numericAmt > 0 && (
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-200 pb-1 border-b border-slate-850">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Layers size={13} />
                  <span>Cascading Paydown Breakdown</span>
                </div>
                <span className="font-mono tabular-nums text-slate-400">
                  Total: {formatMoney(numericAmt, receivable.currency, currSym, settings.numberGrouping)}
                </span>
              </div>

              {/* Slices */}
              <div className="space-y-1 font-mono text-[11px]">
                {cascadeSimulation.slices.map((slice) => (
                  <div key={slice.loanId} className="flex justify-between items-center text-slate-300">
                    <span className="font-sans text-slate-400 truncate max-w-[200px]">
                      {slice.label}:
                    </span>
                    <span className="tabular-nums">
                      {slice.appliedSlice > 0 ? (
                        <>
                          <span className="text-emerald-400">
                            -{formatMoney(slice.appliedSlice, receivable.currency, currSym, settings.numberGrouping)}
                          </span>
                          {' → '}
                          <span className={slice.isSettled ? 'text-slate-400' : 'text-slate-200'}>
                            {slice.isSettled ? 'Settled (0)' : formatMoney(slice.nextBalance, receivable.currency, currSym, settings.numberGrouping)}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">Untouched ({formatMoney(slice.currentBalance, receivable.currency, currSym, settings.numberGrouping)})</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>

              {/* Counterparty Net Remaining Status */}
              <div className="pt-1.5 border-t border-slate-850 flex justify-between items-center">
                <span className="font-medium text-slate-300">Debtor Settlement Status:</span>
                {cascadeSimulation.allDebtsSettled ? (
                  <span className="font-semibold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} />
                    <span>All Debts Settled (Owes ₹0)</span>
                  </span>
                ) : (
                  <span className="font-semibold font-mono tabular-nums text-amber-300">
                    Still owes {formatMoney(cascadeSimulation.totalRemaining, receivable.currency, currSym, settings.numberGrouping)}
                  </span>
                )}
              </div>

              {/* Surplus Money Deposited to Bank */}
              {cascadeSimulation.excessSurplus > 0.005 && (
                <div className="p-2 rounded-md bg-emerald-950/40 border border-emerald-800/50 text-emerald-300 text-[11px] space-y-0.5">
                  <div className="font-semibold flex items-center gap-1">
                    <Sparkles size={12} />
                    <span>Residual Extra Money: +{formatMoney(cascadeSimulation.excessSurplus, receivable.currency, currSym, settings.numberGrouping)}</span>
                  </div>
                  <p className="text-[10px] text-emerald-400/90 leading-tight">
                    All debts are cleared. Extra funds will be deposited directly to{' '}
                    <strong className="text-white">{selectedHolding?.name || 'Primary Bank Account'}</strong> and logged as a distinct ledger transaction.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Date */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">Date</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="font-medium text-slate-300">Notes</label>
            <input
              type="text"
              placeholder="Optional note"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-100 focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Confirm Reconciliation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
