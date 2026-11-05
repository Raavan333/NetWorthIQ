import React from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import { TrendingUp, CreditCard, ShieldCheck, PieChart } from 'lucide-react';

export const QuickStatsStrip: React.FC = () => {
  const { engineResult, settings, currencies, liabilities } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Calculate Credit Utilization
  const creditCards = liabilities.filter((l) => l.kind === 'card' && l.cardType !== 'debit');
  const totalCreditLimit = creditCards.reduce((sum, c) => sum + (c.limit || c.creditLimit || 0), 0);
  const totalCreditUsed = creditCards.reduce((sum, c) => sum + (c.outstanding || 0), 0);
  const creditUtilizationPct =
    totalCreditLimit > 0 ? (totalCreditUsed / totalCreditLimit) * 100 : 0;

  // Debt to Asset ratio
  const debtToAssetPct =
    engineResult.totalAssetsBase > 0
      ? (engineResult.totalLiabilitiesBase / engineResult.totalAssetsBase) * 100
      : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <TrendingUp size={13} className="text-emerald-400" />
          <span>Annual Yield</span>
        </div>
        <div className="text-sm font-bold text-white tracking-tight">
          {formatMoney(engineResult.assetsYearlyReturnBase, baseCurr, currSym)}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">Gross return/yr</div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <CreditCard size={13} className="text-rose-400" />
          <span>Annual Debt Drag</span>
        </div>
        <div className="text-sm font-bold text-white tracking-tight">
          {formatMoney(engineResult.liabilitiesYearlyCostBase, baseCurr, currSym)}
        </div>
        <div className="text-[10px] text-slate-500 font-mono">Interest &amp; fees/yr</div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <PieChart size={13} className="text-cyan-400" />
          <span>Credit Utilization</span>
        </div>
        <div className="text-sm font-bold text-white tracking-tight">
          {creditUtilizationPct.toFixed(1)}%
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          {formatMoney(totalCreditUsed, baseCurr, currSym)} / {formatMoney(totalCreditLimit, baseCurr, currSym)}
        </div>
      </div>

      <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck size={13} className="text-purple-400" />
          <span>Debt-to-Asset</span>
        </div>
        <div className="text-sm font-bold text-white tracking-tight">
          {debtToAssetPct.toFixed(1)}%
        </div>
        <div className="text-[10px] text-slate-500 font-mono">Leverage factor</div>
      </div>
    </div>
  );
};
