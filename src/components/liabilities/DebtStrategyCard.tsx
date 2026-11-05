import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { DebtRepaymentStrategy, Liability } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { evaluateDebtStrategies } from '../../lib/debtEngine';
import {
  Zap,
  Shield,
  Layers,
  Clock,
  Lock,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';

interface DebtStrategyCardProps {
  onPayDebt?: (liability: Liability) => void;
}

export const DebtStrategyCard: React.FC<DebtStrategyCardProps> = ({ onPayDebt }) => {
  const {
    liabilities,
    engineResult,
    currencies,
    settings,
    updateSettings,
    predictLoanPayment,
  } = useApp();

  const verifiedFreeCash = Math.max(0, Math.round(engineResult.freeCashBase));
  const [extraMonthlySurplus, setExtraMonthlySurplus] = useState<number>(
    Math.max(0, Math.round(verifiedFreeCash * 0.5))
  );
  const [userAdjustedSlider, setUserAdjustedSlider] = useState<boolean>(false);
  const [userPickedTab, setUserPickedTab] = useState<boolean>(false);

  useEffect(() => {
    if (!userAdjustedSlider) {
      setExtraMonthlySurplus(Math.max(0, Math.round(verifiedFreeCash * 0.5)));
    }
  }, [verifiedFreeCash, userAdjustedSlider]);

  const currenciesMap = React.useMemo(() => {
    return currencies.reduce((acc, c) => ({ ...acc, [c.code]: c }), {} as Record<string, any>);
  }, [currencies]);

  const currencySymbol =
    currencies.find((c) => c.code === settings.baseCurrency)?.symbol ||
    settings.baseCurrency ||
    '₹';

  const fmt = (amt: number, dec: number = 0) =>
    formatMoney(amt, settings.baseCurrency, currencySymbol, settings.numberGrouping, dec);

  const debtEval = React.useMemo(
    () =>
      evaluateDebtStrategies(
        liabilities,
        extraMonthlySurplus,
        currenciesMap,
        settings
      ),
    [liabilities, extraMonthlySurplus, currenciesMap, settings]
  );

  const [strategy, setStrategy] = useState<DebtRepaymentStrategy>(debtEval.recommendedStrategy);

  useEffect(() => {
    if (!userPickedTab) {
      setStrategy(debtEval.recommendedStrategy);
    }
  }, [debtEval.recommendedStrategy, userPickedTab]);

  if (debtEval.totalOutstandingBase <= 0) {
    return null;
  }

  const activeStrategy = debtEval.strategies[strategy];
  const recommendedResult = debtEval.strategies[debtEval.recommendedStrategy];
  const netSavings =
    activeStrategy.netSavingsComparedToMin ?? activeStrategy.interestSavedComparedToMin;
  const prepayFees = activeStrategy.totalPrepaymentPenaltiesProjected || 0;

  const methodTabs = [
    {
      id: 'avalanche' as const,
      label: 'Avalanche',
      sub: 'Highest interest first',
      icon: Zap,
      activeCls: 'bg-emerald-950/60 border-emerald-500 text-white',
    },
    {
      id: 'snowball' as const,
      label: 'Snowball',
      sub: 'Smallest balance first',
      icon: Layers,
      activeCls: 'bg-indigo-950/60 border-indigo-500 text-white',
    },
    {
      id: 'mandatory_first' as const,
      label: 'Minimum Only',
      sub: 'Scheduled EMIs & dues',
      icon: Shield,
      activeCls: 'bg-slate-800 border-slate-600 text-white',
    },
  ];

  return (
    <div className="rounded-xl bg-slate-900/90 border border-slate-800 p-4 space-y-3.5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
            <Zap size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">
              Best Way to Clear Your Loans
            </h3>
            <p className="text-[11px] text-slate-400">
              Compares Avalanche, Snowball, and Minimum Only using your real available cash and prepayment charges
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <button
            type="button"
            onClick={() =>
              updateSettings({
                enforcePrepaymentStrategy: !settings.enforcePrepaymentStrategy,
              })
            }
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
              settings.enforcePrepaymentStrategy
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/80'
                : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Guard against prepayment charges that exceed interest saved"
          >
            <ShieldCheck size={13} />
            <span>
              Fee Guard: {settings.enforcePrepaymentStrategy ? 'On' : 'Advisory'}
            </span>
          </button>

          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Active Debt</div>
            <div className="text-sm font-bold text-rose-400 font-mono tabular-nums">
              {fmt(debtEval.totalOutstandingBase)}
            </div>
          </div>
        </div>
      </div>

      {/* 3-Method Comparison Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
        {methodTabs.map((tab) => {
          const Icon = tab.icon;
          const isRecommended = debtEval.recommendedStrategy === tab.id;
          const isSelected = strategy === tab.id;
          const res = debtEval.strategies[tab.id];
          const saved = res.netSavingsComparedToMin ?? res.interestSavedComparedToMin;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setUserPickedTab(true);
                setStrategy(tab.id);
              }}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                isSelected
                  ? tab.activeCls
                  : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="font-semibold flex items-center gap-1.5 text-xs">
                  <Icon size={13} className={isSelected ? 'text-emerald-300' : 'text-slate-400'} />
                  <span>{tab.label}</span>
                </span>
                {isRecommended && (
                  <span className="text-[10px] font-semibold text-emerald-400 whitespace-nowrap">
                    Recommended
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{tab.sub}</div>
              <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-800/80 font-mono tabular-nums text-[11px]">
                <span className="text-slate-300">
                  {res.debtFreeMonths > 0 ? `${res.debtFreeMonths} mo` : 'N/A'}
                </span>
                <span
                  className={
                    tab.id === 'mandatory_first'
                      ? 'text-slate-400'
                      : saved > 0
                      ? 'text-emerald-400 font-semibold'
                      : saved < 0
                      ? 'text-rose-400'
                      : 'text-slate-400'
                  }
                >
                  {tab.id === 'mandatory_first'
                    ? `${fmt(res.totalInterestProjected)} int`
                    : saved >= 0
                    ? `Saves ${fmt(saved)}`
                    : `Loses ${fmt(Math.abs(saved))}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Plain-English Strategy Recommendation & Metrics */}
      <div className="p-3 rounded-lg bg-slate-800/40 border border-slate-800 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 size={13} className="shrink-0" />
            <span>Best Method Right Now: {recommendedResult.strategyName}</span>
          </span>
          {strategy !== debtEval.recommendedStrategy && (
            <button
              type="button"
              onClick={() => setStrategy(debtEval.recommendedStrategy)}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
            >
              View recommended method
            </button>
          )}
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">{activeStrategy.rationale}</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1.5 border-t border-slate-800/80 font-mono tabular-nums">
          <div>
            <div className="text-[10px] text-slate-400 font-sans">Debt-Free Time</div>
            <div className="text-sm font-bold text-slate-200 mt-0.5 flex items-center gap-1">
              <Clock size={13} className="text-indigo-400" />
              <span>{activeStrategy.debtFreeMonths > 0 ? `${activeStrategy.debtFreeMonths} mo` : 'N/A'}</span>
            </div>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 font-sans">Total Interest</div>
            <div className="text-sm font-bold text-amber-400 mt-0.5">
              {fmt(activeStrategy.totalInterestProjected)}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 font-sans">Prepayment Fees</div>
            <div className={`text-sm font-bold mt-0.5 ${prepayFees > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
              {prepayFees > 0 ? fmt(prepayFees) : fmt(0)}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-slate-400 font-sans">Net Saved vs Minimum</div>
            <div
              className={`text-sm font-bold mt-0.5 ${
                netSavings > 0 ? 'text-emerald-400' : netSavings < 0 ? 'text-rose-400' : 'text-slate-300'
              }`}
            >
              {strategy === 'mandatory_first'
                ? 'Baseline'
                : netSavings >= 0
                ? `+${fmt(netSavings)}`
                : fmt(netSavings)}
            </div>
          </div>
        </div>
      </div>

      {/* Extra Monthly Allocation Slider */}
      <div className="p-2.5 rounded-lg bg-slate-800/30 border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">
            Extra Monthly Payment Toward Debt{' '}
            <span className="text-[11px] text-slate-500">
              (Verified free cash: {fmt(verifiedFreeCash)})
            </span>
          </span>
          <span className="font-semibold text-emerald-400 font-mono tabular-nums">
            +{fmt(extraMonthlySurplus)}/mo
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(25000, verifiedFreeCash, Math.round(debtEval.mandatoryMonthlyObligationBase))}
          step={500}
          value={extraMonthlySurplus}
          onChange={(e) => {
            setUserAdjustedSlider(true);
            setExtraMonthlySurplus(Number(e.target.value));
          }}
          className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
        />
        <div className="flex justify-between text-[10px] text-slate-500 font-mono tabular-nums">
          <span>+{currencySymbol}0 (Minimums Only)</span>
          <span>Total Monthly Debt Budget: {fmt(debtEval.mandatoryMonthlyObligationBase + extraMonthlySurplus)}</span>
        </div>
      </div>

      {/* Payoff Order Queue */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          Recommended Payoff Order ({activeStrategy.items.length}{' '}
          {activeStrategy.items.length === 1 ? 'account' : 'accounts'})
        </div>

        <div className="space-y-1.5">
          {activeStrategy.items.map((item) => {
            const matchedLiab = liabilities.find((l) => l.id === item.liabilityId);
            const loanPlan =
              matchedLiab && matchedLiab.kind === 'loan'
                ? predictLoanPayment(matchedLiab.id)
                : null;
            const liabCurrSym = matchedLiab
              ? currenciesMap[matchedLiab.currency]?.symbol || matchedLiab.currency
              : currencySymbol;

            return (
              <div
                key={item.liabilityId}
                className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded-md bg-slate-800 border border-slate-700 text-slate-300 flex items-center justify-center text-[10px] font-bold font-mono tabular-nums shrink-0">
                    {item.priorityRank}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-200">{item.name}</span>
                      {(item.lockInMonthsRemaining || 0) > 0 && (
                        <>
                          <span className="text-slate-600">·</span>
                          <span className="text-[11px] text-amber-300 inline-flex items-center gap-0.5">
                            <Lock size={10} /> {item.lockInMonthsRemaining}m lock-in
                          </span>
                        </>
                      )}
                      {(item.prepaymentPenaltyPct || 0) > 0 && (
                        <>
                          <span className="text-slate-600">·</span>
                          <span className="text-[11px] text-rose-300">
                            {item.prepaymentPenaltyPct}% prepay charge
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 font-mono tabular-nums">
                      <span className="text-amber-400 font-medium">{item.interestRatePct}% p.a.</span>
                      <span>·</span>
                      <span>Min: {fmt(item.minMonthlyPayment)}</span>
                      {(item.estimatedPrepaymentPenalties || 0) > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-rose-300">
                            Est. Fee: {fmt(item.estimatedPrepaymentPenalties || 0)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0 ml-auto">
                  <div className="text-right font-mono tabular-nums">
                    <div className="font-bold text-slate-200">{fmt(item.outstanding)}</div>
                    <div className="text-[11px] text-emerald-400 font-semibold mt-0.5">
                      {loanPlan && matchedLiab
                        ? `Pay ${formatMoney(
                            loanPlan.recommendedAmount,
                            matchedLiab.currency,
                            liabCurrSym,
                            settings.numberGrouping,
                            0
                          )}`
                        : `Pay ${fmt(item.recommendedPayment)}/mo`}
                    </div>
                  </div>

                  {matchedLiab && onPayDebt && (
                    <button
                      type="button"
                      onClick={() => onPayDebt(matchedLiab)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/35 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px] flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap shrink-0"
                    >
                      <span>{matchedLiab.kind === 'loan' ? 'Pay Now' : 'Settle'}</span>
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
