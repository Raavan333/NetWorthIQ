import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { formatMoney } from '../../lib/formatters';
import { Shield, TrendingUp, Info, Sliders, Check } from 'lucide-react';

export const TaxView: React.FC = () => {
  const { taxResult, taxRules, updateTaxRules, settings, currencies, sales } = useApp();
  const [isEditingRules, setIsEditingRules] = useState(false);

  const [ltcgRate, setLtcgRate] = useState(taxRules.equityLtcgRatePct.toString());
  const [stcgRate, setStcgRate] = useState(taxRules.equityStcgRatePct.toString());
  const [exemptionLimit, setExemptionLimit] = useState(taxRules.equityLtcgExemptionLimit.toString());
  const [slabRate, setSlabRate] = useState(taxRules.userSlabRatePct.toString());

  const baseCurr = settings.baseCurrency || 'INR';
  const sym = currencies.find((c) => c.code === baseCurr)?.symbol || '₹';

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateTaxRules({
      equityLtcgRatePct: parseFloat(ltcgRate) || 12.5,
      equityStcgRatePct: parseFloat(stcgRate) || 20,
      equityLtcgExemptionLimit: parseFloat(exemptionLimit) || 125000,
      userSlabRatePct: parseFloat(slabRate) || 30,
    });
    setIsEditingRules(false);
  };

  return (
    <div className="space-y-4 text-xs text-slate-200">
      {/* Top Overview Card */}
      <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-emerald-400" />
            <span className="font-bold text-sm text-white">Estimated Capital Gains Tax</span>
          </div>
          <button
            type="button"
            onClick={() => setIsEditingRules(!isEditingRules)}
            className="px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-[11px] font-semibold text-slate-300 flex items-center gap-1 cursor-pointer"
          >
            <Sliders size={12} />
            <span>{isEditingRules ? 'Close Settings' : 'Configure Rates'}</span>
          </button>
        </div>

        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold font-mono text-emerald-400">
            {formatMoney(taxResult.totalEstimatedTaxOwedBase, baseCurr, sym)}
          </div>
          <span className="text-[11px] text-slate-400">total projected liability</span>
        </div>

        <p className="text-[11px] text-slate-400">
          Calculated deterministically from recorded asset sales, equity holding periods, and your tax bracket rules.
        </p>
      </div>

      {/* Configure Rates Form */}
      {isEditingRules && (
        <form
          onSubmit={handleSaveRules}
          className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3 animate-fade-in"
        >
          <div className="font-bold text-white text-xs">Tax Rates & Exemption Thresholds</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Equity LTCG Rate (%)</label>
              <input
                type="number"
                step="0.1"
                value={ltcgRate}
                onChange={(e) => setLtcgRate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Equity STCG Rate (%)</label>
              <input
                type="number"
                step="0.1"
                value={stcgRate}
                onChange={(e) => setStcgRate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                LTCG Annual Exemption Limit ({baseCurr})
              </label>
              <input
                type="number"
                step="1000"
                value={exemptionLimit}
                onChange={(e) => setExemptionLimit(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">User Income Tax Slab (%)</label>
              <input
                type="number"
                step="1"
                value={slabRate}
                onChange={(e) => setSlabRate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Check size={13} />
              <span>Save Tax Rules</span>
            </button>
          </div>
        </form>
      )}

      {/* Breakdown Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="text-[11px] text-slate-400">Equity Long-Term Gains (LTCG)</div>
          <div className="text-base font-bold font-mono text-white">
            {formatMoney(taxResult.equityLtcgGain, baseCurr, sym)}
          </div>
          <div className="text-[10px] text-slate-500">
            Rate: {taxRules.equityLtcgRatePct}% (Exemption: {formatMoney(taxRules.equityLtcgExemptionLimit, baseCurr, sym)})
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="text-[11px] text-slate-400">Equity Short-Term Gains (STCG)</div>
          <div className="text-base font-bold font-mono text-white">
            {formatMoney(taxResult.equityStcgGain, baseCurr, sym)}
          </div>
          <div className="text-[10px] text-slate-500">Rate: {taxRules.equityStcgRatePct}% flat</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="text-[11px] text-slate-400">Foreign & Debt Asset Gains</div>
          <div className="text-base font-bold font-mono text-white">
            {formatMoney(taxResult.foreignLtcgGain + taxResult.debtGain, baseCurr, sym)}
          </div>
          <div className="text-[10px] text-slate-500">Slab / 20% applicable</div>
        </div>

        <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-1.5">
          <div className="text-[11px] text-slate-400">Recorded Sale Events</div>
          <div className="text-base font-bold font-mono text-white">{sales.length}</div>
          <div className="text-[10px] text-slate-500">Historical realized trade disposals</div>
        </div>
      </div>
    </div>
  );
};
