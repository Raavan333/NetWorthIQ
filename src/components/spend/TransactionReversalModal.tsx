import React, { useState, useMemo } from 'react';
import { Transaction, Holding, Liability } from '../../types';
import { useApp } from '../../context/AppContext';
import { validateReversalEligibility } from '../../lib/reversalEngine';
import { formatMoney } from '../../lib/formatters';
import { X, RotateCcw, AlertTriangle, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface Props {
  transaction: Transaction;
  onClose: () => void;
  onSuccess?: () => void;
}

export const TransactionReversalModal: React.FC<Props> = ({ transaction, onClose, onSuccess }) => {
  const { holdings, liabilities, transactions, reverseTransaction } = useApp();
  const [reason, setReason] = useState<string>('User requested deletion');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Validate eligibility & dependent transactions
  const eligibility = useMemo(() => {
    return validateReversalEligibility(transaction, transactions, holdings, liabilities);
  }, [transaction, transactions, holdings, liabilities]);

  // Identify source and destination entities
  const sourceHolding = holdings.find((h) => h.id === (transaction.fromId || transaction.sourceId));
  const sourceLiability = liabilities.find((l) => l.id === (transaction.fromId || transaction.sourceId));
  const destHolding = holdings.find((h) => h.id === transaction.toId);
  const destLiability = liabilities.find((l) => l.id === transaction.toId);

  // Compute restored balance preview
  const restorationPreview = useMemo(() => {
    const changes: { name: string; type: string; before: number; after: number; delta: string }[] = [];
    const amt = transaction.amount;

    if (transaction.kind === 'spend') {
      if (sourceHolding) {
        const cur = sourceHolding.principalOrValue || 0;
        changes.push({
          name: sourceHolding.name,
          type: 'Bank/Asset',
          before: cur,
          after: cur + amt,
          delta: `+${formatMoney(amt, transaction.currency)}`,
        });
      } else if (sourceLiability && sourceLiability.kind === 'card') {
        const cur = sourceLiability.outstanding || 0;
        changes.push({
          name: sourceLiability.name,
          type: 'Credit Card Outstanding',
          before: cur,
          after: Math.max(0, cur - amt),
          delta: `-${formatMoney(amt, transaction.currency)}`,
        });
      }
    } else if (transaction.kind === 'transfer') {
      if (sourceHolding) {
        const cur = sourceHolding.principalOrValue || 0;
        changes.push({
          name: sourceHolding.name,
          type: 'Source Account',
          before: cur,
          after: cur + amt,
          delta: `+${formatMoney(amt, transaction.currency)}`,
        });
      }
      if (destHolding) {
        const cur = destHolding.principalOrValue || 0;
        const receiveAmt = transaction.toAmount !== undefined ? transaction.toAmount : amt;
        changes.push({
          name: destHolding.name,
          type: 'Destination Account',
          before: cur,
          after: cur - receiveAmt,
          delta: `-${formatMoney(receiveAmt, transaction.currency)}`,
        });
      }
    } else if (transaction.kind === 'cardPayment') {
      if (sourceHolding) {
        const cur = sourceHolding.principalOrValue || 0;
        changes.push({
          name: sourceHolding.name,
          type: 'Bank Account',
          before: cur,
          after: cur + amt,
          delta: `+${formatMoney(amt, transaction.currency)}`,
        });
      }
      if (destLiability) {
        const cur = destLiability.outstanding || 0;
        changes.push({
          name: destLiability.name,
          type: 'Credit Card Outstanding',
          before: cur,
          after: cur + amt,
          delta: `+${formatMoney(amt, transaction.currency)}`,
        });
      }
    }

    return changes;
  }, [transaction, sourceHolding, sourceLiability, destHolding, destLiability]);

  const handleConfirmReversal = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await reverseTransaction(transaction.id, reason);
      if (res.success) {
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage(res.error || 'Failed to reverse transaction');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Error occurred during reversal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Reverse Transaction & Restore Balances</h3>
              <p className="text-xs text-neutral-400">Ledger Reversal & Audit Engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Target Transaction Details */}
          <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-neutral-400">Description:</span>
              <span className="font-semibold text-white">{transaction.reason}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Date:</span>
              <span className="text-neutral-200">{transaction.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Amount:</span>
              <span className="font-mono font-bold text-white">
                {formatMoney(transaction.amount, transaction.currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-400">Type:</span>
              <span className="capitalize text-neutral-300">{transaction.kind}</span>
            </div>
          </div>

          {/* Balance Restoration Preview */}
          {restorationPreview.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Projected Balance Restorations
              </label>
              <div className="space-y-2">
                {restorationPreview.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-xs flex items-center justify-between"
                  >
                    <div>
                      <span className="font-medium text-white block">{item.name}</span>
                      <span className="text-[11px] text-neutral-400">
                        {formatMoney(item.before, transaction.currency)} →{' '}
                        {formatMoney(item.after, transaction.currency)}
                      </span>
                    </div>
                    <span className="font-mono font-semibold text-emerald-400">{item.delta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Eligibility Warnings */}
          {!eligibility.canReverse && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-800/50 text-red-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{eligibility.reason}</span>
            </div>
          )}

          {/* Reason Input */}
          <div>
            <label className="text-xs font-medium text-neutral-300 mb-1 block">
              Reason for Reversal / Deletion
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-lg text-white text-xs focus:outline-hidden focus:border-amber-500"
              placeholder="e.g. Duplicate entry, merchant refund, entered wrong amount"
            />
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-red-950/60 text-red-300 border border-red-800/40 text-xs">
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white transition"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmReversal}
            disabled={!eligibility.canReverse || isSubmitting}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
          >
            {isSubmitting ? 'Reversing...' : 'Confirm Reversal & Restore'}
          </button>
        </div>
      </div>
    </div>
  );
};
