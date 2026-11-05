import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { groupReceivablesByCounterparty } from '../../lib/counterpartyEngine';
import { X, Handshake, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatMoney } from '../../lib/formatters';

interface CounterpartyPaidMyBillModalProps {
  initialDebtorName?: string;
  onClose: () => void;
}

export const CounterpartyPaidMyBillModal: React.FC<CounterpartyPaidMyBillModalProps> = ({
  initialDebtorName = '',
  onClose,
}) => {
  const { counterpartyPaidMyBill, bills, receivables, settings, currencies } = useApp();

  const [debtorName, setDebtorName] = useState(initialDebtorName);
  const [selectedBillId, setSelectedBillId] = useState<string>('');
  const [customBillName, setCustomBillName] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';
  const fmt = (val: number) =>
    formatMoney(val, baseCurr, currSym, settings.numberGrouping, 0);

  // Active bills in queue (exclude peer-payable bills so a peer isn't settling a peer payable)
  const activeBills = useMemo(
    () => bills.filter((b) => !b.isOverriddenPaid && !b.isPeerBorrowBill),
    [bills]
  );

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
  const projectedNet = matchedPeer ? matchedPeer.netBalance - numAmt : -numAmt;

  const handleBillSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedBillId(val);
    if (val) {
      const b = activeBills.find((item) => item.id === val);
      if (b) {
        setAmount(b.amount);
        setCustomBillName(b.name);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!debtorName.trim()) {
      setError("Please enter the person's name.");
      return;
    }
    const finalBillName =
      customBillName.trim() ||
      (selectedBillId ? activeBills.find((b) => b.id === selectedBillId)?.name : '') ||
      'Personal Bill';
    if (!numAmt || numAmt <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    setIsSubmitting(true);
    const res = await counterpartyPaidMyBill({
      debtorName: debtorName.trim(),
      billId: selectedBillId || undefined,
      billName: finalBillName,
      amount: numAmt,
      date,
      notes: notes.trim() || undefined,
    });
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    } else {
      setError(res.error || 'Failed to record settlement.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
              <Handshake size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Someone Paid Your Bill
              </h2>
              <p className="text-[11px] text-slate-400">
                Clears your bill and offsets what they owe you (or logs what you owe them)
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
              Who Paid for You?
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Rahul, Sanjay, Priya"
              value={debtorName}
              onChange={(e) => setDebtorName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
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
                        ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-300'
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
              Bill from Your Queue <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <select
              value={selectedBillId}
              onChange={handleBillSelect}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="">-- Custom expense / bill not in queue --</option>
              {activeBills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({formatMoney(b.amount, b.currency, currSym)}) · Due day {b.dueDay}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-400">
              Bill / Expense Description
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Internet Bill, Groceries, Dinner"
              value={customBillName}
              onChange={(e) => setCustomBillName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                Amount Paid ({currSym})
              </label>
              <input
                type="number"
                required
                min="0.01"
                step="any"
                placeholder="e.g. 300"
                value={amount}
                onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 font-mono tabular-nums focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">Payment Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-slate-400">
              Notes <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g. Paid bill to settle previous cash loan"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300 leading-relaxed">
            {numAmt > 0 && debtorName.trim() ? (
              Math.abs(projectedNet) <= 0.01 ? (
                <span>
                  Clears this bill and settles your balance with{' '}
                  <strong className="text-white">{debtorName.trim()}</strong> to{' '}
                  <strong className="text-emerald-400 font-mono tabular-nums">{fmt(0)}</strong>{' '}
                  (archived automatically).
                </span>
              ) : projectedNet > 0 ? (
                <span>
                  Offsets <strong className="text-white font-mono tabular-nums">{fmt(numAmt)}</strong>
                  . <strong className="text-white">{debtorName.trim()}</strong> will still owe you{' '}
                  <strong className="text-emerald-400 font-mono tabular-nums">
                    {fmt(projectedNet)}
                  </strong>
                  .
                </span>
              ) : (
                <span>
                  Clears your bill without debiting your bank. You will owe{' '}
                  <strong className="text-white">{debtorName.trim()}</strong>{' '}
                  <strong className="text-amber-300 font-mono tabular-nums">
                    {fmt(Math.abs(projectedNet))}
                  </strong>{' '}
                  until settled.
                </span>
              )
            ) : (
              <span className="text-slate-400">
                Offsets what {debtorName.trim() || 'this person'} owes you first; any excess is
                tracked as a payable until you pay them back.
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
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              <span>Record Offset</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
