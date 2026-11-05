import React, { useState } from 'react';
import { Liability } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { Zap, Check, TrendingDown, Clock, ShieldCheck } from 'lucide-react';

interface LoanKillerCalculatorProps {
  loan: Liability;
  currencySymbol: string;
  initialExtraPayment: number;
  onSetExtraPayment: (extra: number, sync: boolean) => Promise<void>;
}

export const LoanKillerCalculator: React.FC<LoanKillerCalculatorProps> = ({
  loan,
  currencySymbol,
  initialExtraPayment,
  onSetExtraPayment,
}) => {
  const [extraPayment, setExtraPayment] = useState<string>(initialExtraPayment > 0 ? initialExtraPayment.toString() : '');
  const [syncToBills, setSyncToBills] = useState(true);
  const [isSaved, setIsSaved] = useState(false);

  const principal = loan.outstanding || 0;
  const ratePct = loan.ratePct || 0;
  const monthlyRate = ratePct / 12 / 100;
  const standardEmi = loan.monthlyEmi || (loan.tenureMonths && monthlyRate > 0
    ? (principal * monthlyRate * Math.pow(1 + monthlyRate, loan.tenureMonths)) / (Math.pow(1 + monthlyRate, loan.tenureMonths) - 1)
    : principal / (loan.tenureMonths || 12));

  const extraNum = parseFloat(extraPayment) || 0;
  const acceleratedEmi = standardEmi + extraNum;

  // Approximate accelerated tenure
  let acceleratedMonths = loan.tenureMonths || 12;
  let standardTotalInterest = 0;
  let acceleratedTotalInterest = 0;

  if (principal > 0 && monthlyRate > 0) {
    // Standard calculation
    let p = principal;
    for (let m = 0; m < 360 && p > 1; m++) {
      const interest = p * monthlyRate;
      standardTotalInterest += interest;
      const prinPay = standardEmi - interest;
      p -= Math.max(0, prinPay);
    }

    // Accelerated calculation
    let pAcc = principal;
    let mAcc = 0;
    while (pAcc > 1 && mAcc < 360) {
      mAcc++;
      const interest = pAcc * monthlyRate;
      acceleratedTotalInterest += interest;
      const prinPay = acceleratedEmi - interest;
      pAcc -= Math.max(0, prinPay);
    }
    acceleratedMonths = mAcc;
  }

  const monthsSaved = Math.max(0, (loan.tenureMonths || 12) - acceleratedMonths);
  const interestSaved = Math.max(0, standardTotalInterest - acceleratedTotalInterest);

  const handleApply = async () => {
    await onSetExtraPayment(extraNum, syncToBills);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Zap size={13} className="text-amber-400" />
          <span>Debt Payoff Accelerator (Avalanche / Snowball)</span>
        </span>
        <span className="text-[10px] text-slate-400 font-mono">
          Current EMI: {formatMoney(standardEmi, loan.currency, currencySymbol)}/mo
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">
            Extra Monthly Principal Payoff
          </label>
          <div className="flex gap-1.5">
            <input
              type="number"
              placeholder="e.g. 5000"
              value={extraPayment}
              onChange={(e) => {
                setExtraPayment(e.target.value);
                setIsSaved(false);
              }}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              onClick={handleApply}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] shrink-0 cursor-pointer transition-colors"
            >
              {isSaved ? <Check size={13} /> : 'Apply'}
            </button>
          </div>
        </div>

        <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col justify-center">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">Tenure Saved:</span>
            <span className="text-emerald-400 font-mono font-bold">
              {monthsSaved} month{monthsSaved === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] mt-0.5">
            <span className="text-slate-400">Interest Saved:</span>
            <span className="text-emerald-400 font-mono font-bold">
              {formatMoney(interestSaved, loan.currency, currencySymbol)}
            </span>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-[11px] text-slate-400">
        <input
          type="checkbox"
          checked={syncToBills}
          onChange={(e) => setSyncToBills(e.target.checked)}
          className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 cursor-pointer"
        />
        <span>Auto-sync accelerated amount to monthly Bills Manager</span>
      </label>
    </div>
  );
};
