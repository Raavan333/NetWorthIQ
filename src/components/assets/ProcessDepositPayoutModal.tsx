import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding } from '../../types';
import { Building2, CheckCircle2, RefreshCw } from 'lucide-react';
import { formatMoney } from '../../lib/formatters';
import {
  isBankAccountHolding,
  getSafeAssetName,
  formatAssetOptionLabel,
} from '../../lib/assetRules';

interface ProcessDepositPayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  holding: Holding;
}

export const ProcessDepositPayoutModal: React.FC<ProcessDepositPayoutModalProps> = ({
  isOpen,
  onClose,
  holding,
}) => {
  const { holdings, assetTypes, updateHolding, addTransaction, currencies } = useApp();

  const currSym = currencies.find((c) => c.code === holding.currency)?.symbol || '₹';

  const bankAccounts = useMemo(
    () => holdings.filter((h) => isBankAccountHolding(h, assetTypes)),
    [holdings, assetTypes]
  );

  const freq = holding.interestPayoutFrequency || 'at_maturity';
  const renewal = holding.renewalOption || 'renew_principal_and_interest';

  const principal = holding.principalOrValue || 0;
  const ratePct = holding.fixedRatePct || 7.0;

  let calculatedInterest = 0;
  if (freq === 'monthly') {
    calculatedInterest = (principal * ratePct) / 100 / 12;
  } else if (freq === 'quarterly') {
    calculatedInterest = (principal * ratePct) / 100 / 4;
  } else {
    calculatedInterest = (principal * ratePct) / 100;
  }
  calculatedInterest = Math.round(calculatedInterest * 100) / 100;

  const totalMaturityPayout = Math.round((principal + calculatedInterest) * 100) / 100;

  const defaultTargetId =
    renewal === 'do_not_renew'
      ? holding.maturitySettlementAccountId || bankAccounts[0]?.id || ''
      : holding.interestPayoutAccountId || bankAccounts[0]?.id || '';

  const [destinationAccountId, setDestinationAccountId] = useState<string>(defaultTargetId);

  useEffect(() => {
    if (!destinationAccountId || !bankAccounts.some((b) => b.id === destinationAccountId)) {
      if (bankAccounts[0]) setDestinationAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, destinationAccountId]);

  const [overrideInterestAmount, setOverrideInterestAmount] = useState<string>(
    calculatedInterest.toString()
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const destAccount = bankAccounts.find((h) => h.id === destinationAccountId) || bankAccounts[0];

  const handleProcessSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const finalInterest = parseFloat(overrideInterestAmount);
    if (isNaN(finalInterest) || finalInterest < 0) {
      setError('Please specify a valid interest amount');
      return;
    }

    if (!destAccount && renewal !== 'renew_principal_and_interest') {
      setError('Please select a destination bank account for the payout');
      return;
    }

    setIsProcessing(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      if (renewal === 'do_not_renew') {
        // DO NOT RENEW: Entire Principal + Interest returned to Bank Account
        const totalCredited = principal + finalInterest;

        // 1. Credit bank account
        const updatedBank: Holding = {
          ...destAccount,
          principalOrValue: (destAccount.principalOrValue || 0) + totalCredited,
        };
        await updateHolding(updatedBank);

        // 2. Mark deposit matured with 0 balance
        const updatedHolding: Holding = {
          ...holding,
          principalOrValue: 0,
          isMatured: true,
          lastInterestSettledDate: today,
        };
        await updateHolding(updatedHolding);

        // 3. Log ledger transaction
        await addTransaction({
          id: `tx-dep-mat-${Date.now()}`,
          date: today,
          kind: 'transfer',
          amount: totalCredited,
          currency: holding.currency,
          fromId: holding.id,
          toId: destAccount.id,
          sourceId: holding.id,
          reason: `Deposit Maturity Settlement: ${holding.name} (Principal: ${formatMoney(principal, holding.currency, currSym)} + Interest: ${formatMoney(finalInterest, holding.currency, currSym)}) credited to ${destAccount.name}`,
          category: 'Deposit Maturity Settlement',
          fxRateUsed: 1.0,
        });

        setSuccessMessage(
          `Deposit matured! ${formatMoney(totalCredited, holding.currency, currSym)} credited to ${destAccount.name}. Ledger updated!`
        );
      } else if (renewal === 'renew_principal_only') {
        // RENEW PRINCIPAL ONLY: Interest is paid out to Bank; Principal rolls over to new term (+1 year)
        // 1. Credit interest to bank account
        if (destAccount && finalInterest > 0) {
          const updatedBank: Holding = {
            ...destAccount,
            principalOrValue: (destAccount.principalOrValue || 0) + finalInterest,
          };
          await updateHolding(updatedBank);

          // Log interest income in ledger
          await addTransaction({
            id: `tx-dep-int-${Date.now()}`,
            date: today,
            kind: 'income',
            amount: finalInterest,
            currency: holding.currency,
            toId: destAccount.id,
            sourceId: holding.id,
            reason: `Periodic Deposit Interest Payout: ${holding.name} (${holding.fixedRatePct}% p.a.) into ${destAccount.name}`,
            category: 'Interest Income',
            fxRateUsed: 1.0,
          });
        }

        // 2. Extend maturity date by 1 year (or term)
        const currentMat = holding.maturityDate ? new Date(holding.maturityDate) : new Date();
        const nextMat = new Date(currentMat);
        nextMat.setFullYear(nextMat.getFullYear() + 1);

        const updatedHolding: Holding = {
          ...holding,
          maturityDate: nextMat.toISOString().split('T')[0],
          lastInterestSettledDate: today,
          isMatured: false,
        };
        await updateHolding(updatedHolding);

        setSuccessMessage(
          `Interest of ${formatMoney(finalInterest, holding.currency, currSym)} paid to ${destAccount.name}. Principal ${formatMoney(principal, holding.currency, currSym)} renewed to ${nextMat.toISOString().split('T')[0]}!`
        );
      } else {
        // RENEW PRINCIPAL AND INTEREST: Cumulative roll-over (Principal grows by interest earned)
        const newPrincipal = principal + finalInterest;
        const currentMat = holding.maturityDate ? new Date(holding.maturityDate) : new Date();
        const nextMat = new Date(currentMat);
        nextMat.setFullYear(nextMat.getFullYear() + 1);

        const updatedHolding: Holding = {
          ...holding,
          principalOrValue: newPrincipal,
          maturityDate: nextMat.toISOString().split('T')[0],
          lastInterestSettledDate: today,
          isMatured: false,
        };
        await updateHolding(updatedHolding);

        // Log compound growth in ledger
        await addTransaction({
          id: `tx-dep-renew-${Date.now()}`,
          date: today,
          kind: 'income',
          amount: finalInterest,
          currency: holding.currency,
          toId: holding.id,
          sourceId: holding.id,
          reason: `Deposit Compounding Renewal: ${holding.name} interest reinvested into principal. New balance: ${formatMoney(newPrincipal, holding.currency, currSym)}`,
          category: 'Interest Reinvestment',
          fxRateUsed: 1.0,
        });

        setSuccessMessage(
          `Deposit renewed with interest compounding! New principal balance: ${formatMoney(newPrincipal, holding.currency, currSym)}, maturing ${nextMat.toISOString().split('T')[0]}.`
        );
      }

      setTimeout(() => {
        setIsProcessing(false);
        onClose();
      }, 1800);
    } catch {
      setError('Failed to process settlement. Please try again.');
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
        form="process-deposit-form"
        disabled={isProcessing}
        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
      >
        <Building2 size={14} />
        <span>{isProcessing ? 'Processing...' : 'Execute Settlement & Update Ledger'}</span>
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Deposit Repayment & Maturity Settlement"
      subtitle={`Process periodic interest payouts or maturity settlement into your bank accounts`}
      footer={footer}
    >
      <form id="process-deposit-form" onSubmit={handleProcessSettlement} className="space-y-4">
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

        {/* Deposit Summary Card */}
        <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Fixed Deposit / Bond:</span>
            <span className="font-bold text-white flex items-center gap-1">
              <Building2 size={13} className="text-emerald-400" />
              {getSafeAssetName(holding, assetTypes)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Principal Balance:</span>
            <span className="font-mono font-bold text-white">
              {formatMoney(principal, holding.currency, currSym)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Annual Return Rate:</span>
            <span className="font-mono text-emerald-400 font-semibold">
              {ratePct}% p.a.
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Repayment Frequency:</span>
            <span className="text-slate-300 font-medium capitalize">
              {freq.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Renewal Policy:</span>
            <span className="text-slate-300 font-medium capitalize">
              {renewal.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        {/* Calculated Interest Amount Input */}
        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Interest Amount ({holding.currency})
          </label>
          <input
            type="number"
            step="any"
            value={overrideInterestAmount}
            onChange={(e) => setOverrideInterestAmount(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            required
          />
          <span className="text-[10px] text-slate-500 block mt-1">
            Calculated at {ratePct}% p.a. for {freq.replace('_', ' ')} schedule. You can adjust if actual credit differs.
          </span>
        </div>

        {/* Destination Bank Account Selection (if not renewing or renewing principal only) */}
        {renewal !== 'renew_principal_and_interest' ? (
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Credited To Bank Account
            </label>
            <select
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
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
              {renewal === 'do_not_renew'
                ? `Full maturity amount (${formatMoney(totalMaturityPayout, holding.currency, currSym)}) will be credited here.`
                : `Interest payout of ${formatMoney(parseFloat(overrideInterestAmount) || calculatedInterest, holding.currency, currSym)} will be credited here.`}
            </span>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <RefreshCw size={14} className="text-emerald-400" />
              <span>Cumulative Auto-Renewal</span>
            </div>
            <p className="text-[11px] text-emerald-400/90 leading-snug">
              Interest of {formatMoney(parseFloat(overrideInterestAmount) || calculatedInterest, holding.currency, currSym)} is reinvested into the deposit principal, creating a new compounded balance of{' '}
              <strong className="text-white">
                {formatMoney(principal + (parseFloat(overrideInterestAmount) || calculatedInterest), holding.currency, currSym)}
              </strong>{' '}
              for the next term.
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
};
