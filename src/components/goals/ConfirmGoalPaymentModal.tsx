import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Goal, GoalPaymentMode } from '../../types';
import { formatMoney } from '../../lib/formatters';
import { Modal } from '../common/Modal';
import {
  CheckCircle2,
  Wallet,
  AlertTriangle,
  ArrowRight,
  Building2,
  Lock,
  Smartphone,
  CreditCard,
  Zap,
  Percent,
} from 'lucide-react';
import {
  isSpendableLiquidHolding,
  getSafeAssetName,
  getSafeLiabilityName,
  resolveAssetTypeLabel,
} from '../../lib/assetRules';

interface ConfirmGoalPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  goal: Goal;
  onSuccess?: () => void;
}

export const ConfirmGoalPaymentModal: React.FC<ConfirmGoalPaymentModalProps> = ({
  isOpen,
  onClose,
  goal,
  onSuccess,
}) => {
  const { holdings, liabilities, assetTypes, currencies, payGoal } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successInfo, setSuccessInfo] = useState<{
    txId: string;
    isPartial: boolean;
    paidAmount: number;
    remaining: number;
  } | null>(null);

  const currMap: Record<string, typeof currencies[0]> = {};
  for (const c of currencies) currMap[c.code] = c;
  const goalCurrSym = currMap[goal.currency]?.symbol || goal.currency;

  const currentAccumulated = goal.accumulatedTotal || 0;
  const remainingCost = Math.max(0, goal.cost - currentAccumulated);

  // Payment Option: 'partial' (e.g. 30%, 10%, or custom increment) vs 'full'
  const [payType, setPayType] = useState<'partial' | 'full'>(
    remainingCost <= 0 ? 'full' : 'partial'
  );
  // Default to 30% per user prompt
  const [selectedPercentage, setSelectedPercentage] = useState<number>(30);
  const [customAmount, setCustomAmount] = useState<string>(
    Math.round(goal.cost * 0.3).toString()
  );

  // Payment method: UPI (default per user prompt) vs Debit Card
  const [paymentMode, setPaymentMode] = useState<GoalPaymentMode>('upi');
  const [selectedDebitCardId, setSelectedDebitCardId] = useState<string>('');

  // Available debit / hybrid cards
  const debitCards = liabilities.filter(
    (l) => l.kind === 'card' && (l.cardType === 'debit' || l.cardType === 'hybrid')
  );

  React.useEffect(() => {
    if (debitCards.length > 0 && !selectedDebitCardId) {
      setSelectedDebitCardId(debitCards[0].id);
    }
  }, [debitCards, selectedDebitCardId]);

  // Determine actual payment amount to pay in this increment
  let amtToPay = remainingCost;
  if (payType === 'partial') {
    if (selectedPercentage > 0) {
      amtToPay = Math.min(remainingCost, Math.round(goal.cost * (selectedPercentage / 100)));
    } else {
      const parsed = parseFloat(customAmount);
      amtToPay = !isNaN(parsed) && parsed > 0 ? Math.min(remainingCost, parsed) : Math.round(goal.cost * 0.3);
    }
  }

  // Calculate the deduction breakdown across linked assets for amtToPay
  const deductions: {
    holdingId: string;
    holdingName: string;
    holdingType: string;
    currency: string;
    currSym: string;
    currentBalance: number;
    deductAmount: number;
    remainingBalance: number;
    hasSufficientFunds: boolean;
    isCoveredBySweepIn?: boolean;
    sweepInTotal?: number;
  }[] = [];

  let totalDeduction = 0;

  if (goal.sources && goal.sources.length > 0) {
    for (const src of goal.sources) {
      if (src.sourceType === 'credit_card') continue;
      const h = holdings.find((x) => x.id === src.sourceId && isSpendableLiquidHolding(x, assetTypes));
      if (!h) continue;
      const assetVal = Math.max(0, h.principalOrValue || 0);
      let deductAmt = 0;
      if (src.allocationMode === 'fixed_amount' && src.allocationAmount && src.allocationAmount > 0) {
        const ratio = payType === 'full' ? 1 : amtToPay / Math.max(1, remainingCost);
        deductAmt = Math.min(assetVal, src.allocationAmount * ratio);
      } else if (src.allocationMode === 'units' && src.allocationUnits && src.allocationUnits > 0) {
        const unitPrice = h.currentPrice || src.unitPriceAtAllocation || (h.units ? assetVal / h.units : 1);
        const ratio = payType === 'full' ? 1 : amtToPay / Math.max(1, remainingCost);
        deductAmt = Math.min(assetVal, src.allocationUnits * unitPrice * ratio);
      } else {
        const pct = (src.allocationPct || 0) / 100;
        deductAmt = Math.min(assetVal, amtToPay * pct);
      }

      if (deductAmt > 0) {
        const sym = currMap[h.currency]?.symbol || h.currency;
        const linkedSweepIns = holdings.filter(
          (fd) =>
            fd.isSweepIn &&
            (fd.principalOrValue || 0) > 0 &&
            (!fd.sweepInTargetAccountId || fd.sweepInTargetAccountId === h.id)
        );
        const sweepInTotal = linkedSweepIns.reduce((sum, fd) => sum + (fd.principalOrValue || 0), 0);
        const isCoveredBySweepIn = assetVal < deductAmt && assetVal + sweepInTotal >= deductAmt;

        deductions.push({
          holdingId: h.id,
          holdingName: getSafeAssetName(h, assetTypes),
          holdingType: resolveAssetTypeLabel(h, assetTypes),
          currency: h.currency,
          currSym: sym,
          currentBalance: assetVal,
          deductAmount: deductAmt,
          remainingBalance: assetVal - deductAmt,
          hasSufficientFunds: assetVal >= deductAmt || isCoveredBySweepIn,
          isCoveredBySweepIn,
          sweepInTotal,
        });
        totalDeduction += deductAmt;
      }
    }
  }

  // If allocated deductions do not cover amtToPay, assign remaining strictly to an unlocked liquid bank/cash holding
  if (totalDeduction < amtToPay) {
    const remainder = amtToPay - totalDeduction;
    const liquidHoldings = holdings.filter((h) => isSpendableLiquidHolding(h, assetTypes));
    const fallbackHolding =
      liquidHoldings.find((h) => h.id === goal.contributionSourceId) ||
      liquidHoldings.find((h) => (h.principalOrValue || 0) > 0) ||
      liquidHoldings[0];

    if (fallbackHolding) {
      const assetVal = Math.max(0, fallbackHolding.principalOrValue || 0);

      const sym = currMap[fallbackHolding.currency]?.symbol || fallbackHolding.currency;
      const linkedSweepIns = holdings.filter(
        (fd) =>
          fd.isSweepIn &&
          (fd.principalOrValue || 0) > 0 &&
          (!fd.sweepInTargetAccountId || fd.sweepInTargetAccountId === fallbackHolding.id)
      );
      const sweepInTotal = linkedSweepIns.reduce((sum, fd) => sum + (fd.principalOrValue || 0), 0);
      const isCoveredBySweepIn = assetVal < remainder && assetVal + sweepInTotal >= remainder;

      const existingIdx = deductions.findIndex((d) => d.holdingId === fallbackHolding.id);
      if (existingIdx >= 0) {
        deductions[existingIdx].deductAmount += remainder;
        deductions[existingIdx].remainingBalance =
          deductions[existingIdx].currentBalance - deductions[existingIdx].deductAmount;
        deductions[existingIdx].hasSufficientFunds =
          deductions[existingIdx].currentBalance >= deductions[existingIdx].deductAmount ||
          deductions[existingIdx].currentBalance + (deductions[existingIdx].sweepInTotal || 0) >=
            deductions[existingIdx].deductAmount;
      } else {
        deductions.push({
          holdingId: fallbackHolding.id,
          holdingName: getSafeAssetName(fallbackHolding, assetTypes),
          holdingType: resolveAssetTypeLabel(fallbackHolding, assetTypes),
          currency: fallbackHolding.currency,
          currSym: sym,
          currentBalance: assetVal,
          deductAmount: remainder,
          remainingBalance: assetVal - remainder,
          hasSufficientFunds: assetVal >= remainder || isCoveredBySweepIn,
          isCoveredBySweepIn,
          sweepInTotal,
        });
      }
      totalDeduction += remainder;
    }
  }

  const hasAnyInsufficient = deductions.some((d) => !d.hasSufficientFunds);

  const handleConfirmPayment = async () => {
    if (hasAnyInsufficient) {
      setErrorMessage('Cannot complete payment: liquid cash + Sweep-In deposits are insufficient.');
      return;
    }

    if (paymentMode === 'debit_card' && debitCards.length > 0 && !selectedDebitCardId) {
      setErrorMessage('Please select which debit card was used.');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await payGoal(
        goal.id,
        payType === 'partial' ? amtToPay : undefined,
        paymentMode,
        paymentMode === 'debit_card' ? selectedDebitCardId : undefined
      );

      if (res.success) {
        setIsProcessing(false);
        setSuccessInfo({
          txId: res.txId || 'tx-goal-confirmed',
          isPartial: Boolean(res.isPartial),
          paidAmount: res.paidAmount || amtToPay,
          remaining: res.remaining !== undefined ? res.remaining : 0,
        });
        setIsSuccess(true);
      } else {
        setIsProcessing(false);
        setErrorMessage(res.error || 'Payment execution failed. Please verify asset liquidity.');
      }
    } catch (err: any) {
      setIsProcessing(false);
      setErrorMessage(err?.message || 'An unexpected error occurred while executing goal payment.');
    }
  };

  // SUCCESS SCREEN
  if (isSuccess && successInfo) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={() => {
          setIsSuccess(false);
          onClose();
          if (onSuccess) onSuccess();
        }}
        title={successInfo.isPartial ? 'Installment Recorded in Ledger' : 'Goal Completed and Archived'}
        subtitle={
          successInfo.isPartial
            ? 'Goal remains open — next installment scheduled for next month'
            : '100% Goal Fulfilled and Archived'
        }
      >
        <div className="py-5 px-3 text-center space-y-4 animate-fade-in">
          <div
            className={`w-16 h-16 rounded-3xl mx-auto flex items-center justify-center border shadow-lg ${
              successInfo.isPartial
                ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 shadow-cyan-500/20'
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-emerald-500/20'
            }`}
          >
            <CheckCircle2 size={36} />
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-bold text-white tracking-tight">
              {successInfo.isPartial
                ? `Installment Paid: ${formatMoney(successInfo.paidAmount, goal.currency, goalCurrSym)}`
                : 'Goal Target Settled'}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
              {successInfo.isPartial
                ? `You paid an increment of ${formatMoney(
                    successInfo.paidAmount,
                    goal.currency,
                    goalCurrSym
                  )}. The goal is NOT closed; the remaining balance of ${formatMoney(
                    successInfo.remaining,
                    goal.currency,
                    goalCurrSym
                  )} is scheduled for next month.`
                : `Your goal "${goal.name}" is 100% fulfilled. Total amount ${formatMoney(
                    goal.cost,
                    goal.currency,
                    goalCurrSym
                  )} was verified and deducted from linked assets.`}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-400 font-mono text-left space-y-1.5 shadow-inner">
            <div className="flex justify-between">
              <span>Ledger Transaction:</span>
              <span className="text-slate-200 font-bold">{successInfo.txId}</span>
            </div>
            <div className="flex justify-between">
              <span>Amount Paid Now:</span>
              <span className="text-emerald-400 font-bold">
                -{formatMoney(successInfo.paidAmount, goal.currency, goalCurrSym)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Payment Mode:</span>
              <span className="text-cyan-300">
                {paymentMode === 'debit_card' ? 'Debit Card (+1 usage)' : 'UPI'}
              </span>
            </div>
            <div className="flex justify-between border-t border-slate-800 pt-1">
              <span>Goal Status:</span>
              <span
                className={`font-bold ${
                  successInfo.isPartial ? 'text-amber-400' : 'text-emerald-300'
                }`}
              >
                {successInfo.isPartial
                  ? `Active In Progress (${formatMoney(
                      successInfo.remaining,
                      goal.currency,
                      goalCurrSym
                    )} remaining)`
                  : 'Archived (Backend Record Preserved)'}
              </span>
            </div>
          </div>

          <button
            onClick={() => {
              setIsSuccess(false);
              onClose();
              if (onSuccess) onSuccess();
            }}
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm cursor-pointer shadow-lg shadow-emerald-600/30 transition-all"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Pay Goal: ${goal.name}`}
      subtitle="Pay in monthly increments (e.g. 30%) or settle the entire remaining balance"
    >
      <div className="space-y-4">
        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2">
            <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-bold">Payment Error</strong>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* Goal Summary Card */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/30 border border-indigo-500/30 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
                Goal Payment Summary
              </span>
              <h3 className="text-sm font-bold text-white">{goal.name}</h3>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-medium">
                Target Cost
              </span>
              <span className="text-base font-black font-mono text-white">
                {formatMoney(goal.cost, goal.currency, goalCurrSym)}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-800 text-slate-300 font-mono">
            <span>
              Paid So Far: <strong className="text-emerald-400">{formatMoney(currentAccumulated, goal.currency, goalCurrSym)}</strong> (
              {((currentAccumulated / goal.cost) * 100).toFixed(0)}%)
            </span>
            <span>
              Remaining Due: <strong className="text-rose-400">{formatMoney(remainingCost, goal.currency, goalCurrSym)}</strong>
            </span>
          </div>
        </div>

        {/* Payment Amount Type: Partial Increment vs Full Payoff */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-200">
            Choose Payment Structure
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPayType('partial')}
              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                payType === 'partial'
                  ? 'bg-cyan-950/40 border-cyan-500 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Percent size={14} className={payType === 'partial' ? 'text-cyan-400' : 'text-slate-400'} />
                <span>Pay Partial Increment</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                e.g. 30% now, remainder due next month
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPayType('full')}
              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                payType === 'full'
                  ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <CheckCircle2 size={14} className={payType === 'full' ? 'text-emerald-400' : 'text-slate-400'} />
                <span>Pay Entire Remaining</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {formatMoney(remainingCost, goal.currency, goalCurrSym)} (100% fulfill)
              </div>
            </button>
          </div>

          {/* Partial Increment Controls & Notice */}
          {payType === 'partial' && (
            <div className="p-3.5 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 space-y-3 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-300">
                  Select Increment Percentage
                </span>
                <span className="text-[10px] text-cyan-400 font-mono font-bold bg-cyan-950 px-2 py-0.5 rounded-full border border-cyan-500/30">
                  Paying: {formatMoney(amtToPay, goal.currency, goalCurrSym)}
                </span>
              </div>

              {/* Quick Percentage Chips */}
              <div className="grid grid-cols-4 gap-1.5">
                {[30, 25, 50, 10].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => {
                      setSelectedPercentage(pct);
                      setCustomAmount(Math.round(goal.cost * (pct / 100)).toString());
                    }}
                    className={`py-1.5 px-2 rounded-xl border text-xs font-bold font-mono transition-all cursor-pointer ${
                      selectedPercentage === pct
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                    }`}
                  >
                    {pct}% ({formatMoney(Math.round(goal.cost * (pct / 100)), goal.currency, goalCurrSym)})
                  </button>
                ))}
              </div>

              {/* Custom Increment Input */}
              <div>
                <label className="block text-[11px] font-medium text-slate-300 mb-1">
                  Custom Increment Amount ({goal.currency})
                </label>
                <input
                  type="number"
                  step="any"
                  max={remainingCost}
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setSelectedPercentage(0);
                  }}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono font-bold focus:border-cyan-400 focus:outline-none"
                  placeholder="Enter custom installment"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 leading-snug">
                <strong>Installment Rule:</strong> Partial payments do <strong>not</strong> close this goal. Recording {formatMoney(amtToPay, goal.currency, goalCurrSym)} today leaves {formatMoney(Math.max(0, remainingCost - amtToPay), goal.currency, goalCurrSym)} scheduled for next month and keeps the goal active until 100% settled.
              </div>
            </div>
          )}
        </div>

        {/* Payment Method Selection: UPI (Default) vs Debit Card */}
        <div className="space-y-2 pt-1 border-t border-slate-800">
          <label className="block text-xs font-bold text-slate-200">
            Payment Method <span className="text-slate-400 text-[11px] font-normal">(Default is UPI)</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPaymentMode('upi')}
              className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                paymentMode === 'upi'
                  ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Smartphone size={15} className={paymentMode === 'upi' ? 'text-emerald-400' : 'text-slate-400'} />
              <div className="text-left">
                <div className="text-xs font-bold">UPI (Default)</div>
                <div className="text-[10px] text-slate-400">GPay, PhonePe, Paytm</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setPaymentMode('debit_card')}
              className={`p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                paymentMode === 'debit_card'
                  ? 'bg-cyan-950/40 border-cyan-500 text-white shadow-sm'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <CreditCard size={15} className={paymentMode === 'debit_card' ? 'text-cyan-400' : 'text-slate-400'} />
              <div className="text-left">
                <div className="text-xs font-bold">Debit Card</div>
                <div className="text-[10px] text-slate-400">Counts 1 card usage</div>
              </div>
            </button>
          </div>

          {/* Debit Card Selector if Debit Card is chosen */}
          {paymentMode === 'debit_card' && (
            <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 space-y-2 animate-fade-in">
              <label className="block text-[11px] font-bold text-cyan-200">
                Which Debit Card was used?
              </label>
              {debitCards.length === 0 ? (
                <p className="text-xs text-amber-300">
                  No debit cards found. Add a debit card in Liabilities tab first.
                </p>
              ) : (
                <select
                  value={selectedDebitCardId}
                  onChange={(e) => setSelectedDebitCardId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100"
                >
                  {debitCards.map((c) => {
                    const linked = holdings.find((h) => h.id === c.linkedAccountId);
                    return (
                      <option key={c.id} value={c.id}>
                        {getSafeLiabilityName(c)}{linked ? ` — Linked Account: ${getSafeAssetName(linked, assetTypes)}` : ''}
                      </option>
                    );
                  })}
                </select>
              )}
              <p className="text-[10px] text-slate-400">
                Each debit card only withdraws money from its linked bank account (not FD, not credit card, not stocks).
              </p>
            </div>
          )}
        </div>

        {/* Linked Assets Deduction Breakdown */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Wallet size={14} className="text-indigo-400" />
              <span>Asset Deductions for this Payment ({deductions.length})</span>
            </span>
            <span className="text-[10px] text-slate-400 font-normal">
              Total to Debit: {formatMoney(amtToPay, goal.currency, goalCurrSym)}
            </span>
          </h4>

          <div className="space-y-2">
            {deductions.map((d) => (
              <div
                key={d.holdingId}
                className={`p-3 rounded-xl border text-xs flex flex-col gap-2 transition-all ${
                  d.hasSufficientFunds
                    ? 'bg-slate-900/90 border-slate-800'
                    : 'bg-rose-950/20 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-white flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-400" />
                      <span>{d.holdingName}</span>
                      <span className="text-[10px] text-slate-500 font-mono">({d.currency})</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Current Balance: {formatMoney(d.currentBalance, d.currency, d.currSym)}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase font-medium block">Debit Amount</span>
                    <span className="font-mono font-bold text-rose-400 text-sm">
                      -{formatMoney(d.deductAmount, d.currency, d.currSym)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80 text-[11px] flex-wrap gap-1">
                  <span className="text-slate-400 flex items-center gap-1.5">
                    <span>Post-Payment Balance:</span>
                    {d.isCoveredBySweepIn && (
                      <span className="text-[10px] text-cyan-300 font-bold bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/30 flex items-center gap-1">
                        <Zap size={10} className="text-cyan-400" /> Backed by Sweep-In auto-break
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-mono font-semibold ${
                      d.remainingBalance >= 0 ? 'text-slate-200' : 'text-amber-400 font-bold'
                    }`}
                  >
                    {formatMoney(d.remainingBalance, d.currency, d.currSym)}
                  </span>
                </div>

                {!d.hasSufficientFunds && (
                  <div className="text-[11px] font-bold text-rose-400 flex items-center gap-1 pt-0.5">
                    <AlertTriangle size={12} />
                    <span>Insufficient funds in this account and Sweep-In is not enabled.</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Confirmation Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleConfirmPayment}
            disabled={isProcessing || hasAnyInsufficient || amtToPay <= 0}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer shadow-md transition-all ${
              hasAnyInsufficient || isProcessing || amtToPay <= 0
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
            }`}
          >
            {isProcessing ? (
              <span>Verifying & Deducting...</span>
            ) : (
              <>
                <Lock size={14} />
                <span>
                  {payType === 'full'
                    ? `Authorize Full Payment (${formatMoney(amtToPay, goal.currency, goalCurrSym)})`
                    : `Authorize Installment (${formatMoney(amtToPay, goal.currency, goalCurrSym)})`}
                </span>
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
