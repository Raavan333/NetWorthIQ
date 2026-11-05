import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { Gift, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';

interface LogCashbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: Liability;
}

export const LogCashbackModal: React.FC<LogCashbackModalProps> = ({
  isOpen,
  onClose,
  card,
}) => {
  const { logCardCashback, currencies } = useApp();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('Promotional / Merchant Cashback');
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const curr = currencies.find((c) => c.code === card.currency);
  const currSymbol = curr?.symbol || card.currency;
  const currentCashback = card.accumulatedCashback || 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      setError('Please enter a valid positive cashback amount.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await logCardCashback(card.id, amtNum, note.trim());
      setIsSubmitting(false);
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.message || 'Failed to log cashback.');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Log Cashback: ${card.name}`}
      subtitle="Rewards reduce your statement balance on next billing cycle"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-1.5">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isSuccess && (
          <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>
              Cashback successfully logged! Next statement will be reduced by{' '}
              <strong>{formatMoney(parseFloat(amount) || 0, card.currency, currSymbol)}</strong>.
            </span>
          </div>
        )}

        <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Gift size={16} className="text-indigo-400" />
            <span className="text-indigo-200">Current Accumulated Cashback:</span>
          </div>
          <span className="font-mono font-bold text-emerald-400 text-sm">
            +{formatMoney(currentCashback, card.currency, currSymbol)}
          </span>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Cashback Amount Received ({card.currency})
          </label>
          <input
            type="number"
            step="any"
            placeholder="e.g. 500"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white font-mono font-bold focus:outline-none focus:border-indigo-500"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Reward Description / Source
          </label>
          <input
            type="text"
            placeholder="e.g. 5% Fuel Surcharge Waiver / Amazon Reward"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Recorded as income in your ledger under category &quot;Rewards &amp; Cashback&quot; and applied against your card statement.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || isSuccess}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md shadow-indigo-600/25 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Sparkles size={14} />
            <span>{isSubmitting ? 'Logging...' : 'Log Cashback'}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
