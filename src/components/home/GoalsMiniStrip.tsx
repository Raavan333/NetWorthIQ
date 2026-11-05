import React from 'react';
import { useApp } from '../../context/AppContext';
import { formatCompactMoney } from '../../lib/formatters';
import { Target, ChevronRight, Zap, Flame } from 'lucide-react';

export const GoalsMiniStrip: React.FC = () => {
  const { goals, holdings, liabilities, settings, currencies, setActiveModal } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const activeGoals = goals.filter((g) => {
    if (g.isCompleted || g.paymentVerified) return false;
    if (g.goalType === 'debt_payoff' && g.targetLiabilityId) {
      const targetLiab = liabilities.find((l) => l.id === g.targetLiabilityId);
      if (!targetLiab || (targetLiab.outstanding || 0) <= 0) return false;
    }
    return true;
  });

  if (activeGoals.length === 0) return null;

  let totalTargetCost = 0;
  let totalFundedAmount = 0;

  const goalProgressList = activeGoals.map((g) => {
    const isDebt = g.goalType === 'debt_payoff';
    const matchedLiab =
      isDebt && g.targetLiabilityId
        ? liabilities.find((l) => l.id === g.targetLiabilityId)
        : undefined;

    let funded = g.accumulatedTotal || 0;
    for (const src of g.sources || []) {
      const h = holdings.find((x) => x.id === src.sourceId);
      if (h) {
        const val =
          h.units && h.currentPrice ? h.units * h.currentPrice : h.principalOrValue || 0;
        if (
          src.allocationMode === 'fixed_amount' &&
          src.allocationAmount !== undefined &&
          src.allocationAmount > 0
        ) {
          funded += Math.min(val, src.allocationAmount);
        } else if (src.allocationPct) {
          funded += val * ((src.allocationPct || 0) / 100);
        }
      }
    }

    let pct = 0;
    const targetAmt = isDebt
      ? Math.max(g.startingDebtAmount || 0, g.cost || 0, matchedLiab?.outstanding || 0)
      : g.cost;
    totalTargetCost += targetAmt;

    if (isDebt) {
      const currentOutstanding = matchedLiab ? matchedLiab.outstanding : 0;
      const debtKilled = Math.max(0, targetAmt - currentOutstanding);
      pct = targetAmt > 0 ? Math.min(100, Math.max(0, (debtKilled / targetAmt) * 100)) : 0;
      funded = debtKilled;
      totalFundedAmount += debtKilled;
    } else {
      pct = targetAmt > 0 ? Math.min(100, (funded / targetAmt) * 100) : 0;
      totalFundedAmount += funded;
    }

    return { ...g, isDebt, funded, pct, targetAmt };
  });

  const totalAchievementRate =
    totalTargetCost > 0 ? Math.min(100, (totalFundedAmount / totalTargetCost) * 100) : 0;

  return (
    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 my-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
            <Target size={15} />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Active Goals
            </h3>
            <p className="text-[11px] text-slate-400 font-mono tabular-nums">
              {activeGoals.length} active · {totalAchievementRate.toFixed(0)}% settled
            </p>
          </div>
        </div>
        <button
          onClick={() => setActiveModal('goals')}
          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 cursor-pointer whitespace-nowrap shrink-0"
        >
          <span>Manage Goals</span>
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Main Aggregated Progress Bar */}
      <div className="relative w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${totalAchievementRate}%` }}
        />
      </div>

      {/* Individual Goals Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-0.5">
        {goalProgressList.map((g) => (
          <div
            key={g.id}
            onClick={() => setActiveModal('goals')}
            className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer space-y-2"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-200 truncate flex items-center gap-1.5">
                {g.isDebt ? (
                  <Flame size={13} className="text-rose-400 shrink-0" />
                ) : (
                  <Zap size={13} className="text-emerald-400 shrink-0" />
                )}
                <span className="truncate">{g.name}</span>
              </span>
              <span className="font-mono tabular-nums text-emerald-400 font-bold ml-2 shrink-0">
                {g.pct.toFixed(0)}%
              </span>
            </div>

            <div className="w-full h-1.5 rounded-full bg-slate-900 border border-slate-800/80 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  g.isDebt ? 'bg-cyan-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${g.pct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-mono tabular-nums">
                {formatCompactMoney(g.funded, g.currency, currencies.find((c) => c.code === g.currency)?.symbol || currSym)} /{' '}
                {formatCompactMoney(g.targetAmt, g.currency, currencies.find((c) => c.code === g.currency)?.symbol || currSym)}
              </span>
              <span>
                {g.isDebt ? 'Debt Payoff' : g.deadline ? `Due ${g.deadline}` : 'Accumulating'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
