import React, { useState, useMemo } from 'react';
import { Currency } from '../../types';
import { useApp } from '../../context/AppContext';
import { runWhatIfSimulation } from '../../lib/whatIfSimulator';
import { formatMoney } from '../../lib/formatters';
import { X, Sparkles, TrendingUp, Calendar, ShieldCheck, DollarSign, Sliders } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export const WhatIfSimulatorModal: React.FC<Props> = ({ onClose }) => {
  const { holdings, liabilities, bills, settings, currencies } = useApp();

  const activeLoans = useMemo(() => liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0), [liabilities]);
  const activeCards = useMemo(() => liabilities.filter((l) => l.kind === 'card' && (l.outstanding || 0) > 0), [liabilities]);

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
  }, [extraLoanPayment, selectedLoanId, additionalSavings, cardLumpSum, selectedCardId, holdings, liabilities, bills, settings, currMap]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-3xl bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-neutral-800 bg-neutral-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Financial What-If Simulator</h3>
              <p className="text-xs text-neutral-400">Hypothetical Sandbox • Zero balance mutation</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Simulation Controls */}
          <div className="p-4 rounded-xl bg-neutral-950 border border-neutral-800 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              <Sliders className="w-4 h-4 text-blue-400" />
              <span>Simulated Decision Levers</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Extra Loan Payment */}
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">
                  Extra Monthly Debt Payment ({settings.baseCurrency}/mo)
                </label>
                <div className="flex gap-2 mb-2">
                  {[2000, 5000, 10000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setExtraLoanPayment(amt)}
                      className={`px-2 py-1 text-xs rounded-md border transition ${
                        extraLoanPayment === amt
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700'
                      }`}
                    >
                      +{amt}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  step="500"
                  value={extraLoanPayment || ''}
                  onChange={(e) => setExtraLoanPayment(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-xs focus:outline-hidden focus:border-blue-500 font-mono"
                  placeholder="Enter custom amount"
                />
              </div>

              {/* Target Loan Selection */}
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">Target Debt</label>
                {activeLoans.length > 0 ? (
                  <select
                    value={selectedLoanId}
                    onChange={(e) => setSelectedLoanId(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-xs focus:outline-hidden"
                  >
                    <option value="">Apply across Highest APR Debt</option>
                    {activeLoans.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({formatMoney(l.outstanding, l.currency)} @ {l.ratePct}%)
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-neutral-500 italic pt-2">No active loans found</p>
                )}
              </div>

              {/* Additional Monthly Savings */}
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">
                  Additional Monthly Savings ({settings.baseCurrency}/mo)
                </label>
                <input
                  type="number"
                  step="1000"
                  value={additionalSavings || ''}
                  onChange={(e) => setAdditionalSavings(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-xs focus:outline-hidden focus:border-blue-500 font-mono"
                  placeholder="e.g. 5000"
                />
              </div>

              {/* Lump sum card payoff */}
              <div>
                <label className="text-xs font-medium text-neutral-300 block mb-1">
                  Lump-Sum Credit Card Payoff ({settings.baseCurrency})
                </label>
                <input
                  type="number"
                  step="5000"
                  value={cardLumpSum || ''}
                  onChange={(e) => setCardLumpSum(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white text-xs focus:outline-hidden focus:border-blue-500 font-mono"
                  placeholder="e.g. 25000"
                />
              </div>
            </div>
          </div>

          {/* Results Comparison Grid */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Projected Outcomes vs Baseline
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[11px] text-neutral-400 block mb-1">Time Saved</span>
                <span className="text-lg font-bold text-blue-400">
                  {scenario.results.debtMonthsSaved} Months
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  {scenario.results.baselineDebtFreeMonths} mo → {scenario.results.projectedDebtFreeMonths} mo
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[11px] text-neutral-400 block mb-1">Total Interest Saved</span>
                <span className="text-lg font-bold text-emerald-400">
                  {formatMoney(scenario.results.interestSaved, settings.baseCurrency)}
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  Cumulative savings
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[11px] text-neutral-400 block mb-1">1-Yr Net Worth Impact</span>
                <span className="text-lg font-bold text-white">
                  {formatMoney(scenario.results.projectedNetWorth1Yr, settings.baseCurrency)}
                </span>
                <span className="text-[10px] text-emerald-400 block mt-0.5">
                  +{formatMoney(scenario.results.projectedNetWorth1Yr - scenario.results.baselineNetWorth1Yr, settings.baseCurrency)} uplift
                </span>
              </div>

              <div className="p-3.5 rounded-xl bg-neutral-950 border border-neutral-800">
                <span className="text-[11px] text-neutral-400 block mb-1">Monthly Cash Outflow</span>
                <span className="text-lg font-bold text-white">
                  +{formatMoney(scenario.results.monthlyCashFlowImpact, settings.baseCurrency)}
                </span>
                <span className="text-[10px] text-neutral-400 block mt-0.5">
                  Committed surplus
                </span>
              </div>
            </div>

            {/* Emergency Reserve Protection Banner */}
            <div className="p-3.5 rounded-xl bg-blue-950/30 border border-blue-800/40 text-blue-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
                <span>
                  Emergency Reserve Protection:{' '}
                  <strong>{scenario.results.emergencyReserveProtected ? 'Safeguarded' : 'Deficit Warning'}</strong>
                </span>
              </div>
              <span className="text-[11px] text-neutral-400 font-mono">
                Reserve Target: {formatMoney(settings.cashFlowBufferAmount || 50000, settings.baseCurrency)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-neutral-400 hover:text-white transition"
          >
            Close Simulator
          </button>
        </div>
      </div>
    </div>
  );
};
