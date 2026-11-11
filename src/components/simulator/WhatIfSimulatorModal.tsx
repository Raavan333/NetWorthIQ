import React, { useState, useMemo } from 'react';
import { Currency } from '../../types';
import { useApp } from '../../context/AppContext';
import { runWhatIfSimulation } from '../../lib/whatIfSimulator';
import { formatMoney } from '../../lib/formatters';
import {
  X,
  Sparkles,
  TrendingUp,
  Calendar,
  ShieldCheck,
  DollarSign,
  Sliders,
  RotateCcw,
  Clock,
  ArrowRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from 'lucide-react';

interface Props {
  onClose: () => void;
}

export const WhatIfSimulatorModal: React.FC<Props> = ({ onClose }) => {
  const { holdings, liabilities, bills, settings, currencies } = useApp();

  const activeLoans = useMemo(
    () => liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0),
    [liabilities]
  );
  const activeCards = useMemo(
    () => liabilities.filter((l) => l.kind === 'card' && (l.outstanding || 0) > 0),
    [liabilities]
  );

  const [extraLoanPayment, setExtraLoanPayment] = useState<number>(5000);
  const [selectedLoanId, setSelectedLoanId] = useState<string>(activeLoans[0]?.id || '');
  const [additionalSavings, setAdditionalSavings] = useState<number>(0);
  const [cardLumpSum, setCardLumpSum] = useState<number>(0);
  const [selectedCardId, setSelectedCardId] = useState<string>(activeCards[0]?.id || '');

  const currMap = useMemo(() => {
    const map: Record<string, Currency> = {};
    for (const c of currencies) map[c.code] = c;
    return map;
  }, [currencies]);

  const baseSymbol = useMemo(() => {
    return currencies.find((c) => c.code === settings.baseCurrency)?.symbol || `${settings.baseCurrency} `;
  }, [currencies, settings.baseCurrency]);

  const fmt = (amt: number, dec: number = 0) =>
    formatMoney(amt, settings.baseCurrency, baseSymbol, settings.numberGrouping, dec);

  const scenario = useMemo(() => {
    return runWhatIfSimulation(
      {
        name: 'Personal Simulation Plan',
        monthlyExtraLoanPayment: extraLoanPayment,
        targetLoanId: selectedLoanId || undefined,
        additionalMonthlySavings: additionalSavings,
        creditCardLumpSumPayment: cardLumpSum,
        targetCardId: selectedCardId || undefined,
      },
      holdings,
      liabilities,
      bills,
      settings,
      currMap
    );
  }, [
    extraLoanPayment,
    selectedLoanId,
    additionalSavings,
    cardLumpSum,
    selectedCardId,
    holdings,
    liabilities,
    bills,
    settings,
    currMap,
  ]);

  // Quick Strategy Presets
  const applyPreset = (preset: 'debt' | 'balanced' | 'savings' | 'reset') => {
    if (preset === 'debt') {
      setExtraLoanPayment(10000);
      setAdditionalSavings(0);
      setCardLumpSum(activeCards[0] ? Math.min(25000, activeCards[0].outstanding) : 10000);
    } else if (preset === 'balanced') {
      setExtraLoanPayment(4000);
      setAdditionalSavings(5000);
      setCardLumpSum(0);
    } else if (preset === 'savings') {
      setExtraLoanPayment(0);
      setAdditionalSavings(15000);
      setCardLumpSum(0);
    } else {
      setExtraLoanPayment(0);
      setAdditionalSavings(0);
      setCardLumpSum(0);
    }
  };

  const baselineMonths = Math.max(1, scenario.results.baselineDebtFreeMonths || 1);
  const projectedMonths = Math.max(1, scenario.results.projectedDebtFreeMonths || 1);
  const percentReduction = Math.min(
    100,
    Math.round(((baselineMonths - projectedMonths) / baselineMonths) * 100)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3 md:p-6 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="w-full h-full sm:h-[90vh] max-w-5xl bg-slate-900 border-0 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 bg-slate-900/90 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-bold text-slate-100 truncate">
                  Financial What-If Simulator
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-950/60 text-blue-300 border border-blue-600/30 flex items-center gap-1">
                  <Zap size={11} /> Zero Risk Sandbox
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Simulate debt prepayment velocity, interest avoidance, and 1-year wealth trajectories
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={() => applyPreset('reset')}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors cursor-pointer border border-slate-700"
              title="Reset all levers to zero"
            >
              <RotateCcw size={13} />
              <span>Reset Levers</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Strategy Presets Bar */}
        <div className="px-4 sm:px-6 py-2.5 bg-slate-950/60 border-b border-slate-800 shrink-0">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Quick Strategy Presets
            </span>
            <span className="text-[11px] text-slate-500">
              Instant calibrated parameters
            </span>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            <button
              type="button"
              onClick={() => applyPreset('debt')}
              className="px-3 py-1.5 rounded-xl bg-blue-950/50 border border-blue-700/50 text-blue-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:bg-blue-900/50 cursor-pointer transition-all"
            >
              <Flame size={13} className="text-orange-400" />
              <span>Debt Freedom Sprint</span>
            </button>
            <button
              type="button"
              onClick={() => applyPreset('balanced')}
              className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-slate-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:bg-slate-700 cursor-pointer transition-all"
            >
              <TrendingUp size={13} className="text-emerald-400" />
              <span>Balanced Wealth Plan</span>
            </button>
            <button
              type="button"
              onClick={() => applyPreset('savings')}
              className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-slate-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:bg-slate-700 cursor-pointer transition-all"
            >
              <ShieldCheck size={13} className="text-cyan-400" />
              <span>Cash Fortress Accumulator</span>
            </button>
            <button
              type="button"
              onClick={() => applyPreset('reset')}
              className="sm:hidden px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium flex items-center gap-1 shrink-0"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* 4-Card Projected Outcomes Overview (Occupies the width cleanly) */}
        <div className="px-4 sm:px-6 py-3 bg-slate-900/40 border-b border-slate-800 shrink-0">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Time to Debt Freedom</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-blue-400 font-mono">
                  {scenario.results.debtMonthsSaved > 0
                    ? `${scenario.results.debtMonthsSaved} Mo Saved`
                    : 'Baseline'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {scenario.results.projectedDebtFreeMonths} mo left
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Total Interest Saved</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-emerald-400 font-mono">
                  {fmt(scenario.results.interestSaved)}
                </span>
                <span className="text-[10px] text-emerald-500/80 font-medium">Cumulative</span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">1-Year Net Worth Trajectory</span>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-slate-100 font-mono">
                  {fmt(scenario.results.projectedNetWorth1Yr)}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono">
                  +{fmt(Math.max(0, scenario.results.projectedNetWorth1Yr - scenario.results.baselineNetWorth1Yr))}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium">Committed Monthly Outflow</span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-md bg-purple-500/20 text-purple-300">
                  Surplus
                </span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-base sm:text-lg font-bold text-purple-300 font-mono">
                  +{fmt(scenario.results.monthlyCashFlowImpact)}/mo
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Reserve: {scenario.results.emergencyReserveProtected ? 'Safe' : 'Alert'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area (Dual Column Responsive Grid) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Column 1: Interactive Levers (lg:col-span-5) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Sliders size={14} className="text-blue-400" />
                    Simulated Decision Levers
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Fine-tune adjustments
                  </span>
                </div>

                {/* Lever 1: Extra Monthly Debt Payment */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-200">
                      Extra Monthly Debt Payment
                    </label>
                    <span className="text-xs font-bold text-blue-400 font-mono">
                      {fmt(extraLoanPayment)}/mo
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="50000"
                    step="500"
                    value={extraLoanPayment}
                    onChange={(e) => setExtraLoanPayment(Number(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-1">
                    {[0, 2000, 5000, 10000, 20000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setExtraLoanPayment(amt)}
                        className={`px-2 py-1 text-[10px] rounded-lg border font-mono transition-colors cursor-pointer ${
                          extraLoanPayment === amt
                            ? 'bg-blue-600/30 border-blue-500/60 text-blue-200 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>

                  {activeLoans.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <label className="text-[11px] text-slate-400 block mb-1">Target Debt</label>
                      <select
                        value={selectedLoanId}
                        onChange={(e) => setSelectedLoanId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                      >
                        <option value="">Apply across Highest APR Debt</option>
                        {activeLoans.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({fmt(l.outstanding)} @ {l.ratePct}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Lever 2: Additional Monthly Savings */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-200">
                      Additional Monthly Savings
                    </label>
                    <span className="text-xs font-bold text-emerald-400 font-mono">
                      {fmt(additionalSavings)}/mo
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100000"
                    step="1000"
                    value={additionalSavings}
                    onChange={(e) => setAdditionalSavings(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-1">
                    {[0, 5000, 15000, 30000, 50000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setAdditionalSavings(amt)}
                        className={`px-2 py-1 text-[10px] rounded-lg border font-mono transition-colors cursor-pointer ${
                          additionalSavings === amt
                            ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-200 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lever 3: Lump-Sum Credit Card Payoff */}
                <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-200">
                      Lump-Sum Credit Card Payoff
                    </label>
                    <span className="text-xs font-bold text-cyan-400 font-mono">
                      {fmt(cardLumpSum)}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="200000"
                    step="5000"
                    value={cardLumpSum}
                    onChange={(e) => setCardLumpSum(Number(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-1">
                    {[0, 10000, 25000, 50000, 100000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setCardLumpSum(amt)}
                        className={`px-2 py-1 text-[10px] rounded-lg border font-mono transition-colors cursor-pointer ${
                          cardLumpSum === amt
                            ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-200 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>

                  {activeCards.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80">
                      <label className="text-[11px] text-slate-400 block mb-1">Target Card</label>
                      <select
                        value={selectedCardId}
                        onChange={(e) => setSelectedCardId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                      >
                        <option value="">Auto-Apply across Highest Utilization Card</option>
                        {activeCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({fmt(c.outstanding)} balance)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Column 2: Projected Visuals & Dynamic Trajectory (lg:col-span-7) */}
            <div className="lg:col-span-7 space-y-4">
              {/* Visual Horizon Comparison */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Clock size={14} className="text-blue-400" />
                    Debt Payoff Horizon Comparison
                  </span>
                  {percentReduction > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {percentReduction}% Faster Freedom
                    </span>
                  )}
                </div>

                <div className="space-y-3 text-xs pt-1">
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>Baseline Contractual Duration</span>
                      <span className="font-mono text-slate-300">{baselineMonths} months</span>
                    </div>
                    <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div className="h-full bg-slate-600 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>What-If Accelerated Duration</span>
                      <span className="font-mono font-bold text-emerald-400">{projectedMonths} months</span>
                    </div>
                    <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-linear-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(5, Math.min(100, (projectedMonths / baselineMonths) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    <span className="text-slate-300 font-medium">Interest Expense Eliminated:</span>
                  </div>
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    {fmt(scenario.results.interestSaved)}
                  </span>
                </div>
              </div>

              {/* Emergency Reserve Protection Card */}
              <div
                className={`p-4 rounded-xl border space-y-2 ${
                  scenario.results.emergencyReserveProtected
                    ? 'bg-blue-950/20 border-blue-800/40 text-blue-200'
                    : 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {scenario.results.emergencyReserveProtected ? (
                      <ShieldCheck size={16} className="text-blue-400 shrink-0" />
                    ) : (
                      <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                    )}
                    <span className="text-xs font-bold">
                      Emergency Reserve Status:{' '}
                      {scenario.results.emergencyReserveProtected ? 'Fully Protected' : 'Deficit Warning'}
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    Buffer Target: {fmt(settings.cashFlowBufferAmount || 50000)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {scenario.results.emergencyReserveProtected
                    ? 'Your simulated monthly commitments leave your core emergency reserves completely uncompromised.'
                    : 'High committed outflows may temporarily breach your emergency buffer target. Consider trimming lump sums.'}
                </p>
              </div>

              {/* Dynamic Strategy Verdict */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Zap size={14} className="text-cyan-400" />
                  Scenario Synthesis &amp; Takeaway
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {extraLoanPayment > 0 || cardLumpSum > 0 || additionalSavings > 0 ? (
                    <>
                      By dedicating{' '}
                      <strong className="text-white">
                        {fmt(extraLoanPayment + additionalSavings)}/mo
                      </strong>{' '}
                      in surplus funds, you knock{' '}
                      <strong className="text-blue-400">{scenario.results.debtMonthsSaved} months</strong> off
                      your repayment horizon and unlock an extra{' '}
                      <strong className="text-emerald-400">{fmt(scenario.results.interestSaved)}</strong> in
                      cumulative wealth that would otherwise be lost to loan interest.
                    </>
                  ) : (
                    'Adjust the decision levers on the left to see instant comparative debt payoff trajectories and compounding wealth impact.'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-900/90 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-400 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span>Simulated scenario does not alter your saved accounts, debts, or ledger entries.</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => applyPreset('reset')}
              className="sm:hidden flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 transition-colors cursor-pointer border border-slate-700 flex-1"
            >
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer border border-slate-700 flex-1 sm:flex-none text-center"
            >
              Close Simulator
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

