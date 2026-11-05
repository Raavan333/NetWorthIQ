import React from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import { isBankAccountHolding, isCashHolding } from '../../lib/assetRules';
import { Droplet, ArrowRight } from 'lucide-react';

export const LiquidityStrip: React.FC = () => {
  const { holdings, assetTypes, settings, currencies, setActiveTab } = useApp();

  const baseCurr = settings.baseCurrency || 'INR';
  const currSym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  // Calculate instant liquid capital: Bank accounts + Cash in hand + Sweep-ins
  const liquidHoldings = holdings.filter(
    (h) => isBankAccountHolding(h, assetTypes) || isCashHolding(h, assetTypes) || Boolean(h.isSweepIn)
  );

  const totalLiquid = liquidHoldings.reduce((sum, h) => sum + (h.principalOrValue || 0), 0);

  return (
    <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Droplet size={15} className="text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
            Available Liquidity &amp; Emergency Cushion
          </h3>
        </div>
        <button
          onClick={() => setActiveTab('assets')}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>View Assets</span>
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="flex items-baseline justify-between">
        <div>
          <span className="text-lg font-bold text-white tracking-tight">
            {formatMoney(totalLiquid, baseCurr, currSym)}
          </span>
          <span className="text-xs text-slate-400 ml-2">
            ({liquidHoldings.length} liquid asset{liquidHoldings.length === 1 ? '' : 's'})
          </span>
        </div>
        <span className="text-xs text-slate-500 font-mono">
          Cash &amp; Sweep-in ready
        </span>
      </div>

      {liquidHoldings.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-800/60">
          {liquidHoldings.slice(0, 4).map((h) => (
            <div key={h.id} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/50">
              <div className="text-[11px] text-slate-400 truncate">{h.name}</div>
              <div className="text-xs font-medium text-slate-200 mt-0.5">
                {formatMoney(h.principalOrValue || 0, h.currency || baseCurr, currSym)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
