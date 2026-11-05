import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding } from '../../types';
import { Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import { formatMoney } from '../../lib/formatters';
import {
  isBankAccountHolding,
  getSafeAssetName,
  formatAssetOptionLabel,
} from '../../lib/assetRules';

interface SweepInRedeemModalProps {
  isOpen: boolean;
  onClose: () => void;
  holding: Holding;
}

export const SweepInRedeemModal: React.FC<SweepInRedeemModalProps> = ({
  isOpen,
  onClose,
  holding,
}) => {
  const { holdings, assetTypes, addTransaction, currencies } = useApp();

  const currSym = currencies.find((c) => c.code === holding.currency)?.symbol || '₹';

  const bankAccounts = useMemo(
    () => holdings.filter((h) => isBankAccountHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  const [targetAccountId, setTargetAccountId] = useState(
    holding.sweepInTargetAccountId && bankAccounts.some((b) => b.id === holding.sweepInTargetAccountId)
      ? holding.sweepInTargetAccountId
      : bankAccounts[0]?.id || ''
  );

  useEffect(() => {
    if (!targetAccountId || !bankAccounts.some((b) => b.id === targetAccountId)) {
      if (bankAccounts[0]) setTargetAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, targetAccountId]);

  const [redeemAmount, setRedeemAmount] = useState<string>(
    (holding.principalOrValue || 0).toString()
  );
  const [error, setError] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const targetAccount = bankAccounts.find((h) => h.id === targetAccountId) || bankAccounts[0];

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const amount = parseFloat(redeemAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid redemption amount');
      return;
    }

    if (amount > holding.principalOrValue) {
      setError(`Cannot redeem more than available deposit balance (${formatMoney(holding.principalOrValue, holding.currency, currSym)})`);
      return;
    }

    if (!targetAccount) {
      setError('Please select a destination bank account');
      return;
    }

    setIsProcessing(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      await addTransaction({
        id: `tx-sweep-${Date.now()}`,
        date: today,
        kind: 'transfer',
        amount,
        currency: holding.currency,
        fromId: holding.id,
        toId: targetAccount.id,
        sourceId: holding.id,
        reason: `Sweep-in Redemption: ${holding.name} to ${targetAccount.name}`,
        category: 'Sweep-In Redemption',
        fxRateUsed: 1.0,
      });

      setSuccessMessage(
        `Successfully redeemed ${formatMoney(amount, holding.currency, currSym)} into ${targetAccount.name}. Free cash and ledger updated!`
      );

      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 1600);
    } catch {
      setError('Failed to process redemption. Please try again.');
      setIsProcessing(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-end gap-2.5 w-full">
      <button
        type="button"
        onClick={onClose}
        disabled={isProcessing}
        className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="sweep-in-redeem-form"
        disabled={isProcessing}
        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
      >
        <Zap size={14} />
        <span>{isProcessing ? 'Redeeming...' : 'Confirm Instant Redemption'}</span>
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Instant Sweep-In Cash Redemption"
      subtitle={`Break funds immediately on demand with zero penalty`}
      footer={footer}
    >
      <form id="sweep-in-redeem-form" onSubmit={handleRedeem} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* Source Deposit Summary Card */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Sweep-In Source FD:</span>
            <span className="font-bold text-white flex items-center gap-1">
              <Zap size={13} className="text-emerald-400" />
              {getSafeAssetName(holding, assetTypes)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Current Deposit Balance:</span>
            <span className="font-mono font-bold text-emerald-400">
              {formatMoney(holding.principalOrValue, holding.currency, currSym)}
            </span>
          </div>
          {holding.fixedRatePct && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Interest Rate:</span>
              <span className="font-mono text-slate-300 font-semibold">
                {holding.fixedRatePct}% p.a.
              </span>
            </div>
          )}
        </div>

        {/* Amount to Redeem */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-300">
              Redemption Amount ({holding.currency})
            </label>
            <button
              type="button"
              onClick={() => setRedeemAmount(holding.principalOrValue.toString())}
              className="text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold cursor-pointer"
            >
              Max ({formatMoney(holding.principalOrValue, holding.currency, currSym)})
            </button>
          </div>
          <input
            type="number"
            step="any"
            value={redeemAmount}
            onChange={(e) => setRedeemAmount(e.target.value)}
            placeholder="e.g. 50000"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            required
          />
          <span className="text-[10px] text-slate-500 block mt-1">
            Redeemed cash instantly reflects in the linked bank account and is ready to spend.
          </span>
        </div>

        {/* Destination Bank Account */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Destination Bank Account
          </label>
          <select
            value={targetAccountId}
            onChange={(e) => setTargetAccountId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            {bankAccounts.length > 0 ? (
              bankAccounts.map((b) => {
                const bSym = currencies.find((c) => c.code === b.currency)?.symbol || `${b.currency} `;
                return (
                  <option key={b.id} value={b.id}>
                    {formatAssetOptionLabel(b, assetTypes, { currSymbol: bSym })}
                  </option>
                );
              })
            ) : (
              <option value="">No bank account available</option>
            )}
          </select>
          <span className="text-[10px] text-slate-500 block mt-1">
            The redeemed cash balance will immediately be credited into this account.
          </span>
        </div>

        {/* Ledger Confirmation Preview */}
        {targetAccount && redeemAmount && !isNaN(parseFloat(redeemAmount)) && parseFloat(redeemAmount) > 0 && (
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] space-y-1">
            <span className="font-semibold text-slate-300 block">Ledger Transfer Preview:</span>
            <div className="flex flex-wrap items-center gap-2 text-slate-400">
              <span className="text-white font-medium">{getSafeAssetName(holding, assetTypes)}</span>
              <ArrowRight size={12} className="text-emerald-400" />
              <span className="text-emerald-300 font-bold font-mono tabular-nums">
                {formatMoney(parseFloat(redeemAmount), holding.currency, currSym)}
              </span>
              <ArrowRight size={12} className="text-emerald-400" />
              <span className="text-white font-medium">{getSafeAssetName(targetAccount, assetTypes)}</span>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
};
