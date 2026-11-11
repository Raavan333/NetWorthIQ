import React from 'react';
import { useApp } from '../../context/AppContext';
import { LiveTickerHero } from './LiveTickerHero';
import { HeroCards } from './HeroCards';
import { LiquidityStrip } from './LiquidityStrip';
import { QuickStatsStrip } from './QuickStatsStrip';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { HistoricalNetWorthChart } from '../insights/HistoricalNetWorthChart';
import { GoalsMiniStrip } from './GoalsMiniStrip';
import { CashFlowForecastCard } from './CashFlowForecastCard';
import { SubconsciousNudge } from './SubconsciousNudge';
import { Plus, CreditCard } from 'lucide-react';

export const HomeView: React.FC = () => {
  const { holdings, liabilities, setActiveTab } = useApp();
  const isEmptyPortfolio = holdings.length === 0 && liabilities.length === 0;

  return (
    <div className="space-y-4 pb-20 animate-fade-in">
      <LiveTickerHero />

      {isEmptyPortfolio && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Portfolio Initialized</h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Add holdings and liabilities to calculate live compounded net worth.
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => setActiveTab('assets')}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus size={13} /> Add Asset
            </button>
            <button
              onClick={() => setActiveTab('liabilities')}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <CreditCard size={13} /> Add Liability
            </button>
          </div>
        </div>
      )}

      <HeroCards />
      <SubconsciousNudge />
      <NeedsAttentionPanel />
      <LiquidityStrip />
      <CashFlowForecastCard />
      <QuickStatsStrip />
      <GoalsMiniStrip />
      <HistoricalNetWorthChart />
    </div>
  );
};
