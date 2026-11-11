import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { ScheduledTransfer } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { computeNextScheduledDate } from '../../lib/scheduledTransfers';
import { Calendar, Plus, Trash2, Check, Clock, ArrowRight, ToggleLeft, ToggleRight, Sparkles } from 'lucide-react';

export const ScheduledTransfersManager: React.FC = () => {
  const {
    scheduledTransfers,
    addScheduledTransfer,
    updateScheduledTransfer,
    deleteScheduledTransfer,
    holdings,
    liabilities,
    settings,
  } = useApp();

  const [isOpenAdd, setIsOpenAdd] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(settings.baseCurrency || 'INR');
  const [dayOfMonth, setDayOfMonth] = useState('5');
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly' | 'once'>('monthly');

  // Valid sources: holdings and cards. Term loans CANNOT be sources!
  const validSources = [
    ...holdings.map((h) => ({ id: h.id, name: `[Asset] ${h.name} (${h.currency})`, currency: h.currency })),
    ...liabilities
      .filter((l) => l.kind === 'card')
      .map((c) => ({ id: c.id, name: `[Card] ${c.name} (${c.currency})`, currency: c.currency })),
  ];

  // Valid destinations: holdings or liabilities
  const validDestinations = [
    ...holdings.map((h) => ({ id: h.id, name: `[Asset] ${h.name} (${h.currency})`, currency: h.currency })),
    ...liabilities.map((l) => ({ id: l.id, name: `[Pay Down ${l.kind === 'card' ? 'Card' : 'Loan'}] ${l.name} (${l.currency})`, currency: l.currency })),
  ];

  const [fromId, setFromId] = useState(validSources[0]?.id || '');
  const [toId, setToId] = useState(validDestinations[1]?.id || validDestinations[0]?.id || '');
  const [error, setError] = useState('');

  const handleSaveTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a name for this transfer');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    if (!fromId || !toId || !validSources.some((s) => s.id === fromId) || !validDestinations.some((d) => d.id === toId)) {
      setError('A valid source and destination account are required. Please define and add your financial accounts first before scheduling transfers.');
      return;
    }
    if (fromId === toId) {
      setError('Source and destination accounts must be different');
      return;
    }

    const schedDay = parseInt(dayOfMonth, 10) || 1;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const nextDate = computeNextScheduledDate(schedDay, frequency, today);

    // If today is past the scheduled day this month, mark current month as already passed
    // so that the scheduler strictly waits for the upcoming date (e.g. 5th of next month)
    const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const initialLastExecutedMonth = today.getDate() > schedDay ? currentYearMonth : undefined;

    const newTransfer: ScheduledTransfer = {
      id: `sched-${Date.now()}`,
      name: name.trim(),
      fromId,
      toId,
      amount: amt,
      currency,
      dayOfMonth: schedDay,
      frequency,
      isActive: true,
      createdAt: todayStr,
      nextExecutionDate: nextDate,
      lastExecutedMonth: initialLastExecutedMonth,
    };

    await addScheduledTransfer(newTransfer);
    setIsOpenAdd(false);
    setName('');
    setAmount('');
    setError('');
  };

  const handleToggleActive = async (transfer: ScheduledTransfer) => {
    const nextActive = !transfer.isActive;
    const today = new Date();
    const nextDate = nextActive
      ? computeNextScheduledDate(transfer.dayOfMonth, transfer.frequency, today, transfer.lastExecutedMonth)
      : transfer.nextExecutionDate;

    await updateScheduledTransfer({
      ...transfer,
      isActive: nextActive,
      nextExecutionDate: nextDate,
    });
  };

  return (
    <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <Calendar size={15} className="text-cyan-400" />
            <span>Scheduled Auto-Transfers</span>
          </h4>
          <p className="text-xs text-slate-400">
            Automatically execute recurring internal rebalancing, SIP investments, rent transfers, or debt prepayments when target dates arrive.
          </p>
        </div>

        {!isOpenAdd && (
          <button
            onClick={() => setIsOpenAdd(true)}
            className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Plus size={13} /> Schedule Transfer
          </button>
        )}
      </div>

      {/* Add Form Modal/Block */}
      {isOpenAdd && (
        <form onSubmit={handleSaveTransfer} className="p-4 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-3">
          <div className="text-xs font-bold text-white flex items-center gap-1.5">
            <Sparkles size={14} className="text-cyan-400" />
            <span>Create Auto-Executing Scheduled Transfer</span>
          </div>

          {error && <div className="p-2 rounded-lg bg-rose-500/20 text-rose-300 text-xs">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Transfer Name / Purpose</label>
              <input
                type="text"
                placeholder="e.g. Monthly SIP to Index Fund, Rent allocation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Amount</label>
              <input
                type="number"
                step="any"
                placeholder="10000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Transfer From (Source)</label>
              <select
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                required
              >
                {validSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Transfer To (Destination)</label>
              <select
                value={toId}
                onChange={(e) => setToId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                required
              >
                {validDestinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Day of Month (1 - 31)</label>
              <input
                type="number"
                min="1"
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
              >
                <option value="monthly">Monthly (Every month on date)</option>
                <option value="quarterly">Quarterly (Every 3 months on date)</option>
                <option value="once">One-Time (Runs once on next date)</option>
              </select>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/20 text-[11px] text-cyan-300">
            The ledger automatically records and moves balances when this date hits without requiring manual user intervention.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsOpenAdd(false)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
            >
              <Check size={13} /> Save Schedule
            </button>
          </div>
        </form>
      )}

      {/* Scheduled Transfers List */}
      {scheduledTransfers.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-950 border border-slate-800 text-center text-xs text-slate-400">
          No scheduled transfers defined. Automate your monthly SIPs, savings transfers, or card payments so you never have to enter them manually.
        </div>
      ) : (
        <div className="space-y-2.5">
          {scheduledTransfers.map((st) => {
            const fromName = validSources.find((s) => s.id === st.fromId)?.name || 'Source Account';
            const toName = validDestinations.find((d) => d.id === st.toId)?.name || 'Destination Account';

            return (
              <div
                key={st.id}
                className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:border-slate-700 transition-colors w-full min-w-0 max-w-full overflow-hidden"
              >
                <div className="space-y-1.5 min-w-0 flex-1 w-full max-w-full overflow-hidden">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 max-w-full">
                    <span className="text-xs font-bold text-white break-words line-clamp-2 max-w-full" title={st.name}>
                      {st.name}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase shrink-0 ${
                        st.isActive
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {st.isActive ? 'Active' : 'Paused'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                      {st.dayOfMonth}th of month ({st.frequency})
                    </span>
                    {st.isActive && (
                      <span className="text-[10px] text-cyan-400 font-mono truncate max-w-full">
                        • Next: {st.nextExecutionDate || computeNextScheduledDate(st.dayOfMonth, st.frequency, new Date(), st.lastExecutedMonth)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 font-mono min-w-0 max-w-full">
                    <span className="text-slate-400 truncate max-w-[120px] sm:max-w-[200px]" title={fromName}>{fromName}</span>
                    <ArrowRight size={11} className="text-slate-500 shrink-0" />
                    <span className="text-emerald-400 truncate max-w-[120px] sm:max-w-[200px]" title={toName}>{toName}</span>
                  </div>

                  {st.lastExecutedDate ? (
                    <div className="text-[10px] text-slate-500 truncate max-w-full">
                      Last executed: {st.lastExecutedDate}
                    </div>
                  ) : st.lastExecutedMonth ? (
                    <div className="text-[10px] text-slate-500 truncate max-w-full">
                      Last executed month: {st.lastExecutedMonth}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800 shrink-0">
                  <div className="text-sm font-bold font-mono text-white shrink-0">
                    {formatMoney(st.amount, st.currency)}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(st)}
                      className={`p-1 rounded cursor-pointer ${
                        st.isActive ? 'text-emerald-400 hover:text-emerald-300' : 'text-slate-500 hover:text-slate-400'
                      }`}
                      title={st.isActive ? 'Pause Schedule' : 'Resume Schedule'}
                    >
                      {st.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        deleteScheduledTransfer(st.id);
                      }}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 cursor-pointer"
                      title="Delete Schedule"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
