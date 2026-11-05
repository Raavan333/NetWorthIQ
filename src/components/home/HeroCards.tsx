import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatCompactMoney, formatMoney } from '../../lib/formatters';
import { Layers, ShieldCheck, Zap, Info, ChevronRight, GraduationCap, ArrowRight } from 'lucide-react';
import { Modal } from '../common/Modal';

import { calculateFinalRate } from '../../lib/calcEngine';

export const HeroCards: React.FC = () => {
  const { engineResult, settings, currencies, setActiveTab, careerPrediction } = useApp();

  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Assets yearly return percentage on asset capital
  const assetsReturnPct =
    engineResult.totalAssetsBase > 0
      ? (engineResult.assetsYearlyReturnBase / engineResult.totalAssetsBase) * 100
      : 0;

  // Liabilities yearly cost percentage on debt capital
  const liabilitiesCostPct =
    engineResult.totalLiabilitiesBase > 0
      ? (engineResult.liabilitiesYearlyCostBase / engineResult.totalLiabilitiesBase) * 100
      : 0;

  // Exact contribution of each stream towards Net Rate (%) with negative net worth guardrails
  const rateResult = calculateFinalRate(
    engineResult.totalAssetsBase,
    engineResult.totalLiabilitiesBase,
    engineResult.netWorthBase,
    settings.finalRateDenominator,
    engineResult.finalRateAmountPerYear
  );
  const effectiveDenom = rateResult.effectiveDenominator > 0 ? rateResult.effectiveDenominator : 1;

  const salaryContributionPct =
    (engineResult.salaryYearlyIncomeBase / effectiveDenom) * 100;
  const assetYieldContributionPct =
    (engineResult.assetsYearlyReturnBase / effectiveDenom) * 100;
  const liabilitiesDragPct =
    (engineResult.liabilitiesYearlyCostBase / effectiveDenom) * 100;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-4">
        {/* 1. Total Assets Card */}
        <div
          onClick={() => setActiveTab('assets')}
          className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 hover:border-slate-700 transition-all cursor-pointer relative overflow-hidden group shadow-md"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Total Assets</span>
            <div className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <Layers size={14} />
            </div>
          </div>

          <div className="text-xl font-bold text-white font-mono">
            {formatCompactMoney(
              engineResult.totalAssetsBase,
              baseCurr,
              currSym,
              settings.numberGrouping
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-xs">
            <span className="text-emerald-400 font-semibold font-mono">
              +{assetsReturnPct.toFixed(1)}% p.a.
            </span>
            <span className="text-slate-400 text-[11px]">
              (+{formatCompactMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}/yr)
            </span>
          </div>

          {/* Human Capital Link */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-cyan-400 font-medium group-hover:text-cyan-300">
            <span className="flex items-center gap-1 truncate">
              <GraduationCap size={13} className="shrink-0" />
              Skill Earning Power: {formatCompactMoney(engineResult.salaryYearlyIncomeBase, baseCurr, currSym)}/yr
            </span>
            <ChevronRight size={13} className="shrink-0 group-hover:translate-x-0.5 transition-transform" />
          </div>
        </div>

        {/* 2. Total Liabilities Card */}
        <div
          onClick={() => setActiveTab('liabilities')}
          className={`rounded-2xl bg-slate-900/90 border p-4 transition-all cursor-pointer relative overflow-hidden group shadow-md ${
            engineResult.hasCardAlert
              ? 'border-rose-500/60 bg-rose-950/10'
              : 'border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Total Liabilities</span>
            <div className="w-6 h-6 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center">
              <ShieldCheck size={14} />
            </div>
          </div>

          <div className="text-xl font-bold text-white font-mono">
            {formatCompactMoney(
              engineResult.totalLiabilitiesBase,
              baseCurr,
              currSym,
              settings.numberGrouping
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-xs">
            <span className="text-rose-400 font-semibold font-mono">
              -{liabilitiesCostPct.toFixed(1)}% p.a.
            </span>
            <span className="text-slate-400 text-[11px]">
              (-{formatCompactMoney(engineResult.liabilitiesYearlyCostBase, baseCurr, currSym)}/yr)
            </span>
          </div>

          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Interest drag on wealth</span>
            <span className="font-mono text-rose-400 font-semibold">
              -{liabilitiesDragPct.toFixed(1)}% net impact
            </span>
          </div>
        </div>

        {/* 3. Final Net Cash Engine Card */}
        <div
          onClick={() => setIsBreakdownOpen(true)}
          className="rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 p-4 relative overflow-hidden shadow-md cursor-pointer group transition-all"
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold uppercase tracking-wider">Net Compounding Rate</span>
            <div className="w-6 h-6 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
              <Zap size={14} />
            </div>
          </div>

          <div className="text-xl font-bold text-white font-mono">
            {formatCompactMoney(
              engineResult.finalRateAmountPerYear,
              baseCurr,
              currSym,
              settings.numberGrouping
            )}
            <span className="text-xs text-slate-400 font-normal ml-1">/yr</span>
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-xs">
            <span
              className={`font-semibold font-mono ${
                engineResult.finalRatePct > 0
                  ? 'text-emerald-400'
                  : engineResult.finalRatePct < 0
                  ? 'text-rose-400'
                  : 'text-slate-300'
              }`}
            >
              {engineResult.finalRatePct > 0 ? '+' : ''}
              {engineResult.finalRatePct.toFixed(2)}% p.a.
            </span>
            <span className="text-slate-400 text-[11px]">on net worth</span>
          </div>

          {/* Physical Capital Yield Trigger */}
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
            <span className="text-slate-400 truncate mr-1">
              Physically present capital yield
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsBreakdownOpen(true);
              }}
              className="text-cyan-400 hover:text-cyan-200 transition-colors font-medium flex items-center gap-0.5 cursor-pointer bg-transparent border-none p-0 shrink-0"
              title="View Physical Rate Breakdown"
            >
              <span>Why {engineResult.finalRatePct >= 0 ? '+' : ''}{engineResult.finalRatePct.toFixed(1)}%?</span>
              <ChevronRight size={12} className="inline opacity-80" />
            </button>
          </div>
        </div>
      </div>

      {/* Net Rate Mathematical Explanation Modal */}
      {isBreakdownOpen && (
        <Modal
          isOpen={isBreakdownOpen}
          onClose={() => setIsBreakdownOpen(false)}
          title="Physical Net Compounding Engine"
          subtitle={`Calculated strictly on physically present money & assets: +${assetsReturnPct.toFixed(1)}% Asset yield − ${liabilitiesCostPct.toFixed(1)}% Debt cost = ${engineResult.finalRatePct >= 0 ? '+' : ''}${engineResult.finalRatePct.toFixed(2)}% Net Annual Physical Yield`}
          maxWidth="max-w-xl"
        >
          <div className="space-y-4 text-xs">
            {/* The Core Formula */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 block">
                Physical Capital Principle
              </span>
              <div className="p-2.5 rounded-lg bg-slate-900 font-mono text-center text-xs text-slate-200 border border-slate-800">
                Net Compounding % = <br className="sm:hidden" />
                (Annual Assets Yield − Annual Debt Cost − Penalties) ÷ Net Worth Base
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Your Net Worth Rate is calculated strictly on <strong className="text-emerald-400">physically present money and assets</strong> (bank balances, FDs, and investments yielding returns minus contractual debt costs). Salary is an incoming cash flow event, not physically present capital until it lands inside your bank account on payday. Keeping salary independent ensures your net worth compounding reflects reality rather than future promises.
              </p>
            </div>

            {/* Waterfall Breakdown */}
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-200 uppercase tracking-wider text-[11px]">
                Contribution Breakdown to Net Rate
              </h4>

              <div className="space-y-1.5 font-mono">
                {/* 1. Asset Returns */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-slate-300">Investment & Bank Assets Yield</span>
                  </div>
                  <div className="text-right">
                    <span className="text-emerald-400 font-bold block">
                      +{assetYieldContributionPct.toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-500">
                      +{formatCompactMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}/yr
                    </span>
                  </div>
                </div>

                {/* 2. Debt Cost */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-400" />
                    <span className="text-slate-300">Liabilities & Interest Drag</span>
                  </div>
                  <div className="text-right">
                    <span className="text-rose-400 font-bold block">
                      -{liabilitiesDragPct.toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-500">
                      -{formatCompactMoney(engineResult.liabilitiesYearlyCostBase, baseCurr, currSym)}/yr
                    </span>
                  </div>
                </div>

                {/* Total Net Rate */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/40 text-sm">
                  <span className="font-bold text-white">Net Compounding Rate (Physical)</span>
                  <span className={`font-black ${engineResult.finalRatePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {engineResult.finalRatePct >= 0 ? '+' : ''}{engineResult.finalRatePct.toFixed(2)}% p.a.
                  </span>
                </div>
              </div>
            </div>

            {/* Scheduled Inflow Distinction Card */}
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <GraduationCap size={13} className="text-cyan-400" />
                  External Inflow: Scheduled Salary
                </span>
                <p className="text-[10px] text-slate-400">
                  Transfers to Net Worth upon payday credit ({formatCompactMoney(engineResult.salaryYearlyIncomeBase, baseCurr, currSym)}/yr)
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-cyan-300 font-mono">
                Cashflow Event
              </span>
            </div>

            {/* Accounting Rule Clarification */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <span className="font-semibold text-slate-300 block">
                Accounting Rule: Unrealized Promise vs Physically Present Money
              </span>
              <p>
                Salary is tracked separately as upcoming cash flow and human earning potential. It only enters your Net Worth and balances when physically credited to your bank account, preserving mathematical truth in your portfolio's continuous compounding engine.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsBreakdownOpen(false);
                  setActiveTab('assets');
                }}
                className="text-xs text-cyan-400 hover:text-cyan-300 font-semibold flex items-center gap-1 cursor-pointer"
              >
                <span>View Human Capital & Skill Asset Model in Assets</span>
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                onClick={() => setIsBreakdownOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
