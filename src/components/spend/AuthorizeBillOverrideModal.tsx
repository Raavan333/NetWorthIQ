import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Bill } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { ShieldAlert, Lock, AlertTriangle } from 'lucide-react';

interface AuthorizeBillOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  bill: Bill;
}

export const AuthorizeBillOverrideModal: React.FC<AuthorizeBillOverrideModalProps> = ({
  isOpen,
  onClose,
  bill,
}) => {
  const { overrideBillPaid, settings } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (settings.pinLockEnabled && !pin) {
      setError('Please enter your 4-digit vault PIN to authorize this manual override.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await overrideBillPaid(bill.id, pin);
      if (!res.success) {
        setError(res.error || 'Failed to authorize override');
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authorization failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Manual Bill Override"
      subtitle={`Force mark "${bill.name}" as paid without automatic account debit`}
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Bill Amount:</span>
            <span className="font-bold text-white text-sm">
              {formatMoney(bill.amount, bill.currency)}
            </span>
          </div>
          <div className="flex items-center justify-between text-slate-400">
            <span>Due Date / Frequency:</span>
            <span className="text-slate-200">
              Day {bill.dueDay} ({bill.frequency || 'monthly'})
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Manual override marks this recurring bill cycle as fulfilled without deducting cash from linked liquid bank accounts.
        </p>

        {settings.pinLockEnabled && (
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Lock size={13} className="text-slate-400" />
              <span>Enter Security PIN to Confirm:</span>
            </label>
            <input
              type="password"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-center text-sm tracking-widest text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
              required
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold cursor-pointer transition-colors shadow-sm disabled:opacity-50"
          >
            {isSubmitting ? 'Verifying...' : 'Confirm Override'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
