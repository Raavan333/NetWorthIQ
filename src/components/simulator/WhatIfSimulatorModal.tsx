import React, { useState, useMemo } from 'react';
import { Currency } from '../../types';
import { useApp } from '../../context/AppContext';
import { runWhatIfSimulation } from '../../lib/whatIfSimulator';
import { formatMoney } from '../../lib/formatters';
import {
  X,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  RotateCcw,
  Clock,
  Flame,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  SlidersHorizontal,
  Minimize2,
  Maximize2,
  ChevronRight,
  Activity,
} from 'lucide-react';

interface Props {
  onClose: () => void;
}

export const WhatIfSimulatorModal: React.FC<Props> = ({ onClose }) => {
  const { holdings, liabilities, bills, settings, currencies, engineResult, tickerValue } = useApp();

  const activeLoans = useMemo(
    () => liabilities.filter((l) => l.kind === 'loan' && (l.outstanding || 0) > 0),
    [liabilities]
  );
  const activeCards = useMemo(
    () => liabilities.filter((l) => l.kind === 'card' && (l.outstanding || 0) > 0),
    [liabilities]
  );

  // Precision numerical values & string input drafts to allow exact paisa/cents typing
  const [extraLoanPayment, setExtraLoanPayment] = useState<number>(5000);
  const [extraLoanInput, setExtraLoanInput] = useState<string>('5000');
  const [selectedLoanId, setSelectedLoanId] = useState<string>(activeLoans[0]?.id || '');

  const [additionalSavings, setAdditionalSavings] = useState<number>(0);
  const [additionalSavingsInput, setAdditionalSavingsInput] = useState<string>('0');

  const [cardLumpSum, setCardLumpSum] = useState<number>(0);
  const [cardLumpSumInput, setCardLumpSumInput] = useState<string>('0');
  const [selectedCardId, setSelectedCardId] = useState<string>(activeCards[0]?.id || '');

  // Floating dock mode: lets the user minimize the simulator to browse any page freely without losing simulation state
  const [isDocked, setIsDocked] = useState(false);

  const currMap = useMemo(() => {
    const map: Record<string, Currency> = {};
    for (const c of currencies) map[c.code] = c;
    return map;
  }, [currencies]);

  const baseSymbol = useMemo(() => {
    return currencies.find((c) => c.code === settings.baseCurrency)?.symbol || `${settings.baseCurrency} `;
  }, [currencies, settings.baseCurrency]);

  // Formatter that shows exact 2 decimals if user entered cents/paisa, or whole integers otherwise
  const fmtAuto = (amt: number) => {
    const hasDecimals = Math.abs(amt % 1) >= 0.005;
    return formatMoney(amt, settings.baseCurrency, baseSymbol, settings.numberGrouping, hasDecimals ? 2 : 0);
  };

  const handleExtraLoanChange = (val: string) => {
    setExtraLoanInput(val);
    const parsed = parseFloat(val);
    setExtraLoanPayment(isNaN(parsed) || parsed < 0 ? 0 : parsed);
  };

  const handleSavingsChange = (val: string) => {
    setAdditionalSavingsInput(val);
    const parsed = parseFloat(val);
    setAdditionalSavings(isNaN(parsed) || parsed < 0 ? 0 : parsed);
  };

  const handleCardLumpSumChange = (val: string) => {
    setCardLumpSumInput(val);
    const parsed = parseFloat(val);
    setCardLumpSum(isNaN(parsed) || parsed < 0 ? 0 : parsed);
  };

  const updateExtraLoan = (val: number) => {
    const clean = Math.max(0, val);
    setExtraLoanPayment(clean);
    setExtraLoanInput(clean % 1 === 0 ? clean.toString() : clean.toFixed(2));
  };

  const updateSavings = (val: number) => {
    const clean = Math.max(0, val);
    setAdditionalSavings(clean);
    setAdditionalSavingsInput(clean % 1 === 0 ? clean.toString() : clean.toFixed(2));
  };

  const updateCardLumpSum = (val: number) => {
    const clean = Math.max(0, val);
    setCardLumpSum(clean);
    setCardLumpSumInput(clean % 1 === 0 ? clean.toString() : clean.toFixed(2));
  };

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

  // Presets calibration
  const applyPreset = (preset: 'debt' | 'balanced' | 'savings' | 'reset') => {
    if (preset === 'debt') {
      updateExtraLoan(10000);
      updateSavings(0);
      const cardAmt = activeCards[0] ? Math.min(25000, activeCards[0].outstanding) : 10000;
      updateCardLumpSum(cardAmt);
    } else if (preset === 'balanced') {
      updateExtraLoan(4000);
      updateSavings(5000);
      updateCardLumpSum(0);
    } else if (preset === 'savings') {
      updateExtraLoan(0);
      updateSavings(15000);
      updateCardLumpSum(0);
    } else {
      updateExtraLoan(0);
      updateSavings(0);
      updateCardLumpSum(0);
    }
  };

  // Dynamic slider limits that gracefully scale when user enters large amounts
  const sliderMaxLoan = Math.max(50000, Math.ceil(extraLoanPayment * 1.25));
  const sliderMaxSavings = Math.max(100000, Math.ceil(additionalSavings * 1.25));
  const sliderMaxCard = Math.max(200000, Math.ceil(cardLumpSum * 1.25));

  const baselineMonths = Math.max(1, scenario.results.baselineDebtFreeMonths || 1);
  const projectedMonths = Math.max(1, scenario.results.projectedDebtFreeMonths || 1);
  const percentReduction = Math.min(
    100,
    Math.round(((baselineMonths - projectedMonths) / baselineMonths) * 100)
  );

  // 12-Month Net Worth Trajectory series comparing Baseline vs Accelerated What-If
  const trajectorySeries = useMemo(() => {
    const points: { month: number; label: string; baseline: number; projected: number }[] = [];
    const baseNWInitial = tickerValue || engineResult.netWorthBase || 0;
    const netDelta1Yr = Math.max(0, scenario.results.projectedNetWorth1Yr - scenario.results.baselineNetWorth1Yr);
    const baseline1YrDelta = scenario.results.baselineNetWorth1Yr - baseNWInitial;

    for (let m = 0; m <= 12; m++) {
      const progress = m / 12;
      const baseNW = baseNWInitial + baseline1YrDelta * progress;
      const projNW = baseNW + netDelta1Yr * progress;
      points.push({
        month: m,
        label: m === 0 ? 'Now' : `M${m}`,
        baseline: Math.round(baseNW),
        projected: Math.round(projNW),
      });
    }
    return points;
  }, [tickerValue, engineResult.netWorthBase, scenario.results]);

  // SVG Coordinates for the 12-Month Trajectory Chart
  const chartSvgData = useMemo(() => {
    if (trajectorySeries.length === 0) return null;
    const allVals = trajectorySeries.flatMap((p) => [p.baseline, p.projected]);
    const minVal = Math.min(...allVals);
    const maxVal = Math.max(...allVals);
    const range = Math.max(1, maxVal - minVal);

    const width = 500;
    const height = 130;
    const padX = 24;
    const padY = 16;
    const chartW = width - padX * 2;
    const chartH = height - padY * 2;

    const toX = (i: number) => padX + (i / 12) * chartW;
    const toY = (v: number) => padY + chartH - ((v - minVal) / range) * chartH;

    const baselineD = trajectorySeries.reduce(
      (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.baseline).toFixed(1)}`,
      ''
    );

    const projectedD = trajectorySeries.reduce(
      (acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.projected).toFixed(1)}`,
      ''
    );

    const areaD = `${projectedD} L ${toX(12).toFixed(1)} ${height - padY} L ${toX(0).toFixed(1)} ${height - padY} Z`;

    return {
      width,
      height,
      baselineD,
      projectedD,
      areaD,
      endBaselineY: toY(trajectorySeries[12].baseline),
      endProjectedY: toY(trajectorySeries[12].projected),
      endX: toX(12),
      startBaselineY: toY(trajectorySeries[0].baseline),
      startX: toX(0),
    };
  }, [trajectorySeries]);

  // FLOATING DOCKED WIDGET: Gives user complete freedom to navigate and inspect real pages without losing state
  if (isDocked) {
    return (
      <div className="fixed bottom-20 sm:bottom-6 right-3 sm:right-6 z-50 bg-slate-900/95 backdrop-blur-md border border-blue-500/40 shadow-2xl rounded-2xl p-3 sm:p-3.5 flex items-center gap-3 animate-fade-in max-w-sm">
        <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
          <Sparkles size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <span>What-If Simulation Active</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <p className="text-[11px] text-slate-300 font-mono truncate">
            {scenario.results.debtMonthsSaved > 0
              ? `${scenario.results.debtMonthsSaved} mo saved`
              : 'Active levers'}{' '}
            · {fmtAuto(scenario.results.interestSaved)} saved
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsDocked(false)}
            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-sm transition-colors"
            title="Expand Full Simulator View"
          >
            <Maximize2 size={13} />
            <span>Expand</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Simulator"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-3 md:p-6 bg-black/75 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="w-full h-full sm:h-auto sm:max-h-[92vh] max-w-5xl bg-slate-900 border-0 sm:border sm:border-slate-800/80 sm:rounded-2xl shadow-2xl flex flex-col overflow-y-auto overscroll-contain text-slate-100 relative">
        {/* Header - Relative, flexible and scrollable (always at top when scrolled up, but scrolls out of view so it never blocks the visible overview) */}
        <div className="relative w-full flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-slate-800/80 bg-slate-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 sm:p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight">
                  Scenario Simulator
                </h2>
                <span className="hidden sm:inline-block text-[10px] text-slate-500 font-mono">
                  Live Sandbox
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Simulate debt velocity, compounding savings, and 12-month wealth trajectories
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button
              type="button"
              onClick={() => setIsDocked(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer border border-slate-700/60 shadow-xs"
              title="Dock simulator to a floating tray so you can browse and inspect all pages"
            >
              <Minimize2 size={13} className="text-cyan-400" />
              <span className="hidden sm:inline">Browse Pages</span>
            </button>
            <button
              onClick={() => applyPreset('reset')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors cursor-pointer border border-slate-700/60 shadow-xs"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm flex items-center gap-1"
              aria-label="Done"
            >
              <span>Done</span>
            </button>
          </div>
        </div>

        {/* Unified Scrollable Body - Naturally flows below header without any fixed or sticky blocking overlays */}
        <div className="p-4 sm:p-6 space-y-5">
          {/* Active Financial Foundation Context Bar (Displays actual user balance sheet data visually) */}
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="font-semibold text-slate-200">Active Balance Sheet Baseline:</span>
              <span className="text-slate-400">
                Liquid Cash: <strong className="text-emerald-400 font-mono">{fmtAuto(engineResult.immediateCashBase || 0)}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">
                Total Debt: <strong className="text-rose-400 font-mono">{fmtAuto(engineResult.totalLiabilitiesBase || 0)}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400 font-mono">
                {activeLoans.length} active {activeLoans.length === 1 ? 'loan' : 'loans'}
                {activeCards.length > 0 ? ` · ${activeCards.length} cards` : ''}
              </span>
            </div>

            <div className="text-[11px] text-slate-400 flex items-center gap-1">
              <Activity size={12} className="text-cyan-400" />
              <span>Real-time compounding against current ledger</span>
            </div>
          </div>

          {/* Strategy Presets Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-950/70 border border-slate-800/70">
            <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
              <SlidersHorizontal size={14} className="text-blue-400" />
              <span>Preset Strategies</span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
              <button
                type="button"
                onClick={() => applyPreset('debt')}
                className="px-3 py-1.5 rounded-lg bg-blue-950/40 border border-blue-700/40 text-blue-200 text-xs font-medium flex items-center gap-1.5 shrink-0 hover:bg-blue-900/40 cursor-pointer transition-all"
              >
                <Flame size={13} className="text-orange-400" />
                <span>Debt Freedom Sprint</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('balanced')}
                className="px-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700/60 text-slate-200 text-xs font-medium flex items-center gap-1.5 shrink-0 hover:bg-slate-700/70 cursor-pointer transition-all"
              >
                <TrendingUp size={13} className="text-emerald-400" />
                <span>Balanced Growth</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('savings')}
                className="px-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700/60 text-slate-200 text-xs font-medium flex items-center gap-1.5 shrink-0 hover:bg-slate-700/70 cursor-pointer transition-all"
              >
                <ShieldCheck size={13} className="text-cyan-400" />
                <span>Savings Maximizer</span>
              </button>
              <button
                type="button"
                onClick={() => applyPreset('reset')}
                className="sm:hidden px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* 4 Outcome Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Debt Freedom Horizon</span>
              <div className="mt-2 flex items-baseline justify-between flex-wrap gap-1">
                <span className="text-base sm:text-lg font-bold text-blue-400 font-mono">
                  {scenario.results.debtMonthsSaved > 0
                    ? `${scenario.results.debtMonthsSaved} mo saved`
                    : 'Baseline'}
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {scenario.results.projectedDebtFreeMonths} mo left
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Total Interest Saved</span>
              <div className="mt-2 flex items-baseline justify-between flex-wrap gap-1">
                <span className="text-base sm:text-lg font-bold text-emerald-400 font-mono">
                  {fmtAuto(scenario.results.interestSaved)}
                </span>
                <span className="text-[11px] text-emerald-500/80 font-mono">
                  eliminated
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">1-Year Net Worth Trajectory</span>
              <div className="mt-2 flex items-baseline justify-between flex-wrap gap-1">
                <span className="text-base sm:text-lg font-bold text-slate-100 font-mono">
                  {fmtAuto(scenario.results.projectedNetWorth1Yr)}
                </span>
                <span className="text-[11px] text-emerald-400 font-mono flex items-center gap-0.5">
                  <ArrowUpRight size={11} />
                  {fmtAuto(Math.max(0, scenario.results.projectedNetWorth1Yr - scenario.results.baselineNetWorth1Yr))}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col justify-between">
              <span className="text-[11px] text-slate-400 font-medium">Monthly Outflow Impact</span>
              <div className="mt-2 flex items-baseline justify-between flex-wrap gap-1">
                <span className="text-base sm:text-lg font-bold text-purple-300 font-mono">
                  +{fmtAuto(scenario.results.monthlyCashFlowImpact)}/mo
                </span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {scenario.results.emergencyReserveProtected ? 'Reserve secure' : 'Buffer alert'}
                </span>
              </div>
            </div>
          </div>

          {/* VISUAL TRAJECTORY GRAPH: 12-Month Net Worth Delta & Acceleration Comparison */}
          {chartSvgData && (
            <div className="p-4 sm:p-5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TrendingUp size={15} className="text-emerald-400" />
                  <span className="text-xs font-semibold text-slate-200">
                    12-Month Net Worth Trajectory: Baseline vs. What-If Acceleration
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="w-3 h-0.5 border-t border-dashed border-slate-500" />
                    <span>Baseline Track</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <span className="w-3 h-1 bg-emerald-400 rounded-full" />
                    <span>What-If Plan</span>
                  </div>
                </div>
              </div>

              <div className="relative w-full overflow-hidden">
                <svg
                  viewBox={`0 0 ${chartSvgData.width} ${chartSvgData.height}`}
                  className="w-full h-32 sm:h-36 overflow-visible"
                >
                  <defs>
                    <linearGradient id="whatifAccelGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

                  {/* Shaded Area of Gain */}
                  <path d={chartSvgData.areaD} fill="url(#whatifAccelGrad)" />

                  {/* Baseline Line (Muted & Dashed) */}
                  <path
                    d={chartSvgData.baselineD}
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                  />

                  {/* Projected Accelerated Line (Glowing Emerald) */}
                  <path
                    d={chartSvgData.projectedD}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.5"
                  />

                  {/* Milestone Points */}
                  <circle
                    cx={chartSvgData.startX}
                    cy={chartSvgData.startBaselineY}
                    r="3.5"
                    fill="#38bdf8"
                  />
                  <circle
                    cx={chartSvgData.endX}
                    cy={chartSvgData.endProjectedY}
                    r="4"
                    fill="#10b981"
                  />
                  <circle
                    cx={chartSvgData.endX}
                    cy={chartSvgData.endBaselineY}
                    r="3.5"
                    fill="#64748b"
                  />
                </svg>

                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                  <span>Current Baseline (Month 0)</span>
                  <span>Month 3</span>
                  <span>Month 6</span>
                  <span>Month 9</span>
                  <span className="text-emerald-400 font-bold">Month 12 Projected</span>
                </div>
              </div>
            </div>
          )}

          {/* Dual Column Balanced Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Column 1: Interactive Levers & Allocation Summary (lg:col-span-6) */}
            <div className="lg:col-span-6 space-y-4">
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Decision Levers
                </div>

                {/* Lever 1: Extra Monthly Debt Payment */}
                <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-slate-200">
                      Extra Monthly Debt Payment
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-2.5 text-xs font-mono text-slate-400 pointer-events-none">
                        {baseSymbol.trim()}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={extraLoanInput}
                        onChange={(e) => handleExtraLoanChange(e.target.value)}
                        placeholder="0.00"
                        className="w-32 sm:w-36 pl-7 pr-2.5 py-1 text-right text-xs font-mono font-semibold bg-slate-950 border border-slate-700/80 rounded-lg text-blue-300 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max={sliderMaxLoan}
                    step="any"
                    value={extraLoanPayment}
                    onChange={(e) => updateExtraLoan(Number(e.target.value))}
                    className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-0.5">
                    {[0, 1000, 5000, 10000, 20000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => updateExtraLoan(amt)}
                        className={`px-2 py-1 text-[10px] rounded-md font-mono transition-colors cursor-pointer border ${
                          extraLoanPayment === amt
                            ? 'bg-blue-600/30 border-blue-500/60 text-blue-200 font-semibold'
                            : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>

                  {activeLoans.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/60">
                      <label className="text-[11px] text-slate-400 block mb-1">Target Debt</label>
                      <select
                        value={selectedLoanId}
                        onChange={(e) => setSelectedLoanId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                      >
                        <option value="">Apply across Highest APR Debt</option>
                        {activeLoans.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name} ({fmtAuto(l.outstanding)} @ {l.ratePct}%)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Lever 2: Additional Monthly Savings */}
                <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-slate-200">
                      Additional Monthly Savings
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-2.5 text-xs font-mono text-slate-400 pointer-events-none">
                        {baseSymbol.trim()}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={additionalSavingsInput}
                        onChange={(e) => handleSavingsChange(e.target.value)}
                        placeholder="0.00"
                        className="w-32 sm:w-36 pl-7 pr-2.5 py-1 text-right text-xs font-mono font-semibold bg-slate-950 border border-slate-700/80 rounded-lg text-emerald-300 focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max={sliderMaxSavings}
                    step="any"
                    value={additionalSavings}
                    onChange={(e) => updateSavings(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-0.5">
                    {[0, 2000, 5000, 15000, 30000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => updateSavings(amt)}
                        className={`px-2 py-1 text-[10px] rounded-md font-mono transition-colors cursor-pointer border ${
                          additionalSavings === amt
                            ? 'bg-emerald-600/30 border-emerald-500/60 text-emerald-200 font-semibold'
                            : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lever 3: Lump-Sum Credit Card Payoff */}
                <div className="p-3.5 rounded-lg bg-slate-900/60 border border-slate-800/80 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-slate-200">
                      Lump-Sum Card Payoff
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-2.5 text-xs font-mono text-slate-400 pointer-events-none">
                        {baseSymbol.trim()}
                      </span>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={cardLumpSumInput}
                        onChange={(e) => handleCardLumpSumChange(e.target.value)}
                        placeholder="0.00"
                        className="w-32 sm:w-36 pl-7 pr-2.5 py-1 text-right text-xs font-mono font-semibold bg-slate-950 border border-slate-700/80 rounded-lg text-cyan-300 focus:outline-none focus:border-cyan-500 transition-colors"
                      />
                    </div>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max={sliderMaxCard}
                    step="any"
                    value={cardLumpSum}
                    onChange={(e) => updateCardLumpSum(Number(e.target.value))}
                    className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />

                  <div className="flex items-center justify-between gap-1.5 pt-0.5">
                    {[0, 5000, 10000, 25000, 50000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => updateCardLumpSum(amt)}
                        className={`px-2 py-1 text-[10px] rounded-md font-mono transition-colors cursor-pointer border ${
                          cardLumpSum === amt
                            ? 'bg-cyan-600/30 border-cyan-500/60 text-cyan-200 font-semibold'
                            : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {amt === 0 ? '0' : `+${amt >= 1000 ? `${amt / 1000}k` : amt}`}
                      </button>
                    ))}
                  </div>

                  {activeCards.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/60">
                      <label className="text-[11px] text-slate-400 block mb-1">Target Card</label>
                      <select
                        value={selectedCardId}
                        onChange={(e) => setSelectedCardId(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                      >
                        <option value="">Auto-Apply to Highest Utilization Card</option>
                        {activeCards.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({fmtAuto(c.outstanding)} balance)
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Monthly Allocation Breakdown Card */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2.5">
                <div className="text-xs font-medium text-slate-400">
                  Simulated Monthly Allocation Summary
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-[11px] text-slate-400 font-sans block">Monthly Extra Outflow</span>
                    <span className="text-sm font-bold text-white">
                      +{fmtAuto(extraLoanPayment + additionalSavings)}/mo
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60">
                    <span className="text-[11px] text-slate-400 font-sans block">One-Time Card Payoff</span>
                    <span className="text-sm font-bold text-cyan-300">
                      {fmtAuto(cardLumpSum)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Visual Horizons, Reserve Health & Synthesis (lg:col-span-6) */}
            <div className="lg:col-span-6 space-y-4">
              {/* Repayment Horizon Comparison */}
              <div className="p-4 sm:p-5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <Clock size={14} className="text-blue-400" />
                    Repayment Horizon Comparison
                  </span>
                  {percentReduction > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      {percentReduction}% Faster Freedom
                    </span>
                  )}
                </div>

                <div className="space-y-3 text-xs pt-1">
                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>Baseline Duration</span>
                      <span className="font-mono text-slate-300">{baselineMonths} months</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div className="h-full bg-slate-600 rounded-full" style={{ width: '100%' }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 mb-1">
                      <span>Accelerated Duration</span>
                      <span className="font-mono font-bold text-emerald-400">{projectedMonths} months</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <div
                        className="h-full bg-linear-to-r from-blue-500 to-emerald-400 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.max(5, Math.min(100, (projectedMonths / baselineMonths) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800/70 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    <span className="text-slate-300">Interest Expense Eliminated:</span>
                  </div>
                  <span className="font-mono font-bold text-emerald-400 text-sm">
                    {fmtAuto(scenario.results.interestSaved)}
                  </span>
                </div>
              </div>

              {/* Sub-grid: 1-Year Net Worth & Reserve Health */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1-Year Net Worth Trajectory Card */}
                <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1.5 flex flex-col justify-between">
                  <span className="text-[11px] text-slate-400 font-medium">1-Year Net Worth Delta</span>
                  <div className="text-base font-bold text-white font-mono">
                    +{fmtAuto(Math.max(0, scenario.results.projectedNetWorth1Yr - scenario.results.baselineNetWorth1Yr))}
                  </div>
                  <span className="text-[10px] text-slate-500">
                    Projected: {fmtAuto(scenario.results.projectedNetWorth1Yr)}
                  </span>
                </div>

                {/* Emergency Reserve Protection Card */}
                <div
                  className={`p-3.5 rounded-xl border space-y-1.5 flex flex-col justify-between ${
                    scenario.results.emergencyReserveProtected
                      ? 'bg-blue-950/20 border-blue-800/40 text-blue-200'
                      : 'bg-amber-950/20 border-amber-800/40 text-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium">Emergency Buffer</span>
                    {scenario.results.emergencyReserveProtected ? (
                      <ShieldCheck size={14} className="text-blue-400" />
                    ) : (
                      <AlertTriangle size={14} className="text-amber-400" />
                    )}
                  </div>
                  <div className="text-sm font-bold font-mono">
                    {scenario.results.emergencyReserveProtected ? 'Protected' : 'Warning'}
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Target: {fmtAuto(settings.cashFlowBufferAmount || 50000)}
                  </span>
                </div>
              </div>

              {/* Dynamic Strategy Verdict */}
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Scenario Synthesis
                </span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {extraLoanPayment > 0 || cardLumpSum > 0 || additionalSavings > 0 ? (
                    <>
                      By dedicating{' '}
                      <strong className="text-white">
                        {fmtAuto(extraLoanPayment + additionalSavings)}/mo
                      </strong>{' '}
                      in surplus funds, you knock{' '}
                      <strong className="text-blue-400">{scenario.results.debtMonthsSaved} months</strong> off
                      your repayment horizon and save{' '}
                      <strong className="text-emerald-400">{fmtAuto(scenario.results.interestSaved)}</strong> in
                      loan interest over time.
                    </>
                  ) : (
                    'Adjust the decision levers on the left to see instant comparative debt payoff trajectories and compounding wealth impact.'
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Natural scrollable end actions — scrollable with the page */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 pb-8 border-t border-slate-800/60">
            <div className="text-[11px] text-slate-500">
              Read-only simulation sandbox. Simulated levers do not alter your saved accounts, debts, or ledger entries.
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsDocked(true)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium cursor-pointer border border-slate-700 transition-colors"
              >
                Browse Pages
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold cursor-pointer shadow-sm transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
