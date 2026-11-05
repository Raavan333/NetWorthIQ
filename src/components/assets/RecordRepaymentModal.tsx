import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Receivable } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { X, CheckCircle2, Landmark, AlertCircle, Handshake } from 'lucide-react';

interface RecordRepaymentModalProps {
  receivable: Receivable;
  onClose: () => void;
}

export const RecordRepaymentModal: React.FC<RecordRepaymentModalProps> = ({
  receivable,
  onClose,
}) => {
  const { recordReceivableRepayment, holdings, currencies, settings } = useApp();

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

  const numericAmt = Number(amount) || 0;
  const cappedPrincipalReduction = Math.min(receivable.outstandingAmount, Math.max(0, numericAmt));
  const excessCreditAdvance = Math.max(0, numericAmt - receivable.outstandingAmount);
  const projectedRemaining = Math.max(0, receivable.outstandingAmount - cappedPrincipalReduction);

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

          <div className="p-2.5 rounded-lg bg-slate-800/40 border border-slate-800 flex justify-between items-center">
            <span className="text-slate-400">Current Receivable Balance:</span>
            <span className="font-bold font-mono tabular-nums text-slate-200">
              {formatMoney(
                receivable.outstandingAmount,
                receivable.currency,
                currSym,
                settings.numberGrouping
              )}
            </span>
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

          {/* Reconciliation Preview */}
          {numericAmt > 0 && (
            <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">New Receivable Principal:</span>
                <span className="font-mono tabular-nums font-semibold text-emerald-400">
                  {formatMoney(projectedRemaining, receivable.currency, currSym, settings.numberGrouping)}
                </span>
              </div>
              {excessCreditAdvance > 0.01 && (
                <div className="flex justify-between text-amber-300">
                  <span>Over-repayment Credit Advance (You owe {receivable.debtorName}):</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {formatMoney(excessCreditAdvance, receivable.currency, currSym, settings.numberGrouping)}
                  </span>
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
