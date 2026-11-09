import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  generateAdaptiveRepaymentPlan,
  UserRepaymentBehaviorState,
} from '../../lib/mlRepaymentCoach';
import { formatMoney } from '../../lib/formatters';
import {
  Brain,
  ShieldCheck,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Wallet,
} from 'lucide-react';

export const MLRepaymentCoachCard: React.FC = () => {
  const {
    liabilities,
    holdings,
    incomeStreams,
    bills,
    settings,
    currencies,
    setActiveModal,
  } = useApp();

  const [behaviorState, setBehaviorState] = useState<UserRepaymentBehaviorState>({
    liabilityId: '',
    delayCount: 0,
  });
  const [customStepAmount, setCustomStepAmount] = useState<string>('');
  const [isEditingStep, setIsEditingStep] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const plan = generateAdaptiveRepaymentPlan(
    liabilities,
    holdings,
    incomeStreams,
    bills,
    behaviorState,
    settings
  );

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const { coachingIntervention, targetLiability, essentialObligationsTotal, grossLiquidCash } = plan;

  if (!targetLiability || (targetLiability.outstanding || 0) <= 0) {
    return null;
  }

  const handlePostpone = () => {
    setBehaviorState((prev) => ({
      ...prev,
      delayCount: Math.min(6, (prev.delayCount || 0) + 1),
    }));
  };

  const handleResetLearning = () => {
    setBehaviorState({ liabilityId: '', delayCount: 0 });
  };

  const effectiveStepAmount = isEditingStep && customStepAmount !== ''
    ? parseFloat(customStepAmount) || coachingIntervention.actionableStepAmount
    : coachingIntervention.actionableStepAmount;

  return (
    <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950/30 to-slate-900 border border-indigo-900/40 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Brain size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">
                Adaptive ML Debt Repayment Coach
              </h3>
              <span className="text-slate-600">·</span>
              <span className={`text-[11px] font-semibold ${
                coachingIntervention.level >= 5
                  ? 'text-rose-400'
                  : coachingIntervention.level >= 3
                  ? 'text-amber-400'
                  : 'text-indigo-400'
              }`}>
                {coachingIntervention.levelName}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Transparent, non-coercive financial strategy engine · Zero silent transfers
            </p>
          </div>
        </div>

        {behaviorState.delayCount > 0 && (
          <button
            type="button"
            onClick={handleResetLearning}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 bg-slate-800/60 px-2 py-1 rounded-md border border-slate-700/60"
            title="Reset behavior adaptation history"
          >
            <RefreshCw size={11} />
            <span>Reset History</span>
          </button>
        )}
      </div>

      {/* Main Insight Box */}
      <div className="p-3.5 rounded-xl bg-slate-950/60 border border-indigo-900/30 space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
          <span className="flex items-center gap-1.5 text-indigo-300">
            <Sparkles size={13} className="text-indigo-400" />
            {coachingIntervention.title}
          </span>
          <span className="text-[11px] text-slate-400">
            Target: <strong className="text-white">{targetLiability.name}</strong> ({targetLiability.ratePct || 0}% APR)
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          {coachingIntervention.detailedMessage}
        </p>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
          <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Outstanding Debt</span>
            <span className="text-white font-semibold">
              {formatMoney(targetLiability.outstanding || 0, targetLiability.currency)}
            </span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">30-Day Delay Cost</span>
            <span className="text-amber-400 font-semibold flex items-center gap-1">
              <TrendingDown size={11} />
              +{formatMoney(coachingIntervention.monthlyDelayCost, targetLiability.currency)}
            </span>
          </div>

          <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
            <span className="text-slate-400 block text-[10px]">Essential Bills Reserved</span>
            <span className="text-emerald-400 font-semibold flex items-center gap-1">
              <ShieldCheck size={11} />
              {formatMoney(essentialObligationsTotal, baseCurr)}
            </span>
          </div>

          <div className="p-2 rounded-lg bg-indigo-950/40 border border-indigo-800/40">
            <span className="text-indigo-300 block text-[10px]">Recommended Step</span>
            <span className="text-cyan-300 font-bold">
              {formatMoney(effectiveStepAmount, targetLiability.currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Liquidity Integrity Notice */}
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-900/40 border border-slate-800 text-[11px] text-slate-400">
        <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
        <span>
          Liquidity Guard: Your upcoming rent, essential recurring bills, and liquid reserves are held harmless before debt paydown is suggested.
        </span>
      </div>

      {/* Action Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-slate-800">
        <div className="flex items-center gap-2">
          {isEditingStep ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={customStepAmount}
                onChange={(e) => setCustomStepAmount(e.target.value)}
                placeholder="Custom amount"
                className="w-28 px-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-white"
              />
              <button
                type="button"
                onClick={() => setIsEditingStep(false)}
                className="text-xs text-indigo-400 hover:text-indigo-300 underline"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCustomStepAmount(String(coachingIntervention.actionableStepAmount));
                setIsEditingStep(true);
              }}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Modify Step Amount
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePostpone}
            className="px-3 py-1.5 text-xs rounded-lg text-slate-300 bg-slate-800 hover:bg-slate-700 transition"
          >
            Postpone / Adapt Strategy
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveModal('transfer');
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition shadow-md"
          >
            <span>Execute Pay-Down</span>
            <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};
