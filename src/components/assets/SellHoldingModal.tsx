import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Holding } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { isBankAccountHolding, isCashHolding } from '../../lib/assetRules';
import { ArrowDownRight, AlertTriangle } from 'lucide-react';

interface SellHoldingModalProps {
  isOpen: boolean;
  onClose: () => void;
  holding: Holding;
}

export const SellHoldingModal: React.FC<SellHoldingModalProps> = ({ isOpen, onClose, holding }) => {
  const { holdings, updateHolding, addTransaction, deleteHolding, assetTypes, currencies, settings } = useApp();

  const holdingVal = holding.principalOrValue || 0;
  const [sellAmount, setSellAmount] = useState<string>(holdingVal > 0 ? holdingVal.toString() : '0');
  const [destinationId, setDestinationId] = useState<string>(
    holdings.find((h) => h.id !== holding.id && (isBankAccountHolding(h, assetTypes) || isCashHolding(h, assetTypes)))?.id || ''
  );
  const [error, setError] = useState('');

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === (holding.currency || baseCurr))?.symbol || '₹';

  const bankOrCashHoldings = holdings.filter(
    (h) => h.id !== holding.id && (isBankAccountHolding(h, assetTypes) || isCashHolding(h, assetTypes))
  );

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const amt = parseFloat(sellAmount);
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid sale amount greater than 0.');
      return;
    }

    if (amt > holdingVal) {
      setError(`Cannot sell more than current holding balance (${formatMoney(holdingVal, holding.currency, currSym)}).`);
      return;
    }

    // Deduct from current holding
    const remainingValue = holdingVal - amt;
    if (remainingValue <= 0) {
      await deleteHolding(holding.id);
    } else {
      await updateHolding({
        ...holding,
        principalOrValue: remainingValue,
      });
    }

    // Add to destination bank if chosen
    if (destinationId) {
      const destHolding = holdings.find((h) => h.id === destinationId);
      if (destHolding) {
        await updateHolding({
          ...destHolding,
          principalOrValue: (destHolding.principalOrValue || 0) + amt,
        });
      }
    }

    // Record transaction
    const fx = currencies.find((c) => c.code === holding.currency)?.rateToBase || 1.0;
    await addTransaction({
      id: `sell-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      amount: amt,
      currency: holding.currency || baseCurr,
      kind: 'saleProceeds',
      reason: `Liquidated ${holding.name}`,
      category: 'Asset Liquidation',
      sourceId: holding.id,
      toId: destinationId || undefined,
      fxRateUsed: fx,
      createdAt: new Date().toISOString(),
    });

    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Liquidate / Sell: ${holding.name}`}
      subtitle="Sell or redeem partial or entire asset balance"
      maxWidth="max-w-md"
    >
      <form onSubmit={handleSell} className="space-y-4">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertTriangle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
          <span className="text-xs text-slate-400">Current Holding Balance</span>
          <div className="text-base font-bold text-white">
            {formatMoney(holdingVal, holding.currency || baseCurr, currSym)}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Redemption / Sale Amount
          </label>
          <input
            type="number"
            step="any"
            value={sellAmount}
            onChange={(e) => setSellAmount(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Deposit Proceeds Into (Optional)
          </label>
          <select
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            <option value="">Do not credit any account (external / cash exit)</option>
            {bankOrCashHoldings.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({formatMoney(h.principalOrValue || 0, h.currency, currSym)})
              </option>
            ))}
          </select>
        </div>

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
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <ArrowDownRight size={14} />
            <span>Confirm Redemption</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};
