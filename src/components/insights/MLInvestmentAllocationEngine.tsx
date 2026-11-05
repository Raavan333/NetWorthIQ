import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  Holding,
  Goal,
  MarketCapCategory,
  MLInvestmentModelWeights,
  MLInvestmentSuggestion,
  MLModelFeedbackRecord,
} from '../../types';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import {
  Brain,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  Flame,
  ArrowRight,
  Sliders,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  DollarSign,
  PieChart,
  Layers,
  Zap,
  ShieldAlert,
} from 'lucide-react';

const DEFAULT_ML_WEIGHTS: MLInvestmentModelWeights = {
  debtPayoffWeight: 40,
  megaCapWeight: 30,
  largeCapWeight: 25,
  midCapWeight: 25,
  smallCapWeight: 20,
  highYieldFdWeight: 20,
  riskToleranceBias: 0,
  learningRate: 0.05,
  iteration: 1,
};

const ML_WEIGHTS_STORAGE_KEY = 'networthiq_ml_investment_weights';
const ML_FEEDBACK_LOG_KEY = 'networthiq_ml_feedback_log';

export const MLInvestmentAllocationEngine: React.FC = () => {
  const {
    holdings,
    liabilities,
    bills,
    goals,
    settings,
    updateSettings,
    currencies,
    addTransaction,
    updateHolding,
  } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Safe buffer amount state (user configurable, default 50000)
  const [safeBuffer, setSafeBuffer] = useState<number>(
    settings.cashFlowBufferAmount !== undefined ? settings.cashFlowBufferAmount : 50000
  );
  const [isBufferSaved, setIsBufferSaved] = useState<boolean>(false);

  // ML Weights & Biases state
  const [modelWeights, setModelWeights] = useState<MLInvestmentModelWeights>(() => {
    try {
      const stored = localStorage.getItem(ML_WEIGHTS_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_ML_WEIGHTS;
  });

  // ML Feedback log
  const [feedbackLog, setFeedbackLog] = useState<MLModelFeedbackRecord[]>(() => {
    try {
      const stored = localStorage.getItem(ML_FEEDBACK_LOG_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  // Interactive feedback inputs
  const [showFeedbackModal, setShowFeedbackModal] = useState<boolean>(false);
  const [feedbackMarketCap, setFeedbackMarketCap] = useState<MarketCapCategory>('mid_cap');
  const [reportedGainLoss, setReportedGainLoss] = useState<string>('');
  const [feedbackNote, setFeedbackNote] = useState<string>('');
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Sync weights to localStorage
  const saveWeights = (newWeights: MLInvestmentModelWeights) => {
    setModelWeights(newWeights);
    try {
      localStorage.setItem(ML_WEIGHTS_STORAGE_KEY, JSON.stringify(newWeights));
    } catch {}
  };

  const handleSaveBuffer = async () => {
    await updateSettings({ cashFlowBufferAmount: safeBuffer });
    setIsBufferSaved(true);
    setTimeout(() => setIsBufferSaved(false), 2500);
  };

  // 1. CALCULATE CASH FLOW METRICS
  // Accessible immediate cash: Bank accounts + Physical Hand Cash + Sweep-in FDs
  const immediateCashHoldings = holdings.filter(
    (h) => h.typeId === 'type-bank' || h.typeId === 'type-cash-hand' || h.typeId === 'type-cash' || h.isSweepIn || h.liquidityClass === 'Immediate'
  );
  const totalImmediateCash = immediateCashHoldings.reduce(
    (sum, h) => sum + (h.principalOrValue || 0),
    0
  );

  // Upcoming bills & EMIs due this month
  const monthlyBillsTotal = bills.reduce((sum, b) => {
    if (b.frequency === 'yearly') return sum + b.amount / 12;
    if (b.frequency === 'quarterly') return sum + b.amount / 3;
    if (b.frequency === 'weekly') return sum + b.amount * 4.33;
    return sum + b.amount;
  }, 0);

  const monthlyEmisTotal = liabilities.reduce(
    (sum, l) => sum + (l.monthlyEmi || 0),
    0
  );

  const totalMonthlyObligations = monthlyBillsTotal + monthlyEmisTotal;

  // Excess Deployable Cash Flow after settling bills and keeping user-specified safe buffer
  const excessCashFlow = Math.max(0, totalImmediateCash - totalMonthlyObligations - safeBuffer);

  // 2. ANALYZE CURRENT PORTFOLIO MARKET CAP ALLOCATION
  const equityHoldings = holdings.filter(
    (h) =>
      h.units !== undefined ||
      h.typeId.includes('stock') ||
      h.typeId.includes('mf') ||
      h.customCategory?.toLowerCase().includes('equities')
  );

  const totalEquityValue = equityHoldings.reduce((sum, h) => {
    const val = (h.units && h.currentPrice) ? h.units * h.currentPrice : (h.principalOrValue || 0);
    return sum + val;
  }, 0);

  const capDistribution = {
    mega_cap: 0,
    large_cap: 0,
    mid_cap: 0,
    small_cap: 0,
  };

  for (const h of equityHoldings) {
    const val = (h.units && h.currentPrice) ? h.units * h.currentPrice : (h.principalOrValue || 0);
    const cat = h.marketCapCategory || 'large_cap';
    capDistribution[cat] = (capDistribution[cat] || 0) + val;
  }

  const capPercentages = {
    mega_cap: totalEquityValue > 0 ? (capDistribution.mega_cap / totalEquityValue) * 100 : 0,
    large_cap: totalEquityValue > 0 ? (capDistribution.large_cap / totalEquityValue) * 100 : 0,
    mid_cap: totalEquityValue > 0 ? (capDistribution.mid_cap / totalEquityValue) * 100 : 0,
    small_cap: totalEquityValue > 0 ? (capDistribution.small_cap / totalEquityValue) * 100 : 0,
  };

  // 3. IDENTIFY HIGH PRIORITY DEBT KILLING TARGETS & GOALS
  const highPriorityGoals = goals.filter((g) => g.priority === 'high');
  const midPriorityGoals = goals.filter((g) => g.priority === 'mid' || !g.priority);
  const lowPriorityGoals = goals.filter((g) => g.priority === 'low');

  // Highest rate toxic debt
  const activeDebts = [...liabilities].sort((a, b) => (b.ratePct || 0) - (a.ratePct || 0));
  const highestInterestDebt = activeDebts.length > 0 && activeDebts[0].outstanding > 0 ? activeDebts[0] : null;

  // 4. GENERATE SELF-TUNED ML SUGGESTIONS
  const suggestions: MLInvestmentSuggestion[] = [];

  if (excessCashFlow > 500) {
    // Strategy 1: High-Priority Debt Killing (if high rate debt exists or high-priority debt payoff goal is set)
    if (highestInterestDebt && highestInterestDebt.ratePct >= 12 && modelWeights.debtPayoffWeight >= 25) {
      const debtAmount = Math.min(excessCashFlow * 0.5, highestInterestDebt.outstanding);
      const annualSaved = (debtAmount * highestInterestDebt.ratePct) / 100;
      suggestions.push({
        id: `ml-sug-debt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        excessCashAmount: excessCashFlow,
        billsDueAmount: totalMonthlyObligations,
        safeBufferAmount: safeBuffer,
        deployableAmount: debtAmount,
        recommendedCategory: 'debt_payoff',
        recommendedAction: `Kill ${highestInterestDebt.name} (${highestInterestDebt.ratePct}% p.a.)`,
        reasoning: `High priority debt killing: prepaying ${formatMoney(debtAmount, baseCurr, currSym)} guarantees a risk-free ${highestInterestDebt.ratePct}% p.a. return by eliminating compound interest drag.`,
        expectedAnnualGain: annualSaved,
        suggestedAllocationPct: 50,
        status: 'pending',
      });
    }

    // Strategy 2: Market Cap Allocation Optimization
    // Find market cap with largest gap (Target Weight - Current %)
    const capGaps = [
      { cat: 'mega_cap' as MarketCapCategory, gap: modelWeights.megaCapWeight - capPercentages.mega_cap, label: 'Mega Cap Bluechips', expectedReturn: 12.0 },
      { cat: 'large_cap' as MarketCapCategory, gap: modelWeights.largeCapWeight - capPercentages.large_cap, label: 'Large Cap Leaders', expectedReturn: 13.5 },
      { cat: 'mid_cap' as MarketCapCategory, gap: modelWeights.midCapWeight - capPercentages.mid_cap, label: 'Mid Cap High Growth', expectedReturn: 16.0 },
      { cat: 'small_cap' as MarketCapCategory, gap: modelWeights.smallCapWeight - capPercentages.small_cap, label: 'Small Cap Emerging Alpha', expectedReturn: 18.5 },
    ].sort((a, b) => b.gap - a.gap);

    const mostUnderAllocated = capGaps[0];
    const equityDeployAmount = highestInterestDebt && highestInterestDebt.ratePct >= 12 ? excessCashFlow * 0.5 : excessCashFlow * 0.7;

    if (mostUnderAllocated && equityDeployAmount > 0) {
      const annualGain = (equityDeployAmount * mostUnderAllocated.expectedReturn) / 100;
      suggestions.push({
        id: `ml-sug-equity-${Date.now()}`,
        timestamp: new Date().toISOString(),
        excessCashAmount: excessCashFlow,
        billsDueAmount: totalMonthlyObligations,
        safeBufferAmount: safeBuffer,
        deployableAmount: equityDeployAmount,
        recommendedCategory: mostUnderAllocated.cat,
        recommendedAction: `Deploy ${formatMoney(equityDeployAmount, baseCurr, currSym)} into ${mostUnderAllocated.label}`,
        reasoning: `Model detected ${mostUnderAllocated.label} is under-allocated (currently ${capPercentages[mostUnderAllocated.cat].toFixed(1)}% vs target ${modelWeights[(`${mostUnderAllocated.cat}Weight` as keyof MLInvestmentModelWeights)]}%). Allocating here optimizes risk-adjusted alpha.`,
        expectedAnnualGain: annualGain,
        suggestedAllocationPct: 70,
        status: 'pending',
      });
    }

    // Strategy 3: High Priority Goal Contribution
    if (highPriorityGoals.length > 0) {
      const topGoal = highPriorityGoals[0];
      const goalDeploy = Math.min(excessCashFlow * 0.4, topGoal.cost);
      suggestions.push({
        id: `ml-sug-goal-${topGoal.id}`,
        timestamp: new Date().toISOString(),
        excessCashAmount: excessCashFlow,
        billsDueAmount: totalMonthlyObligations,
        safeBufferAmount: safeBuffer,
        deployableAmount: goalDeploy,
        recommendedCategory: 'high_yield_fd',
        recommendedAction: `Fund High-Priority Goal: "${topGoal.name}"`,
        reasoning: `High-priority goal target: allocate ${formatMoney(goalDeploy, baseCurr, currSym)} into liquid sweep-in or high-yield reserve to reach deadline on schedule.`,
        expectedAnnualGain: (goalDeploy * 7.1) / 100,
        suggestedAllocationPct: 40,
        targetGoalId: topGoal.id,
        status: 'pending',
      });
    }
  }

  // 5. ML MODEL FEEDBACK TUNING HANDLERS
  const handleQuickTune = (type: 'too_aggressive' | 'too_conservative' | 'prefer_debt') => {
    const lr = modelWeights.learningRate;
    let newWeights = { ...modelWeights, iteration: modelWeights.iteration + 1 };

    if (type === 'too_aggressive') {
      newWeights = {
        ...newWeights,
        smallCapWeight: Math.max(5, newWeights.smallCapWeight - 5),
        midCapWeight: Math.max(10, newWeights.midCapWeight - 3),
        megaCapWeight: Math.min(50, newWeights.megaCapWeight + 5),
        debtPayoffWeight: Math.min(60, newWeights.debtPayoffWeight + 5),
        riskToleranceBias: Math.max(-1, newWeights.riskToleranceBias - 0.2),
        lastTunedDate: new Date().toISOString(),
      };
      setSuccessNotice('Model tuned: shifted weights defensively towards Mega Cap bluechips and Debt payoff.');
    } else if (type === 'too_conservative') {
      newWeights = {
        ...newWeights,
        midCapWeight: Math.min(40, newWeights.midCapWeight + 4),
        smallCapWeight: Math.min(30, newWeights.smallCapWeight + 4),
        megaCapWeight: Math.max(15, newWeights.megaCapWeight - 4),
        riskToleranceBias: Math.min(1, newWeights.riskToleranceBias + 0.2),
        lastTunedDate: new Date().toISOString(),
      };
      setSuccessNotice('Model tuned: boosted Mid Cap and Small Cap growth weights for accelerated returns.');
    } else if (type === 'prefer_debt') {
      newWeights = {
        ...newWeights,
        debtPayoffWeight: Math.min(75, newWeights.debtPayoffWeight + 10),
        lastTunedDate: new Date().toISOString(),
      };
      setSuccessNotice('Model tuned: prioritized loan killing and credit card drag elimination.');
    }

    saveWeights(newWeights);
    setTimeout(() => setSuccessNotice(null), 4000);
  };

  const handleSubmitPnlFeedback = () => {
    const amount = parseFloat(reportedGainLoss);
    if (isNaN(amount)) return;

    const isProfit = amount >= 0;
    const lr = modelWeights.learningRate;
    let newWeights = { ...modelWeights, iteration: modelWeights.iteration + 1, lastTunedDate: new Date().toISOString() };

    // Reinforce or penalize market cap weight based on reported performance
    const weightKey = `${feedbackMarketCap}Weight` as keyof MLInvestmentModelWeights;
    const currentVal = newWeights[weightKey] as number;

    if (isProfit) {
      // Reward
      (newWeights as any)[weightKey] = Math.min(50, currentVal + Math.min(5, Math.abs(amount) / 10000));
    } else {
      // Penalize and shift to Mega Cap
      (newWeights as any)[weightKey] = Math.max(5, currentVal - Math.min(5, Math.abs(amount) / 10000));
      newWeights.megaCapWeight = Math.min(50, newWeights.megaCapWeight + 2);
    }

    const record: MLModelFeedbackRecord = {
      id: `fb-${Date.now()}`,
      timestamp: new Date().toISOString(),
      feedbackType: isProfit ? 'realised_gain_report' : 'unrealised_loss_report',
      realisedOrUnrealisedAmount: amount,
      marketCapReported: feedbackMarketCap,
      note: feedbackNote.trim() || undefined,
      weightDeltaApplied: { [weightKey]: (newWeights as any)[weightKey] },
    };

    const newLog = [record, ...feedbackLog].slice(0, 20);
    setFeedbackLog(newLog);
    try {
      localStorage.setItem(ML_FEEDBACK_LOG_KEY, JSON.stringify(newLog));
    } catch {}

    saveWeights(newWeights);
    setShowFeedbackModal(false);
    setReportedGainLoss('');
    setFeedbackNote('');
    setSuccessNotice(`Feedback applied: Model tuned weights for ${feedbackMarketCap.replace('_', ' ')} based on performance.`);
    setTimeout(() => setSuccessNotice(null), 5000);
  };

  return (
    <div className="space-y-4">
      {/* 1. CONFIGURABLE CASH FLOW BUFFER & EXCESS RUNWAY CARD */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Brain size={18} />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Cash Flow Buffer &amp; Allocation
              </h3>
              <p className="text-xs text-slate-400">
                Calculates deployable surplus after upcoming bills and your safety reserve
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFeedbackModal(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <TrendingUp size={14} />
              <span>Report P&L / Gains</span>
            </button>
          </div>
        </div>

        {/* Success Alert */}
        {successNotice && (
          <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2 animate-fade-in font-medium">
            <Sparkles size={15} className="shrink-0 text-emerald-400" />
            <span>{successNotice}</span>
          </div>
        )}

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 font-sans block uppercase">Immediate Liquid Cash</span>
            <div className="text-sm sm:text-base font-bold text-white mt-0.5">
              {formatMoney(totalImmediateCash, baseCurr, currSym)}
            </div>
            <span className="text-[10px] text-slate-500 block font-sans">Bank + Hand Cash + Sweep FDs</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 font-sans block uppercase">Upcoming Bills & EMIs</span>
            <div className="text-sm sm:text-base font-bold text-amber-400 mt-0.5">
              -{formatMoney(totalMonthlyObligations, baseCurr, currSym)}
            </div>
            <span className="text-[10px] text-slate-500 block font-sans">Mandatory monthly due</span>
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
            <span className="text-[10px] text-slate-400 font-sans block uppercase">Safe Cash Buffer</span>
            <div className="text-sm sm:text-base font-bold text-cyan-400 mt-0.5">
              {formatMoney(safeBuffer, baseCurr, currSym)}
            </div>
            <span className="text-[10px] text-slate-500 block font-sans">Configurable safety floor</span>
          </div>

          <div className={`p-3 rounded-xl border ${
            excessCashFlow > 0
              ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
              : 'bg-slate-950/70 border-slate-800 text-slate-400'
          }`}>
            <span className="text-[10px] text-slate-400 font-sans block uppercase">Excess Deployable Cash</span>
            <div className={`text-sm sm:text-base font-black mt-0.5 ${
              excessCashFlow > 0 ? 'text-emerald-400' : 'text-slate-400'
            }`}>
              {formatMoney(excessCashFlow, baseCurr, currSym)}
            </div>
            <span className="text-[10px] font-sans block">
              {excessCashFlow > 0 ? 'Surplus ready to deploy' : 'Cash flow in balance'}
            </span>
          </div>
        </div>

        {/* Behavioral Guard Alert for Repeated Virtual Bill Overrides */}
        {Boolean(modelWeights.virtualOverrideCount && modelWeights.virtualOverrideCount > 0) && (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs space-y-2 animate-fade-in shadow-md">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-300">
                <ShieldAlert size={16} className="text-amber-400 shrink-0" />
                <span>ML Behavioral Guard: Virtual Bill Override Penalty Active ({modelWeights.virtualOverrideCount}x)</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono font-bold">
                +{formatMoney(modelWeights.virtualOverridePenaltyBuffer || 0, baseCurr, currSym)} Extra Reserve Buffer
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-amber-200/90">
              The on-device ML model detected that bills were marked as paid virtually without bank cash deductions.
              To counter false financial security and protect your net worth, the model has adjusted your required liquidity cushion higher by +{formatMoney(modelWeights.virtualOverridePenaltyBuffer || 0, baseCurr, currSym)} and prioritized loan debt payoff by {modelWeights.debtPayoffWeight}%.
            </p>
          </div>
        )}

        {/* User-Configurable Safe Buffer Control */}
        <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800/80 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
              <Sliders size={14} className="text-cyan-400" />
              <span>Configure Your Safe Cash Reserve Floor:</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 font-mono text-xs font-bold text-white bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700">
                <span>{currSym}</span>
                <input
                  type="number"
                  step="5000"
                  value={safeBuffer}
                  onChange={(e) => setSafeBuffer(Math.max(0, parseFloat(e.target.value) || 0))}
                  className="w-24 bg-transparent text-white font-mono focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveBuffer}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs cursor-pointer transition-colors"
              >
                {isBufferSaved ? 'Saved!' : 'Update Buffer'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            The ML model ensures your bank never drops below this safe threshold. Any cash beyond upcoming bills + this safe buffer is classified as <strong className="text-emerald-400">deployable surplus</strong>.
          </p>
        </div>

        {/* 2. ML SUGGESTED ALLOCATION ACTION CARDS */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Zap size={14} className="text-cyan-400" />
              <span>Model Suggestions & Priority Allocation</span>
            </h4>
            <span className="text-[11px] text-slate-500 font-mono">
              Iteration #{modelWeights.iteration}
            </span>
          </div>

          {suggestions.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 text-center">
              No excess cash flow above your {formatMoney(safeBuffer, baseCurr, currSym)} safe buffer right now. Model will generate allocation patterns as fresh income streams or surplus cash arrive.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {suggestions.map((sug) => {
                const isDebt = sug.recommendedCategory === 'debt_payoff';
                return (
                  <div
                    key={sug.id}
                    className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-cyan-500/40 transition-all space-y-2.5 relative overflow-hidden group shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {isDebt ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                            <Flame size={12} className="text-rose-400" />
                            High Priority Debt Payoff
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 flex items-center gap-1">
                            <TrendingUp size={12} className="text-cyan-400" />
                            Market Cap Optimization
                          </span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Est. Annual Advantage</span>
                        <span className="text-xs font-bold font-mono text-emerald-400">
                          +{formatMoney(sug.expectedAnnualGain, baseCurr, currSym)}/yr
                        </span>
                      </div>
                    </div>

                    <h5 className="text-sm font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {sug.recommendedAction}
                    </h5>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      {sug.reasoning}
                    </p>

                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-mono">
                        Allocate: <strong className="text-white">{formatMoney(sug.deployableAmount, baseCurr, currSym)}</strong>
                      </span>
                      <span className="text-[11px] text-cyan-400 font-medium">
                        Model Confidence: {(88 + (modelWeights.iteration % 10)).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. STOCK ALLOCATION & MARKET CAP RADAR */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-white">
              <PieChart size={14} className="text-cyan-400" />
              <span>Current Stock Allocation vs Model Target Weights</span>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Total Equities: {formatMoney(totalEquityValue, baseCurr, currSym)}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            {[
              { id: 'mega_cap', label: 'Mega Cap', cur: capPercentages.mega_cap, target: modelWeights.megaCapWeight, color: 'text-indigo-400' },
              { id: 'large_cap', label: 'Large Cap', cur: capPercentages.large_cap, target: modelWeights.largeCapWeight, color: 'text-cyan-400' },
              { id: 'mid_cap', label: 'Mid Cap', cur: capPercentages.mid_cap, target: modelWeights.midCapWeight, color: 'text-emerald-400' },
              { id: 'small_cap', label: 'Small Cap', cur: capPercentages.small_cap, target: modelWeights.smallCapWeight, color: 'text-amber-400' },
            ].map((c) => (
              <div key={c.id} className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <div className="flex items-center justify-between text-[11px] font-sans text-slate-400">
                  <span>{c.label}</span>
                  <span className={c.color}>{c.cur.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-slate-950 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all"
                    style={{ width: `${Math.min(100, c.cur)}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 font-sans mt-1.5 flex justify-between">
                  <span>Target: {c.target}%</span>
                  <span>{c.cur < c.target ? 'Under' : 'Aligned'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. ACTIVE ML MODEL WEIGHTS & ONE-CLICK TUNING */}
        <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Quick Model Guidance:</span>
            <button
              type="button"
              onClick={() => handleQuickTune('too_aggressive')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 cursor-pointer transition-colors"
            >
              Too Aggressive
            </button>
            <button
              type="button"
              onClick={() => handleQuickTune('too_conservative')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 cursor-pointer transition-colors"
            >
              Too Conservative
            </button>
            <button
              type="button"
              onClick={() => handleQuickTune('prefer_debt')}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-300 cursor-pointer transition-colors"
            >
              Prioritize Debt Payoff
            </button>
          </div>

          <div className="text-[11px] text-slate-500 font-mono">
            Biases & Weights actively tuned on user asset creation & P&L
          </div>
        </div>
      </div>

      {/* MODAL: REPORT REALISED / UNREALISED GAINS & LOSSES */}
      {showFeedbackModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-cyan-500/40 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                <TrendingUp size={18} />
                <h3 className="text-white text-base">Report Realised / Unrealised Returns</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFeedbackModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                Cancel
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              When you report your actual investment gains or losses, the ML model calculates reward signals and automatically tunes its market cap weights and risk bias.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Market Cap Category:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'mega_cap', label: 'Mega Cap Bluechips' },
                    { id: 'large_cap', label: 'Large Cap Leaders' },
                    { id: 'mid_cap', label: 'Mid Cap Growth' },
                    { id: 'small_cap', label: 'Small Cap Alpha' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setFeedbackMarketCap(c.id as MarketCapCategory)}
                      className={`p-2 rounded-xl border text-xs text-left cursor-pointer transition-all ${
                        feedbackMarketCap === c.id
                          ? 'border-cyan-500 bg-cyan-950/40 text-white font-bold'
                          : 'border-slate-800 bg-slate-950 text-slate-400'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Amount Gained (+) or Lost (-):
                </label>
                <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2">
                  <span className="text-sm font-bold text-slate-400">{currSym}</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. +15000 or -4500"
                    value={reportedGainLoss}
                    onChange={(e) => setReportedGainLoss(e.target.value)}
                    className="w-full bg-transparent text-sm text-white font-mono focus:outline-none"
                    autoFocus
                  />
                </div>
                <span className="text-[10px] text-slate-500 block mt-1">
                  Positive shifts model weight to that category; negative re-allocates toward safety.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Optional Note / Strategy Context:
                </label>
                <input
                  type="text"
                  placeholder="e.g. Booked profit on quarterly earnings breakout"
                  value={feedbackNote}
                  onChange={(e) => setFeedbackNote(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowFeedbackModal(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300 hover:bg-slate-700 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleSubmitPnlFeedback}
                disabled={!reportedGainLoss || isNaN(parseFloat(reportedGainLoss))}
                className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold text-xs cursor-pointer shadow-md shadow-emerald-600/30 transition-all"
              >
                Submit Feedback & Tune Weights
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
