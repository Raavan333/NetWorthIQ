import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  isSpendableLiquidHolding,
  formatAssetOptionLabel,
  formatCardOptionLabel,
} from '../../lib/assetRules';
import { groupReceivablesByCounterparty } from '../../lib/counterpartyEngine';
import { formatMoney } from '../../lib/formatters';
import { X, Receipt, AlertCircle, CheckCircle2 } from 'lucide-react';

interface PayBillForCounterpartyModalProps {
  initialDebtorName?: string;
  onClose: () => void;
}

export const PayBillForCounterpartyModal: React.FC<PayBillForCounterpartyModalProps> = ({
  initialDebtorName = '',
  onClose,
}) => {
  const {
    payBillForCounterparty,
    receivables,
    holdings,
    liabilities,
    assetTypes,
    spendCategories,
    settings,
    currencies,
  } = useApp();

  const [debtorName, setDebtorName] = useState(initialDebtorName);
  const [billDescription, setBillDescription] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('Bills & Utilities');
  const [interestRatePct, setInterestRatePct] = useState<number | ''>(0);
  const [expectedDate, setExpectedDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const spendableHoldings = holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes));
  const creditCards = liabilities.filter((l) => l.kind === 'card' && l.cardType !== 'debit');

  const defaultSourceId = spendableHoldings[0]?.id || creditCards[0]?.id || '';
  const [paymentSourceId, setPaymentSourceId] = useState(defaultSourceId);

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';
  const fmt = (val: number) =>
    formatMoney(val, baseCurr, currSym, settings.numberGrouping, 0);

  const activePeers = useMemo(
    () =>
      groupReceivablesByCounterparty(receivables).filter(
        (g) => g.status === 'active' && Math.abs(g.netBalance) > 0.01
      ),
    [receivables]
  );

  const matchedPeer = useMemo(() => {
    const key = debtorName.trim().toLowerCase();
    if (!key) return undefined;
    return activePeers.find((p) => p.name.toLowerCase() === key);
  }, [activePeers, debtorName]);

  const numAmt = Number(amount) || 0;
  const projectedNet = matchedPeer ? matchedPeer.netBalance + numAmt : numAmt;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!debtorName.trim()) {
      setError("Please enter the person's name.");
      return;
    }
    if (!billDescription.trim()) {
      setError('Please enter which bill or expense was paid.');
      return;
    }
    if (!numAmt || numAmt <= 0) {
      setError('Please enter a valid amount.');
      return;
    }
    if (!paymentSourceId) {
      setError('Please select a payment account or card.');
      return;
    }

    setIsSubmitting(true);
    const res = await payBillForCounterparty({
      debtorName: debtorName.trim(),
      billDescription: billDescription.trim(),
      amount: numAmt,
      paymentSourceId,
      category,
      interestRatePct: Number(interestRatePct) || 0,
      expectedDate: expectedDate || undefined,
    });
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to record bill payment.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
              <Receipt size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Pay a Bill for Someone
              </h2>
              <p className="text-[11px] text-slate-400">
                Clears what you owe them first, or adds to what they owe you
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-rose-300 flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-400">
              Person&apos;s Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Rahul, Sanjay, Priya"
              value={debtorName}
              onChange={(e) => setDebtorName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            {activePeers.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {activePeers.slice(0, 6).map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setDebtorName(p.name)}
                    className={`px-2 py-0.5 rounded-md text-[10px] border cursor-pointer transition-colors ${
                      debtorName.trim().toLowerCase() === p.name.toLowerCase()
                        ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {p.name} ({p.netBalance >= 0 ? `owes ${fmt(p.netBalance)}` : `you owe ${fmt(Math.abs(p.netBalance))}`})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-400">
              Bill / Expense Paid
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Electricity bill, Dinner, Broadband"
              value={billDescription}
              onChange={(e) => setBillDescription(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                Amount ({currSym})
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="any"
                placeholder="e.g. 500"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                {spendCategories.map((c, idx) => (
                  <option key={`${c.id || 'cat'}-${idx}`} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-400">
              Pay From Account or Card
            </label>
            <select
              value={paymentSourceId}
              onChange={(e) => setPaymentSourceId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <optgroup label="Liquid Bank Accounts">
                {spendableHoldings.map((h) => (
                  <option key={h.id} value={h.id}>
                    {formatAssetOptionLabel(h, assetTypes)}
                  </option>
                ))}
              </optgroup>
              {creditCards.length > 0 && (
                <optgroup label="Credit Cards">
                  {creditCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {formatCardOptionLabel(c, 'credit')}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                Interest Rate % <span className="text-slate-500 font-normal">(0% default)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder="0"
                value={interestRatePct}
                onChange={(e) =>
                  setInterestRatePct(e.target.value === '' ? '' : Number(e.target.value))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                Expected Date <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300 leading-relaxed">
            {numAmt > 0 && debtorName.trim() ? (
              Math.abs(projectedNet) <= 0.01 ? (
                <span>
                  This payment clears your balance with{' '}
                  <strong className="text-white">{debtorName.trim()}</strong> to{' '}
                  <strong className="text-emerald-400 font-mono tabular-nums">{fmt(0)}</strong> and
                  archives it.
                </span>
              ) : projectedNet > 0 ? (
                <span>
                  After this payment, <strong className="text-white">{debtorName.trim()}</strong>{' '}
                  will owe you{' '}
                  <strong className="text-emerald-400 font-mono tabular-nums">
                    {fmt(projectedNet)}
                  </strong>{' '}
                  in total.
                </span>
              ) : (
                <span>
                  Offsets <strong className="text-white font-mono tabular-nums">{fmt(numAmt)}</strong>{' '}
                  of what you owe <strong className="text-white">{debtorName.trim()}</strong>,
                  leaving{' '}
                  <strong className="text-amber-300 font-mono tabular-nums">
                    {fmt(Math.abs(projectedNet))}
                  </strong>
                  .
                </span>
              )
            ) : (
              <span className="text-slate-400">
                Any amount you owed {debtorName.trim() || 'this person'} is offset first; any
                remainder is grouped under their balance.
              </span>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              <span>Record Payment</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
