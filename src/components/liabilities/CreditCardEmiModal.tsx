import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability } from '../../types';
import {
  compareCreditCardEmiVsFullPayment,
  assessCardFullVsEmiByCashFlow,
} from '../../lib/creditIntelligence';
import { formatMoney } from '../../lib/formatters';
import { getSafeLiabilityName } from '../../lib/assetRules';
import {
  AlertTriangle,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  card: Liability;
  onClose: () => void;
  onProceedFullPayment?: (amount: number) => void;
}

export const CreditCardEmiModal: React.FC<Props> = ({
  card,
  onClose,
  onProceedFullPayment,
}) => {
  const {
    holdings,
    assetTypes,
    currencies,
    settings,
    cashFlowForecast,
    goals,
    closedLoopMLState,
    convertCardToEmi,
  } = useApp();

  const currentOutstanding = card.outstanding || 0;
  const currSymbol =
    currencies.find((c) => c.code === card.currency)?.symbol || card.currency;
  const cardName = getSafeLiabilityName(card);

  const [conversionAmount, setConversionAmount] = useState<number>(currentOutstanding);
  const [selectedTenure, setSelectedTenure] = useState<number>(6);
  const [customRatePct, setCustomRatePct] = useState<number>(
    card.emiConversionRatePct ?? (card.ratePct || 16.0)
  );
  const [customFee, setCustomFee] = useState<number>(
    card.emiConversionProcessingFee ?? 199
  );
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessment = useMemo(
    () =>
      assessCardFullVsEmiByCashFlow({
        card,
        holdings,
        assetTypes,
        currencies,
        settings,
        cashFlowForecast,
        goals,
        closedLoopState: closedLoopMLState,
        overrideConversionAmount: conversionAmount,
        emiOptions: {
          tenureMonths: selectedTenure,
          customAnnualRatePct: customRatePct,
          customProcessingFee: customFee,
          applicableGstPct: 18,
        },
      }),
    [
      card,
      holdings,
      assetTypes,
      currencies,
      settings,
      cashFlowForecast,
      goals,
      closedLoopMLState,
      conversionAmount,
      selectedTenure,
      customRatePct,
      customFee,
    ]
  );

  const comparison = useMemo(
    () =>
      compareCreditCardEmiVsFullPayment(card, conversionAmount, {
        tenureMonths: selectedTenure,
        customAnnualRatePct: customRatePct,
        customProcessingFee: customFee,
        applicableGstPct: 18,
      }),
    [card, conversionAmount, selectedTenure, customRatePct, customFee]
  );

  const fmt = (amt: number) =>
    formatMoney(amt, card.currency, currSymbol, settings.numberGrouping, 0);

  const handleConvertEmi = async () => {
    setError(null);
    if (conversionAmount <= 0 || conversionAmount > currentOutstanding) {
      setError('Enter a valid amount up to current card outstanding.');
      return;
    }
    setIsConverting(true);
    const res = await convertCardToEmi(card.id, {
      conversionAmount,
      tenureMonths: selectedTenure,
      annualRatePct: customRatePct,
      processingFee: customFee,
      gstPct: 18,
    });
    setIsConverting(false);
    if (!res.success) {
      setError(res.error || 'EMI conversion failed.');
      return;
    }
    onClose();
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      variant={assessment.shouldGlowRedOnEmi ? 'danger-glow' : 'default'}
      title={
        assessment.shouldGlowRedOnEmi
          ? `Avoidable EMI Fee Loss: ${cardName}`
          : `Cash-Flow EMI vs Full Assessment: ${cardName}`
      }
      subtitle={`Outstanding ${fmt(currentOutstanding)} · Liquid cash ${fmt(assessment.totalLiquidAvailable)}`}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {error && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300">
            {error}
          </div>
        )}

        {/* Cash-Flow Verdict Banner */}
        <div
          className={`p-3.5 rounded-xl border space-y-2 ${
            assessment.shouldGlowRedOnEmi
              ? 'bg-rose-950/80 border-rose-500 text-rose-100 shadow-[0_0_24px_rgba(244,63,94,0.3)]'
              : 'bg-slate-950 border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {assessment.shouldGlowRedOnEmi ? (
              <AlertTriangle size={17} className="text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <ShieldCheck size={17} className="text-emerald-400 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1 flex-1">
              <div className="font-bold text-slate-100 flex flex-wrap items-center justify-between gap-2">
                <span>{assessment.headline}</span>
                <span className="font-mono tabular-nums text-[11px] text-emerald-400">
                  {assessment.verdict === 'pay_full'
                    ? `Retain +${fmt(comparison.additionalCostOfEmi)}`
                    : assessment.verdict === 'split_shield'
                    ? `Upfront ${fmt(assessment.safeUpfrontAmount)}`
                    : `${comparison.tenureMonths}m Shield`}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">
                {assessment.persuasionCopy}
              </p>
              {assessment.goalRewardNote && (
                <div className="pt-1 text-[11px] text-emerald-300 flex items-center gap-1.5 font-medium">
                  <Sparkles size={12} className="text-emerald-400 shrink-0" />
                  <span>{assessment.goalRewardNote}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Amount & Terms Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              Amount ({card.currency})
            </label>
            <input
              type="number"
              min={500}
              max={currentOutstanding}
              value={conversionAmount || ''}
              onChange={(e) => setConversionAmount(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              Tenure
            </label>
            <select
              value={selectedTenure}
              onChange={(e) => setSelectedTenure(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white"
            >
              <option value={3}>3 Months</option>
              <option value={6}>6 Months</option>
              <option value={9}>9 Months</option>
              <option value={12}>12 Months</option>
              <option value={18}>18 Months</option>
              <option value={24}>24 Months</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              APR (% p.a.)
            </label>
            <input
              type="number"
              step="0.5"
              value={customRatePct}
              onChange={(e) => setCustomRatePct(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono tabular-nums"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-400 mb-1 block">
              Fee (+18% GST)
            </label>
            <input
              type="number"
              value={customFee}
              onChange={(e) => setCustomFee(Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono tabular-nums"
            />
          </div>
        </div>

        {/* Side-by-Side Comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Option A: Full / Safe Upfront Payment */}
          <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-2.5 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 size={13} />
                  <span>Full Payment</span>
                </span>
                <span className="text-[10px] font-mono tabular-nums text-emerald-300">
                  0 Charges
                </span>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-800 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-400">Principal Cleared</span>
                  <span className="text-white">{fmt(comparison.fullPaymentAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-400">Interest + Fees</span>
                  <span className="text-emerald-400">{fmt(0)}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-800/80 font-bold">
                  <span className="font-sans text-slate-200">Money Retained</span>
                  <span className="text-emerald-400">+{fmt(comparison.additionalCostOfEmi)}</span>
                </div>
              </div>
            </div>

            {onProceedFullPayment && (
              <div className="space-y-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => onProceedFullPayment(comparison.fullPaymentAmount)}
                  className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap"
                >
                  <span>Pay Full &amp; Keep +{fmt(comparison.additionalCostOfEmi)}</span>
                  <ArrowRight size={13} />
                </button>

                {assessment.verdict === 'split_shield' && assessment.safeUpfrontAmount > 0 && (
                  <button
                    type="button"
                    onClick={() => onProceedFullPayment(assessment.safeUpfrontAmount)}
                    className="w-full py-1.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-emerald-500/30 text-emerald-300 font-semibold cursor-pointer transition-colors whitespace-nowrap"
                  >
                    Pay Safe Upfront ({fmt(assessment.safeUpfrontAmount)}) First
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Option B: EMI Conversion */}
          <div
            className={`p-3.5 rounded-xl bg-slate-950 border space-y-2.5 flex flex-col justify-between ${
              assessment.shouldGlowRedOnEmi ? 'border-rose-500/60' : 'border-slate-800'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span
                  className={`font-bold ${
                    assessment.shouldGlowRedOnEmi ? 'text-rose-400' : 'text-indigo-300'
                  }`}
                >
                  {comparison.tenureMonths}m Card EMI
                </span>
                <span className="text-[10px] font-mono tabular-nums text-slate-400">
                  {fmt(comparison.monthlyEmi)}/mo
                </span>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-800 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-400">Interest Loss</span>
                  <span className="text-rose-400">+{fmt(comparison.totalEmiInterest)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-400">Fee + GST Loss</span>
                  <span className="text-rose-400">
                    +{fmt(comparison.processingFee + comparison.processingFeeGst)}
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-800/80 font-bold">
                  <span className="font-sans text-slate-200">Total Outflow</span>
                  <span className="text-white">{fmt(comparison.totalEmiCost)}</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isConverting || conversionAmount <= 0}
              onClick={handleConvertEmi}
              className={`w-full py-2 px-3 rounded-xl font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                assessment.shouldGlowRedOnEmi
                  ? 'bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-rose-200'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white font-bold'
              }`}
            >
              {isConverting
                ? 'Converting...'
                : assessment.shouldGlowRedOnEmi
                ? `Convert Anyway (-${fmt(comparison.additionalCostOfEmi)} Fee Loss)`
                : `Convert ${fmt(conversionAmount)} to ${selectedTenure}m EMI`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
