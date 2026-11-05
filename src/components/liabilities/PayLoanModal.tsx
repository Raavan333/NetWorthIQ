import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Liability, Currency } from '../../types';
import { formatMoney, formatCompactMoney } from '../../lib/formatters';
import { convertToBase } from '../../lib/calcEngine';
import {
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  formatAssetOptionLabel,
} from '../../lib/assetRules';
import {
  getLoanLockInStatus,
  calculateLoanPrepaymentCharge,
  resolveRemainingTenureMonths,
  simulateLoanPrepayment,
} from '../../lib/loanPrepaymentEngine';
import { calculateContractualEmi } from '../../lib/debtEngine';
import {
  Wallet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  TrendingDown,
  ArrowRight,
  Zap,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface PayLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  loan: Liability;
  initialAssetId?: string;
}

export const PayLoanModal: React.FC<PayLoanModalProps> = ({
  isOpen,
  onClose,
  loan,
  initialAssetId,
}) => {
  const {
    holdings,
    liabilities,
    transactions,
    assetTypes,
    payLoan,
    predictLoanPayment,
    currencies,
    settings,
    updateSettings,
    getAccountLiquidityWithSweepIn,
  } = useApp();

  const currMap = useMemo(() => {
    const map: Record<string, Currency> = {};
    for (const c of currencies) map[c.code] = c;
    return map;
  }, [currencies]);

  const curr = currMap[loan.currency];
  const currSymbol = curr?.symbol || loan.currency;
  const loanDisplayName = getSafeLiabilityName(loan);

  const curMonthStr = useMemo(() => new Date().toISOString().substring(0, 7), []);

  const lastPaidTxThisMonth = useMemo(() => {
    return transactions.find(
      (t) =>
        !t.isReversed &&
        t.toId === loan.id &&
        (t.kind === 'emi' || t.kind === 'transfer') &&
        t.date.startsWith(curMonthStr)
    );
  }, [transactions, loan.id, curMonthStr]);

  const isAlreadyPaidThisMonth = Boolean(lastPaidTxThisMonth);
  const [confirmedRepeatPayment, setConfirmedRepeatPayment] = useState<boolean>(false);

  const liquidHoldings = useMemo(() => {
    return holdings
      .filter((h) => isSpendableLiquidHolding(h, assetTypes))
      .sort((a, b) => (b.principalOrValue || 0) - (a.principalOrValue || 0));
  }, [holdings, assetTypes]);

  const [fromAssetId, setFromAssetId] = useState<string>(
    initialAssetId && liquidHoldings.some((h) => h.id === initialAssetId)
      ? initialAssetId
      : liquidHoldings[0]?.id || ''
  );

  useEffect(() => {
    if (!fromAssetId || !liquidHoldings.some((h) => h.id === fromAssetId)) {
      if (liquidHoldings[0]) setFromAssetId(liquidHoldings[0].id);
    }
  }, [liquidHoldings, fromAssetId]);

  const fullAmount = loan.outstanding || 0;
  const remainingTenure = useMemo(() => resolveRemainingTenureMonths(loan), [loan]);
  const emiAmount = useMemo(() => {
    if (loan.monthlyEmi && loan.monthlyEmi > 0) return loan.monthlyEmi;
    return calculateContractualEmi(fullAmount, loan.ratePct || 0, Math.max(1, remainingTenure));
  }, [loan.monthlyEmi, fullAmount, loan.ratePct, remainingTenure]);

  const predictedPlan = useMemo(
    () => predictLoanPayment(loan.id),
    [loan.id, loan.outstanding, holdings, liabilities, settings, predictLoanPayment]
  );

  const subtleFramingEnabled = settings.enableSubtleGuidanceFraming !== false;
  const strategyEnforced = Boolean(settings.enforcePrepaymentStrategy);

  const [payOption, setPayOption] = useState<'emi' | 'custom' | 'full'>('emi');
  const [customAmount, setCustomAmount] = useState<string>(
    Math.min(fullAmount, Math.max(emiAmount * 2, Math.round(fullAmount * 0.25))).toString()
  );
  const [maintainTenure, setMaintainTenure] = useState<boolean>(false);
  const [shouldUpdateRate, setShouldUpdateRate] = useState<boolean>(false);
  const [newInterestRate, setNewInterestRate] = useState<string>(
    loan.ratePct?.toString() || '8.5'
  );
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Pre-anchor payment form to ML-predicted optimal manner on modal open
  useEffect(() => {
    setConfirmedRepeatPayment(false);
    if (!isOpen || !predictedPlan) return;
    if (subtleFramingEnabled) {
      setPayOption(predictedPlan.recommendedMode);
      setCustomAmount(String(predictedPlan.recommendedAmount));
      setMaintainTenure(predictedPlan.recommendedMaintainTenure);
      if (
        !initialAssetId &&
        predictedPlan.recommendedAssetId &&
        liquidHoldings.some((h) => h.id === predictedPlan.recommendedAssetId)
      ) {
        setFromAssetId(predictedPlan.recommendedAssetId);
      }
    } else {
      setPayOption('emi');
    }
    setError('');
  }, [isOpen, loan.id]);

  const applyPredictedPlan = () => {
    if (!predictedPlan) return;
    setPayOption(predictedPlan.recommendedMode);
    setCustomAmount(String(predictedPlan.recommendedAmount));
    setMaintainTenure(predictedPlan.recommendedMaintainTenure);
    if (
      predictedPlan.recommendedAssetId &&
      liquidHoldings.some((h) => h.id === predictedPlan.recommendedAssetId)
    ) {
      setFromAssetId(predictedPlan.recommendedAssetId);
    }
    setError('');
  };

  const paymentAmount = useMemo(() => {
    if (payOption === 'full') return fullAmount;
    if (payOption === 'emi') return Math.min(fullAmount, emiAmount);
    const parsed = parseFloat(customAmount);
    if (isNaN(parsed) || parsed < 0) return 0;
    return Math.min(fullAmount, parsed);
  }, [payOption, fullAmount, emiAmount, customAmount]);

  const lockStatus = useMemo(() => getLoanLockInStatus(loan), [loan]);
  const isExtraPrepayment =
    isAlreadyPaidThisMonth || (payOption !== 'emi' && paymentAmount > emiAmount + 1);
  const isBlockedByLockIn =
    (isExtraPrepayment || isAlreadyPaidThisMonth) && lockStatus.isLockedIn;

  // Evaluate charge strictly from the user's saved prepayment policy (never ask again, never assume)
  const policyChargeEval = useMemo(
    () =>
      calculateLoanPrepaymentCharge(loan, isExtraPrepayment ? paymentAmount : fullAmount, {
        currentOutstanding: fullAmount,
        remainingTenureOverride: remainingTenure,
      }),
    [loan, isExtraPrepayment, paymentAmount, fullAmount, remainingTenure]
  );

  const prepaySim = useMemo(
    () =>
      simulateLoanPrepayment(loan, isExtraPrepayment ? paymentAmount : fullAmount, {
        maintainTenureReduceEmi: maintainTenure,
      }),
    [loan, isExtraPrepayment, paymentAmount, fullAmount, maintainTenure]
  );

  const activePenaltyCharge =
    isExtraPrepayment && !lockStatus.isLockedIn ? policyChargeEval.totalPenaltyWithTax : 0;

  const totalOutflowRequired =
    Math.round((paymentAmount + activePenaltyCharge) * 100) / 100;

  // Compare strictly using each debt's user-defined prepayment policy to warn before paying a higher-charge loan
  const higherChargeComparison = useMemo(() => {
    const thisFeeBase = convertToBase(policyChargeEval.totalPenaltyWithTax, loan.currency, currMap);

    const otherUnlockedDebts = liabilities
      .filter((other) => other.id !== loan.id && (other.outstanding || 0) > 0)
      .filter((other) => {
        if (other.kind === 'loan') {
          return !getLoanLockInStatus(other).isLockedIn;
        }
        return other.cardType === 'credit' || other.cardType === 'hybrid' || !other.cardType;
      })
      .map((other) => {
        if (other.kind === 'loan') {
          const otherRem = resolveRemainingTenureMonths(other);
          const compareSlice = isExtraPrepayment
            ? Math.min(other.outstanding || 0, paymentAmount)
            : (other.outstanding || 0);
          const otherEval = calculateLoanPrepaymentCharge(other, compareSlice, {
            currentOutstanding: other.outstanding || 0,
            remainingTenureOverride: otherRem,
          });
          const otherFeeBase = convertToBase(otherEval.totalPenaltyWithTax, other.currency, currMap);
          return {
            id: other.id,
            name: getSafeLiabilityName(other),
            kind: 'loan' as const,
            penaltyPct: otherEval.penaltyPct,
            feeLocal: otherEval.totalPenaltyWithTax,
            feeBase: otherFeeBase,
            currency: other.currency,
            ratePct: other.ratePct || 0,
          };
        }
        const cardApr =
          other.ratePct ||
          (other.penaltyRateMonthlyPct ?? settings.defaultCardPenaltyRateMonthly ?? 3.5) * 12;
        return {
          id: other.id,
          name: getSafeLiabilityName(other),
          kind: 'card' as const,
          penaltyPct: 0,
          feeLocal: 0,
          feeBase: 0,
          currency: other.currency,
          ratePct: cardApr,
        };
      })
      .sort((a, b) => a.penaltyPct - b.penaltyPct || a.feeBase - b.feeBase || b.ratePct - a.ratePct);

    const lowerChargeLoan = otherUnlockedDebts.find(
      (d) =>
        d.kind === 'loan' &&
        (d.penaltyPct < policyChargeEval.penaltyPct || d.feeBase + 1 < thisFeeBase)
    );
    const lowerChargeAnyDebt = otherUnlockedDebts.find(
      (d) => d.penaltyPct < policyChargeEval.penaltyPct || d.feeBase + 1 < thisFeeBase
    );

    const bestAlternative = lowerChargeLoan || lowerChargeAnyDebt || null;
    const isHigherChargeLoanInPortfolio =
      isExtraPrepayment &&
      activePenaltyCharge > 0 &&
      Boolean(bestAlternative);
    const isPrepayNetLoss =
      isExtraPrepayment &&
      activePenaltyCharge > 0 &&
      !prepaySim.isFinanciallyBeneficial;

    // Red glow strictly ONLY when user is actively losing money to prepayment charges
    const shouldGlowRed = isHigherChargeLoanInPortfolio || isPrepayNetLoss;

    return {
      shouldGlowRed,
      isHigherChargeLoanInPortfolio,
      isPrepayNetLoss,
      bestAlternative,
    };
  }, [
    activePenaltyCharge,
    policyChargeEval.totalPenaltyWithTax,
    policyChargeEval.penaltyPct,
    loan.currency,
    loan.id,
    currMap,
    liabilities,
    settings.defaultCardPenaltyRateMonthly,
    isExtraPrepayment,
    paymentAmount,
    prepaySim.isFinanciallyBeneficial,
  ]);

  const selectedAsset = liquidHoldings.find((h) => h.id === fromAssetId);
  const {
    balance: availableAssetBalance,
    totalSweepIn,
    totalAvailable,
    sweepInFds,
  } = selectedAsset
    ? getAccountLiquidityWithSweepIn(selectedAsset.id)
    : { balance: 0, totalSweepIn: 0, totalAvailable: 0, sweepInFds: [] };

  const hasPositiveOrSweepLiquidity = availableAssetBalance > 0 || totalSweepIn > 0;
  const isSufficient =
    Boolean(selectedAsset) &&
    hasPositiveOrSweepLiquidity &&
    totalAvailable >= totalOutflowRequired &&
    paymentAmount > 0 &&
    !isBlockedByLockIn;
  const isUsingSweepIn =
    isSufficient && availableAssetBalance < totalOutflowRequired && totalSweepIn > 0;
  const shortfall = Math.max(0, totalOutflowRequired - totalAvailable);
  const remainingAssetBalance = Math.max(0, availableAssetBalance - totalOutflowRequired);
  const remainingLoanBalance = Math.max(0, fullAmount - paymentAmount);

  const effectiveRate =
    shouldUpdateRate && parseFloat(newInterestRate) >= 0
      ? parseFloat(newInterestRate)
      : loan.ratePct || 0;
  const currentAnnualInterestCost = fullAmount * ((loan.ratePct || 0) / 100);
  const newAnnualInterestCost = remainingLoanBalance * (effectiveRate / 100);
  const annualInterestSaved = Math.max(0, currentAnnualInterestCost - newAnnualInterestCost);

  const isAlignedWithPrediction = Boolean(
    predictedPlan &&
      Math.abs(paymentAmount - predictedPlan.recommendedAmount) <= 1 &&
      payOption === predictedPlan.recommendedMode
  );

  const isRepeatPaymentPenalty = isAlreadyPaidThisMonth && activePenaltyCharge > 0;
  const isEnforcedHighFeeBlock =
    strategyEnforced &&
    ((higherChargeComparison.shouldGlowRed && isExtraPrepayment) || isRepeatPaymentPenalty);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (isBlockedByLockIn) {
      setError(
        `Prepayment locked for ${lockStatus.remainingLockInMonths} more month(s)${
          lockStatus.unlockDateStr ? ` (until ${lockStatus.unlockDateStr})` : ''
        } per your configured loan policy.${
          isAlreadyPaidThisMonth
            ? " This month's scheduled EMI was already paid, and early prepayment is locked. No further payments can be made until next month."
            : ' Only scheduled monthly EMI payments are permitted right now.'
        }`
      );
      return;
    }

    if (isEnforcedHighFeeBlock) {
      setError(
        isRepeatPaymentPenalty
          ? `Prepayment Strategy Guard stopped this payment: This loan was already settled for this month on ${
              lastPaidTxThisMonth?.date || 'earlier this month'
            }. Paying again attracts ${formatMoney(
              activePenaltyCharge,
              loan.currency,
              currSymbol,
              settings.numberGrouping,
              0
            )} in avoidable charges. Settle scheduled EMI next month or disable Fee Guard to proceed.`
          : 'Prepayment Strategy Guard is enforced to protect against net-loss or higher-fee prepayments. Settle scheduled Monthly EMI (0 fee) or switch Guard to Warn Only.'
      );
      return;
    }

    if (isAlreadyPaidThisMonth && activePenaltyCharge > 0 && !confirmedRepeatPayment) {
      setError(
        `Payment stopped: This loan was already paid for this month on ${
          lastPaidTxThisMonth?.date || 'earlier this month'
        }. An additional payment attracts ${formatMoney(
          activePenaltyCharge,
          loan.currency,
          currSymbol,
          settings.numberGrouping,
          0
        )} (${policyChargeEval.penaltyPct}%) in prepayment charges. Please check the acknowledgment box to proceed, or click "Stop & Wait for Next Month".`
      );
      return;
    }

    if (!fromAssetId || !selectedAsset) {
      setError('Select an eligible positive liquid bank or cash account to settle this loan.');
      return;
    }

    if (paymentAmount <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }

    if (!isSufficient) {
      setError(
        `Insufficient positive liquid funds in "${getSafeAssetName(
          selectedAsset,
          assetTypes
        )}". Required: ${formatMoney(totalOutflowRequired, loan.currency, currSymbol)}${
          activePenaltyCharge > 0
            ? ` (Principal ${formatMoney(paymentAmount, loan.currency, currSymbol)} + Policy Charge ${formatMoney(activePenaltyCharge, loan.currency, currSymbol)})`
            : ''
        }, available: ${formatMoney(totalAvailable, loan.currency, currSymbol)}.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await payLoan(loan.id, fromAssetId, paymentAmount, {
        isEmi: payOption === 'emi',
        updatedRatePct: shouldUpdateRate ? parseFloat(newInterestRate) : undefined,
        prepaymentPenaltyCharge: activePenaltyCharge,
        updatedMonthlyEmi:
          isExtraPrepayment && maintainTenure && prepaySim.revisedMonthlyEmi
            ? prepaySim.revisedMonthlyEmi
            : undefined,
        updatedTenureMonths:
          isExtraPrepayment && prepaySim.revisedRemainingMonths > 0
            ? prepaySim.revisedRemainingMonths
            : undefined,
      });

      if (!res.success) {
        setError(res.error || 'Failed to process loan payment.');
        setIsSubmitting(false);
        return;
      }

      setIsSubmitting(false);
      onClose();
    } catch (err: unknown) {
      setIsSubmitting(false);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant={higherChargeComparison.shouldGlowRed ? 'danger-glow' : 'default'}
      title={
        higherChargeComparison.shouldGlowRed
          ? `Avoidable Prepayment Fee: ${loanDisplayName}`
          : `Pay Loan: ${loanDisplayName}`
      }
      subtitle={`${loan.ratePct}% p.a. · ${remainingTenure} mo remaining`}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handlePay} className="space-y-4 text-xs">
        {/* ML-Predicted Optimal Manner & Strategy Enforcement Control */}
        {predictedPlan && (
          <div className="p-3.5 rounded-xl bg-slate-950/95 border border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles size={14} className="text-emerald-400 shrink-0" />
                <span className="font-semibold text-slate-100 truncate">
                  {subtleFramingEnabled
                    ? predictedPlan.whisperHeadline
                    : 'Predicted Optimal Settlement Plan'}
                </span>
              </div>

              <button
                type="button"
                onClick={() =>
                  updateSettings({ enforcePrepaymentStrategy: !strategyEnforced })
                }
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors whitespace-nowrap ${
                  strategyEnforced
                    ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/80'
                    : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle strict Prepayment Strategy Guard"
              >
                <ShieldCheck size={12} />
                <span>Fee Guard: {strategyEnforced ? 'Enforced' : 'Warn Only'}</span>
              </button>
            </div>

            <p className="text-[11px] text-slate-300 leading-relaxed">
              {subtleFramingEnabled ? predictedPlan.whisperBody : predictedPlan.strategyRationale}
            </p>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 font-mono tabular-nums text-[11px]">
              <div>
                <span className="block font-sans text-[10px] text-slate-400">
                  Predicted Principal
                </span>
                <span className="font-bold text-white">
                  {formatMoney(
                    predictedPlan.recommendedAmount,
                    loan.currency,
                    currSymbol,
                    settings.numberGrouping,
                    0
                  )}
                </span>
              </div>
              <div>
                <span className="block font-sans text-[10px] text-slate-400">
                  Net Interest Saved
                </span>
                <span className="font-bold text-emerald-400">
                  +{formatMoney(
                    Math.max(0, predictedPlan.projectedNetBenefit),
                    loan.currency,
                    currSymbol,
                    settings.numberGrouping,
                    0
                  )}
                </span>
              </div>
              <div className="text-right">
                <span className="block font-sans text-[10px] text-slate-400">
                  Tenure Impact
                </span>
                <span className="font-bold text-cyan-300">
                  {predictedPlan.projectedMonthsSaved > 0
                    ? `-${predictedPlan.projectedMonthsSaved} mo`
                    : 'Scheduled'}
                </span>
              </div>
            </div>

            {!isAlignedWithPrediction && (
              <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-amber-200/90 leading-snug flex-1 min-w-[180px]">
                  {subtleFramingEnabled
                    ? predictedPlan.deviationWhisper
                    : `Recommended allocation is ${formatMoney(
                        predictedPlan.recommendedAmount,
                        loan.currency,
                        currSymbol,
                        settings.numberGrouping,
                        0
                      )}.`}
                </span>
                <button
                  type="button"
                  onClick={applyPredictedPlan}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 font-semibold text-[11px] cursor-pointer transition-colors whitespace-nowrap"
                >
                  Align to Predicted Plan
                </button>
              </div>
            )}
          </div>
        )}

        {/* Bright Red High-Charge Warning Banner */}
        {higherChargeComparison.shouldGlowRed && (
          <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-500 text-rose-100 space-y-2.5 shadow-[0_0_24px_rgba(244,63,94,0.35)]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={18} className="shrink-0 text-rose-400 mt-0.5" />
              <div className="space-y-1 leading-relaxed flex-1">
                <div className="font-bold text-rose-200">
                  Avoidable Prepayment Fee ({policyChargeEval.penaltyPct}% ·{' '}
                  {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)})
                </div>
                {higherChargeComparison.bestAlternative ? (
                  <p className="text-rose-100/90 text-[11px]">
                    Prepaying here forfeits{' '}
                    <strong>
                      {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)}
                    </strong>{' '}
                    in charges while <strong>{higherChargeComparison.bestAlternative.name}</strong> carries{' '}
                    {higherChargeComparison.bestAlternative.penaltyPct}% fee. Pay Monthly EMI (0 fee) here and direct surplus there.
                  </p>
                ) : (
                  <p className="text-rose-100/90 text-[11px]">
                    Fee (
                    {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)}
                    ) exceeds interest saved (
                    {formatMoney(prepaySim.grossInterestSaved, loan.currency, currSymbol, settings.numberGrouping, 0)}
                    ). Pay Monthly EMI (0 fee) to retain capital.
                  </p>
                )}
              </div>
            </div>

            {isExtraPrepayment && (
              <div className="pt-2 border-t border-rose-500/30 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-rose-200">
                  {strategyEnforced
                    ? 'Strategy Enforcement is blocking this avoidable prepayment charge.'
                    : 'Advisory warning: switching to Monthly EMI eliminates this fee.'}
                </span>
                <button
                  type="button"
                  onClick={() => setPayOption('emi')}
                  className="px-3 py-1 rounded-lg bg-slate-950/90 hover:bg-slate-900 border border-rose-400/50 text-white font-semibold text-[11px] cursor-pointer transition-colors whitespace-nowrap"
                >
                  Settle Zero-Fee EMI
                </button>
              </div>
            )}
          </div>
        )}

        {/* Already Paid This Month Alert & Prepayment Charge Guard */}
        {isAlreadyPaidThisMonth && (
          <div
            className={`p-3.5 rounded-xl border text-xs space-y-3 ${
              activePenaltyCharge > 0
                ? 'bg-amber-950/80 border-amber-500 text-amber-100 shadow-lg'
                : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {activePenaltyCharge > 0 ? (
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1 flex-1 leading-relaxed">
                <div className="font-bold text-white text-xs flex items-center justify-between">
                  <span>
                    {activePenaltyCharge > 0
                      ? '🛑 EMI Already Paid This Month — Prepayment Charges Apply'
                      : 'EMI Already Paid for Current Month'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Settled on {lastPaidTxThisMonth?.date}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Your scheduled installment for this month was already settled
                  {lastPaidTxThisMonth?.amount
                    ? ` (${formatMoney(lastPaidTxThisMonth.amount, loan.currency, currSymbol, settings.numberGrouping, 0)})`
                    : ''}
                  .
                  {activePenaltyCharge > 0 ? (
                    <>
                      {' '}Paying again now will be processed as an{' '}
                      <strong>extra ad-hoc principal prepayment</strong> and attracts an immediate prepayment penalty of{' '}
                      <strong className="text-rose-300 font-mono">
                        {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)} ({policyChargeEval.penaltyPct}%)
                      </strong>.
                    </>
                  ) : (
                    ' Early principal prepayments on this loan carry 0% penalty per your configured policy.'
                  )}
                </p>
              </div>
            </div>

            {activePenaltyCharge > 0 && (
              <>
                <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400 font-sans">Payment + Prepayment Penalty:</span>
                  <span className="text-white font-bold">
                    {formatMoney(paymentAmount, loan.currency, currSymbol, settings.numberGrouping, 0)} +{' '}
                    <span className="text-rose-400">
                      {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)} fee
                    </span>
                    {' = '}{formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)}
                  </span>
                </div>

                {/* Prepayment Barrier Actions */}
                <div className="pt-2 border-t border-amber-500/30 flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-[11px] cursor-pointer transition-colors"
                  >
                    Stop & Wait for Next Month
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer text-[11px] text-amber-200 select-none">
                    <input
                      type="checkbox"
                      checked={confirmedRepeatPayment}
                      onChange={(e) => setConfirmedRepeatPayment(e.target.checked)}
                      className="rounded border-slate-700 text-amber-500 focus:ring-amber-500 shrink-0"
                    />
                    <span>
                      I confirm paying the{' '}
                      <strong>
                        {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)} fee
                      </strong>
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Loan Principal & Saved Policy Charge Readout */}
        <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[11px] text-slate-400 font-medium">
              Existing Principal · {remainingTenure} mo remaining
            </span>
            <div className="text-xl font-black text-white font-mono tabular-nums mt-0.5">
              {formatMoney(fullAmount, loan.currency, currSymbol, settings.numberGrouping, 0)}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-slate-400">
              <span className="text-indigo-400 font-bold font-mono tabular-nums">
                {loan.ratePct}% p.a.
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                EMI {formatMoney(emiAmount, loan.currency, currSymbol, settings.numberGrouping, 0)}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] text-slate-400 font-medium">
              {isExtraPrepayment
                ? `Applied Charge (${policyChargeEval.penaltyPct}%)`
                : 'Applied Charge (EMI)'}
            </span>
            <div
              className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${
                activePenaltyCharge > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              {isExtraPrepayment
                ? policyChargeEval.ruleLabel
                : policyChargeEval.penaltyPct > 0
                ? `Zero on EMI · ${policyChargeEval.penaltyPct}% on prepay`
                : 'Penalty-free policy'}
            </div>
          </div>
        </div>

        {/* Unified Payment Mode Selector */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            1. Select Payment Mode
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setPayOption('emi')}
              className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                payOption === 'emi'
                  ? 'bg-indigo-950/50 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-bold text-xs whitespace-nowrap flex items-center gap-1">
                <span>Monthly EMI</span>
                {isAlreadyPaidThisMonth && (
                  <span className="text-[10px] text-emerald-400 font-normal">(Paid)</span>
                )}
              </div>
              <div className="font-mono tabular-nums text-[11px] mt-0.5 text-indigo-300">
                {formatCompactMoney(emiAmount, loan.currency, currSymbol)}
                {isAlreadyPaidThisMonth && activePenaltyCharge > 0
                  ? ` · +${policyChargeEval.penaltyPct}% Fee`
                  : ' · No fee'}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPayOption('custom')}
              className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                payOption === 'custom'
                  ? 'bg-indigo-950/50 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-bold text-xs whitespace-nowrap">Partial Prepay</div>
              <div className="text-[11px] mt-0.5 text-slate-400 whitespace-nowrap truncate">
                Custom principal
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setPayOption('full');
                setCustomAmount(fullAmount.toString());
              }}
              className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                payOption === 'full'
                  ? 'bg-indigo-950/50 border-indigo-500 text-white'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="font-bold text-xs whitespace-nowrap">Full Payoff</div>
              <div className="font-mono tabular-nums text-[11px] mt-0.5 text-emerald-400">
                {formatCompactMoney(fullAmount, loan.currency, currSymbol)}
              </div>
            </button>
          </div>
        </div>

        {/* Amount Input & Partial Prepay Goal (Cut Tenure vs Cut EMI) */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-xs font-semibold text-slate-300">
              Principal Payment Amount ({currSymbol})
            </label>
            {payOption === 'custom' && (
              <div className="flex items-center gap-1.5">
                {[0.25, 0.5].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setCustomAmount(Math.round(fullAmount * pct).toString())}
                    className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[11px] font-mono tabular-nums text-slate-300 cursor-pointer transition-colors"
                  >
                    {pct * 100}%
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <span className="absolute left-3 top-2.5 text-slate-400 font-mono text-sm">
              {currSymbol}
            </span>
            <input
              type="number"
              step="any"
              min="1"
              max={fullAmount}
              value={payOption === 'custom' ? customAmount : paymentAmount}
              onChange={(e) => {
                setCustomAmount(e.target.value);
                if (payOption !== 'custom') setPayOption('custom');
              }}
              className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono tabular-nums text-sm focus:border-indigo-500 outline-none"
              placeholder="0.00"
              required
            />
          </div>

          {payOption === 'custom' && isExtraPrepayment && remainingLoanBalance > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-slate-400">Post-Prepayment Adjustment:</span>
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setMaintainTenure(false)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                    !maintainTenure
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cut Tenure ({prepaySim.revisedRemainingMonths} mo)
                </button>
                <button
                  type="button"
                  onClick={() => setMaintainTenure(true)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                    maintainTenure
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cut EMI
                </button>
              </div>
            </div>
          )}

          {isBlockedByLockIn && (
            <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 flex items-start gap-2 text-[11px]">
              <Lock size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Lock-In Active ({lockStatus.remainingLockInMonths} mo remaining):</strong> Per your saved loan policy, early prepayment is locked until{' '}
                <strong>{lockStatus.unlockDateStr || 'lock-in expiry'}</strong>. Select Monthly EMI for scheduled installment.
              </span>
            </div>
          )}

          {!isBlockedByLockIn && isExtraPrepayment && (
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
              <div>
                <span className="block text-[10px] font-sans text-slate-400">Interest Saved</span>
                <span className="font-bold text-emerald-400">
                  {formatMoney(prepaySim.grossInterestSaved, loan.currency, currSymbol, settings.numberGrouping, 0)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-sans text-slate-400">
                  Policy Fee ({policyChargeEval.penaltyPct}%)
                </span>
                <span className="font-bold text-rose-400">
                  {formatMoney(activePenaltyCharge, loan.currency, currSymbol, settings.numberGrouping, 0)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-sans text-slate-400">Net Benefit</span>
                <span
                  className={`font-bold ${
                    prepaySim.netFinancialBenefit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatMoney(prepaySim.netFinancialBenefit, loan.currency, currSymbol, settings.numberGrouping, 0)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Source Liquid Asset Selection */}
        <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Wallet size={14} className="text-cyan-400" />
              <span>2. Deduct From Liquid Cash / Bank Account</span>
            </label>
            <span className="text-[10px] text-slate-400 font-mono tabular-nums">
              Total Outflow: {formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)}
            </span>
          </div>

          {liquidHoldings.length === 0 ? (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
              No unlocked liquid cash or bank accounts available. Locked holdings and credit cards cannot settle loan obligations.
            </div>
          ) : (
            <select
              value={fromAssetId}
              onChange={(e) => setFromAssetId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-white focus:border-cyan-500 outline-none cursor-pointer"
              required
            >
              {liquidHoldings.map((h) => {
                const hCurr = currMap[h.currency]?.symbol || `${h.currency} `;
                const { totalSweepIn: swp } = getAccountLiquidityWithSweepIn(h.id);
                return (
                  <option key={h.id} value={h.id}>
                    {formatAssetOptionLabel(h, assetTypes, {
                      currSymbol: hCurr,
                      sweepInAmount: swp,
                    })}
                  </option>
                );
              })}
            </select>
          )}

          {selectedAsset && (
            <div
              className={`p-3 rounded-xl border transition-all ${
                isSufficient
                  ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/20 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {isSufficient ? (
                    <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle size={16} className="text-rose-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <span className="font-bold text-white block break-words">
                      {getSafeAssetName(selectedAsset, assetTypes)}
                    </span>
                    <span className="text-[11px] text-slate-300 font-mono tabular-nums">
                      Cash: <strong>{formatMoney(availableAssetBalance, selectedAsset.currency, currSymbol, settings.numberGrouping, 0)}</strong>
                      {totalSweepIn > 0 && (
                        <span className="text-cyan-400">
                          {' '}· +{formatMoney(totalSweepIn, selectedAsset.currency, currSymbol, settings.numberGrouping, 0)} Sweep-In
                        </span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="font-semibold text-[11px] block">
                    {isSufficient
                      ? isUsingSweepIn
                        ? 'Covered via Sweep-In'
                        : 'Sufficient Liquid Cash'
                      : `Short by ${formatMoney(shortfall, loan.currency, currSymbol, settings.numberGrouping, 0)}`}
                  </span>
                  <div className="text-[10px] text-slate-400 mt-0.5 font-mono tabular-nums">
                    {isSufficient
                      ? isUsingSweepIn
                        ? `Auto-breaks ${getSafeAssetName(sweepInFds[0], assetTypes)}`
                        : `Remaining cash: ${formatMoney(remainingAssetBalance, loan.currency, currSymbol, settings.numberGrouping, 0)}`
                      : 'Positive liquid funds required'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Future Interest Rate Revision Option */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={shouldUpdateRate}
              onChange={(e) => setShouldUpdateRate(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-indigo-500 focus:ring-0 cursor-pointer"
            />
            <span className="text-xs font-semibold text-slate-200">
              Update Interest Rate for Future Calculations ({loan.ratePct}% p.a.)
            </span>
          </label>

          {shouldUpdateRate && (
            <div className="pl-6 pt-1 flex items-center gap-2">
              <div className="relative w-36">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={newInterestRate}
                  onChange={(e) => setNewInterestRate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono tabular-nums"
                  placeholder="e.g. 8.25"
                />
                <span className="absolute right-2.5 top-2 text-slate-400 text-xs font-mono">%</span>
              </div>
              <span className="text-[11px] text-indigo-400 font-medium">
                Revised rate: {newInterestRate}% p.a.
              </span>
            </div>
          )}
        </div>

        {/* Real-time Impact Summary */}
        <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 grid grid-cols-2 gap-2 font-mono tabular-nums text-xs">
          <div>
            <span className="text-[10px] font-sans text-slate-400 flex items-center gap-1">
              <TrendingDown size={12} className="text-cyan-400" />
              Remaining Principal
            </span>
            <span className="font-bold text-white mt-0.5 block">
              {formatMoney(remainingLoanBalance, loan.currency, currSymbol, settings.numberGrouping, 0)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-sans text-slate-400 block">Annual Interest Saved</span>
            <span className="font-bold text-emerald-400 mt-0.5 block">
              +{formatMoney(annualInterestSaved, loan.currency, currSymbol, settings.numberGrouping, 0)}/yr
            </span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm pt-3 pb-1 border-t border-slate-800 -mx-4 -mb-4 px-4 sm:-mx-5 sm:-mb-5 sm:px-5 flex items-center justify-end gap-2.5 z-10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs cursor-pointer whitespace-nowrap"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={
              !isSufficient ||
              isSubmitting ||
              paymentAmount <= 0 ||
              isEnforcedHighFeeBlock ||
              (isAlreadyPaidThisMonth && activePenaltyCharge > 0 && !confirmedRepeatPayment)
            }
            className={`px-5 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md whitespace-nowrap ${
              isSufficient &&
              !isSubmitting &&
              paymentAmount > 0 &&
              !isEnforcedHighFeeBlock &&
              !(isAlreadyPaidThisMonth && activePenaltyCharge > 0 && !confirmedRepeatPayment)
                ? higherChargeComparison.shouldGlowRed
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/40 cursor-pointer'
                  : isAlignedWithPrediction
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30 cursor-pointer'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30 cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
            }`}
          >
            {isSubmitting ? (
              <span>Processing Settlement...</span>
            ) : isEnforcedHighFeeBlock ? (
              <span>Fee Guard Enforced · Prepayment Blocked</span>
            ) : isAlreadyPaidThisMonth && activePenaltyCharge > 0 && !confirmedRepeatPayment ? (
              <span>Stopped · Acknowledge Fee to Pay</span>
            ) : isUsingSweepIn ? (
              <>
                <Zap size={14} />
                <span>
                  Pay with Sweep-In ({formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)})
                </span>
              </>
            ) : (
              <>
                <span>
                  {higherChargeComparison.shouldGlowRed
                    ? `Proceed & Pay ${formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)}`
                    : isAlignedWithPrediction && predictedPlan && subtleFramingEnabled
                    ? `${predictedPlan.ctaAnchorLabel} · ${formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)}`
                    : `Confirm & Pay ${formatMoney(totalOutflowRequired, loan.currency, currSymbol, settings.numberGrouping, 0)}`}
                </span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
