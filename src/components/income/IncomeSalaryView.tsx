import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { IncomeStream, Transaction } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import { Briefcase, Plus, Check, Trash2, Edit2, Zap, ArrowUpRight, Gift } from 'lucide-react';

export const IncomeSalaryView: React.FC = () => {
  const {
    incomeStreams,
    holdings,
    currencies,
    addIncomeStream,
    updateIncomeStream,
    deleteIncomeStream,
    postSalary,
    addTransaction,
    settings,
    setActiveModal,
  } = useApp();

  const [isAddIncomeOpen, setIsAddIncomeOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<IncomeStream | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(settings.baseCurrency || 'INR');
  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'biweekly' | 'quarterly' | 'yearly'>('monthly');
  const [payScheduleType, setPayScheduleType] = useState<'fixed_day' | 'last_working_day' | 'last_calendar_day'>('fixed_day');
  const [payDay, setPayDay] = useState('30');
  const [depositAccountId, setDepositAccountId] = useState(holdings[0]?.id || '');
  const [grossOrNet, setGrossOrNet] = useState<'gross' | 'net'>('net');
  const [error, setError] = useState('');

  // Ad-hoc quick income modal
  const [isAdHocOpen, setIsAdHocOpen] = useState(false);
  const [adHocAmount, setAdHocAmount] = useState('');
  const [adHocReason, setAdHocReason] = useState('Freelance / Bonus');
  const [adHocDepositId, setAdHocDepositId] = useState(holdings[0]?.id || '');
  const [adHocError, setAdHocError] = useState('');

  const bankHoldings = holdings.filter((h) => h.liquidityClass === 'Immediate' || h.typeId === 'type-bank');

  const handleOpenAdd = (inc?: IncomeStream) => {
    if (inc) {
      setEditingIncome(inc);
      setName(inc.name);
      setAmount(inc.amountPerPeriod.toString());
      setCurrency(inc.currency);
      setPeriod(inc.period);
      setPayScheduleType(inc.payScheduleType || 'fixed_day');
      setPayDay(inc.payDay.toString());
      setDepositAccountId(inc.depositAccountId || bankHoldings[0]?.id || '');
      setGrossOrNet(inc.grossOrNet);
    } else {
      setEditingIncome(null);
      setName('');
      setAmount('');
      setCurrency(settings.baseCurrency || 'INR');
      setPeriod('monthly');
      setPayScheduleType('fixed_day');
      setPayDay('30');
      setDepositAccountId(bankHoldings[0]?.id || holdings[0]?.id || '');
      setGrossOrNet('net');
    }
    setError('');
    setIsAddIncomeOpen(true);
  };

  const handleSaveIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      setError('Valid amount required');
      return;
    }

    if (!depositAccountId || !bankHoldings.some((b) => b.id === depositAccountId)) {
      setError('A valid destination deposit account is required. Please define and add your bank or savings account first.');
      return;
    }

    const data: IncomeStream = {
      id: editingIncome?.id || `inc-${Date.now()}`,
      name: name.trim(),
      amountPerPeriod: amt,
      period,
      payScheduleType,
      payDay: parseInt(payDay, 10) || 1,
      depositAccountId,
      currency,
      grossOrNet,
    };

    if (editingIncome) {
      await updateIncomeStream(data);
    } else {
      await addIncomeStream(data);
    }
    setIsAddIncomeOpen(false);
  };

  const handleSaveAdHoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdHocError('');
    const amt = parseFloat(adHocAmount);
    if (isNaN(amt) || amt <= 0) {
      setAdHocError('Please enter a valid earnings amount.');
      return;
    }
    if (!adHocDepositId || !holdings.some((h) => h.id === adHocDepositId)) {
      setAdHocError('A valid destination deposit account is required. Please define and add a bank account first.');
      return;
    }

    const curr = currencies.find((c) => c.code === settings.baseCurrency);
    const fxRate = curr?.rateToBase || 1.0;

    const tx: Transaction = {
      id: `tx-adhoc-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      kind: 'income',
      amount: amt,
      currency: settings.baseCurrency || 'INR',
      toId: adHocDepositId,
      reason: adHocReason.trim() || 'Ad-Hoc Earnings',
      category: 'Bonus',
      fxRateUsed: fxRate,
    };

    await addTransaction(tx);
    setIsAdHocOpen(false);
    setAdHocAmount('');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Income & Salary Streams</h2>
          <p className="text-xs text-slate-400">
            Automated recurring salaries, payday posting confirmations, and ad-hoc bonus logging
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setActiveModal('receiveMoney')}
            className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/40 hover:bg-emerald-500/25 text-xs font-semibold text-emerald-300 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Gift size={14} className="text-emerald-400" />
            <span>Receive Gift / Inflow</span>
          </button>
          <button
            onClick={() => setIsAdHocOpen(true)}
            className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Zap size={14} className="text-amber-400" />
            <span>Ad-hoc Earnings</span>
          </button>
          <button
            onClick={() => handleOpenAdd()}
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
          >
            <Plus size={15} />
            <span>Salary Stream</span>
          </button>
        </div>
      </div>

      {/* Income Streams List */}
      {incomeStreams.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
          No regular income streams recorded. Add your salary to calculate your Net Rate velocity.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {incomeStreams.map((inc) => {
            const depositBank = holdings.find((h) => h.id === inc.depositAccountId);

            return (
              <div
                key={inc.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-white">{inc.name}</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                        {inc.period} • {inc.grossOrNet.toUpperCase()}
                      </span>
                    </div>

                    <div className="text-right">
                      <div className="text-base font-bold text-emerald-400 font-mono">
                        +{formatMoney(inc.amountPerPeriod, inc.currency)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Pay day: {inc.payDay}th of month
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 mt-2 truncate">
                    Deposited to: <strong className="text-slate-300">{depositBank?.name || 'Primary Bank'}</strong>
                  </p>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-slate-800/60 mt-3">
                  <button
                    onClick={() => postSalary(inc.id)}
                    className="px-3 py-1 rounded-lg bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Check size={13} />
                    <span>Post Salary Credit</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleOpenAdd(inc)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => {
                        deleteIncomeStream(inc.id);
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Delete salary stream"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {isAddIncomeOpen && (
        <Modal
          isOpen={isAddIncomeOpen}
          onClose={() => setIsAddIncomeOpen(false)}
          title={editingIncome ? 'Edit Income Stream' : 'Add Income Stream'}
          subtitle="Configure employment, consulting, or rental income"
        >
          <form onSubmit={handleSaveIncome} className="space-y-4">
            {error && <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs">{error}</div>}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Stream Name</label>
              <input
                type="text"
                placeholder="e.g. Primary Tech Salary, Consulting Retainer"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Amount per Period</label>
                <input
                  type="number"
                  step="any"
                  placeholder="125000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Frequency</label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Pay Day Schedule</label>
                <select
                  value={payScheduleType}
                  onChange={(e) => setPayScheduleType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  <option value="fixed_day">Specific Day of Month</option>
                  <option value="last_working_day">Last Working Day (Mon-Fri)</option>
                  <option value="last_calendar_day">Last Day of Month (30th/31st)</option>
                </select>
              </div>
            </div>

            {payScheduleType === 'fixed_day' ? (
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Day of Month (1 - 31)</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={payDay}
                  onChange={(e) => setPayDay(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>
            ) : payScheduleType === 'last_working_day' ? (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                <span>Auto-schedules for the last business day of the month (Monday - Friday). If the last calendar day falls on Saturday or Sunday, salary posts on the preceding Friday.</span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-400">
                <span>Automatically posts on the last calendar day (28th/29th/30th/31st depending on month).</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Deposit To Bank Account</label>
              <select
                value={depositAccountId}
                onChange={(e) => setDepositAccountId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
              >
                {bankHoldings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.currency})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAddIncomeOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                {editingIncome ? 'Save Changes' : 'Add Stream'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Ad-Hoc Earnings Quick Modal */}
      {isAdHocOpen && (
        <Modal
          isOpen={isAdHocOpen}
          onClose={() => setIsAdHocOpen(false)}
          title="Log Ad-Hoc Earnings / Bonus"
          subtitle="Direct deposit bonus, freelance payout, or dividend directly to cash"
        >
          <form onSubmit={handleSaveAdHoc} className="space-y-4">
            {adHocError && (
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs">{adHocError}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
              <input
                type="text"
                placeholder="Freelance Project, Q3 Performance Bonus"
                value={adHocReason}
                onChange={(e) => setAdHocReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Amount ({settings.baseCurrency})
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={adHocAmount}
                  onChange={(e) => setAdHocAmount(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Credit Account</label>
                <select
                  value={adHocDepositId}
                  onChange={(e) => setAdHocDepositId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200"
                >
                  {bankHoldings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsAdHocOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                Credit Account
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
